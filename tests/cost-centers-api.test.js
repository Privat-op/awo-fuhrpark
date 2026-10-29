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
const TEST_PASSWORD = 'Kostenstellen-Test-2026';
const ADMIN_EMAIL = 'cc-admin@example.invalid';
const MANAGER_EMAIL = 'cc-manager@example.invalid';
const VIEWER_EMAIL = 'cc-viewer@example.invalid';
const CCVIEW_EMAIL = 'cc-view@example.invalid';
const DRIVER_EMAIL = 'cc-driver@example.invalid';

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

function isoDay(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function insertRole(id, name, rank, permissions) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES (?, ?, ?, '{}', 0, ?, ?, ?)
  `).run(id, name, JSON.stringify(permissions), rank, now, now);
}

function insertUser(id, email, role) {
  const hash = bcrypt.hashSync(TEST_PASSWORD, 4);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, id, hash, role, now, now);
}

function insertVehicle(id, name, plate, overrides = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, location, department, status, mileage, blocked, blocked_reason, color, notes, cost_center_id, created_at, updated_at)
    VALUES (?, ?, ?, 'Pkw', 'Diesel', 5, '', '', 'available', ?, 0, '', '#2563eb', '', ?, ?, ?)
  `).run(id, name, plate, overrides.mileage ?? 1000, overrides.costCenterId ?? null, now, now);
}

