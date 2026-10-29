'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEY_FILE = 'integrations.key';
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

function getIntegrationsKey(dataDir) {
  const configured = String(process.env.INTEGRATIONS_ENCRYPTION_KEY || '').trim();
  if (configured) {
    const key = decodeKey(configured);
    if (!key) throw new Error('INTEGRATIONS_ENCRYPTION_KEY muss 32 Byte als Base64 oder 64 Hex-Zeichen lang sein.');
    return key;
  }
  const file = path.join(dataDir || defaultDataDir(), KEY_FILE);
  if (KEY_CACHE.has(file)) return KEY_CACHE.get(file);
  let key = null;
  let exists = false;
  try {
    key = decodeKey(fs.readFileSync(file, 'utf8'));
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!key) {
    if (exists) throw new Error(`${file} ist kein gültiger Integrations-Schlüssel (erwartet 32 Byte Base64).`);
    key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, key.toString('base64'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      key = decodeKey(fs.readFileSync(file, 'utf8'));
      if (!key) throw new Error(`${file} ist kein gültiger Integrations-Schlüssel (erwartet 32 Byte Base64).`);
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

function encryptIntegrationSecret(value, field, { dataDir } = {}) {
  const key = getIntegrationsKey(dataDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`integration:${field}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptIntegrationSecret(payload, field, { dataDir } = {}) {
  if (!payload) return '';
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Integrations-Secret hat ein ungültiges Format.');
  const key = getIntegrationsKey(dataDir);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
  decipher.setAAD(Buffer.from(`integration:${field}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = {
  KEY_FILE,
  getIntegrationsKey,
  encryptIntegrationSecret,
  decryptIntegrationSecret
};
