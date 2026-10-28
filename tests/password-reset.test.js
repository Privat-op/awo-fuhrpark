'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const {
  requestPasswordReset,
  resetPasswordWithToken,
  validatePasswordResetToken,
  hashToken,
  TOKEN_TTL_MS
} = require('../server/lib/password-reset');
const {
  migratePasswordResetSchema,
  PASSWORD_RESET_SCHEMA_VERSION
} = require('../server/lib/password-reset-schema');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const TEST_PASSWORD = 'Old-Password-2026!';
const NEW_PASSWORD = 'New-Password-2026!';
const ADMIN_EMAIL = 'reset-admin@example.invalid';
const ADMIN_PASSWORD = 'Reset-Admin-2026!';
const USER_EMAIL = 'reset-user@example.invalid';
const UNKNOWN_EMAIL = 'unknown-reset@example.invalid';

let unitDir;
let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let serverOutput = '';
const clients = {};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDb() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA);
  database.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Reset-Testorganisation', '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO smtp_settings (id, host, port, secure, username, from_address, enabled, updated_at)
    VALUES (1, 'smtp.example.invalid', 587, 0, '', 'noreply@example.invalid', 1, '2026-01-01')
  `).run();
  return database;
}

function insertUser(database, { id, email, role = 'manager', password = TEST_PASSWORD }) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, id, bcrypt.hashSync(password, 4), role, now, now);
}

function fakeTransport() {
  const messages = [];
  return {
    messages,
    factory: () => ({
      async sendMail(message) {
        messages.push(message);
        return { accepted: [message.to] };
      },
      close() {}
    })
  };
}

function fakeLogger() {
  const warnings = [];
  return {
    warnings,
    warn(...args) { warnings.push(args.join(' ')); }
  };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Server startet noch.
    }
    await wait(100);
  }
  throw new Error(`Testserver nicht erreichbar. Ausgabe: ${serverOutput.slice(-2000)}`);
}

function extractCookie(response) {
  const headerValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of headerValues) {
    const match = /(?:^|,\s*)(awo\.sid=[^;]+)/.exec(header);
    if (match) return match[1];
  }
  return null;
}

function csrfFrom(html) {
  return /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
}

async function login(email, password = TEST_PASSWORD) {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  const html = await page.text();
  const csrf = csrfFrom(html);
  const firstCookie = extractCookie(page);
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body: new URLSearchParams({ _csrf: csrf, email, password })
  });
  const cookie = extractCookie(response) || firstCookie;
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  const sessionData = session.status === 200 ? await session.json() : null;
  return { status: response.status, cookie, csrf: sessionData?.csrfToken || '', session: sessionData };
}

async function formGet(endpoint, cookie = '') {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual'
  });
  return {
    status: response.status,
    cookie: extractCookie(response) || cookie,
    text: await response.text()
  };
}

async function formPost(endpoint, cookie, fields) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie
    },
    body: new URLSearchParams(fields)
  });
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    cookie: extractCookie(response) || cookie,
    text: await response.text()
  };
}

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  unitDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-password-reset-unit-'));
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-password-reset-int-'));
  dbPath = path.join(tempDir, 'test.sqlite');
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: tempDir,
      DB_PATH: dbPath,
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ADMIN_NAME: 'Reset Admin',
      ORG_NAME: 'Reset-Testorganisation',
      APP_BASE_URL: 'https://fuhrpark.example.invalid',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      LEASING_SCHEDULER_DISABLED: 'true',
      REMINDER_SCHEDULER_DISABLED: 'true',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  insertUser(db, { id: 'reset-user', email: USER_EMAIL });
});

after(async () => {
  try { db?.close(); } catch { /* ignore */ }
  if (child) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
  }
  for (const dir of [unitDir, tempDir]) {
    if (!dir) continue;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Migration 8→9 ist idempotent und legt Token-Tabelle mit FK an', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    database.pragma('user_version = 8');
    assert.equal(migratePasswordResetSchema(database), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), PASSWORD_RESET_SCHEMA_VERSION);
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_tokens'").get());
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(migratePasswordResetSchema(database), false);
    assert.equal(Number(database.pragma('user_version', { simple: true })), 9);
    assert.throws(() => {
      database.prepare(`
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
        VALUES ('t1', 'missing-user', 'hash', '2026-10-28T11:00:00.000Z')
      `).run();
    });
  } finally {
    database.close();
  }
});

test('Fake-Transport: Reset-Mail enthält nur Link/Token, Token wird nur gehasht gespeichert', async () => {
  const database = createDb();
  const now = new Date('2026-10-28T10:00:00.000Z');
  try {
    insertUser(database, { id: 'unit-user', email: 'unit-user@example.invalid' });
    database.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)')
      .run('unit-session', JSON.stringify({ userId: 'unit-user' }), Date.now() + 60_000);
    const transport = fakeTransport();
    const result = await requestPasswordReset(database, {
      email: 'UNIT-USER@example.invalid',
      dataDir: unitDir,
      baseUrl: 'https://fuhrpark.example.invalid',
      now,
      transportFactory: transport.factory,
      logger: fakeLogger()
    });
    assert.equal(result.requested, true);
    assert.equal(result.sent, true);
    assert.equal(transport.messages.length, 1);
    const mail = transport.messages[0];
    const match = /https:\/\/fuhrpark\.example\.invalid\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.text);
    assert.ok(match, 'Reset-Link fehlt in der E-Mail');
    const token = match[1];
    const row = database.prepare('SELECT * FROM password_reset_tokens').get();
    assert.equal(row.token_hash, hashToken(token));
    assert.notEqual(row.token_hash, token);
    assert.equal(Date.parse(row.expires_at) - now.getTime(), TOKEN_TTL_MS);
    assert.equal(validatePasswordResetToken(database, token, { now }).valid, true);

    const reset = resetPasswordWithToken(database, token, NEW_PASSWORD, { now: new Date(now.getTime() + 1000) });
    assert.equal(reset.ok, true);
    assert.equal(reset.sessionsEnded, 1);
    const user = database.prepare("SELECT password_hash FROM users WHERE id = 'unit-user'").get();
    assert.equal(bcrypt.compareSync(NEW_PASSWORD, user.password_hash), true);
    assert.equal(bcrypt.compareSync(TEST_PASSWORD, user.password_hash), false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.equal(resetPasswordWithToken(database, token, 'Another-Password-2026!').ok, false);
    const audit = database.prepare("SELECT action, details FROM audit_logs WHERE action LIKE 'password_reset%'").all();
    assert.ok(audit.some((entry) => entry.action === 'password_reset_requested'));
    assert.ok(audit.some((entry) => entry.action === 'password_reset_completed'));
    for (const entry of audit) {
      assert.equal(String(entry.details).includes(token), false);
      assert.equal(String(entry.details).includes(row.token_hash), false);
    }
  } finally {
    database.close();
  }
});

test('Unbekannte Konten und Superadmin erzeugen weder Mail noch Token', async () => {
  const database = createDb();
  try {
    insertUser(database, { id: 'superadmin', email: 'superadmin-reset@example.invalid', role: 'superadmin' });
    const transport = fakeTransport();
    const logger = fakeLogger();
    const unknown = await requestPasswordReset(database, {
      email: UNKNOWN_EMAIL,
      dataDir: unitDir,
      baseUrl: 'https://fuhrpark.example.invalid',
      transportFactory: transport.factory,
      logger
    });
    assert.equal(unknown.requested, false);
    const superadmin = await requestPasswordReset(database, {
      email: 'superadmin-reset@example.invalid',
      dataDir: unitDir,
      baseUrl: 'https://fuhrpark.example.invalid',
      transportFactory: transport.factory,
      logger
    });
    assert.equal(superadmin.requested, false);
    assert.equal(transport.messages.length, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get().count, 0);
  } finally {
    database.close();
  }
});

test('Ohne SMTP wird kein Fehler geworfen und nichts versendet', async () => {
  const database = createDb();
  try {
    database.prepare('UPDATE smtp_settings SET enabled = 0 WHERE id = 1').run();
    insertUser(database, { id: 'smtp-off', email: 'smtp-off@example.invalid' });
    const transport = fakeTransport();
    const logger = fakeLogger();
    const result = await requestPasswordReset(database, {
      email: 'smtp-off@example.invalid',
      dataDir: unitDir,
      baseUrl: 'https://fuhrpark.example.invalid',
      transportFactory: transport.factory,
      logger
    });
    assert.equal(result.requested, true);
    assert.equal(result.sent, false);
    assert.equal(transport.messages.length, 0);
    assert.ok(logger.warnings.some((warning) => warning.includes('SMTP')));
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get().count, 1);
  } finally {
    database.close();
  }
});

test('Abgelaufene Tokens werden abgelehnt', () => {
  const database = createDb();
  const now = new Date('2026-10-28T10:00:00.000Z');
  try {
    insertUser(database, { id: 'expired-user', email: 'expired-user@example.invalid' });
    const token = 'expired-token';
    database.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
      VALUES ('expired', 'expired-user', ?, ?)
    `).run(hashToken(token), new Date(now.getTime() - 1000).toISOString());
    assert.equal(validatePasswordResetToken(database, token, { now }).valid, false);
    assert.equal(resetPasswordWithToken(database, token, NEW_PASSWORD, { now }).ok, false);
  } finally {
    database.close();
  }
});

