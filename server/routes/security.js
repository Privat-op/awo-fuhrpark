'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { db, DATA_DIR } = require('../db');
const { HttpError } = require('../lib/validation');
const { writeAudit } = require('../lib/audit');
const { getRoleRank } = require('../lib/permissions');
const { generateTotpSecret, otpauthUri } = require('../lib/totp');
const { encryptSecret } = require('../lib/mfa-crypto');
const {
  getWebAuthnConfig,
  listPasskeys,
  countPasskeys,
  renamePasskey,
  removePasskey,
  deleteUserPasskeys,
  isPasskeyLocked,
  lockRemainingMs,
  registerPasskeyFailure,
  clearPasskeyFailures,
  storeRegistrationChallenge,
  takeRegistrationChallenge,
  buildRegistrationOptions,
  verifyRegistration
} = require('../lib/webauthn');
const {
  getMfaRow,
  isTotpEnabled,
  isLocked,
  verifyTotpForUser,
  verifyRecoveryForUser,
  setPendingSecret,
  enableMfa,
  issueRecoveryCodes,
  disableMfa,
  resetMfa,
  securityStatus,
  deleteUserSessions
} = require('../lib/mfa');

const router = express.Router();

function audit(req, action, details = null) {
  writeAudit(db, {
    userId: req.user.id,
    action,
    entityType: 'user',
    entityId: req.user.id,
    details
  });
}

function useRecoveryFrom(body) {
  return ['1', 'true', 'on'].includes(String(body?.useRecovery || '').toLowerCase());
}

function codeFromBody(body) {
  return String(body?.code || '').replace(/\s+/g, '');
}

function lockedResponse(res, row) {
  res.set('Cache-Control', 'no-store');
  return res.status(429).json({
    error: 'Zu viele MFA-Versuche. Bitte warten Sie, bevor Sie es erneut versuchen.',
    lockedUntil: row?.locked_until || null
  });
}

function auditFailure(req, result, { context, method }) {
  writeAudit(db, {
    userId: req.user.id,
    action: 'mfa_verify_failed',
    entityType: 'user',
    entityId: req.user.id,
    details: { context, method, reason: result.reason || 'invalid' }
  });
  if (result.justLocked) {
    writeAudit(db, {
      userId: req.user.id,
      action: 'mfa_locked',
      entityType: 'user',
      entityId: req.user.id,
      details: { context, method, lockedUntil: result.lockedUntil || null }
    });
  }
}

function failureResponse(req, res, result, row, context, method) {
  auditFailure(req, result, { context, method });
  if (result.reason === 'locked') return lockedResponse(res, row);
  if (result.justLocked) {
    res.set('Cache-Control', 'no-store');
    return res.status(429).json({
      error: 'Zu viele MFA-Versuche. Bitte warten Sie, bevor Sie es erneut versuchen.',
      lockedUntil: result.lockedUntil || null
    });
  }
  res.set('Cache-Control', 'no-store');
  return res.status(400).json({ error: 'Der Bestätigungscode ist nicht gültig.' });
}

function passkeyConfigOrNull(res) {
  const config = getWebAuthnConfig(db);
  if (!config.enabled) {
    res.set('Cache-Control', 'no-store').status(503).json({
      error: config.reason || 'Passkeys sind auf dieser Installation nicht konfiguriert.'
    });
    return null;
  }
  return config;
}

function passkeyLockedResponse(res, userId) {
  return res.set('Cache-Control', 'no-store').status(429).json({
    error: 'Zu viele Passkey-Versuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.',
    retryAfter: lockRemainingMs(db, userId)
  });
}

router.get('/', (req, res) => {
  const config = getWebAuthnConfig(db);
  res.set('Cache-Control', 'no-store');
  res.json({
    security: {
      ...securityStatus(db, req.user.id),
      passkeyEnabled: config.enabled,
      passkeyCount: countPasskeys(db, req.user.id)
    },
    passkeys: {
      enabled: config.enabled,
      items: listPasskeys(db, req.user.id)
    }
  });
});

router.post('/totp/enroll/start', (req, res, next) => {
  try {
    const existing = getMfaRow(db, req.user.id);
    if (isTotpEnabled(existing)) throw new HttpError(409, 'TOTP ist für dieses Konto bereits aktiviert.');
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, req.user.id, { dataDir: DATA_DIR });
    setPendingSecret(db, req.user.id, encrypted);
    const org = db.prepare('SELECT org_name FROM settings WHERE id = 1').get()?.org_name || 'Fuhrpark';
    const uri = otpauthUri({ secret, accountName: req.user.email, issuer: org });
    QRCode.toString(uri, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then((qrSvg) => {
        audit(req, 'mfa_enroll_started', { method: 'totp' });
        res.set('Cache-Control', 'no-store').json({ secret, otpauthUri: uri, qrSvg });
      })
      .catch(next);
  } catch (error) {
    next(error);
  }
});

