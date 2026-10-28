'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  getRetentionSettings,
  setRetentionSettings,
  runRetention
} = require('../server/lib/retention');
const { migrateRetentionSchema, RETENTION_SCHEMA_VERSION } = require('../server/lib/retention-schema');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const NOW = new Date('2026-10-28T12:00:00.000Z');
const OLD = '2000-01-01T00:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Retention-Test', '2026-01-01', '2026-01-01')
  `).run();
  return db;
}

function insertBaseData(db) {
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES ('u1', 'retention@example.invalid', 'Retention User', 'x', 'manager', 1, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO vehicles (id, name, plate, type, fuel, created_at, updated_at)
    VALUES ('v1', 'Retention Vehicle', 'HB-R 1', 'Pkw', 'Diesel', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO drivers (id, name, created_at, updated_at)
    VALUES ('d1', 'Retention Driver', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, created_at, updated_at)
    VALUES ('b1', 'v1', 'd1', 'Retention', '2026-10-01 08:00', '2026-10-01 09:00', 'completed', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO costs (id, vehicle_id, date, category, amount, note, created_at, updated_at)
    VALUES ('c1', 'v1', '2026-10-01', 'Sonstiges', 10, 'Retention', '2026-01-01', '2026-01-01')
  `).run();
}

test('Migration 11→12 ist idempotent und ergänzt Retention-Spalten', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY, org_name TEXT, seeded_at TEXT, updated_at TEXT)');
    db.pragma('user_version = 11');
    assert.equal(migrateRetentionSchema(db), true);
    assert.equal(Number(db.pragma('user_version', { simple: true })), RETENTION_SCHEMA_VERSION);
    const columns = db.prepare('PRAGMA table_info(settings)').all().map((column) => column.name);
    assert.ok(columns.includes('audit_retention_days'));
    assert.ok(columns.includes('session_retention_days'));
    assert.ok(columns.includes('password_reset_retention_days'));
    assert.ok(columns.includes('notification_retention_days'));
    assert.equal(migrateRetentionSchema(db), false);
  } finally {
    db.close();
  }
});

test('Retention zählt, löscht nur technische Daten und respektiert Dry-Run', () => {
  const db = createDb();
  try {
    insertBaseData(db);
    db.prepare("INSERT INTO audit_logs (action, entity_type, entity_id, created_at) VALUES ('old', 'test', '1', ?)").run(OLD);
    db.prepare("INSERT INTO audit_logs (action, entity_type, entity_id, created_at) VALUES ('new', 'test', '1', ?)").run(NOW.toISOString());
    db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)').run('old-session', '{}', NOW.getTime() - 31 * DAY);
    db.prepare('INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)').run('new-session', '{}', NOW.getTime() + DAY);
    db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('old-token', 'u1', 'old-hash', NOW.toISOString(), OLD);
    db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('new-token', 'u1', 'new-hash', NOW.toISOString(), NOW.toISOString());
    db.prepare("INSERT INTO notification_deliveries (dedupe_key, channel, kind, status, created_at, updated_at) VALUES ('old-delivery', 'email', 'test', 'sent', ?, ?)").run(OLD, OLD);
    db.prepare("INSERT INTO notification_deliveries (dedupe_key, channel, kind, status, created_at, updated_at) VALUES ('new-delivery', 'email', 'test', 'sent', ?, ?)").run(NOW.toISOString(), NOW.toISOString());

    setRetentionSettings(db, {
      auditRetentionDays: 30,
      sessionRetentionDays: 30,
      passwordResetRetentionDays: 30,
      notificationRetentionDays: 30
    });
    assert.deepEqual(getRetentionSettings(db), {
      auditRetentionDays: 30,
      sessionRetentionDays: 30,
      passwordResetRetentionDays: 30,
      notificationRetentionDays: 30
    });

    const dry = runRetention(db, { now: NOW, dryRun: true });
    assert.equal(dry.total, 4);
    assert.deepEqual(dry.counts, { audit: 1, sessions: 1, passwordResets: 1, notifications: 1 });
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'old'").get());
    assert.ok(db.prepare("SELECT 1 FROM sessions WHERE sid = 'old-session'").get());

    const real = runRetention(db, { now: NOW, dryRun: false });
    assert.equal(real.total, 4);
    assert.equal(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'old'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM sessions WHERE sid = 'old-session'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM password_reset_tokens WHERE id = 'old-token'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM notification_deliveries WHERE dedupe_key = 'old-delivery'").get(), undefined);
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'new'").get());
    assert.ok(db.prepare("SELECT 1 FROM sessions WHERE sid = 'new-session'").get());
    assert.ok(db.prepare("SELECT 1 FROM password_reset_tokens WHERE id = 'new-token'").get());
    assert.ok(db.prepare("SELECT 1 FROM notification_deliveries WHERE dedupe_key = 'new-delivery'").get());
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM costs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drivers').get().count, 1);
    const retentionAudit = db.prepare("SELECT details FROM audit_logs WHERE action = 'retention_cleanup' ORDER BY id DESC LIMIT 1").get();
    assert.ok(retentionAudit);
    assert.match(retentionAudit.details, /"audit":1/);
    assert.doesNotMatch(retentionAudit.details, /@example|Retention User/);
  } finally {
    db.close();
  }
});

test('0 Tage deaktiviert die jeweilige Kategorie', () => {
  const db = createDb();
  try {
    db.prepare("INSERT INTO audit_logs (action, entity_type, entity_id, created_at) VALUES ('old', 'test', '1', ?)").run(OLD);
    setRetentionSettings(db, {
      auditRetentionDays: 0,
      sessionRetentionDays: 0,
      passwordResetRetentionDays: 0,
      notificationRetentionDays: 0
    });
    const result = runRetention(db, { now: NOW });
    assert.equal(result.total, 0);
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'old'").get());
  } finally {
    db.close();
  }
});

test('UI-/API-Bausteine für Retention sind vorhanden', () => {
  const views = fs.readFileSync(path.join(ROOT, 'public', 'views.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(views.includes('id="retentionForm"'));
  assert.ok(views.includes('data-action="retention-dry-run"'));
  assert.ok(app.includes('/api/retention/run'));
  assert.ok(app.includes('/api/retention'));
});
