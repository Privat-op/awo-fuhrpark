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
const bcrypt = require('bcryptjs');

const { getSsoConfig } = require('../server/lib/sso');

const ROOT = path.join(__dirname, '..');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const TEST_PASSWORD = 'Sso-Test-2026!';
const ADMIN_EMAIL = 'sso-admin@example.invalid';
const ADMIN_PASSWORD = 'Sso-Admin-2026!';
const CLIENT_ID = 'awo-fuhrpark-test-client';
const CLIENT_SECRET = 'sso-test-client-secret';
const EXISTING_EMAIL = 'sso-existing@example.invalid';
const INACTIVE_EMAIL = 'sso-inactive@example.invalid';
const ANONYMIZED_EMAIL = 'sso-anonymized@example.invalid';

let tempDir;
let dbPath;
let child;
let baseUrl;
let mockServer;
let mockIssuer;
let db;
let serverOutput = '';
const provider = {
  privateKey: null,
  publicJwk: null,
  code: '',
  nonce: '',
  expectedChallenge: '',
  claims: {},
  badSignature: false,
  tokenCalls: 0
};

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

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signIdToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key' };
  const payload = {
    iss: mockIssuer,
    aud: CLIENT_ID,
    sub: 'sso-subject-default',
    email: EXISTING_EMAIL,
    email_verified: true,
    name: 'SSO Test',
    nonce: provider.nonce,
    iat: now,
    exp: now + 300,
    ...provider.claims
  };
  const input = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = provider.badSignature
    ? Buffer.from('invalid-signature').toString('base64url')
    : crypto.sign('RSA-SHA256', Buffer.from(input, 'utf8'), provider.privateKey).toString('base64url');
  return `${input}.${signature}`;
}

function jsonResponse(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function startMockProvider() {
  const port = await freePort();
  mockIssuer = `http://127.0.0.1:${port}`;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  provider.privateKey = privateKey;
  provider.publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  mockServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, mockIssuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      return jsonResponse(res, 200, {
        issuer: mockIssuer,
        authorization_endpoint: `${mockIssuer}/authorize`,
        token_endpoint: `${mockIssuer}/token`,
        jwks_uri: `${mockIssuer}/jwks`
      });
    }
    if (url.pathname === '/jwks') return jsonResponse(res, 200, { keys: [provider.publicJwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      provider.tokenCalls += 1;
      const body = new URLSearchParams(await readBody(req));
      if (body.get('client_id') !== CLIENT_ID || body.get('client_secret') !== CLIENT_SECRET) {
        return jsonResponse(res, 400, { error: 'invalid_client' });
      }
      if (body.get('code') !== provider.code) return jsonResponse(res, 400, { error: 'invalid_grant' });
      if (!provider.expectedChallenge
        || crypto.createHash('sha256').update(String(body.get('code_verifier') || ''), 'utf8').digest('base64url') !== provider.expectedChallenge) {
        return jsonResponse(res, 400, { error: 'invalid_grant', error_description: 'pkce' });
      }
      return jsonResponse(res, 200, { id_token: signIdToken(), token_type: 'Bearer', expires_in: 300 });
    }
    return jsonResponse(res, 404, { error: 'not_found' });
  });
  await new Promise((resolve) => mockServer.listen(port, '127.0.0.1', resolve));
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

function insertUser(id, email, role = 'manager', { active = 1, anonymizedAt = null } = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, anonymized_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, id, bcrypt.hashSync(TEST_PASSWORD, 4), role, active, anonymizedAt, now, now);
}

