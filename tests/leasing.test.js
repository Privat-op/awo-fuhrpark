'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  calculateLeasingState,
  collectLeasingNotifications,
  runLeasingNotifications
} = require('../server/lib/leasing');
const {
  getPublicSmtpConfig,
  saveSmtpConfig
} = require('../server/lib/smtp');
const {
  migrateLeasingSchema,
  LEASING_SCHEMA_VERSION
} = require('../server/lib/leasing-schema');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const NOW = new Date(2026, 9, 28, 12, 0, 0);

let tempDir;
let db;

function isoDay(offsetDays, base = NOW) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createDb() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA);
  migrateLeasingSchema(database);
  database.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Test-Fuhrpark', '2026-01-01', '2026-01-01')
  `).run();
  return database;
}

function insertVehicle(database, overrides = {}) {
  const values = {
    id: 'vehicle-1',
    name: 'Testfahrzeug',
    plate: 'HB-T 1',
    type: 'Pkw',
    fuel: 'Diesel',
    seats: 5,
    status: 'available',
    mileage: 80000,
    leasingStart: null,
    leasingEnd: null,
    leasingStartKm: null,
    leasingKmLimit: null,
    ...overrides
  };
  database.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, location, department, status, mileage, blocked, blocked_reason, color, notes,
       leasing_start, leasing_end, leasing_start_km, leasing_km_limit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?, 0, '', '#2563eb', '', ?, ?, ?, ?, '2026-01-01', '2026-01-01')
  `).run(
    values.id, values.name, values.plate, values.type, values.fuel, values.seats, values.status, values.mileage,
    values.leasingStart, values.leasingEnd, values.leasingStartKm, values.leasingKmLimit
  );
  return values;
}

