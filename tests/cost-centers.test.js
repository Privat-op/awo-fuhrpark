'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  normalizeCostCenterCode,
  parseCostCenterPayload,
  assertCostCenterAssignable,
  resolveBookingCostCenter,
  resolveCostCostCenter,
  getCostCenterUsage
} = require('../server/lib/cost-centers');
const { migrateCostCentersSchema } = require('../server/lib/cost-centers-schema');
const { parsePermissions } = require('../server/lib/permissions');
const { HttpError } = require('../server/lib/validation');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Test', '2026-01-01', '2026-01-01')
  `).run();
  return db;
}

function insertCostCenter(db, { id, code, name, active = 1 }) {
  db.prepare(`
    INSERT INTO cost_centers (id, code, name, description, active, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, '2026-01-01', '2026-01-01')
  `).run(id, code, name, active);
}

test('Kostenstellencode wird normalisiert und validiert', () => {
  assert.equal(normalizeCostCenterCode('  kst 100  '), 'KST-100');
  assert.equal(normalizeCostCenterCode('pflege/ambulant'), 'PFLEGE/AMBULANT');
  assert.throws(() => normalizeCostCenterCode(''), HttpError);
  assert.throws(() => normalizeCostCenterCode('-KST'), HttpError);
  assert.throws(() => normalizeCostCenterCode('KST 100!'), HttpError);
});

test('Payload validiert Pflichtfelder, Beschreibung und Aktivstatus', () => {
  const values = parseCostCenterPayload({
    code: ' kst 200 ',
    name: '  Pflege  ',
    description: '  Stationär  ',
    active: false
  });
  assert.deepEqual(values, {
    code: 'KST-200',
    name: 'Pflege',
    description: 'Stationär',
    active: false
  });
  assert.throws(() => parseCostCenterPayload({ code: 'KST-1', name: '' }), HttpError);
});

test('Default-Präzedenz Buchung: explizit > Fahrer:in > Fahrzeug > Benutzerkonto > NULL', () => {
  const db = createDb();
  try {
    insertCostCenter(db, { id: 'cc-driver', code: 'KST-D', name: 'Fahrer' });
    insertCostCenter(db, { id: 'cc-vehicle', code: 'KST-V', name: 'Fahrzeug' });
    insertCostCenter(db, { id: 'cc-user', code: 'KST-U', name: 'Benutzer' });
    const driver = { cost_center_id: 'cc-driver' };
    const vehicle = { cost_center_id: 'cc-vehicle' };
    const user = { cost_center_id: 'cc-user' };

    assert.equal(resolveBookingCostCenter(db, { explicit: true, explicitId: 'cc-user', driver, vehicle, user }), 'cc-user');
    assert.equal(resolveBookingCostCenter(db, { explicit: false, driver, vehicle, user }), 'cc-driver');
    assert.equal(resolveBookingCostCenter(db, { explicit: false, driver: {}, vehicle, user }), 'cc-vehicle');
    assert.equal(resolveBookingCostCenter(db, { explicit: false, driver: {}, vehicle: {}, user }), 'cc-user');
    assert.equal(resolveBookingCostCenter(db, { explicit: false, driver: {}, vehicle: {}, user: {} }), null);
    assert.equal(resolveBookingCostCenter(db, { explicit: true, explicitId: null, driver, vehicle, user }), null);
  } finally {
    db.close();
  }
});

test('Default-Präzedenz Kosten: explizit > Fahrzeug > Benutzerkonto > NULL; inaktive Defaults werden übersprungen', () => {
  const db = createDb();
  try {
    insertCostCenter(db, { id: 'cc-vehicle', code: 'KST-V', name: 'Fahrzeug' });
    insertCostCenter(db, { id: 'cc-user', code: 'KST-U', name: 'Benutzer' });
    insertCostCenter(db, { id: 'cc-inactive', code: 'KST-I', name: 'Inaktiv', active: 0 });
    const vehicle = { cost_center_id: 'cc-vehicle' };
    const user = { cost_center_id: 'cc-user' };

    assert.equal(resolveCostCostCenter(db, { explicit: true, explicitId: 'cc-user', vehicle, user }), 'cc-user');
    assert.equal(resolveCostCostCenter(db, { explicit: false, vehicle, user }), 'cc-vehicle');
    assert.equal(resolveCostCostCenter(db, { explicit: false, vehicle: {}, user }), 'cc-user');
    assert.equal(resolveCostCostCenter(db, { explicit: false, vehicle: {}, user: {} }), null);
    assert.equal(resolveCostCostCenter(db, { explicit: false, vehicle: { cost_center_id: 'cc-inactive' }, user }), 'cc-user');
    assert.throws(() => resolveCostCostCenter(db, { explicit: true, explicitId: 'cc-inactive' }), HttpError);
  } finally {
    db.close();
  }
});

test('Zuordnung akzeptiert inaktive Kostenstelle nur als bestehende Zuordnung', () => {
  const db = createDb();
  try {
    insertCostCenter(db, { id: 'cc-active', code: 'KST-A', name: 'Aktiv' });
    insertCostCenter(db, { id: 'cc-inactive', code: 'KST-I', name: 'Inaktiv', active: 0 });
    assert.equal(assertCostCenterAssignable(db, 'cc-active'), 'cc-active');
    assert.throws(() => assertCostCenterAssignable(db, 'cc-inactive'), HttpError);
    assert.equal(assertCostCenterAssignable(db, 'cc-inactive', { existingId: 'cc-inactive' }), 'cc-inactive');
    assert.throws(() => assertCostCenterAssignable(db, 'missing'), HttpError);
  } finally {
    db.close();
  }
});

test('Nutzungszählung erkennt Referenzen über alle Tabellen', () => {
  const db = createDb();
  try {
    insertCostCenter(db, { id: 'cc-1', code: 'KST-1', name: 'Test' });
    insertCostCenter(db, { id: 'cc-2', code: 'KST-2', name: 'Frei' });
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO vehicles (id, name, plate, type, fuel, seats, status, mileage, cost_center_id, created_at, updated_at)
      VALUES ('v1', 'Auto', 'HB-1', 'Pkw', 'Diesel', 5, 'available', 0, 'cc-1', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO drivers (id, name, role, license, status, cost_center_id, created_at, updated_at)
      VALUES ('d1', 'Fahrer', 'Test', '["B"]', 'available', 'cc-1', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, cost_center_id, created_at, updated_at)
      VALUES ('u1', 'u1@example.invalid', 'User', 'x', 'manager', 'cc-1', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, cost_center_id, created_at, updated_at)
      VALUES ('b1', 'v1', 'd1', 'Test', '2026-01-01T08:00', '2026-01-01T09:00', 'planned', 'cc-1', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO booking_requests (id, vehicle_id, driver_id, purpose, start_at, end_at, status, cost_center_id, created_at, updated_at)
      VALUES ('r1', 'v1', 'd1', 'Test', '2026-01-02T08:00', '2026-01-02T09:00', 'requested', 'cc-1', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO costs (id, vehicle_id, date, category, amount, cost_center_id, created_at, updated_at)
      VALUES ('c1', 'v1', '2026-01-01', 'Sonstiges', 10, 'cc-1', ?, ?)
    `).run(now, now);

    const used = getCostCenterUsage(db, 'cc-1');
    assert.deepEqual(used, {
      vehicles: 1,
      drivers: 1,
      users: 1,
      bookings: 1,
      bookingRequests: 1,
      costs: 1,
      total: 6
    });
    assert.equal(getCostCenterUsage(db, 'cc-2').total, 0);
  } finally {
    db.close();
  }
});

