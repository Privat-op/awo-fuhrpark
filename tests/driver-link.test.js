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

const { normalizePermissions } = require('../server/lib/permissions');

const ROOT = path.join(__dirname, '..');
const TEST_PASSWORD = 'Driver-Link-Test-2026';
const EMAILS = {
  admin: 'driver-link-admin@example.invalid',
  manager: 'driver-link-manager@example.invalid',
  other: 'driver-link-other@example.invalid'
};

let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let passwordHash;
let adminId;
let otherUserId;
let serverOutput = '';
const clients = {};
const ids = {};

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
  return { cookie, csrf: session.csrfToken, session };
}

async function apiJson(key, method, endpoint, body, { csrf = true } = {}) {
  const client = clients[key];
  const headers = {
    cookie: client.cookie,
    'content-type': 'application/json'
  };
  if (csrf) headers['x-csrf-token'] = client.csrf;
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, text };
}

function insertRole(id, name, rank, permissions) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES (?, ?, ?, '{}', 0, ?, ?, ?)
  `).run(id, name, JSON.stringify(normalizePermissions(permissions)), rank, now, now);
}

function insertUser(id, name, email, role) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, name, passwordHash, role, now, now);
}

function insertDriver(id, name, role, status, userId = null, ownTripsAccess = 1) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, user_id, own_trips_access, created_at, updated_at)
    VALUES (?, ?, ?, 'Test', '', ?, '["B"]', ?, '#2563eb', ?, ?, ?, ?)
  `).run(id, name, role, `${id}@example.invalid`, status, userId, ownTripsAccess, now, now);
}

function driverRow(id) {
  return db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
}

