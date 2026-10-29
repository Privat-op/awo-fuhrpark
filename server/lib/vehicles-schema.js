'use strict';

const VEHICLES_SCHEMA_VERSION = 19;

const VEHICLE_COLUMNS = [
  'id', 'name', 'plate', 'type', 'fuel', 'seats', 'location', 'department', 'status',
  'ownership_type', 'usage_category_id', 'mileage', 'blocked', 'blocked_reason', 'next_service', 'tuv', 'insurance',
  'acquired', 'color', 'notes', 'image_file', 'cost_center_id', 'location_id',
  'leasing_start', 'leasing_end', 'leasing_start_km', 'leasing_km_limit', 'leasing_monthly_cost', 'created_at', 'updated_at'
];

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function createVehiclesTable(db, name = 'vehicles') {
  db.exec(`
    CREATE TABLE ${name} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plate TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('Pkw', 'Transporter', 'Bus')),
      fuel TEXT NOT NULL CHECK (fuel IN ('Diesel', 'Benzin', 'Elektro', 'Hybrid')),
      seats INTEGER NOT NULL DEFAULT 5 CHECK (seats > 0),
      location TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance', 'defect', 'sold', 'not_drivable')),
      ownership_type TEXT NOT NULL DEFAULT 'owned' CHECK (ownership_type IN ('owned', 'leasing')),
      usage_category_id TEXT REFERENCES vehicle_usage_categories(id) ON DELETE SET NULL,
      mileage INTEGER NOT NULL DEFAULT 0 CHECK (mileage >= 0),
      blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
      blocked_reason TEXT NOT NULL DEFAULT '',
      next_service TEXT,
      tuv TEXT,
      insurance TEXT NOT NULL DEFAULT '',
      acquired TEXT,
      color TEXT NOT NULL DEFAULT '#2563eb',
      notes TEXT NOT NULL DEFAULT '',
      image_file TEXT,
      cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      leasing_start TEXT,
      leasing_end TEXT,
      leasing_start_km INTEGER,
      leasing_km_limit INTEGER,
      leasing_monthly_cost REAL CHECK (leasing_monthly_cost IS NULL OR leasing_monthly_cost >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function ensureVehicleIndexes(db) {
  const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
  if (columns.includes('cost_center_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_vehicles_cost_center ON vehicles (cost_center_id)');
  }
  if (columns.includes('location_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_vehicles_location ON vehicles (location_id)');
  }
}

function buildSelectExpression(columns, column) {
  if (column === 'ownership_type') {
    const hasOwnership = columns.includes('ownership_type');
    if (hasOwnership) return 'ownership_type';
    const leasingCondition = [
      'leasing_start IS NOT NULL',
      'leasing_end IS NOT NULL',
      'leasing_start_km IS NOT NULL',
      'leasing_km_limit IS NOT NULL'
    ].join(' OR ');
    return `CASE WHEN ${leasingCondition} THEN 'leasing' ELSE 'owned' END`;
  }
  if (column === 'usage_category_id') {
    if (columns.includes('usage_category_id')) return 'usage_category_id';
    return 'NULL';
  }
  if (column === 'leasing_monthly_cost') {
    if (columns.includes('leasing_monthly_cost')) return 'leasing_monthly_cost';
    return 'NULL';
  }
  if (columns.includes(column)) return column;
  return 'NULL';
}

function rebuildVehicles(db) {
  const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);

  const selectColumns = VEHICLE_COLUMNS
    .map((column) => buildSelectExpression(columns, column))
    .join(', ');
  const columnList = VEHICLE_COLUMNS.join(', ');

  db.exec('DROP TABLE IF EXISTS vehicles_new');
  createVehiclesTable(db, 'vehicles_new');
  db.prepare(`
    INSERT INTO vehicles_new (${columnList})
    SELECT ${selectColumns}
    FROM vehicles
  `).run();
  db.exec('DROP TABLE vehicles');
  db.exec('ALTER TABLE vehicles_new RENAME TO vehicles');
  ensureVehicleIndexes(db);
}

function ensureUsageCategoriesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_usage_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function seedUsageCategories(db) {
  const defaults = [
    { code: 'ARBEITSTIER', name: 'Arbeitstier', sortOrder: 0 },
    { code: 'PERSONENBEFOERDERUNG', name: 'Personenbeförderungsfahrzeug', sortOrder: 1 },
    { code: 'PRITSCHE', name: 'Pritsche', sortOrder: 2 },
    { code: 'ANHAENGER', name: 'Anhänger', sortOrder: 3 },
    { code: 'SONSTIGES', name: 'Sonstiges', sortOrder: 4 }
  ];
  const existing = db.prepare('SELECT COUNT(*) AS count FROM vehicle_usage_categories').get().count;
  if (existing > 0) return;
  const insert = db.prepare(`
    INSERT INTO vehicle_usage_categories (id, code, name, sort_order, active, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  for (const entry of defaults) {
    insert.run(`vuc-${entry.code.toLowerCase()}`, entry.code, entry.name, entry.sortOrder);
  }
}

function migrateVehiclesSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      ensureUsageCategoriesTable(db);
      seedUsageCategories(db);
      if (!tableExists(db, 'vehicles')) {
        createVehiclesTable(db);
      } else {
        const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
        const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vehicles'").get()?.sql || '';
        const needsRebuild = !columns.includes('ownership_type') || !sql.includes("'defect'")
          || !columns.includes('usage_category_id') || !columns.includes('leasing_monthly_cost');
        if (needsRebuild) rebuildVehicles(db);
      }
      ensureVehicleIndexes(db);
      if (previous < 18) {
        db.prepare(`
          UPDATE vehicles SET ownership_type = 'leasing'
          WHERE ownership_type = 'owned'
            AND (leasing_start IS NOT NULL OR leasing_end IS NOT NULL
              OR leasing_start_km IS NOT NULL OR leasing_km_limit IS NOT NULL)
        `).run();
      }
      const violations = db.pragma('foreign_key_check');
      if (violations.length) {
        throw new Error(`Foreign-Key-Prüfung fehlgeschlagen: ${violations.length} Verletzung(en).`);
      }
      if (previous < VEHICLES_SCHEMA_VERSION) db.pragma(`user_version = ${VEHICLES_SCHEMA_VERSION}`);
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
  return previous < VEHICLES_SCHEMA_VERSION;
}

module.exports = {
  VEHICLES_SCHEMA_VERSION,
  migrateVehiclesSchema
};
