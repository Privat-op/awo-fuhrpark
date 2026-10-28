'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
const unitDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-virus-'));
process.env.DATA_DIR = unitDir;
process.env.UPLOAD_DIR = path.join(unitDir, 'uploads');
process.env.DB_PATH = path.join(unitDir, 'unit.sqlite');

const { scanBuffer } = require('../server/lib/virus-scan');
const { storeReceipt } = require('../server/lib/files');
const { db, UPLOAD_DIR } = require('../server/db');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8');

let clamd;
let clamdPort;
let mode = 'OK';
let received = Buffer.alloc(0);

function pdfData() {
  return `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n').toString('base64')}`;
}

before(async () => {
  db.exec(SCHEMA);
  clamd = net.createServer((socket) => {
    let responded = false;
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (responded) return;
      responded = true;
      if (mode === 'TIMEOUT') return;
      const response = mode === 'FOUND'
        ? 'stream: Eicar-Test-Signature FOUND\0'
        : 'stream: OK\0';
      setTimeout(() => socket.end(response), 10);
    });
  });
  await new Promise((resolve) => clamd.listen(0, '127.0.0.1', resolve));
  clamdPort = clamd.address().port;
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String(clamdPort);
  process.env.VIRUS_SCAN_ENABLED = '1';
  process.env.VIRUS_SCAN_FAIL_CLOSED = '1';
});

after(async () => {
  delete process.env.VIRUS_SCAN_ENABLED;
  delete process.env.VIRUS_SCAN_FAIL_CLOSED;
  try { db.close(); } catch { /* ignore */ }
  if (clamd) await new Promise((resolve) => clamd.close(resolve));
  try { fs.rmSync(unitDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('ClamAV INSTREAM: OK, FOUND und Fail-Closed-Timeout', async () => {
  mode = 'OK';
  received = Buffer.alloc(0);
  const ok = await scanBuffer(Buffer.from('sauber'), { timeout: 2000 });
  assert.deepEqual(ok, { ok: true, scanned: true });
  assert.equal(received.subarray(0, 10).toString('utf8'), 'zINSTREAM\0');

  mode = 'FOUND';
  const found = await scanBuffer(Buffer.from('eicar'), { timeout: 2000 });
  assert.equal(found.ok, false);
  assert.equal(found.found, true);

  mode = 'TIMEOUT';
  const closed = await scanBuffer(Buffer.from('timeout'), { timeout: 100 });
  assert.equal(closed.ok, false);
  assert.equal(closed.error, 'timeout');

  const open = await scanBuffer(Buffer.from('timeout'), { timeout: 100, failClosed: false });
  assert.equal(open.ok, true);
  assert.equal(open.error, 'timeout');
});

test('PDF-Beleg wird bei Befund mit 422 abgelehnt und nicht gespeichert', async () => {
  mode = 'FOUND';
  await assert.rejects(
    storeReceipt({ data: pdfData(), name: 'beleg.pdf' }),
    (error) => error.status === 422 && error.message === 'Upload wurde aus Sicherheitsgründen abgelehnt.'
  );
});

test('PDF-Beleg wird bei OK gespeichert, bei deaktivierter Prüfung ohne clamd', async () => {
  mode = 'OK';
  const stored = await storeReceipt({ data: pdfData(), name: 'beleg.pdf' });
  assert.ok(stored?.file);
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, stored.file)));

  process.env.VIRUS_SCAN_ENABLED = '0';
  mode = 'TIMEOUT';
  const unconfigured = await storeReceipt({ data: pdfData(), name: 'ohne-scan.pdf' });
  assert.ok(unconfigured?.file);
  process.env.VIRUS_SCAN_ENABLED = '1';
});
