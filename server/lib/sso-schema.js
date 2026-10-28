'use strict';

const SSO_SCHEMA_VERSION = 11;

function ensureSsoTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sso (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sso_subject ON user_sso (issuer, subject)');
}

function migrateSsoSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureSsoTables(db);
    if (previous < SSO_SCHEMA_VERSION) db.pragma(`user_version = ${SSO_SCHEMA_VERSION}`);
  })();
  return previous < SSO_SCHEMA_VERSION;
}

module.exports = {
  SSO_SCHEMA_VERSION,
  migrateSsoSchema
};
