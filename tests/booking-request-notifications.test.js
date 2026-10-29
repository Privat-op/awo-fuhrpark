'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  approverRecipients,
  notifyBookingRequestCreated,
  notifyBookingRequestDecision
} = require('../server/lib/booking-request-notifications');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
const DATA_DIR = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-booking-mail-'));

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Mail-Testorganisation', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO smtp_settings (id, host, port, secure, username, from_address, enabled, updated_at)
    VALUES (1, 'smtp.example.invalid', 587, 0, '', 'noreply@example.invalid', 1, '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
    VALUES ('viewer-role', 'Viewer', '["vehicles_view"]', '{}', '{"allow":[],"deny":[]}', 0, 100000, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
    VALUES ('approver-role', 'Approver', '["vehicles_view","booking_requests_manage"]', '{}', '{"allow":[],"deny":[]}', 0, 500000, '2026-01-01', '2026-01-01')
  `).run();

  insertUser(db, 'u-admin', 'admin-mail@example.invalid', 'admin');
  insertUser(db, 'u-manager', 'manager-mail@example.invalid', 'manager');
  insertUser(db, 'u-approver', 'approver-mail@example.invalid', 'approver-role');
  insertUser(db, 'u-requester', 'requester-mail@example.invalid', 'viewer-role');
  insertUser(db, 'u-inactive', 'inactive-mail@example.invalid', 'manager', 0);

  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, seats, status, mileage, created_at, updated_at)
    VALUES ('v-1', 'Testbus', 'HB-MAIL 1', 'Bus', 'Diesel', 20, 'available', 1000, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO drivers (id, name, role, status, created_at, updated_at)
    VALUES ('d-1', 'Testfahrer', 'Fahrer:in', 'available', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO booking_requests
      (id, vehicle_id, driver_id, requested_by, purpose, start_at, end_at, notes, status, created_at, updated_at)
    VALUES ('r-1', 'v-1', 'd-1', 'u-requester', 'Ausflug', '2026-10-29 08:00', '2026-10-29 17:00', 'Bitte pünktlich', 'requested', '2026-10-28 10:00', '2026-10-28 10:00')
  `).run();
  db.prepare(`
    INSERT INTO booking_requests
      (id, vehicle_id, driver_id, requested_by, purpose, start_at, end_at, notes, status, created_at, updated_at)
    VALUES ('r-2', 'v-1', 'd-1', 'u-requester', 'Zweite Fahrt', '2026-10-30 08:00', '2026-10-30 12:00', '', 'requested', '2026-10-28 11:00', '2026-10-28 11:00')
  `).run();
  return db;
}

