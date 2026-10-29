'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const { normalizePermissions } = require('../server/lib/permissions');

const ROOT = path.join(__dirname, '..');
const TEST_PASSWORD = 'UI-Berechtigungs-Test-2026';
const EMAILS = {
  admin: 'ui-admin@example.invalid',
  manager: 'ui-manager@example.invalid',
  usersRoles: 'ui-users-roles@example.invalid',
  ownTrips: 'ui-own-trips@example.invalid',
  viewer: 'ui-viewer@example.invalid',
  exportOnly: 'ui-export@example.invalid',
  brandingOnly: 'ui-branding@example.invalid',
  settingsOnly: 'ui-settings@example.invalid',
  logout: 'ui-logout@example.invalid'
};

const NAV_GROUPS = [
  ['dashboard', 'buchungen', 'meine-fahrten', 'anfragen', 'fahrtenbuch'],
  ['fahrzeuge', 'wartung', 'kosten'],
  ['fahrer', 'audit', 'benutzer', 'rollen', 'einstellungen', 'integrationen', 'erweitert']
];
const ALL_NAV_ROUTES = NAV_GROUPS.flat();

const SESSION_ROLES = {
  admin: {
    nav: ['dashboard', 'buchungen', 'anfragen', 'fahrtenbuch', 'fahrzeuge', 'wartung', 'kosten', 'fahrer', 'audit', 'benutzer', 'rollen', 'einstellungen', 'integrationen', 'erweitert'],
    settings: { organisation: true, branding: true, costCenters: true, export: true, users: true, roles: true, about: true, shortcuts: true, driverLink: true },
    eyebrow: 'Organisation',
    subtitle: 'Organisation, Erscheinungsbild, Kostenstellen, Datenexport, Benutzer, Rollen sowie Ihr Konto verwalten.'
  },
  manager: {
    nav: ['dashboard', 'buchungen', 'anfragen', 'fahrtenbuch', 'fahrzeuge', 'wartung', 'kosten', 'fahrer', 'audit', 'benutzer', 'rollen', 'einstellungen', 'integrationen', 'erweitert'],
    settings: { organisation: true, branding: false, costCenters: true, export: true, users: true, roles: true, about: true, shortcuts: true, driverLink: false },
    eyebrow: 'Organisation',
    subtitle: 'Organisation, Kostenstellen, Datenexport, Benutzer, Rollen sowie Ihr Konto verwalten.'
  },
  usersRoles: {
    nav: ['dashboard', 'audit', 'benutzer', 'rollen', 'einstellungen'],
    settings: { organisation: false, branding: false, export: false, users: true, roles: true, about: true, shortcuts: true, driverLink: false },
    eyebrow: 'Verwaltung',
    subtitle: 'Benutzer, Rollen sowie Ihr Konto verwalten.'
  },
  ownTrips: {
    nav: ['meine-fahrten', 'audit', 'einstellungen'],
    settings: { organisation: false, branding: false, export: false, users: false, roles: false, about: false, shortcuts: false, driverLink: false },
    eyebrow: 'Konto',
    subtitle: 'Ihr Konto und Ihre Zugangsdaten verwalten.'
  },
  viewer: {
    nav: ['dashboard', 'buchungen', 'fahrzeuge', 'fahrer', 'audit', 'einstellungen'],
    settings: { organisation: false, branding: false, export: false, users: false, roles: false, about: false, shortcuts: false, driverLink: false },
    eyebrow: 'Konto',
    subtitle: 'Ihr Konto und Ihre Zugangsdaten verwalten.'
  },
  exportOnly: {
    nav: ['dashboard', 'audit', 'einstellungen'],
    settings: { organisation: false, branding: false, export: true, users: false, roles: false, about: true, shortcuts: true, driverLink: false },
    eyebrow: 'Datenexport',
    subtitle: 'Datenexport sowie Ihr Konto verwalten.'
  },
  brandingOnly: {
    nav: ['dashboard', 'audit', 'einstellungen'],
    settings: { organisation: false, branding: true, export: false, users: false, roles: false, about: true, shortcuts: true, driverLink: false },
    eyebrow: 'Erscheinungsbild',
    subtitle: 'Erscheinungsbild sowie Ihr Konto verwalten.'
  },
  settingsOnly: {
    nav: ['dashboard', 'audit', 'einstellungen', 'integrationen', 'erweitert'],
    settings: { organisation: true, branding: false, export: false, users: false, roles: false, about: true, shortcuts: true, driverLink: false },
    eyebrow: 'Organisation',
    subtitle: 'Organisation sowie Ihr Konto verwalten.'
  }
};

