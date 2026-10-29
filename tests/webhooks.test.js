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

const { WEBHOOKS_SCHEMA_VERSION, migrateWebhooksSchema } = require('../server/lib/webhook-schema');
const {
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhooksSafe,
  getWebhookRow,
  dispatchWebhooks,
  deliverWebhook,
  testWebhook,
  buildWebhookPayload,
  signatureFor,
  validateWebhookTarget,
  isPrivateAddress,
  errorCodeFor,
  WebhookError,
  WEBHOOK_FORMATS,
  DISCORD_MAX_LENGTH
} = require('../server/lib/webhooks');
const { encryptIntegrationSecret, decryptIntegrationSecret } = require('../server/lib/integrations-crypto');

const ROOT = path.join(__dirname, '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const ADMIN_EMAIL = 'webhook-admin@example.invalid';
const ADMIN_PASSWORD = 'Webhook-Admin-2026!';
const PUBLIC_LOOKUP = async () => [{ address: '93.184.216.34', family: 4 }];

let unitDir;
let tempDir;
let dbPath;
let child;
let baseUrl;
let db;
let serverOutput = '';
let mockServer;
let mockUrl;
let mockPort;
const received = [];

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

function fakeResponse({ status = 200, ok = true, headers = {} } = {}) {
  return {
    status,
    ok,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    body: null
  };
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
  return { status: response.status, cookie, csrf: data?.csrfToken || '' };
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

function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => {
        received.push({ url: req.url, headers: req.headers, body });
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/hook' });
          res.end();
          return;
        }
        if (req.url === '/fail') {
          res.writeHead(500);
          res.end('error');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      mockUrl = `http://127.0.0.1:${mockPort}`;
      resolve();
    });
  });
}

test('Migration 15→16 ist idempotent und übernimmt den Discord-Webhook als Discord', () => {
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-webhook-migration-'));
  const database = createDb();
  try {
    database.pragma('user_version = 15');
    const secret = encryptIntegrationSecret('https://discord.com/api/webhooks/123/token-abc', 'teams_webhook_url', { dataDir });
    database.prepare(`
      INSERT INTO integration_settings
        (id, teams_enabled, teams_webhook_enc, teams_send_leasing, teams_send_booking_requests, teams_send_maintenance, updated_at)
      VALUES (1, 1, ?, 1, 0, 1, '2026-01-01')
    `).run(secret);

    assert.equal(migrateWebhooksSchema(database, { dataDir }), true);
    assert.equal(Number(database.pragma('user_version', { simple: true })), WEBHOOKS_SCHEMA_VERSION);
    const rows = database.prepare('SELECT * FROM webhooks').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].format, 'discord');
    assert.equal(rows[0].enabled, 1);
    assert.deepEqual(JSON.parse(rows[0].events), ['leasing', 'maintenance']);
    assert.match(rows[0].name, /Discord/);
    assert.equal(
      decryptIntegrationSecret(rows[0].url_enc, 'webhook_url', { dataDir }),
      'https://discord.com/api/webhooks/123/token-abc'
    );
    const legacy = database.prepare('SELECT teams_webhook_enc, teams_enabled FROM integration_settings WHERE id = 1').get();
    assert.equal(legacy.teams_webhook_enc, null);
    assert.equal(legacy.teams_enabled, 0);
    assert.equal(migrateWebhooksSchema(database, { dataDir }), false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM webhooks').get().count, 1);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Migration erkennt Teams-Hosts und legt ohne Legacy-Webhook nichts an', () => {
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-webhook-teams-'));
  const database = createDb();
  try {
    database.pragma('user_version = 15');
    const secret = encryptIntegrationSecret('https://example.webhook.office.com/webhookb2/abc', 'teams_webhook_url', { dataDir });
    database.prepare(`
      INSERT INTO integration_settings (id, teams_enabled, teams_webhook_enc, updated_at)
      VALUES (1, 1, ?, '2026-01-01')
    `).run(secret);
    migrateWebhooksSchema(database, { dataDir });
    assert.equal(database.prepare('SELECT format FROM webhooks').get().format, 'teams');
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const empty = createDb();
  try {
    empty.pragma('user_version = 15');
    migrateWebhooksSchema(empty, { dataDir });
    assert.equal(empty.prepare('SELECT COUNT(*) AS count FROM webhooks').get().count, 0);
  } finally {
    empty.close();
  }
});

test('SSRF: private, lokale und Metadaten-Adressen werden blockiert, Allowlist erlaubt intern', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.10', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, `${address} muss privat sein`);
  }
  assert.equal(isPrivateAddress('93.184.216.34'), false);

  await assert.rejects(
    validateWebhookTarget('http://127.0.0.1/hook'),
    (error) => error instanceof WebhookError && error.code === 'blocked'
  );
  await assert.rejects(
    validateWebhookTarget('https://internal.example/hook', {
      lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }]
    }),
    (error) => error.code === 'blocked'
  );
  await assert.rejects(validateWebhookTarget('ftp://example.com/hook'), (error) => error.code === 'unsupported_protocol');
  await assert.rejects(validateWebhookTarget('https://user:pass@example.com/hook'), (error) => error.code === 'credentials');
  await assert.rejects(
    validateWebhookTarget('https://missing.example/hook', { lookupImpl: async () => { throw new Error('dns'); } }),
    (error) => error.code === 'dns'
  );

  const target = await validateWebhookTarget('https://93.184.216.34/hook');
  assert.equal(target.hostname, '93.184.216.34');

  process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS = 'internal.example';
  try {
    const allowed = await validateWebhookTarget('http://internal.example/hook', {
      lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }]
    });
    assert.equal(allowed.allowed, true);
  } finally {
    delete process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS;
  }
});

