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
  getWebAuthnConfig,
  addPasskey,
  listPasskeys,
  countPasskeys,
  renamePasskey,
  removePasskey,
  buildRegistrationOptions,
  verifyRegistration,
  buildAuthenticationOptions,
  verifyAuthentication,
  storeRegistrationChallenge,
  takeRegistrationChallenge,
  storeAuthenticationChallenge,
  takeAuthenticationChallenge,
  registerPasskeyFailure,
  isPasskeyLocked,
  clearPasskeyFailures
} = require('../server/lib/webauthn');
const { migratePasskeySchema, PASSKEY_SCHEMA_VERSION } = require('../server/lib/passkey-schema');
const { encryptSecret } = require('../server/lib/mfa-crypto');
const { setPendingSecret, enableMfa } = require('../server/lib/mfa');
const { totp } = require('../server/lib/totp');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const TEST_PASSWORD = 'Passkey-Test-2026!';
const ADMIN_EMAIL = 'passkey-admin@example.invalid';
const ADMIN_PASSWORD = 'Passkey-Admin-2026!';
const PASSKEY_USER_EMAIL = 'passkey-user@example.invalid';
const TOTP_USER_EMAIL = 'passkey-totp@example.invalid';
const RATE_USER_EMAIL = 'passkey-rate@example.invalid';
const RESET_USER_EMAIL = 'passkey-reset@example.invalid';

