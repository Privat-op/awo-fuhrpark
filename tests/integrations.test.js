'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const {
  INTEGRATIONS_SCHEMA_VERSION,
  migrateIntegrationsSchema
} = require('../server/lib/integrations-schema');
const {
  safeIntegrationsConfig,
  updateIntegrations,
  getSsoIntegrationConfig,
  getTeamsIntegrationConfig,
  getClamavIntegrationConfig,
  getWebAuthnIntegrationConfig,
  getLocationsIntegrationConfig,
  validHttpUrl,
  webAuthnValid
} = require('../server/lib/integrations');
const { getIntegrationsKey, KEY_FILE } = require('../server/lib/integrations-crypto');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const ADMIN_EMAIL = 'integrations-admin@example.invalid';
const ADMIN_PASSWORD = 'Integrations-Admin-2026!';
const WEBHOOK_SECRET = 'https://teams.example.invalid/webhook/secret-hook-token-123456';
const WEBHOOK_PATH = '/webhook/secret-hook-token-123456';

let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let serverOutput = '';
let mockHttp;
let mockHttpUrl;
let mockClamd;
let mockClamdPort;
const mockClamdSockets = new Set();
const teamsRequests = [];

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

function createDb() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA);
  return database;
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
  throw new Error(`Testserver nicht erreichbar. ${serverOutput.slice(-1500)}`);
}

function extractCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of values) {
    const match = /(?:^|,\s*)(awo\.sid=[^;]+)/.exec(header);
    if (match) return match[1];
  }
  return null;
}

function csrfFrom(html) {
  return /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
}

async function login(email, password) {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  const html = await page.text();
  const firstCookie = extractCookie(page);
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: firstCookie },
    body: new URLSearchParams({ _csrf: csrfFrom(html), email, password })
  });
  const cookie = extractCookie(response) || firstCookie;
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  const data = session.status === 200 ? await session.json() : null;
  return { status: response.status, cookie, csrf: data?.csrfToken || '', data };
}

async function apiJson(client, method, endpoint, body) {
  const headers = { cookie: client.cookie };
  if (client.csrf) headers['x-csrf-token'] = client.csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    redirect: 'manual',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, data, text };
}

function startMockHttp() {
  return new Promise((resolve) => {
    mockHttp = http.createServer((req, res) => {
      const url = new URL(req.url, mockHttpUrl || 'http://127.0.0.1');
      if (url.pathname === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          issuer: mockHttpUrl,
          authorization_endpoint: `${mockHttpUrl}/authorize`,
          token_endpoint: `${mockHttpUrl}/token`,
          jwks_uri: `${mockHttpUrl}/jwks`
        }));
        return;
      }
      if (url.pathname === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [{ kid: 'test-key' }] }));
        return;
      }
      if (url.pathname === WEBHOOK_PATH && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
          teamsRequests.push(body);
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('1');
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    mockHttp.listen(0, '127.0.0.1', () => {
      mockHttpUrl = `http://127.0.0.1:${mockHttp.address().port}`;
      resolve();
    });
  });
}

function startMockClamd() {
  return new Promise((resolve) => {
    mockClamd = net.createServer((socket) => {
      mockClamdSockets.add(socket);
      socket.on('close', () => mockClamdSockets.delete(socket));
      socket.on('error', () => {});
      socket.on('data', () => {
        if (!socket.destroyed) socket.write('stream: OK\0');
      });
    });
    mockClamd.listen(0, '127.0.0.1', () => {
      mockClamdPort = mockClamd.address().port;
      resolve();
    });
  });
}

test('Migration 13→14 ist idempotent, legt Tabelle und eine Zeile an', () => {
  const database = createDb();
  try {
    database.pragma('user_version = 13');
    assert.equal(migrateIntegrationsSchema(database), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), INTEGRATIONS_SCHEMA_VERSION);
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'integration_settings'").get());
    const row = database.prepare('SELECT * FROM integration_settings WHERE id = 1').get();
    assert.ok(row);
    assert.equal(row.sso_enabled, 0);
    assert.equal(row.teams_enabled, 0);
    assert.equal(row.clamav_enabled, 0);
    assert.equal(row.locations_enabled, 0);
    assert.equal(migrateIntegrationsSchema(database), false);
  } finally {
    database.close();
  }
});

