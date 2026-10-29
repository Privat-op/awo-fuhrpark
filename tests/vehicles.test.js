'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { VEHICLES_SCHEMA_VERSION, migrateVehiclesSchema } = require('../server/lib/vehicles-schema');
const {
  VEHICLE_STATUSES,
  PRESERVED_STATUSES,
  vehicleUnavailableReason,
  assertVehicleBookable,
  isVehicleStatusBookable
} = require('../server/lib/vehicles');
const { calculateLeasingState, collectLeasingNotifications } = require('../server/lib/leasing');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');

function legacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plate TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('Pkw', 'Transporter', 'Bus')),
      fuel TEXT NOT NULL CHECK (fuel IN ('Diesel', 'Benzin', 'Elektro', 'Hybrid')),
      seats INTEGER NOT NULL DEFAULT 5 CHECK (seats > 0),
      location TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance')),
      mileage INTEGER NOT NULL DEFAULT 0 CHECK (mileage >= 0),
      blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
      blocked_reason TEXT NOT NULL DEFAULT '',
      next_service TEXT,
      tuv TEXT,
      insurance TEXT NOT NULL DEFAULT '',
      acquired TEXT,
      color TEXT NOT NULL DEFAULT '#2563eb',
      notes TEXT NOT NULL DEFAULT '',
      image_file TEXT,
      cost_center_id TEXT,
      location_id TEXT,
      leasing_start TEXT,
      leasing_end TEXT,
      leasing_start_km INTEGER,
      leasing_km_limit INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_vehicles_cost_center ON vehicles (cost_center_id);
    CREATE INDEX idx_vehicles_location ON vehicles (location_id);
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
      status TEXT NOT NULL
    );    CREATE TABLE costs (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id)
    );
    CREATE TABLE maintenance (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id)
    );
    CREATE TABLE locations (id TEXT PRIMARY KEY);
    CREATE TABLE cost_centers (id TEXT PRIMARY KEY);
  `);
  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, status, mileage, notes, created_at, updated_at)
    VALUES ('v-owned', 'Eigentum', 'HB-E 1', 'Pkw', 'Diesel', 'available', 1000, 'alt', '2026-01-01', '2026-01-02')
  `).run();
  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, status, mileage, leasing_start, leasing_end, leasing_start_km, leasing_km_limit, created_at, updated_at)
    VALUES ('v-lease', 'Leasing', 'HB-L 1', 'Pkw', 'Diesel', 'in_use', 80000, '2026-01-01', '2027-01-01', 0, 100000, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, status, mileage, created_at, updated_at)
    VALUES ('v-maint', 'Wartung', 'HB-M 1', 'Transporter', 'Diesel', 'maintenance', 5000, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare("INSERT INTO bookings (id, vehicle_id, status) VALUES ('b-1', 'v-owned', 'planned')").run();
  db.prepare("INSERT INTO costs (id, vehicle_id) VALUES ('c-1', 'v-lease')").run();
  db.prepare("INSERT INTO maintenance (id, vehicle_id) VALUES ('m-1', 'v-maint')").run();
  db.pragma('user_version = 17');
  return db;
}