async function beginSso() {
  const response = await fetch(`${baseUrl}/auth/sso/start`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const cookie = extractCookie(response);
  assert.ok(cookie);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(location.searchParams.get('scope'), 'openid profile email');
  provider.nonce = location.searchParams.get('nonce');
  provider.expectedChallenge = location.searchParams.get('code_challenge');
  provider.code = `code-${crypto.randomUUID()}`;
  return { cookie, state: location.searchParams.get('state') };
}

async function callback(flow, { code = provider.code, state = flow.state } = {}) {
  const response = await fetch(`${baseUrl}/auth/sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {
    headers: { cookie: flow.cookie },
    redirect: 'manual'
  });
  return { response, cookie: extractCookie(response) || flow.cookie, text: await response.text() };
}

async function sessionFor(cookie) {
  const response = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  return { status: response.status, data: response.status === 200 ? await response.json() : null };
}

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-sso-'));
  dbPath = path.join(tempDir, 'test.sqlite');
  await startMockProvider();
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
      ADMIN_NAME: 'SSO Admin',
      ORG_NAME: 'SSO-Testorganisation',
      SSO_ENABLED: '1',
      SSO_ISSUER: mockIssuer,
      SSO_CLIENT_ID: CLIENT_ID,
      SSO_CLIENT_SECRET: CLIENT_SECRET,
      SSO_REDIRECT_URI: `${baseUrl}/auth/sso/callback`,
      SSO_SCOPES: 'openid profile email',
      SSO_ALLOWED_DOMAINS: 'example.invalid',
      SSO_AUTO_PROVISION: 'true',
      SSO_DEFAULT_ROLE: 'user',
      SSO_GROUP_CLAIM: 'groups',
      SSO_ADMIN_GROUP: 'admin-group',
      SSO_MANAGER_GROUP: 'manager-group',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '0',
      LEASING_SCHEDULER_DISABLED: 'true',
      REMINDER_SCHEDULER_DISABLED: 'true',
      TZ: 'Europe/Berlin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
  db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  insertUser('sso-existing', EXISTING_EMAIL);
  insertUser('sso-inactive', INACTIVE_EMAIL, 'manager', { active: 0 });
  insertUser('sso-anonymized', ANONYMIZED_EMAIL, 'manager', { anonymizedAt: '2026-01-01T00:00:00.000Z' });
});

after(async () => {
  try { db?.close(); } catch { /* ignore */ }
  if (child) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
  }
  if (mockServer) await new Promise((resolve) => mockServer.close(resolve));
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('SSO ist standardmäßig deaktiviert', () => {
  const saved = {
    enabled: process.env.SSO_ENABLED,
    issuer: process.env.SSO_ISSUER,
    client: process.env.SSO_CLIENT_ID,
    redirect: process.env.SSO_REDIRECT_URI
  };
  delete process.env.SSO_ENABLED;
  delete process.env.SSO_ISSUER;
  delete process.env.SSO_CLIENT_ID;
  delete process.env.SSO_REDIRECT_URI;
  const config = getSsoConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) continue;
    process.env[`SSO_${key.toUpperCase().replace('CLIENT', 'CLIENT_ID').replace('REDIRECT', 'REDIRECT_URI')}`] = value;
  }
  process.env.SSO_ENABLED = saved.enabled || '';
  process.env.SSO_ISSUER = saved.issuer || '';
  process.env.SSO_CLIENT_ID = saved.client || '';
  process.env.SSO_REDIRECT_URI = saved.redirect || '';
});

test('Bestehende Nutzer werden per E-Mail verknüpft und die Session regeneriert', async () => {
  provider.claims = {
    sub: 'subject-existing',
    email: EXISTING_EMAIL,
    email_verified: true,
    name: 'Existing User',
    groups: []
  };
  const flow = await beginSso();
  const result = await callback(flow);
  assert.equal(result.response.status, 303);
  assert.equal(result.response.headers.get('location'), '/');
  assert.notEqual(result.cookie, flow.cookie);
  const session = await sessionFor(result.cookie);
  assert.equal(session.status, 200);
  assert.equal(session.data.user.id, 'sso-existing');
  const link = db.prepare("SELECT * FROM user_sso WHERE user_id = 'sso-existing'").get();
  assert.equal(link.subject, 'subject-existing');
  assert.equal(link.email, EXISTING_EMAIL);
  const audit = db.prepare("SELECT details FROM audit_logs WHERE action = 'sso_login' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(audit);
  assert.equal(String(audit.details).includes(CLIENT_SECRET), false);
  assert.equal(String(audit.details).includes(provider.nonce), false);
});

test('JIT-Provisioning legt ein Konto mit Default-Rolle an', async () => {
  const email = 'sso-jit@example.invalid';
  provider.claims = {
    sub: 'subject-jit',
    email,
    email_verified: true,
    name: 'JIT User',
    groups: []
  };
  const flow = await beginSso();
  const result = await callback(flow);
  assert.equal(result.response.status, 303);
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
  assert.ok(user);
  assert.equal(user.role, 'user');
  assert.equal(user.active, 1);
  assert.ok(db.prepare("SELECT 1 FROM user_sso WHERE user_id = ? AND subject = 'subject-jit'").get(user.id));
  const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(user.id);
  assert.ok(driver);
  assert.equal(driver.email, email);
  assert.equal(driver.name, 'JIT User');
  assert.equal(driver.own_trips_access, 1);
  const provisionAudit = db.prepare("SELECT details FROM audit_logs WHERE action = 'sso_provision' AND entity_id = ?").get(user.id);
  assert.ok(provisionAudit);
  assert.match(provisionAudit.details, /"driverCreated":true/);
});

test('Gruppenmapping hebt bestehende Nutzer auf Admin, nie auf Superadmin', async () => {
  const user = db.prepare("SELECT * FROM users WHERE id = 'sso-existing'").get();
  assert.equal(user.role, 'manager');
  provider.claims = {
    sub: 'subject-existing',
    email: EXISTING_EMAIL,
    email_verified: true,
    name: 'Existing User',
    groups: ['admin-group']
  };
  const flow = await beginSso();
  const result = await callback(flow);
  assert.equal(result.response.status, 303);
  assert.equal(db.prepare("SELECT role FROM users WHERE id = 'sso-existing'").get().role, 'admin');
  assert.notEqual(db.prepare("SELECT role FROM users WHERE id = 'sso-existing'").get().role, 'superadmin');
});

test('Unverified E-Mail, Domain, Nonce, Audience, Ablauf und Signatur werden abgelehnt', async () => {
  const cases = [
    { name: 'unverified', claims: { sub: 'bad-verified', email: EXISTING_EMAIL, email_verified: false } },
    { name: 'domain', claims: { sub: 'bad-domain', email: 'user@evil.example', email_verified: true } },
    { name: 'nonce', claims: { sub: 'bad-nonce', email: EXISTING_EMAIL, email_verified: true, nonce: 'wrong-nonce' } },
    { name: 'audience', claims: { sub: 'bad-aud', email: EXISTING_EMAIL, email_verified: true, aud: 'wrong-client' } },
    { name: 'expired', claims: { sub: 'bad-exp', email: EXISTING_EMAIL, email_verified: true, exp: 1 } }
  ];
  for (const entry of cases) {
    provider.claims = entry.claims;
    const flow = await beginSso();
    const result = await callback(flow);
    assert.equal(result.response.status, 401, `${entry.name}: ${result.text}`);
    assert.match(result.text, /SSO-Anmeldung ist fehlgeschlagen/);
  }
  provider.claims = { sub: 'bad-signature', email: EXISTING_EMAIL, email_verified: true };
  const flow = await beginSso();
  provider.badSignature = true;
  const signature = await callback(flow);
  assert.equal(signature.response.status, 401);
  provider.badSignature = false;
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'sso_failed'").get());
});

test('State ist einmalig, Replay und falscher State werden abgelehnt', async () => {
  provider.claims = { sub: 'subject-state', email: EXISTING_EMAIL, email_verified: true };
  const flow = await beginSso();
  const wrong = await callback(flow, { state: 'wrong-state' });
  assert.equal(wrong.response.status, 401);
  const replay = await callback(flow);
  assert.equal(replay.response.status, 401);
});

test('Inaktive, anonymisierte und Superadmin-Konten werden abgelehnt', async () => {
  const superadmin = db.prepare("SELECT id FROM users WHERE id = 'superadmin'").get();
  if (!superadmin) {
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES ('superadmin', 'sso-superadmin@example.invalid', 'Superadmin', 'x', 'superadmin', 1, '2026-01-01', '2026-01-01')
    `).run();
  }
  for (const [email, sub] of [
    [INACTIVE_EMAIL, 'inactive'],
    [ANONYMIZED_EMAIL, 'anonymized'],
    ['sso-superadmin@example.invalid', 'superadmin']
  ]) {
    provider.claims = { sub, email, email_verified: true };
    const flow = await beginSso();
    const result = await callback(flow);
    assert.equal(result.response.status, 401, `${email}: ${result.text}`);
  }
});

test('Lokaler Login bleibt Fallback und Loginseite zeigt SSO nur bei Aktivierung', async () => {
  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  const html = await page.text();
  assert.match(html, /Mit Microsoft anmelden/);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  const firstCookie = extractCookie(page);
  const login = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body: new URLSearchParams({ _csrf: csrf, email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.equal(login.status, 303);
  const session = await sessionFor(extractCookie(login) || firstCookie);
  assert.equal(session.status, 200);
});
