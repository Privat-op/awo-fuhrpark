'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  collectMaintenanceReminders,
  getRecipients,
  runMaintenanceNotifications,
  thresholdFor
} = require('../server/lib/maintenance-reminders');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-maintenance-mail-'));
const NOW = new Date(2026, 9, 28, 12, 0, 0);

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
    VALUES ('Wartungs-Testorganisation', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO smtp_settings (id, host, port, secure, username, from_address, enabled, updated_at)
    VALUES (1, 'smtp.example.invalid', 587, 0, '', 'noreply@example.invalid', 1, '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
    VALUES ('viewer-role', 'Viewer', '["vehicles_view"]', '{}', '{"allow":[],"deny":[]}', 0, 100000, '2026-01-01', '2026-01-01')
  `).run();
  insertUser(db, 'u-admin', 'admin-reminder@example.invalid', 'admin', 1);
  insertUser(db, 'u-manager', 'manager-reminder@example.invalid', 'manager', 1);
  insertUser(db, 'u-inactive', 'inactive-reminder@example.invalid', 'manager', 0);
  insertUser(db, 'u-viewer', 'viewer-reminder@example.invalid', 'viewer-role', 1);
  return db;
}

function insertUser(db, id, email, role, active) {
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, 'x', ?, ?, '2026-01-01', '2026-01-01')
  `).run(id, email, id, role, active);
}

