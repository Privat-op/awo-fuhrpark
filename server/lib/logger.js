'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAIL_LOG_MAX_BYTES = 5 * 1024 * 1024;
const MAIL_LOG_KEEP = 2;
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;

const SENSITIVE_KEYS = new Set([
  'password', 'passwort', 'secret', 'token', 'authorization', 'cookie', 'cookies',
  'csrf', 'csrftoken', 'challenge', 'code', 'id_token', 'access_token', 'refresh_token',
  'webhookurl', 'url', 'session', 'sessionid', 'sid', 'email', 'recipients', 'to', 'from',
  'subject', 'body', 'payload', 'signature'
]);

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const KEY_VALUE_PATTERN = /\b(password|passwort|secret|token|csrf|challenge|signature)\b\s*[=:]\s*[^\s,;]+/gi;

function isSensitiveKey(key) {
  const value = String(key || '').toLowerCase();
  if (SENSITIVE_KEYS.has(value)) return true;
  return /password|passwort|secret|token|cookie|authorization|csrf|challenge|webhook/i.test(value);
}

function redactText(value) {
  return String(value ?? '')
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(URL_PATTERN, '[redacted-url]')
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(JWT_PATTERN, '[redacted-jwt]')
    .replace(KEY_VALUE_PATTERN, '$1=[redacted]');
}

function sanitizeError(error) {
  if (!error) return null;
  if (typeof error !== 'object') return { name: 'Error', message: redactText(error) };
  return {
    name: String(error.name || 'Error').slice(0, 80),
    code: error.code ? String(error.code).slice(0, 80) : undefined,
    message: redactText(error.message || '').slice(0, 1000),
    stack: error.stack ? redactText(error.stack).slice(0, 4000) : undefined
  };
}

function sanitizeValue(value, key, depth, seen) {
  if (isSensitiveKey(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return sanitizeError(value);
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth >= MAX_DEPTH) return '[object]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((entry, index) => sanitizeValue(entry, `${key}[${index}]`, depth + 1, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const result = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const sanitized = sanitizeValue(entryValue, entryKey, depth + 1, seen);
      if (sanitized !== undefined) result[entryKey] = sanitized;
    }
    seen.delete(value);
    return result;
  }
  return undefined;
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};
  if (context instanceof Error) return { error: sanitizeError(context) };
  return sanitizeValue(context, '', 0, new WeakSet()) || {};
}

function currentLevel() {
  const raw = String(process.env.LOG_LEVEL || '').toLowerCase();
  return LEVELS[raw] ? raw : 'info';
}

function currentFormat() {
  return String(process.env.LOG_FORMAT || '').toLowerCase() === 'json' ? 'json' : 'text';
}

function formatTextValue(value) {
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  if (value === null) return 'null';
  if (value === undefined) return '';
  return JSON.stringify(value);
}

