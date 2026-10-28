'use strict';

const { normalizePermissions, parsePermissions } = require('./permissions');

const COST_CENTERS_SCHEMA_VERSION = 6;

const COST_CENTER_COLUMNS = [
  ['vehicles', 'cost_center_id'],
  ['drivers', 'cost_center_id'],
  ['users', 'cost_center_id'],
  ['bookings', 'cost_center_id'],
  ['booking_requests', 'cost_center_id'],
  ['costs', 'cost_center_id']
];

function ensureCostCenterTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_centers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function ensureCostCenterColumns(db) {
  for (const [table, column] of COST_CENTER_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.length) continue;
    if (!columns.some((entry) => entry.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT REFERENCES cost_centers(id) ON DELETE SET NULL`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_cost_center ON ${table} (${column})`);
  }
}

function grantManagerCostCenterPermissions(db) {
  const manager = db.prepare('SELECT id, permissions FROM roles WHERE id = ?').get('manager');
  if (!manager) return false;
  const permissions = new Set(parsePermissions(manager.permissions));
  const before = permissions.size;
  permissions.add('cost_centers_view');
  permissions.add('cost_centers_manage');
  if (permissions.size === before) return false;
  db.prepare('UPDATE roles SET permissions = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(normalizePermissions([...permissions])), new Date().toISOString(), manager.id);
  return true;
}

function migrateCostCentersSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureCostCenterTable(db);
    ensureCostCenterColumns(db);
    if (previous < COST_CENTERS_SCHEMA_VERSION) {
      grantManagerCostCenterPermissions(db);
      db.pragma(`user_version = ${COST_CENTERS_SCHEMA_VERSION}`);
    }
  })();
  return previous < COST_CENTERS_SCHEMA_VERSION;
}

module.exports = {
  COST_CENTERS_SCHEMA_VERSION,
  migrateCostCentersSchema
};
