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

const { getState } = require('../server/lib/state');
const { isRequestVisibleToApprover } = require('../server/lib/booking-requests');
const { approverRecipients } = require('../server/lib/booking-request-notifications');
const { migrateLocationsSchema, LOCATIONS_SCHEMA_VERSION } = require('../server/lib/locations-schema');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const TEST_PASSWORD = 'Locations-Test-2026!';
const ADMIN_EMAIL = 'locations-admin@example.invalid';
const ADMIN_PASSWORD = 'Locations-Admin-2026!';
const VIEWER_EMAIL = 'locations-viewer@example.invalid';

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
    VALUES ('Locations-Test', '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES ('manager', 'Fuhrparkleitung', '[]', '{}', 1, 900000, '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES ('site-viewer', 'Standortbetrachter', '["vehicles_view","bookings_view","costs_view","maintenance_view"]', '{}', 0, 50000, '2026-01-01', '2026-01-01')
  `).run();
  return database;
}

function insertUser(database, id, email, role, locationId = null) {
  database.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, location_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, '2026-01-01', '2026-01-01')
  `).run(id, email, id, bcrypt.hashSync(TEST_PASSWORD, 4), role, locationId);
}

function insertBaseVehicles(database) {
  database.prepare("INSERT INTO locations (id, name, active, created_at, updated_at) VALUES ('loc-a', 'Standort A', 1, '2026-01-01', '2026-01-01')").run();
  database.prepare("INSERT INTO locations (id, name, active, created_at, updated_at) VALUES ('loc-b', 'Standort B', 1, '2026-01-01', '2026-01-01')").run();
  database.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, location_id, created_at, updated_at)
    VALUES ('v-a', 'Fahrzeug A', 'HB-LA 1', 'Pkw', 'Diesel', 'loc-a', '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, location_id, created_at, updated_at)
    VALUES ('v-b', 'Fahrzeug B', 'HB-LB 1', 'Pkw', 'Diesel', 'loc-b', '2026-01-01', '2026-01-01')
  `).run();
  database.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, location_id, created_at, updated_at)
    VALUES ('v-n', 'Fahrzeug Neutral', 'HB-LN 1', 'Pkw', 'Diesel', NULL, '2026-01-01', '2026-01-01')
  `).run();
  database.prepare("INSERT INTO drivers (id, name, created_at, updated_at) VALUES ('d-1', 'Fahrer', '2026-01-01', '2026-01-01')").run();
  for (const vehicleId of ['v-a', 'v-b', 'v-n']) {
    const suffix = vehicleId.slice(-1);
    database.prepare(`
      INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, created_at, updated_at)
      VALUES (?, ?, 'd-1', 'Test', '2026-10-01 08:00', '2026-10-01 09:00', 'planned', '2026-01-01', '2026-01-01')
    `).run(`b-${suffix}`, vehicleId);
    database.prepare(`
      INSERT INTO costs (id, vehicle_id, date, category, amount, created_at, updated_at)
      VALUES (?, ?, '2026-10-01', 'Sonstiges', 1, '2026-01-01', '2026-01-01')
    `).run(`c-${suffix}`, vehicleId);
    database.prepare(`
      INSERT INTO maintenance (id, vehicle_id, title, due_date, created_at, updated_at)
      VALUES (?, ?, 'Test', '2026-11-01', '2026-01-01', '2026-01-01')
    `).run(`m-${suffix}`, vehicleId);
  }
}

function layers(permissions = ['vehicles_view', 'drivers_view', 'bookings_view', 'costs_view', 'maintenance_view']) {
  return {
    isAdmin: false,
    isSuperadmin: false,
    rolePermissions: new Set(permissions),
    roleObjectPermissions: {},
    userPermissionOverrides: { allow: [], deny: [] },
    userObjectPermissions: {}
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
  throw new Error(`Testserver nicht erreichbar. ${serverOutput.slice(-1500)}`);
}

function extractCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of values) {
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
  const firstCookie = extractCookie(page);
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: firstCookie },
    body: new URLSearchParams({ _csrf: csrfFrom(html), email, password })
  });
  const cookie = extractCookie(response) || firstCookie;
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  const data = session.status === 200 ? await session.json() : null;
  return { status: response.status, cookie, csrf: data?.csrfToken || '', data };
}

