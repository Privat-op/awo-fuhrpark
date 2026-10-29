'use strict';

const COMPANIES_SCHEMA_VERSION = 17;

const STANDARD_COMPANY_ID = 'standard';
const STANDARD_COMPANY_CODE = 'STANDARD';

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function ensureCompaniesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function standardCompanyName(db) {
  try {
    const row = db.prepare('SELECT org_name FROM settings WHERE id = 1').get();
    const name = String(row?.org_name || '').trim();
    return name || 'Standardgesellschaft';
  } catch {
    return 'Standardgesellschaft';
  }
}

function ensureStandardCompany(db) {
  const byCode = db.prepare('SELECT * FROM companies WHERE code = ? COLLATE NOCASE').get(STANDARD_COMPANY_CODE);
  if (byCode) return byCode.id;
  const byId = db.prepare('SELECT * FROM companies WHERE id = ?').get(STANDARD_COMPANY_ID);
  if (byId) return byId.id;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO companies (id, code, name, active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(STANDARD_COMPANY_ID, STANDARD_COMPANY_CODE, standardCompanyName(db), now, now);
  return STANDARD_COMPANY_ID;
}

function costCenterColumns(db) {
  return db.prepare('PRAGMA table_info(cost_centers)').all();
}

function createCostCentersTable(db, name = 'cost_centers') {
  db.exec(`
    CREATE TABLE ${name} (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      code TEXT NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, code COLLATE NOCASE)
    )
  `);
}

function rebuildCostCenters(db, companyId) {
  db.exec('DROP TABLE IF EXISTS cost_centers_new');
  createCostCentersTable(db, 'cost_centers_new');
  db.prepare(`
    INSERT INTO cost_centers_new (id, company_id, code, name, description, active, created_at, updated_at)
    SELECT id, ?, code, name, description, active, created_at, updated_at FROM cost_centers
  `).run(companyId);
  db.exec('DROP TABLE cost_centers');
  db.exec('ALTER TABLE cost_centers_new RENAME TO cost_centers');
}

function ensureCostCenterIndexes(db, companyId) {
  db.prepare("UPDATE cost_centers SET company_id = ? WHERE company_id IS NULL OR company_id = ''").run(companyId);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_centers_company_code ON cost_centers (company_id, code COLLATE NOCASE)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cost_centers_company ON cost_centers (company_id)');
}

function migrateCompaniesSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  const foreignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      ensureCompaniesTable(db);
      const companyId = ensureStandardCompany(db);

      if (!tableExists(db, 'cost_centers')) {
        createCostCentersTable(db);
      } else {
        const columns = costCenterColumns(db);
        if (!columns.some((column) => column.name === 'company_id')) {
          rebuildCostCenters(db, companyId);
        }
      }
      ensureCostCenterIndexes(db, companyId);

      const violations = db.pragma('foreign_key_check');
      if (violations.length) {
        throw new Error(`Foreign-Key-Prüfung fehlgeschlagen: ${violations.length} Verletzung(en).`);
      }
      if (previous < COMPANIES_SCHEMA_VERSION) db.pragma(`user_version = ${COMPANIES_SCHEMA_VERSION}`);
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
  return previous < COMPANIES_SCHEMA_VERSION;
}

module.exports = {
  COMPANIES_SCHEMA_VERSION,
  STANDARD_COMPANY_ID,
  STANDARD_COMPANY_CODE,
  migrateCompaniesSchema
};
