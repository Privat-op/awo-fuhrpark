'use strict';

const RETENTION_SCHEMA_VERSION = 12;

const RETENTION_COLUMNS = [
  ['audit_retention_days', 'INTEGER NOT NULL DEFAULT 0'],
  ['session_retention_days', 'INTEGER NOT NULL DEFAULT 0'],
  ['password_reset_retention_days', 'INTEGER NOT NULL DEFAULT 0'],
  ['notification_retention_days', 'INTEGER NOT NULL DEFAULT 0']
];

function ensureRetentionSettings(db) {
  const columns = db.prepare('PRAGMA table_info(settings)').all().map((column) => column.name);
  for (const [name, definition] of RETENTION_COLUMNS) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE settings ADD COLUMN ${name} ${definition}`);
  }
}

function migrateRetentionSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureRetentionSettings(db);
    if (previous < RETENTION_SCHEMA_VERSION) db.pragma(`user_version = ${RETENTION_SCHEMA_VERSION}`);
  })();
  return previous < RETENTION_SCHEMA_VERSION;
}

module.exports = {
  RETENTION_SCHEMA_VERSION,
  migrateRetentionSchema
};
