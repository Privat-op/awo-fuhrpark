'use strict';

const crypto = require('node:crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { HttpError } = require('./validation');
const { writeAudit } = require('./audit');
const { getWebAuthnIntegrationConfig } = require('./integrations');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const ALLOWED_TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card']);
const DEFAULT_VERIFIER = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
};

function getWebAuthnConfig(db) {
  const config = getWebAuthnIntegrationConfig(db);
  if (!config.enabled) {
    return { enabled: false, reason: config.reason || 'WebAuthn ist nicht konfiguriert.' };
  }
  return { enabled: true, rpID: config.rpID, rpName: config.rpName, origins: config.origins };
}

function safeTransports(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map(String).filter((entry) => ALLOWED_TRANSPORTS.has(entry)))];
}

function encodePublicKey(value) {
  return Buffer.from(value).toString('base64url');
}

function decodePublicKey(value) {
  return new Uint8Array(Buffer.from(String(value), 'base64url'));
}

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return name || 'Passkey';
}

function safePasskey(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    transports: safeTransports(row.transports),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null
  };
}

function listPasskeys(db, userId) {
  return db.prepare(`
    SELECT id, name, transports, created_at, last_used_at
    FROM user_passkeys
    WHERE user_id = ?
    ORDER BY created_at, id
  `).all(userId).map(safePasskey);
}

function countPasskeys(db, userId) {
  return db.prepare('SELECT COUNT(*) AS count FROM user_passkeys WHERE user_id = ?').get(userId).count;
}

function getPasskey(db, userId, id) {
  return db.prepare('SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?').get(id, userId) || null;
}

function getPasskeyByCredential(db, userId, credentialId) {
  return db.prepare('SELECT * FROM user_passkeys WHERE user_id = ? AND credential_id = ?')
    .get(userId, credentialId) || null;
}

function addPasskey(db, userId, { credentialId, publicKey, counter = 0, transports = [], name = 'Passkey' }) {
  const credential = String(credentialId || '');
  const key = String(publicKey || '');
  if (!/^[A-Za-z0-9_-]+$/.test(credential) || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new HttpError(400, 'Der Passkey konnte nicht gespeichert werden.');
  }
  if (db.prepare('SELECT id FROM user_passkeys WHERE credential_id = ?').get(credential)) {
    throw new HttpError(409, 'Dieser Passkey ist bereits registriert.');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO user_passkeys
        (id, user_id, credential_id, public_key, counter, transports, name, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(id, userId, credential, key, Math.max(0, Number(counter) || 0), JSON.stringify(safeTransports(transports)), cleanName(name), now);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Dieser Passkey ist bereits registriert.');
    throw error;
  }
  return safePasskey(getPasskey(db, userId, id));
}

function renamePasskey(db, userId, id, name) {
  const existing = getPasskey(db, userId, id);
  if (!existing) return null;
  db.prepare('UPDATE user_passkeys SET name = ? WHERE id = ? AND user_id = ?')
    .run(cleanName(name), id, userId);
  return safePasskey(getPasskey(db, userId, id));
}

function removePasskey(db, userId, id) {
  const existing = getPasskey(db, userId, id);
  if (!existing) return null;
  db.prepare('DELETE FROM user_passkeys WHERE id = ? AND user_id = ?').run(id, userId);
  return safePasskey(existing);
}

function deleteUserPasskeys(db, userId) {
  return db.prepare('DELETE FROM user_passkeys WHERE user_id = ?').run(userId).changes;
}

function attemptRow(db, userId) {
  return db.prepare('SELECT * FROM passkey_attempts WHERE user_id = ?').get(userId) || null;
}

function lockRemainingMs(db, userId, now = Date.now()) {
  const row = attemptRow(db, userId);
  if (!row?.locked_until) return 0;
  const until = Date.parse(row.locked_until);
  return Number.isFinite(until) ? Math.max(0, until - now) : 0;
}

function isPasskeyLocked(db, userId, now = Date.now()) {
  return lockRemainingMs(db, userId, now) > 0;
}

function registerPasskeyFailure(db, userId, now = new Date()) {
  const row = attemptRow(db, userId);
  const previous = Number(row?.failed_attempts) || 0;
  const last = Date.parse(row?.updated_at || '');
  const withinWindow = Number.isFinite(last) && (now.getTime() - last) <= FAILURE_WINDOW_MS;
  const attempts = (previous > 0 && withinWindow ? previous : 0) + 1;
  const nowISO = now.toISOString();
  if (attempts >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
    db.prepare(`
      INSERT INTO passkey_attempts (user_id, failed_attempts, locked_until, updated_at)
      VALUES (?, 0, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET failed_attempts = 0, locked_until = excluded.locked_until, updated_at = excluded.updated_at
    `).run(userId, lockedUntil, nowISO);
    return { attempts: 0, lockedUntil };
  }
  db.prepare(`
    INSERT INTO passkey_attempts (user_id, failed_attempts, locked_until, updated_at)
    VALUES (?, ?, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET failed_attempts = excluded.failed_attempts, locked_until = NULL, updated_at = excluded.updated_at
  `).run(userId, attempts, nowISO);
  return { attempts, lockedUntil: null };
}

function clearPasskeyFailures(db, userId) {
  db.prepare('DELETE FROM passkey_attempts WHERE user_id = ?').run(userId);
}

function storeRegistrationChallenge(req, challenge, userId) {
  req.session.passkeyRegistration = { challenge, userId, createdAt: Date.now() };
}

function takeRegistrationChallenge(req, userId) {
  const value = req.session?.passkeyRegistration;
  delete req.session?.passkeyRegistration;
  if (!value || value.userId !== userId) return null;
  if (Date.now() - Number(value.createdAt) > CHALLENGE_TTL_MS) return null;
  return value.challenge;
}

function storeAuthenticationChallenge(req, challenge, userId) {
  req.session.passkeyAuthentication = { challenge, userId, createdAt: Date.now() };
}

function takeAuthenticationChallenge(req, userId) {
  const value = req.session?.passkeyAuthentication;
  delete req.session?.passkeyAuthentication;
  if (!value || value.userId !== userId) return null;
  if (Date.now() - Number(value.createdAt) > CHALLENGE_TTL_MS) return null;
  return value.challenge;
}

async function buildRegistrationOptions(db, user, config, verifier = DEFAULT_VERIFIER) {
  const existing = db.prepare('SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?').all(user.id);
  const options = await verifier.generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new Uint8Array(Buffer.from(String(user.id), 'utf8')),
    timeout: 300000,
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: safeTransports(row.transports)
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }
  });
  return { options, challenge: options.challenge };
}

