'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEST_TMP_ROOT = process.env.AWO_TEST_TMP || path.join('C:', 'opencode', 'tmp');
fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
const unitDir = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'awo-upload-limit-'));
process.env.DATA_DIR = unitDir;
process.env.UPLOAD_DIR = path.join(unitDir, 'uploads');
process.env.DB_PATH = path.join(unitDir, 'unit.sqlite');

const { storeVehicleImage } = require('../server/lib/files');

const MB = 1024 * 1024;

function dataUrlForSize(bytes) {
  return `data:image/jpeg;base64,${Buffer.alloc(bytes).toString('base64')}`;
}

before(() => {
  assert.ok(fs.existsSync(unitDir));
});

after(() => {
  try { fs.rmSync(unitDir, { recursive: true, force: true }); } catch { /* Windows-Sperre */ }
});

test('QS-003: exactly 12 MB passes the size check and only fails image processing', async () => {
  await assert.rejects(
    storeVehicleImage(dataUrlForSize(12 * MB)),
    (error) => error.status === 400 && /Bild konnte nicht verarbeitet werden/.test(error.message)
  );
});

test('QS-003: images above 12 MB keep the advertised limit message', async () => {
  await assert.rejects(
    storeVehicleImage(dataUrlForSize(12 * MB + 1)),
    (error) => error.status === 400 && /max\. 12 MB/.test(error.message)
  );
});