function insertUser(database, { id, email, role }) {
  database.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, 'x', ?, 1, '2026-01-01', '2026-01-01')
  `).run(id, email, id, role);
}

function fakeTransportFactory(messages, error = null) {
  return () => ({
    async sendMail(message) {
      if (error) throw error;
      messages.push(message);
      return { messageId: `test-${messages.length}` };
    },
    close() {}
  });
}

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-leasing-unit-'));
  db = createDb();
});

after(() => {
  try { db.close(); } catch { /* bereits geschlossen */ }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('Leasing-Schwellen 80/90/100 Prozent und Restkilometer werden korrekt berechnet', () => {
  const base = {
    name: 'Caddy',
    plate: 'HB-C 1',
    mileage: 80000,
    leasing_start_km: 0,
    leasing_km_limit: 100000,
    leasing_end: isoDay(120)
  };
  const at80 = calculateLeasingState({ ...base, mileage: 80000 }, NOW);
  assert.equal(at80.kmLevel, 80);
  assert.equal(at80.percent, 80);
  assert.equal(at80.remainingKm, 20000);
  assert.equal(at80.warnings[0].severity, 'warning');

  const at90 = calculateLeasingState({ ...base, mileage: 90000 }, NOW);
  assert.equal(at90.kmLevel, 90);
  assert.equal(at90.remainingKm, 10000);

  const at100 = calculateLeasingState({ ...base, mileage: 100000 }, NOW);
  assert.equal(at100.kmLevel, 100);
  assert.equal(at100.remainingKm, 0);
  assert.equal(at100.status, 'critical');
  assert.equal(at100.warnings[0].severity, 'danger');

  const above = calculateLeasingState({ ...base, mileage: 104500 }, NOW);
  assert.equal(above.kmLevel, 100);
  assert.equal(above.remainingKm, -4500);
  assert.match(above.warnings[0].text, /4\.500 km über dem Limit/);
});

test('Leasingende 90/30 Tage und Überfälligkeit werden erkannt', () => {
  const base = { name: 'Bus', plate: 'HB-B 1', mileage: 1000, leasing_start_km: 0, leasing_km_limit: 50000 };
  const in90 = calculateLeasingState({ ...base, leasing_end: isoDay(90) }, NOW);
  assert.equal(in90.endLevel, 90);
  assert.equal(in90.status, 'warning');

  const in30 = calculateLeasingState({ ...base, leasing_end: isoDay(30) }, NOW);
  assert.equal(in30.endLevel, 30);
  assert.equal(in30.status, 'critical');

  const expired = calculateLeasingState({ ...base, leasing_end: isoDay(-2) }, NOW);
  assert.equal(expired.endLevel, 'expired');
  assert.equal(expired.status, 'critical');
  assert.match(expired.warnings[0].text, /seit 2 Tagen abgelaufen/);
});

test('Fahrzeuge ohne Leasingdaten bleiben unverändert und ohne Warnung', () => {
  assert.equal(calculateLeasingState({ mileage: 12000 }, NOW), null);
  assert.equal(calculateLeasingState({ mileage: 12000, leasing_end: null, leasing_km_limit: null }, NOW), null);
});

test('Dedupe: jede Schwelle wird pro Leasingzeitraum genau einmal versendet', async () => {
  const database = createDb();
  try {
    insertUser(database, { id: 'admin-1', email: 'admin@example.invalid', role: 'admin' });
    insertUser(database, { id: 'manager-1', email: 'manager@example.invalid', role: 'manager' });
    insertVehicle(database, {
      id: 'vehicle-dedupe',
      name: 'Dedupe-Fahrzeug',
      plate: 'HB-D 1',
      mileage: 80000,
      leasingStart: '2026-01-01',
      leasingEnd: isoDay(90),
      leasingStartKm: 0,
      leasingKmLimit: 100000
    });
    saveSmtpConfig(database, {
      enabled: true,
      host: 'smtp.invalid',
      port: 587,
      secure: false,
      username: '',
      fromAddress: 'fuhrpark@example.invalid'
    }, { dataDir: tempDir });

    const messages = [];
    const first = await runLeasingNotifications(database, {
      dataDir: tempDir,
      now: NOW,
      transportFactory: fakeTransportFactory(messages)
    });
    assert.equal(first.sent, 2, 'Kilometer- und Endschwelle müssen versendet werden');
    assert.equal(messages.length, 2);
    assert.equal(collectLeasingNotifications(database, NOW).length, 2);

    const second = await runLeasingNotifications(database, {
      dataDir: tempDir,
      now: NOW,
      transportFactory: fakeTransportFactory(messages)
    });
    assert.equal(second.sent, 0, 'Bereits versendete Schwellen dürfen nicht erneut senden');
    assert.equal(messages.length, 2);

    database.prepare('UPDATE vehicles SET mileage = 90000 WHERE id = ?').run('vehicle-dedupe');
    const third = await runLeasingNotifications(database, {
      dataDir: tempDir,
      now: NOW,
      transportFactory: fakeTransportFactory(messages)
    });
    assert.equal(third.sent, 1, 'Beim Überschreiten der 90-%-Schwelle wird genau eine neue Mail versendet');
    assert.equal(messages.length, 3);
  } finally {
    database.close();
  }
});

test('SMTP-Fehler werden ohne Secrets gespeichert; Retry erst nach Wartezeit', async () => {
  const database = createDb();
  try {
    insertUser(database, { id: 'admin-2', email: 'admin2@example.invalid', role: 'admin' });
    insertVehicle(database, {
      id: 'vehicle-fail',
      name: 'Fehlerfahrzeug',
      plate: 'HB-F 1',
      mileage: 100000,
      leasingStart: '2026-01-01',
      leasingEnd: isoDay(120),
      leasingStartKm: 0,
      leasingKmLimit: 100000
    });
    saveSmtpConfig(database, {
      enabled: true,
      host: 'smtp.invalid',
      port: 587,
      secure: false,
      username: '',
      fromAddress: 'fuhrpark@example.invalid'
    }, { dataDir: tempDir });

    const messages = [];
    const failing = await runLeasingNotifications(database, {
      dataDir: tempDir,
      now: NOW,
      transportFactory: fakeTransportFactory(messages, Object.assign(new Error('auth failed'), { code: 'EAUTH' }))
    });
    assert.equal(failing.failed, 1);
    const failedRow = database.prepare("SELECT * FROM notification_deliveries WHERE vehicle_id = 'vehicle-fail'").get();
    assert.equal(failedRow.status, 'failed');
    assert.equal(failedRow.error_code, 'EAUTH');
    assert.equal(failedRow.attempts, 1);
    assert.ok(!JSON.stringify(failedRow).includes('smtp.invalid'));

    const retryBlocked = await runLeasingNotifications(database, {
      dataDir: tempDir,
      now: NOW,
      transportFactory: fakeTransportFactory(messages)
    });
    assert.equal(retryBlocked.sent, 0, 'Fehlversuch darf nicht sofort erneut senden');

    database.prepare("UPDATE notification_deliveries SET last_attempt_at = '2026-10-28T00:00:00.000Z' WHERE vehicle_id = 'vehicle-fail'").run();
    const retry = await runLeasingNotifications(database, {
      dataDir: tempDir,
      now: NOW,
      transportFactory: fakeTransportFactory(messages)
    });
    assert.equal(retry.sent, 1, 'Nach Ablauf der Wartezeit ist ein Retry erlaubt');
    const sentRow = database.prepare("SELECT * FROM notification_deliveries WHERE vehicle_id = 'vehicle-fail'").get();
    assert.equal(sentRow.status, 'sent');
    assert.equal(sentRow.attempts, 2);

    const auditDetails = database.prepare("SELECT details FROM audit_logs WHERE action = 'leasing_notification'").all()
      .map((row) => row.details)
      .join(' ');
    assert.ok(!auditDetails.includes('admin2@example.invalid'));
    assert.ok(!auditDetails.includes('smtp.invalid'));
  } finally {
    database.close();
  }
});

test('SMTP-Passwort ist nicht im öffentlichen State und wird separat gespeichert', () => {
  const database = createDb();
  try {
    saveSmtpConfig(database, {
      enabled: true,
      host: 'smtp.invalid',
      port: 465,
      secure: true,
      username: 'mailer',
      fromAddress: 'fuhrpark@example.invalid',
      password: 'Secret-123'
    }, { dataDir: tempDir });
    const publicConfig = getPublicSmtpConfig(database, { dataDir: tempDir });
    assert.equal(publicConfig.passwordSet, true);
    assert.equal(publicConfig.password, undefined);
    assert.ok(!JSON.stringify(publicConfig).includes('Secret-123'));
    assert.ok(fs.existsSync(path.join(tempDir, 'smtp-secret.json')));
  } finally {
    database.close();
  }
});

test('Migration ist idempotent und setzt die nächste user_version', () => {
  const database = new Database(':memory:');
  try {
    database.exec('CREATE TABLE vehicles (id TEXT PRIMARY KEY, mileage INTEGER)');
    database.pragma('user_version = 4');
    assert.equal(migrateLeasingSchema(database), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), LEASING_SCHEMA_VERSION);
    const columns = database.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
    for (const column of ['leasing_start', 'leasing_end', 'leasing_start_km', 'leasing_km_limit']) {
      assert.ok(columns.includes(column), `Leasing-Spalte fehlt: ${column}`);
    }
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'smtp_settings'").get());
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notification_deliveries'").get());
    assert.equal(migrateLeasingSchema(database), false);
    assert.equal(Number(database.pragma('user_version', { simple: true })), LEASING_SCHEMA_VERSION);
  } finally {
    database.close();
  }
});