test('Formate: generic, teams, discord und slack inklusive Discord-Limit', () => {
  assert.deepEqual(WEBHOOK_FORMATS, ['generic', 'teams', 'discord', 'slack']);
  const generic = buildWebhookPayload('generic', {
    event: 'leasing',
    title: 'Titel',
    text: 'Text',
    data: { vehicleId: 'v1' },
    timestamp: '2026-01-01T00:00:00.000Z'
  });
  assert.deepEqual(generic, {
    event: 'leasing',
    title: 'Titel',
    text: 'Text',
    timestamp: '2026-01-01T00:00:00.000Z',
    data: { vehicleId: 'v1' }
  });

  const teams = buildWebhookPayload('teams', { event: 'leasing', title: 'A', text: 'B' });
  assert.equal(teams['@type'], 'MessageCard');
  assert.equal(teams['@context'], 'http://schema.org/extensions');
  assert.equal(teams.summary, 'A');
  assert.equal(teams.title, 'A');
  assert.equal(teams.text, 'B');

  const discord = buildWebhookPayload('discord', { event: 'leasing', title: 'A', text: 'x'.repeat(5000) });
  assert.ok(discord.content.startsWith('**A**\n'));
  assert.ok(discord.content.length <= DISCORD_MAX_LENGTH);

  const slack = buildWebhookPayload('slack', { event: 'leasing', title: 'A', text: 'B' });
  assert.equal(slack.text, '*A*\nB');
});