test('Migration 6 ist idempotent, ergänzt Spalten/FK und Manager-Rechte', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE roles (id TEXT PRIMARY KEY, permissions TEXT NOT NULL DEFAULT '[]', updated_at TEXT);
      CREATE TABLE vehicles (id TEXT PRIMARY KEY);
      CREATE TABLE drivers (id TEXT PRIMARY KEY);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE bookings (id TEXT PRIMARY KEY);
      CREATE TABLE booking_requests (id TEXT PRIMARY KEY);
      CREATE TABLE costs (id TEXT PRIMARY KEY);
      INSERT INTO roles (id, permissions) VALUES ('manager', '["vehicles_view"]');
      PRAGMA user_version = 5;
    `);
    assert.equal(migrateCostCentersSchema(db), true);
    assert.equal(Number(db.pragma('user_version', { simple: true })), 6);
    for (const table of ['vehicles', 'drivers', 'users', 'bookings', 'booking_requests', 'costs']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
      assert.ok(columns.includes('cost_center_id'), `${table}.cost_center_id fehlt`);
      const fk = db.prepare(`PRAGMA foreign_key_list(${table})`).all().find((entry) => entry.table === 'cost_centers');
      assert.ok(fk, `${table} hat keinen FK auf cost_centers`);
      assert.equal(fk.on_delete, 'SET NULL');
    }
    const managerPermissions = parsePermissions(db.prepare("SELECT permissions FROM roles WHERE id = 'manager'").get().permissions);
    assert.ok(managerPermissions.includes('cost_centers_view'));
    assert.ok(managerPermissions.includes('cost_centers_manage'));
    assert.equal(migrateCostCentersSchema(db), false);
    assert.equal(Number(db.pragma('user_version', { simple: true })), 6);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