test('Defaults sind aus und ENV hat Vorrang vor der Datenbank', () => {
  const database = createDb();
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-integrations-unit-'));
  try {
    migrateIntegrationsSchema(database);
    database.prepare(`UPDATE integration_settings SET
      sso_enabled = 1, sso_issuer = 'https://db.example.invalid', sso_client_id = 'db-client',
      sso_redirect_uri = 'https://app.example.invalid/callback',
      teams_enabled = 1, clamav_enabled = 1, locations_enabled = 1
      WHERE id = 1`).run();

    const safe = safeIntegrationsConfig(database, { dataDir });
    assert.equal(safe.sso.issuer, 'https://db.example.invalid');
    assert.equal(safe.locations.enabled, true);
    assert.equal(safe.teams.webhookSet, false);
    assert.equal(Object.prototype.hasOwnProperty.call(safe.teams, 'webhookUrl'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(safe.sso, 'clientSecret'), false);

    process.env.SSO_ISSUER = 'https://env.example.invalid';
    process.env.SSO_CLIENT_ID = 'env-client';
    process.env.LOCATIONS_ENABLED = 'false';
    try {
      const config = getSsoIntegrationConfig(database, { dataDir });
      assert.equal(config.issuer, 'https://env.example.invalid');
      assert.equal(config.clientId, 'env-client');
      assert.equal(config.envLocked.issuer, true);
      assert.equal(config.envLocked.clientId, true);
      assert.equal(getLocationsIntegrationConfig(database).enabled, false);
      assert.equal(getLocationsIntegrationConfig(database).envLocked.enabled, true);

      database.prepare("UPDATE integration_settings SET sso_issuer = 'https://ignored.invalid' WHERE id = 1").run();
      assert.equal(getSsoIntegrationConfig(database, { dataDir }).issuer, 'https://env.example.invalid');
    } finally {
      delete process.env.SSO_ISSUER;
      delete process.env.SSO_CLIENT_ID;
      delete process.env.LOCATIONS_ENABLED;
    }
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Secrets werden verschlüsselt gespeichert, maskiert und nicht geloggt', () => {
  const database = createDb();
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-integrations-secret-'));
  try {
    migrateIntegrationsSchema(database);
    const result = updateIntegrations(database, {
      ssoEnabled: true,
      ssoIssuer: 'https://idp.example.invalid',
      ssoClientId: 'client-id',
      ssoRedirectUri: 'https://app.example.invalid/auth/sso/callback',
      ssoClientSecret: 'super-secret-client-value',
      teamsEnabled: true,
      teamsWebhookUrl: WEBHOOK_SECRET
    }, { dataDir });

    const row = database.prepare('SELECT * FROM integration_settings WHERE id = 1').get();
    assert.ok(row.sso_client_secret_enc.startsWith('v1.'));
    assert.ok(row.teams_webhook_enc.startsWith('v1.'));
    assert.doesNotMatch(row.sso_client_secret_enc, /super-secret-client-value/);
    assert.doesNotMatch(row.teams_webhook_enc, /secret-hook-token/);
    assert.equal(result.config.sso.clientSecretSet, true);
    assert.equal(result.config.teams.webhookSet, true);
    assert.equal(result.config.teams.configured, true);
    assert.equal(getSsoIntegrationConfig(database, { dataDir }).clientSecret, 'super-secret-client-value');
    assert.equal(getTeamsIntegrationConfig(database, { dataDir }).webhookUrl, WEBHOOK_SECRET);
    assert.ok(fs.existsSync(path.join(dataDir, KEY_FILE)));

    const json = JSON.stringify(result.config);
    assert.doesNotMatch(json, /super-secret-client-value/);
    assert.doesNotMatch(json, /secret-hook-token/);

    const cleared = updateIntegrations(database, { clearTeamsWebhook: true }, { dataDir });
    assert.equal(cleared.config.teams.webhookSet, false);
    assert.equal(cleared.config.teams.enabled, false);
    assert.equal(database.prepare('SELECT teams_webhook_enc FROM integration_settings WHERE id = 1').get().teams_webhook_enc, null);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Validierung lehnt ungültige und unvollständige Konfigurationen ab', () => {
  const database = createDb();
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-integrations-valid-'));
  try {
    migrateIntegrationsSchema(database);
    assert.throws(() => updateIntegrations(database, {
      ssoEnabled: true,
      ssoIssuer: 'ftp://invalid.example',
      ssoClientId: 'client',
      ssoRedirectUri: 'https://app.example.invalid/callback'
    }, { dataDir }), /SSO-Issuer/);
    assert.throws(() => updateIntegrations(database, { teamsEnabled: true }, { dataDir }), /Teams-Webhook/);
    assert.throws(() => updateIntegrations(database, {
      clamavEnabled: true,
      clamavPort: 70000
    }, { dataDir }), /ClamAV-Port/);
    assert.throws(() => updateIntegrations(database, {
      webauthnRpId: 'example.invalid',
      webauthnRpName: 'AWO',
      webauthnOrigin: 'https://other.invalid'
    }, { dataDir }), /WebAuthn-Origin/);
    const row = database.prepare('SELECT * FROM integration_settings WHERE id = 1').get();
    assert.equal(row.sso_enabled, 0);
    assert.equal(row.teams_enabled, 0);
    assert.equal(row.clamav_enabled, 0);

    const accepted = updateIntegrations(database, {
      webauthnRpId: 'example.invalid',
      webauthnRpName: 'AWO Fuhrpark',
      webauthnOrigin: 'https://example.invalid, https://sub.example.invalid'
    }, { dataDir });
    assert.equal(accepted.config.webauthn.enabled, true);
    assert.equal(getWebAuthnIntegrationConfig(database).origins.length, 2);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('URL- und WebAuthn-Helfer validieren strikt', () => {
  assert.equal(validHttpUrl('https://example.invalid/path?x=1'), true);
  assert.equal(validHttpUrl('http://localhost:3000'), true);
  assert.equal(validHttpUrl('ftp://example.invalid'), false);
  assert.equal(validHttpUrl('https://user:pass@example.invalid'), false);
  assert.equal(webAuthnValid('example.invalid', 'https://example.invalid'), true);
  assert.equal(webAuthnValid('example.invalid', 'https://sub.example.invalid,https://example.invalid'), true);
  assert.equal(webAuthnValid('example.invalid', 'https://other.invalid'), false);
});

test('Ein Schlüssel wird deterministisch erzeugt und wiederverwendet', () => {
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-integrations-key-'));
  try {
    const first = getIntegrationsKey(dataDir);
    assert.equal(first.length, 32);
    assert.ok(fs.existsSync(path.join(dataDir, KEY_FILE)));
    const second = getIntegrationsKey(dataDir);
    assert.deepEqual(second, first);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  await startMockHttp();
  await startMockClamd();
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-integrations-api-'));
  dbPath = path.join(tempDir, 'test.sqlite');
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
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ADMIN_NAME: 'Integrations Admin',
      ORG_NAME: 'Integrations-Test',
      LOCATIONS_ENABLED: 'false',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      LEASING_SCHEDULER_DISABLED: 'true',
      REMINDER_SCHEDULER_DISABLED: 'true',
      RETENTION_SCHEDULER_DISABLED: 'true',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
});

after(async () => {
  try { db?.close(); } catch { /* ignore */ }
  if (child) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
  }
  await Promise.all([
    new Promise((resolve) => mockHttp?.close(resolve)),
    new Promise((resolve) => {
      for (const socket of mockClamdSockets) socket.destroy();
      mockClamd?.close(resolve);
      setTimeout(resolve, 500).unref?.();
    })
  ]);
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('API: Status, ENV-Sperre, Secret-Maskierung und Audit ohne Secrets', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(admin.status, 303);
  const client = admin;

  const initial = await apiJson(client, 'GET', '/api/integrations');
  assert.equal(initial.status, 200, initial.text);
  assert.equal(initial.data.integrations.locations.enabled, false);
  assert.equal(initial.data.integrations.locations.envLocked.enabled, true);
  assert.equal(initial.data.integrations.sso.enabled, false);

  const locked = await apiJson(client, 'PATCH', '/api/integrations', { locationsEnabled: true });
  assert.equal(locked.status, 200, locked.text);
  assert.equal(locked.data.integrations.locations.enabled, false);

  const sso = await apiJson(client, 'PATCH', '/api/integrations', {
    ssoEnabled: true,
    ssoIssuer: mockHttpUrl,
    ssoClientId: 'api-client',
    ssoRedirectUri: 'https://app.example.invalid/auth/sso/callback',
    ssoScopes: 'openid profile email',
    ssoDefaultRole: 'user',
    ssoClientSecret: 'api-client-secret-value'
  });
  assert.equal(sso.status, 200, sso.text);
  assert.equal(sso.data.integrations.sso.configured, true);
  assert.equal(sso.data.integrations.sso.clientSecretSet, true);
  assert.doesNotMatch(sso.text, /api-client-secret-value/);

  const teams = await apiJson(client, 'PATCH', '/api/integrations', {
    teamsEnabled: true,
    teamsWebhookUrl: `${mockHttpUrl}${WEBHOOK_PATH}`,
    teamsSendLeasing: false,
    teamsSendBookingRequests: true,
    teamsSendMaintenance: true
  });
  assert.equal(teams.status, 200, teams.text);
  assert.equal(teams.data.integrations.teams.webhookSet, true);
  assert.equal(teams.data.integrations.teams.sendLeasing, false);
  assert.doesNotMatch(teams.text, /secret-hook-token/);

  const state = await apiJson(client, 'GET', '/api/state');
  assert.equal(state.status, 200);
  assert.doesNotMatch(state.text, /secret-hook-token/);
  assert.doesNotMatch(state.text, /api-client-secret-value/);
  assert.equal(state.data.integrations.teams.webhookSet, true);

  const row = db.prepare('SELECT teams_webhook_enc, sso_client_secret_enc FROM integration_settings WHERE id = 1').get();
  assert.ok(row.teams_webhook_enc.startsWith('v1.'));
  assert.ok(row.sso_client_secret_enc.startsWith('v1.'));
  assert.doesNotMatch(row.teams_webhook_enc, /secret-hook-token/);

  const audits = db.prepare("SELECT details FROM audit_logs WHERE entity_type = 'integrations'").all();
  assert.ok(audits.length > 0);
  for (const entry of audits) {
    assert.doesNotMatch(entry.details || '', /secret-hook-token/);
    assert.doesNotMatch(entry.details || '', /api-client-secret-value/);
  }
  assert.ok(fs.existsSync(path.join(tempDir, KEY_FILE)));
});

test('API: SSO-Discovery, Teams-Testkarte, ClamAV-Testscan und WebAuthn-Prüfung', async () => {
  const client = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const ssoTest = await apiJson(client, 'POST', '/api/integrations/test/sso');
  assert.equal(ssoTest.status, 200, ssoTest.text);
  assert.equal(ssoTest.data.ok, true);
  assert.equal(ssoTest.data.endpoints.jwks, `${mockHttpUrl}/jwks`);

  const teamsTest = await apiJson(client, 'POST', '/api/integrations/test/teams');
  assert.equal(teamsTest.status, 200, teamsTest.text);
  assert.equal(teamsTest.data.ok, true);
  assert.equal(teamsRequests.length, 1);
  assert.match(teamsRequests[0], /Testnachricht/);

  const clamav = await apiJson(client, 'PATCH', '/api/integrations', {
    clamavEnabled: true,
    clamavHost: '127.0.0.1',
    clamavPort: mockClamdPort,
    clamavFailClosed: true
  });
  assert.equal(clamav.status, 200, clamav.text);
  const clamavTest = await apiJson(client, 'POST', '/api/integrations/test/clamav');
  assert.equal(clamavTest.status, 200, clamavTest.text);
  assert.equal(clamavTest.data.scanned, true);

  const webauthn = await apiJson(client, 'PATCH', '/api/integrations', {
    webauthnRpId: 'example.invalid',
    webauthnRpName: 'AWO Fuhrpark',
    webauthnOrigin: 'https://example.invalid'
  });
  assert.equal(webauthn.status, 200, webauthn.text);
  const webauthnTest = await apiJson(client, 'POST', '/api/integrations/test/webauthn');
  assert.equal(webauthnTest.status, 200, webauthnTest.text);
  assert.deepEqual(webauthnTest.data.origins, ['https://example.invalid']);

  const invalid = await apiJson(client, 'PATCH', '/api/integrations', {
    webauthnOrigin: 'https://other.invalid'
  });
  assert.equal(invalid.status, 400);
});

test('API: Secret entfernen und unvollständige Aktivierung ablehnen', async () => {
  const client = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const disabled = await apiJson(client, 'PATCH', '/api/integrations', { teamsEnabled: false });
  assert.equal(disabled.status, 200, disabled.text);
  const cleared = await apiJson(client, 'PATCH', '/api/integrations', { clearTeamsWebhook: true });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.data.integrations.teams.webhookSet, false);

  const rejected = await apiJson(client, 'PATCH', '/api/integrations', { teamsEnabled: true });
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /Webhook/);
});

test('API: Nicht angemeldete erhalten 401', async () => {
  const anonymous = await fetch(`${baseUrl}/api/integrations`);
  assert.equal(anonymous.status, 401);
});