router.post('/totp/enroll/confirm', (req, res, next) => {
  try {
    const row = getMfaRow(db, req.user.id);
    if (!row) throw new HttpError(400, 'Es läuft keine MFA-Einrichtung.');
    if (isTotpEnabled(row)) throw new HttpError(409, 'TOTP ist für dieses Konto bereits aktiviert.');
    if (isLocked(row)) {
      auditFailure(req, { reason: 'locked' }, { context: 'enroll', method: 'totp' });
      return lockedResponse(res, row);
    }
    const result = verifyTotpForUser(db, row, codeFromBody(req.body), {
      dataDir: DATA_DIR,
      allowPending: true
    });
    if (!result.valid) return failureResponse(req, res, result, row, 'enroll', 'totp');
    enableMfa(db, req.user.id, result.step);
    const recoveryCodes = issueRecoveryCodes(db, req.user.id, { dataDir: DATA_DIR });
    audit(req, 'mfa_enabled', { method: 'totp', recoveryCodes: recoveryCodes.length });
    res.set('Cache-Control', 'no-store').json({
      enabled: true,
      recoveryCodes,
      security: securityStatus(db, req.user.id)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/totp/disable', (req, res, next) => {
  try {
    const row = getMfaRow(db, req.user.id);
    if (!row || !isTotpEnabled(row)) throw new HttpError(400, 'Für dieses Konto ist kein TOTP aktiviert.');
    const useRecovery = useRecoveryFrom(req.body);
    const method = useRecovery ? 'recovery' : 'totp';
    if (isLocked(row)) {
      auditFailure(req, { reason: 'locked' }, { context: 'disable', method });
      return lockedResponse(res, row);
    }
    const result = useRecovery
      ? verifyRecoveryForUser(db, req.user.id, codeFromBody(req.body), { dataDir: DATA_DIR })
      : verifyTotpForUser(db, row, codeFromBody(req.body), { dataDir: DATA_DIR });
    if (!result.valid) return failureResponse(req, res, result, row, 'disable', method);
    if (useRecovery) audit(req, 'mfa_recovery_used', { context: 'disable' });
    disableMfa(db, req.user.id);
    audit(req, 'mfa_disabled', { method });
    res.set('Cache-Control', 'no-store').json({ enabled: false, security: securityStatus(db, req.user.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/recovery/regenerate', (req, res, next) => {
  try {
    const row = getMfaRow(db, req.user.id);
    if (!row || !isTotpEnabled(row)) throw new HttpError(400, 'Für dieses Konto ist kein TOTP aktiviert.');
    const useRecovery = useRecoveryFrom(req.body);
    const method = useRecovery ? 'recovery' : 'totp';
    if (isLocked(row)) {
      auditFailure(req, { reason: 'locked' }, { context: 'regenerate', method });
      return lockedResponse(res, row);
    }
    const result = useRecovery
      ? verifyRecoveryForUser(db, req.user.id, codeFromBody(req.body), { dataDir: DATA_DIR })
      : verifyTotpForUser(db, row, codeFromBody(req.body), { dataDir: DATA_DIR });
    if (!result.valid) return failureResponse(req, res, result, row, 'regenerate', method);
    if (useRecovery) audit(req, 'mfa_recovery_used', { context: 'regenerate' });
    const recoveryCodes = issueRecoveryCodes(db, req.user.id, { dataDir: DATA_DIR });
    audit(req, 'mfa_recovery_regenerated', { count: recoveryCodes.length });
    res.set('Cache-Control', 'no-store').json({
      recoveryCodes,
      security: securityStatus(db, req.user.id)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/passkeys/options', async (req, res, next) => {
  try {
    const config = passkeyConfigOrNull(res);
    if (!config) return;
    if (isPasskeyLocked(db, req.user.id)) return passkeyLockedResponse(res, req.user.id);
    const password = String(req.body?.password || '');
    if (!password) throw new HttpError(400, 'Bitte bestätigen Sie Ihr Passwort.');
    const valid = await bcrypt.compare(password, req.user.password_hash);
    if (!valid) {
      const failure = registerPasskeyFailure(db, req.user.id);
      if (failure.lockedUntil) return passkeyLockedResponse(res, req.user.id);
      throw new HttpError(400, 'Das Passwort ist nicht korrekt.');
    }
    const result = await buildRegistrationOptions(db, req.user, config);
    storeRegistrationChallenge(req, result.challenge, req.user.id);
    res.set('Cache-Control', 'no-store').json({ options: result.options });
  } catch (error) {
    next(error);
  }
});

router.post('/passkeys/verify', async (req, res, next) => {
  try {
    const config = passkeyConfigOrNull(res);
    if (!config) return;
    if (isPasskeyLocked(db, req.user.id)) return passkeyLockedResponse(res, req.user.id);
    const challenge = takeRegistrationChallenge(req, req.user.id);
    if (!challenge) throw new HttpError(400, 'Die Passkey-Einrichtung ist abgelaufen. Bitte starten Sie sie erneut.');
    const response = req.body?.response;
    if (!response || typeof response !== 'object') throw new HttpError(400, 'Der Passkey konnte nicht bestätigt werden.');

    let result;
    try {
      result = await verifyRegistration(db, req.user, response, challenge, config, req.body?.name);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const failure = registerPasskeyFailure(db, req.user.id);
      if (failure.lockedUntil) return passkeyLockedResponse(res, req.user.id);
      return res.status(400).json({ error: 'Der Passkey konnte nicht bestätigt werden.' });
    }
    if (!result.valid) {
      const failure = registerPasskeyFailure(db, req.user.id);
      if (failure.lockedUntil) return passkeyLockedResponse(res, req.user.id);
      return res.status(400).json({ error: 'Der Passkey konnte nicht bestätigt werden.' });
    }
    clearPasskeyFailures(db, req.user.id);
    audit(req, 'passkey_added', { name: result.passkey.name });
    res.set('Cache-Control', 'no-store').json({
      passkey: result.passkey,
      passkeys: listPasskeys(db, req.user.id)
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/passkeys/:id', (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Bitte geben Sie einen Namen für den Passkey an.');
    const passkey = renamePasskey(db, req.user.id, req.params.id, name);
    if (!passkey) throw new HttpError(404, 'Passkey wurde nicht gefunden.');
    audit(req, 'passkey_renamed', { name: passkey.name });
    res.set('Cache-Control', 'no-store').json({ passkey, passkeys: listPasskeys(db, req.user.id) });
  } catch (error) {
    next(error);
  }
});

router.delete('/passkeys/:id', (req, res, next) => {
  try {
    const passkey = removePasskey(db, req.user.id, req.params.id);
    if (!passkey) throw new HttpError(404, 'Passkey wurde nicht gefunden.');
    clearPasskeyFailures(db, req.user.id);
    audit(req, 'passkey_removed', { name: passkey.name });
    const sessionsEnded = deleteUserSessions(db, req.user.id);
    return req.session.destroy((error) => {
      if (error) console.warn('Passkey-Sitzung konnte nicht verworfen werden.');
      res.clearCookie('awo.sid');
      res.set('Cache-Control', 'no-store').json({ ok: true, loggedOut: true, sessionsEnded });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin-reset/:userId', (req, res, next) => {
  try {
    const actor = req.user;
    if (!['admin', 'superadmin'].includes(actor.role)) {
      throw new HttpError(403, 'MFA-Resets sind Administrator:innen und dem Superadmin vorbehalten.');
    }
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
    if (!target) throw new HttpError(404, 'Benutzerkonto wurde nicht gefunden.');
    if (target.id === actor.id && actor.role !== 'superadmin') {
      throw new HttpError(400, 'Das eigene MFA kann nicht über die Supportfunktion zurückgesetzt werden.');
    }
    if (actor.role !== 'superadmin') {
      if (target.role === 'admin' || target.role === 'superadmin') {
        throw new HttpError(403, 'Administrator- und Superadmin-Konten können nicht zurückgesetzt werden.');
      }
      if (getRoleRank(db, target.role) >= getRoleRank(db, actor.role)) {
        throw new HttpError(403, 'MFA kann nur für Konten mit strikt niedrigerem Rang zurückgesetzt werden.');
      }
    }
    const targetRow = getMfaRow(db, target.id);
    const passkeyCount = countPasskeys(db, target.id);
    if (!targetRow && passkeyCount === 0) {
      throw new HttpError(409, 'Für dieses Konto sind keine MFA-Faktoren eingerichtet.');
    }
    const hadMfa = isTotpEnabled(targetRow);
    resetMfa(db, target.id);
    const passkeysRemoved = deleteUserPasskeys(db, target.id);
    clearPasskeyFailures(db, target.id);
    const sessions = deleteUserSessions(db, target.id);
    writeAudit(db, {
      userId: actor.id,
      action: 'mfa_reset',
      entityType: 'user',
      entityId: target.id,
      details: { hadTotp: hadMfa, passkeysRemoved, sessionsEnded: sessions }
    });
    if (passkeysRemoved > 0) {
      writeAudit(db, {
        userId: actor.id,
        action: 'passkey_reset',
        entityType: 'user',
        entityId: target.id,
        details: { count: passkeysRemoved }
      });
    }
    res.set('Cache-Control', 'no-store').json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
