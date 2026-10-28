'use strict';

const { writeAudit } = require('./audit');
const {
  getRolePermissions,
  getRoleObjectPermissions,
  getUserPermissionOverrides,
  getUserObjectPermissions,
  resolvePermission
} = require('./permissions');
const {
  loadSmtpConfig,
  sendMail,
  sanitizeSmtpError,
  validateSmtpConfig
} = require('./smtp');
const { teamsConfigured, deliverTeams } = require('./teams');

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const PENDING_TIMEOUT_MS = 15 * 60 * 1000;

function headerSafe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

function organizationName(db) {
  return headerSafe(db.prepare('SELECT org_name FROM settings WHERE id = 1').get()?.org_name || 'Fuhrpark');
}

function userCanApprove(db, user) {
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.role === 'superadmin') return false;
  return resolvePermission({
    rolePermissions: new Set(getRolePermissions(db, user.role)),
    roleObjectPermissions: getRoleObjectPermissions(db, user.role),
    userPermissionOverrides: getUserPermissionOverrides(db, user.id),
    userObjectPermissions: getUserObjectPermissions(db, user.id)
  }, 'booking_requests_manage', {});
}

function approverRecipients(db, { excludeUserId = null } = {}) {
  const users = db.prepare(`
    SELECT id, email, role
    FROM users
    WHERE active = 1 AND anonymized_at IS NULL AND email <> ''
    ORDER BY role DESC, email
  `).all();
  return [...new Set(users
    .filter((user) => user.id !== excludeUserId && userCanApprove(db, user))
    .map((user) => String(user.email || '').trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))].sort();
}

