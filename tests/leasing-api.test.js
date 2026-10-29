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
const TEST_PASSWORD = 'Leasing-API-Test-2026';
const ADMIN_EMAIL = 'leasing-admin@example.invalid';
const MANAGER_EMAIL = 'leasing-manager@example.invalid';
const VIEWER_EMAIL = 'leasing-viewer@example.invalid';

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

function insertVehicle(id, name, plate, overrides = {}) {
  const values = {
    mileage: 80000,
    leasingStart: null,
    leasingEnd: null,
    leasingStartKm: null,
    leasingKmLimit: null,
    ...overrides
  };
  db.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, location, department, status, ownership_type, usage_category_id, mileage, blocked, blocked_reason, color, notes,
       leasing_start, leasing_end, leasing_start_km, leasing_km_limit, leasing_monthly_cost, created_at, updated_at)
    VALUES (?, ?, ?, 'Pkw', 'Diesel', 5, '', '', 'available', ?, ?, ?, 0, '', '#2563eb', '', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, plate, values.leasingEnd || values.leasingKmLimit ? 'leasing' : 'owned', null, values.mileage,
    values.leasingStart, values.leasingEnd,
    values.leasingStartKm, values.leasingKmLimit, null, new Date().toISOString(), new Date().toISOString()
  );
}

function insertUser(id, email, role) {
  const hash = bcrypt.hashSync(TEST_PASSWORD, 4);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, id, hash, role, now, now);
}

