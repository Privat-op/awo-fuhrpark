'use strict';

const MFA_SCHEMA_VERSION = 8;

function ensureMfaTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      totp_secret_enc TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
      totp_confirmed_at TEXT,
      totp_last_used_step INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      batch_id TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled ON user_mfa (totp_enabled)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user ON mfa_recovery_codes (user_id, used_at)');
}

function migrateMfaSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureMfaTables(db);
    if (previous < MFA_SCHEMA_VERSION) db.pragma(`user_version = ${MFA_SCHEMA_VERSION}`);
  })();
  return previous < MFA_SCHEMA_VERSION;
}

module.exports = {
  MFA_SCHEMA_VERSION,
  migrateMfaSchema
};
