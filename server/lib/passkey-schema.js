'use strict';

const PASSKEY_SCHEMA_VERSION = 10;

function ensurePasskeyTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      name TEXT NOT NULL DEFAULT 'Passkey',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS passkey_attempts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_passkeys_user ON user_passkeys (user_id, created_at)');
}

function migratePasskeySchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensurePasskeyTables(db);
    if (previous < PASSKEY_SCHEMA_VERSION) db.pragma(`user_version = ${PASSKEY_SCHEMA_VERSION}`);
  })();
  return previous < PASSKEY_SCHEMA_VERSION;
}

module.exports = {
  PASSKEY_SCHEMA_VERSION,
  migratePasskeySchema
};