let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let passwordHash;
let serverOutput = '';
const clients = {};

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

async function login(email) {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(csrf, 'CSRF-Token der Anmeldeseite fehlt');
  const firstCookie = extractCookie(page);
  assert.ok(firstCookie, 'Session-Cookie der Anmeldeseite fehlt');
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body: new URLSearchParams({ _csrf: csrf, email, password: TEST_PASSWORD })
  });
  assert.equal(response.status, 303, `Anmeldung für ${email} fehlgeschlagen`);
  const cookie = extractCookie(response) || firstCookie;
  const sessionResponse = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  const stateResponse = await fetch(`${baseUrl}/api/state`, { headers: { cookie } });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  const appResponse = await fetch(`${baseUrl}/`, { headers: { cookie } });
  assert.equal(appResponse.status, 200);
  return { cookie, csrf: session.csrfToken, session, state, html: await appResponse.text() };
}

async function apiJson(key, method, endpoint, body) {
  const client = clients[key];
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers: {
      cookie: client.cookie,
      'x-csrf-token': client.csrf,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
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
  `).run(id, name, JSON.stringify(normalizePermissions(permissions)), rank, now, now);
}

function insertUser(id, name, email, role) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, email, name, passwordHash, role, now, now);
}

function insertLinkedDriver(id, name, userId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, user_id, own_trips_access, created_at, updated_at)
    VALUES (?, ?, 'Mitarbeiter:in', 'Test', '', ?, '["B"]', 'available', '#2563eb', ?, 1, ?, ?)
  `).run(id, name, `${id}@example.invalid`, userId, now, now);
}

