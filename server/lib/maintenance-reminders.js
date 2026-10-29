'use strict';

const { writeAudit } = require('./audit');
const {
  loadSmtpConfig,
  sendMail,
  sanitizeSmtpError,
  validateSmtpConfig
} = require('./smtp');
const { teamsConfigured, deliverTeams } = require('./teams');
const { getTeamsIntegrationConfig, getReminderSchedulerConfig } = require('./integrations');
const { dispatchWebhooks, webhooksConfiguredForEvent } = require('./webhooks');
const { createLogger } = require('./logger');

const logger = createLogger('maintenance');

const THRESHOLDS = [30, 14, 7];
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const PENDING_TIMEOUT_MS = 15 * 60 * 1000;

function headerSafe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

function organizationName(db) {
  return headerSafe(db.prepare('SELECT org_name FROM settings WHERE id = 1').get()?.org_name || 'Fuhrpark');
}

function todayISO(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysUntil(dueDate, now = new Date()) {
  const from = Date.parse(`${todayISO(now)}T00:00:00`);
  const to = Date.parse(`${String(dueDate).slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

function thresholdFor(days) {
  if (days === null) return null;
  if (days < 0) return 'overdue';
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return null;
}

function dueLabel(days) {
  if (days < 0) return `überfällig seit ${Math.abs(days)} ${Math.abs(days) === 1 ? 'Tag' : 'Tagen'}`;
  if (days === 0) return 'heute fällig';
  return `in ${days} ${days === 1 ? 'Tag' : 'Tagen'} fällig`;
}

function getRecipients(db) {
  const rows = db.prepare(`
    SELECT email FROM users
    WHERE active = 1
      AND role IN ('admin', 'manager')
      AND anonymized_at IS NULL
      AND email <> ''
    ORDER BY email
  `).all();
  return [...new Set(rows
    .map((row) => String(row.email || '').trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

function reminder({ kind, vehicleId, vehicleName, plate, title, dueDate, days, dedupeSuffix }) {
  const threshold = thresholdFor(days);
  if (threshold === null) return null;
  const dueText = dueLabel(days);
  const vehicleLabel = `${vehicleName} (${plate || 'ohne Kennzeichen'})`;
  const typeLabel = kind === 'tuv' ? 'HU/AU' : kind === 'service' ? 'Service/Inspektion' : 'Wartung';
  const subject = kind === 'tuv'
    ? `${threshold === 'overdue' ? 'HU/AU überfällig' : 'HU/AU fällig'}: ${headerSafe(vehicleLabel)}`
    : kind === 'service'
      ? `${threshold === 'overdue' ? 'Service überfällig' : 'Service fällig'}: ${headerSafe(vehicleLabel)}`
      : `${threshold === 'overdue' ? 'Wartung überfällig' : 'Wartung fällig'}: ${headerSafe(vehicleLabel)}`;
  return {
    kind,
    vehicleId,
    dedupeKey: `${kind}:${dedupeSuffix}:${String(dueDate).slice(0, 10)}:${threshold}`,
    subject,
    text: [
      `${typeLabel} für ${vehicleLabel}.`,
      title ? `Maßnahme: ${title}` : '',
      `Fällig am: ${String(dueDate).slice(0, 10)} (${dueText}).`,
      '',
      'Bitte prüfen Sie die Wartungsdaten im Fuhrparkmanagement.'
    ].filter(Boolean).join('\n')
  };
}

function collectMaintenanceReminders(db, now = new Date()) {
  const reminders = [];
  const maintenanceRows = db.prepare(`
    SELECT m.*, v.name AS vehicle_name, v.plate AS vehicle_plate
    FROM maintenance m
    JOIN vehicles v ON v.id = m.vehicle_id
    WHERE m.completed_at IS NULL AND m.status <> 'done'
    ORDER BY m.due_date, m.id
  `).all();
  for (const row of maintenanceRows) {
    const days = daysUntil(row.due_date, now);
    const entry = reminder({
      kind: 'maintenance',
      vehicleId: row.vehicle_id,
      vehicleName: row.vehicle_name,
      plate: row.vehicle_plate,
      title: row.title,
      dueDate: row.due_date,
      days,
      dedupeSuffix: `maintenance:${row.id}`
    });
    if (entry) reminders.push(entry);
  }

  const vehicleRows = db.prepare(`
    SELECT id, name, plate, tuv, next_service
    FROM vehicles
    WHERE tuv IS NOT NULL OR next_service IS NOT NULL
    ORDER BY name, id
  `).all();
  for (const row of vehicleRows) {
    if (row.tuv) {
      const entry = reminder({
        kind: 'tuv',
        vehicleId: row.id,
        vehicleName: row.name,
        plate: row.plate,
        title: 'HU/AU',
        dueDate: row.tuv,
        days: daysUntil(row.tuv, now),
        dedupeSuffix: `vehicle:${row.id}`
      });
      if (entry) reminders.push(entry);
    }
    if (row.next_service) {
      const entry = reminder({
        kind: 'service',
        vehicleId: row.id,
        vehicleName: row.name,
        plate: row.plate,
        title: 'Service/Inspektion',
        dueDate: row.next_service,
        days: daysUntil(row.next_service, now),
        dedupeSuffix: `vehicle:${row.id}`
      });
      if (entry) reminders.push(entry);
    }
  }
  return reminders;
}

function deliveryIsDue(delivery, nowMs) {
  if (!delivery) return true;
  if (delivery.status === 'sent') return false;
  const lastAttempt = Date.parse(delivery.last_attempt_at || delivery.updated_at || '');
  if (delivery.status === 'pending' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < PENDING_TIMEOUT_MS) return false;
  if (delivery.status === 'failed' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < RETRY_AFTER_MS) return false;
  return true;
}

function upsertPending(db, item, nowISO) {
  db.prepare(`
    INSERT INTO notification_deliveries
      (dedupe_key, channel, vehicle_id, kind, status, attempts, last_attempt_at, created_at, updated_at)
    VALUES (?, 'email', ?, ?, 'pending', 1, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      status = 'pending',
      attempts = notification_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(item.dedupeKey, item.vehicleId, item.kind, nowISO, nowISO, nowISO);
}

async function runMaintenanceNotifications(db, options = {}) {
  const dataDir = options.dataDir;
  const now = options.now || new Date();
  const config = loadSmtpConfig(db, { dataDir });
  const smtpReady = config.enabled && validateSmtpConfig(config, { requireEnabled: true }).length === 0;
  const teamsReady = teamsConfigured(db) && getTeamsIntegrationConfig(db).sendMaintenance;
  const webhooksReady = webhooksConfiguredForEvent(db, 'maintenance');
  if (!smtpReady && !teamsReady && !webhooksReady) {
    return { skipped: 'smtp_not_configured', sent: 0, failed: 0, reminders: [] };
  }
  const recipients = smtpReady ? getRecipients(db) : [];
  if (smtpReady && !recipients.length && !teamsReady && !webhooksReady) {
    return { skipped: 'no_recipients', sent: 0, failed: 0, reminders: [] };
  }
  const items = collectMaintenanceReminders(db, now);
  if (!items.length) return { skipped: 'nothing_due', sent: 0, failed: 0, reminders: [] };

  const organization = organizationName(db);
  const nowISO = now.toISOString();
  const nowMs = now.getTime();
  let sent = 0;
  let failed = 0;
  let teamsSent = 0;
  let teamsFailed = 0;
  let webhookSent = 0;
  let webhookFailed = 0;
  for (const item of items) {
    const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE dedupe_key = ?').get(item.dedupeKey);
    if (smtpReady && recipients.length && deliveryIsDue(delivery, nowMs)) {
      upsertPending(db, item, nowISO);
      try {
        await sendMail({
          config,
          to: recipients,
          event: 'maintenance',
          subject: `[${organization}] ${item.subject}`,
          text: [
            item.text,
            '',
            'Diese Nachricht wurde automatisch vom AWO Fuhrparkmanagement erzeugt.'
          ].join('\n'),
          transportFactory: options.transportFactory
        });
        db.prepare(`
          UPDATE notification_deliveries
          SET status = 'sent', error_code = NULL, last_attempt_at = ?, updated_at = ?
          WHERE dedupe_key = ?
        `).run(nowISO, nowISO, item.dedupeKey);
        writeAudit(db, {
          userId: null,
          action: 'maintenance_notification',
          entityType: 'vehicle',
          entityId: item.vehicleId,
          details: { kind: item.kind, status: 'sent', recipients: recipients.length }
        });
        sent += 1;
      } catch (error) {
        const code = sanitizeSmtpError(error);
        db.prepare(`
          UPDATE notification_deliveries
          SET status = 'failed', error_code = ?, last_attempt_at = ?, updated_at = ?
          WHERE dedupe_key = ?
        `).run(code, nowISO, nowISO, item.dedupeKey);
        logger.warn('Wartungs-Benachrichtigung konnte nicht versendet werden.', { error, errorCode: code });
        writeAudit(db, {
          userId: null,
          action: 'maintenance_notification',
          entityType: 'vehicle',
          entityId: item.vehicleId,
          details: { kind: item.kind, status: 'failed', errorCode: code, recipients: recipients.length }
        });
        failed += 1;
      }
    }

    if (teamsReady) {
      const teamResult = await deliverTeams(db, {
        dedupeKey: item.dedupeKey,
        title: `[${organization}] ${item.subject}`,
        text: item.text,
        summary: item.subject,
        kind: item.kind,
        entityType: 'vehicle',
        entityId: item.vehicleId,
        vehicleId: item.vehicleId,
        now,
        fetchImpl: options.teamsFetch
      });
      teamsSent += teamResult.sent || 0;
      teamsFailed += teamResult.failed || 0;
    }

    if (webhooksReady) {
      const webhookResult = await dispatchWebhooks(db, 'maintenance', {
        dedupeKey: item.dedupeKey,
        vehicleId: item.vehicleId,
        kind: item.kind,
        title: `[${organization}] ${item.subject}`,
        text: item.text,
        data: {
          vehicle: { id: item.vehicleId, name: item.vehicleName, plate: item.plate },
          kind: item.kind,
          dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : null
        }
      }, {
        dataDir,
        now,
        actorId: null,
        fetchImpl: options.webhookFetch,
        lookupImpl: options.webhookLookup
      });
      webhookSent += webhookResult.sent || 0;
      webhookFailed += webhookResult.failed || 0;
    }
  }
  return {
    skipped: null,
    sent,
    failed,
    teamsSent,
    teamsFailed,
    webhookSent,
    webhookFailed,
    reminders: items.map((item) => item.dedupeKey)
  };
}

function schedulerDisabled(db) {
  if (process.env.NODE_ENV === 'test') return true;
  return !getReminderSchedulerConfig(db).enabled;
}

function runSafely(db, options) {
  return runMaintenanceNotifications(db, options)
    .then((summary) => {
      if (summary.sent || summary.failed) {
        logger.info('Wartungs-Erinnerungen abgeschlossen.', { sent: summary.sent, failed: summary.failed });
      }
      return summary;
    })
    .catch((error) => {
      logger.error('Wartungs-Erinnerungen fehlgeschlagen.', { error });
      return null;
    });
}

function startMaintenanceReminderScheduler(db, options = {}) {
  if (schedulerDisabled(db)) return null;
  const config = getReminderSchedulerConfig(db);
  const initialDelay = Math.max(0, Number(options.initialDelayMs ?? config.initialDelayMs));
  const intervalMs = Math.max(60000, Number(options.intervalMs ?? config.intervalMs));
  const initialTimer = setTimeout(() => runSafely(db, options), initialDelay);
  initialTimer.unref?.();
  const intervalTimer = setInterval(() => runSafely(db, options), intervalMs);
  intervalTimer.unref?.();
  return {
    stop() {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    }
  };
}

module.exports = {
  THRESHOLDS,
  daysUntil,
  thresholdFor,
  collectMaintenanceReminders,
  getRecipients,
  runMaintenanceNotifications,
  startMaintenanceReminderScheduler
};