function insertVehicle(db, id, { name, plate, tuv = null, nextService = null }) {
  db.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, status, mileage, tuv, next_service, created_at, updated_at)
    VALUES (?, ?, ?, 'Pkw', 'Diesel', 5, 'available', 1000, ?, ?, '2026-01-01', '2026-01-01')
  `).run(id, name, plate, tuv, nextService);
}

function insertMaintenance(db, id, vehicleId, title, dueDate, status = 'planned', completedAt = null) {
  db.prepare(`
    INSERT INTO maintenance (id, vehicle_id, title, due_date, workshop, cost, status, notes, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', 0, ?, '', ?, '2026-01-01', '2026-01-01')
  `).run(id, vehicleId, title, dueDate, status, completedAt);
}

function fakeTransport({ fail = false } = {}) {
  const messages = [];
  return {
    messages,
    factory: () => ({
      async sendMail(message) {
        if (fail) throw Object.assign(new Error('SMTP down'), { code: 'ECONNECTION' });
        messages.push(message);
        return { accepted: [message.to] };
      },
      close() {}
    })
  };
}

test('Schwellen: 30/14/7 und überfällig, Dedupe pro Fahrzeug/Typ/Schwelle', () => {
  assert.equal(thresholdFor(31), null);
  assert.equal(thresholdFor(30), 30);
  assert.equal(thresholdFor(15), 30);
  assert.equal(thresholdFor(14), 14);
  assert.equal(thresholdFor(8), 14);
  assert.equal(thresholdFor(7), 7);
  assert.equal(thresholdFor(0), 7);
  assert.equal(thresholdFor(-1), 'overdue');

  const db = createDb();
  try {
    insertVehicle(db, 'v-1', { name: 'Bus Eins', plate: 'HB-W 1', tuv: isoDay(14), nextService: isoDay(30) });
    insertVehicle(db, 'v-2', { name: 'Bus Zwei', plate: 'HB-W 2', tuv: isoDay(31), nextService: null });
    insertMaintenance(db, 'm-30', 'v-1', 'Bremsen', isoDay(30));
    insertMaintenance(db, 'm-14', 'v-1', 'Reifen', isoDay(14));
    insertMaintenance(db, 'm-7', 'v-1', 'Ölwechsel', isoDay(7));
    insertMaintenance(db, 'm-over', 'v-1', 'Inspektion', isoDay(-1));
    insertMaintenance(db, 'm-done', 'v-1', 'Erledigt', isoDay(7), 'done', isoDay(-2));
    insertMaintenance(db, 'm-future', 'v-1', 'Später', isoDay(31));

    const reminders = collectMaintenanceReminders(db, NOW);
    const keys = reminders.map((entry) => entry.dedupeKey).sort();
    assert.equal(reminders.length, 6);
    assert.ok(keys.some((key) => key.startsWith('maintenance:maintenance:m-30:') && key.endsWith(':30')));
    assert.ok(keys.some((key) => key.startsWith('maintenance:maintenance:m-14:') && key.endsWith(':14')));
    assert.ok(keys.some((key) => key.startsWith('maintenance:maintenance:m-7:') && key.endsWith(':7')));
    assert.ok(keys.some((key) => key.startsWith('maintenance:maintenance:m-over:') && key.endsWith(':overdue')));
    assert.ok(keys.some((key) => key.startsWith('tuv:vehicle:v-1:') && key.endsWith(':14')));
    assert.ok(keys.some((key) => key.startsWith('service:vehicle:v-1:') && key.endsWith(':30')));
    assert.equal(keys.some((key) => key.includes('m-done')), false);
    assert.equal(keys.some((key) => key.includes('m-future')), false);
    assert.equal(keys.some((key) => key.includes('v-2')), false);

    const later = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 8, 12, 0, 0);
    const laterKeys = collectMaintenanceReminders(db, later).map((entry) => entry.dedupeKey);
    assert.ok(laterKeys.some((key) => key.startsWith('tuv:vehicle:v-1:') && key.endsWith(':7')));
  } finally {
    db.close();
  }
});

test('Scheduler: Empfänger, Versand, Dedupe und Audit ohne Secrets', async () => {
  const db = createDb();
  try {
    assert.deepEqual(getRecipients(db), ['admin-reminder@example.invalid', 'manager-reminder@example.invalid']);
    insertVehicle(db, 'v-1', { name: 'Bus Eins', plate: 'HB-W 1', tuv: isoDay(14), nextService: isoDay(30) });
    insertMaintenance(db, 'm-1', 'v-1', 'Bremsen', isoDay(7));
    insertMaintenance(db, 'm-2', 'v-1', 'Reifen', isoDay(-1));

    const transport = fakeTransport();
    const first = await runMaintenanceNotifications(db, {
      dataDir: DATA_DIR,
      transportFactory: transport.factory,
      now: NOW
    });
    assert.equal(first.sent, 4);
    assert.equal(first.failed, 0);
    assert.equal(transport.messages.length, 4);
    for (const mail of transport.messages) {
      assert.match(mail.to, /admin-reminder@example\.invalid/);
      assert.match(mail.to, /manager-reminder@example\.invalid/);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE status = 'sent'").get().count, 4);

    const second = await runMaintenanceNotifications(db, {
      dataDir: DATA_DIR,
      transportFactory: transport.factory,
      now: NOW
    });
    assert.equal(second.sent, 0);
    assert.equal(transport.messages.length, 4);

    const audit = db.prepare("SELECT action, details FROM audit_logs WHERE action = 'maintenance_notification'").all();
    assert.equal(audit.length, 4);
    for (const entry of audit) {
      assert.doesNotMatch(String(entry.details), /@example\.invalid/);
      assert.doesNotMatch(String(entry.details), /smtp\.example/);
    }
  } finally {
    db.close();
  }
});

test('SMTP aus oder Versandfehler blockieren den Scheduler nicht', async () => {
  const db = createDb();
  try {
    insertVehicle(db, 'v-1', { name: 'Bus Eins', plate: 'HB-W 1', tuv: isoDay(7), nextService: null });
    db.prepare('UPDATE smtp_settings SET enabled = 0 WHERE id = 1').run();
    const transport = fakeTransport();
    const skipped = await runMaintenanceNotifications(db, {
      dataDir: DATA_DIR,
      transportFactory: transport.factory,
      now: NOW
    });
    assert.equal(skipped.skipped, 'smtp_not_configured');
    assert.equal(transport.messages.length, 0);

    db.prepare('UPDATE smtp_settings SET enabled = 1 WHERE id = 1').run();
    const failing = fakeTransport({ fail: true });
    const failed = await runMaintenanceNotifications(db, {
      dataDir: DATA_DIR,
      transportFactory: failing.factory,
      now: NOW
    });
    assert.equal(failed.sent, 0);
    assert.equal(failed.failed, 1);
    const delivery = db.prepare("SELECT status, error_code FROM notification_deliveries WHERE kind = 'tuv'").get();
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.error_code, 'ECONNECTION');
    assert.equal(failing.messages.length, 0);
  } finally {
    db.close();
  }
});

after(() => {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});
