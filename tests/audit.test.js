'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const { writeAudit } = require('../server/lib/audit');

const ROOT = path.join(__dirname, '..');
const TEST_PASSWORD = 'Audit-Test-Passwort-2026';
const LOGIN_EMAILS = {
  admin: 'admin@example.invalid',
  manager: 'manager@example.invalid',
  self: 'self@example.invalid',
  lower: 'lower@example.invalid',
  viewer: 'viewer@example.invalid',
  equal: 'equal@example.invalid',
  higher: 'higher@example.invalid',
  all: 'all@example.invalid',
  logbook: 'logbook@example.invalid',
  exporter: 'exporter@example.invalid'
};

let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let passwordHash;
let serverOutput = '';
let cookies = {};
let sessions = {};
let ids = {};
let roles = {};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Server startet noch.
    }
    await wait(100);
  }
  throw new Error(`Testserver nicht erreichbar. Ausgabe: ${serverOutput.slice(-2000)}`);
}

function extractCookie(response) {
  const headerValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of headerValues) {
    const match = /(?:^|,\s*)(awo\.sid=[^;]+)/.exec(header);
    if (match) return match[1];
  }
  return null;
}

async function login(key) {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'CSRF-Token der Anmeldeseite fehlt');
  const firstCookie = extractCookie(page);
  assert.ok(firstCookie, 'Session-Cookie der Anmeldeseite fehlt');
  const body = new URLSearchParams({
    _csrf: csrf,
    email: LOGIN_EMAILS[key],
    password: TEST_PASSWORD
  });
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body
  });
  assert.equal(response.status, 303, `Anmeldung für ${key} fehlgeschlagen`);
  const cookie = extractCookie(response) || firstCookie;
  const sessionResponse = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  const result = { cookie, csrf: session.csrfToken, session };
  cookies[key] = result.cookie;
  sessions[key] = session;
  sessions[key].csrf = result.csrf;
  return result;
}

async function apiGet(key, endpoint) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { cookie: cookies[key] },
    redirect: 'manual'
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: response.status, data, text, headers: response.headers };
}

async function apiJson(key, method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: cookies[key],
      'x-csrf-token': sessions[key]?.csrf || '',
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: response.status, data, text };
}

function insertRole(id, name, rank, permissions) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES (?, ?, ?, '{}', 0, ?, ?, ?)
  `).run(id, name, JSON.stringify(permissions), rank, now, now);
  roles[id] = { id, name, rank, permissions };
}

function insertUser(id, name, email, role, { active = 1, anonymizedAt = null } = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, anonymized_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, name, passwordHash, role, active, anonymizedAt, now, now);
}

function actorFor(userId) {
  const row = db.prepare(`
    SELECT u.role, r.name AS role_name, r.rank
    FROM users u LEFT JOIN roles r ON r.id = u.role WHERE u.id = ?
  `).get(userId);
  return {
    actorRoleId: row?.role || null,
    actorRoleName: row?.role_name || null,
    actorRank: row?.rank === null || row?.rank === undefined ? null : Number(row.rank)
  };
}

function insertAudit({
  userId = null,
  action,
  entityType = 'user',
  entityId = null,
  details = null,
  createdAt = new Date().toISOString(),
  isMeta = 0,
  actorRoleId,
  actorRoleName,
  actorRank
}) {
  const actor = userId ? actorFor(userId) : { actorRoleId: null, actorRoleName: null, actorRank: null };
  const result = db.prepare(`
    INSERT INTO audit_logs
      (user_id, action, entity_type, entity_id, details, actor_role_id, actor_role_name, actor_rank, is_meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    action,
    entityType,
    entityId,
    details ? JSON.stringify(details) : null,
    actorRoleId === undefined ? actor.actorRoleId : actorRoleId,
    actorRoleName === undefined ? actor.actorRoleName : actorRoleName,
    actorRank === undefined ? actor.actorRank : actorRank,
    isMeta,
    createdAt
  );
  return Number(result.lastInsertRowid);
}

function daysAgo(days, hours = 0) {
  const date = new Date(Date.now() - days * 86400000 - hours * 3600000);
  return date.toISOString();
}

