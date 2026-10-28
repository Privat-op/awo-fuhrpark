'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getState } = require('../server/lib/state');
const { isObjectPermissionDenied } = require('../server/lib/permissions');

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
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role)
    VALUES ('u1', 'driver@example.invalid', 'Test Driver', 'x', 'driver')
  `).run();
  for (const [id, plate] of [['v1', 'T-1'], ['v2', 'T-2'], ['v3', 'T-3']]) {
    db.prepare(`
      INSERT INTO vehicles (id, name, plate, type, fuel)
      VALUES (?, ?, ?, 'Pkw', 'Diesel')
    `).run(id, `Vehicle ${id}`, plate);
  }
  db.prepare(`
    INSERT INTO drivers (id, name, user_id, own_trips_access)
    VALUES ('d1', 'Test Driver', 'u1', 1)
  `).run();
  return db;
}

function authLayers({ vehiclesView = true, objectDeny = null } = {}) {
  const permissions = ['drivers_view', 'own_trips_view', 'own_trips_request'];
  if (vehiclesView) permissions.push('vehicles_view');
  return {
    isAdmin: false,
    isSuperadmin: false,
    rolePermissions: new Set(permissions),
    roleObjectPermissions: {},
    userPermissionOverrides: { allow: [], deny: [] },
    userObjectPermissions: objectDeny ? { vehicle: { [objectDeny]: { deny: ['vehicles_view'] } } } : {},
    linkedDriverId: 'd1',
    driverDefaultPermissions: new Set(['own_trips_view', 'own_trips_request'])
  };
}

test('ownTrips vehicles hide an explicitly denied vehicle for users with vehicle view', () => {
  const db = createDb();
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('u1');
    const state = getState(db, user, authLayers({ vehiclesView: true, objectDeny: 'v2' }));
    assert.deepEqual(state.vehicles.map((vehicle) => vehicle.id).sort(), ['v1', 'v3']);
    assert.deepEqual(state.ownTrips.vehicles.map((vehicle) => vehicle.id).sort(), ['v1', 'v3']);
  } finally {
    db.close();
  }
});

test('ownTrips fallback keeps requestable vehicles but still hides an explicit deny', () => {
  const db = createDb();
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get('u1');
    const state = getState(db, user, authLayers({ vehiclesView: false, objectDeny: 'v2' }));
    assert.deepEqual(state.vehicles, []);
    assert.deepEqual(state.ownTrips.vehicles.map((vehicle) => vehicle.id).sort(), ['v1', 'v3']);
  } finally {
    db.close();
  }
});

test('object deny precedence: user allow wins over role deny, user deny wins over role allow', () => {
  const layers = {
    userObjectPermissions: { vehicle: { v1: { allow: ['vehicles_view'] }, v2: { deny: ['vehicles_view'] } } },
    roleObjectPermissions: { vehicle: { v1: { deny: ['vehicles_view'] }, v2: { allow: ['vehicles_view'] }, v3: { deny: ['vehicles_view'] } } }
  };
  assert.equal(isObjectPermissionDenied(layers, 'vehicle', 'v1', 'vehicles_view'), false);
  assert.equal(isObjectPermissionDenied(layers, 'vehicle', 'v2', 'vehicles_view'), true);
  assert.equal(isObjectPermissionDenied(layers, 'vehicle', 'v3', 'vehicles_view'), true);
});