function insertUser(db, id, email, role, active = 1) {
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, 'x', ?, ?, '2026-01-01', '2026-01-01')
  `).run(id, email, id, role, active);
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

test('Empfänger: Admin, Fuhrparkleitung und booking_requests_manage, ohne Anfragende', () => {
  const db = createDb();
  try {
    const recipients = approverRecipients(db, { excludeUserId: 'u-requester' });
    assert.deepEqual(recipients, [
      'admin-mail@example.invalid',
      'approver-mail@example.invalid',
      'manager-mail@example.invalid'
    ]);
  } finally {
    db.close();
  }
});

test('Eingang: eine Mail an Zuständige, Retry erzeugt kein Duplikat', async () => {
  const db = createDb();
  try {
    const transport = fakeTransport();
    const first = await notifyBookingRequestCreated(db, 'r-1', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory,
      now: new Date('2026-10-28T10:00:00.000Z')
    });
    assert.equal(first.sent, 1);
    assert.equal(transport.messages.length, 1);
    const mail = transport.messages[0];
    assert.match(mail.to, /admin-mail@example\.invalid/);
    assert.match(mail.to, /manager-mail@example\.invalid/);
    assert.match(mail.to, /approver-mail@example\.invalid/);
    assert.doesNotMatch(mail.to, /requester-mail@example\.invalid/);
    assert.match(mail.text, /Testbus/);
    assert.match(mail.text, /Ausflug/);

    const retry = await notifyBookingRequestCreated(db, 'r-1', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory,
      now: new Date('2026-10-28T10:05:00.000Z')
    });
    assert.equal(retry.skipped, 'already_sent');
    assert.equal(transport.messages.length, 1);
    const delivery = db.prepare("SELECT status FROM notification_deliveries WHERE dedupe_key = 'booking-request:r-1:created'").get();
    assert.equal(delivery.status, 'sent');
    const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'booking_request_notification'").all();
    assert.ok(audit.length >= 1);
    for (const entry of audit) {
      assert.doesNotMatch(String(entry.details), /requester-mail|admin-mail|manager-mail|approver-mail/);
    }
  } finally {
    db.close();
  }
});

test('Entscheidung: nur die anfragende Person erhält Genehmigung oder Ablehnung', async () => {
  const db = createDb();
  try {
    db.prepare("UPDATE booking_requests SET status = 'approved', decision_note = 'Passt' WHERE id = 'r-1'").run();
    const transport = fakeTransport();
    const approved = await notifyBookingRequestDecision(db, 'r-1', 'approved', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory
    });
    assert.equal(approved.sent, 1);
    assert.equal(transport.messages.length, 1);
    assert.equal(transport.messages[0].to, 'requester-mail@example.invalid');
    assert.match(transport.messages[0].subject, /genehmigt/);
    assert.match(transport.messages[0].text, /Passt/);

    const retry = await notifyBookingRequestDecision(db, 'r-1', 'approved', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory
    });
    assert.equal(retry.skipped, 'already_sent');
    assert.equal(transport.messages.length, 1);

    db.prepare("UPDATE booking_requests SET status = 'rejected', decision_note = 'Fahrzeug belegt' WHERE id = 'r-2'").run();
    const rejected = await notifyBookingRequestDecision(db, 'r-2', 'rejected', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory
    });
    assert.equal(rejected.sent, 1);
    assert.equal(transport.messages.length, 2);
    assert.match(transport.messages[1].subject, /abgelehnt/);
    assert.match(transport.messages[1].text, /Fahrzeug belegt/);
  } finally {
    db.close();
  }
});

test('Teams-Kanal respektiert den Schalter für Buchungsanfragen', async () => {
  process.env.TEAMS_WEBHOOK_URL = 'https://teams.example.invalid/hook';
  const db = createDb();
  try {
    db.prepare(`
      INSERT INTO integration_settings (id, teams_enabled, teams_send_booking_requests, updated_at)
      VALUES (1, 1, 0, '2026-01-01')
    `).run();
    const calls = [];
    const transport = fakeTransport();
    const result = await notifyBookingRequestCreated(db, 'r-1', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory,
      teamsFetch: async (...args) => {
        calls.push(args);
        return { ok: true };
      }
    });
    assert.equal(calls.length, 0);
    assert.equal(result.teamsSent, 0);
    assert.equal(result.sent, 1);
    assert.equal(transport.messages.length, 1);
  } finally {
    delete process.env.TEAMS_WEBHOOK_URL;
    db.close();
  }
});

test('SMTP aus oder Versandfehler blockieren die Aktion nicht', async () => {
  const db = createDb();
  try {
    db.prepare('UPDATE smtp_settings SET enabled = 0 WHERE id = 1').run();
    const transport = fakeTransport();
    const skipped = await notifyBookingRequestCreated(db, 'r-1', {
      dataDir: DATA_DIR,
      transportFactory: transport.factory
    });
    assert.equal(skipped.skipped, 'smtp_not_configured');
    assert.equal(transport.messages.length, 0);

    db.prepare('UPDATE smtp_settings SET enabled = 1 WHERE id = 1').run();
    const failing = fakeTransport({ fail: true });
    const failed = await notifyBookingRequestCreated(db, 'r-2', {
      dataDir: DATA_DIR,
      transportFactory: failing.factory,
      now: new Date('2026-10-28T12:00:00.000Z')
    });
    assert.equal(failed.failed, 1);
    const delivery = db.prepare("SELECT status, error_code FROM notification_deliveries WHERE dedupe_key = 'booking-request:r-2:created'").get();
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
