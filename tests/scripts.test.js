'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');
let tempDir;
let dbPath;
let dataDir;
let healthServer;
let healthUrl;

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20000
  });
}

function runAsync(script, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

before(async () => {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-scripts-'));
  dataDir = path.join(tempDir, 'data');
  dbPath = path.join(dataDir, 'backup.sqlite');
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'mfa.key'), crypto.randomBytes(32).toString('base64'));
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  db.prepare(`
    INSERT INTO settings (org_name, seeded_at, updated_at)
    VALUES ('Scripts-Test', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES ('u1', 'scripts@example.invalid', 'Scripts', 'x', 'manager', 1, '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO user_mfa (user_id, totp_enabled, totp_secret_enc)
    VALUES ('u1', 1, 'v1.test')
  `).run();
  db.close();

  healthServer = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => healthServer.listen(0, '127.0.0.1', resolve));
  healthUrl = `http://127.0.0.1:${healthServer.address().port}/healthz`;
});

after(async () => {
  if (healthServer) await new Promise((resolve) => healthServer.close(resolve));
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('verify-backup prüft Integrität, Kerntabellen, Uploads und MFA-Schlüssel', () => {
  const result = run('verify-backup.js', ['--db', dbPath, '--data', dataDir, '--uploads', path.join(dataDir, 'uploads')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ERGEBNIS: OK/);
  assert.match(result.stdout, /SQLite: ok/);

  const corrupt = path.join(tempDir, 'corrupt.sqlite');
  fs.writeFileSync(corrupt, 'kein sqlite');
  const failed = run('verify-backup.js', ['--db', corrupt, '--data', dataDir, '--uploads', path.join(dataDir, 'uploads')]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /FEHLER/);
});

test('healthcheck prüft HTTP, Datenbank und Disk', async () => {
  const ok = await runAsync('healthcheck.js', ['--url', healthUrl, '--db', dbPath, '--disk', tempDir]);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.match(ok.stdout, /ERGEBNIS: OK/);

  const failed = await runAsync('healthcheck.js', ['--url', 'http://127.0.0.1:1/healthz']);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /nicht erreichbar/);
});

test('backup-offsite ist ohne Ziel No-op und mit --dry-run sicher', () => {
  const noop = run('backup-offsite.js', ['--source', dataDir], { OFFSITE_TARGET: '' });
  assert.equal(noop.status, 0);
  assert.match(noop.stderr, /No-op/);

  const dry = run('backup-offsite.js', ['--source', dataDir, '--target', 'remote:backup', '--dry-run']);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /rclone copy/);
  assert.match(dry.stdout, /Dry-Run/);
});

test('loadtest verweigert Produktionsziele und bestätigt nur explizit', () => {
  const remote = run('loadtest.js', ['--url', 'https://example.org/healthz', '--dry-run']);
  assert.equal(remote.status, 2);

  const unconfirmed = run('loadtest.js', ['--url', 'http://127.0.0.1:1/healthz', '--duration', '1']);
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /Bestätigung fehlt/);

  const dry = run('loadtest.js', ['--url', 'http://127.0.0.1:1/healthz', '--dry-run', '--concurrency', '2', '--duration', '1']);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /"dryRun": true/);
});
