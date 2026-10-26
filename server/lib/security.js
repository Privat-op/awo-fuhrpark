'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('./validation');

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken();
  return req.session.csrfToken;
}

function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token') || req.body?._csrf;
  if (!expected || !provided || !safeEqual(expected, provided)) {
    return next(new HttpError(403, 'Ungültiges oder abgelaufenes Sicherheitstoken. Bitte Seite neu laden.'));
  }
  return next();
}

module.exports = {
  randomToken,
  safeEqual,
  ensureCsrfToken,
  csrfProtection
};
