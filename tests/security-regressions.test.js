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

const { normalizePermissions } = require('../server/lib/permissions');

const ROOT = path.join(__dirname, '..');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const TEST_PASSWORD = 'Security-Regression-Test-2026';
const ADMIN_EMAIL = 'security-admin@example.invalid';
const MANAGER_EMAIL = 'security-manager@example.invalid';
const VIEWER_EMAIL = 'security-viewer@example.invalid';

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
  clients[email] = { cookie, csrf: session.csrfToken, session };
}

async function apiJson(email, method, endpoint, body) {
  const client = clients[email];
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: client.cookie,
      'x-csrf-token': client.csrf,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, data, text };
}

function vehiclePayload(overrides = {}) {
  return {
    name: 'Upload-Testfahrzeug',
    plate: 'HB-U 1',
    type: 'Pkw',
    fuel: 'Diesel',
    seats: 5,
    status: 'available',
    location: 'Hof',
    department: 'Test',
    mileage: 1000,
    nextService: '',
    tuv: '',
    insurance: '',
    notes: '',
    color: '#2563eb',
    blocked: false,
    blockedReason: '',
    ...overrides
  };
}

function insertRole(id, name, rank, permissions) {  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES (?, ?, ?, '{}', 0, ?, ?, ?)
  `).run(id, name, JSON.stringify(normalizePermissions(permissions)), rank, now, now);
}

function insertUser(id, email, role) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, id, bcrypt.hashSync(TEST_PASSWORD, 4), role, now, now);
}

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-security-regressions-'));
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
      ADMIN_NAME: 'Security Admin',
      ORG_NAME: 'Security-Testorganisation',
      ORG_LOCATION: 'Bremerhaven',
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
  insertRole('role-manager-test', 'Manager Test', 900000, [
    'vehicles_view', 'vehicles_manage', 'bookings_view', 'bookings_create', 'bookings_manage',
    'maintenance_view', 'maintenance_manage', 'costs_view', 'costs_manage', 'logbook_view', 'logbook_manage'
  ]);
  insertRole('role-viewer-test', 'Viewer Test', 100000, ['vehicles_view']);
  insertUser('user-manager-test', MANAGER_EMAIL, 'role-manager-test');
  insertUser('user-viewer-test', VIEWER_EMAIL, 'role-viewer-test');

  await login(ADMIN_EMAIL);
  await login(MANAGER_EMAIL);
  await login(VIEWER_EMAIL);
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

test('QS-010: Rollen-Patch ohne permissions erhält bestehende Rechte', async () => {
  insertRole('role-qs010', 'Rolle mit Rechten', 100000, ['vehicles_view', 'bookings_view']);
  const expected = normalizePermissions(['vehicles_view', 'bookings_view']);
  const before = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id = 'role-qs010'").get().permissions);
  assert.deepEqual(before, expected);

  const response = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/roles/role-qs010', {
    name: 'Rolle umbenannt'
  });
  assert.equal(response.status, 200, response.text);
  const after = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id = 'role-qs010'").get().permissions);
  assert.deepEqual(after, before, 'Fehlendes permissions-Feld darf Rechte nicht löschen');
  const role = response.data.roles.find((entry) => entry.id === 'role-qs010');
  assert.equal(role.name, 'Rolle umbenannt');
  assert.deepEqual(role.permissions, before);
});

test('QS-010: explizit leeres permissions-Feld entfernt Rechte weiterhin', async () => {
  insertRole('role-qs010-clear', 'Rolle zum Leeren', 100000, ['vehicles_view', 'bookings_view']);
  const response = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/roles/role-qs010-clear', {
    name: 'Rolle geleert',
    permissions: []
  });
  assert.equal(response.status, 200, response.text);
  const after = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id = 'role-qs010-clear'").get().permissions);
  assert.deepEqual(after, []);
});

test('QS-003: a 12 MB image payload passes the JSON parser and reaches the image limit check', async () => {
  const created = await apiJson(MANAGER_EMAIL, 'POST', '/api/vehicles', vehiclePayload());
  assert.equal(created.status, 201, created.text);
  const vehicleId = created.data.vehicles.find((entry) => entry.plate === 'HB-U 1').id;

  const atLimit = await apiJson(MANAGER_EMAIL, 'PATCH', `/api/vehicles/${vehicleId}`, vehiclePayload({
    imageData: `data:image/jpeg;base64,${Buffer.alloc(12 * 1024 * 1024).toString('base64')}`
  }));
  assert.equal(atLimit.status, 400, '12-MB-Bild muss den JSON-Parser passieren');
  assert.match(atLimit.data.error, /Bild konnte nicht verarbeitet werden/);

  const aboveLimit = await apiJson(MANAGER_EMAIL, 'PATCH', `/api/vehicles/${vehicleId}`, vehiclePayload({
    imageData: `data:image/jpeg;base64,${Buffer.alloc(12 * 1024 * 1024 + 1).toString('base64')}`
  }));
  assert.equal(aboveLimit.status, 400);
  assert.match(aboveLimit.data.error, /max\. 12 MB/);
});