function vehiclePayload(overrides = {}) {
  return {
    name: 'Leasing-Caddy',
    plate: 'HB-L 1',
    type: 'Pkw',
    fuel: 'Diesel',
    seats: 5,
    status: 'available',
    ownershipType: 'leasing',
    location: 'Hof',
    department: 'Pflege',
    mileage: 80000,
    nextService: '',
    tuv: '',
    insurance: '',
    notes: '',
    color: '#2563eb',
    blocked: false,
    blockedReason: '',
    leasingStart: '2026-01-01',
    leasingEnd: isoDay(365),
    leasingStartKm: 0,
    leasingKmLimit: 100000,
    ...overrides
  };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-leasing-api-'));
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
      ADMIN_NAME: 'Leasing Admin',
      ORG_NAME: 'Leasing-Testorganisation',
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
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES ('role-viewer', 'Nur Fahrzeuge ansehen', '["vehicles_view"]', '{}', 0, 100000, ?, ?)
  `).run(now, now);
  insertUser('user-manager', MANAGER_EMAIL, 'manager');
  insertUser('user-viewer', VIEWER_EMAIL, 'role-viewer');
  insertVehicle('vehicle-1', 'Leasing-Caddy', 'HB-L 1');
  insertVehicle('vehicle-2', 'Ohne Leasing', 'HB-O 2');

  db.prepare(`
    INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, created_at, updated_at)
    VALUES ('driver-1', 'Testfahrer:in', 'Mitarbeiter:in', '', '', '', '["B"]', 'available', '#2563eb', ?, ?)
  `).run(now, now);

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

test('Migration 8 ist aktiv, Leasing-Spalten und Tabellen sind vorhanden', () => {
  assert.equal(Number(db.pragma('user_version', { simple: true })), 19);
  const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
  for (const column of ['leasing_start', 'leasing_end', 'leasing_start_km', 'leasing_km_limit']) {
    assert.ok(columns.includes(column), `Leasing-Spalte fehlt: ${column}`);
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'smtp_settings'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notification_deliveries'").get());
});

test('Leasingdaten werden gespeichert, berechnet und auditiert; Bestandsfahrzeuge bleiben ohne Leasing', async () => {
  const response = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-1', vehiclePayload());
  assert.equal(response.status, 200, response.text);
  const vehicle = response.data.vehicles.find((entry) => entry.id === 'vehicle-1');
  assert.equal(vehicle.leasing.percent, 80);
  assert.equal(vehicle.leasing.remainingKm, 20000);
  assert.equal(vehicle.leasing.warnings.length, 1);
  assert.match(vehicle.leasing.warnings[0].text, /80/);

  const unchanged = response.data.vehicles.find((entry) => entry.id === 'vehicle-2');
  assert.equal(unchanged.leasing, null);

  const auditRow = db.prepare("SELECT * FROM audit_logs WHERE action = 'leasing_update' AND entity_id = 'vehicle-1' ORDER BY id DESC").get();
  assert.ok(auditRow, 'Leasing-Änderung muss auditiert werden');
  assert.ok(auditRow.details.includes('leasingKmLimit'));

  const state = await apiGet(MANAGER_EMAIL, '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.data.smtp, undefined, 'Nicht-Administrator:innen dürfen keine SMTP-Daten sehen');
});

test('Berechtigungen: Lesen erlaubt, Leasing bearbeiten und SMTP nur mit Admin-Rechten', async () => {
  const viewerPatch = await apiJson(VIEWER_EMAIL, 'PATCH', '/api/vehicles/vehicle-1', vehiclePayload({ name: 'Unbefugt' }));
  assert.equal(viewerPatch.status, 403);

  const managerSmtp = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/smtp', {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    fromAddress: ''
  });
  assert.equal(managerSmtp.status, 403);

  const viewerState = await apiGet(VIEWER_EMAIL, '/api/state');
  assert.equal(viewerState.status, 200);
  assert.equal(viewerState.data.smtp, undefined);
  const vehicle = viewerState.data.vehicles.find((entry) => entry.id === 'vehicle-1');
  assert.equal(vehicle.leasing.percent, 80);
});

test('Ownership und neue Fahrzeugstatus: Bookability und Statuserhalt beim Abschluss', async () => {
  const vehicleBase = {
    name: 'Ohne Leasing',
    plate: 'HB-O 2',
    type: 'Pkw',
    fuel: 'Diesel',
    seats: 5,
    location: '',
    department: '',
    mileage: 80000,
    nextService: '',
    tuv: '',
    insurance: '',
    notes: '',
    color: '#2563eb',
    blocked: false,
    blockedReason: ''
  };
  const invalidOwnership = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-2', {
    ...vehicleBase,
    status: 'available',
    ownershipType: 'rental'
  });
  assert.equal(invalidOwnership.status, 400);

  const createdVehicle = await apiJson(MANAGER_EMAIL, 'POST', '/api/vehicles', vehiclePayload({
    name: 'Ownership-Create',
    plate: 'HB-OC 1'
  }));
  assert.equal(createdVehicle.status, 201, createdVehicle.text);
  const createdEntry = createdVehicle.data.vehicles.find((entry) => entry.plate === 'HB-OC 1');
  assert.equal(createdEntry.ownershipType, 'leasing');
  assert.equal(createdEntry.leasing.percent, 80);

  const leasing = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-2', {
    ...vehicleBase,
    status: 'available',
    ownershipType: 'leasing',
    leasingStart: '2026-01-01',
    leasingEnd: isoDay(365),
    leasingStartKm: 0,
    leasingKmLimit: 100000
  });
  assert.equal(leasing.status, 200, leasing.text);
  const leasedVehicle = leasing.data.vehicles.find((entry) => entry.id === 'vehicle-2');
  assert.equal(leasedVehicle.ownershipType, 'leasing');
  assert.equal(leasedVehicle.leasing.percent, 80);

  const owned = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-2', {
    ...vehicleBase,
    status: 'available',
    ownershipType: 'owned',
    leasingStart: '2026-01-01',
    leasingEnd: isoDay(365),
    leasingStartKm: 0,
    leasingKmLimit: 100000
  });
  assert.equal(owned.status, 200, owned.text);
  assert.equal(owned.data.vehicles.find((entry) => entry.id === 'vehicle-2').leasing, null);

  for (const [status, pattern] of [
    ['maintenance', /Wartung/],
    ['defect', /defekt/],
    ['sold', /veräußert/],
    ['not_drivable', /nicht fahrbereit/]
  ]) {
    const patched = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-2', {
      ...vehicleBase,
      status,
      ownershipType: 'owned'
    });
    assert.equal(patched.status, 200, patched.text);
    const booking = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', {
      vehicleId: 'vehicle-2',
      driverId: 'driver-1',
      date: isoDay(1),
      startTime: '09:00',
      endTime: '10:00',
      purpose: `Status ${status}`
    });
    assert.equal(booking.status, 409, booking.text);
    assert.match(booking.data.error, pattern);
  }

  await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-2', {
    ...vehicleBase,
    status: 'available',
    ownershipType: 'owned'
  });
  const created = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', {
    vehicleId: 'vehicle-2',
    driverId: 'driver-1',
    date: isoDay(1),
    startTime: '11:00',
    endTime: '12:00',
    purpose: 'Statuserhalt'
  });
  assert.equal(created.status, 201, created.text);
  const bookingId = created.data.bookings.find((entry) => entry.purpose === 'Statuserhalt').id;
  const started = await apiJson(ADMIN_EMAIL, 'POST', `/api/bookings/${bookingId}/start`);
  assert.equal(started.status, 200, started.text);
  const defect = await apiJson(MANAGER_EMAIL, 'PATCH', '/api/vehicles/vehicle-2', {
    ...vehicleBase,
    status: 'defect',
    ownershipType: 'owned'
  });
  assert.equal(defect.status, 200, defect.text);
  const ended = await apiJson(ADMIN_EMAIL, 'POST', `/api/bookings/${bookingId}/end`, { endKm: 80100 });
  assert.equal(ended.status, 200, ended.text);
  assert.equal(db.prepare("SELECT status FROM vehicles WHERE id = 'vehicle-2'").get().status, 'defect');
});

test('SMTP-Konfiguration ist admin-only, Passwort erscheint nicht in State oder Export', async () => {
  const response = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/smtp', {
    enabled: true,
    host: 'smtp.invalid',
    port: 587,
    secure: false,
    username: '',
    fromAddress: 'fuhrpark@example.invalid',
    password: 'Secret-123'
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.data.smtp.passwordSet, true);
  assert.equal(response.data.smtp.password, undefined);
  assert.ok(!response.text.includes('Secret-123'));

  const invalid = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/smtp', {
    enabled: true,
    host: '',
    port: 587,
    secure: false,
    username: '',
    fromAddress: ''
  });
  assert.equal(invalid.status, 400);

  const exported = await apiGet(ADMIN_EMAIL, '/api/export/data.json');
  assert.equal(exported.status, 200);
  assert.ok(!exported.text.includes('Secret-123'));
  assert.ok(!exported.text.includes('"smtp"'));
  assert.ok(!exported.text.includes('smtp.invalid'));

  const smtpAudit = db.prepare("SELECT details FROM audit_logs WHERE entity_type = 'smtp' ORDER BY id DESC LIMIT 1").get();
  assert.ok(smtpAudit, 'SMTP-Änderung muss auditiert werden');
  assert.ok(!smtpAudit.details.includes('Secret-123'));
  assert.ok(!smtpAudit.details.includes('smtp.invalid'));

  const auditView = await apiGet(ADMIN_EMAIL, '/api/audit?entityType=smtp');
  assert.equal(auditView.status, 200);
  assert.ok(auditView.data.items.some((item) => item.entityType === 'smtp'), 'SMTP-Audit muss für Admin sichtbar sein');
});

test('SMTP-Test nennt die konkrete Ursache bei deaktivierter Konfiguration', async () => {
  const disabled = await apiJson(ADMIN_EMAIL, 'PATCH', '/api/smtp', {
    enabled: false,
    host: 'smtp.invalid',
    port: 587,
    secure: false,
    username: '',
    fromAddress: 'fuhrpark@example.invalid'
  });
  assert.equal(disabled.status, 200, disabled.text);

  const result = await apiJson(ADMIN_EMAIL, 'POST', '/api/smtp/test', {});
  assert.equal(result.status, 400, result.text);
  assert.equal(result.data.error, 'SMTP ist nicht aktiviert.');
});

test('Buchung liefert Leasing-Warnung, blockiert aber nicht', async () => {
  const response = await apiJson(ADMIN_EMAIL, 'POST', '/api/bookings', {
    vehicleId: 'vehicle-1',
    driverId: 'driver-1',
    date: isoDay(1),
    startTime: '09:00',
    endTime: '10:00',
    purpose: 'Leasing-Warnung prüfen'
  });
  assert.equal(response.status, 201, response.text);
  assert.match(response.data.leasingWarning || '', /80/);
  const booking = db.prepare("SELECT status FROM bookings WHERE purpose = 'Leasing-Warnung prüfen'").get();
  assert.equal(booking.status, 'planned', 'Warnung darf die Buchung nicht blockieren');

  const state = await apiGet(ADMIN_EMAIL, '/api/state');
  assert.equal(state.data.smtp.passwordSet, true);
  assert.equal(state.data.smtp.password, undefined);
});