test('Login-Route: generische Antwort für unbekannte und bekannte Adressen', async () => {
  const knownPage = await formGet('/forgot-password');
  assert.equal(knownPage.status, 200);
  const knownCsrf = csrfFrom(knownPage.text);
  const known = await formPost('/forgot-password', knownPage.cookie, {
    _csrf: knownCsrf,
    email: USER_EMAIL
  });
  assert.equal(known.status, 200);
  assert.match(known.text, /Wenn ein Konto mit dieser E-Mail-Adresse existiert/);

  const unknownPage = await formGet('/forgot-password');
  const unknown = await formPost('/forgot-password', unknownPage.cookie, {
    _csrf: csrfFrom(unknownPage.text),
    email: UNKNOWN_EMAIL
  });
  assert.equal(unknown.status, 200);
  assert.match(unknown.text, /Wenn ein Konto mit dieser E-Mail-Adresse existiert/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM password_reset_tokens WHERE user_id = 'reset-user'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM password_reset_tokens WHERE user_id <> 'reset-user'").get().count, 0);
});

test('Reset-Route: Token einmalig, neues Passwort, alle Sitzungen beendet', async () => {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
    VALUES ('integration-token', 'reset-user', ?, ?)
  `).run(hashToken(token), new Date(Date.now() + TOKEN_TTL_MS).toISOString());

  const oldLogin = await login(USER_EMAIL, TEST_PASSWORD);
  assert.equal(oldLogin.status, 303);
  assert.equal(oldLogin.session.user.id, 'reset-user');

  const page = await formGet(`/reset-password?token=${encodeURIComponent(token)}`);
  assert.equal(page.status, 200);
  const csrf = csrfFrom(page.text);
  assert.ok(csrf);
  assert.match(page.text, new RegExp(`name="token" value="${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));

  const reset = await formPost('/reset-password', page.cookie, {
    _csrf: csrf,
    token,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD
  });
  assert.equal(reset.status, 303);
  assert.equal(reset.location, '/login?reset=1');

  const oldSession = await fetch(`${baseUrl}/api/session`, { headers: { cookie: oldLogin.cookie } });
  assert.equal(oldSession.status, 401);

  const reused = await formGet(`/reset-password?token=${encodeURIComponent(token)}`);
  assert.equal(reused.status, 400);

  const newLogin = await login(USER_EMAIL, NEW_PASSWORD);
  assert.equal(newLogin.status, 303);
  assert.equal(newLogin.session.user.id, 'reset-user');

  const oldPasswordLogin = await login(USER_EMAIL, TEST_PASSWORD);
  assert.equal(oldPasswordLogin.status, 401);
});

test('Reset-Route: ungültiger Token liefert generische Fehlermeldung', async () => {
  const page = await formGet('/reset-password?token=invalid-token');
  assert.equal(page.status, 400);
  assert.match(page.text, /ungültig oder abgelaufen/);
});

test('Forgot-Route: nach fünf Anfragen greift das Rate-Limit', async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await formGet('/forgot-password');
    const response = await formPost('/forgot-password', page.cookie, {
      _csrf: csrfFrom(page.text),
      email: UNKNOWN_EMAIL
    });
    assert.equal(response.status, 200);
  }
  const page = await formGet('/forgot-password');
  const limited = await formPost('/forgot-password', page.cookie, {
    _csrf: csrfFrom(page.text),
    email: UNKNOWN_EMAIL
  });
  assert.equal(limited.status, 429);
  assert.match(limited.text, /Zu viele Anfragen/);
});
