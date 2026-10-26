'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { writeAudit } = require('./audit');
const { HttpError, isoNow } = require('./validation');

function scrubAuditDetails(details) {
  if (!details) return details;
  try {
    const parsed = JSON.parse(details);
    const scrub = (value) => {
      if (Array.isArray(value)) return value.map(scrub);
      if (!value || typeof value !== 'object') return value;
      const result = {};
      Object.entries(value).forEach(([key, entry]) => {
        if (/email/i.test(key)) return;
        result[key] = scrub(entry);
      });
      return result;
    };
    return JSON.stringify(scrub(parsed));
  } catch {
    return details;
  }
}

function anonymizeUser(userId, { actorId = null, reason = 'manual' } = {}) {
  return db.transaction(() => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new HttpError(404, 'Benutzerkonto wurde nicht gefunden.');
    if (user.active) throw new HttpError(409, 'Nur deaktivierte Konten können anonymisiert werden.');
    if (user.anonymized_at) throw new HttpError(409, 'Dieses Konto wurde bereits anonymisiert.');

    const now = isoNow();
    const anonymizedEmail = `anonymized-${user.id}@local.invalid`;
    const randomPassword = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
    db.prepare(`
      UPDATE users SET
        email = ?, name = ?, password_hash = ?, active = 0, last_login_at = NULL,
        deactivated_at = COALESCE(deactivated_at, updated_at), anonymized_at = ?, updated_at = ?
      WHERE id = ?
    `).run(anonymizedEmail, 'Anonymisiertes Konto', randomPassword, now, now, user.id);

    db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(user.id);
    db.prepare('DELETE FROM notification_reads WHERE user_id = ?').run(user.id);

    const auditRows = db.prepare(`
      SELECT id, details FROM audit_logs
      WHERE user_id = ? OR (entity_type = 'user' AND entity_id = ?)
    `).all(user.id, user.id);
    const updateAudit = db.prepare('UPDATE audit_logs SET details = ? WHERE id = ?');
    auditRows.forEach((row) => updateAudit.run(scrubAuditDetails(row.details), row.id));

    writeAudit(db, {
      userId: actorId,
      action: 'anonymize',
      entityType: 'user',
      entityId: user.id,
      details: { reason }
    });

    return { id: user.id };
  })();
}

function getAutoAnonymizeDays() {
  const settings = db.prepare('SELECT auto_anonymize_days FROM settings WHERE id = 1').get();
  return Math.max(0, Number(settings?.auto_anonymize_days) || 0);
}

function getAutoAnonymizeCandidates() {
  const days = getAutoAnonymizeDays();
  if (!days) return [];
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT id FROM users
    WHERE active = 0
      AND anonymized_at IS NULL
      AND deactivated_at IS NOT NULL
      AND deactivated_at <= ?
  `).all(cutoff);
}

function runAutoAnonymization() {
  const candidates = getAutoAnonymizeCandidates();
  let anonymized = 0;
  for (const candidate of candidates) {
    try {
      anonymizeUser(candidate.id, { actorId: null, reason: 'auto_after_inactivity' });
      anonymized += 1;
    } catch (error) {
      console.warn('Automatische Anonymisierung fehlgeschlagen:', error.message);
    }
  }
  if (anonymized > 0) console.log(`${anonymized} deaktivierte Konten automatisch anonymisiert.`);
  return anonymized;
}

function startAutoAnonymizer() {
  runAutoAnonymization();
  const timer = setInterval(runAutoAnonymization, 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = {
  anonymizeUser,
  runAutoAnonymization,
  startAutoAnonymizer,
  getAutoAnonymizeDays
};
