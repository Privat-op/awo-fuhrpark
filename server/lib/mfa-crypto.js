'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEY_FILE = 'mfa.key';
const KEY_CACHE = new Map();

function defaultDataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
}

function decodeKey(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  try {
    const decoded = Buffer.from(text, 'base64');
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function keyFile(dataDir) {
  return path.join(dataDir || defaultDataDir(), KEY_FILE);
}

function getMfaKey(dataDir) {
  const configured = String(process.env.MFA_ENCRYPTION_KEY || '').trim();
  if (configured) {
    const envKey = decodeKey(configured);
    if (!envKey) {
      throw new Error('MFA_ENCRYPTION_KEY muss 32 Byte als Base64 oder 64 Hex-Zeichen lang sein.');
    }
    return envKey;
  }
  const file = keyFile(dataDir);
  if (KEY_CACHE.has(file)) return KEY_CACHE.get(file);
  let key = null;
  let exists = false;
  try {
    const stored = fs.readFileSync(file, 'utf8');
    exists = true;
    key = decodeKey(stored);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!key) {
    if (exists) throw new Error(`${file} ist kein gültiger MFA-Schlüssel (erwartet 32 Byte Base64).`);
    key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, key.toString('base64'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      key = decodeKey(fs.readFileSync(file, 'utf8'));
      if (!key) throw new Error(`${file} ist kein gültiger MFA-Schlüssel (erwartet 32 Byte Base64).`);
    }
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows kennt keine POSIX-Modi; die Datei liegt im geschützten Datenverzeichnis.
    }
  }
  KEY_CACHE.set(file, key);
  return key;
}

function encryptSecret(secret, userId, { dataDir } = {}) {
  const key = getMfaKey(dataDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(userId), 'utf8'));
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptSecret(payload, userId, { dataDir } = {}) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('MFA-Secret hat ein ungültiges Format.');
  const key = getMfaKey(dataDir);
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const encrypted = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(String(userId), 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function recoveryPepper(dataDir) {
  const key = getMfaKey(dataDir);
  return Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from('awo-mfa-recovery-v1'), 32));
}

function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function hashRecoveryCode(value, { dataDir } = {}) {
  return crypto.createHmac('sha256', recoveryPepper(dataDir))
    .update(normalizeRecoveryCode(value), 'utf8')
    .digest('hex');
}

function base32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function generateRecoveryCode() {
  const raw = base32(crypto.randomBytes(10)).slice(0, 16);
  return raw.match(/.{1,4}/g).join('-');
}

function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

module.exports = {
  defaultDataDir,
  getMfaKey,
  encryptSecret,
  decryptSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  base32
};
