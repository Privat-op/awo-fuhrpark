'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { writeAudit } = require('./audit');
const {
  loadSmtpConfig,
  sendMail,
  sanitizeSmtpError,
  validateSmtpConfig
} = require('./smtp');
const { getAppBaseUrl } = require('./integrations');

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const MIN_PASSWORD_LENGTH = 10;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function headerSafe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

function organizationName(db) {
  return db.prepare('SELECT org_name FROM settings WHERE id = 1').get()?.org_name || 'Fuhrpark';
}

function findResetUser(db, email) {
  return db.prepare(`
    SELECT id, email, name, role
    FROM users
    WHERE email = ? COLLATE NOCASE
      AND active = 1
      AND anonymized_at IS NULL
      AND role <> 'superadmin'
      AND id <> 'superadmin'
  `).get(normalizeEmail(email)) || null;
}

function getResetToken(db, token, now = new Date()) {
  return db.prepare(`
    SELECT t.*, u.email, u.name, u.active, u.anonymized_at, u.role
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
      AND t.used_at IS NULL
      AND t.expires_at > ?
  `).get(hashToken(token), now.toISOString()) || null;
}

function validatePasswordResetToken(db, token, { now = new Date() } = {}) {
  const row = getResetToken(db, token, now);
  if (!row || !row.active || row.anonymized_at || row.role === 'superadmin' || row.user_id === 'superadmin') {
    return { valid: false };
  }
  return {
    valid: true,
    user: { id: row.user_id, email: row.email, name: row.name },
    tokenId: row.id
  };
}

async function requestPasswordReset(db, {
  email,
  dataDir,
  baseUrl,
  now = new Date(),
  transportFactory,
  logger = console
} = {}) {
  const user = findResetUser(db, email);
  if (!user) return { requested: false, sent: false };

  const nowISO = now.toISOString();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?').run(nowISO);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);
    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), user.id, hashToken(token), expiresAt, nowISO);
  })();
  writeAudit(db, {
    userId: user.id,
    action: 'password_reset_requested',
    entityType: 'user',
    entityId: user.id
  });

  const config = loadSmtpConfig(db, { dataDir });
  if (!config.enabled || validateSmtpConfig(config, { requireEnabled: true }).length) {
    logger.warn('Passwort-Reset-Mail nicht versendet: SMTP ist nicht konfiguriert.');
    return { requested: true, sent: false };
  }

  const origin = String(baseUrl || getAppBaseUrl(db) || 'http://localhost').replace(/\/+$/, '');
  const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  const organization = headerSafe(organizationName(db));
  try {
    await sendMail({
      config,
      to: user.email,
      event: 'password_reset',
      subject: `[${organization}] Passwort zurücksetzen`,
      text: [
        `Guten Tag ${user.name},`,
        '',
        'für Ihr Konto wurde ein Passwort-Reset angefordert.',
        'Öffnen Sie den folgenden Link, um ein neues Passwort zu setzen:',
        '',
        link,
        '',
        'Der Link ist 60 Minuten gültig und kann nur einmal verwendet werden.',
        'Wenn Sie den Reset nicht angefordert haben, ignorieren Sie diese Nachricht.',
        '',
        'AWO Fuhrparkmanagement'
      ].join('\n'),
      transportFactory
    });
    return { requested: true, sent: true };
  } catch (error) {
    logger.warn('Passwort-Reset-Mail konnte nicht versendet werden:', sanitizeSmtpError(error));
    return { requested: true, sent: false };
  }
}

function resetPasswordWithToken(db, token, newPassword, { now = new Date() } = {}) {
  const value = String(newPassword || '');
  if (value.length < MIN_PASSWORD_LENGTH || value.length > 200) {
    return { ok: false, reason: 'weak_password' };
  }
  const nowISO = now.toISOString();
  const passwordHash = bcrypt.hashSync(value, 12);
  let result = { ok: false, reason: 'invalid' };

  db.transaction(() => {
    const row = getResetToken(db, token, now);
    if (!row || !row.active || row.anonymized_at || row.role === 'superadmin' || row.user_id === 'superadmin') {
      return;
    }
    const updated = db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND active = 1')
      .run(passwordHash, nowISO, row.user_id).changes;
    if (updated !== 1) return;
    const consumed = db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .run(nowISO, row.id).changes;
    if (consumed !== 1) return;
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?').run(row.user_id, row.id);
    const sessionsEnded = db.prepare(`
      DELETE FROM sessions
      WHERE json_extract(sess, '$.userId') = ?
         OR json_extract(sess, '$.mfaPendingUserId') = ?
    `).run(row.user_id, row.user_id).changes;
    writeAudit(db, {
      userId: row.user_id,
      action: 'password_reset_completed',
      entityType: 'user',
      entityId: row.user_id,
      details: { sessionsEnded }
    });
    result = { ok: true, userId: row.user_id, sessionsEnded };
  })();

  return result;
}

module.exports = {
  TOKEN_TTL_MS,
  TOKEN_BYTES,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  hashToken,
  generateToken,
  validatePasswordResetToken,
  requestPasswordReset,
  resetPasswordWithToken
};