function isoDateDaysAgo(days) {
  const date = new Date(Date.now() - days * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-audit-test-'));
  dbPath = path.join(tempDir, 'test.sqlite');
  const uploadDir = path.join(tempDir, 'uploads');
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: tempDir,
      DB_PATH: dbPath,
      UPLOAD_DIR: uploadDir,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_EMAIL: LOGIN_EMAILS.admin,
      ADMIN_PASSWORD: TEST_PASSWORD,
      ADMIN_NAME: 'Test-Administrator',
      ORG_NAME: 'Audit-Testorganisation',
      ORG_LOCATION: 'Teststandort',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();

  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  passwordHash = bcrypt.hashSync(TEST_PASSWORD, 12);

  insertRole('role-self', 'Self Only', 100000, []);
  insertRole('role-lower', 'Lower Actor', 150000, []);
  insertRole('role-anon', 'Anonymized Role', 150000, []);
  insertRole('role-viewer', 'Audit Viewer', 300000, ['audit_view']);
  insertRole('role-equal', 'Equal Rank', 300000, []);
  insertRole('role-all', 'Audit All Viewer', 400000, ['audit_view_all', 'vehicles_view']);
  insertRole('role-higher', 'Higher Rank', 500000, []);
  insertRole('role-logbook', 'Logbook Export', 100000, ['logbook_export']);
  insertRole('role-export', 'Data Export', 100000, ['export_data']);
  insertRole('role-snapshot-a', 'Snapshot Role A', 120000, []);
  insertRole('role-snapshot-b', 'Snapshot Role B', 130000, []);

  insertUser('user-self', 'Self User', LOGIN_EMAILS.self, 'role-self');
  insertUser('user-lower', 'Lower Actor', LOGIN_EMAILS.lower, 'role-lower');
  insertUser('user-viewer', 'Rank Viewer', LOGIN_EMAILS.viewer, 'role-viewer');
  insertUser('user-equal', 'Equal Actor', LOGIN_EMAILS.equal, 'role-equal');
  insertUser('user-higher', 'Higher Actor', LOGIN_EMAILS.higher, 'role-higher');
  insertUser('user-all', 'All Viewer', LOGIN_EMAILS.all, 'role-all');
  insertUser('user-manager', 'Test Fuhrparkleitung', LOGIN_EMAILS.manager, 'manager');
  insertUser('user-logbook', 'Logbook User', LOGIN_EMAILS.logbook, 'role-logbook');
  insertUser('user-exporter', 'Export User', LOGIN_EMAILS.exporter, 'role-export');
  insertUser('user-anon', 'Anonymisiertes Konto', 'anonymized-test@example.invalid', 'role-anon', {
    active: 0,
    anonymizedAt: new Date().toISOString()
  });
  insertUser('user-snapshot', 'Snapshot User', 'snapshot@example.invalid', 'role-snapshot-a');
  ids.admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get().id;

  insertAudit({ userId: 'user-self', action: 'scope_self', entityId: 'scope-self-canary', details: { email: 'self@example.invalid' } });
  insertAudit({ userId: 'user-lower', action: 'scope_lower', entityId: 'scope-lower-canary', details: { email: 'lower@example.invalid' } });
  insertAudit({ userId: 'user-viewer', action: 'scope_viewer', entityId: 'scope-viewer-canary' });
  insertAudit({ userId: 'user-equal', action: 'scope_equal', entityId: 'scope-equal-canary' });
  insertAudit({ userId: 'user-higher', action: 'scope_higher', entityId: 'scope-higher-canary' });
  insertAudit({ userId: ids.admin, action: 'scope_admin', entityId: 'scope-admin-canary' });
  insertAudit({ userId: null, action: 'scope_system', entityType: 'system', entityId: 'scope-system-canary' });
  insertAudit({
    userId: 'user-anon',
    action: 'scope_anon',
    entityId: 'scope-anon-canary',
    details: { email: 'anon-person@example.invalid', phone: '+49 111 222333' }
  });
  insertAudit({ userId: 'user-lower', action: 'scope_legacy', entityId: 'scope-legacy-canary', actorRoleId: null, actorRoleName: null, actorRank: null });

  insertAudit({
    userId: 'user-lower',
    action: 'masking_case',
    entityId: 'masking-canary',
    details: {
      email: 'lower.person@example.invalid',
      phone: '+49 123 456789',
      name: 'Masked Person',
      password: 'CANARY_PASSWORD',
      token: 'CANARY_TOKEN',
      cookie: 'CANARY_COOKIE',
      sessionId: 'CANARY_SESSION',
      ip_address: '203.0.113.9',
      secret: 'CANARY_SECRET'
    }
  });
  insertAudit({
    userId: 'user-viewer',
    action: 'own_masking_case',
    entityId: 'own-masking-canary',
    details: { email: 'viewer.person@example.invalid', phone: '+49 987 654321', name: 'Own Person' }
  });
  insertAudit({
    userId: 'user-lower',
    action: 'details_case',
    entityId: 'details-canary',
    details: { secretNote: 'DETAILS_CANARY' }
  });

  insertAudit({ userId: 'user-lower', action: 'old_case', entityId: 'old-canary', createdAt: daysAgo(60) });
  for (let index = 0; index < 5; index += 1) {
    insertAudit({
      userId: 'user-lower',
      action: 'pagination_case',
      entityId: `pagination-canary-${index}`,
      createdAt: daysAgo(0, index + 1)
    });
  }
  for (let index = 0; index < 2; index += 1) {
    insertAudit({
      userId: 'user-higher',
      action: 'pagination_case',
      entityId: `pagination-hidden-canary-${index}`,
      createdAt: daysAgo(0, index + 7)
    });
  }
  const sortTimestamp = daysAgo(1);
  insertAudit({
    userId: 'user-lower',
    action: 'sort_case',
    entityId: 'sort-canary-a',
    createdAt: sortTimestamp
  });
  insertAudit({
    userId: 'user-lower',
    action: 'sort_case',
    entityId: 'sort-canary-b',
    createdAt: sortTimestamp
  });
  const mixedDate = daysAgo(2).slice(0, 10);
  insertAudit({
    userId: 'user-lower',
    action: 'sort_mixed_case',
    entityId: 'sort-mixed-newer',
    createdAt: `${mixedDate} 11:00:00`
  });
  insertAudit({
    userId: 'user-lower',
    action: 'sort_mixed_case',
    entityId: 'sort-mixed-older',
    createdAt: `${mixedDate}T10:00:00.000Z`
  });

  await login('admin');
  await login('manager');
  await login('self');
  await login('lower');
  await login('viewer');
  await login('equal');
  await login('higher');
  await login('all');
  await login('logbook');
  await login('exporter');
});

