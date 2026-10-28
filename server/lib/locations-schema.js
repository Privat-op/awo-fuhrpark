'use strict';

const LOCATIONS_SCHEMA_VERSION = 13;

function ensureLocationColumns(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  if (!columns.includes('location_id')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL`);
  }
}

function ensureLocationsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  ensureLocationColumns(db, 'users');
  ensureLocationColumns(db, 'vehicles');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_location ON users (location_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vehicles_location ON vehicles (location_id)');
}

function migrateLocationsSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureLocationsSchema(db);
    if (previous < LOCATIONS_SCHEMA_VERSION) db.pragma(`user_version = ${LOCATIONS_SCHEMA_VERSION}`);
  })();
  return previous < LOCATIONS_SCHEMA_VERSION;
}

module.exports = {
  LOCATIONS_SCHEMA_VERSION,
  migrateLocationsSchema
};
