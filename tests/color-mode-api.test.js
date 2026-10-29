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

const ROOT = path.join(__dirname, '..');
const TEST_PASSWORD = 'Darkmode-Test-2026';
const ADMIN_EMAIL = 'dark-admin@example.invalid';
const MANAGER_EMAIL = 'dark-manager@example.invalid';
const VIEWER_EMAIL = 'dark-viewer@example.invalid';
const OTHER_EMAIL = 'dark-other@example.invalid';

let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let serverOutput = '';
const cookies = {};
const sessions = {};

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

async function login(email) {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'CSRF-Token der Anmeldeseite fehlt');
  const firstCookie = extractCookie(page);
  assert.ok(firstCookie, 'Session-Cookie der Anmeldeseite fehlt');
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body: new URLSearchParams({ _csrf: csrf, email, password: TEST_PASSWORD })
  });
  assert.equal(response.status, 303, `Anmeldung für ${email} fehlgeschlagen`);
  const cookie = extractCookie(response) || firstCookie;
  const sessionResponse = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  session.csrf = session.csrfToken;
  cookies[email] = cookie;
  sessions[email] = session;
  return { cookie, csrf: session.csrfToken, session };
}

async function apiGet(email, endpoint) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { cookie: cookies[email] },
    redirect: 'manual'
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text, headers: response.headers };
}

async function apiJson(email, method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: cookies[email],
      'x-csrf-token': sessions[email]?.csrf || '',
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text };
}

