'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const { base32Encode, totp, verifyTotp, generateTotpSecret } = require('../server/lib/totp');
const { encryptSecret, decryptSecret, generateRecoveryCodes, hashRecoveryCode } = require('../server/lib/mfa-crypto');
const { migrateMfaSchema } = require('../server/lib/mfa-schema');
const {
  setPendingSecret,
  enableMfa,
  issueRecoveryCodes,
  verifyRecoveryForUser,
  registerFailure,
  getMfaRow,
  LOCK_MS
} = require('../server/lib/mfa');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'MFA-Test-2026!';
const ADMIN_EMAIL = 'admin-mfa@example.invalid';
const ADMIN_PASSWORD = 'Admin-MFA-Test-2026!';
const SUPER_EMAIL = 'superadmin-mfa@example.invalid';
const SUPER_PASSWORD = 'Superadmin-MFA-Test-2026!';
const VIEWER_EMAIL = 'viewer-mfa@example.invalid';
const RECOVERY_EMAIL = 'recovery-mfa@example.invalid';
const RATE_EMAIL = 'rate-mfa@example.invalid';
const RESET_EMAIL = 'reset-mfa@example.invalid';
const MANAGER_EMAIL = 'manager-mfa@example.invalid';
const ADMIN_TWO_EMAIL = 'admin-two-mfa@example.invalid';

const TEST_ROOT = process.platform === 'win32' ? 'C:\\opencode\\tmp' : os.tmpdir();

let tempDir;
let dataDir;
let dbPath;
let superadminFile;
let child;
let baseUrl;
let db;
let serverOutput = '';
const cookies = {};
const sessions = {};
const users = {};

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

async function startLogin(email, password = PASSWORD) {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  const csrf = csrfFrom(html);
  const firstCookie = extractCookie(page);
  assert.ok(csrf, 'CSRF-Token der Anmeldeseite fehlt');
  assert.ok(firstCookie, 'Session-Cookie der Anmeldeseite fehlt');
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
    return { pending: true, cookie, csrf: csrfFrom(mfaHtml), status: response.status, location };
  }
  return { pending: false, cookie, status: response.status, location };
}

async function finishMfa(pending, code, useRecovery = false) {
  const body = new URLSearchParams({ _csrf: pending.csrf, code });
  if (useRecovery) body.set('useRecovery', '1');
  const response = await fetch(`${baseUrl}/login/mfa`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: pending.cookie
    },
    body
  });
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    cookie: extractCookie(response) || pending.cookie,
    text: await response.text()
  };
}

async function apiRequest(cookie, csrf, method, endpoint, body) {
  const headers = { cookie: cookie || '' };
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
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text, headers: response.headers };
}

async function loadSession(cookie) {
  const response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(response.status, 200, 'Session konnte nicht geladen werden');
  return response.json();
}

async function loginAs(key, email, password = PASSWORD) {
  const started = await startLogin(email, password);
  assert.equal(started.status, 303);
  assert.equal(started.pending, false, `Für ${email} wurde unerwartet MFA verlangt`);
  const session = await loadSession(started.cookie);
  cookies[key] = started.cookie;
  sessions[key] = { csrf: session.csrfToken, data: session };
  return sessions[key];
}

async function enableMfaFor(key, cookie, csrf) {
  const start = await apiRequest(cookie, csrf, 'POST', '/api/security/totp/enroll/start');
  assert.equal(start.status, 200, start.text);
  const secret = start.data.secret;
  const confirm = await apiRequest(cookie, csrf, 'POST', '/api/security/totp/enroll/confirm', {
    code: totp(secret)
  });
  assert.equal(confirm.status, 200, confirm.text);
  assert.equal(confirm.data.recoveryCodes.length, 10);
  assert.equal(confirm.data.security.totpEnabled, true);
  return { secret, recoveryCodes: confirm.data.recoveryCodes };
}

function nextStepCode(secret) {
  return totp(secret, { now: Date.now() + 30_000 });
}

function addUser(id, email, name, role) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, name, bcrypt.hashSync(PASSWORD, 4), role, now, now);
  users[id] = { id, email, name, role };
}

