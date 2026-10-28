'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const { ensureSuperadminRole, fileSecurityWarnings, directorySecurityWarnings, pathSafetyWarnings, readSuperadminFile } = require('../server/lib/superadmin');

const ROOT = path.join(__dirname, '..');
const ADMIN_EMAIL = 'admin-superadmin-test@example.invalid';
const ADMIN_PASSWORD = 'Admin-Superadmin-Test-2026';
const MANAGER_EMAIL = 'manager-superadmin-test@example.invalid';
const MANAGER_PASSWORD = 'Manager-Superadmin-Test-2026';
const SUPER_ONE = {
  email: 'superadmin-one@example.invalid',
  name: 'Superadmin Test',
  password: 'Superadmin-Eins-Test-2026'
};
const SUPER_TWO = {
  email: 'superadmin-two@example.invalid',
  name: 'Superadmin Rotiert',
  password: 'Superadmin-Zwei-Test-2026'
};
const SUPER_THREE = {
  email: 'superadmin-three@example.invalid',
  name: 'Superadmin Erholt',
  password: 'Superadmin-Drei-Test-2026'
};
const ADMIN_TWO = {
  email: 'admin-two@example.invalid',
  name: 'Zweiter Administrator',
  password: 'Admin-Zwei-Test-2026',
  newPassword: 'Admin-Zwei-Neu-Test-2026'
};
const ADMIN_THREE = {
  email: 'admin-three@example.invalid',
  name: 'Dritter Administrator',
  password: 'Admin-Drei-Test-2026'
};

let tempDir;
let dbPath;
let uploadDir;
let superadminFile;
let sessionSecret;
let baseUrl;
let child;
let serverOutput = '';
let db;
let cookies = {};
let sessions = {};
let hashes = {};
let ids = {};

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

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // Server startet noch.
    }
    await wait(100);
  }
  throw new Error('Testserver nicht erreichbar.');
}

function writeSuperadminFile(data, mode = 0o600) {
  fs.mkdirSync(path.dirname(superadminFile), { recursive: true });
  fs.writeFileSync(superadminFile, JSON.stringify(data), { encoding: 'utf8', mode });
  if (process.platform !== 'win32') fs.chmodSync(superadminFile, mode);
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

async function loginAt(url, email, password) {
  const page = await fetch(`${url}/login`, { redirect: 'manual' });
  if (page.status !== 200) return { ok: false, status: page.status };
  const html = await page.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  const firstCookie = extractCookie(page);
  assert.ok(csrf, 'CSRF-Token fehlt');
  assert.ok(firstCookie, 'Session-Cookie fehlt');
  const response = await fetch(`${url}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body: new URLSearchParams({ _csrf: csrf, email, password })
  });
  if (response.status !== 303) return { ok: false, status: response.status };
  const cookie = extractCookie(response) || firstCookie;
  const sessionResponse = await fetch(`${url}/api/session`, { headers: { cookie } });
  if (sessionResponse.status !== 200) return { ok: false, status: sessionResponse.status };
  const session = await sessionResponse.json();
  return { ok: true, cookie, session, csrf: session.csrfToken };
}

async function loginAs(key, email, password) {
  const result = await loginAt(baseUrl, email, password);
  if (!result.ok) return result;
  cookies[key] = result.cookie;
  sessions[key] = result.session;
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
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text };
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
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text };
}

function spawnGlobalServer() {
  return spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(new URL(baseUrl).port),
      DATA_DIR: tempDir,
      DB_PATH: dbPath,
      UPLOAD_DIR: uploadDir,
      SUPERADMIN_FILE: superadminFile,
      SESSION_SECRET: sessionSecret,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ADMIN_NAME: 'Test-Administrator',
      ORG_NAME: 'Superadmin-Testorganisation',
      ORG_LOCATION: 'Teststandort',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function startGlobalServer({ resetOutput = false } = {}) {
  if (resetOutput) serverOutput = '';
  baseUrl = `http://127.0.0.1:${await freePort()}`;
  child = spawnGlobalServer();
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth(baseUrl);
}

async function stopGlobalServer() {
  if (!child || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, wait(5000)]);
  child = null;
}

function openDb() {
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
}

function closeDb() {
  try { db?.close(); } catch { /* bereits geschlossen */ }
  db = null;
}

async function restartGlobalServer({ resetOutput = false } = {}) {
  closeDb();
  await stopGlobalServer();
  await startGlobalServer({ resetOutput });
  openDb();
}

function auditRows(action) {
  return db.prepare('SELECT * FROM audit_logs WHERE action = ? ORDER BY id').all(action);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-superadmin-test-'));
  dbPath = path.join(tempDir, 'test.sqlite');
  uploadDir = path.join(tempDir, 'uploads');
  superadminFile = path.join(tempDir, 'secrets', 'awo-superadmin.json');
  sessionSecret = crypto.randomBytes(32).toString('hex');
  hashes.one = bcrypt.hashSync(SUPER_ONE.password, 12);
  hashes.two = bcrypt.hashSync(SUPER_TWO.password, 12);
  hashes.three = bcrypt.hashSync(SUPER_THREE.password, 12);
  writeSuperadminFile({ email: SUPER_ONE.email, name: SUPER_ONE.name, passwordHash: hashes.one });

  await startGlobalServer();
  openDb();

  ids.admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND id <> 'superadmin' ORDER BY created_at LIMIT 1").get().id;

  await loginAs('admin', ADMIN_EMAIL, ADMIN_PASSWORD);
  await loginAs('superadmin', SUPER_ONE.email, SUPER_ONE.password);

  const managerCreate = await apiJson('admin', 'POST', '/api/users', {
    name: 'Test Fuhrparkleitung',
    email: MANAGER_EMAIL,
    role: 'manager',
    password: MANAGER_PASSWORD
  });
  assert.equal(managerCreate.status, 201, `Manager konnte nicht angelegt werden: ${managerCreate.text}`);
  ids.manager = db.prepare('SELECT id FROM users WHERE email = ?').get(MANAGER_EMAIL).id;
  await loginAs('manager', MANAGER_EMAIL, MANAGER_PASSWORD);
});