after(async () => {
  try { db?.close(); } catch { /* bereits geschlossen */ }
  if (child && !child.killed) {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      wait(3000)
    ]);
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Migration setzt Version 4, backfillt Snapshots und vergibt Manager-Default nur einmalig', async () => {
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-audit-migration-'));
  const migrationDb = path.join(migrationDir, 'legacy.sqlite');
  try {
    const legacy = new Database(migrationDb);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        permissions TEXT NOT NULL DEFAULT '[]',
        object_permissions TEXT NOT NULL DEFAULT '{}',
        is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
        rank INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const now = new Date().toISOString();
    legacy.prepare(`
      INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
      VALUES ('admin', 'Administrator', '[]', '{}', 1, 1000000, ?, ?),
             ('manager', 'Fuhrparkleitung', '["vehicles_view"]', '{}', 1, 900000, ?, ?)
    `).run(now, now, now, now);
    legacy.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES ('legacy-admin', 'legacy-admin@example.invalid', 'Legacy Admin', 'x', 'admin', 1, ?, ?),
             ('legacy-manager', 'legacy-manager@example.invalid', 'Legacy Manager', 'x', 'manager', 1, ?, ?)
    `).run(now, now, now, now);
    legacy.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at)
      VALUES ('legacy-manager', 'legacy_action', 'user', 'legacy-manager', '{"email":"legacy@example.invalid"}', '2026-10-20 10:00:00')
    `).run();
    legacy.pragma('user_version = 1');
    legacy.close();

    const script = `
      const { db, initSchema } = require('./server/db');
      const { ensureRoles } = require('./server/lib/permissions');
      const { migrateAuditSchema } = require('./server/lib/audit-migration');
      const { migrateSuperadminSchema } = require('./server/lib/superadmin');
      initSchema();
      ensureRoles(db);
      const changed = migrateAuditSchema(db);
      migrateSuperadminSchema(db);
      const version = Number(db.pragma('user_version', { simple: true }));
      const row = db.prepare("SELECT * FROM audit_logs WHERE action = 'legacy_action'").get();
      const managerBefore = db.prepare("SELECT permissions FROM roles WHERE id = 'manager'").get();
      const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
      const auditColumns = db.prepare('PRAGMA table_info(audit_logs)').all().map((column) => column.name);
      const auditIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_logs'").all().map((index) => index.name);
      const managerPermissions = JSON.parse(managerBefore.permissions);
      db.prepare("UPDATE roles SET permissions = ? WHERE id = 'manager'")
        .run(JSON.stringify(managerPermissions.filter((permission) => permission !== 'audit_view')));
      ensureRoles(db);
      migrateAuditSchema(db);
      migrateSuperadminSchema(db);
      const managerAfter = JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id = 'manager'").get().permissions);
      const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      const superadminRole = db.prepare("SELECT * FROM roles WHERE id = 'superadmin'").get();
      const superadminRoleCount = db.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = 'superadmin'").get().count;
      console.log(JSON.stringify({
        changed, version, row, userColumns, auditColumns, auditIndexes,
        managerHadAuditView: managerPermissions.includes('audit_view'),
        managerHadAuditViewAll: managerPermissions.includes('audit_view_all'),
        managerKeptRemoval: !managerAfter.includes('audit_view'),
        userCount,
        superadminRoleCount,
        superadminRank: superadminRole?.rank,
        superadminSystem: superadminRole?.is_system
      }));
      db.close();
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATA_DIR: migrationDir,
        DB_PATH: migrationDb,
        UPLOAD_DIR: path.join(migrationDir, 'uploads')
      },
      encoding: 'utf8'
    });
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(result.changed, false);
    assert.equal(result.version, 4);
    assert.equal(result.superadminRoleCount, 1);
    assert.equal(result.superadminRank, 2000000);
    assert.equal(result.superadminSystem, 1);
    assert.equal(result.row.actor_role_id, 'manager');
    assert.equal(result.row.actor_role_name, 'Fuhrparkleitung');
    assert.equal(result.row.actor_rank, 900000);
    assert.equal(result.row.is_meta, 0);
    assert.equal(result.managerHadAuditView, true);
    assert.equal(result.managerHadAuditViewAll, false);
    assert.equal(result.managerKeptRemoval, true);
    assert.ok(result.userColumns.includes('last_login_at'), 'QS-005: last_login_at fehlt nach Migration');
    for (const column of ['actor_role_id', 'actor_role_name', 'actor_rank', 'is_meta']) {
      assert.ok(result.auditColumns.includes(column), `Audit-Spalte fehlt: ${column}`);
    }
    for (const indexName of ['idx_audit_created', 'idx_audit_user_created', 'idx_audit_rank_created']) {
      assert.ok(result.auditIndexes.includes(indexName), `Audit-Index fehlt: ${indexName}`);
    }
    assert.equal(result.userCount, 2);
  } finally {
    try { fs.rmSync(migrationDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('writeAudit speichert Rang-Snapshot, keine nachträgliche Änderung und keine Secret-Felder', () => {
  const firstId = insertAudit({
    userId: 'user-snapshot',
    action: 'snapshot_seed',
    entityType: 'note',
    entityId: 'snapshot-seed'
  });
  assert.ok(firstId);
  writeAudit(db, {
    userId: 'user-snapshot',
    action: 'snapshot_test_a',
    entityType: 'user',
    entityId: 'snapshot-a',
    details: {
      email: 'snapshot@example.invalid',
      password: 'STORAGE_CANARY_PASSWORD',
      token: 'STORAGE_CANARY_TOKEN',
      ip: '198.51.100.7'
    }
  });
  db.prepare("UPDATE users SET role = 'role-snapshot-b' WHERE id = 'user-snapshot'").run();
  writeAudit(db, {
    userId: 'user-snapshot',
    action: 'snapshot_test_b',
    entityType: 'user',
    entityId: 'snapshot-b'
  });

  const rows = db.prepare("SELECT * FROM audit_logs WHERE action IN ('snapshot_test_a', 'snapshot_test_b') ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actor_role_id, 'role-snapshot-a');
  assert.equal(rows[0].actor_role_name, 'Snapshot Role A');
  assert.equal(rows[0].actor_rank, 120000);
  assert.equal(rows[1].actor_role_id, 'role-snapshot-b');
  assert.equal(rows[1].actor_role_name, 'Snapshot Role B');
  assert.equal(rows[1].actor_rank, 130000);
  assert.match(rows[0].details, /snapshot@example\.invalid/);
  assert.doesNotMatch(rows[0].details, /STORAGE_CANARY_PASSWORD|STORAGE_CANARY_TOKEN|198\.51\.100\.7/);
});

test('Ohne Audit-Permission ausschließlich eigene Aktionen, Filter erweitern den Scope nicht', async () => {
  const own = await apiGet('self', '/api/audit?q=scope_self');
  assert.equal(own.status, 200);
  assert.equal(own.data.scope, 'self');
  assert.equal(own.data.total, 1);
  assert.equal(own.data.items[0].action, 'scope_self');

  for (const query of ['scope_lower', 'scope_equal', 'scope_higher', 'scope_admin', 'scope_system']) {
    const hidden = await apiGet('self', `/api/audit?q=${query}`);
    assert.equal(hidden.data.total, 0, `Self-Scope leakt ${query}`);
  }
  const actorFilter = await apiGet('self', '/api/audit?actor=Lower%20Actor');
  assert.equal(actorFilter.data.total, 0);
  const allParam = await apiGet('self', '/api/audit?all=1&q=scope_lower');
  assert.equal(allParam.data.total, 0, 'all-Parameter darf den Scope nicht erweitern');
});

test('audit_view sieht eigene und strikt niedrigere Ränge, keine Ties/Höheren/Admin/System', async () => {
  const expected = {
    scope_self: 1,
    scope_lower: 1,
    scope_viewer: 1,
    scope_equal: 0,
    scope_higher: 0,
    scope_admin: 0,
    scope_system: 0,
    scope_legacy: 0
  };
  for (const [query, total] of Object.entries(expected)) {
    const result = await apiGet('viewer', `/api/audit?q=${query}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.scope, 'rank');
    assert.equal(result.data.total, total, `Rang-Scope falsch für ${query}`);
  }

  const anon = await apiGet('viewer', '/api/audit?q=scope_anon');
  assert.equal(anon.data.total, 1);
  assert.equal(anon.data.items[0].actor.name, 'Anonymisiertes Konto');
  assert.equal(anon.data.items[0].actor.roleName, 'Anonymized Role');
  assert.equal(anon.data.items[0].actor.rank, 150000);
  assert.doesNotMatch(anon.text, /anon-person@example\.invalid|\+49 111 222333/);

  const actorFilter = await apiGet('viewer', '/api/audit?actor=Lower%20Actor&q=scope_lower');
  assert.equal(actorFilter.data.total, 1);
  const actorIdFilter = await apiGet('viewer', '/api/audit?actor=user-lower&q=scope_lower');
  assert.equal(actorIdFilter.data.total, 1);
  const hiddenActorFilter = await apiGet('viewer', '/api/audit?actor=Higher%20Actor&q=scope_lower');
  assert.equal(hiddenActorFilter.data.total, 0);
  const hiddenActionFilter = await apiGet('viewer', '/api/audit?action=scope_higher&q=scope_lower');
  assert.equal(hiddenActionFilter.data.total, 0);
  const hiddenEntityFilter = await apiGet('viewer', '/api/audit?entityType=system&q=scope_system');
  assert.equal(hiddenEntityFilter.data.total, 0);
});