before(async () => {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(TEST_ROOT, 'awo-mfa-'));
  dataDir = path.join(tempDir, 'data');
  dbPath = path.join(dataDir, 'test.sqlite');
  superadminFile = path.join(tempDir, 'superadmin.json');
  fs.mkdirSync(path.dirname(superadminFile), { recursive: true });
  fs.writeFileSync(superadminFile, JSON.stringify({
    email: SUPER_EMAIL,
    name: 'Superadmin MFA Test',
    passwordHash: bcrypt.hashSync(SUPER_PASSWORD, 12)
  }), { encoding: 'utf8', mode: 0o600 });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      DB_PATH: dbPath,
      UPLOAD_DIR: path.join(dataDir, 'uploads'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ADMIN_NAME: 'MFA Admin',
      ORG_NAME: 'MFA-Testorganisation',
      SUPERADMIN_FILE: superadminFile,
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      LEASING_SCHEDULER_DISABLED: 'true',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  await waitForHealth();
  assert.ok(fs.existsSync(path.join(dataDir, 'mfa.key')), 'MFA-Schlüsseldatei wurde beim Start nicht erzeugt');
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
    VALUES ('viewer', 'Testbetrachter', '[]', '{}', '{"allow":[],"deny":[]}', 0, 100000, ?, ?)
  `).run(now, now);

  addUser('viewer-self', VIEWER_EMAIL, 'Viewer Self', 'viewer');
  addUser('viewer-recovery', RECOVERY_EMAIL, 'Viewer Recovery', 'viewer');
  addUser('viewer-rate', RATE_EMAIL, 'Viewer Rate', 'viewer');
  addUser('viewer-reset', RESET_EMAIL, 'Viewer Reset', 'viewer');
  addUser('manager-test', MANAGER_EMAIL, 'Manager Test', 'manager');
  addUser('admin-two', ADMIN_TWO_EMAIL, 'Admin Two', 'admin');
});

after(async () => {
  try { db?.close(); } catch { /* ignore */ }
  if (child) {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(3000)
    ]);
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('TOTP folgt RFC 6238 (SHA-1, 6 Stellen) und akzeptiert ±1 Zeitschritt', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130']
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totp(secret, { now: seconds * 1000 }), expected);
  }

  const now = 1_700_000_000_000;
  const currentStep = Math.floor(now / 1000 / 30);
  const previous = totp(secret, { now: now - 30_000 });
  const current = totp(secret, { now });
  const next = totp(secret, { now: now + 30_000 });
  assert.equal(verifyTotp(secret, previous, { now }).valid, true);
  assert.equal(verifyTotp(secret, current, { now }).valid, true);
  assert.equal(verifyTotp(secret, next, { now }).valid, true);
  assert.equal(verifyTotp(secret, totp(secret, { now: now + 60_000 }), { now }).valid, false);
  assert.equal(verifyTotp(secret, current, { now, lastUsedStep: currentStep }).replay, true);
  assert.equal(verifyTotp(secret, current, { now }).step, currentStep);
});

test('AES-256-GCM verschlüsselt mit zufälligem IV und bindet AAD an user_id', () => {
  const dir = fs.mkdtempSync(path.join(TEST_ROOT, 'awo-mfa-crypto-'));
  try {
    const first = encryptSecret('JBSWY3DPEHPK3PXP', 'user-a', { dataDir: dir });
    const second = encryptSecret('JBSWY3DPEHPK3PXP', 'user-a', { dataDir: dir });
    assert.notEqual(first, second);
    assert.equal(first.includes('JBSWY3DPEHPK3PXP'), false);
    assert.equal(decryptSecret(first, 'user-a', { dataDir: dir }), 'JBSWY3DPEHPK3PXP');
    assert.throws(() => decryptSecret(first, 'user-b', { dataDir: dir }));
    const key = fs.readFileSync(path.join(dir, 'mfa.key'), 'utf8').trim();
    assert.equal(Buffer.from(key, 'base64').length, 32);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Ungültige MFA-Schlüsseldatei wird nicht still überschrieben', () => {
  const dir = fs.mkdtempSync(path.join(TEST_ROOT, 'awo-mfa-key-'));
  try {
    const file = path.join(dir, 'mfa.key');
    fs.writeFileSync(file, 'kein-gueltiger-schluessel', 'utf8');
    assert.throws(() => encryptSecret('secret', 'user-a', { dataDir: dir }), /kein gültiger MFA-Schlüssel/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'kein-gueltiger-schluessel');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Recovery-Codes sind einmalig, normalisiert und werden bei Neuausgabe invalidiert', () => {
  const dir = fs.mkdtempSync(path.join(TEST_ROOT, 'awo-mfa-recovery-'));
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    database.prepare('INSERT INTO users (id) VALUES (?)').run('user-1');
    migrateMfaSchema(database);
    const secret = generateTotpSecret();
    setPendingSecret(database, 'user-1', encryptSecret(secret, 'user-1', { dataDir: dir }));
    enableMfa(database, 'user-1', 0);
    const firstCodes = issueRecoveryCodes(database, 'user-1', { dataDir: dir });
    assert.equal(firstCodes.length, 10);
    assert.equal(new Set(firstCodes).size, 10);
    for (const code of firstCodes) assert.match(code, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    assert.equal(hashRecoveryCode(firstCodes[0].toLowerCase().replace(/-/g, ' '), { dataDir: dir }), hashRecoveryCode(firstCodes[0], { dataDir: dir }));

    const first = verifyRecoveryForUser(database, 'user-1', firstCodes[0], { dataDir: dir });
    assert.equal(first.valid, true);
    const reused = verifyRecoveryForUser(database, 'user-1', firstCodes[0], { dataDir: dir });
    assert.equal(reused.valid, false);

    const secondCodes = issueRecoveryCodes(database, 'user-1', { dataDir: dir });
    assert.equal(verifyRecoveryForUser(database, 'user-1', firstCodes[1], { dataDir: dir }).valid, false);
    assert.equal(verifyRecoveryForUser(database, 'user-1', secondCodes[0], { dataDir: dir }).valid, true);
  } finally {
    database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MFA-Migration 7→8 ist idempotent, referenziert users und setzt Fremdschlüssel', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    database.pragma('user_version = 7');
    assert.equal(migrateMfaSchema(database), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), 8);
    for (const table of ['user_mfa', 'mfa_recovery_codes']) {
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(migrateMfaSchema(database), false);
    assert.equal(Number(database.pragma('user_version', { simple: true })), 8);
    assert.throws(() => {
      database.prepare('INSERT INTO mfa_recovery_codes (id, user_id, code_hash, batch_id) VALUES (?, ?, ?, ?)')
        .run('code-1', 'missing-user', 'hash', 'batch');
    });
  } finally {
    database.close();
  }
});

test('Fehlversuche werden nach 5 Versuchen für 15 Minuten gesperrt', () => {
  const dir = fs.mkdtempSync(path.join(TEST_ROOT, 'awo-mfa-lock-'));
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    database.prepare('INSERT INTO users (id) VALUES (?)').run('user-lock');
    migrateMfaSchema(database);
    setPendingSecret(database, 'user-lock', encryptSecret(generateTotpSecret(), 'user-lock', { dataDir: dir }));
    const base = new Date('2026-10-28T10:00:00.000Z');
    let last;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      last = registerFailure(database, 'user-lock', base);
      assert.equal(last.justLocked, false);
      assert.equal(last.attempts, attempt);
    }
    last = registerFailure(database, 'user-lock', base);
    assert.equal(last.justLocked, true);
    const row = getMfaRow(database, 'user-lock');
    assert.ok(row.locked_until);
    assert.equal(Date.parse(row.locked_until) - base.getTime(), LOCK_MS);
  } finally {
    database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Self-Service: Enrollment, Status, Deaktivierung und UI-Bausteine ohne Secrets im State', async () => {
  const session = await loginAs('self', VIEWER_EMAIL);
  const initial = await apiRequest(cookies.self, session.csrf, 'GET', '/api/security');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.security.totpEnabled, false);

  const { secret, recoveryCodes } = await enableMfaFor('self', cookies.self, session.csrf);
  const status = await apiRequest(cookies.self, session.csrf, 'GET', '/api/security');
  assert.equal(status.data.security.totpEnabled, true);
  assert.equal(status.data.security.recoveryCodesRemaining, 10);

  const state = await apiRequest(cookies.self, session.csrf, 'GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.security.totpEnabled, true);
  const stateText = JSON.stringify(state.data);
  assert.equal(stateText.includes(secret), false);
  assert.equal(stateText.includes(recoveryCodes[0]), false);
  assert.equal(stateText.includes('totp_secret_enc'), false);
  assert.equal(stateText.includes('code_hash'), false);

  const disabled = await apiRequest(cookies.self, session.csrf, 'POST', '/api/security/totp/disable', {
    code: nextStepCode(secret)
  });
  assert.equal(disabled.status, 200, disabled.text);
  assert.equal(disabled.data.security.totpEnabled, false);

  const views = fs.readFileSync(path.join(ROOT, 'public', 'views.js'), 'utf8');
  const modals = fs.readFileSync(path.join(ROOT, 'public', 'modals.js'), 'utf8');
  const loginMfa = fs.readFileSync(path.join(ROOT, 'server', 'views', 'login-mfa.html'), 'utf8');
  assert.ok(views.includes('Sicherheit'));
  assert.ok(views.includes('data-action="mfa-enroll"'));
  assert.ok(views.includes('data-action="mfa-disable"'));
  assert.ok(views.includes('data-action="mfa-regenerate"'));
  assert.ok(views.includes('data-action="mfa-admin-reset"'));
  assert.ok(modals.includes('recovery-codes'));
  assert.ok(modals.includes("autocomplete=\"one-time-code\""));
  assert.ok(loginMfa.includes('action="/login/mfa"'));
  assert.ok(loginMfa.includes('name="useRecovery"'));
  assert.ok(loginMfa.includes('action="/login/mfa/cancel"'));
  assert.ok(loginMfa.includes('autocomplete="one-time-code"'));
});

test('Login mit MFA: Pending-Session, Session-Regeneration, Recovery einmalig', async () => {
  const session = await loginAs('recovery', RECOVERY_EMAIL);
  const { secret, recoveryCodes } = await enableMfaFor('recovery', cookies.recovery, session.csrf);

  const started = await startLogin(RECOVERY_EMAIL);
  assert.equal(started.pending, true);
  assert.equal(started.location, '/login/mfa');

  const pendingHome = await fetch(`${baseUrl}/`, { headers: { cookie: started.cookie }, redirect: 'manual' });
  assert.ok([302, 303].includes(pendingHome.status));
  assert.equal(pendingHome.headers.get('location'), '/login/mfa');
  const pendingApi = await apiRequest(started.cookie, '', 'GET', '/api/state');
  assert.equal(pendingApi.status, 401);

  const success = await finishMfa(started, nextStepCode(secret));
  assert.equal(success.status, 303);
  assert.equal(success.location, '/');
  assert.notEqual(success.cookie, started.cookie);
  const afterLogin = await apiRequest(success.cookie, '', 'GET', '/api/session');
  assert.equal(afterLogin.status, 200);

  const logout = await apiRequest(success.cookie, afterLogin.data.csrfToken, 'POST', '/api/auth/logout');
  assert.equal(logout.status, 204);

  const recoveryLogin = await startLogin(RECOVERY_EMAIL);
  const recoverySuccess = await finishMfa(recoveryLogin, recoveryCodes[0], true);
  assert.equal(recoverySuccess.status, 303);
  assert.equal(recoverySuccess.location, '/');
  assert.notEqual(recoverySuccess.cookie, recoveryLogin.cookie);

  const recoverySession = await apiRequest(recoverySuccess.cookie, '', 'GET', '/api/session');
  await apiRequest(recoverySuccess.cookie, recoverySession.data.csrfToken, 'POST', '/api/auth/logout');

  const replayPending = await startLogin(RECOVERY_EMAIL);
  const replay = await finishMfa(replayPending, recoveryCodes[0], true);
  assert.equal(replay.status, 401);
  assert.ok(replay.text.includes('nicht gültig'));

  const secondRecovery = await finishMfa(replayPending, recoveryCodes[1], true);
  assert.equal(secondRecovery.status, 303);
  assert.equal(secondRecovery.location, '/');
});

test('Rate-Limit: 5 Fehlversuche sperren das Konto, Audit ohne Geheimnisse', async () => {
  const session = await loginAs('rate', RATE_EMAIL);
  const { secret } = await enableMfaFor('rate', cookies.rate, session.csrf);

  const pending = await startLogin(RATE_EMAIL);
  let current = pending;
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    last = await finishMfa(current, '000000');
    current = { ...current, cookie: last.cookie };
  }
  assert.equal(last.status, 429);
  assert.ok(last.text.includes('Zu viele Fehlversuche'));

  const locked = await finishMfa(current, nextStepCode(secret));
  assert.equal(locked.status, 429);

  const audit = db.prepare("SELECT action, details FROM audit_logs WHERE action IN ('mfa_verify_failed', 'mfa_locked')").all();
  assert.ok(audit.some((entry) => entry.action === 'mfa_verify_failed'));
  assert.ok(audit.some((entry) => entry.action === 'mfa_locked'));
  for (const entry of audit) {
    assert.equal(String(entry.details).includes('000000'), false);
    assert.equal(String(entry.details).includes(secret), false);
  }
});

test('Admin-Reset: strikt niedriger Rang erlaubt, Gleichrang/Self/Manager verboten, Superadmin darf alles', async () => {
  const targetSession = await loginAs('resetTarget', RESET_EMAIL);
  await enableMfaFor('resetTarget', cookies.resetTarget, targetSession.csrf);

  const adminSession = await loginAs('admin', ADMIN_EMAIL, ADMIN_PASSWORD);
  const ownReset = await apiRequest(cookies.admin, adminSession.csrf, 'POST', `/api/security/admin-reset/${encodeURIComponent(adminSession.data.user.id)}`);
  assert.equal(ownReset.status, 400);

  const targetReset = await apiRequest(cookies.admin, adminSession.csrf, 'POST', `/api/security/admin-reset/${encodeURIComponent('viewer-reset')}`);
  assert.equal(targetReset.status, 200, targetReset.text);
  assert.equal(getMfaRow(db, 'viewer-reset'), null);
  const targetAfter = await apiRequest(cookies.resetTarget, '', 'GET', '/api/session');
  assert.equal(targetAfter.status, 401);

  const sameRank = await apiRequest(cookies.admin, adminSession.csrf, 'POST', '/api/security/admin-reset/admin-two');
  assert.equal(sameRank.status, 403);

  const noMfaTarget = await apiRequest(cookies.admin, adminSession.csrf, 'POST', '/api/security/admin-reset/manager-test');
  assert.equal(noMfaTarget.status, 409);

  const managerSession = await loginAs('manager', MANAGER_EMAIL);
  const managerReset = await apiRequest(cookies.manager, managerSession.csrf, 'POST', '/api/security/admin-reset/viewer-self');
  assert.equal(managerReset.status, 403);

  const adminTwoSession = await loginAs('adminTwo', ADMIN_TWO_EMAIL);
  await enableMfaFor('adminTwo', cookies.adminTwo, adminTwoSession.csrf);
  const superSession = await loginAs('super', SUPER_EMAIL, SUPER_PASSWORD);
  const superReset = await apiRequest(cookies.super, superSession.csrf, 'POST', '/api/security/admin-reset/admin-two');
  assert.equal(superReset.status, 200, superReset.text);
  assert.equal(getMfaRow(db, 'admin-two'), null);

  const adminState = await apiRequest(cookies.admin, adminSession.csrf, 'GET', '/api/state');
  const recoveryUser = adminState.data.users.find((entry) => entry.id === 'viewer-recovery');
  assert.equal(recoveryUser.mfaEnabled, true);
  assert.equal(recoveryUser.canResetMfa, true);
  const adminTwo = adminState.data.users.find((entry) => entry.id === 'admin-two');
  assert.equal(adminTwo.canResetMfa, false);
  const withoutMfa = adminState.data.users.find((entry) => entry.id === 'viewer-self');
  assert.equal(withoutMfa.mfaEnabled, false);
  assert.equal(withoutMfa.canResetMfa, false);

  const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'mfa_reset' ORDER BY created_at").all();
  assert.ok(audit.length >= 2);
  for (const entry of audit) {
    assert.equal(String(entry.details).includes('totp_secret_enc'), false);
    assert.equal(String(entry.details).includes('code_hash'), false);
  }
});

test('State, Export und Serverlog enthalten keine MFA-Geheimnisse', async () => {
  const adminSession = await loginAs('audit', ADMIN_EMAIL, ADMIN_PASSWORD);
  const state = await apiRequest(cookies.audit, adminSession.csrf, 'GET', '/api/state');
  assert.equal(state.status, 200);
  const exportResponse = await apiRequest(cookies.audit, adminSession.csrf, 'GET', '/api/export/data.json');
  assert.equal(exportResponse.status, 200);

  const row = db.prepare("SELECT totp_secret_enc FROM user_mfa WHERE user_id = 'viewer-recovery'").get();
  assert.ok(row?.totp_secret_enc);
  const secret = decryptSecret(row.totp_secret_enc, 'viewer-recovery', { dataDir });
  const recoveryHash = db.prepare("SELECT code_hash FROM mfa_recovery_codes WHERE user_id = 'viewer-recovery' LIMIT 1").get()?.code_hash;
  assert.ok(secret);
  assert.ok(recoveryHash);

  for (const text of [state.text, exportResponse.text, serverOutput]) {
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(recoveryHash), false);
    assert.equal(text.includes('totp_secret_enc'), false);
    assert.equal(text.includes('code_hash'), false);
  }
});