let unitDir;
let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let serverOutput = '';
const clients = {};
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

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
    VALUES ('Passkey-Testorganisation', '2026-01-01', '2026-01-01')
  `).run();
  return database;
}

function insertUser(database, id, email, role = 'manager', password = TEST_PASSWORD) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, id, bcrypt.hashSync(password, 4), role, now, now);
}

function mockVerifier({ newCounter = 0, fail = false } = {}) {
  const calls = {};
  return {
    calls,
    async generateRegistrationOptions(options) {
      calls.registrationOptions = options;
      return {
        challenge: 'registration-challenge',
        rp: { id: options.rpID, name: options.rpName },
        user: {
          id: Buffer.from(options.userID).toString('base64url'),
          name: options.userName,
          displayName: options.userDisplayName
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: options.timeout,
        excludeCredentials: options.excludeCredentials || []
      };
    },
    async verifyRegistrationResponse(options) {
      calls.registrationVerify = options;
      if (fail) throw new Error('invalid origin');
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-mock-registration',
            publicKey: Uint8Array.from([1, 2, 3]),
            counter: 0,
            transports: ['internal']
          }
        }
      };
    },
    async generateAuthenticationOptions(options) {
      calls.authenticationOptions = options;
      return {
        challenge: 'authentication-challenge',
        rpId: options.rpID,
        allowCredentials: options.allowCredentials || [],
        timeout: options.timeout,
        userVerification: options.userVerification
      };
    },
    async verifyAuthenticationResponse(options) {
      calls.authenticationVerify = options;
      if (fail) throw new Error('invalid assertion');
      return {
        verified: true,
        authenticationInfo: { newCounter, credentialID: options.credential.id }
      };
    }
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

async function startLogin(email, password = TEST_PASSWORD) {
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
  const location = response.headers.get('location') || '';
  if (response.status === 303 && location === '/login/mfa') {
    const mfaPage = await fetch(`${baseUrl}/login/mfa`, { headers: { cookie }, redirect: 'manual' });
    const mfaHtml = await mfaPage.text();
    return { pending: true, cookie, csrf: csrfFrom(mfaHtml), page: mfaHtml, status: response.status };
  }
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  return {
    pending: false,
    cookie,
    csrf: session.status === 200 ? (await session.json()).csrfToken : '',
    status: response.status
  };
}

async function apiJson(cookie, csrf, method, endpoint, body) {
  const headers = { cookie };
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, data, text };
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
  return { status: response.status, location: response.headers.get('location') || '', cookie: extractCookie(response) || cookie, text: await response.text() };
}

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  unitDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-passkey-unit-'));
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-passkey-int-'));
  dbPath = path.join(tempDir, 'test.sqlite');
  process.env.WEBAUTHN_RP_ID = 'example.invalid';
  process.env.WEBAUTHN_RP_NAME = 'AWO Passkey Test';
  process.env.WEBAUTHN_ORIGIN = 'https://fuhrpark.example.invalid,https://auth.example.invalid';

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
      ADMIN_NAME: 'Passkey Admin',
      ORG_NAME: 'Passkey-Testorganisation',
      WEBAUTHN_RP_ID: 'example.invalid',
      WEBAUTHN_RP_NAME: 'AWO Passkey Test',
      WEBAUTHN_ORIGIN: 'https://fuhrpark.example.invalid,https://auth.example.invalid',
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
  insertUser(db, 'passkey-user', PASSKEY_USER_EMAIL);
  insertUser(db, 'passkey-totp', TOTP_USER_EMAIL);
  insertUser(db, 'passkey-rate', RATE_USER_EMAIL);
  insertUser(db, 'passkey-reset', RESET_USER_EMAIL);
  addPasskey(db, 'passkey-user', {
    credentialId: 'credential-user-1',
    publicKey: 'AQID',
    counter: 0,
    transports: ['internal'],
    name: 'Telefon'
  });
  addPasskey(db, 'passkey-totp', {
    credentialId: 'credential-totp-1',
    publicKey: 'AQID',
    counter: 0,
    transports: ['internal'],
    name: 'Laptop'
  });
  const encrypted = encryptSecret(TOTP_SECRET, 'passkey-totp', { dataDir: tempDir });
  setPendingSecret(db, 'passkey-totp', encrypted);
  enableMfa(db, 'passkey-totp', 0);
});

after(async () => {
  delete process.env.WEBAUTHN_RP_ID;
  delete process.env.WEBAUTHN_RP_NAME;
  delete process.env.WEBAUTHN_ORIGIN;
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

test('Migration 9→10 ist idempotent und legt Passkey-Tabellen mit FK an', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    database.pragma('user_version = 9');
    assert.equal(migratePasskeySchema(database), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), PASSKEY_SCHEMA_VERSION);
    for (const table of ['user_passkeys', 'passkey_attempts']) {
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(migratePasskeySchema(database), false);
    assert.throws(() => {
      database.prepare(`
        INSERT INTO user_passkeys (id, user_id, credential_id, public_key)
        VALUES ('p1', 'missing-user', 'cred-x', 'AQID')
      `).run();
    });
  } finally {
    database.close();
  }
});

test('Konfiguration wird ausschließlich aus WEBAUTHN_* gelesen und strikt validiert', () => {
  const config = getWebAuthnConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.rpID, 'example.invalid');
  assert.deepEqual(config.origins, ['https://fuhrpark.example.invalid', 'https://auth.example.invalid']);

  const saved = process.env.WEBAUTHN_ORIGIN;
  process.env.WEBAUTHN_ORIGIN = 'https://evil.example.net';
  assert.equal(getWebAuthnConfig().enabled, false);
  process.env.WEBAUTHN_ORIGIN = saved;
  delete process.env.WEBAUTHN_RP_ID;
  assert.equal(getWebAuthnConfig().enabled, false);
  process.env.WEBAUTHN_RP_ID = 'example.invalid';
});

test('Challenge ist sessiongebunden, einmalig und nach fünf Minuten abgelaufen', () => {
  const req = { session: {} };
  storeRegistrationChallenge(req, 'reg-challenge', 'u1');
  assert.equal(takeRegistrationChallenge(req, 'u1'), 'reg-challenge');
  assert.equal(takeRegistrationChallenge(req, 'u1'), null);

  storeAuthenticationChallenge(req, 'auth-challenge', 'u1');
  req.session.passkeyAuthentication.createdAt = Date.now() - 6 * 60 * 1000;
  assert.equal(takeAuthenticationChallenge(req, 'u1'), null);
});

test('Passkey-Speicherung: sichere Liste, Duplikat, Umbenennen und Entfernen', () => {
  const database = createDb();
  try {
    insertUser(database, 'unit-user', 'unit-passkey@example.invalid');
    const created = addPasskey(database, 'unit-user', {
      credentialId: 'credential-unit',
      publicKey: 'AQID',
      counter: 0,
      transports: ['internal', 'usb', 'unknown'],
      name: ' Laptop  '
    });
    assert.equal(created.name, 'Laptop');
    assert.deepEqual(created.transports, ['internal', 'usb']);
    assert.equal(created.credential_id, undefined);
    assert.equal(created.public_key, undefined);
    assert.equal(countPasskeys(database, 'unit-user'), 1);
    assert.equal(listPasskeys(database, 'unit-user')[0].credentialId, undefined);
    assert.throws(
      () => addPasskey(database, 'unit-user', { credentialId: 'credential-unit', publicKey: 'AQID' }),
      (error) => error.status === 409
    );
    assert.equal(renamePasskey(database, 'unit-user', created.id, 'Büro').name, 'Büro');
    assert.equal(removePasskey(database, 'unit-user', created.id).name, 'Büro');
    assert.equal(countPasskeys(database, 'unit-user'), 0);
  } finally {
    database.close();
  }
});

test('Mock-Verifier: Registrierung, Authentifizierung und Counter-Rückschritt', async () => {
  const database = createDb();
  try {
    insertUser(database, 'unit-user', 'unit-passkey@example.invalid');
    const user = database.prepare("SELECT * FROM users WHERE id = 'unit-user'").get();
    const config = getWebAuthnConfig();
    const registrationVerifier = mockVerifier();
    const registrationOptions = await buildRegistrationOptions(database, user, config, registrationVerifier);
    assert.equal(registrationOptions.challenge, 'registration-challenge');
    assert.equal(registrationVerifier.calls.registrationOptions.rpID, 'example.invalid');
    assert.deepEqual(registrationVerifier.calls.registrationOptions.authenticatorSelection.userVerification, 'required');

    const registered = await verifyRegistration(
      database,
      user,
      { id: 'cred-mock-registration' },
      registrationOptions.challenge,
      config,
      'Mock-Passkey',
      registrationVerifier
    );
    assert.equal(registered.valid, true);
    assert.equal(registered.passkey.name, 'Mock-Passkey');
    assert.deepEqual(registrationVerifier.calls.registrationVerify.expectedOrigin, config.origins);
    assert.equal(registrationVerifier.calls.registrationVerify.requireUserVerification, true);
    await assert.rejects(
      verifyRegistration(database, user, { id: 'cred-mock-registration' }, 'again', config, 'Duplikat', registrationVerifier),
      (error) => error.status === 409
    );

    addPasskey(database, 'unit-user', {
      credentialId: 'credential-counter',
      publicKey: 'AQID',
      counter: 1,
      transports: ['internal'],
      name: 'Counter'
    });
    const authVerifier = mockVerifier({ newCounter: 2 });
    const authOptions = await buildAuthenticationOptions(database, 'unit-user', config, authVerifier);
    assert.equal(authOptions.options.allowCredentials.some((entry) => entry.id === 'credential-counter'), true);
    assert.equal(authVerifier.calls.authenticationOptions.userVerification, 'required');
    const authenticated = await verifyAuthentication(
      database,
      'unit-user',
      { id: 'credential-counter' },
      authOptions.challenge,
      config,
      authVerifier,
      new Date('2026-10-28T12:00:00.000Z')
    );
    assert.equal(authenticated.valid, true);
    assert.equal(database.prepare("SELECT counter, last_used_at FROM user_passkeys WHERE credential_id = 'credential-counter'").get().counter, 2);

    const regressionVerifier = mockVerifier({ newCounter: 2 });
    addPasskey(database, 'unit-user', {
      credentialId: 'credential-regression',
      publicKey: 'AQID',
      counter: 2,
      transports: ['internal'],
      name: 'Regression'
    });
    const regression = await verifyAuthentication(
      database,
      'unit-user',
      { id: 'credential-regression' },
      'challenge',
      config,
      regressionVerifier
    );
    assert.equal(regression.valid, false);
    assert.equal(regression.reason, 'counter_regression');
    assert.equal(database.prepare("SELECT id FROM user_passkeys WHERE credential_id = 'credential-regression'").get(), undefined);
    assert.ok(database.prepare("SELECT 1 FROM audit_logs WHERE action = 'passkey_counter_regression'").get());
    assert.equal(await verifyAuthentication(database, 'unit-user', { id: 'unknown' }, 'challenge', config, regressionVerifier).then((result) => result.valid), false);
  } finally {
    database.close();
  }
});

test('Passkey-Lockout: 5 Fehlversuche für 15 Minuten', () => {
  const database = createDb();
  try {
    insertUser(database, 'unit-lock', 'unit-lock@example.invalid');
    const now = new Date('2026-10-28T10:00:00.000Z');
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = registerPasskeyFailure(database, 'unit-lock', now);
      assert.equal(result.attempts, attempt);
      assert.equal(isPasskeyLocked(database, 'unit-lock', now.getTime()), false);
    }
    const locked = registerPasskeyFailure(database, 'unit-lock', now);
    assert.ok(locked.lockedUntil);
    assert.equal(isPasskeyLocked(database, 'unit-lock', now.getTime()), true);
    clearPasskeyFailures(database, 'unit-lock');
    assert.equal(isPasskeyLocked(database, 'unit-lock', now.getTime()), false);
  } finally {
    database.close();
  }
});

test('API: Security-Status, CSRF, Passwortbestätigung und sichere Passkey-Liste', async () => {
  const admin = await startLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(admin.pending, false);
  clients.admin = admin;

  const security = await apiJson(admin.cookie, admin.csrf, 'GET', '/api/security');
  assert.equal(security.status, 200);
  assert.equal(security.data.passkeys.enabled, true);
  assert.deepEqual(security.data.passkeys.items, []);

  const noCsrf = await apiJson(admin.cookie, '', 'POST', '/api/security/passkeys/options', { password: ADMIN_PASSWORD });
  assert.equal(noCsrf.status, 403);

  const wrong = await apiJson(admin.cookie, admin.csrf, 'POST', '/api/security/passkeys/options', { password: 'falsch' });
  assert.equal(wrong.status, 400);

  const options = await apiJson(admin.cookie, admin.csrf, 'POST', '/api/security/passkeys/options', { password: ADMIN_PASSWORD });
  assert.equal(options.status, 200);
  assert.equal(typeof options.data.options.challenge, 'string');

  const adminSession = db.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL);
  const adminPasskey = addPasskey(db, adminSession.id, {
    credentialId: 'credential-admin-2',
    publicKey: 'AQID',
    counter: 0,
    transports: ['internal'],
    name: 'Admin Laptop'
  });
  const safeState = await apiJson(admin.cookie, admin.csrf, 'GET', '/api/state');
  assert.equal(safeState.status, 200);
  assert.equal(safeState.data.security.passkeys[0].name, 'Admin Laptop');
  assert.equal(safeState.text.includes('credential-admin-2'), false);
  assert.equal(safeState.text.includes('AQID'), false);
  const exported = await apiJson(admin.cookie, admin.csrf, 'GET', '/api/export/data.json');
  assert.equal(exported.status, 200);
  assert.equal(exported.text.includes('credential-admin-2'), false);
  assert.equal(exported.text.includes('AQID'), false);
  removePasskey(db, adminSession.id, adminPasskey.id);
});

test('API: Pending-Passkey-Login, CSRF und TOTP-Fallback', async () => {
  const pending = await startLogin(PASSKEY_USER_EMAIL);
  assert.equal(pending.pending, true);
  assert.match(pending.page, /data-enabled="1"/);
  const noCsrf = await apiJson(pending.cookie, '', 'POST', '/api/auth/passkey/options', {});
  assert.equal(noCsrf.status, 403);
  const options = await apiJson(pending.cookie, pending.csrf, 'POST', '/api/auth/passkey/options', {});
  assert.equal(options.status, 200);
  assert.equal(options.data.options.allowCredentials[0].id, 'credential-user-1');
  const cancel = await formPost('/login/mfa/cancel', pending.cookie, { _csrf: pending.csrf });
  assert.equal(cancel.status, 303);
  assert.equal(cancel.location, '/login');

  const totpPending = await startLogin(TOTP_USER_EMAIL);
  assert.equal(totpPending.pending, true);
  assert.match(totpPending.page, /data-enabled="1"/);
  assert.match(totpPending.page, /name="code"/);
  const code = totp(TOTP_SECRET, { now: Date.now() + 30_000 });
  const totpLogin = await formPost('/login/mfa', totpPending.cookie, { _csrf: totpPending.csrf, code });
  assert.equal(totpLogin.status, 303);
  assert.equal(totpLogin.location, '/');
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie: totpLogin.cookie } });
  assert.equal(session.status, 200);
});

test('API: Passkey umbenennen, entfernen und Sitzungen beenden', async () => {
  const admin = await startLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL).id;
  const passkey = addPasskey(db, userId, {
    credentialId: 'credential-admin-3',
    publicKey: 'AQID',
    counter: 0,
    transports: ['internal'],
    name: 'Alt'
  });
  const renamed = await apiJson(admin.cookie, admin.csrf, 'PATCH', `/api/security/passkeys/${passkey.id}`, { name: 'Neu' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.passkey.name, 'Neu');
  const removed = await apiJson(admin.cookie, admin.csrf, 'DELETE', `/api/security/passkeys/${passkey.id}`);
  assert.equal(removed.status, 200);
  const invalidated = await fetch(`${baseUrl}/api/session`, { headers: { cookie: admin.cookie } });
  assert.equal(invalidated.status, 401);
});

test('API: Admin-Reset löscht Passkeys und Ziel-Sitzungen, Audit ohne Credential-Daten', async () => {
  const target = await startLogin(RESET_USER_EMAIL);
  assert.equal(target.pending, false);
  const targetRow = db.prepare('SELECT id FROM users WHERE email = ?').get(RESET_USER_EMAIL);
  addPasskey(db, targetRow.id, {
    credentialId: 'credential-reset-1',
    publicKey: 'AQID',
    counter: 0,
    transports: ['internal'],
    name: 'Reset-Gerät'
  });
  const admin = await startLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const reset = await apiJson(admin.cookie, admin.csrf, 'POST', `/api/security/admin-reset/${targetRow.id}`, {});
  assert.equal(reset.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_passkeys WHERE user_id = ?').get(targetRow.id).count, 0);
  const targetSession = await fetch(`${baseUrl}/api/session`, { headers: { cookie: target.cookie } });
  assert.equal(targetSession.status, 401);
  const audits = db.prepare("SELECT action, details FROM audit_logs WHERE action IN ('mfa_reset', 'passkey_reset')").all();
  assert.ok(audits.some((entry) => entry.action === 'mfa_reset'));
  assert.ok(audits.some((entry) => entry.action === 'passkey_reset'));
  for (const entry of audits) {
    assert.equal(String(entry.details).includes('credential-reset-1'), false);
    assert.equal(String(entry.details).includes('AQID'), false);
  }
});

test('API: Account-Lockout nach fünf falschen Passwortbestätigungen', async () => {
  const rate = await startLogin(RATE_USER_EMAIL);
  assert.equal(rate.pending, false);
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await apiJson(rate.cookie, rate.csrf, 'POST', '/api/security/passkeys/options', { password: 'falsch' });
  }
  assert.equal(last.status, 429);
  const correct = await apiJson(rate.cookie, rate.csrf, 'POST', '/api/security/passkeys/options', { password: TEST_PASSWORD });
  assert.equal(correct.status, 429);
});

test('API: ungültige Passkey-Assertion erzeugt Audit und generische Antwort', async () => {
  const pending = await startLogin(PASSKEY_USER_EMAIL);
  assert.equal(pending.pending, true);
  const options = await apiJson(pending.cookie, pending.csrf, 'POST', '/api/auth/passkey/options', {});
  assert.equal(options.status, 200);
  const failed = await apiJson(pending.cookie, pending.csrf, 'POST', '/api/auth/passkey/verify', {
    response: { id: 'credential-user-1' }
  });
  assert.equal(failed.status, 401);
  assert.match(failed.data.error, /TOTP|Recovery/);
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'passkey_login_failed'").get());
});