test('Pagination und total berücksichtigen nur sichtbare Zeilen', async () => {
  const firstPage = await apiGet('viewer', '/api/audit?q=pagination-canary&page=1&pageSize=2');
  assert.equal(firstPage.data.total, 5);
  assert.equal(firstPage.data.totalPages, 3);
  assert.equal(firstPage.data.items.length, 2);

  const lastPage = await apiGet('viewer', '/api/audit?q=pagination-canary&page=3&pageSize=2');
  assert.equal(lastPage.data.total, 5);
  assert.equal(lastPage.data.items.length, 1);

  const defaultPage = await apiGet('viewer', '/api/audit?q=pagination-canary');
  assert.equal(defaultPage.data.page, 1);
  assert.equal(defaultPage.data.pageSize, 25);
  assert.equal(defaultPage.data.items.length, 5);

  const maxPageSize = await apiGet('viewer', '/api/audit?q=pagination-canary&pageSize=500');
  assert.equal(maxPageSize.data.pageSize, 100);
  assert.equal(maxPageSize.data.total, 5);
});

test('Suche nutzt nur Allowlist, keine rohen details, keine SQL-Wildcards/Injection', async () => {
  const detailsOnly = await apiGet('viewer', '/api/audit?q=DETAILS_CANARY');
  assert.equal(detailsOnly.data.total, 0);
  for (const query of ['%25', '_____', "%27%20OR%201%3D1%20--"]) {
    const result = await apiGet('viewer', `/api/audit?q=${query}`);
    assert.equal(result.data.total, 0, `Wildcard/Injection erweitert Suche: ${query}`);
  }
  const actorWildcard = await apiGet('viewer', '/api/audit?actor=%25');
  assert.equal(actorWildcard.data.total, 0);
  const targetWildcard = await apiGet('viewer', '/api/audit?target=_');
  assert.equal(targetWildcard.data.total, 0);

  const raw = await apiGet('viewer', '/api/audit?action=masking_case');
  assert.equal(raw.data.total, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(raw.data.items[0], 'details'), false);
  assert.doesNotMatch(raw.text, /DETAILS_CANARY|CANARY_PASSWORD|CANARY_TOKEN|CANARY_COOKIE|CANARY_SESSION|CANARY_SECRET|203\.0\.113\.9/);
});

