'use strict';

const crypto = require('node:crypto');
const { verifyTotp } = require('./totp');
const { decryptSecret, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } = require('./mfa-crypto');

const MAX_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

function getMfaRow(db, userId) {
  return db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) || null;
}

function isTotpEnabled(row) {
  return Number(row?.totp_enabled) === 1;
}

function lockRemainingMs(row, now = Date.now()) {
  if (!row?.locked_until) return 0;
  const until = Date.parse(row.locked_until);
  return Number.isFinite(until) ? Math.max(0, until - now) : 0;
}

function isLocked(row, now = Date.now()) {
  return lockRemainingMs(row, now) > 0;
}

function registerFailure(db, userId, now = new Date()) {
  const row = getMfaRow(db, userId);
  if (!row) return { attempts: 0, lockedUntil: null, justLocked: false };
  const previousAttempts = Number(row.failed_attempts) || 0;
  const lastFailure = Date.parse(row.updated_at);
  const withinWindow = Number.isFinite(lastFailure) && (now.getTime() - lastFailure) <= FAILURE_WINDOW_MS;
  const attempts = (previousAttempts > 0 && withinWindow ? previousAttempts : 0) + 1;
  const alreadyLocked = isLocked(row, now.getTime());
  if (attempts >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
    db.prepare(`
      UPDATE user_mfa
      SET failed_attempts = 0, locked_until = ?, updated_at = ?
      WHERE user_id = ?
    `).run(lockedUntil, now.toISOString(), userId);
    return { attempts: 0, lockedUntil, justLocked: !alreadyLocked };
  }
  db.prepare('UPDATE user_mfa SET failed_attempts = ?, updated_at = ? WHERE user_id = ?')
    .run(attempts, now.toISOString(), userId);
  return { attempts, lockedUntil: row.locked_until || null, justLocked: false };
}

function clearFailures(db, userId, now = new Date()) {
  db.prepare(`
    UPDATE user_mfa
    SET failed_attempts = 0, locked_until = NULL, last_verified_at = ?, updated_at = ?
    WHERE user_id = ?
  `).run(now.toISOString(), now.toISOString(), userId);
}

function verifyTotpForUser(db, row, code, { now = new Date(), dataDir, allowPending = false } = {}) {
  if (!row?.totp_secret_enc) return { valid: false, reason: 'not_configured' };
  if (!allowPending && !isTotpEnabled(row)) return { valid: false, reason: 'not_enabled' };
  if (isLocked(row, now.getTime())) {
    return { valid: false, reason: 'locked', lockedUntil: row.locked_until };
  }
  let secret;
  try {
    secret = decryptSecret(row.totp_secret_enc, row.user_id, { dataDir });
  } catch {
    return { valid: false, reason: 'configuration' };
  }
  const result = verifyTotp(secret, code, {
    now: now.getTime(),
    lastUsedStep: row.totp_last_used_step
  });
  if (!result.valid) {
    const failure = registerFailure(db, row.user_id, now);
    return {
      valid: false,
      reason: result.replay ? 'replay' : 'invalid',
      attempts: failure.attempts,
      lockedUntil: failure.lockedUntil,
      justLocked: failure.justLocked
    };
  }
  clearFailures(db, row.user_id, now);
  db.prepare(`
    UPDATE user_mfa
    SET totp_last_used_step = ?, last_verified_at = ?, updated_at = ?
    WHERE user_id = ?
  `).run(result.step, now.toISOString(), now.toISOString(), row.user_id);
  return { valid: true, step: result.step };
}

