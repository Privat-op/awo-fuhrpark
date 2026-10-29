'use strict';

const crypto = require('node:crypto');
const { writeAudit } = require('./audit');
const {
  defaultDataDir,
  loadSmtpConfig,
  sendMail,
  sanitizeSmtpError,
  validateSmtpConfig
} = require('./smtp');
const { teamsConfigured, deliverTeams } = require('./teams');
const { getTeamsIntegrationConfig, getLeasingSchedulerConfig } = require('./integrations');
const { dispatchWebhooks, webhooksConfiguredForEvent } = require('./webhooks');

const KM_THRESHOLDS = [80, 90, 100];
const END_THRESHOLDS = [90, 30];
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const PENDING_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const numberFormat = new Intl.NumberFormat('de-DE');

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const from = Date.parse(`${fromISO}T00:00:00`);
  const to = Date.parse(`${toISO}T00:00:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function leasingTerm(vehicle) {
  if (!vehicle) return null;
  const start = vehicle.leasing_start ? String(vehicle.leasing_start).slice(0, 10) : null;
  const end = vehicle.leasing_end ? String(vehicle.leasing_end).slice(0, 10) : null;
  const kmLimit = numberOrNull(vehicle.leasing_km_limit);
  const startKm = numberOrNull(vehicle.leasing_start_km);
  if (!end && !(kmLimit && kmLimit > 0)) return null;
  return {
    start,
    end,
    startKm: startKm === null ? 0 : Math.max(0, startKm),
    kmLimit: kmLimit && kmLimit > 0 ? kmLimit : null
  };
}

function calculateLeasingState(vehicle, now = new Date()) {
  const term = leasingTerm(vehicle);
  if (!term) return null;
  const mileage = Math.max(0, Number(vehicle?.mileage) || 0);
  const usedKm = term.kmLimit ? Math.max(0, mileage - term.startKm) : null;
  const remainingKm = term.kmLimit ? term.kmLimit - usedKm : null;
  const percent = term.kmLimit ? Math.round((usedKm / term.kmLimit) * 1000) / 10 : null;
  const kmLevel = percent === null
    ? 0
    : percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 80 ? 80 : 0;
  const daysRemaining = term.end ? daysBetween(isoDate(now), term.end) : null;
  const endLevel = daysRemaining === null
    ? 0
    : daysRemaining < 0 ? 'expired' : daysRemaining <= 30 ? 30 : daysRemaining <= 90 ? 90 : 0;

  const warnings = [];
  if (kmLevel) {
    const severity = kmLevel >= 100 ? 'danger' : 'warning';
    const title = kmLevel >= 100
      ? 'Leasing-Kilometerlimit überschritten'
      : `Leasing-Kilometerlimit zu ${kmLevel} % erreicht`;
    const text = kmLevel >= 100
      ? `${vehicle.name}: ${numberFormat.format(usedKm)} von ${numberFormat.format(term.kmLimit)} km verbraucht (${numberFormat.format(Math.abs(remainingKm))} km über dem Limit).`
      : `${vehicle.name}: ${numberFormat.format(usedKm)} von ${numberFormat.format(term.kmLimit)} km verbraucht, ${numberFormat.format(remainingKm)} km Rest.`;
    warnings.push({ key: `km_${kmLevel}`, kind: 'km', level: kmLevel, severity, title, text });
  }
  if (endLevel) {
    const severity = endLevel === 30 || endLevel === 'expired' ? 'danger' : 'warning';
    const title = endLevel === 'expired' ? 'Leasingende überschritten' : `Leasingende in ${daysRemaining} Tagen`;
    const text = endLevel === 'expired'
      ? `${vehicle.name}: Leasingvertrag ist seit ${Math.abs(daysRemaining)} ${Math.abs(daysRemaining) === 1 ? 'Tag' : 'Tagen'} abgelaufen (${term.end}).`
      : `${vehicle.name}: Leasingvertrag endet am ${term.end} (${daysRemaining} ${daysRemaining === 1 ? 'Tag' : 'Tage'}).`;
    warnings.push({ key: `end_${endLevel}`, kind: 'end', level: endLevel, severity, title, text });
  }

  let status = 'ok';
  if (kmLevel >= 100 || endLevel === 30 || endLevel === 'expired') status = 'critical';
  else if (kmLevel >= 80 || endLevel === 90) status = 'warning';

  return {
    start: term.start,
    end: term.end,
    startKm: term.startKm,
    kmLimit: term.kmLimit,
    usedKm,
    remainingKm,
    percent,
    kmLevel,
    daysRemaining,
    endLevel,
    status,
    warnings
  };
}

function leasingWarningForVehicle(vehicle, now = new Date()) {
  const state = calculateLeasingState(vehicle, now);
  if (!state || !state.warnings.length) return null;
  return state.warnings.map((warning) => warning.text).join(' ');
}

function termHash(state) {
  return crypto.createHash('sha256')
    .update([state.start || '', state.end || '', state.startKm || 0, state.kmLimit || 0].join('|'))
    .digest('hex')
    .slice(0, 16);
}

function collectLeasingNotifications(db, now = new Date()) {
  const rows = db.prepare(`
    SELECT * FROM vehicles
    WHERE leasing_end IS NOT NULL OR leasing_km_limit IS NOT NULL
    ORDER BY name, id
  `).all();
  const notifications = [];
  for (const row of rows) {
    const state = calculateLeasingState(row, now);
    if (!state) continue;
    const hash = termHash(state);
    if (state.kmLevel) {
      const warning = state.warnings.find((entry) => entry.kind === 'km');
      notifications.push({
        vehicleId: row.id,
        vehicleName: row.name,
        plate: row.plate,
        kind: `km_${state.kmLevel}`,
        severity: warning?.severity || 'warning',
        dedupeKey: `leasing:${row.id}:km:${state.kmLevel}:${hash}`,
        subject: `Leasing-Warnung: ${headerSafe(row.name)} (${headerSafe(row.plate)}) bei ${state.percent} %`,
        text: warning?.text || ''
      });
    }
    if (state.endLevel) {
      const warning = state.warnings.find((entry) => entry.kind === 'end');
      const kind = state.endLevel === 'expired' ? 'end_expired' : `end_${state.endLevel}`;
      notifications.push({
        vehicleId: row.id,
        vehicleName: row.name,
        plate: row.plate,
        kind,
        severity: warning?.severity || 'warning',
        dedupeKey: `leasing:${row.id}:end:${kind}:${hash}`,
        subject: state.endLevel === 'expired'
          ? `Leasingende überschritten: ${headerSafe(row.name)} (${headerSafe(row.plate)})`
          : `Leasingende in ${state.daysRemaining} Tagen: ${headerSafe(row.name)} (${headerSafe(row.plate)})`,
        text: warning?.text || ''
      });
    }
  }
  return notifications;
}

function getLeasingRecipients(db) {
  const rows = db.prepare(`
    SELECT email FROM users
    WHERE active = 1
      AND role IN ('admin', 'manager')
      AND anonymized_at IS NULL
      AND email <> ''
    ORDER BY role DESC, email
  `).all();
  return [...new Set(rows
    .map((row) => String(row.email || '').trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

function headerSafe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

function getOrganizationName(db) {
  const row = db.prepare('SELECT org_name FROM settings WHERE id = 1').get();
  return row?.org_name || 'Fuhrpark';
}

function upsertPending(db, notification, nowISO) {
  db.prepare(`
    INSERT INTO notification_deliveries
      (dedupe_key, channel, vehicle_id, kind, status, attempts, last_attempt_at, created_at, updated_at)
    VALUES (?, 'email', ?, ?, 'pending', 1, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      status = 'pending',
      attempts = notification_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(notification.dedupeKey, notification.vehicleId, notification.kind, nowISO, nowISO, nowISO);
}

function deliveryIsDue(delivery, nowMs) {
  if (!delivery) return true;
  if (delivery.status === 'sent') return false;
  const lastAttempt = Date.parse(delivery.last_attempt_at || delivery.updated_at || '');
  if (delivery.status === 'pending' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < PENDING_TIMEOUT_MS) return false;
  if (delivery.status === 'failed') {
    if (Number(delivery.attempts) >= MAX_ATTEMPTS) return false;
    if (Number.isFinite(lastAttempt) && nowMs - lastAttempt < RETRY_AFTER_MS) return false;
  }
  return true;
}

async function runLeasingNotifications(db, options = {}) {
  const dataDir = options.dataDir || defaultDataDir();
  const now = options.now || new Date();
  const config = loadSmtpConfig(db, { dataDir });
  const smtpReady = config.enabled && validateSmtpConfig(config, { requireEnabled: true }).length === 0;
  const teamsReady = teamsConfigured(db) && getTeamsIntegrationConfig(db).sendLeasing;
  const webhooksReady = webhooksConfiguredForEvent(db, 'leasing');
  if (!smtpReady && !teamsReady && !webhooksReady) {
    return { skipped: 'smtp_not_configured', sent: 0, failed: 0, notifications: [] };
  }
  const recipients = smtpReady ? getLeasingRecipients(db) : [];
  if (smtpReady && !recipients.length && !teamsReady && !webhooksReady) {
    return { skipped: 'no_recipients', sent: 0, failed: 0, notifications: [] };
  }
  const notifications = collectLeasingNotifications(db, now);
  if (!notifications.length) {
    return { skipped: 'nothing_due', sent: 0, failed: 0, notifications: [] };
  }

  const organization = headerSafe(getOrganizationName(db));
  const nowMs = Date.now();
  const nowISO = new Date().toISOString();
  let sent = 0;
  let failed = 0;
  let teamsSent = 0;
  let teamsFailed = 0;
  let webhookSent = 0;
  let webhookFailed = 0;

  for (const notification of notifications) {
    const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE dedupe_key = ?').get(notification.dedupeKey);
    if (smtpReady && recipients.length && deliveryIsDue(delivery, nowMs)) {
      upsertPending(db, notification, nowISO);
      try {
        await sendMail({
          config,
          to: recipients,
          subject: `[${organization}] ${notification.subject}`,
          text: [
            notification.text,
            '',
            'Diese Nachricht wurde automatisch vom AWO Fuhrparkmanagement erzeugt.',
            'Bitte prüfen Sie die Leasingdaten im Fahrzeugdatensatz.'
          ].join('\n'),
          transportFactory: options.transportFactory
        });
        db.prepare(`
          UPDATE notification_deliveries
          SET status = 'sent', error_code = NULL, last_attempt_at = ?, updated_at = ?
          WHERE dedupe_key = ?
        `).run(nowISO, nowISO, notification.dedupeKey);
        writeAudit(db, {
          userId: null,
          action: 'leasing_notification',
          entityType: 'vehicle',
          entityId: notification.vehicleId,
          details: { kind: notification.kind, status: 'sent', recipients: recipients.length }
        });
        sent += 1;
      } catch (error) {
        const code = sanitizeSmtpError(error);
        db.prepare(`
          UPDATE notification_deliveries
          SET status = 'failed', error_code = ?, last_attempt_at = ?, updated_at = ?
          WHERE dedupe_key = ?
        `).run(code, nowISO, nowISO, notification.dedupeKey);
        console.warn(`Leasing-Benachrichtigung konnte nicht versendet werden (${code}).`);
        writeAudit(db, {
          userId: null,
          action: 'leasing_notification',
          entityType: 'vehicle',
          entityId: notification.vehicleId,
          details: { kind: notification.kind, status: 'failed', errorCode: code, recipients: recipients.length }
        });
        failed += 1;
      }
    }

    if (teamsReady) {
      const teamResult = await deliverTeams(db, {
        dedupeKey: notification.dedupeKey,
        title: `[${organization}] ${notification.subject}`,
        text: notification.text,
        summary: notification.subject,
        kind: notification.kind,
        entityType: 'vehicle',
        entityId: notification.vehicleId,
        vehicleId: notification.vehicleId,
        now,
        fetchImpl: options.teamsFetch
      });
      teamsSent += teamResult.sent || 0;
      teamsFailed += teamResult.failed || 0;
    }

    if (webhooksReady) {
      const webhookResult = await dispatchWebhooks(db, 'leasing', {
        dedupeKey: notification.dedupeKey,
        vehicleId: notification.vehicleId,
        kind: notification.kind,
        title: `[${organization}] ${notification.subject}`,
        text: notification.text,
        data: {
          vehicle: { id: notification.vehicleId, name: notification.vehicleName, plate: notification.plate },
          kind: notification.kind,
          severity: notification.severity || null
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
    notifications: notifications.map((notification) => notification.dedupeKey)
  };
}

function schedulerDisabled(db) {
  return !getLeasingSchedulerConfig(db).enabled;
}

function runSafely(db, options) {
  return runLeasingNotifications(db, options)
    .then((summary) => {
      if (summary.sent || summary.failed) {
        console.log(`Leasing-Prüfung: ${summary.sent} Benachrichtigung(en) versendet, ${summary.failed} fehlgeschlagen.`);
      }
      return summary;
    })
    .catch((error) => {
      console.warn('Leasing-Prüfung fehlgeschlagen:', error.message);
      return null;
    });
}

function startLeasingScheduler(db, options = {}) {
  const config = getLeasingSchedulerConfig(db);
  if (!config.enabled) return null;
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

let triggerTimer = null;

function triggerLeasingCheck(db, options = {}) {
  const config = getLeasingSchedulerConfig(db);
  if (!config.enabled) return;
  if (triggerTimer) clearTimeout(triggerTimer);
  const delay = Math.max(0, Number(options.debounceMs ?? config.debounceMs));
  triggerTimer = setTimeout(() => {
    triggerTimer = null;
    runSafely(db, options);
  }, delay);
  triggerTimer.unref?.();
}

module.exports = {
  KM_THRESHOLDS,
  END_THRESHOLDS,
  calculateLeasingState,
  leasingWarningForVehicle,
  collectLeasingNotifications,
  getLeasingRecipients,
  runLeasingNotifications,
  startLeasingScheduler,
  triggerLeasingCheck
};
