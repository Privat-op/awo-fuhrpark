'use strict';

const LEASING_SCHEMA_VERSION = 5;

function ensureLeasingColumns(db) {
  const columns = db.prepare('PRAGMA table_info(vehicles)').all();
  if (!columns.length) return;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('leasing_start')) db.exec('ALTER TABLE vehicles ADD COLUMN leasing_start TEXT');
  if (!names.has('leasing_end')) db.exec('ALTER TABLE vehicles ADD COLUMN leasing_end TEXT');
  if (!names.has('leasing_start_km')) db.exec('ALTER TABLE vehicles ADD COLUMN leasing_start_km INTEGER');
  if (!names.has('leasing_km_limit')) db.exec('ALTER TABLE vehicles ADD COLUMN leasing_km_limit INTEGER');
}

function ensureSmtpTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS smtp_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 587,
      secure INTEGER NOT NULL DEFAULT 0 CHECK (secure IN (0, 1)),
      username TEXT NOT NULL DEFAULT '',
      from_address TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    )
  `);
  const row = db.prepare('SELECT id FROM smtp_settings WHERE id = 1').get();
  if (!row) {
    db.prepare(`
      INSERT INTO smtp_settings (id, host, port, secure, username, from_address, enabled, updated_at)
      VALUES (1, '', 587, 0, '', '', 0, ?)
    `).run(new Date().toISOString());
  }
}

function ensureDeliveryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL DEFAULT 'email',
      vehicle_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries (status, last_attempt_at)');
}

function migrateLeasingSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureLeasingColumns(db);
    ensureSmtpTable(db);
    ensureDeliveryTable(db);
    if (previous < LEASING_SCHEMA_VERSION) db.pragma(`user_version = ${LEASING_SCHEMA_VERSION}`);
  })();
  return previous < LEASING_SCHEMA_VERSION;
}

module.exports = {
  LEASING_SCHEMA_VERSION,
  migrateLeasingSchema
};