test('Maskierung: eigene Einträge unmaskiert, fremde im Rang maskiert, audit_view_all unmaskiert', async () => {
  const foreign = await apiGet('viewer', '/api/audit?action=masking_case');
  assert.equal(foreign.data.total, 1);
  assert.doesNotMatch(foreign.text, /lower\.person@example\.invalid|\+49 123 456789/);
  assert.match(foreign.text, /l\*\*\*@example\.invalid/);
  assert.match(foreign.text, /•••• 89/);

  const own = await apiGet('viewer', '/api/audit?action=own_masking_case');
  assert.equal(own.data.total, 1);
  assert.match(own.text, /viewer\.person@example\.invalid/);
  assert.match(own.text, /\+49 987 654321/);

  const all = await apiGet('all', '/api/audit?action=masking_case');
  assert.equal(all.data.total, 1);
  assert.match(all.text, /lower\.person@example\.invalid/);
  assert.match(all.text, /\+49 123 456789/);
  assert.doesNotMatch(all.text, /CANARY_PASSWORD|CANARY_TOKEN|CANARY_COOKIE|CANARY_SESSION|CANARY_SECRET|203\.0\.113\.9/);
});

test('Ziel-Label nur mit Objektberechtigung, sonst Typ und gekürzte ID', async () => {
  db.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, location, department, status, mileage, insurance, color, notes, created_at, updated_at)
    VALUES ('vehicle-audit-1', 'Geheimfahrzeug', 'TEST-AU-1', 'Pkw', 'Benzin', 5, 'Test', 'Test', 'available', 0, '', '#2563eb', '', ?, ?)
  `).run(new Date().toISOString(), new Date().toISOString());
  insertAudit({
    userId: 'user-lower',
    action: 'vehicle_case',
    entityType: 'vehicle',
    entityId: 'vehicle-audit-1',
    details: { name: 'Geheimfahrzeug', plate: 'TEST-AU-1' }
  });

  const masked = await apiGet('viewer', '/api/audit?q=vehicle_case&target=vehicle-audit-1');
  assert.equal(masked.data.total, 1);
  assert.match(masked.data.items[0].targetLabel, /^Fahrzeug · vehicle-/);
  assert.doesNotMatch(masked.text, /Geheimfahrzeug|TEST-AU-1/);

  const visible = await apiGet('all', '/api/audit?q=vehicle_case&target=Geheimfahrzeug');
  assert.equal(visible.data.total, 1);
  assert.match(visible.data.items[0].targetLabel, /Geheimfahrzeug/);
});

test('audit_view_all sieht alle Ränge inklusive Admin/System/Meta; kein all-Schalter nötig', async () => {
  assert.ok(sessions.all.permissions.includes('audit_view_all'));
  assert.ok(sessions.all.permissions.includes('audit_view'), 'audit_view_all muss audit_view implizieren');

  const expected = {
    scope_self: 1,
    scope_lower: 1,
    scope_equal: 1,
    scope_higher: 1,
    scope_admin: 1,
    scope_system: 1,
    scope_legacy: 1
  };
  for (const [query, total] of Object.entries(expected)) {
    const result = await apiGet('all', `/api/audit?q=${query}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.scope, 'all');
    assert.equal(result.data.total, total, `All-Scope falsch für ${query}`);
  }
  const withoutAll = await apiGet('all', '/api/audit?all=0&q=scope_equal');
  assert.equal(withoutAll.data.total, 1);
  const withAll = await apiGet('all', '/api/audit?all=1&q=scope_lower');
  assert.equal(withAll.data.total, 1);
});