test('Migration 17→18: Ownership-Backfill, Status-CHECK, FK-Integrität und Idempotenz', () => {
  const db = legacyDb();
  try {
    assert.equal(migrateVehiclesSchema(db), true);
    assert.equal(Number(db.pragma('user_version', { simple: true })), VEHICLES_SCHEMA_VERSION);

    const rows = db.prepare('SELECT * FROM vehicles ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.id === 'v-owned').ownership_type, 'owned');
    assert.equal(rows.find((row) => row.id === 'v-lease').ownership_type, 'leasing');
    assert.equal(rows.find((row) => row.id === 'v-maint').ownership_type, 'owned');
    assert.equal(rows.find((row) => row.id === 'v-owned').notes, 'alt');
    assert.equal(rows.find((row) => row.id === 'v-owned').created_at, '2026-01-01');
    assert.equal(rows.find((row) => row.id === 'v-maint').status, 'maintenance');
    assert.equal(db.prepare("SELECT vehicle_id FROM bookings WHERE id = 'b-1'").get().vehicle_id, 'v-owned');
    assert.equal(db.prepare("SELECT vehicle_id FROM costs WHERE id = 'c-1'").get().vehicle_id, 'v-lease');
    assert.equal(db.prepare("SELECT vehicle_id FROM maintenance WHERE id = 'm-1'").get().vehicle_id, 'v-maint');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_vehicles_cost_center'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_vehicles_location'").get());

    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vehicles'").get().sql;
    for (const status of ['defect', 'sold', 'not_drivable']) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    assert.match(sql, /ownership_type/);

    db.prepare(`
      INSERT INTO vehicles (id, name, plate, type, fuel, status, ownership_type, mileage, created_at, updated_at)
      VALUES ('v-defect', 'Defekt', 'HB-D 1', 'Pkw', 'Diesel', 'defect', 'owned', 1, '2026-01-01', '2026-01-01')
    `).run();
    for (const status of ['available', 'in_use', 'maintenance', 'defect', 'sold', 'not_drivable']) {
      assert.equal(VEHICLE_STATUSES.includes(status), true);
    }
    assert.throws(() => db.prepare(`
      INSERT INTO vehicles (id, name, plate, type, fuel, status, ownership_type, created_at, updated_at)
      VALUES ('v-invalid', 'Ungültig', 'HB-X 1', 'Pkw', 'Diesel', 'broken', 'owned', '2026-01-01', '2026-01-01')
    `).run(), /CHECK/);
    assert.throws(() => db.prepare(`
      INSERT INTO vehicles (id, name, plate, type, fuel, status, ownership_type, created_at, updated_at)
      VALUES ('v-invalid-owner', 'Ungültig', 'HB-X 2', 'Pkw', 'Diesel', 'available', 'rental', '2026-01-01', '2026-01-01')
    `).run(), /CHECK/);

    assert.equal(migrateVehiclesSchema(db), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM vehicles').get().count, 4);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('vehicleUnavailableReason und assertVehicleBookable liefern klare Statusmeldungen', () => {
  const base = { name: 'Caddy', blocked: 0 };
  assert.equal(vehicleUnavailableReason({ ...base, status: 'available' }), null);
  assert.equal(vehicleUnavailableReason({ ...base, status: 'in_use' }), null);
  assert.match(vehicleUnavailableReason({ ...base, status: 'maintenance' }), /befindet sich in Wartung/);
  assert.match(vehicleUnavailableReason({ ...base, status: 'defect' }), /ist defekt/);
  assert.match(vehicleUnavailableReason({ ...base, status: 'sold' }), /als veräußert markiert/);
  assert.match(vehicleUnavailableReason({ ...base, status: 'not_drivable' }), /nicht fahrbereit/);
  const blocked = vehicleUnavailableReason({ ...base, status: 'available', blocked: 1, blocked_reason: 'Unfall' });
  assert.match(blocked, /dauerhaft gesperrt/);
  assert.match(blocked, /Unfall/);
  for (const status of ['maintenance', 'defect', 'sold', 'not_drivable']) {
    assert.throws(() => assertVehicleBookable({ ...base, status }), (error) => error.status === 409);
    assert.equal(isVehicleStatusBookable(status), false);
  }
  assert.equal(isVehicleStatusBookable('available'), true);
  assert.equal(isVehicleStatusBookable('in_use'), true);
  assert.deepEqual([...PRESERVED_STATUSES].sort(), ['defect', 'maintenance', 'not_drivable', 'sold']);
});

test('Eigentum ignoriert Leasingdaten; nur Leasing erzeugt Warnungen', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO settings (org_name, seeded_at, updated_at) VALUES ('Test', '2026-01-01', '2026-01-01')").run();
  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, status, ownership_type, mileage, leasing_start, leasing_end, leasing_start_km, leasing_km_limit, created_at, updated_at)
    VALUES ('v-owned', 'Eigentum', 'HB-E 1', 'Pkw', 'Diesel', 'available', 'owned', 80000, '2026-01-01', '2027-01-01', 0, 100000, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, status, ownership_type, mileage, leasing_start, leasing_end, leasing_start_km, leasing_km_limit, created_at, updated_at)
    VALUES ('v-lease', 'Leasing', 'HB-L 1', 'Pkw', 'Diesel', 'available', 'leasing', 80000, '2026-01-01', '2027-01-01', 0, 100000, '2026-01-01', '2026-01-01')
  `).run();
  try {
    const owned = db.prepare("SELECT * FROM vehicles WHERE id = 'v-owned'").get();
    const leasing = db.prepare("SELECT * FROM vehicles WHERE id = 'v-lease'").get();
    assert.equal(calculateLeasingState(owned), null);
    assert.equal(calculateLeasingState(leasing).percent, 80);
    const notifications = collectLeasingNotifications(db, new Date('2026-10-29T00:00:00Z'));
    assert.ok(notifications.length > 0);
    assert.equal(notifications.every((entry) => entry.vehicleId === 'v-lease'), true);
  } finally {
    db.close();
  }
});
