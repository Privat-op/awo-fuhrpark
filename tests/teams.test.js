'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { deliverTeams, messageCard } = require('../server/lib/teams');
const { runLeasingNotifications } = require('../server/lib/leasing');
const { runMaintenanceNotifications } = require('../server/lib/maintenance-reminders');
const { notifyBookingRequestCreated } = require('../server/lib/booking-request-notifications');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-teams-'));
const NOW = new Date(2026, 9, 28, 12, 0, 0);
const WEBHOOK = 'https://teams.example.invalid/webhook';

function isoDay(offset, base = NOW) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Teams-Testorganisation', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
    VALUES ('viewer-role', 'Viewer', '[]', '{}', '{"allow":[],"deny":[]}', 0, 100000, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES ('admin', 'admin-teams@example.invalid', 'Teams Admin', 'x', 'admin', 1, '2026-01-01', '2026-01-01')
  `).run();
  return db;
}

function insertVehicle(db, id, values = {}) {
  db.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, status, ownership_type, mileage, tuv, next_service,
       leasing_start, leasing_end, leasing_start_km, leasing_km_limit, created_at, updated_at)
    VALUES (?, ?, ?, 'Pkw', 'Diesel', 5, 'available', ?, 1000, ?, ?, ?, ?, ?, ?, '2026-01-01', '2026-01-01')
  `).run(
    id,
    values.name || 'Teams-Fahrzeug',
    values.plate || `HB-T ${id}`,
    values.leasingEnd || values.leasingKmLimit ? 'leasing' : 'owned',
    values.tuv || null,
    values.nextService || null,
    values.leasingStart || null,
    values.leasingEnd || null,
    values.leasingStartKm ?? null,
    values.leasingKmLimit ?? null
  );
}

function fakeFetch({ ok = true } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok, status: ok ? 200 : 500 };
    }
  };
}

after(() => {
  delete process.env.TEAMS_WEBHOOK_URL;
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('MessageCard und Dedupe: Versand, Payload, kein zweiter Versand', async () => {
  process.env.TEAMS_WEBHOOK_URL = WEBHOOK;
  const db = createDb();
  try {
    const mock = fakeFetch();
    const first = await deliverTeams(db, {
      dedupeKey: 'test:one',
      title: 'Testtitel',
      text: 'Textzeile',
      kind: 'test',
      entityType: 'vehicle',
      entityId: 'v1',
      vehicleId: 'v1',
      now: NOW,
      fetchImpl: mock.fetch
    });
    assert.equal(first.sent, 1);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, WEBHOOK);
    const payload = JSON.parse(mock.calls[0].options.body);
    assert.equal(payload['@type'], 'MessageCard');
    assert.equal(payload.title, 'Testtitel');
    assert.equal(payload.text, 'Textzeile');
    assert.equal(db.prepare("SELECT status FROM notification_deliveries WHERE dedupe_key = 'teams:test:one'").get().status, 'sent');

    const second = await deliverTeams(db, {
      dedupeKey: 'test:one',
      title: 'Testtitel',
      text: 'Textzeile',
      now: new Date(NOW.getTime() + 1000),
      fetchImpl: mock.fetch
    });
    assert.equal(second.skipped, 'already_sent');
    assert.equal(mock.calls.length, 1);
    assert.equal(messageCard({ title: 'A', text: 'B' }).summary, 'A');
  } finally {
    db.close();
  }
});

test('Fehlende Konfiguration ist No-op, Fehler blockieren nicht', async () => {
  delete process.env.TEAMS_WEBHOOK_URL;
  const db = createDb();
  try {
    const mock = fakeFetch();
    const noop = await deliverTeams(db, { dedupeKey: 'test:noop', title: 'A', text: 'B', fetchImpl: mock.fetch });
    assert.equal(noop.skipped, 'not_configured');
    assert.equal(mock.calls.length, 0);
  } finally {
    db.close();
  }

  process.env.TEAMS_WEBHOOK_URL = WEBHOOK;
  const failingDb = createDb();
  try {
    const mock = fakeFetch({ ok: false });
    const failed = await deliverTeams(failingDb, {
      dedupeKey: 'test:fail',
      title: 'A',
      text: 'B',
      now: NOW,
      fetchImpl: mock.fetch
    });
    assert.equal(failed.failed, 1);
    const row = failingDb.prepare("SELECT status, error_code FROM notification_deliveries WHERE dedupe_key = 'teams:test:fail'").get();
    assert.equal(row.status, 'failed');
    assert.equal(row.error_code, 'TEAMS_ERROR');
    const retry = await deliverTeams(failingDb, {
      dedupeKey: 'test:fail',
      title: 'A',
      text: 'B',
      now: new Date(NOW.getTime() + 1000),
      fetchImpl: mock.fetch
    });
    assert.equal(retry.skipped, 'already_sent');
  } finally {
    failingDb.close();
  }
});

test('Teams-Integration: Leasing, Buchungsanfrage und Wartung ohne SMTP', async () => {
  process.env.TEAMS_WEBHOOK_URL = WEBHOOK;
  const db = createDb();
  try {
    insertVehicle(db, 'v-lease', {
      leasingStart: isoDay(-30),
      leasingStartKm: 0,
      leasingKmLimit: 1000,
      leasingEnd: isoDay(30)
    });
    db.prepare('UPDATE vehicles SET mileage = 900 WHERE id = ?').run('v-lease');
    const leasingMock = fakeFetch();
    const leasing = await runLeasingNotifications(db, { dataDir: DATA_DIR, now: NOW, teamsFetch: leasingMock.fetch });
    assert.equal(leasing.sent, 0);
    assert.ok(leasing.teamsSent >= 1);
    assert.ok(leasingMock.calls.some((call) => JSON.parse(call.options.body).title.includes('Leasing')));

    insertVehicle(db, 'v-maint', { tuv: isoDay(7) });
    const maintenanceMock = fakeFetch();
    const maintenance = await runMaintenanceNotifications(db, { dataDir: DATA_DIR, now: NOW, teamsFetch: maintenanceMock.fetch });
    assert.equal(maintenance.sent, 0);
    assert.ok(maintenance.teamsSent >= 1);

    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES ('requester', 'requester-teams@example.invalid', 'Teams Requester', 'x', 'viewer-role', 1, '2026-01-01', '2026-01-01')
    `).run();
    db.prepare(`
      INSERT INTO drivers (id, name, role, status, created_at, updated_at)
      VALUES ('d-1', 'Teams Fahrer', 'Fahrer:in', 'available', '2026-01-01', '2026-01-01')
    `).run();
    db.prepare(`
      INSERT INTO booking_requests
        (id, vehicle_id, driver_id, requested_by, purpose, start_at, end_at, status, created_at, updated_at)
      VALUES ('r-1', 'v-lease', 'd-1', 'requester', 'Teams-Test', '2026-10-29 08:00', '2026-10-29 12:00', 'requested', '2026-10-28 10:00', '2026-10-28 10:00')
    `).run();
    const requestMock = fakeFetch();
    const request = await notifyBookingRequestCreated(db, 'r-1', {
      dataDir: DATA_DIR,
      now: NOW,
      teamsFetch: requestMock.fetch
    });
    assert.equal(request.sent, 0);
    assert.equal(request.teamsSent, 1);
    assert.equal(requestMock.calls.length, 1);
  } finally {
    db.close();
  }
});
