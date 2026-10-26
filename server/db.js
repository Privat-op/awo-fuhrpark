'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(PROJECT_ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'awo-fuhrpark.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'vehicles'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'receipts'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'branding'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const settingsColumns = db.prepare('PRAGMA table_info(settings)').all();
  if (!settingsColumns.some((column) => column.name === 'theme')) {
    db.exec("ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'awo'");
  }
  if (!settingsColumns.some((column) => column.name === 'logo_file')) {
    db.exec('ALTER TABLE settings ADD COLUMN logo_file TEXT');
  }
  if (!settingsColumns.some((column) => column.name === 'brand_name')) {
    db.exec('ALTER TABLE settings ADD COLUMN brand_name TEXT');
  }
  if (!settingsColumns.some((column) => column.name === 'accent_color')) {
    db.exec("ALTER TABLE settings ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#0f766e'");
  }
  if (!settingsColumns.some((column) => column.name === 'sidebar_style')) {
    db.exec("ALTER TABLE settings ADD COLUMN sidebar_style TEXT NOT NULL DEFAULT 'dark'");
  }
  if (!settingsColumns.some((column) => column.name === 'page_background')) {
    db.exec("ALTER TABLE settings ADD COLUMN page_background TEXT NOT NULL DEFAULT '#f4f5f7'");
  }
  if (!settingsColumns.some((column) => column.name === 'surface_color')) {
    db.exec("ALTER TABLE settings ADD COLUMN surface_color TEXT NOT NULL DEFAULT '#ffffff'");
  }
  if (!settingsColumns.some((column) => column.name === 'text_color')) {
    db.exec("ALTER TABLE settings ADD COLUMN text_color TEXT NOT NULL DEFAULT '#191c23'");
  }
  if (!settingsColumns.some((column) => column.name === 'muted_color')) {
    db.exec("ALTER TABLE settings ADD COLUMN muted_color TEXT NOT NULL DEFAULT '#737a88'");
  }
  if (!settingsColumns.some((column) => column.name === 'border_color')) {
    db.exec("ALTER TABLE settings ADD COLUMN border_color TEXT NOT NULL DEFAULT '#e7e9ee'");
  }
  if (!settingsColumns.some((column) => column.name === 'auto_anonymize_days')) {
    db.exec('ALTER TABLE settings ADD COLUMN auto_anonymize_days INTEGER NOT NULL DEFAULT 0');
  }

  const roleColumns = db.prepare('PRAGMA table_info(roles)').all();
  if (roleColumns.length && !roleColumns.some((column) => column.name === 'object_permissions')) {
    db.exec("ALTER TABLE roles ADD COLUMN object_permissions TEXT NOT NULL DEFAULT '{}'");
  }

  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'anonymized_at')) {
    db.exec('ALTER TABLE users ADD COLUMN anonymized_at TEXT');
  }
  if (!userColumns.some((column) => column.name === 'deactivated_at')) {
    db.exec('ALTER TABLE users ADD COLUMN deactivated_at TEXT');
    db.exec("UPDATE users SET deactivated_at = updated_at WHERE active = 0 AND anonymized_at IS NULL");
  }

  const updatedUserColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!updatedUserColumns.some((column) => column.name === 'permission_overrides')) {
    db.exec("ALTER TABLE users ADD COLUMN permission_overrides TEXT NOT NULL DEFAULT '{}'");
  }
  if (!updatedUserColumns.some((column) => column.name === 'object_permissions')) {
    db.exec("ALTER TABLE users ADD COLUMN object_permissions TEXT NOT NULL DEFAULT '{}'");
  }

  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (/CHECK\s*\(\s*role\s+IN/i.test(usersSql)) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE users_new (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL COLLATE NOCASE UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            permission_overrides TEXT NOT NULL DEFAULT '{}',
            object_permissions TEXT NOT NULL DEFAULT '{}',
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            last_login_at TEXT,
            deactivated_at TEXT,
            anonymized_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.exec(`
          INSERT INTO users_new (id, email, name, password_hash, role, permission_overrides, object_permissions, active, last_login_at, deactivated_at, anonymized_at, created_at, updated_at)
          SELECT id, email, name, password_hash, role, permission_overrides, object_permissions, active, last_login_at, deactivated_at, anonymized_at, created_at, updated_at FROM users
        `);
        db.exec('DROP TABLE users');
        db.exec('ALTER TABLE users_new RENAME TO users');
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = {
  db,
  initSchema,
  DATA_DIR,
  UPLOAD_DIR,
  DB_PATH,
  PROJECT_ROOT
};