async function verifyRegistration(db, user, response, challenge, config, name, verifier = DEFAULT_VERIFIER) {
  const verification = await verifier.verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpID,
    requireUserVerification: true
  });
  if (!verification?.verified || !verification.registrationInfo) return { valid: false };
  const credential = verification.registrationInfo.credential;
  if (!credential?.id || !credential.publicKey) return { valid: false };
  return {
    valid: true,
    passkey: addPasskey(db, user.id, {
      credentialId: credential.id,
      publicKey: encodePublicKey(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || response?.response?.transports || [],
      name
    })
  };
}

async function buildAuthenticationOptions(db, userId, config, verifier = DEFAULT_VERIFIER) {
  const rows = db.prepare('SELECT credential_id, transports FROM user_passkeys WHERE user_id = ? ORDER BY created_at, id').all(userId);
  if (!rows.length) return { options: null, challenge: null };
  const options = await verifier.generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: rows.map((row) => ({
      id: row.credential_id,
      transports: safeTransports(row.transports)
    })),
    timeout: 300000,
    userVerification: 'required'
  });
  return { options, challenge: options.challenge };
}

async function verifyAuthentication(db, userId, response, challenge, config, verifier = DEFAULT_VERIFIER, now = new Date()) {
  const credential = response?.id ? getPasskeyByCredential(db, userId, response.id) : null;
  if (!credential) return { valid: false, reason: 'unknown_credential' };
  const verification = await verifier.verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpID,
    credential: {
      id: credential.credential_id,
      publicKey: decodePublicKey(credential.public_key),
      counter: Number(credential.counter) || 0,
      transports: safeTransports(credential.transports)
    },
    requireUserVerification: true
  });
  if (!verification?.verified) return { valid: false, reason: 'invalid' };
  const storedCounter = Number(credential.counter) || 0;
  const newCounter = Number(verification.authenticationInfo?.newCounter) || 0;
  if (storedCounter > 0 && newCounter <= storedCounter) {
    db.prepare('DELETE FROM user_passkeys WHERE id = ?').run(credential.id);
    writeAudit(db, {
      userId,
      action: 'passkey_counter_regression',
      entityType: 'user',
      entityId: userId,
      details: { reason: 'counter_regression' }
    });
    return { valid: false, reason: 'counter_regression', compromised: true };
  }
  const nowISO = now.toISOString();
  db.prepare('UPDATE user_passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .run(newCounter, nowISO, credential.id);
  clearPasskeyFailures(db, userId);
  return { valid: true, passkey: safePasskey(getPasskey(db, userId, credential.id)) };
}

module.exports = {
  CHALLENGE_TTL_MS,
  MAX_ATTEMPTS,
  LOCK_MS,
  getWebAuthnConfig,
  listPasskeys,
  countPasskeys,
  getPasskey,
  addPasskey,
  renamePasskey,
  removePasskey,
  deleteUserPasskeys,
  isPasskeyLocked,
  lockRemainingMs,
  registerPasskeyFailure,
  clearPasskeyFailures,
  storeRegistrationChallenge,
  takeRegistrationChallenge,
  storeAuthenticationChallenge,
  takeAuthenticationChallenge,
  buildRegistrationOptions,
  verifyRegistration,
  buildAuthenticationOptions,
  verifyAuthentication
};