function insertDriver(id, name, overrides = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, user_id, own_trips_access, cost_center_id, created_at, updated_at)
    VALUES (?, ?, 'Mitarbeiter:in', '', '', '', '["B"]', 'available', '#2563eb', ?, 1, ?, ?, ?)
  `).run(id, name, overrides.userId ?? null, overrides.costCenterId ?? null, now, now);
}

function vehiclePayload(overrides = {}) {
  return {
    name: 'Kostenstellen-Caddy',
    plate: 'HB-CC 1',
    type: 'Pkw',
    fuel: 'Diesel',
    seats: 5,
    status: 'available',
    location: '',
    department: '',
    mileage: 1000,
    nextService: '',
    tuv: '',
    insurance: '',
    notes: '',
    color: '#2563eb',
    blocked: false,
    blockedReason: '',
    leasingStart: '',
    leasingEnd: '',
    leasingStartKm: '',
    leasingKmLimit: '',
    ...overrides
  };
}

function driverPayload(overrides = {}) {
  return {
    name: 'Kostenstellen-Fahrer',
    role: 'Mitarbeiter:in',
    department: '',
    phone: '',
    email: '',
    license: ['B'],
    status: 'available',
    ...overrides
  };
}

function costCenterId(state, code) {
  return state.costCenters.find((entry) => entry.code === code)?.id || null;
}

function bookingBody(vehicleId, driverId, date, overrides = {}) {
  return {
    vehicleId,
    driverId,
    date,
    startTime: '09:00',
    endTime: '10:00',
    purpose: 'Kostenstellen-Test',
    notes: '',
    ...overrides
  };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-cost-centers-api-'));
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
      ADMIN_NAME: 'Kostenstellen Admin',
      ORG_NAME: 'Kostenstellen-Testorganisation',
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
  insertRole('role-viewer', 'Nur Lesen', 100000, ['vehicles_view', 'drivers_view', 'bookings_view', 'costs_view']);
  insertRole('role-cc-view', 'Kostenstellen lesen', 100000, ['vehicles_view', 'cost_centers_view']);
  insertRole('role-driver', 'Fahrer-Konto', 100000, ['vehicles_view', 'drivers_view', 'own_trips_view', 'own_trips_request', 'own_trips_execute']);
  insertUser('user-manager', MANAGER_EMAIL, 'manager');
  insertUser('user-viewer', VIEWER_EMAIL, 'role-viewer');
  insertUser('user-ccview', CCVIEW_EMAIL, 'role-cc-view');
  insertUser('user-driver', DRIVER_EMAIL, 'role-driver');
  insertDriver('driver-linked', 'Verknüpfte Fahrer:in', { userId: 'user-driver' });

  await login(ADMIN_EMAIL);
  await login(MANAGER_EMAIL);
  await login(VIEWER_EMAIL);
  await login(CCVIEW_EMAIL);
  await login(DRIVER_EMAIL);
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

test('Migration 8, Manager-Rechte und Kostenstellen-Tabellen sind aktiv', () => {
  assert.equal(Number(db.pragma('user_version', { simple: true })), 15);
  const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
  assert.ok(columns.includes('cost_center_id'));
  const managerPermissions = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id = 'manager'").get().permissions);
  assert.ok(managerPermissions.includes('cost_centers_view'));
  assert.ok(managerPermissions.includes('cost_centers_manage'));
});

test('CRUD, Code-Normalisierung, Konflikt, Deaktivieren und Löschsperre', async () => {
  insertVehicle('vehicle-used', 'Verwendetes Fahrzeug', 'HB-CC 9');
  insertVehicle('vehicle-inactive-target', 'Inaktiv-Ziel', 'HB-CC 10');
  const created = await apiJson(MANAGER_EMAIL, 'POST', '/api/cost-centers', {
    code: ' kst 100 ',
    name: 'Ambulante Pflege',
    description: 'Testkostenstelle',
    active: true
  });
  assert.equal(created.status, 201, created.text);
  const createdCc = created.data.costCenters.find((entry) => entry.code === 'KST-100');
  assert.ok(createdCc);
  assert.equal(createdCc.name, 'Ambulante Pflege');

  const duplicate = await apiJson(MANAGER_EMAIL, 'POST', '/api/cost-centers', {
    code: 'kst-100',
    name: 'Doppelt'
  });
  assert.equal(duplicate.status, 409);

  const invalid = await apiJson(MANAGER_EMAIL, 'POST', '/api/cost-centers', {
    code: '-ungültig',
    name: 'Ungültig'
  });
  assert.equal(invalid.status, 400);

  const updated = await apiJson(MANAGER_EMAIL, 'PATCH', `/api/cost-centers/${encodeURIComponent(createdCc.id)}`, {
    code: 'KST-100',
    name: 'Ambulante Pflege neu',
    description: 'Aktualisiert',
    active: true
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.data.costCenters.find((entry) => entry.id === createdCc.id).name, 'Ambulante Pflege neu');

  const vehicle = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-used', vehiclePayload({
    name: 'Verwendetes Fahrzeug',
    plate: 'HB-CC 9',
    costCenterId: createdCc.id
  }));
  assert.equal(vehicle.status, 200, vehicle.text);

  const blockedDelete = await apiJson(MANAGER_EMAIL, 'DELETE', `/api/cost-centers/${encodeURIComponent(createdCc.id)}`);
  assert.equal(blockedDelete.status, 409);
  assert.ok(blockedDelete.data.details?.usage?.vehicles >= 1);

  const deactivated = await apiJson(MANAGER_EMAIL, 'POST', `/api/cost-centers/${encodeURIComponent(createdCc.id)}/deactivate`);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.data.costCenters.find((entry) => entry.id === createdCc.id).active, false);

  const inactiveAssign = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-inactive-target', vehiclePayload({
    name: 'Inaktiv-Ziel',
    plate: 'HB-CC 10',
    costCenterId: createdCc.id
  }));
  assert.equal(inactiveAssign.status, 400);

  db.prepare('UPDATE vehicles SET cost_center_id = NULL WHERE id = ?').run('vehicle-used');
  const deleted = await apiJson(MANAGER_EMAIL, 'DELETE', `/api/cost-centers/${encodeURIComponent(createdCc.id)}`);
  assert.equal(deleted.status, 200, deleted.text);
});

test('Rechte: Manager verwaltet, Viewer sieht keine Stammdaten, View-only darf nur lesen', async () => {
  const managerState = await apiGet(MANAGER_EMAIL, '/api/state');
  assert.equal(managerState.status, 200);
  assert.ok(Array.isArray(managerState.data.costCenters));
  assert.ok(managerState.data.access.modules.cost_centers_manage);

  const viewerState = await apiGet(VIEWER_EMAIL, '/api/state');
  assert.equal(viewerState.status, 200);
  assert.equal(viewerState.data.costCenters, undefined);
  assert.equal(viewerState.data.access.modules.cost_centers_view, false);

  const viewerCreate = await apiJson(VIEWER_EMAIL, 'POST', '/api/cost-centers', {
    code: 'KST-VIEWER',
    name: 'Nicht erlaubt'
  });
  assert.equal(viewerCreate.status, 403);

  const ccViewState = await apiGet(CCVIEW_EMAIL, '/api/state');
  assert.equal(ccViewState.status, 200);
  assert.ok(Array.isArray(ccViewState.data.costCenters));
  assert.equal(ccViewState.data.access.modules.cost_centers_manage, false);

  const ccViewCreate = await apiJson(CCVIEW_EMAIL, 'POST', '/api/cost-centers', {
    code: 'KST-VIEWONLY',
    name: 'Nicht erlaubt'
  });
  assert.equal(ccViewCreate.status, 403);

  const delegatedRole = await apiJson(MANAGER_EMAIL, 'POST', '/api/roles', {
    name: 'Kostenstellen Delegation',
    permissions: ['cost_centers_view'],
    rank: 800000
  });
  assert.equal(delegatedRole.status, 201, delegatedRole.text);
  assert.ok(delegatedRole.data.roles.find((role) => role.name === 'Kostenstellen Delegation').permissions.includes('cost_centers_view'));
});

test('Zuordnungen und Default-Präzedenz für Buchungen', async () => {
  insertVehicle('vehicle-booking', 'Buchungsfahrzeug', 'HB-CC 20');
  insertDriver('driver-booking', 'Buchungsfahrer');
  const created = await apiJson(ADMIN_EMAIL, 'POST', '/api/cost-centers', {
    code: 'KST-DEFAULT',
    name: 'Default-Test',
    active: true
  });
  assert.equal(created.status, 201);
  const ccId = costCenterId(created.data, 'KST-DEFAULT');

  const vehicle = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-booking', vehiclePayload({
    name: 'Buchungsfahrzeug',
    plate: 'HB-CC 20',
    costCenterId: ccId
  }));
  assert.equal(vehicle.status, 200, vehicle.text);
  const driver = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/drivers/driver-booking', driverPayload({
    name: 'Buchungsfahrer',
    costCenterId: ccId
  }));
  assert.equal(driver.status, 200, driver.text);

  db.prepare("UPDATE users SET cost_center_id = ? WHERE email = ?").run(ccId, ADMIN_EMAIL);
  const adminRow = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  assert.ok(adminRow);

  const userAssignment = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/users/user-viewer', {
    email: VIEWER_EMAIL,
    name: 'user-viewer',
    role: 'role-viewer',
    active: true,
    costCenterId: ccId
  });
  assert.equal(userAssignment.status, 200, userAssignment.text);
  const assignedUser = userAssignment.data.users.find((entry) => entry.id === 'user-viewer');
  assert.equal(assignedUser.costCenterId, ccId);
  assert.equal(assignedUser.costCenterCode, 'KST-DEFAULT');

  const first = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', bookingBody('vehicle-booking', 'driver-booking', isoDay(1)));
  assert.equal(first.status, 201, first.text);
  const firstBooking = first.data.bookings.find((entry) => entry.purpose === 'Kostenstellen-Test' && entry.start.slice(0, 10) === isoDay(1));
  assert.equal(firstBooking.costCenterId, ccId);
  assert.equal(firstBooking.costCenterCode, 'KST-DEFAULT');

  const explicitNone = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', bookingBody('vehicle-booking', 'driver-booking', isoDay(2), { costCenterId: null }));
  assert.equal(explicitNone.status, 201, explicitNone.text);
  assert.equal(explicitNone.data.bookings.find((entry) => entry.start.slice(0, 10) === isoDay(2)).costCenterId, null);

  db.prepare('UPDATE drivers SET cost_center_id = NULL WHERE id = ?').run('driver-booking');
  const fromVehicle = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', bookingBody('vehicle-booking', 'driver-booking', isoDay(3)));
  assert.equal(fromVehicle.status, 201, fromVehicle.text);
  assert.equal(fromVehicle.data.bookings.find((entry) => entry.start.slice(0, 10) === isoDay(3)).costCenterId, ccId);

  db.prepare('UPDATE vehicles SET cost_center_id = NULL WHERE id = ?').run('vehicle-booking');
  const fromUser = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', bookingBody('vehicle-booking', 'driver-booking', isoDay(4)));
  assert.equal(fromUser.status, 201, fromUser.text);
  assert.equal(fromUser.data.bookings.find((entry) => entry.start.slice(0, 10) === isoDay(4)).costCenterId, ccId);

  db.prepare('UPDATE users SET cost_center_id = NULL WHERE id = ?').run(adminRow.id);
  const noDefault = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', bookingBody('vehicle-booking', 'driver-booking', isoDay(5)));
  assert.equal(noDefault.status, 201, noDefault.text);
  assert.equal(noDefault.data.bookings.find((entry) => entry.start.slice(0, 10) === isoDay(5)).costCenterId, null);

  // Snapshot: Default ändern, bestehende Buchung bleibt unverändert.
  db.prepare('UPDATE drivers SET cost_center_id = ? WHERE id = ?').run(ccId, 'driver-booking');
  const snapshot = await apiGet(ADMIN_EMAIL, '/api/state');
  assert.equal(snapshot.data.bookings.find((entry) => entry.start.slice(0, 10) === isoDay(1)).costCenterId, ccId);
  assert.equal(snapshot.data.bookings.find((entry) => entry.start.slice(0, 10) === isoDay(4)).costCenterId, ccId);
});

test('Default-Präzedenz für Buchungsanfragen und Kosten', async () => {
  const created = await apiJson(ADMIN_EMAIL, 'POST', '/api/cost-centers', {
    code: 'KST-REQUEST',
    name: 'Anfrage-Test',
    active: true
  });
  const ccId = costCenterId(created.data, 'KST-REQUEST');
  db.prepare('UPDATE drivers SET cost_center_id = ? WHERE id = ?').run(ccId, 'driver-linked');
  const request = await apiJson(DRIVER_EMAIL, 'POST', '/api/booking-requests', bookingBody('vehicle-booking', 'driver-linked', isoDay(6), {
    purpose: 'Anfrage-Kostenstelle'
  }));
  assert.equal(request.status, 201, request.text);
  const createdRequest = request.data.ownTrips.requests.find((entry) => entry.purpose === 'Anfrage-Kostenstelle');
  assert.equal(createdRequest.costCenterId, ccId);

  const approved = await apiJson(MANAGER_EMAIL, 'POST', `/api/booking-requests/${encodeURIComponent(createdRequest.id)}/approve`, {
    decisionNote: 'Kostenstelle übernehmen'
  });
  assert.equal(approved.status, 200, approved.text);
  const approvedBooking = approved.data.bookings.find((entry) => entry.purpose === 'Anfrage-Kostenstelle');
  assert.equal(approvedBooking.costCenterId, ccId);

  insertVehicle('vehicle-cost', 'Kostenfahrzeug', 'HB-CC 30');
  db.prepare('UPDATE vehicles SET cost_center_id = ? WHERE id = ?').run(ccId, 'vehicle-cost');
  const cost = await apiJson(ADMIN_EMAIL, 'POST', '/api/costs', {
    vehicleId: 'vehicle-cost',
    date: isoDay(1),
    category: 'Sonstiges',
    amount: 12.5,
    note: 'Kostenstellen-Test'
  });
  assert.equal(cost.status, 201, cost.text);
  assert.equal(cost.data.costs.find((entry) => entry.note === 'Kostenstellen-Test').costCenterId, ccId);

  db.prepare('UPDATE vehicles SET cost_center_id = NULL WHERE id = ?').run('vehicle-cost');
  const explicitNone = await apiJson(ADMIN_EMAIL, 'POST', '/api/costs', {
    vehicleId: 'vehicle-cost',
    date: isoDay(1),
    category: 'Sonstiges',
    amount: 3,
    note: 'Ohne Kostenstelle',
    costCenterId: null
  });
  assert.equal(explicitNone.status, 201, explicitNone.text);
  assert.equal(explicitNone.data.costs.find((entry) => entry.note === 'Ohne Kostenstelle').costCenterId, null);
});

test('JSON- und CSV-Export enthalten Kostenstellen; Filter und Formel-Injection bleiben korrekt', async () => {
  const created = await apiJson(ADMIN_EMAIL, 'POST', '/api/cost-centers', {
    code: 'KST-EXPORT',
    name: 'Export-Test',
    active: true
  });
  const ccId = costCenterId(created.data, 'KST-EXPORT');
  insertVehicle('vehicle-export', 'Exportfahrzeug', 'HB-CC 40');
  insertDriver('driver-export', 'Exportfahrer');
  db.prepare('UPDATE vehicles SET cost_center_id = ? WHERE id = ?').run(ccId, 'vehicle-export');
  const trip = await apiJson(ADMIN_EMAIL, 'POST', '/api/trips', {
    vehicleId: 'vehicle-export',
    driverId: 'driver-export',
    date: isoDay(1),
    startTime: '08:00',
    endTime: '09:00',
    purpose: '=1+1',
    startKm: 1000,
    endKm: 1010
  });
  assert.equal(trip.status, 201, trip.text);

  const json = await apiGet(ADMIN_EMAIL, '/api/export/data.json');
  assert.equal(json.status, 200);
  const payload = JSON.parse(json.text);
  assert.ok(payload.costCenters.some((entry) => entry.code === 'KST-EXPORT'));
  assert.ok(payload.bookings.some((entry) => entry.costCenterCode === 'KST-EXPORT'));

  const csv = await apiGet(ADMIN_EMAIL, '/api/export/logbook.csv?period=all');
  assert.equal(csv.status, 200);
  assert.match(csv.text.split(/\r?\n/)[0], /Kostenstelle$/);
  assert.match(csv.text, /KST-EXPORT/);
  assert.match(csv.text, /'=1\+1/);

  const filtered = await apiGet(ADMIN_EMAIL, `/api/export/logbook.csv?period=all&costCenter=${encodeURIComponent(ccId)}`);
  assert.equal(filtered.status, 200);
  assert.match(filtered.text, /KST-EXPORT/);
  assert.doesNotMatch(filtered.text, /KST-REQUEST/);

  const withoutCostCenter = await apiGet(ADMIN_EMAIL, '/api/export/logbook.csv?period=all&costCenter=none');
  assert.equal(withoutCostCenter.status, 200);
  assert.doesNotMatch(withoutCostCenter.text, /KST-EXPORT/);
});

test('Audit enthält CRUD-, Deaktivierungs- und Zuordnungsänderungen', () => {
  const actions = db.prepare("SELECT action, entity_type, details FROM audit_logs WHERE entity_type IN ('cost_center', 'vehicle', 'driver', 'user', 'booking', 'cost')").all();
  assert.ok(actions.some((row) => row.entity_type === 'cost_center' && row.action === 'create'));
  assert.ok(actions.some((row) => row.entity_type === 'cost_center' && row.action === 'update'));
  assert.ok(actions.some((row) => row.entity_type === 'cost_center' && row.action === 'deactivate'));
  assert.ok(actions.some((row) => row.entity_type === 'cost_center' && row.action === 'delete'));
  assert.ok(actions.some((row) => row.action === 'assign_cost_center' && row.entity_type === 'vehicle'));
  assert.ok(actions.some((row) => row.action === 'assign_cost_center' && row.entity_type === 'driver'));
  assert.ok(actions.some((row) => row.action === 'assign_cost_center' && row.entity_type === 'user'));
});
