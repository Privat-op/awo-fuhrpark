'use strict';

const { writeAudit } = require('./audit');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_FIELDS = [
  ['audit', 'audit_retention_days'],
  ['sessions', 'session_retention_days'],
  ['passwordResets', 'password_reset_retention_days'],
  ['notifications', 'notification_retention_days']
];

function getRetentionSettings(db) {
  const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() || {};
  return {
    auditRetentionDays: Number(row.audit_retention_days) || 0,
    sessionRetentionDays: Number(row.session_retention_days) || 0,
    passwordResetRetentionDays: Number(row.password_reset_retention_days) || 0,
    notificationRetentionDays: Number(row.notification_retention_days) || 0
  };
}

function setRetentionSettings(db, values) {
  db.prepare(`
    UPDATE settings
    SET audit_retention_days = ?, session_retention_days = ?,
      password_reset_retention_days = ?, notification_retention_days = ?,
      updated_at = ?
    WHERE id = 1
  `).run(
    values.auditRetentionDays,
    values.sessionRetentionDays,
    values.passwordResetRetentionDays,
    values.notificationRetentionDays,
    new Date().toISOString()
  );
  return getRetentionSettings(db);
}

function cutoff(days, now) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function countAndMaybeDelete(db, sqlCount, sqlDelete, params, dryRun) {
  const count = Number(db.prepare(sqlCount).get(...params).count) || 0;
  if (count && !dryRun) db.prepare(sqlDelete).run(...params);
  return count;
}

function runRetention(db, { now = new Date(), dryRun = false, settings = null } = {}) {
  const values = settings || getRetentionSettings(db);
  const counts = { audit: 0, sessions: 0, passwordResets: 0, notifications: 0 };

  if (values.auditRetentionDays > 0) {
    const value = cutoff(values.auditRetentionDays, now);
    counts.audit = countAndMaybeDelete(
      db,
      'SELECT COUNT(*) AS count FROM audit_logs WHERE datetime(created_at) < datetime(?)',
      'DELETE FROM audit_logs WHERE datetime(created_at) < datetime(?)',
      [value],
      dryRun
    );
  }
  if (values.sessionRetentionDays > 0) {
    const value = now.getTime() - values.sessionRetentionDays * DAY_MS;
    counts.sessions = countAndMaybeDelete(
      db,
      'SELECT COUNT(*) AS count FROM sessions WHERE expire < ?',
      'DELETE FROM sessions WHERE expire < ?',
      [value],
      dryRun
    );
  }
  if (values.passwordResetRetentionDays > 0) {
    const value = cutoff(values.passwordResetRetentionDays, now);
    counts.passwordResets = countAndMaybeDelete(
      db,
      'SELECT COUNT(*) AS count FROM password_reset_tokens WHERE datetime(created_at) < datetime(?)',
      'DELETE FROM password_reset_tokens WHERE datetime(created_at) < datetime(?)',
      [value],
      dryRun
    );
  }
  if (values.notificationRetentionDays > 0) {
    const value = cutoff(values.notificationRetentionDays, now);
    counts.notifications = countAndMaybeDelete(
      db,
      'SELECT COUNT(*) AS count FROM notification_deliveries WHERE datetime(created_at) < datetime(?)',
      'DELETE FROM notification_deliveries WHERE datetime(created_at) < datetime(?)',
      [value],
      dryRun
    );
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (dryRun || total > 0) {
    writeAudit(db, {
      userId: null,
      action: 'retention_cleanup',
      entityType: 'system',
      entityId: '1',
      details: { dryRun, ...counts }
    });
  }
  return { dryRun, counts, total };
}

function schedulerDisabled() {
  if (process.env.NODE_ENV === 'test') return true;
  return String(process.env.RETENTION_SCHEDULER_DISABLED || '').toLowerCase() === 'true';
}

function runSafely(db, options) {
  try {
    const result = runRetention(db, options);
    if (result.total) console.log(`Retention: ${result.total} technische Datensätze bereinigt.`);
    return result;
  } catch (error) {
    console.warn('Retention-Lauf fehlgeschlagen:', error.message);
    return null;
  }
}

function startRetentionScheduler(db, options = {}) {
  if (schedulerDisabled()) return null;
  const initialDelay = Math.max(0, Number(options.initialDelayMs ?? process.env.RETENTION_INITIAL_DELAY_MS ?? 10000));
  const intervalMs = Math.max(60000, Number(options.intervalMs ?? process.env.RETENTION_INTERVAL_MS ?? DAY_MS));
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
  DAY_MS,
  RETENTION_FIELDS,
  getRetentionSettings,
  setRetentionSettings,
  runRetention,
  startRetentionScheduler
};
