'use strict';

const VEHICLES_SCHEMA_VERSION = 18;

const VEHICLE_COLUMNS = [
  'id', 'name', 'plate', 'type', 'fuel', 'seats', 'location', 'department', 'status',
  'ownership_type', 'mileage', 'blocked', 'blocked_reason', 'next_service', 'tuv', 'insurance',
  'acquired', 'color', 'notes', 'image_file', 'cost_center_id', 'location_id',
  'leasing_start', 'leasing_end', 'leasing_start_km', 'leasing_km_limit', 'created_at', 'updated_at'
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

function rebuildVehicles(db) {
  const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
  const hasOwnership = columns.includes('ownership_type');
  const leasingCondition = [
    'leasing_start IS NOT NULL',
    'leasing_end IS NOT NULL',
    'leasing_start_km IS NOT NULL',
    'leasing_km_limit IS NOT NULL'
  ].join(' OR ');
  const ownershipExpression = hasOwnership
    ? 'ownership_type'
    : `CASE WHEN ${leasingCondition} THEN 'leasing' ELSE 'owned' END`;

  const selectColumns = VEHICLE_COLUMNS
    .map((column) => (column === 'ownership_type' ? ownershipExpression : column))
    .join(', ');

  db.exec('DROP TABLE IF EXISTS vehicles_new');
  createVehiclesTable(db, 'vehicles_new');
  db.prepare(`
    INSERT INTO vehicles_new (${VEHICLE_COLUMNS.join(', ')})
    SELECT ${selectColumns}
    FROM vehicles
  `).run();
  db.exec('DROP TABLE vehicles');
  db.exec('ALTER TABLE vehicles_new RENAME TO vehicles');
  ensureVehicleIndexes(db);
}

function migrateVehiclesSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (!tableExists(db, 'vehicles')) {
        createVehiclesTable(db);
      } else {
        const columns = db.prepare('PRAGMA table_info(vehicles)').all().map((column) => column.name);
        const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vehicles'").get()?.sql || '';
        const needsRebuild = !columns.includes('ownership_type') || !sql.includes("'defect'");
        if (needsRebuild) rebuildVehicles(db);
      }
      ensureVehicleIndexes(db);
      if (previous < VEHICLES_SCHEMA_VERSION) {
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
