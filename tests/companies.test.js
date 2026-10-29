'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  COMPANIES_SCHEMA_VERSION,
  STANDARD_COMPANY_ID,
  migrateCompaniesSchema
} = require('../server/lib/companies-schema');
const {
  normalizeCompanyCode,
  parseCompanyPayload,
  listCompanies,
  getCompany,
  assertCompanyAssignable
} = require('../server/lib/companies');

function legacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      org_name TEXT NOT NULL,
      seeded_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE cost_centers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cost_center_id TEXT REFERENCES cost_centers(id) ON DELETE SET NULL
    );
  `);
  db.prepare("INSERT INTO settings (id, org_name, seeded_at, updated_at) VALUES (1, 'AWO Test', '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO cost_centers (id, code, name, description, active, created_at, updated_at) VALUES ('cc-1', 'KST-100', 'Pflege', 'Alt', 1, '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO cost_centers (id, code, name, description, active, created_at, updated_at) VALUES ('cc-2', 'KST-200', 'Verwaltung', '', 0, '2026-01-02', '2026-01-02')").run();
  db.prepare("INSERT INTO vehicles (id, name, cost_center_id) VALUES ('v-1', 'Caddy', 'cc-1')").run();
  db.pragma('user_version = 16');
  return db;
}

test('Migration 16→17: Standardgesellschaft, Tabellen-Rebuild, Daten und FK-Integrität', () => {
  const db = legacyDb();
  try {
    assert.equal(migrateCompaniesSchema(db), true);
    assert.equal(Number(db.pragma('user_version', { simple: true })), COMPANIES_SCHEMA_VERSION);

    const standard = db.prepare('SELECT * FROM companies WHERE id = ?').get(STANDARD_COMPANY_ID);
    assert.ok(standard);
    assert.equal(standard.code, 'STANDARD');
    assert.equal(standard.name, 'AWO Test');
    assert.equal(standard.active, 1);

    const centers = db.prepare('SELECT * FROM cost_centers ORDER BY code').all();
    assert.equal(centers.length, 2);
    assert.equal(centers[0].id, 'cc-1');
    assert.equal(centers[0].code, 'KST-100');
    assert.equal(centers[0].name, 'Pflege');
    assert.equal(centers[0].description, 'Alt');
    assert.equal(centers[0].company_id, STANDARD_COMPANY_ID);
    assert.equal(centers[1].active, 0);
    assert.equal(db.prepare("SELECT cost_center_id FROM vehicles WHERE id = 'v-1'").get().cost_center_id, 'cc-1');
    assert.deepEqual(db.pragma('foreign_key_check'), []);

    const columns = db.prepare('PRAGMA table_info(cost_centers)').all().map((column) => column.name);
    assert.ok(columns.includes('company_id'));
    assert.ok(!db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cost_centers'").get().sql.match(/code TEXT NOT NULL COLLATE NOCASE UNIQUE/));

    // Same code in another company is allowed; same company is rejected.
    db.prepare("INSERT INTO companies (id, code, name, active, created_at, updated_at) VALUES ('company-2', 'AWO-HB', 'AWO Bremerhaven', 1, '2026-01-01', '2026-01-01')").run();
    db.prepare("INSERT INTO cost_centers (id, company_id, code, name, created_at, updated_at) VALUES ('cc-3', 'company-2', 'KST-100', 'Pflege HB', '2026-01-01', '2026-01-01')").run();
    assert.throws(
      () => db.prepare("INSERT INTO cost_centers (id, company_id, code, name, created_at, updated_at) VALUES ('cc-4', 'company-2', 'kst-100', 'Doppelt', '2026-01-01', '2026-01-01')").run(),
      /UNIQUE/
    );

    assert.equal(migrateCompaniesSchema(db), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM companies').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cost_centers').get().count, 3);
  } finally {
    db.close();
  }
});

test('Migration ist idempotent und ergänzt fehlende Standardgesellschaft', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, org_name TEXT, seeded_at TEXT, updated_at TEXT);
    CREATE TABLE companies (id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE cost_centers (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
  `);
  db.prepare("INSERT INTO settings (id, org_name) VALUES (1, 'Fallback-Name')").run();
  db.prepare("INSERT INTO companies VALUES ('company-temp', 'TEMP', 'Temp', 1, '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO cost_centers VALUES ('cc-1', 'company-temp', 'TEMP-1', 'Temp-Kostenstelle', '', 1, '2026-01-01', '2026-01-01')").run();
  db.pragma('user_version = 16');
  try {
    assert.equal(migrateCompaniesSchema(db), true);
    const standard = db.prepare("SELECT * FROM companies WHERE code = 'STANDARD'").get();
    assert.ok(standard);
    assert.equal(standard.name, 'Fallback-Name');
    assert.equal(db.prepare("SELECT company_id FROM cost_centers WHERE id = 'cc-1'").get().company_id, 'company-temp');
    assert.equal(migrateCompaniesSchema(db), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM companies WHERE code = 'STANDARD'").get().count, 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('Gesellschaftscode wird normalisiert und validiert', () => {
  assert.equal(normalizeCompanyCode('  awo hb  '), 'AWO-HB');
  assert.throws(() => normalizeCompanyCode(''), /Gesellschaftscode/);
  assert.throws(() => normalizeCompanyCode('-AWO'), /Gesellschaftscode/);
  const values = parseCompanyPayload({ code: ' awo-hb ', name: ' AWO Bremerhaven ', active: false });
  assert.deepEqual(values, { code: 'AWO-HB', name: 'AWO Bremerhaven', active: false });
  assert.throws(() => parseCompanyPayload({ code: 'AWO', name: '' }), /Name/);
});

test('Companies-Liste, Aktivierung und Zuordnungsschutz', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, org_name TEXT, seeded_at TEXT, updated_at TEXT);
    CREATE TABLE companies (id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE cost_centers (id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT);
  `);
  db.prepare("INSERT INTO companies VALUES ('c1', 'ONE', 'One', 1, '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO companies VALUES ('c2', 'TWO', 'Two', 0, '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO cost_centers VALUES ('cc1', 'c1', 'KST', 'Kostenstelle', '', 1, '2026-01-01', '2026-01-01')").run();
  try {
    const companies = listCompanies(db);
    assert.equal(companies.length, 2);
    assert.equal(companies.find((entry) => entry.id === 'c1').costCenterCount, 1);
    assert.equal(companies.find((entry) => entry.id === 'c2').active, false);
    assert.equal(getCompany(db, 'c1').code, 'ONE');
    assert.equal(assertCompanyAssignable(db, 'c1'), 'c1');
    assert.throws(() => assertCompanyAssignable(db, 'c2'), /inaktive/);
    assert.equal(assertCompanyAssignable(db, 'c2', { existingId: 'c2' }), 'c2');
    assert.throws(() => assertCompanyAssignable(db, 'missing'), /existiert nicht/);
    assert.throws(() => assertCompanyAssignable(db, ''), /erforderlich/);
  } finally {
    db.close();
  }
});
