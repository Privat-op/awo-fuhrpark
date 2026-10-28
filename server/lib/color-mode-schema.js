'use strict';

const COLOR_MODE_SCHEMA_VERSION = 7;

function ensureUserColorMode(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (!columns.length) return;
  if (!columns.some((column) => column.name === 'color_mode')) {
    db.exec("ALTER TABLE users ADD COLUMN color_mode TEXT CHECK (color_mode IN ('light', 'dark', 'auto'))");
  }
}

function ensureDefaultColorMode(db) {
  const columns = db.prepare('PRAGMA table_info(settings)').all();
  if (!columns.length) return;
  if (!columns.some((column) => column.name === 'default_color_mode')) {
    db.exec("ALTER TABLE settings ADD COLUMN default_color_mode TEXT NOT NULL DEFAULT 'light' CHECK (default_color_mode IN ('light', 'dark', 'auto'))");
  }
}

function migrateColorModeSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureUserColorMode(db);
    ensureDefaultColorMode(db);
    if (previous < COLOR_MODE_SCHEMA_VERSION) db.pragma(`user_version = ${COLOR_MODE_SCHEMA_VERSION}`);
  })();
  return previous < COLOR_MODE_SCHEMA_VERSION;
}

module.exports = {
  COLOR_MODE_SCHEMA_VERSION,
  migrateColorModeSchema
};
