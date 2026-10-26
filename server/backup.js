'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR, UPLOAD_DIR } = require('./db');

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetRoot = path.join(DATA_DIR, 'backups', stamp);
  fs.mkdirSync(targetRoot, { recursive: true });

  const databaseTarget = path.join(targetRoot, 'awo-fuhrpark.sqlite');
  await db.backup(databaseTarget);

  const uploadTarget = path.join(targetRoot, 'uploads');
  fs.cpSync(UPLOAD_DIR, uploadTarget, { recursive: true });

  console.log(`Sicherung erstellt: ${targetRoot}`);
  console.log('Bitte die Sicherung zusätzlich auf ein externes Speichermedium kopieren.');
}

main().catch((error) => {
  console.error('Sicherung fehlgeschlagen:', error);
  process.exitCode = 1;
});