async function apiJson(client, method, endpoint, body) {
  const headers = { cookie: client.cookie };
  if (client.csrf) headers['x-csrf-token'] = client.csrf;
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

test('Migration 12→13 ist idempotent und ergänzt locations/users/vehicles', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    database.exec('CREATE TABLE vehicles (id TEXT PRIMARY KEY)');
    database.pragma('user_version = 12');
    assert.equal(migrateLocationsSchema(database), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), LOCATIONS_SCHEMA_VERSION);
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'locations'").get());
    assert.ok(database.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'location_id'));
    assert.ok(database.prepare('PRAGMA table_info(vehicles)').all().some((column) => column.name === 'location_id'));
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(migrateLocationsSchema(database), false);
  } finally {
    database.close();
  }
});

test('Standortsichtbarkeit filtert Fahrzeuge, Buchungen, Kosten und Wartungen', () => {
  process.env.LOCATIONS_ENABLED = '1';
  const database = createDb();
  try {
    insertBaseVehicles(database);
    insertUser(database, 'viewer-a', 'viewer-a@example.invalid', 'site-viewer', 'loc-a');
    insertUser(database, 'viewer-global', 'viewer-global@example.invalid', 'site-viewer', null);
    insertUser(database, 'manager-a', 'manager-a@example.invalid', 'manager', 'loc-a');
    const viewerA = database.prepare("SELECT * FROM users WHERE id = 'viewer-a'").get();
    const viewerGlobal = database.prepare("SELECT * FROM users WHERE id = 'viewer-global'").get();
    const managerA = database.prepare("SELECT * FROM users WHERE id = 'manager-a'").get();

    const stateA = getState(database, viewerA, layers());
    assert.equal(stateA.features.locationsEnabled, true);
    assert.equal(stateA.locations.length, 2);
    assert.deepEqual(stateA.vehicles.map((entry) => entry.id).sort(), ['v-a', 'v-n']);
    assert.deepEqual(stateA.bookings.map((entry) => entry.id).sort(), ['b-a', 'b-n']);
    assert.deepEqual(stateA.costs.map((entry) => entry.id).sort(), ['c-a', 'c-n']);
    assert.deepEqual(stateA.maintenance.map((entry) => entry.id).sort(), ['m-a', 'm-n']);

    const globalState = getState(database, viewerGlobal, layers());
    assert.deepEqual(globalState.vehicles.map((entry) => entry.id).sort(), ['v-a', 'v-b', 'v-n']);
    assert.deepEqual(globalState.bookings.map((entry) => entry.id).sort(), ['b-a', 'b-b', 'b-n']);

    const managerState = getState(database, managerA, layers());
    assert.deepEqual(managerState.vehicles.map((entry) => entry.id).sort(), ['v-a', 'v-b', 'v-n']);
  } finally {
    database.close();
    delete process.env.LOCATIONS_ENABLED;
  }
});

test('Approval-Routing filtert Manager nach Fahrzeugstandort', () => {
  process.env.LOCATIONS_ENABLED = '1';
  const database = createDb();
  try {
    insertBaseVehicles(database);
    insertUser(database, 'viewer-a', 'viewer-a@example.invalid', 'site-viewer', 'loc-a');
    insertUser(database, 'manager-a', 'manager-a@example.invalid', 'manager', 'loc-a');
    insertUser(database, 'manager-b', 'manager-b@example.invalid', 'manager', 'loc-b');
    insertUser(database, 'manager-global', 'manager-global@example.invalid', 'manager', null);
    insertUser(database, 'admin', 'admin-locations@example.invalid', 'admin', null);
    database.prepare(`
      INSERT INTO booking_requests (id, vehicle_id, driver_id, requested_by, purpose, start_at, end_at, status, created_at, updated_at)
      VALUES ('r-b', 'v-b', 'd-1', 'viewer-a', 'Test', '2026-10-29 08:00', '2026-10-29 09:00', 'requested', '2026-01-01', '2026-01-01')
    `).run();
    const viewer = database.prepare("SELECT * FROM users WHERE id = 'viewer-a'").get();
    const request = database.prepare("SELECT * FROM booking_requests WHERE id = 'r-b'").get();
    const managerA = database.prepare("SELECT * FROM users WHERE id = 'manager-a'").get();
    const managerB = database.prepare("SELECT * FROM users WHERE id = 'manager-b'").get();
    const managerGlobal = database.prepare("SELECT * FROM users WHERE id = 'manager-global'").get();
    const admin = database.prepare("SELECT * FROM users WHERE id = 'admin'").get();
    assert.equal(isRequestVisibleToApprover(database, managerA, request, viewer), false);
    assert.equal(isRequestVisibleToApprover(database, managerB, request, viewer), true);
    assert.equal(isRequestVisibleToApprover(database, managerGlobal, request, viewer), true);
    assert.equal(isRequestVisibleToApprover(database, admin, request, viewer, { isAdmin: true }), true);

    const recipients = approverRecipients(database, { excludeUserId: 'viewer-a', locationId: 'loc-b' });
    assert.deepEqual(recipients, ['admin-locations@example.invalid', 'manager-b@example.invalid', 'manager-global@example.invalid']);
  } finally {
    database.close();
    delete process.env.LOCATIONS_ENABLED;
  }
});