function adminAuditRows() {
  return db.prepare(`
    SELECT action, entity_type, entity_id, details, user_id
    FROM audit_logs
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(adminId);
}

function latestAudit() {
  const row = adminAuditRows()[0];
  assert.ok(row, 'Audit-Eintrag fehlt');
  return { ...row, details: row.details ? JSON.parse(row.details) : null };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-driver-link-test-'));
  dbPath = path.join(tempDir, 'test.sqlite');
  const uploadDir = path.join(tempDir, 'uploads');
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
      UPLOAD_DIR: uploadDir,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_EMAIL: EMAILS.admin,
      ADMIN_PASSWORD: TEST_PASSWORD,
      ADMIN_NAME: 'Driver Link Administrator',
      ORG_NAME: 'Driver-Link-Testorganisation',
      ORG_LOCATION: 'Teststandort',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();

  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);

  insertRole('role-viewer', 'Nur Ansicht', 100000, ['bookings_view']);
  insertUser('user-manager', 'Driver Link Manager', EMAILS.manager, 'manager');
  insertUser('user-other', 'Andere Person', EMAILS.other, 'role-viewer');
  otherUserId = 'user-other';
  adminId = db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;

  insertDriver('driver-a', 'Fahrer A', 'Pflege', 'available');
  insertDriver('driver-b', 'Fahrer B', 'Verwaltung', 'away');
  insertDriver('driver-c', 'Fahrer C', 'Fahrdienst', 'available', otherUserId, 1);
  ids.driverA = 'driver-a';
  ids.driverB = 'driver-b';
  ids.driverC = 'driver-c';

  clients.admin = await login(EMAILS.admin);
  clients.manager = await login(EMAILS.manager);
});

after(async () => {
  try { db?.close(); } catch { /* bereits geschlossen */ }
  if (child && !child.killed) {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(3000)
    ]);
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Admin verknüpft sein Konto mit einem freien Fahrerprofil inklusive State und Audit', async () => {
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverA,
    ownTripsAccess: true
  });
  assert.equal(response.status, 200);
  const state = response.data;
  const linkedDriver = state.drivers.find((driver) => driver.id === ids.driverA);
  assert.equal(linkedDriver.userId, adminId);
  assert.equal(linkedDriver.ownTripsAccess, true);
  assert.equal(state.ownTrips?.driver?.id, ids.driverA);
  const adminState = state.users.find((user) => user.id === adminId);
  assert.equal(adminState.driverId, ids.driverA);
  assert.equal(adminState.ownTripsAccess, true);

  assert.equal(driverRow(ids.driverA).user_id, adminId);
  assert.equal(Number(driverRow(ids.driverA).own_trips_access), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drivers WHERE user_id = ?').get(adminId).count, 1);

  const audit = latestAudit();
  assert.equal(audit.action, 'link_driver');
  assert.equal(audit.entity_type, 'user');
  assert.equal(audit.entity_id, adminId);
  assert.deepEqual(audit.details, { driverId: ids.driverA, ownTripsAccess: 1 });
});

test('Datenbank erzwingt eindeutige Verknüpfung und Fremdschlüssel', () => {
  assert.throws(
    () => insertDriver('driver-duplicate-link', 'Doppelte Verknüpfung', 'Test', 'available', adminId),
    /UNIQUE|drivers\.user_id/
  );
  assert.throws(
    () => insertDriver('driver-invalid-user', 'Unbekanntes Konto', 'Test', 'available', 'missing-user'),
    /FOREIGN KEY|constraint/i
  );
  assert.equal(driverRow('driver-duplicate-link'), undefined);
  assert.equal(driverRow('driver-invalid-user'), undefined);
});

test('Admin kann die Verknüpfung wechseln und den Standardzugriff deaktivieren', async () => {
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverB,
    ownTripsAccess: false
  });
  assert.equal(response.status, 200);
  const state = response.data;
  assert.equal(state.drivers.find((driver) => driver.id === ids.driverA).userId, null);
  assert.equal(state.drivers.find((driver) => driver.id === ids.driverB).userId, adminId);
  assert.equal(state.drivers.find((driver) => driver.id === ids.driverB).ownTripsAccess, false);
  assert.equal(state.users.find((user) => user.id === adminId).driverId, ids.driverB);
  assert.equal(state.users.find((user) => user.id === adminId).ownTripsAccess, false);

  assert.equal(driverRow(ids.driverA).user_id, null);
  assert.equal(driverRow(ids.driverB).user_id, adminId);
  assert.equal(Number(driverRow(ids.driverB).own_trips_access), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drivers WHERE user_id = ?').get(adminId).count, 1);

  const audit = latestAudit();
  assert.equal(audit.action, 'link_driver');
  assert.deepEqual(audit.details, { driverId: ids.driverB, ownTripsAccess: 0 });
});

test('Admin kann den Standardzugriff derselben Verknüpfung wieder aktivieren', async () => {
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverB,
    ownTripsAccess: true
  });
  assert.equal(response.status, 200);
  assert.equal(Number(driverRow(ids.driverB).own_trips_access), 1);
  assert.equal(response.data.users.find((user) => user.id === adminId).ownTripsAccess, true);

  const audit = latestAudit();
  assert.equal(audit.action, 'link_driver');
  assert.deepEqual(audit.details, { driverId: ids.driverB, ownTripsAccess: 1 });
});

test('Bereits verknüpfte Fahrer:innen liefern 409 und verändern nichts', async () => {
  const before = adminAuditRows().length;
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverC,
    ownTripsAccess: true
  });
  assert.equal(response.status, 409);
  assert.equal(driverRow(ids.driverC).user_id, otherUserId);
  assert.equal(driverRow(ids.driverB).user_id, adminId);
  assert.equal(adminAuditRows().length, before);
});

test('Nicht-Admins erhalten 403 und können keine Verknüpfung setzen', async () => {
  const response = await apiJson('manager', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverA,
    ownTripsAccess: true
  });
  assert.equal(response.status, 403);
  assert.equal(driverRow(ids.driverA).user_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drivers WHERE user_id = ?').get('user-manager').count, 0);
});

test('userId und weitere Adminfelder im Body werden ignoriert; Ziel bleibt das eigene Konto', async () => {
  const beforeOther = db.prepare('SELECT role, active, email FROM users WHERE id = ?').get(otherUserId);
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverA,
    ownTripsAccess: true,
    userId: otherUserId,
    role: 'manager',
    active: false,
    email: 'angriff@example.invalid',
    token: 'SHOULD_NOT_APPEAR'
  });
  assert.equal(response.status, 200);
  assert.equal(driverRow(ids.driverA).user_id, adminId);
  assert.equal(driverRow(ids.driverB).user_id, null);
  const otherAfter = db.prepare('SELECT role, active, email FROM users WHERE id = ?').get(otherUserId);
  assert.deepEqual(otherAfter, beforeOther);
  const admin = db.prepare('SELECT role, active, email FROM users WHERE id = ?').get(adminId);
  assert.equal(admin.role, 'admin');
  assert.equal(Number(admin.active), 1);
  assert.equal(admin.email, EMAILS.admin);

  const audit = latestAudit();
  assert.equal(audit.action, 'link_driver');
  assert.equal(audit.user_id, adminId);
  assert.deepEqual(audit.details, { driverId: ids.driverA, ownTripsAccess: 1 });
  assert.ok(!JSON.stringify(audit.details).includes('SHOULD_NOT_APPEAR'));
});

test('CSRF-Schutz greift für die Selbstverknüpfung', async () => {
  const before = adminAuditRows().length;
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: ids.driverB,
    ownTripsAccess: true
  }, { csrf: false });
  assert.equal(response.status, 403);
  assert.equal(driverRow(ids.driverA).user_id, adminId);
  assert.equal(driverRow(ids.driverB).user_id, null);
  assert.equal(adminAuditRows().length, before);
});

test('Admin kann die eigene Verknüpfung entfernen; State und Audit werden aktualisiert', async () => {
  const response = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: null,
    ownTripsAccess: false
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.ownTrips, null);
  assert.equal(driverRow(ids.driverA).user_id, null);
  assert.equal(Number(driverRow(ids.driverA).own_trips_access), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drivers WHERE user_id = ?').get(adminId).count, 0);

  const audit = latestAudit();
  assert.equal(audit.action, 'unlink_driver');
  assert.equal(audit.entity_type, 'user');
  assert.equal(audit.entity_id, adminId);
  assert.deepEqual(audit.details, { driverId: ids.driverA, ownTripsAccess: null });
});

test('Fehlende oder unbekannte Fahrerprofil-IDs werden abgelehnt', async () => {
  const missing = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    ownTripsAccess: true
  });
  assert.equal(missing.status, 400);

  const unknown = await apiJson('admin', 'PATCH', '/api/me/driver-link', {
    driverId: 'does-not-exist',
    ownTripsAccess: true
  });
  assert.equal(unknown.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drivers WHERE user_id = ?').get(adminId).count, 0);
});