function insertFreeDriver(id, name) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, user_id, own_trips_access, created_at, updated_at)
    VALUES (?, ?, 'Mitarbeiter:in', 'Test', '', ?, '["B"]', 'available', '#2563eb', NULL, 1, ?, ?)
  `).run(id, name, `${id}@example.invalid`, now, now);
}

function classList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) {
      return values.has(name);
    }
  };
}

function makeElement() {
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    scrollTop: 0,
    dataset: {},
    attributes: {},
    style: { setProperty() {} },
    classList: classList(),
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function createClientHarness() {
  const navItems = ALL_NAV_ROUTES.map((route) => {
    const element = makeElement();
    element.dataset.route = route;
    return element;
  });
  const groups = NAV_GROUPS.map((routes) => {
    const group = makeElement();
    const items = routes.map((route) => navItems.find((item) => item.dataset.route === route));
    group.querySelectorAll = (selector) => selector === '.nav-item' ? items : [];
    return { element: group, items };
  });
  const genericElements = new Map();
  const getGeneric = (selector) => {
    if (!genericElements.has(selector)) genericElements.set(selector, makeElement());
    return genericElements.get(selector);
  };
  const body = makeElement();
  const domErrors = [];
  const context = vm.createContext({
    document: {
      body,
      addEventListener() {},
      querySelector(selector) {
        return getGeneric(selector);
      },
      querySelectorAll(selector) {
        if (selector === '.nav-item') return navItems;
        if (selector === '.nav-group') return groups.map((group) => group.element);
        return [];
      }
    },
    console: {
      ...console,
      error: (...args) => domErrors.push(args)
    },
    window: {},
    location: { hash: '#/dashboard' },
    history: { replaceState() {} },
    setTimeout,
    clearTimeout
  });
  const source = [
    fs.readFileSync(path.join(ROOT, 'public', 'data.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'public', 'views.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8')
  ].join('\n');
  vm.runInContext(source, context, { filename: 'client-bundle.js' });
  return { context, navItems, groups, getGeneric, body, domErrors };
}

function applyClientSession(harness, client) {
  vm.runInContext(`
    currentUser = ${JSON.stringify(client.session.user)};
    csrfToken = ${JSON.stringify(client.csrf || '')};
    permissions = new Set(${JSON.stringify(client.session.permissions || [])});
    permissionGroups = ${JSON.stringify(client.session.permissionGroups || [])};
    objectTypes = ${JSON.stringify(client.session.objectTypes || [])};
    capabilities = ${JSON.stringify(client.session.capabilities || {})};
    applyState(${JSON.stringify(client.state)});
  `, harness.context);
}

function visibleNavRoutes(harness) {
  return harness.navItems.filter((item) => !item.hidden).map((item) => item.dataset.route);
}

function navTags(html) {
  return [...html.matchAll(/<a\b[^>]*class="[^"]*\bnav-item\b[^"]*"[^>]*>/g)].map((match) => match[0]);
}

function groupTags(html) {
  return [...html.matchAll(/<div\b[^>]*class="[^"]*\bnav-group\b[^"]*"[^>]*>/g)].map((match) => match[0]);
}

function hasHiddenAttribute(tag) {
  return /\shidden(?:\s|>)/.test(tag);
}

function settingsHtmlFor(client) {
  const harness = createClientHarness();
  applyClientSession(harness, client);
  const html = vm.runInContext('renderSettings()', harness.context);
  return { harness, html };
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awo-ui-perms-test-'));
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
      ADMIN_EMAIL: EMAILS.admin,
      ADMIN_PASSWORD: TEST_PASSWORD,
      ADMIN_NAME: 'UI-Test-Administrator',
      ORG_NAME: 'UI-Testorganisation',
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
  passwordHash = bcrypt.hashSync(TEST_PASSWORD, 10);

  insertRole('role-users-roles', 'Benutzer und Rollen', 700000, ['users_manage', 'roles_manage']);
  insertRole('role-own-trips', 'Nur eigene Fahrten', 100000, ['own_trips_view', 'own_trips_request']);
  insertRole('role-viewer', 'Nur Fuhrparkansicht', 100000, ['bookings_view']);
  insertRole('role-export', 'Nur Datenexport', 100000, ['export_data']);
  insertRole('role-branding', 'Nur Erscheinungsbild', 100000, ['branding_manage']);
  insertRole('role-settings', 'Nur Organisation', 100000, ['settings_manage']);

  insertUser('user-users-roles', 'Benutzer Verwaltung', EMAILS.usersRoles, 'role-users-roles');
  insertUser('user-own-trips', 'Eigene Fahrten', EMAILS.ownTrips, 'role-own-trips');
  insertUser('user-viewer', 'Nur Ansicht', EMAILS.viewer, 'role-viewer');
  insertUser('user-export', 'Nur Export', EMAILS.exportOnly, 'role-export');
  insertUser('user-branding', 'Nur Branding', EMAILS.brandingOnly, 'role-branding');
  insertUser('user-settings', 'Nur Organisation', EMAILS.settingsOnly, 'role-settings');
  insertUser('user-logout', 'Logout Test', EMAILS.logout, 'role-viewer');
  insertUser('user-manager', 'UI Fuhrparkleitung', EMAILS.manager, 'manager');
  insertLinkedDriver('driver-own-trips', 'Eigene Fahrten', 'user-own-trips');
  insertFreeDriver('driver-free', 'Freie Fahrerin');

  for (const [key, email] of Object.entries(EMAILS)) {
    if (key === 'logout') continue;
    clients[key] = await login(email);
  }
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

test('Initiales HTML versteckt alle Navigationspunkte und Gruppen, Settings-Zahnrad bleibt sichtbar', () => {
  const html = clients.viewer.html;
  const items = navTags(html);
  const groups = groupTags(html);
  assert.equal(items.length, ALL_NAV_ROUTES.length, 'Alle Navigationspunkte müssen im Template vorhanden sein');
  assert.equal(groups.length, NAV_GROUPS.length, 'Alle Navigationsgruppen müssen im Template vorhanden sein');
  items.forEach((tag) => {
    assert.ok(hasHiddenAttribute(tag), `Navigationspunkt ohne initiales hidden: ${tag}`);
  });
  groups.forEach((tag) => {
    assert.ok(hasHiddenAttribute(tag), `Navigationsgruppe ohne initiales hidden: ${tag}`);
  });
  const settingsButton = html.match(/<a\b[^>]*class="[^"]*\bsettings-btn\b[^"]*"[^>]*>/)?.[0] || '';
  assert.ok(settingsButton, 'Settings-Zahnrad fehlt im HTML');
  assert.ok(!hasHiddenAttribute(settingsButton), 'Settings-Zahnrad darf nicht versteckt sein');
});

test('Rollenmatrix blendet nach dem State-Load nur erlaubte Navigationspunkte ein', () => {
  for (const [key, expected] of Object.entries(SESSION_ROLES)) {
    const harness = createClientHarness();
    applyClientSession(harness, clients[key]);
    vm.runInContext('updateNavigationVisibility()', harness.context);
    assert.deepEqual(visibleNavRoutes(harness).sort(), [...expected.nav].sort(), `Falsche Sidebar für ${key}`);

    const expectedGroupVisibility = NAV_GROUPS.map((routes) => routes.some((route) => expected.nav.includes(route)));
    assert.deepEqual(harness.groups.map((group) => !group.element.hidden), expectedGroupVisibility, `Falsche Gruppen-Sichtbarkeit für ${key}`);

    const firstRoute = vm.runInContext('firstAllowedRoute()', harness.context);
    assert.ok(expected.nav.includes(firstRoute), `Startroute ${firstRoute} ist für ${key} nicht sichtbar`);
    vm.runInContext(`updateNavActive(${JSON.stringify(firstRoute)})`, harness.context);
    const activeRoutes = harness.navItems.filter((item) => item.classList.contains('is-active')).map((item) => item.dataset.route);
    assert.deepEqual(activeRoutes, [firstRoute], `Aktive Markierung für ${key} ist falsch`);
    assert.equal(harness.navItems.find((item) => item.dataset.route === firstRoute).attributes['aria-current'], 'page');
    assert.deepEqual(harness.domErrors, [], `Konsolenfehler im Client-Harness für ${key}`);
  }
});

test('Einstellungen zeigen nur die erlaubten Karten und keine Berechtigungshinweise', () => {
  for (const [key, expected] of Object.entries(SESSION_ROLES)) {
    const { html } = settingsHtmlFor(clients[key]);
    const settings = expected.settings;
    assert.equal(html.includes('id="settingsForm"'), settings.organisation, `Organisationsformular für ${key}`);
    assert.equal(html.includes('id="brandingForm"'), settings.branding, `Branding-Karte für ${key}`);
    assert.equal(html.includes('id="costCentersCard"'), Boolean(settings.costCenters), `Kostenstellen-Karte für ${key}`);
    assert.equal(html.includes('<h3 class="card-title">Datenexport</h3>'), settings.export, `Datenexport-Karte für ${key}`);
    assert.equal(html.includes('href="#/benutzer"'), settings.users, `Benutzerlink für ${key}`);
    assert.equal(html.includes('href="#/rollen"'), settings.roles, `Rollenlink für ${key}`);
    assert.equal(html.includes('<h3 class="card-title">Über diese Installation</h3>'), settings.about, `Installationsinfo für ${key}`);
    assert.equal(html.includes('<h3 class="card-title">Tastenkürzel</h3>'), settings.shortcuts, `Tastenkürzel für ${key}`);
    assert.equal(html.includes('<h3 class="card-title">Fahrerprofil</h3>'), settings.driverLink, `Fahrerprofilkarte für ${key}`);
    assert.equal(html.includes('id="driverLinkForm"'), settings.driverLink, `Fahrerprofilformular für ${key}`);
    if (settings.driverLink) {
      assert.ok(html.includes('Nicht verknüpft'), `Leerzustand der Fahrerprofilkarte fehlt für ${key}`);
      assert.ok(html.includes('Freie Fahrerin'), `Freie Fahrer:in fehlt in der Auswahl für ${key}`);
      assert.ok(html.includes('id="driverLinkOwnTripsAccess"'), `Standardzugriff-Checkbox fehlt für ${key}`);
      assert.ok(html.includes('Standardzugriff auf Meine Fahrten aktiv'), `Standardzugriff-Label fehlt für ${key}`);
    }
    assert.ok(html.includes('<h3 class="card-title">Ihr Konto</h3>'), `Kontokarte fehlt für ${key}`);
    assert.ok(html.includes('data-action="change-password"'), `Passwortaktion fehlt für ${key}`);
    assert.ok(html.includes('data-action="logout"'), `Abmeldeaktion fehlt für ${key}`);
    assert.ok(html.includes(`<span class="eyebrow">${expected.eyebrow}</span>`), `Seitenkopf passt nicht für ${key}`);
    assert.ok(html.includes(escapedText(expected.subtitle)), `Untertitel passt nicht für ${key}`);
    assert.ok(!html.includes('Keine Berechtigung'), `„Keine Berechtigung“ ist für ${key} noch sichtbar`);
    assert.ok(!html.includes('Nur lesend'), `„Nur lesend“ ist für ${key} noch sichtbar`);
    const settingsForm = html.match(/<form class="card settings-card" id="settingsForm">[\s\S]*?<\/form>/)?.[0] || '';
    assert.ok(!/\sdisabled(?:\s|>)/.test(settingsForm), `Deaktivierte Organisationseingaben sind für ${key} noch sichtbar`);
    const hasAdminColumn = settings.organisation || settings.branding || settings.export;
    assert.equal(html.includes('settings-grid is-single'), !hasAdminColumn, `Einspaltiges Layout für ${key}`);
  }
});

test('Admin-Fahrerprofilkarte zeigt aktuelle Verknüpfung, Status und Standardzugriff', () => {
  const client = {
    ...clients.admin,
    state: JSON.parse(JSON.stringify(clients.admin.state))
  };
  const adminId = client.session.user.id;
  const driver = client.state.drivers.find((entry) => entry.id === 'driver-free');
  assert.ok(driver, 'Freie Fahrer:in fehlt im Admin-State');
  driver.userId = adminId;
  driver.ownTripsAccess = false;
  driver.status = 'away';
  const adminUser = client.state.users.find((user) => user.id === adminId);
  adminUser.driverId = driver.id;
  adminUser.driverName = driver.name;
  adminUser.ownTripsAccess = false;

  const { html } = settingsHtmlFor(client);
  assert.ok(html.includes('Freie Fahrerin'), 'Name der aktuellen Verknüpfung fehlt');
  assert.ok(html.includes('Mitarbeiter:in'), 'Rolle der aktuellen Verknüpfung fehlt');
  assert.ok(html.includes('Abwesend'), 'Status der aktuellen Verknüpfung fehlt');
  assert.ok(html.includes(`value="${driver.id}" selected`), 'Eigene Verknüpfung ist nicht ausgewählt');
  const checkbox = html.match(/<input[^>]*id="driverLinkOwnTripsAccess"[^>]*>/)?.[0] || '';
  assert.ok(checkbox, 'Standardzugriff-Checkbox fehlt');
  assert.ok(!/\schecked(?:\s|>)/.test(checkbox), 'Standardzugriff muss den gespeicherten Wert false widerspiegeln');
});

test('Admin-Fahrerprofilkarte zeigt einen Leerzustand ohne Fahrer:innen', () => {
  const client = {
    ...clients.admin,
    state: JSON.parse(JSON.stringify(clients.admin.state))
  };
  client.state.drivers = [];
  client.state.driversForLinking = [];
  const { html } = settingsHtmlFor(client);
  assert.ok(html.includes('Noch keine Fahrer:innen'), 'Leerzustand ohne Fahrer:innen fehlt');
  assert.ok(!html.includes('id="driverLinkForm"'), 'Ohne Fahrer:innen darf kein Auswahlformular erscheinen');
});

test('Integrationsseite rendert Karten, maskiert Secrets und bleibt Berechtigten vorbehalten', () => {
  const admin = createClientHarness();
  applyClientSession(admin, clients.admin);
  const html = vm.runInContext('renderIntegrations()', admin.context);
  assert.match(html, /id="integrationSsoForm"/);
  assert.match(html, /id="webhooksCard"/);
  assert.match(html, /data-action="new-webhook"/);
  assert.match(html, /id="integrationTeamsForm"/);
  assert.match(html, /id="integrationClamavForm"/);
  assert.match(html, /id="integrationWebauthnForm"/);
  assert.match(html, /id="integrationLocationsForm"/);
  assert.match(html, /id="retentionForm"/);
  assert.match(html, /data-integration="sso"/);
  assert.match(html, /class="integration-details" hidden/);
  assert.doesNotMatch(html, /type="password"[^>]*value="[^"]+"/);
  assert.doesNotMatch(html, /localStorage/);

  const manager = createClientHarness();
  applyClientSession(manager, clients.manager);
  const managerHtml = vm.runInContext('renderIntegrations()', manager.context);
  assert.match(managerHtml, /id="integrationSsoForm"/);
  assert.doesNotMatch(managerHtml, /id="retentionForm"/);

  const settingsOnly = createClientHarness();
  applyClientSession(settingsOnly, clients.settingsOnly);
  const restricted = vm.runInContext('renderIntegrations()', settingsOnly.context);
  assert.match(restricted, /id="integrationSsoForm"/);
  assert.doesNotMatch(restricted, /id="retentionForm"/);
  assert.doesNotMatch(restricted, /id="integrationLocationsForm"/);

  const withWebhook = {
    ...clients.admin,
    state: JSON.parse(JSON.stringify(clients.admin.state))
  };
  withWebhook.state.integrations = {
    ...withWebhook.state.integrations,
    webhooks: [{
      id: 'webhook-1',
      name: 'Ops Discord',
      format: 'discord',
      events: ['leasing', 'maintenance'],
      enabled: true,
      host: 'discord.com',
      urlSet: true,
      secretSet: true
    }]
  };
  const webhookHarness = createClientHarness();
  applyClientSession(webhookHarness, withWebhook);
  const webhookHtml = vm.runInContext('renderIntegrations()', webhookHarness.context);
  assert.match(webhookHtml, /Ops Discord/);
  assert.match(webhookHtml, /discord\.com/);
  assert.match(webhookHtml, /data-action="test-webhook"/);
  assert.doesNotMatch(webhookHtml, /https:\/\/discord\.com/);
});

test('Erweitert rendert eingeklappte Karten und Systemstatus ohne Secrets', () => {
  const harness = createClientHarness();
  applyClientSession(harness, clients.admin);
  const html = vm.runInContext('renderAdvanced()', harness.context);
  assert.match(html, /id="advanced-general"/);
  assert.match(html, /id="advanced-leasing"/);
  assert.match(html, /id="advanced-reminder"/);
  assert.match(html, /id="advanced-retention"/);
  assert.match(html, /id="advanced-system"/);
  assert.match(html, /id="appBaseUrl"/);
  assert.match(html, /Systemstatus/);
  assert.doesNotMatch(html, /id="advanced-[a-z]+"[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /mfa\.key|integrations\.key/);

  const manager = createClientHarness();
  applyClientSession(manager, clients.manager);
  const managerHtml = vm.runInContext('renderAdvanced()', manager.context);
  assert.match(managerHtml, /id="advanced-general"/);

  const settingsOnly = createClientHarness();
  applyClientSession(settingsOnly, clients.settingsOnly);
  const restricted = vm.runInContext('renderAdvanced()', settingsOnly.context);
  assert.match(restricted, /id="advanced-general"/);
});

test('Mobile-Sidebar öffnet und schließt weiterhin korrekt', () => {
  const harness = createClientHarness();
  applyClientSession(harness, clients.viewer);
  vm.runInContext('openSidebar()', harness.context);
  assert.ok(harness.getGeneric('#sidebar').classList.contains('is-open'));
  assert.equal(harness.getGeneric('#sidebarScrim').hidden, false);
  assert.ok(harness.body.classList.contains('nav-open'));
  assert.equal(harness.getGeneric('#menuBtn').attributes['aria-expanded'], 'true');

  vm.runInContext('closeSidebar()', harness.context);
  assert.ok(!harness.getGeneric('#sidebar').classList.contains('is-open'));
  assert.equal(harness.getGeneric('#sidebarScrim').hidden, true);
  assert.ok(!harness.body.classList.contains('nav-open'));
  assert.equal(harness.getGeneric('#menuBtn').attributes['aria-expanded'], 'false');
});

test('Berechtigte können Einstellungen speichern, Unberechtigte erhalten serverseitig 403', async () => {
  const saved = await apiJson('manager', 'PATCH', '/api/settings', {
    orgName: 'UI-Testorganisation aktualisiert',
    location: 'Teststandort',
    phone: '',
    email: 'ui@example.invalid'
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.orgName, 'UI-Testorganisation aktualisiert');

  const denied = await apiJson('viewer', 'PATCH', '/api/settings', {
    orgName: 'Nicht erlaubt',
    location: 'Teststandort',
    phone: '',
    email: ''
  });
  assert.equal(denied.status, 403);
});

test('Login und Logout funktionieren ohne Regression', async () => {
  const client = await login(EMAILS.logout);
  const sessionResponse = await fetch(`${baseUrl}/api/session`, { headers: { cookie: client.cookie } });
  assert.equal(sessionResponse.status, 200);

  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: client.cookie,
      'x-csrf-token': client.csrf
    }
  });
  assert.equal(response.status, 204);

  const afterLogout = await fetch(`${baseUrl}/api/session`, { headers: { cookie: client.cookie } });
  assert.equal(afterLogout.status, 401);
});

function escapedText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