test('Flag aus lässt die Standortfilterung vollständig inaktiv', () => {
  delete process.env.LOCATIONS_ENABLED;
  const database = createDb();
  try {
    insertBaseVehicles(database);
    insertUser(database, 'viewer-a', 'viewer-a@example.invalid', 'site-viewer', 'loc-a');
    const viewer = database.prepare("SELECT * FROM users WHERE id = 'viewer-a'").get();
    const state = getState(database, viewer, layers());
    assert.equal(state.features.locationsEnabled, false);
    assert.deepEqual(state.vehicles.map((entry) => entry.id).sort(), ['v-a', 'v-b', 'v-n']);
  } finally {
    database.close();
  }
});

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-locations-'));
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
      ADMIN_NAME: 'Locations Admin',
      ORG_NAME: 'Locations-Test',
      LOCATIONS_ENABLED: '1',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      LEASING_SCHEDULER_DISABLED: 'true',
      REMINDER_SCHEDULER_DISABLED: 'true',
      RETENTION_SCHEDULER_DISABLED: 'true',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
    VALUES ('site-viewer', 'Standortbetrachter', '["vehicles_view"]', '{}', '{"allow":[],"deny":[]}', 0, 50000, '2026-01-01', '2026-01-01')
  `).run();
});

after(async () => {
  try { db?.close(); } catch { /* ignore */ }
  if (child) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('API: Standort-CRUD und Zuordnung an Benutzer/Fahrzeug', async () => {
  clients.admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const created = await apiJson(clients.admin, 'POST', '/api/locations', { name: 'API Standort' });
  assert.equal(created.status, 201, created.text);
  const location = created.data.locations.find((entry) => entry.name === 'API Standort');
  assert.ok(location);

  const renamed = await apiJson(clients.admin, 'PATCH', `/api/locations/${location.id}`, { name: 'API Standort Neu', active: true });
  assert.equal(renamed.status, 200, renamed.text);
  assert.ok(renamed.data.locations.some((entry) => entry.name === 'API Standort Neu'));

  const createdVehicle = await apiJson(clients.admin, 'POST', '/api/vehicles', {
    name: 'API Fahrzeug',
    plate: 'HB-API 1',
    type: 'Pkw',
    fuel: 'Diesel',
    seats: 5,
    status: 'available',
    mileage: 0,
    locationId: location.id,
    blocked: false
  });
  assert.equal(createdVehicle.status, 201, createdVehicle.text);
  const vehicle = createdVehicle.data.vehicles.find((entry) => entry.plate === 'HB-API 1');
  assert.equal(vehicle.locationId, location.id);

  const blockedDelete = await apiJson(clients.admin, 'DELETE', `/api/locations/${location.id}`);
  assert.equal(blockedDelete.status, 409);

  const apiViewerEmail = VIEWER_EMAIL.replace('viewer', 'api-viewer');
  const user = await apiJson(clients.admin, 'POST', '/api/users', {
    name: 'API Viewer',
    email: apiViewerEmail,
    role: 'site-viewer',
    password: TEST_PASSWORD,
    locationId: location.id
  });
  assert.equal(user.status, 201, user.text);

  const viewerState = await login(apiViewerEmail);
  assert.equal(viewerState.status, 303);
  const state = await apiJson(viewerState, 'GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.features.locationsEnabled, true);
  assert.ok(state.data.vehicles.some((entry) => entry.id === vehicle.id));
});