function formatTextLine(entry) {
  const { timestamp, level, component, message, ...context } = entry;
  const parts = [];
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    parts.push(`${key}=${formatTextValue(value)}`);
  }
  return `${timestamp} ${level.toUpperCase().padEnd(5)} [${component}] ${message}${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

function createLogger(component = 'app', options = {}) {
  const name = String(component || 'app').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'app';
  const write = typeof options.write === 'function' ? options.write : (line) => process.stdout.write(`${line}\n`);
  const threshold = () => LEVELS[options.level] ? LEVELS[options.level] : LEVELS[currentLevel()];
  const format = () => options.format || currentFormat();

  function emit(level, message, context) {
    try {
      if (LEVELS[level] < threshold()) return;
      const entry = {
        ...sanitizeContext(context),
        timestamp: new Date().toISOString(),
        level,
        component: name,
        message: redactText(message).replace(/[\r\n]+/g, ' ')
      };
      const line = format() === 'json' ? JSON.stringify(entry) : formatTextLine(entry);
      write(line);
    } catch {
      // Logging must never break a request or scheduler.
    }
  }

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    log: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context)
  };
}

const logger = createLogger('app');

function defaultDataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
}

function logDir() {
  return process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(defaultDataDir(), 'logs');
}

function mailLogPath() {
  return path.join(logDir(), 'mail.log');
}

function safeToken(value, fallback) {
  const text = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return text || fallback;
}

function rotateFile(file, { maxBytes = MAIL_LOG_MAX_BYTES, keep = MAIL_LOG_KEEP } = {}) {
  try {
    if (!fs.existsSync(file)) return false;
    if (fs.statSync(file).size < maxBytes) return false;
    if (keep < 1) {
      fs.rmSync(file, { force: true });
      return true;
    }
    for (let index = keep - 1; index >= 1; index -= 1) {
      const from = `${file}.${index}`;
      const to = `${file}.${index + 1}`;
      if (!fs.existsSync(from)) continue;
      if (index + 1 > keep) {
        fs.rmSync(from, { force: true });
      } else {
        if (fs.existsSync(to)) fs.rmSync(to, { force: true });
        fs.renameSync(from, to);
      }
    }
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

function logMailEvent({
  channel = 'smtp',
  event = 'notification',
  recipientCount = 0,
  status = 'sent',
  errorCode = null,
  durationMs = 0
} = {}) {
  try {
    const file = mailLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateFile(file);
    const line = [
      new Date().toISOString(),
      `channel=${safeToken(channel, 'unknown')}`,
      `event=${safeToken(event, 'notification')}`,
      `recipients=${Math.max(0, Number(recipientCount) || 0)}`,
      `status=${safeToken(status, 'unknown')}`,
      `error=${errorCode ? safeToken(errorCode, 'unknown') : '-'}`,
      `duration_ms=${Math.max(0, Math.round(Number(durationMs) || 0))}`
    ].join(' ');
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    // Mail logging must not affect delivery.
  }
}

function requestLoggingEnabled() {
  const raw = process.env.LOG_REQUESTS;
  if (raw === undefined || raw === '') return process.env.NODE_ENV !== 'production';
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function isStaticOrSkipped(pathname) {
  if (!pathname) return false;
  if (pathname === '/healthz' || pathname === '/robots.txt') return true;
  if (pathname.startsWith('/branding/')) return true;
  return /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i.test(pathname);
}

function requestIdFrom(req) {
  const header = req?.headers?.['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : crypto.randomUUID();
}

function maskIp(value) {
  const ip = String(value || '').replace(/^::ffff:/i, '');
  if (!ip) return 'unknown';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::') return '::';
    const parts = ip.split(':').filter(Boolean).slice(0, 3);
    return `${parts.join(':') || 'ipv6'}::`;
  }
  return 'unknown';
}

function requestLogger(options = {}) {
  const httpLogger = createLogger('http', options);
  return (req, res, next) => {
    req.id = requestIdFrom(req);
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    const pathname = String(req.originalUrl || req.url || '').split('?')[0];
    res.on('finish', () => {
      if (!requestLoggingEnabled() || isStaticOrSkipped(pathname)) return;
      const status = Number(res.statusCode) || 0;
      const level = status >= 500 ? 'error' : status >= 400 ? (status === 404 ? 'debug' : 'warn') : 'info';
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      httpLogger[level]('request', {
        method: String(req.method || '').slice(0, 10),
        path: pathname.slice(0, 300),
        status,
        durationMs: Math.round(durationMs * 10) / 10,
        requestId: req.id,
        userId: req.user?.id || null,
        role: req.user?.role || null,
        ip: maskIp(req.ip)
      });
    });
    next();
  };
}

function logRequestError(req, status, error) {
  const level = status >= 500 ? 'error' : status === 404 ? 'debug' : 'warn';
  const pathname = String(req?.originalUrl || req?.url || '').split('?')[0];
  logger[level]('request_error', {
    error: status >= 500 ? error : { name: error?.name, code: error?.code, message: error?.message },
    status,
    requestId: req?.id || null,
    method: String(req?.method || '').slice(0, 10),
    path: pathname.slice(0, 300),
    userId: req?.user?.id || null,
    role: req?.user?.role || null
  });
}

module.exports = {
  LEVELS,
  MAIL_LOG_MAX_BYTES,
  MAIL_LOG_KEEP,
  createLogger,
  logger,
  redactText,
  sanitizeError,
  mailLogPath,
  logDir,
  logMailEvent,
  rotateFile,
  requestLoggingEnabled,
  isStaticOrSkipped,
  requestIdFrom,
  maskIp,
  requestLogger,
  logRequestError
};
