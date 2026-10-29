'use strict';

const crypto = require('node:crypto');
const { decryptIntegrationSecret, encryptIntegrationSecret } = require('./integrations-crypto');

const WEBHOOKS_SCHEMA_VERSION = 16;

function ensureWebhooksTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url_enc TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      format TEXT NOT NULL DEFAULT 'generic' CHECK (format IN ('generic', 'teams', 'discord', 'slack')),
      events TEXT NOT NULL DEFAULT '[]',
      secret_enc TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks (enabled)');
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function legacyEvents(row) {
  const events = [];
  if (Number(row.teams_send_leasing ?? 1)) events.push('leasing');
  if (Number(row.teams_send_booking_requests ?? 1)) events.push('booking_request');
  if (Number(row.teams_send_maintenance ?? 1)) events.push('maintenance');
  return events;
}

function migrateLegacyTeamsWebhook(db, { dataDir } = {}) {
  if (!tableExists(db, 'integration_settings')) return false;
  const count = Number(db.prepare('SELECT COUNT(*) AS count FROM webhooks').get().count) || 0;
  if (count > 0) return false;
  const row = db.prepare('SELECT * FROM integration_settings WHERE id = 1').get();
  if (!row?.teams_webhook_enc) return false;

  const url = decryptIntegrationSecret(row.teams_webhook_enc, 'teams_webhook_url', { dataDir });
  if (!url) return false;
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const isDiscord = hostname === 'discord.com' || hostname.endsWith('.discord.com')
    || hostname === 'discordapp.com' || hostname.endsWith('.discordapp.com');
  const format = isDiscord ? 'discord' : 'teams';
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO webhooks (id, name, url_enc, enabled, format, events, secret_enc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    crypto.randomUUID(),
    isDiscord ? 'Discord (übernommen)' : 'Microsoft Teams (übernommen)',
    encryptIntegrationSecret(url, 'webhook_url', { dataDir }),
    Number(row.teams_enabled) ? 1 : 0,
    format,
    JSON.stringify(legacyEvents(row)),
    now,
    now
  );
  // Avoid duplicate deliveries: the migrated webhook is now the primary source.
  db.prepare('UPDATE integration_settings SET teams_webhook_enc = NULL, teams_enabled = 0 WHERE id = 1').run();
  return true;
}

function migrateWebhooksSchema(db, { dataDir } = {}) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureWebhooksTable(db);
    if (previous < WEBHOOKS_SCHEMA_VERSION) {
      try {
        migrateLegacyTeamsWebhook(db, { dataDir });
      } catch {
        // A missing or invalid key must not block the schema migration.
      }
      db.pragma(`user_version = ${WEBHOOKS_SCHEMA_VERSION}`);
    }
  })();
  return previous < WEBHOOKS_SCHEMA_VERSION;
}

module.exports = {
  WEBHOOKS_SCHEMA_VERSION,
  migrateWebhooksSchema
};