test('Meta-Audit: Lesezugriff wird ohne Inhalte protokolliert, nur für All/Admin sichtbar, keine Rekursion', async () => {
  const selfMeta = await apiGet('self', '/api/audit?action=read&entityType=audit');
  assert.equal(selfMeta.data.total, 0);
  const rankMeta = await apiGet('viewer', '/api/audit?action=read&entityType=audit');
  assert.equal(rankMeta.data.total, 0);

  const beforeCount = db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE is_meta = 1').get().count;
  const allMeta = await apiGet('all', '/api/audit?action=read&entityType=audit&pageSize=1');
  assert.equal(allMeta.status, 200);
  assert.ok(allMeta.data.total >= 1);
  const afterCount = db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE is_meta = 1').get().count;
  assert.equal(afterCount - beforeCount, 1, 'Genau ein Meta-Eintrag pro Lesezugriff');

  const latest = db.prepare('SELECT details FROM audit_logs WHERE is_meta = 1 ORDER BY id DESC LIMIT 1').get();
  const details = JSON.parse(latest.details);
  assert.ok(details.filters);
  assert.equal(typeof details.count, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(details, 'items'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(details, 'ids'), false);

  const adminMeta = await apiGet('admin', '/api/audit?action=read&entityType=audit');
  assert.equal(adminMeta.status, 200);
  assert.ok(adminMeta.data.total >= 1);
});

test('Manager erhält audit_view per Default, audit_view_all ist innerhalb Grant Ceiling delegierbar', async () => {
  assert.ok(sessions.manager.permissions.includes('audit_view'));
  assert.equal(sessions.manager.permissions.includes('audit_view_all'), false);
  assert.equal(Number(db.pragma('user_version', { simple: true })), 17);

  const denied = await apiJson('manager', 'POST', '/api/roles', {
    name: 'Audit-Delegation vor Grant',
    permissions: ['audit_view_all'],
    rank: 800000
  });
  assert.equal(denied.status, 403, `audit_view_all darf ohne eigenes Recht nicht delegiert werden: ${denied.text}`);

  const managerRole = db.prepare("SELECT permissions FROM roles WHERE id = 'manager'").get();
  const permissions = new Set(JSON.parse(managerRole.permissions));
  permissions.add('audit_view_all');
  permissions.add('audit_view');
  const adminUpdate = await apiJson('admin', 'PATCH', '/api/roles/manager', {
    name: 'Fuhrparkleitung',
    permissions: [...permissions],
    rank: 900000
  });
  assert.equal(adminUpdate.status, 200, `Admin-Rollenupdate fehlgeschlagen: ${adminUpdate.text}`);

  const allowed = await apiJson('manager', 'POST', '/api/roles', {
    name: 'Audit-Delegation nach Grant',
    permissions: ['audit_view_all'],
    rank: 800000
  });
  assert.equal(allowed.status, 201);
  const createdRole = db.prepare("SELECT permissions FROM roles WHERE name = 'Audit-Delegation nach Grant'").get();
  const createdPermissions = JSON.parse(createdRole.permissions);
  assert.ok(createdPermissions.includes('audit_view_all'));
  assert.ok(createdPermissions.includes('audit_view'));
});

test('Legacy-/System-/Superadmin-Einträge und Anonymisierung', async () => {
  const rankView = await apiGet('viewer', '/api/audit?q=scope_admin');
  assert.equal(rankView.data.total, 0);
  const allView = await apiGet('all', '/api/audit?q=scope_admin');
  assert.equal(allView.data.total, 1);
  const adminView = await apiGet('admin', '/api/audit?q=scope_admin');
  assert.equal(adminView.data.total, 1);

  const system = await apiGet('all', '/api/audit?q=scope_system');
  assert.equal(system.data.total, 1);
  assert.equal(system.data.items[0].actor.name, 'System');
  assert.equal(system.data.items[0].actor.id, null);

  const legacySelf = await apiGet('lower', '/api/audit?q=scope_legacy');
  assert.equal(legacySelf.data.total, 1, 'Eigene Legacy-Zeile bleibt im Self-Scope sichtbar');
});

test('Sortierung created_at DESC, id DESC und Zeitraum-Filter', async () => {
  const sorted = await apiGet('viewer', '/api/audit?q=sort-canary');
  assert.equal(sorted.data.total, 2);
  assert.equal(sorted.data.items[0].entityId, 'sort-canary-b');
  assert.equal(sorted.data.items[1].entityId, 'sort-canary-a');
  assert.ok(sorted.data.items[0].id > sorted.data.items[1].id);

  const mixed = await apiGet('viewer', '/api/audit?q=sort-mixed');
  assert.equal(mixed.data.total, 2);
  assert.equal(mixed.data.items[0].entityId, 'sort-mixed-newer', 'Legacy-Zeitstempel müssen chronologisch sortiert werden');
  assert.equal(mixed.data.items[1].entityId, 'sort-mixed-older');

  const defaultRange = await apiGet('viewer', '/api/audit?q=old-canary');
  assert.equal(defaultRange.data.total, 0, '60 Tage alter Eintrag liegt außerhalb des 30-Tage-Defaults');
  const explicitRange = await apiGet('viewer', `/api/audit?q=old-canary&from=${isoDateDaysAgo(90)}&to=${isoDateDaysAgo(0)}`);
  assert.equal(explicitRange.data.total, 1);
  const inclusiveDay = await apiGet('viewer', `/api/audit?q=old-canary&from=${isoDateDaysAgo(60)}&to=${isoDateDaysAgo(60)}`);
  assert.equal(inclusiveDay.data.total, 1, 'Von/Bis müssen inklusiv sein');
});

test('QS-001: Exportrechte bleiben serverseitig durchgesetzt, Audit-Schreibpfad kompatibel', async () => {
  const noExportCsv = await apiGet('viewer', '/api/export/logbook.csv');
  assert.equal(noExportCsv.status, 403);
  const noExportJson = await apiGet('viewer', '/api/export/data.json');
  assert.equal(noExportJson.status, 403);
  const managerCsv = await apiGet('manager', '/api/export/logbook.csv');
  assert.equal(managerCsv.status, 200);
  const managerJson = await apiGet('manager', '/api/export/data.json');
  assert.equal(managerJson.status, 200);
  const unauthenticated = await fetch(`${baseUrl}/api/export/logbook.csv`, { redirect: 'manual' });
  assert.equal(unauthenticated.status, 401);
  const exportAudits = db.prepare(`
    SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'export' AND user_id = 'user-manager' AND actor_rank = 900000
  `).get().count;
  assert.ok(exportAudits >= 2, 'Bestehende Export-Auditpfade müssen weiterhin Snapshots schreiben');
});

test('QS-007/QS-008: logbook_view sieht abgeschlossene Fahrten, CSV neutralisiert Formeln', async () => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO vehicles
      (id, name, plate, type, fuel, seats, location, department, status, mileage, insurance, color, notes, created_at, updated_at)
    VALUES ('vehicle-logbook-1', 'Logbook Fahrzeug', 'TEST-LB-1', 'Pkw', 'Diesel', 5, '', '', 'available', 1000, '', '#2563eb', '', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, created_at, updated_at)
    VALUES ('driver-logbook-1', 'Logbook Fahrer', 'Test', '', '', '', '["B"]', 'available', '#2563eb', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO bookings
      (id, vehicle_id, driver_id, purpose, start_at, end_at, status, start_km, end_km, notes, created_by, completed_at, created_at, updated_at)
    VALUES ('booking-logbook-1', 'vehicle-logbook-1', 'driver-logbook-1', '=1+1', '2026-10-20T08:00', '2026-10-20T09:00', 'completed', 1000, 1010, '', 'user-logbook', '2026-10-20', ?, ?)
  `).run(now, now);

  const state = await apiGet('logbook', '/api/state');
  assert.equal(state.status, 200);
  assert.ok(state.data.bookings.some((booking) => booking.id === 'booking-logbook-1'));
  const csv = await apiGet('logbook', '/api/export/logbook.csv?period=all');
  assert.equal(csv.status, 200);
  assert.match(csv.text, /'=1\+1/);
});

test('UI enthält Audit-Seite, Filter, Pagination und keinen all-Schalter', () => {
  const views = fs.readFileSync(path.join(ROOT, 'public', 'views.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'server', 'views', 'index.html'), 'utf8');
  assert.match(views, /function renderAudit\(/);
  assert.match(views, /id="auditFilterForm"/);
  assert.match(views, /id="auditResults"/);
  assert.match(views, /renderAuditPagination/);
  assert.match(views, /Keine Treffer/);
  assert.match(views, /Noch keine eigenen Aktionen/);
  assert.match(index, /data-route="audit"/);
  assert.match(index, /Audit-Log/);
  assert.doesNotMatch(app, /params\.set\(['"]all['"]/);
  assert.doesNotMatch(views, /id="auditAllSwitch"/);
});
