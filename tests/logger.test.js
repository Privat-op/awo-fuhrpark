'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const {
  createLogger,
  redactText,
  sanitizeError,
  logMailEvent,
  mailLogPath,
  rotateFile,
  requestLogger,
  requestLoggingEnabled,
  isStaticOrSkipped,
  maskIp
} = require('../server/lib/logger');
const { sendMail } = require('../server/lib/smtp');

const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const tempDirs = [];

function tempDir(prefix) {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, prefix));
  tempDirs.push(dir);
  return dir;
}

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withEnvAsync(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Logger redigiert Passwörter, Tokens, Cookies, Challenges, URLs und E-Mails', () => {
  const lines = [];
  const logger = createLogger('test', {
    level: 'debug',
    format: 'text',
    write: (line) => lines.push(line)
  });
  const error = new Error('Login fehlgeschlagen password=hunter2 token=abc123 https://discord.com/api/webhooks/1/token user@example.invalid');
  logger.info('Login password=hunter2 token=abc123 https://discord.com/api/webhooks/1/x user@example.invalid', {
    password: 'hunter2',
    token: 'abc123',
    cookie: 'awo.sid=session-secret',
    authorization: 'Bearer token-value',
    csrf: 'csrf-value',
    challenge: 'challenge-value',
    webhookUrl: 'https://discord.com/api/webhooks/1/x',
    email: 'user@example.invalid',
    error
  });
  const text = lines.join('\n');
  for (const secret of [
    'hunter2', 'abc123', 'session-secret', 'token-value', 'csrf-value',
    'challenge-value', 'discord.com/api/webhooks', 'user@example.invalid'
  ]) {
    assert.equal(text.includes(secret), false, `Secret ${secret} darf nicht im Log stehen`);
  }
  assert.match(text, /\[redacted-email\]/);
  assert.match(text, /\[redacted-url\]/);
  assert.match(text, /password=\[redacted\]/);
  assert.match(text, /token=\[redacted\]/);
  assert.match(text, /INFO/);
  assert.match(text, /^\d{4}-\d{2}-\d{2}T/);
});

test('Logger unterstützt JSON und Level-Filter', () => {
  const lines = [];
  const logger = createLogger('json-test', { level: 'warn', format: 'json', write: (line) => lines.push(line) });
  logger.debug('debug', { value: 1 });
  logger.info('info', { value: 2 });
  logger.warn('warn', { value: 3, token: 'secret-token' });
  logger.error('error', { value: 4 });
  assert.equal(lines.length, 2);
  const warn = JSON.parse(lines[0]);
  assert.equal(warn.level, 'warn');
  assert.equal(warn.component, 'json-test');
  assert.equal(warn.value, 3);
  assert.equal(warn.token, '[redacted]');
  assert.equal(JSON.parse(lines[1]).level, 'error');
});

test('redactText und sanitizeError liefern nur sanitisierte Fehlerfelder', () => {
  const text = redactText('Authorization: Bearer abc.def password=secret https://hooks.example.invalid/x a@b.de');
  assert.doesNotMatch(text, /abc\.def|secret|hooks\.example|a@b\.de/);
  const sanitized = sanitizeError(Object.assign(new Error('token=abc'), { code: 'EAUTH' }));
  assert.deepEqual(Object.keys(sanitized).sort(), ['code', 'message', 'name', 'stack']);
  assert.equal(sanitized.code, 'EAUTH');
  assert.doesNotMatch(sanitized.message, /abc/);
});

test('Mail-Log schreibt Event, Status und Fehlercode ohne Adressen', () => {
  const dir = tempDir('awo-log-mail-');
  withEnv({ LOG_DIR: dir }, () => {
    logMailEvent({ channel: 'smtp', event: 'leasing', recipientCount: 3, status: 'sent', durationMs: 42 });
    logMailEvent({ channel: 'teams', event: 'booking_request', recipientCount: 1, status: 'failed', errorCode: 'TEAMS_ERROR', durationMs: 7 });
    const content = fs.readFileSync(mailLogPath(), 'utf8');
    assert.match(content, /channel=smtp event=leasing recipients=3 status=sent error=- duration_ms=42/);
    assert.match(content, /channel=teams event=booking_request recipients=1 status=failed error=TEAMS_ERROR duration_ms=7/);
    assert.doesNotMatch(content, /@example|secret|https?:\/\//);
  });
});

test('Rotation verschiebt Dateien und begrenzt die Anzahl', () => {
  const dir = tempDir('awo-log-rotate-');
  const file = path.join(dir, 'rotate.log');
  fs.writeFileSync(file, 'current');
  fs.writeFileSync(`${file}.1`, 'older');
  assert.equal(rotateFile(file, { maxBytes: 1, keep: 2 }), true);
  assert.equal(fs.readFileSync(`${file}.1`, 'utf8'), 'current');
  assert.equal(fs.readFileSync(`${file}.2`, 'utf8'), 'older');
  assert.equal(fs.existsSync(`${file}.3`), false);
});

test('Mail-Log rotiert bei 5 MB und behält drei Dateien', () => {
  const dir = tempDir('awo-log-mail-rotate-');
  withEnv({ LOG_DIR: dir }, () => {
    const file = mailLogPath();
    fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1));
    logMailEvent({ channel: 'smtp', event: 'maintenance', recipientCount: 1, status: 'sent', durationMs: 1 });
    assert.ok(fs.existsSync(`${file}.1`));
    assert.ok(fs.statSync(file).size < 500);
    fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1));
    logMailEvent({ channel: 'smtp', event: 'maintenance', recipientCount: 1, status: 'sent', durationMs: 1 });
    assert.ok(fs.existsSync(`${file}.2`));
  });
});