test('HMAC-Signatur, HTTP-Fehler, Timeout und Redirects', async () => {
  const secret = 'hmac-secret';
  const result = await deliverWebhook({
    url: `${mockUrl}/hook`,
    secret,
    format: 'generic',
    message: { event: 'test', title: 'Titel', text: 'Text', delivery: 'd1' }
  }, { lookupImpl: PUBLIC_LOOKUP });
  assert.equal(result.ok, true);
  assert.equal(received.length, 1);
  const request = received[0];
  assert.equal(request.headers['x-awo-event'], 'test');
  assert.equal(request.headers['x-awo-delivery'], 'd1');
  assert.match(request.headers['x-awo-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.equal(
    request.headers['x-awo-signature'],
    signatureFor(secret, request.headers['x-awo-timestamp'], request.body)
  );
  const payload = JSON.parse(request.body);
  assert.equal(payload.event, 'test');
  assert.equal(payload.title, 'Titel');

  await assert.rejects(
    deliverWebhook({ url: `${mockUrl}/fail`, format: 'generic', message: { event: 'test', title: 'T', text: 'T' } }, { lookupImpl: PUBLIC_LOOKUP }),
    (error) => error.code === 'http' && error.status === 500 && errorCodeFor(error) === 'WEBHOOK_HTTP_500'
  );

  await assert.rejects(
    deliverWebhook(
      { url: `${mockUrl}/hook`, format: 'generic', message: { event: 'test', title: 'T', text: 'T' } },
      { lookupImpl: PUBLIC_LOOKUP, fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); } }
    ),
    (error) => errorCodeFor(error) === 'WEBHOOK_TIMEOUT'
  );

  received.length = 0;
  const redirected = await deliverWebhook({
    url: `${mockUrl}/redirect`,
    format: 'generic',
    message: { event: 'test', title: 'T', text: 'T' }
  }, { lookupImpl: PUBLIC_LOOKUP });
  assert.equal(redirected.ok, true);
  assert.deepEqual(received.map((entry) => entry.url), ['/redirect', '/hook']);

  await assert.rejects(
    deliverWebhook({
      url: `${mockUrl}/redirect-to-metadata`,
      format: 'generic',
      message: { event: 'test', title: 'T', text: 'T' }
    }, {
      lookupImpl: PUBLIC_LOOKUP,
      fetchImpl: async () => fakeResponse({ status: 302, ok: false, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
    }),
    (error) => errorCodeFor(error) === 'WEBHOOK_BLOCKED'
  );
});

test('Dispatch: Event-Filter, Dedupe, Retry und Secret-Hygiene', async () => {
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-webhook-dispatch-'));
  const database = createDb();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options.body, headers: options.headers });
    return fakeResponse({ status: 200, ok: true });
  };
  try {
    const leasing = await createWebhook(database, {
      name: 'Leasing',
      url: 'https://hooks.example.invalid/leasing',
      format: 'discord',
      events: ['leasing'],
      secret: 'sign-me'
    }, { dataDir, lookupImpl: PUBLIC_LOOKUP });
    const otherEvent = await createWebhook(database, {
      name: 'Wartung',
      url: 'https://hooks.example.invalid/maintenance',
      format: 'generic',
      events: ['maintenance']
    }, { dataDir, lookupImpl: PUBLIC_LOOKUP });
    await createWebhook(database, {
      name: 'Leasing Slack',
      url: 'https://hooks.example.invalid/leasing-slack',
      format: 'slack',
      events: ['leasing']
    }, { dataDir, lookupImpl: PUBLIC_LOOKUP });
    await createWebhook(database, {
      name: 'Deaktiviert',
      url: 'https://hooks.example.invalid/off',
      format: 'generic',
      events: ['leasing'],
      enabled: false
    }, { dataDir, lookupImpl: PUBLIC_LOOKUP });

    const now = new Date('2026-10-30T10:00:00.000Z');
    const first = await dispatchWebhooks(database, 'leasing', {
      dedupeKey: 'lease-1',
      vehicleId: 'v1',
      kind: 'leasing',
      title: 'Leasingwarnung',
      text: 'Text',
      data: { vehicleId: 'v1' }
    }, { dataDir, now, fetchImpl, lookupImpl: PUBLIC_LOOKUP });
    assert.equal(first.sent, 2);
    assert.equal(calls.length, 2);
    assert.match(calls[0].headers['X-AWO-Signature'], /^sha256=/);
    assert.deepEqual(JSON.parse(calls[0].body).content.startsWith('**Leasingwarnung**'), true);

    const row = database.prepare('SELECT * FROM notification_deliveries WHERE dedupe_key = ?')
      .get(`webhook:${leasing.id}:leasing:lease-1`);
    assert.equal(row.status, 'sent');
    assert.equal(row.channel, `webhook:${leasing.id}`);

    const second = await dispatchWebhooks(database, 'leasing', {
      dedupeKey: 'lease-1',
      vehicleId: 'v1',
      title: 'Leasingwarnung',
      text: 'Text'
    }, { dataDir, now: new Date(now.getTime() + 60_000), fetchImpl, lookupImpl: PUBLIC_LOOKUP });
    assert.equal(second.skipped, 2);
    assert.equal(calls.length, 2);

    const wrongEvent = await dispatchWebhooks(database, 'booking_request', {
      dedupeKey: 'b1',
      title: 'Buchung',
      text: 'Text'
    }, { dataDir, now, fetchImpl, lookupImpl: PUBLIC_LOOKUP });
    assert.equal(wrongEvent.noop, true);

    // HTTP failure and retry after six hours.
    calls.length = 0;
    const failingFetch = async () => fakeResponse({ status: 500, ok: false });
    const failed = await dispatchWebhooks(database, 'maintenance', {
      dedupeKey: 'm1',
      title: 'Wartung',
      text: 'Text'
    }, { dataDir, now, fetchImpl: failingFetch, lookupImpl: PUBLIC_LOOKUP });
    assert.equal(failed.failed, 1);
    const failedDelivery = database.prepare('SELECT status, error_code FROM notification_deliveries WHERE dedupe_key = ?')
      .get(`webhook:${otherEvent.id}:maintenance:m1`);
    assert.equal(failedDelivery.status, 'failed');
    assert.equal(failedDelivery.error_code, 'WEBHOOK_HTTP_500');

    const retried = await dispatchWebhooks(database, 'maintenance', {
      dedupeKey: 'm1',
      title: 'Wartung',
      text: 'Text'
    }, { dataDir, now: new Date(now.getTime() + 6 * 60 * 60 * 1000 + 1000), fetchImpl, lookupImpl: PUBLIC_LOOKUP });
    assert.equal(retried.sent, 1);

    const safe = listWebhooksSafe(database, { dataDir });
    assert.equal(safe.length, 4);
    for (const entry of safe) {
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'url'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, 'secret'), false);
      assert.equal(typeof entry.host, 'string');
    }
    const serialized = JSON.stringify(safe);
    assert.doesNotMatch(serialized, /https:\/\//);
    assert.doesNotMatch(serialized, /\/leasing|\/maintenance|\/off/);
    assert.doesNotMatch(serialized, /sign-me/);

    const audits = database.prepare("SELECT details FROM audit_logs WHERE action = 'webhook_delivery'").all();
    assert.ok(audits.length >= 2);
    for (const entry of audits) {
      assert.doesNotMatch(entry.details, /hooks\.example\.invalid|sign-me/);
    }
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('CRUD validiert Ziele, verschlüsselt URL/Secret und maskiert die Liste', async () => {
  const dataDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-webhook-crud-'));
  const database = createDb();
  try {
    await assert.rejects(
      createWebhook(database, {
        name: 'Blocked',
        url: 'http://169.254.169.254/latest/meta-data',
        events: ['leasing']
      }, { dataDir }),
      (error) => error.message.includes('privat') || error.code === 'blocked'
    );
    await assert.rejects(
      createWebhook(database, { name: '', url: 'https://example.com', events: ['leasing'] }, { dataDir, lookupImpl: PUBLIC_LOOKUP }),
      /Name/
    );
    await assert.rejects(
      createWebhook(database, { name: 'A', url: 'https://example.com', events: [] }, { dataDir, lookupImpl: PUBLIC_LOOKUP }),
      /Event/
    );

    const created = await createWebhook(database, {
      name: 'Test',
      url: 'https://hooks.example.invalid/path?token=abc',
      format: 'slack',
      events: ['leasing', 'booking_request'],
      secret: 'super-secret',
      enabled: true
    }, { dataDir, lookupImpl: PUBLIC_LOOKUP });
    assert.equal(created.urlSet, true);
    assert.equal(created.secretSet, true);
    assert.equal(created.host, 'hooks.example.invalid');
    const row = getWebhookRow(database, created.id);
    assert.ok(row.url_enc.startsWith('v1.'));
    assert.ok(row.secret_enc.startsWith('v1.'));
    assert.doesNotMatch(row.url_enc, /token=abc/);
    assert.doesNotMatch(row.secret_enc, /super-secret/);

    const updated = await updateWebhook(database, created.id, {
      name: 'Neu',
      format: 'generic',
      events: ['maintenance'],
      enabled: false,
      clearSecret: true
    }, { dataDir });
    assert.equal(updated.name, 'Neu');
    assert.equal(updated.secretSet, false);
    assert.equal(updated.enabled, false);
    assert.deepEqual(updated.events, ['maintenance']);

    assert.equal(deleteWebhook(database, created.id).id, created.id);
    assert.equal(deleteWebhook(database, created.id), null);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  unitDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-webhook-unit-'));
  await startMockServer();
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-webhook-api-'));
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
      ADMIN_NAME: 'Webhook Admin',
      ORG_NAME: 'Webhook-Test',
      WEBHOOK_ALLOW_PRIVATE_HOSTS: '127.0.0.1',
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
  await new Promise((resolve) => mockServer?.close(resolve));
  try {
    fs.rmSync(unitDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* Windows-Sperre */ }
});

test('API: CRUD, Test-Endpunkt, Maskierung und Audit ohne URLs/Secrets', async () => {
  const client = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(client.status, 303);

  const initial = await apiJson(client, 'GET', '/api/webhooks');
  assert.equal(initial.status, 200, initial.text);
  assert.deepEqual(initial.data.webhooks, []);

  const created = await apiJson(client, 'POST', '/api/webhooks', {
    name: 'Discord Test',
    url: `http://127.0.0.1:${mockPort}/hook`,
    format: 'discord',
    events: ['leasing', 'maintenance'],
    secret: 'api-secret',
    enabled: true
  });
  assert.equal(created.status, 201, created.text);
  const webhook = created.data.integrations.webhooks[0];
  assert.equal(webhook.name, 'Discord Test');
  assert.equal(webhook.format, 'discord');
  assert.equal(webhook.host, '127.0.0.1');
  assert.equal(webhook.urlSet, true);
  assert.equal(webhook.secretSet, true);
  assert.doesNotMatch(created.text, /api-secret|\/hook/);
  const stored = db.prepare('SELECT url_enc, secret_enc FROM webhooks WHERE id = ?').get(webhook.id);
  assert.ok(stored.url_enc.startsWith('v1.'));
  assert.ok(stored.secret_enc.startsWith('v1.'));
  assert.doesNotMatch(stored.url_enc, /\/hook/);

  const list = await apiJson(client, 'GET', '/api/webhooks');
  assert.equal(list.status, 200);
  assert.doesNotMatch(list.text, /api-secret|\/hook/);

  const state = await apiJson(client, 'GET', '/api/state');
  assert.equal(state.status, 200);
  assert.doesNotMatch(state.text, /api-secret|127\.0\.0\.1:\d+\/hook/);
  assert.equal(state.data.integrations.webhooks[0].host, '127.0.0.1');

  const blocked = await apiJson(client, 'POST', '/api/webhooks', {
    name: 'Blocked',
    url: 'http://169.254.169.254/latest/meta-data',
    format: 'generic',
    events: ['leasing']
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /privat|lokal|Metadaten/i);

  const invalid = await apiJson(client, 'POST', '/api/webhooks', {
    name: 'Invalid',
    url: 'ftp://example.com/hook',
    format: 'generic',
    events: ['leasing']
  });
  assert.equal(invalid.status, 400);

  received.length = 0;
  const tested = await apiJson(client, 'POST', `/api/webhooks/${webhook.id}/test`);
  assert.equal(tested.status, 200, tested.text);
  assert.equal(tested.data.ok, true);
  assert.equal(tested.data.status, 200);
  assert.equal(received.length, 1);
  assert.match(received[0].headers['x-awo-signature'], /^sha256=/);

  const updated = await apiJson(client, 'PATCH', `/api/webhooks/${webhook.id}`, {
    name: 'Discord Neu',
    enabled: false,
    clearSecret: true
  });
  assert.equal(updated.status, 200, updated.text);
  assert.equal(updated.data.integrations.webhooks[0].name, 'Discord Neu');
  assert.equal(updated.data.integrations.webhooks[0].secretSet, false);

  const audits = db.prepare("SELECT action, details FROM audit_logs WHERE entity_type = 'webhook'").all();
  assert.ok(audits.some((entry) => entry.action === 'webhook_added'));
  assert.ok(audits.some((entry) => entry.action === 'webhook_test'));
  for (const entry of audits) {
    assert.doesNotMatch(entry.details || '', /api-secret|127\.0\.0\.1:\d+\/hook/);
  }

  const deleted = await apiJson(client, 'DELETE', `/api/webhooks/${webhook.id}`);
  assert.equal(deleted.status, 200, deleted.text);
  assert.deepEqual(deleted.data.integrations.webhooks, []);
});

test('API: Unberechtigte erhalten 401', async () => {
  const anonymous = await fetch(`${baseUrl}/api/webhooks`);
  assert.equal(anonymous.status, 401);
});
