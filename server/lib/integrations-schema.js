'use strict';

const INTEGRATIONS_SCHEMA_VERSION = 14;

function ensureIntegrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sso_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sso_enabled IN (0, 1)),
      sso_issuer TEXT NOT NULL DEFAULT '',
      sso_client_id TEXT NOT NULL DEFAULT '',
      sso_client_secret_enc TEXT,
      sso_redirect_uri TEXT NOT NULL DEFAULT '',
      sso_scopes TEXT NOT NULL DEFAULT 'openid profile email',
      sso_allowed_domains TEXT NOT NULL DEFAULT '',
      sso_auto_provision INTEGER NOT NULL DEFAULT 0 CHECK (sso_auto_provision IN (0, 1)),
      sso_default_role TEXT NOT NULL DEFAULT 'user',
      sso_group_claim TEXT NOT NULL DEFAULT 'groups',
      sso_admin_group TEXT NOT NULL DEFAULT '',
      sso_manager_group TEXT NOT NULL DEFAULT '',
      teams_enabled INTEGER NOT NULL DEFAULT 0 CHECK (teams_enabled IN (0, 1)),
      teams_webhook_enc TEXT,
      teams_send_leasing INTEGER NOT NULL DEFAULT 1 CHECK (teams_send_leasing IN (0, 1)),
      teams_send_booking_requests INTEGER NOT NULL DEFAULT 1 CHECK (teams_send_booking_requests IN (0, 1)),
      teams_send_maintenance INTEGER NOT NULL DEFAULT 1 CHECK (teams_send_maintenance IN (0, 1)),
      clamav_enabled INTEGER NOT NULL DEFAULT 0 CHECK (clamav_enabled IN (0, 1)),
      clamav_host TEXT NOT NULL DEFAULT '127.0.0.1',
      clamav_port INTEGER NOT NULL DEFAULT 3310,
      clamav_fail_closed INTEGER NOT NULL DEFAULT 1 CHECK (clamav_fail_closed IN (0, 1)),
      webauthn_rp_id TEXT NOT NULL DEFAULT '',
      webauthn_rp_name TEXT NOT NULL DEFAULT '',
      webauthn_origin TEXT NOT NULL DEFAULT '',
      locations_enabled INTEGER NOT NULL DEFAULT 0 CHECK (locations_enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    )
  `);
  db.prepare(`
    INSERT INTO integration_settings (id, updated_at)
    VALUES (1, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(new Date().toISOString());
}

function migrateIntegrationsSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureIntegrationsTable(db);
    if (previous < INTEGRATIONS_SCHEMA_VERSION) db.pragma(`user_version = ${INTEGRATIONS_SCHEMA_VERSION}`);
  })();
  return previous < INTEGRATIONS_SCHEMA_VERSION;
}

module.exports = {
  INTEGRATIONS_SCHEMA_VERSION,
  migrateIntegrationsSchema
};
