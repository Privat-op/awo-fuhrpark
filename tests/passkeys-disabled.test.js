'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const PASSWORD = 'Passkey-Disabled-2026!';
const ADMIN_EMAIL = 'passkey-disabled@example.invalid';
let tempDir;
let child;
let baseUrl;
let serverOutput = '';
let cookie = '';
let csrf = '';

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
  throw new Error(`Testserver nicht erreichbar. ${serverOutput.slice(-1000)}`);
}

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-passkey-disabled-'));
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
      DB_PATH: path.join(tempDir, 'test.sqlite'),
      UPLOAD_DIR: path.join(tempDir, 'uploads'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_EMAIL,
      ADMIN_PASSWORD: PASSWORD,
      ADMIN_NAME: 'Passkey Disabled',
      ORG_NAME: 'Passkey-Disabled-Test',
      WEBAUTHN_RP_ID: '',
      WEBAUTHN_RP_NAME: '',
      WEBAUTHN_ORIGIN: '',
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

  const page = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  const html = await page.text();
  const pageCsrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  const firstCookie = extractCookie(page);
  const loginResponse = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: firstCookie
    },
    body: new URLSearchParams({ _csrf: pageCsrf, email: ADMIN_EMAIL, password: PASSWORD })
  });
  cookie = extractCookie(loginResponse) || firstCookie;
  const session = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
  csrf = (await session.json()).csrfToken;
});

after(async () => {
  if (child) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
  }
});

test('Ohne WEBAUTHN-Konfiguration sind Passkey-Endpunkte sauber deaktiviert', async () => {
  const security = await fetch(`${baseUrl}/api/security`, { headers: { cookie } });
  assert.equal(security.status, 200);
  const data = await security.json();
  assert.equal(data.passkeys.enabled, false);
  assert.deepEqual(data.passkeys.items, []);

  const response = await fetch(`${baseUrl}/api/security/passkeys/options`, {
    method: 'POST',
    headers: {
      cookie,
      'x-csrf-token': csrf,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ password: PASSWORD })
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /nicht konfiguriert/);
  assert.equal(serverOutput.includes('Interner Serverfehler'), false);
});
