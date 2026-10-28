'use strict';

const PASSWORD_RESET_SCHEMA_VERSION = 9;

function ensurePasswordResetTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens (user_id, expires_at)');
}

function migratePasswordResetSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensurePasswordResetTable(db);
    if (previous < PASSWORD_RESET_SCHEMA_VERSION) db.pragma(`user_version = ${PASSWORD_RESET_SCHEMA_VERSION}`);
  })();
  return previous < PASSWORD_RESET_SCHEMA_VERSION;
}

module.exports = {
  PASSWORD_RESET_SCHEMA_VERSION,
  migratePasswordResetSchema
};