test('SMTP-Versand schreibt Event und Fehlercode ohne Adressen', async () => {
  const dir = tempDir('awo-log-smtp-');
  const config = {
    enabled: true,
    host: 'smtp.example.invalid',
    port: 587,
    secure: false,
    username: '',
    fromAddress: 'noreply@example.invalid',
    password: ''
  };
  await withEnvAsync({ LOG_DIR: dir }, async () => {
    await sendMail({
      config,
      to: ['secret-recipient@example.invalid'],
      subject: 'Vertraulicher Betreff',
      text: 'Inhalt',
      event: 'smtp_test',
      transportFactory: () => ({ sendMail: async () => ({ accepted: 1 }), close() {} })
    });
    const failing = Object.assign(new Error('auth failed'), { code: 'EAUTH' });
    await assert.rejects(
      sendMail({
        config,
        to: ['secret-recipient@example.invalid'],
        subject: 'Vertraulicher Betreff',
        text: 'Inhalt',
        event: 'leasing',
        transportFactory: () => ({ sendMail: async () => { throw failing; }, close() {} })
      }),
      /auth failed/
    );
    const content = fs.readFileSync(mailLogPath(), 'utf8');
    assert.match(content, /channel=smtp event=smtp_test recipients=1 status=sent error=-/);
    assert.match(content, /channel=smtp event=leasing recipients=1 status=failed error=EAUTH/);
    assert.doesNotMatch(content, /secret-recipient|Vertraulicher Betreff|noreply@/);
  });
});

function fakeResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  return res;
}

function runMiddleware(req, status = 200) {
  const lines = [];
  const middleware = requestLogger({ level: 'debug', format: 'text', write: (line) => lines.push(line) });
  const res = fakeResponse();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  res.statusCode = status;
  res.emit('finish');
  return { lines, res, nextCalled };
}

test('Request-Log: Pfad ohne Query, maskierte IP, Request-ID, User und Rolle', () => {
  withEnv({ LOG_REQUESTS: '1' }, () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/state?token=secret-token&email=user@example.invalid',
      headers: { 'x-request-id': 'request-12345678' },
      ip: '::ffff:192.168.1.9',
      user: { id: 'user-1', role: 'manager' }
    };
    const { lines, res, nextCalled } = runMiddleware(req, 200);
    assert.equal(nextCalled, true);
    assert.equal(res.headers['x-request-id'], 'request-12345678');
    assert.equal(req.id, 'request-12345678');
    const line = lines.join('\n');
    assert.match(line, /method=GET/);
    assert.match(line, /path=\/api\/state/);
    assert.match(line, /status=200/);
    assert.match(line, /requestId=request-12345678/);
    assert.match(line, /userId=user-1/);
    assert.match(line, /role=manager/);
    assert.match(line, /ip=192\.168\.\*\.\*/);
    assert.doesNotMatch(line, /secret-token|example\.invalid|token=/);
  });
});

test('Request-Log erzeugt UUID, überspringt Assets und nutzt Debug für 404', () => {
  withEnv({ LOG_REQUESTS: '1' }, () => {
    const invalid = {
      method: 'GET',
      originalUrl: '/login',
      headers: { 'x-request-id': 'bad' },
      ip: '10.0.0.1'
    };
    const first = runMiddleware(invalid, 200);
    assert.match(first.res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.notEqual(first.res.headers['x-request-id'], 'bad');
    assert.match(first.lines.join('\n'), /path=\/login/);

    const staticAsset = { method: 'GET', originalUrl: '/assets/app.js', headers: {}, ip: '127.0.0.1' };
    const skipped = runMiddleware(staticAsset, 200);
    assert.deepEqual(skipped.lines, []);

    const health = { method: 'GET', originalUrl: '/healthz', headers: {}, ip: '127.0.0.1' };
    assert.deepEqual(runMiddleware(health, 200).lines, []);

    const missing = { method: 'GET', originalUrl: '/nicht-da', headers: {}, ip: '127.0.0.1' };
    const notFound = runMiddleware(missing, 404);
    assert.match(notFound.lines.join('\n'), /DEBUG/);
  });
});

test('Request-Logging-Defaults und Skip-/IP-Helfer', () => {
  withEnv({ LOG_REQUESTS: undefined, NODE_ENV: 'production' }, () => {
    assert.equal(requestLoggingEnabled(), false);
  });
  withEnv({ LOG_REQUESTS: undefined, NODE_ENV: 'development' }, () => {
    assert.equal(requestLoggingEnabled(), true);
  });
  withEnv({ LOG_REQUESTS: '0' }, () => assert.equal(requestLoggingEnabled(), false));
  withEnv({ LOG_REQUESTS: '1' }, () => assert.equal(requestLoggingEnabled(), true));

  assert.equal(isStaticOrSkipped('/healthz'), true);
  assert.equal(isStaticOrSkipped('/branding/logo'), true);
  assert.equal(isStaticOrSkipped('/styles.css'), true);
  assert.equal(isStaticOrSkipped('/api/state'), false);
  assert.equal(maskIp('::ffff:192.168.1.9'), '192.168.*.*');
  assert.equal(maskIp('2001:db8:1:2::5'), '2001:db8:1::');
  assert.equal(maskIp(''), 'unknown');
});