after(async () => {
  closeDb();
  await stopGlobalServer();
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Bootstrap: Datei legt aktiven Superadmin an, Migration ist idempotent, Login funktioniert', async () => {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);

  assert.equal(Number(db.pragma('user_version', { simple: true })), 10);
  const role = db.prepare("SELECT * FROM roles WHERE id = 'superadmin'").get();
  assert.equal(role.name, 'Superadmin');
  assert.equal(role.rank, 2000000);
  assert.equal(role.is_system, 1);
  const rolePermissions = JSON.parse(role.permissions);
  for (const permission of ['users_manage', 'roles_manage', 'audit_view_all', 'settings_manage']) {
    assert.ok(rolePermissions.includes(permission), `Superadmin-Rolle fehlt ${permission}`);
  }
  assert.ok(role.rank > Number(db.prepare("SELECT rank FROM roles WHERE id = 'admin'").get().rank));

  const user = db.prepare("SELECT * FROM users WHERE id = 'superadmin'").get();
  assert.equal(user.role, 'superadmin');
  assert.equal(user.active, 1);
  assert.equal(user.email, SUPER_ONE.email);
  assert.equal(user.name, SUPER_ONE.name);
  assert.notEqual(user.password_hash, SUPER_ONE.password);
  assert.match(user.password_hash, /^\$2[aby]\$12\$/);
  assert.equal(bcrypt.compareSync(SUPER_ONE.password, user.password_hash), true);

  assert.equal(sessions.superadmin.user.id, 'superadmin');
  assert.equal(sessions.superadmin.user.isSuperadmin, true);
  assert.equal(sessions.superadmin.user.isAdmin, false);
  assert.equal(sessions.superadmin.capabilities.isSuperadmin, true);
  assert.equal(sessions.superadmin.capabilities.manageUsers, true);
  assert.equal(sessions.superadmin.capabilities.manageAdmins, true);
  assert.equal(sessions.superadmin.capabilities.canChangePassword, false);

  const superState = await apiGet('superadmin', '/api/state');
  assert.equal(superState.status, 200);
  assert.equal(superState.data.users.some((entry) => entry.id === 'superadmin'), false);
  assert.equal(superState.data.users.some((entry) => /superadmin-one/.test(entry.email)), false);
  assert.equal(superState.data.roles.some((entry) => entry.id === 'superadmin'), false, 'Superadmin-Rolle darf nicht im State erscheinen');

  const adminState = await apiGet('admin', '/api/state');
  assert.equal(adminState.status, 200);
  assert.equal(adminState.data.users.some((entry) => entry.id === 'superadmin'), false);
  assert.equal(adminState.data.roles.some((entry) => entry.id === 'superadmin'), false, 'Admin darf Superadmin-Rolle nicht sehen');

  const created = auditRows('superadmin_created');
  assert.equal(created.length, 1);
  assert.equal(auditRows('superadmin_update').length, 0);
  assert.doesNotMatch(created[0].details || '', /\$2[aby]\$|SUPERADMIN.*PASSWORT/i);
  assert.doesNotMatch(serverOutput, new RegExp(hashes.one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const cookie = cookies.superadmin;
  const csrf = sessions.superadmin.csrf;
  await restartGlobalServer({ resetOutput: true });
  const unchanged = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(unchanged.status, 200, 'Unveränderte Datei darf bestehende Superadmin-Session nicht invalidieren');
  assert.equal(auditRows('superadmin_created').length, 1, 'Unveränderte Datei darf keinen weiteren Bootstrap auditieren');
  assert.equal(auditRows('superadmin_update').length, 0, 'Unveränderte Datei darf kein Update auditieren');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = 'superadmin'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'superadmin'").get().count, 1);
  assert.ok(csrf);
});

test('Rolle und Konto sind systemgeschützt, versteckt und nicht über die API zuweisbar', async () => {
  const patchSuperRole = await apiJson('admin', 'PATCH', '/api/roles/superadmin', {
    name: 'Superadmin kopiert',
    permissions: [],
    rank: 1
  });
  assert.equal(patchSuperRole.status, 409);
  const deleteSuperRole = await apiJson('admin', 'DELETE', '/api/roles/superadmin');
  assert.equal(deleteSuperRole.status, 409);
  const deleteAdminRole = await apiJson('superadmin', 'DELETE', '/api/roles/admin');
  assert.equal(deleteAdminRole.status, 409);
  const patchAdminRole = await apiJson('superadmin', 'PATCH', '/api/roles/admin', {
    name: 'Administrator',
    permissions: [],
    rank: 1
  });
  assert.equal(patchAdminRole.status, 409);

  const patchSuperUser = await apiJson('admin', 'PATCH', '/api/users/superadmin', {
    name: 'Gekapert',
    email: 'gekapert@example.invalid',
    role: 'superadmin',
    active: false
  });
  assert.equal(patchSuperUser.status, 403);
  const selfEdit = await apiJson('superadmin', 'PATCH', '/api/users/superadmin', {
    name: 'Selbst',
    email: SUPER_ONE.email,
    role: 'superadmin',
    active: true
  });
  assert.equal(selfEdit.status, 403);
  const selfAnonymize = await apiJson('superadmin', 'POST', '/api/users/superadmin/anonymize');
  assert.equal(selfAnonymize.status, 403);
  const deleteSuperUser = await apiJson('superadmin', 'DELETE', '/api/users/superadmin');
  assert.equal(deleteSuperUser.status, 404, 'Es darf keine Löschroute für das Superadmin-Konto geben');
  const selfPassword = await apiJson('superadmin', 'POST', '/api/auth/password', {
    currentPassword: SUPER_ONE.password,
    newPassword: 'Neues-Superadmin-Passwort-2026'
  });
  assert.equal(selfPassword.status, 403);

  const assignByAdmin = await apiJson('admin', 'POST', '/api/users', {
    name: 'Zweiter Superadmin',
    email: 'second-superadmin@example.invalid',
    role: 'superadmin',
    password: 'Zweiter-Superadmin-Test-2026'
  });
  assert.equal(assignByAdmin.status, 403);
  const assignBySuper = await apiJson('superadmin', 'POST', '/api/users', {
    name: 'Zweiter Superadmin',
    email: 'second-superadmin@example.invalid',
    role: 'superadmin',
    password: 'Zweiter-Superadmin-Test-2026'
  });
  assert.equal(assignBySuper.status, 403);
  const promoteToSuper = await apiJson('superadmin', 'PATCH', `/api/users/${ids.manager}`, {
    name: 'Test Fuhrparkleitung',
    email: MANAGER_EMAIL,
    role: 'superadmin',
    active: true
  });
  assert.equal(promoteToSuper.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin' OR id = 'superadmin'").get().count, 1);

  const adminState = await apiGet('admin', '/api/state');
  assert.equal(adminState.data.users.some((entry) => entry.id === 'superadmin'), false);
  assert.equal(adminState.data.users.some((entry) => entry.email === SUPER_ONE.email), false);
  const managerState = await apiGet('manager', '/api/state');
  assert.equal(managerState.data.users.some((entry) => entry.id === 'superadmin'), false);
  assert.equal(managerState.data.roles.some((entry) => entry.id === 'superadmin'), false, 'Nicht-Admins sehen die Superadmin-Rolle nicht');
});

test('Admins verwalten keine Admins; nur Superadmin verwaltet Admin-Konten inklusive Herabstufung und Anonymisierung', async () => {
  const adminEditManager = await apiJson('admin', 'PATCH', `/api/users/${ids.manager}`, {
    name: 'Test Fuhrparkleitung',
    email: MANAGER_EMAIL,
    role: 'manager',
    active: true
  });
  assert.equal(adminEditManager.status, 200, 'Admin muss weiterhin niedrigere Konten verwalten dürfen');

  const adminCreateAdmin = await apiJson('admin', 'POST', '/api/users', {
    name: ADMIN_TWO.name,
    email: ADMIN_TWO.email,
    role: 'admin',
    password: ADMIN_TWO.password
  });
  assert.equal(adminCreateAdmin.status, 403);
  const adminPromote = await apiJson('admin', 'PATCH', `/api/users/${ids.manager}`, {
    name: 'Test Fuhrparkleitung',
    email: MANAGER_EMAIL,
    role: 'admin',
    active: true
  });
  assert.equal(adminPromote.status, 403);
  const adminSelfEdit = await apiJson('admin', 'PATCH', `/api/users/${ids.admin}`, {
    name: 'Selbst Administrator',
    email: ADMIN_EMAIL,
    role: 'admin',
    active: true
  });
  assert.equal(adminSelfEdit.status, 400);

  const createAdmin = await apiJson('superadmin', 'POST', '/api/users', {
    name: ADMIN_TWO.name,
    email: ADMIN_TWO.email,
    role: 'admin',
    password: ADMIN_TWO.password
  });
  assert.equal(createAdmin.status, 201, `Superadmin muss Admin anlegen dürfen: ${createAdmin.text}`);
  const adminTwo = db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_TWO.email);
  assert.equal(adminTwo.role, 'admin');
  assert.equal(adminTwo.active, 1);

  const adminEditAdmin = await apiJson('admin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Fremder Admin',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: false
  });
  assert.equal(adminEditAdmin.status, 403);

  const superEditAdmin = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: true,
    password: ADMIN_TWO.newPassword
  });
  assert.equal(superEditAdmin.status, 200, `Superadmin muss Admin bearbeiten dürfen: ${superEditAdmin.text}`);
  assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get(adminTwo.id).name, 'Zweiter Administrator Neu');
  const loginAdminTwo = await loginAs('adminTwo', ADMIN_TWO.email, ADMIN_TWO.newPassword);
  assert.equal(loginAdminTwo.ok, true, 'Superadmin-Passwortänderung muss für Admin gelten');

  const demoteAdmin = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'manager',
    active: true
  });
  assert.equal(demoteAdmin.status, 200, `Superadmin muss Admin herabstufen dürfen: ${demoteAdmin.text}`);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(adminTwo.id).role, 'manager');
  const demotedSession = await fetch(`${baseUrl}/api/session`, { headers: { cookie: cookies.adminTwo } });
  assert.equal(demotedSession.status, 200);
  const demotedSessionData = await demotedSession.json();
  assert.equal(demotedSessionData.user.role, 'manager');
  assert.equal(demotedSessionData.user.isAdmin, false, 'Herabgestufter Admin darf keine Admin-Rechte mehr haben');
  const demotionAudit = db.prepare(`
    SELECT * FROM audit_logs
    WHERE action = 'update' AND entity_type = 'user' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(adminTwo.id);
  assert.match(demotionAudit.details || '', /"role":"manager"/);

  const repromoteAdmin = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: true
  });
  assert.equal(repromoteAdmin.status, 200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(adminTwo.id).role, 'admin');

  const deactivateAdminTwo = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: false
  });
  assert.equal(deactivateAdminTwo.status, 200);
  const adminTwoSession = await fetch(`${baseUrl}/api/session`, { headers: { cookie: cookies.adminTwo } });
  assert.equal(adminTwoSession.status, 401, 'Deaktivierter Admin muss sofort ausgeschlossen sein');

  const demoteLastAdmin = await apiJson('superadmin', 'PATCH', `/api/users/${ids.admin}`, {
    name: 'Test-Administrator',
    email: ADMIN_EMAIL,
    role: 'manager',
    active: true
  });
  assert.equal(demoteLastAdmin.status, 400, 'Der letzte aktive Admin darf nicht herabgestuft werden');
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(ids.admin).role, 'admin');
  const deactivateLastAdmin = await apiJson('superadmin', 'PATCH', `/api/users/${ids.admin}`, {
    name: 'Test-Administrator',
    email: ADMIN_EMAIL,
    role: 'admin',
    active: false
  });
  assert.equal(deactivateLastAdmin.status, 400);

  const reactivateAdminTwo = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: true
  });
  assert.equal(reactivateAdminTwo.status, 200);
  const adminTwoActive = await loginAt(baseUrl, ADMIN_TWO.email, ADMIN_TWO.newPassword);
  assert.equal(adminTwoActive.ok, true);

  const deactivateAgain = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: false
  });
  assert.equal(deactivateAgain.status, 200);
  db.prepare("UPDATE users SET deactivated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(adminTwo.id);
  const policyOn = await apiJson('superadmin', 'PATCH', '/api/user-policy', { autoAnonymizeDays: 1 });
  assert.equal(policyOn.status, 200);
  const afterAuto = db.prepare('SELECT * FROM users WHERE id = ?').get(adminTwo.id);
  assert.equal(afterAuto.active, 0);
  assert.ok(afterAuto.anonymized_at, 'Deaktivierte Administratorkonten müssen nach Frist automatisch anonymisiert werden');
  assert.equal(afterAuto.name, 'Anonymisiertes Konto');
  assert.match(afterAuto.email, /^anonymized-/);
  const policyOff = await apiJson('superadmin', 'PATCH', '/api/user-policy', { autoAnonymizeDays: 0 });
  assert.equal(policyOff.status, 200);
  const reactivateAgain = await apiJson('superadmin', 'PATCH', `/api/users/${adminTwo.id}`, {
    name: 'Zweiter Administrator Neu',
    email: ADMIN_TWO.email,
    role: 'admin',
    active: true
  });
  assert.equal(reactivateAgain.status, 409, 'Anonymisierte Konten dürfen nicht reaktiviert werden');

  const createAdminThree = await apiJson('superadmin', 'POST', '/api/users', {
    name: ADMIN_THREE.name,
    email: ADMIN_THREE.email,
    role: 'admin',
    password: ADMIN_THREE.password
  });
  assert.equal(createAdminThree.status, 201, createAdminThree.text);
  const adminThree = db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_THREE.email);
  const deactivateAdminThree = await apiJson('superadmin', 'PATCH', `/api/users/${adminThree.id}`, {
    name: ADMIN_THREE.name,
    email: ADMIN_THREE.email,
    role: 'admin',
    active: false
  });
  assert.equal(deactivateAdminThree.status, 200);
  const anonymizeAdmin = await apiJson('superadmin', 'POST', `/api/users/${adminThree.id}/anonymize`);
  assert.equal(anonymizeAdmin.status, 200, anonymizeAdmin.text);
  const anonymizedAdmin = db.prepare('SELECT * FROM users WHERE id = ?').get(adminThree.id);
  assert.equal(anonymizedAdmin.name, 'Anonymisiertes Konto');
  assert.match(anonymizedAdmin.email, /^anonymized-/);
  assert.ok(anonymizedAdmin.anonymized_at);

  const updates = db.prepare(`
    SELECT * FROM audit_logs
    WHERE action = 'update' AND entity_type = 'user' AND entity_id = ?
    ORDER BY id
  `).all(adminTwo.id);
  assert.ok(updates.length >= 3, 'Admin-Verwaltung muss auditiert werden');
  for (const row of updates) {
    assert.doesNotMatch(row.details || '', /\$2[aby]\$|Admin-Zwei-Neu-Test-2026|Admin-Zwei-Test-2026/);
  }
});

test('Audit zeigt Superadmin mit Sonderrolle nur für berechtigte All-/Admin-Sicht; Export bleibt ohne Konto', async () => {
  const adminAudit = await apiGet('admin', '/api/audit?action=login&pageSize=100');
  assert.equal(adminAudit.status, 200);
  const superLogin = adminAudit.data.items.find((item) => item.actor?.roleId === 'superadmin');
  assert.ok(superLogin, 'Admin muss Superadmin-Ereignisse im Audit sehen');
  assert.equal(superLogin.actor.roleName, 'Superadmin');
  assert.equal(superLogin.actor.rank, 2000000);

  const managerAudit = await apiGet('manager', '/api/audit?action=login&pageSize=100');
  assert.equal(managerAudit.status, 200);
  assert.equal(managerAudit.data.scope, 'rank');
  assert.equal(managerAudit.data.items.some((item) => item.actor?.roleId === 'superadmin'), false);

  const exportResponse = await apiGet('admin', '/api/export/data.json');
  assert.equal(exportResponse.status, 200);
  const exported = JSON.parse(exportResponse.text);
  assert.equal(exported.users.some((entry) => entry.id === 'superadmin'), false);
  assert.equal(exported.users.some((entry) => entry.email === SUPER_ONE.email), false);
  assert.doesNotMatch(JSON.stringify(exported.users), /\$2[aby]\$|SUPER_ONE/);
  assert.equal(exported.roles.some((entry) => entry.id === 'superadmin'), false, 'Export darf Superadmin-Rolle nicht enthalten');

  const superadminAudits = db.prepare(`
    SELECT * FROM audit_logs
    WHERE action IN ('superadmin_created', 'superadmin_update', 'superadmin_disabled')
    ORDER BY id
  `).all();
  assert.ok(superadminAudits.length >= 1);
  for (const row of superadminAudits) {
    assert.doesNotMatch(row.details || '', /\$2[aby]\$|passwordHash|SUPER_ONE/);
  }
});

test('Rotation, ungültige/fehlende Datei, Recovery und Session-Invalidierung', async () => {
  const secondSession = await loginAt(baseUrl, SUPER_ONE.email, SUPER_ONE.password);
  assert.equal(secondSession.ok, true);
  const oldCookie = cookies.superadmin;
  const oldSecondCookie = secondSession.cookie;

  writeSuperadminFile({ email: SUPER_TWO.email, name: SUPER_TWO.name, passwordHash: hashes.two });
  const auditBefore = auditRows('superadmin_update').length;
  await restartGlobalServer({ resetOutput: true });

  const rotated = db.prepare("SELECT * FROM users WHERE id = 'superadmin'").get();
  assert.equal(rotated.email, SUPER_TWO.email);
  assert.equal(rotated.name, SUPER_TWO.name);
  assert.equal(rotated.active, 1);
  assert.equal(rotated.password_hash, hashes.two);
  assert.equal(auditRows('superadmin_update').length, auditBefore + 1);

  for (const cookie of [oldCookie, oldSecondCookie]) {
    const response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
    assert.equal(response.status, 401, 'Rotation muss alle Superadmin-Sessions invalidieren');
  }
  const oldLogin = await loginAt(baseUrl, SUPER_ONE.email, SUPER_ONE.password);
  assert.equal(oldLogin.ok, false);
  const newLogin = await loginAs('superadmin', SUPER_TWO.email, SUPER_TWO.password);
  assert.equal(newLogin.ok, true);
  assert.match(auditRows('superadmin_update').at(-1).details || '', /emailChanged|passwordChanged/);
  assert.doesNotMatch(serverOutput, new RegExp(hashes.two.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serverOutput, /superadmin-two@example\.invalid/);

  writeSuperadminFile({ email: SUPER_TWO.email, name: SUPER_TWO.name, passwordHash: 'kein-gueltiger-bcrypt-hash' });
  await restartGlobalServer({ resetOutput: true });
  const healthAfterInvalid = await fetch(`${baseUrl}/healthz`);
  assert.equal(healthAfterInvalid.status, 200, 'Ungültige Datei darf den Start nicht abbrechen');
  const invalidRow = db.prepare("SELECT * FROM users WHERE id = 'superadmin'").get();
  assert.equal(invalidRow.active, 0);
  assert.equal(invalidRow.email, SUPER_TWO.email);
  assert.equal(invalidRow.password_hash, hashes.two, 'Ungültige Datei darf keinen alten Hash ersetzen oder löschen');
  const oldSessionAfterInvalid = await fetch(`${baseUrl}/api/session`, { headers: { cookie: cookies.superadmin } });
  assert.equal(oldSessionAfterInvalid.status, 401);
  assert.equal(auditRows('superadmin_disabled').length, 1);
  assert.match(serverOutput, /Superadmin-Datei ist ungültig/);
  assert.doesNotMatch(serverOutput, new RegExp(hashes.two.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serverOutput, /superadmin-two@example\.invalid/);
  const adminLogin = await loginAt(baseUrl, ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(adminLogin.ok, true, 'System muss bei ungültiger Superadmin-Datei normal weiterlaufen');

  fs.rmSync(superadminFile, { force: true });
  await restartGlobalServer({ resetOutput: true });
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
  const missingRow = db.prepare("SELECT * FROM users WHERE id = 'superadmin'").get();
  assert.equal(missingRow.active, 0);
  assert.equal(missingRow.email, SUPER_TWO.email);
  assert.equal(missingRow.password_hash, hashes.two);
  assert.equal(auditRows('superadmin_disabled').length, 1, 'Bereits inaktiver Superadmin darf kein Duplikat-Audit erzeugen');
  assert.match(serverOutput, /Superadmin-Datei fehlt/);
  assert.doesNotMatch(serverOutput, new RegExp(hashes.two.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serverOutput, /superadmin-two@example\.invalid/);

  writeSuperadminFile({ email: SUPER_THREE.email, name: SUPER_THREE.name, passwordHash: hashes.three });
  await restartGlobalServer({ resetOutput: true });
  const recovered = db.prepare("SELECT * FROM users WHERE id = 'superadmin'").get();
  assert.equal(recovered.active, 1);
  assert.equal(recovered.email, SUPER_THREE.email);
  assert.equal(recovered.name, SUPER_THREE.name);
  assert.equal(recovered.password_hash, hashes.three);
  assert.equal(recovered.deactivated_at, null);
  assert.equal(recovered.anonymized_at, null);
  const recoveredLogin = await loginAs('superadmin', SUPER_THREE.email, SUPER_THREE.password);
  assert.equal(recoveredLogin.ok, true);
  const oldPasswordAfterRecovery = await loginAt(baseUrl, SUPER_THREE.email, SUPER_TWO.password);
  assert.equal(oldPasswordAfterRecovery.ok, false, 'Nach Recovery darf nur der neue Datei-Hash gelten');
  const recoveryUpdate = auditRows('superadmin_update').at(-1);
  assert.match(recoveryUpdate.details || '', /"reactivated":true/);
});

test('Dateirechte- und Pfadwarnungen ohne Inhalte/Secrets', async () => {
  assert.deepEqual(fileSecurityWarnings({ mode: 0o100600, uid: 0, isFile: true, isSymbolicLink: false }, { platform: 'linux' }), []);
  assert.ok(fileSecurityWarnings({ mode: 0o100644, uid: 0, isFile: true, isSymbolicLink: false }, { platform: 'linux' }).includes('unsafe_permissions'));
  assert.ok(fileSecurityWarnings({ mode: 0o100600, uid: 1000, isFile: true, isSymbolicLink: false }, { platform: 'linux' }).includes('unexpected_owner'));
  assert.deepEqual(fileSecurityWarnings({ mode: 0o100666, uid: 1000, isFile: true, isSymbolicLink: false }, { platform: 'win32' }), []);
  assert.deepEqual(directorySecurityWarnings({ mode: 0o40755, uid: 0 }, { platform: 'linux' }), []);
  assert.ok(directorySecurityWarnings({ mode: 0o40777, uid: 0 }, { platform: 'linux' }).includes('unsafe_directory_permissions'));
  assert.ok(directorySecurityWarnings({ mode: 0o40755, uid: 1000 }, { platform: 'linux' }).includes('unexpected_directory_owner'));

  assert.ok(pathSafetyWarnings(path.join(ROOT, 'secrets', 'awo-superadmin.json'), { projectRoot: ROOT }).includes('inside_project'));
  assert.ok(pathSafetyWarnings(path.join(tempDir, 'awo-superadmin.json'), { dataDir: tempDir }).includes('inside_data'));
  assert.deepEqual(pathSafetyWarnings(path.join(tempDir, 'secrets', 'awo-superadmin.json'), { projectRoot: ROOT, dataDir: path.join(tempDir, 'data') }), []);

  const warnings = [];
  const logger = { log: () => {}, warn: (message) => warnings.push(message) };
  const read = readSuperadminFile(superadminFile, { logger, projectRoot: tempDir, dataDir: path.join(tempDir, 'data') });
  assert.equal(read.ok, true);
  assert.ok(warnings.some((message) => /Repo-, Daten- oder Upload-Bereich/.test(message)));
  assert.ok(warnings.every((message) => !message.includes(SUPER_THREE.email) && !message.includes(hashes.three)));

  if (process.platform !== 'win32') {
    fs.chmodSync(superadminFile, 0o644);
    const insecureWarnings = [];
    const insecureRead = readSuperadminFile(superadminFile, {
      logger: { log: () => {}, warn: (message) => insecureWarnings.push(message) },
      projectRoot: ROOT
    });
    assert.equal(insecureRead.ok, true);
    assert.ok(insecureWarnings.some((message) => /unsichere Rechte/.test(message)));
    assert.ok(insecureWarnings.every((message) => !message.includes(SUPER_THREE.email) && !message.includes(hashes.three)));
    fs.chmodSync(superadminFile, 0o600);
  }

  const plaintextFile = path.join(tempDir, 'secrets', 'plaintext.json');
  fs.writeFileSync(plaintextFile, JSON.stringify({
    email: SUPER_THREE.email,
    name: SUPER_THREE.name,
    passwordHash: hashes.three,
    password: SUPER_THREE.password
  }), { encoding: 'utf8', mode: 0o600 });
  const plaintextRead = readSuperadminFile(plaintextFile, { logger: { log: () => {}, warn: () => {} }, projectRoot: ROOT });
  assert.equal(plaintextRead.ok, false);
  assert.equal(plaintextRead.reason, 'plaintext_password_not_allowed');
});

test('Frische Installation ohne Superadmin-Datei: Warnung, kein Konto, Admin-Login läuft weiter', async () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-superadmin-missing-'));
  const isolatedDb = path.join(isolatedDir, 'test.sqlite');
  const isolatedPort = await freePort();
  const isolatedUrl = `http://127.0.0.1:${isolatedPort}`;
  let isolatedChild;
  let isolatedOutput = '';
  try {
    isolatedChild = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(isolatedPort),
        DATA_DIR: isolatedDir,
        DB_PATH: isolatedDb,
        UPLOAD_DIR: path.join(isolatedDir, 'uploads'),
        SUPERADMIN_FILE: path.join(isolatedDir, 'missing', 'superadmin.json'),
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
        ADMIN_EMAIL: 'fresh-admin@example.invalid',
        ADMIN_PASSWORD: ADMIN_PASSWORD,
        ADMIN_NAME: 'Fresh Admin',
        COOKIE_SECURE: 'false',
        TRUST_PROXY: '0',
        TZ: 'Europe/Berlin'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    isolatedChild.stdout.on('data', (chunk) => { isolatedOutput += chunk.toString(); });
    isolatedChild.stderr.on('data', (chunk) => { isolatedOutput += chunk.toString(); });
    await waitForHealth(isolatedUrl);
    const health = await fetch(`${isolatedUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.match(isolatedOutput, /Superadmin-Datei fehlt/);

    const isolated = new Database(isolatedDb);
    try {
      assert.equal(Number(isolated.pragma('user_version', { simple: true })), 10);
      assert.equal(isolated.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = 'superadmin' AND rank = 2000000 AND is_system = 1").get().count, 1);
      assert.equal(isolated.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'superadmin' OR role = 'superadmin'").get().count, 0);
    } finally {
      isolated.close();
    }
    const freshLogin = await loginAt(isolatedUrl, 'fresh-admin@example.invalid', ADMIN_PASSWORD);
    assert.equal(freshLogin.ok, true);
  } finally {
    if (isolatedChild && !isolatedChild.killed) {
      const exited = new Promise((resolve) => isolatedChild.once('exit', resolve));
      isolatedChild.kill();
      await Promise.race([exited, wait(5000)]);
    }
    try { fs.rmSync(isolatedDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Rollenmigration ist bei Namenskollision und Wiederholung sicher', () => {
  const memory = new Database(':memory:');
  try {
    memory.exec(`
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        permissions TEXT NOT NULL DEFAULT '[]',
        object_permissions TEXT NOT NULL DEFAULT '{}',
        booking_request_policy TEXT NOT NULL DEFAULT '{"allow":[],"deny":[]}',
        is_system INTEGER NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    memory.prepare(`
      INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank)
      VALUES ('legacy-superadmin-name', 'Superadmin', '[]', '{}', 0, 500000)
    `).run();
    ensureSuperadminRole(memory);
    ensureSuperadminRole(memory);
    const created = memory.prepare("SELECT * FROM roles WHERE id = 'superadmin'").get();
    const legacy = memory.prepare("SELECT * FROM roles WHERE id = 'legacy-superadmin-name'").get();
    assert.equal(created.rank, 2000000);
    assert.equal(created.is_system, 1);
    assert.match(created.name, /^Superadmin/);
    assert.notEqual(created.name.toLocaleLowerCase('de'), 'superadmin');
    assert.equal(legacy.name, 'Superadmin');
    assert.equal(memory.prepare("SELECT COUNT(*) AS count FROM roles WHERE id = 'superadmin'").get().count, 1);
  } finally {
    memory.close();
  }
});

test('UI enthält Schloss und keinen Superadmin-Banner; kein Passwortwechsel für Superadmin', () => {
  const views = fs.readFileSync(path.join(ROOT, 'public', 'views.js'), 'utf8');
  const modals = fs.readFileSync(path.join(ROOT, 'public', 'modals.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'server', 'views', 'index.html'), 'utf8');
  assert.match(index, /id="i-lock"/);
  assert.match(views, /role\.id === 'superadmin'/);
  assert.match(views, /Datei-verwaltet/);
  assert.doesNotMatch(views, /Superadmin ist datei-verwaltet/);
  assert.doesNotMatch(views, /Superadmin-Datei und einen Neustart/);
  assert.match(modals, /Superadmin-Passwort/);
  assert.match(app, /isSuperadmin/);
  assert.doesNotMatch(modals, /data-action="create-superadmin"/);
  assert.doesNotMatch(modals, /data-action="delete-superadmin"/);
});
