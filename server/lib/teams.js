'use strict';

const { writeAudit } = require('./audit');
const { getTeamsIntegrationConfig } = require('./integrations');
const { createLogger, logMailEvent } = require('./logger');

const logger = createLogger('teams');

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const PENDING_TIMEOUT_MS = 15 * 60 * 1000;

function teamsConfigured(db) {
  return getTeamsIntegrationConfig(db).configured;
}

function deliveryIsDue(delivery, nowMs) {
  if (!delivery) return true;
  if (delivery.status === 'sent') return false;
  const lastAttempt = Date.parse(delivery.last_attempt_at || delivery.updated_at || '');
  if (delivery.status === 'pending' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < PENDING_TIMEOUT_MS) return false;
  if (delivery.status === 'failed' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < RETRY_AFTER_MS) return false;
  return true;
}

function mailEventFor(kind) {
  const value = String(kind || '').toLowerCase();
  if (value === 'test' || value.includes('integration_test')) return 'test';
  if (value.startsWith('leasing') || value.startsWith('km_') || value.startsWith('end_')) return 'leasing';
  if (value.startsWith('booking_request')) return 'booking_request';
  if (value.startsWith('maintenance') || value === 'tuv' || value === 'service') return 'maintenance';
  return 'notification';
}

function messageCard({ title, text, summary }) {
  return {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: String(summary || title || 'AWO Fuhrparkmanagement').slice(0, 200),
    themeColor: '0f766e',
    title: String(title || '').slice(0, 200),
    text: String(text || '').slice(0, 12000)
  };
}

async function deliverTeams(db, {
  dedupeKey,
  title,
  text,
  summary = '',
  kind = 'notification',
  entityType = 'notification',
  entityId = null,
  vehicleId = null,
  now = new Date(),
  fetchImpl = fetch,
  webhookUrl = undefined
} = {}) {
  const url = String(webhookUrl ?? getTeamsIntegrationConfig(db).webhookUrl ?? '').trim();
  if (!url) return { skipped: 'not_configured' };
  const startedAt = Date.now();
  const key = `teams:${dedupeKey}`;
  const nowMs = now.getTime();
  const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE dedupe_key = ?').get(key);
  if (!deliveryIsDue(delivery, nowMs)) return { skipped: 'already_sent' };
  const nowISO = now.toISOString();
  db.prepare(`
    INSERT INTO notification_deliveries
      (dedupe_key, channel, vehicle_id, kind, status, attempts, last_attempt_at, created_at, updated_at)
    VALUES (?, 'teams', ?, ?, 'pending', 1, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      status = 'pending',
      attempts = notification_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(key, vehicleId, kind, nowISO, nowISO, nowISO);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(messageCard({ title, text, summary })),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('teams_http_error');
    db.prepare(`
      UPDATE notification_deliveries
      SET status = 'sent', error_code = NULL, last_attempt_at = ?, updated_at = ?
      WHERE dedupe_key = ?
    `).run(nowISO, nowISO, key);
    writeAudit(db, {
      userId: null,
      action: 'teams_notification',
      entityType,
      entityId,
      details: { kind, status: 'sent' }
    });
    logMailEvent({
      channel: 'teams',
      event: mailEventFor(kind),
      recipientCount: 1,
      status: 'sent',
      durationMs: Date.now() - startedAt
    });
    return { sent: 1, failed: 0 };
  } catch (error) {
    db.prepare(`
      UPDATE notification_deliveries
      SET status = 'failed', error_code = 'TEAMS_ERROR', last_attempt_at = ?, updated_at = ?
      WHERE dedupe_key = ?
    `).run(nowISO, nowISO, key);
    logger.warn('Teams-Benachrichtigung konnte nicht versendet werden.', { error, kind });
    logMailEvent({
      channel: 'teams',
      event: mailEventFor(kind),
      recipientCount: 1,
      status: 'failed',
      errorCode: 'TEAMS_ERROR',
      durationMs: Date.now() - startedAt
    });
    writeAudit(db, {
      userId: null,
      action: 'teams_notification',
      entityType,
      entityId,
      details: { kind, status: 'failed', errorCode: 'TEAMS_ERROR' }
    });
    return { sent: 0, failed: 1 };
  }
}

module.exports = {
  teamsConfigured,
  deliverTeams,
  messageCard
};