function verifyRecoveryForUser(db, userId, code, { now = new Date(), dataDir } = {}) {
  const row = getMfaRow(db, userId);
  if (!row) return { valid: false, reason: 'not_configured' };
  if (!isTotpEnabled(row)) return { valid: false, reason: 'not_enabled' };
  if (isLocked(row, now.getTime())) {
    return { valid: false, reason: 'locked', lockedUntil: row.locked_until };
  }
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) {
    const failure = registerFailure(db, userId, now);
    return { valid: false, reason: 'invalid', ...failure };
  }
  const hash = hashRecoveryCode(normalized, { dataDir });
  const recovery = db.prepare(`
    SELECT * FROM mfa_recovery_codes
    WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
  `).get(userId, hash);
  if (!recovery) {
    const failure = registerFailure(db, userId, now);
    return { valid: false, reason: 'invalid', ...failure };
  }
  const changed = db.prepare('UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(now.toISOString(), recovery.id).changes;
  if (changed !== 1) {
    const failure = registerFailure(db, userId, now);
    return { valid: false, reason: 'invalid', ...failure };
  }
  clearFailures(db, userId, now);
  db.prepare('UPDATE user_mfa SET last_verified_at = ?, updated_at = ? WHERE user_id = ?')
    .run(now.toISOString(), now.toISOString(), userId);
  return { valid: true, method: 'recovery' };
}

function setPendingSecret(db, userId, encryptedSecret, now = new Date()) {
  db.prepare(`
    INSERT INTO user_mfa
      (user_id, totp_secret_enc, totp_enabled, totp_confirmed_at, totp_last_used_step, failed_attempts, locked_until, last_verified_at, created_at, updated_at)
    VALUES (?, ?, 0, NULL, NULL, 0, NULL, NULL, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      totp_secret_enc = excluded.totp_secret_enc,
      totp_enabled = 0,
      totp_confirmed_at = NULL,
      totp_last_used_step = NULL,
      failed_attempts = 0,
      locked_until = NULL,
      last_verified_at = NULL,
      updated_at = excluded.updated_at
  `).run(userId, encryptedSecret, now.toISOString(), now.toISOString());
}

function enableMfa(db, userId, step, now = new Date()) {
  db.prepare(`
    UPDATE user_mfa
    SET totp_enabled = 1, totp_confirmed_at = ?, totp_last_used_step = ?, failed_attempts = 0,
      locked_until = NULL, last_verified_at = ?, updated_at = ?
    WHERE user_id = ?
  `).run(now.toISOString(), step, now.toISOString(), now.toISOString(), userId);
}

function issueRecoveryCodes(db, userId, { dataDir, now = new Date(), count = RECOVERY_CODE_COUNT } = {}) {
  const codes = generateRecoveryCodes(count);
  const batchId = crypto.randomUUID();
  const insert = db.prepare(`
    INSERT INTO mfa_recovery_codes (id, user_id, code_hash, batch_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
    for (const code of codes) {
      insert.run(crypto.randomUUID(), userId, hashRecoveryCode(code, { dataDir }), batchId, now.toISOString());
    }
  })();
  return codes;
}

function disableMfa(db, userId) {
  db.transaction(() => {
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
  })();
}

function resetMfa(db, userId) {
  disableMfa(db, userId);
}

function recoveryCodesRemaining(db, userId) {
  return db.prepare('SELECT COUNT(*) AS count FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .get(userId).count;
}

function securityStatus(db, userId) {
  const row = getMfaRow(db, userId);
  return {
    totpEnabled: isTotpEnabled(row),
    confirmedAt: row?.totp_confirmed_at || null,
    lastVerifiedAt: row?.last_verified_at || null,
    recoveryCodesRemaining: recoveryCodesRemaining(db, userId),
    lockedUntil: row?.locked_until || null
  };
}

function deleteUserSessions(db, userId) {
  return db.prepare(`
    DELETE FROM sessions
    WHERE json_extract(sess, '$.userId') = ?
       OR json_extract(sess, '$.mfaPendingUserId') = ?
  `).run(userId, userId).changes;
}

module.exports = {
  MAX_ATTEMPTS,
  FAILURE_WINDOW_MS,
  LOCK_MS,
  RECOVERY_CODE_COUNT,
  getMfaRow,
  isTotpEnabled,
  isLocked,
  lockRemainingMs,
  registerFailure,
  clearFailures,
  verifyTotpForUser,
  verifyRecoveryForUser,
  setPendingSecret,
  enableMfa,
  issueRecoveryCodes,
  disableMfa,
  resetMfa,
  recoveryCodesRemaining,
  securityStatus,
  deleteUserSessions
};
