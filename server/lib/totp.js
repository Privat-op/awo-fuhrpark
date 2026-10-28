'use strict';

const crypto = require('node:crypto');

const STEP_SECONDS = 30;

function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const text = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!text) throw new Error('TOTP-Secret fehlt.');
  let bits = 0;
  let current = 0;
  const bytes = [];
  for (const character of text) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('TOTP-Secret ist ungültig.');
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer) {
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

function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

function totp(secret, { now = Date.now(), stepSeconds = STEP_SECONDS } = {}) {
  return hotp(secret, Math.floor(now / 1000 / stepSeconds));
}

function safeCodeEqual(first, second) {
  const a = Buffer.from(String(first), 'utf8');
  const b = Buffer.from(String(second), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyTotp(secret, code, {
  now = Date.now(),
  window = 1,
  stepSeconds = STEP_SECONDS,
  lastUsedStep = null
} = {}) {
  const value = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(value)) return { valid: false, step: null, replay: false };
  const currentStep = Math.floor(now / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = currentStep + offset;
    if (candidate < 0) continue;
    if (!safeCodeEqual(value, hotp(secret, candidate))) continue;
    if (lastUsedStep !== null && lastUsedStep !== undefined && candidate <= Number(lastUsedStep)) {
      return { valid: false, step: candidate, replay: true };
    }
    return { valid: true, step: candidate, replay: false };
  }
  return { valid: false, step: null, replay: false };
}

function otpauthUri({ secret, accountName, issuer = 'AWO Fuhrparkmanagement' }) {
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({
    secret: String(secret).toUpperCase(),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(STEP_SECONDS)
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totp,
  verifyTotp,
  otpauthUri
};