function requesterRecipient(db, userId) {
  const user = db.prepare(`
    SELECT email FROM users
    WHERE id = ? AND active = 1 AND anonymized_at IS NULL
  `).get(userId);
  const email = String(user?.email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function requestContext(db, requestId) {
  return db.prepare(`
    SELECT r.*, v.name AS vehicle_name, v.plate AS vehicle_plate,
      d.name AS driver_name, u.name AS requester_name, u.email AS requester_email
    FROM booking_requests r
    LEFT JOIN vehicles v ON v.id = r.vehicle_id
    LEFT JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN users u ON u.id = r.requested_by
    WHERE r.id = ?
  `).get(requestId) || null;
}

function deliveryIsDue(delivery, nowMs) {
  if (!delivery) return true;
  if (delivery.status === 'sent') return false;
  const lastAttempt = Date.parse(delivery.last_attempt_at || delivery.updated_at || '');
  if (delivery.status === 'pending' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < PENDING_TIMEOUT_MS) return false;
  if (delivery.status === 'failed' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < RETRY_AFTER_MS) return false;
  return true;
}

function beginDelivery(db, { key, vehicleId, kind }, nowISO) {
  const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE dedupe_key = ?').get(key);
  if (!deliveryIsDue(delivery, Date.now())) return false;
  db.prepare(`
    INSERT INTO notification_deliveries
      (dedupe_key, channel, vehicle_id, kind, status, attempts, last_attempt_at, created_at, updated_at)
    VALUES (?, 'email', ?, ?, 'pending', 1, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      status = 'pending',
      attempts = notification_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(key, vehicleId, kind, nowISO, nowISO, nowISO);
  return true;
}

function finishDelivery(db, key, status, errorCode, nowISO) {
  db.prepare(`
    UPDATE notification_deliveries
    SET status = ?, error_code = ?, last_attempt_at = ?, updated_at = ?
    WHERE dedupe_key = ?
  `).run(status, errorCode || null, nowISO, nowISO, key);
}

async function sendNotification(db, {
  key,
  vehicleId,
  kind,
  requestId,
  recipients,
  subject,
  text,
  dataDir,
  transportFactory,
  teamsFetch,
  now = new Date()
}) {
  if (!recipients.length) return { skipped: 'no_recipients' };
  const config = loadSmtpConfig(db, { dataDir });
  const smtpReady = config.enabled && validateSmtpConfig(config, { requireEnabled: true }).length === 0;
  const teamsReady = teamsConfigured();
  if (!smtpReady && !teamsReady) return { skipped: 'smtp_not_configured' };
  const nowISO = now.toISOString();
  let sent = 0;
  let failed = 0;
  let teamsSent = 0;
  let teamsFailed = 0;

  if (teamsReady) {
    const teamResult = await deliverTeams(db, {
      dedupeKey: key,
      title: `[${organizationName(db)}] ${subject}`,
      text,
      summary: subject,
      kind,
      entityType: 'booking_request',
      entityId: requestId,
      vehicleId,
      now,
      fetchImpl: teamsFetch
    });
    teamsSent += teamResult.sent || 0;
    teamsFailed += teamResult.failed || 0;
  }

  if (smtpReady) {
    if (!beginDelivery(db, { key, vehicleId, kind }, nowISO)) {
      return { skipped: teamsSent ? null : 'already_sent', sent, failed, teamsSent, teamsFailed };
    }
    try {
      await sendMail({
        config,
        to: recipients,
        subject: `[${organizationName(db)}] ${subject}`,
        text: [
          text,
          '',
          'Diese Nachricht wurde automatisch vom AWO Fuhrparkmanagement erzeugt.'
        ].join('\n'),
        transportFactory
      });
      finishDelivery(db, key, 'sent', null, nowISO);
      writeAudit(db, {
        userId: null,
        action: 'booking_request_notification',
        entityType: 'booking_request',
        entityId: requestId,
        details: { kind, status: 'sent', recipients: recipients.length }
      });
      sent = 1;
    } catch (error) {
      const code = sanitizeSmtpError(error);
      finishDelivery(db, key, 'failed', code, nowISO);
      console.warn(`Buchungsanfrage-Benachrichtigung konnte nicht versendet werden (${code}).`);
      writeAudit(db, {
        userId: null,
        action: 'booking_request_notification',
        entityType: 'booking_request',
        entityId: requestId,
        details: { kind, status: 'failed', errorCode: code, recipients: recipients.length }
      });
      failed = 1;
    }
  }

  return { skipped: null, sent, failed, teamsSent, teamsFailed };
}

async function notifyBookingRequestCreated(db, requestId, options = {}) {
  const request = requestContext(db, requestId);
  if (!request) return { skipped: 'not_found' };
  const recipients = approverRecipients(db, { excludeUserId: request.requested_by });
  const vehicle = request.vehicle_name
    ? `${request.vehicle_name} (${request.vehicle_plate || 'ohne Kennzeichen'})`
    : 'Fahrzeug';
  return sendNotification(db, {
    key: `booking-request:${requestId}:created`,
    vehicleId: request.vehicle_id,
    kind: 'booking_request_created',
    requestId,
    recipients,
    subject: `Neue Buchungsanfrage: ${headerSafe(vehicle)}`,
    text: [
      `${request.requester_name || 'Eine Person'} hat eine Buchungsanfrage gestellt.`,
      `Fahrzeug: ${vehicle}`,
      `Fahrer:in: ${request.driver_name || '-'}`,
      `Zeitraum: ${request.start_at} bis ${request.end_at}`,
      `Zweck: ${request.purpose || '-'}`,
      request.notes ? `Hinweise: ${request.notes}` : ''
    ].filter(Boolean).join('\n'),
    ...options
  });
}

async function notifyBookingRequestDecision(db, requestId, decision, options = {}) {
  const request = requestContext(db, requestId);
  if (!request) return { skipped: 'not_found' };
  const recipient = requesterRecipient(db, request.requested_by);
  if (!recipient) return { skipped: 'no_recipients' };
  const approved = decision === 'approved';
  const vehicle = request.vehicle_name
    ? `${request.vehicle_name} (${request.vehicle_plate || 'ohne Kennzeichen'})`
    : 'Fahrzeug';
  return sendNotification(db, {
    key: `booking-request:${requestId}:decision:${decision}`,
    vehicleId: request.vehicle_id,
    kind: `booking_request_${decision}`,
    requestId,
    recipients: [recipient],
    subject: `Buchungsanfrage ${approved ? 'genehmigt' : 'abgelehnt'}: ${headerSafe(vehicle)}`,
    text: [
      `Ihre Buchungsanfrage wurde ${approved ? 'genehmigt' : 'abgelehnt'}.`,
      `Fahrzeug: ${vehicle}`,
      `Fahrer:in: ${request.driver_name || '-'}`,
      `Zeitraum: ${request.start_at} bis ${request.end_at}`,
      `Zweck: ${request.purpose || '-'}`,
      request.decision_note ? `Entscheidung: ${request.decision_note}` : ''
    ].filter(Boolean).join('\n'),
    ...options
  });
}

module.exports = {
  approverRecipients,
  notifyBookingRequestCreated,
  notifyBookingRequestDecision
};