async function htmlGet(email, endpoint = '/') {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: email ? { cookie: cookies[email] } : {},
    redirect: 'manual'
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

function insertRole(id, name, rank, permissions) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES (?, ?, ?, '{}', 0, ?, ?, ?)
  `).run(id, name, JSON.stringify(permissions), rank, now, now);
}

function insertUser(id, email, role, colorMode = null) {
  const hash = bcrypt.hashSync(TEST_PASSWORD, 4);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, color_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(id, email, id, hash, role, colorMode, now, now);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-color-mode-api-'));
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
      ADMIN_PASSWORD: TEST_PASSWORD,
      ADMIN_NAME: 'Darkmode Admin',
      ORG_NAME: 'Darkmode-Testorganisation',
      ORG_LOCATION: 'Bremerhaven',
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

  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  insertRole('role-viewer', 'Nur Lesen', 100000, ['vehicles_view']);
  insertUser('user-manager', MANAGER_EMAIL, 'manager');
  insertUser('user-viewer', VIEWER_EMAIL, 'role-viewer');
  insertUser('user-other', OTHER_EMAIL, 'role-viewer');

  await login(ADMIN_EMAIL);
  await login(MANAGER_EMAIL);
  await login(VIEWER_EMAIL);
  await login(OTHER_EMAIL);
});

after(async () => {
  try { db.close(); } catch { /* bereits geschlossen */ }
  if (child) {
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('Migration 8 und State-/Session-Defaults', async () => {
  assert.equal(Number(db.pragma('user_version', { simple: true })), 18);
  assert.ok(db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'color_mode'));
  assert.ok(db.prepare('PRAGMA table_info(settings)').all().some((column) => column.name === 'default_color_mode'));
  assert.equal(db.prepare('SELECT default_color_mode FROM settings WHERE id = 1').get().default_color_mode, 'light');

  const state = await apiGet(ADMIN_EMAIL, '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.settings.defaultColorMode, 'light');
  assert.equal(state.data.users.find((user) => user.email === ADMIN_EMAIL).colorMode, null);
  assert.equal(state.data.users.find((user) => user.email === ADMIN_EMAIL).resolvedColorMode, 'light');

  const session = await apiGet(ADMIN_EMAIL, '/api/session');
  assert.equal(session.data.user.colorMode, null);
  assert.equal(session.data.user.resolvedColorMode, 'light');
});

test('Eigene Präferenz: light/dark/auto, fremde IDs werden ignoriert, ungültige Modi 400', async () => {
  const dark = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/me/preferences', {
    colorMode: 'dark',
    userId: 'user-other',
    email: OTHER_EMAIL
  });
  assert.equal(dark.status, 200, dark.text);
  assert.equal(dark.data.user.colorMode, 'dark');
  assert.equal(dark.data.user.resolvedColorMode, 'dark');
  assert.equal(db.prepare('SELECT color_mode FROM users WHERE id = ?').get('user-other').color_mode, null);

  const auto = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/me/preferences', { colorMode: 'auto' });
  assert.equal(auto.status, 200, auto.text);
  assert.equal(auto.data.user.colorMode, 'auto');
  assert.equal(auto.data.user.resolvedColorMode, 'light');

  const invalid = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/me/preferences', { colorMode: 'system' });
  assert.equal(invalid.status, 400);
  assert.equal(db.prepare('SELECT color_mode FROM users WHERE id = ?').get('user-other').color_mode, null);

  const session = await apiGet(ADMIN_EMAIL, '/api/session');
  assert.equal(session.data.user.colorMode, 'auto');
  assert.equal(session.data.user.resolvedColorMode, 'light');
});

test('Globaler Default nur mit settings_manage; Manager darf, Viewer nicht', async () => {
  const viewer = await apiJson(VIEWER_EMAIL, 'PATCH', '/api/settings', {
    orgName: 'Darkmode-Testorganisation',
    defaultColorMode: 'dark'
  });
  assert.equal(viewer.status, 403);

  const invalid = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/settings', {
    orgName: 'Darkmode-Testorganisation',
    defaultColorMode: 'system'
  });
  assert.equal(invalid.status, 400);

  const manager = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/settings', {
    orgName: 'Darkmode-Testorganisation',
    defaultColorMode: 'dark'
  });
  assert.equal(manager.status, 200, manager.text);
  assert.equal(manager.data.settings.defaultColorMode, 'dark');

  const viewerSession = await apiGet(VIEWER_EMAIL, '/api/session');
  assert.equal(viewerSession.data.user.colorMode, null);
  assert.equal(viewerSession.data.user.resolvedColorMode, 'dark');

  const auto = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/settings', {
    orgName: 'Darkmode-Testorganisation',
    defaultColorMode: 'auto'
  });
  assert.equal(auto.status, 200, auto.text);
  assert.equal(auto.data.settings.defaultColorMode, 'auto');

  const viewerSessionAuto = await apiGet(VIEWER_EMAIL, '/api/session');
  assert.equal(viewerSessionAuto.data.user.resolvedColorMode, 'light');
});

test('Rendering setzt data-color-mode serverseitig und Bootstrap vor CSS', async () => {
  const admin = await htmlGet(ADMIN_EMAIL, '/');
  assert.equal(admin.status, 200);
  assert.match(admin.text, /data-color-mode="auto"/);
  assert.match(admin.text, /data-color-mode-preference="auto"/);
  assert.ok(admin.text.indexOf('<script>') < admin.text.indexOf('styles.css'), 'Bootstrap-Script muss vor CSS stehen');
  const csp = admin.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src[^;]*sha256-/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);

  await apiJson(ADMIN_EMAIL, 'PATCH', '/api/me/preferences', { colorMode: 'dark' });
  const dark = await htmlGet(ADMIN_EMAIL, '/');
  assert.match(dark.text, /data-color-mode="dark"/);
  assert.match(dark.text, /data-color-mode-preference="dark"/);

  const loginAuto = await htmlGet(null, '/login');
  assert.equal(loginAuto.status, 200);
  assert.match(loginAuto.text, /data-color-mode="auto"/);
  assert.match(loginAuto.text, /data-color-mode-preference="auto"/);
  assert.ok(loginAuto.text.indexOf('<script>') < loginAuto.text.indexOf('login.css'));

  await apiJson(ADMIN_EMAIL, 'PATCH', '/api/settings', {
    orgName: 'Darkmode-Testorganisation',
    defaultColorMode: 'dark'
  });
  const loginDark = await htmlGet(null, '/login');
  assert.match(loginDark.text, /data-color-mode="dark"/);
});

test('Audit speichert nur den Farbmodus', () => {
  const preference = db.prepare("SELECT details FROM audit_logs WHERE entity_type = 'user' AND action = 'update' AND entity_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1").get(ADMIN_EMAIL);
  assert.ok(preference);
  const details = JSON.parse(preference.details);
  assert.deepEqual(Object.keys(details), ['colorMode']);
  assert.equal(details.colorMode, 'dark');

  const settingsAudit = db.prepare("SELECT details FROM audit_logs WHERE entity_type = 'settings' ORDER BY id DESC LIMIT 1").get();
  assert.ok(settingsAudit);
  assert.match(settingsAudit.details, /defaultColorMode/);
});
