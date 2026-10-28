#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const Database = require('better-sqlite3');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const url = arg('url', process.env.HEALTH_URL || 'http://127.0.0.1:3000/healthz');
  const dbPath = arg('db', process.env.HEALTH_DB || '');
  const diskPath = arg('disk', process.env.HEALTH_DISK_PATH || '');
  const minFreeMb = Number(arg('min-free-mb', process.env.HEALTH_MIN_FREE_MB || 0));
  let ok = true;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.status !== 'ok') {
      ok = false;
      console.error(`HTTP-Healthcheck fehlgeschlagen: Status ${response.status}`);
    } else {
      console.log('HTTP: ok');
    }
  } catch {
    ok = false;
    console.error('HTTP-Healthcheck nicht erreichbar.');
  }

  if (dbPath) {
    try {
      const db = new Database(dbPath, { readonly: true });
      db.prepare('SELECT 1').get();
      db.close();
      console.log('Datenbank: ok');
    } catch {
      ok = false;
      console.error('Datenbankprüfung fehlgeschlagen.');
    }
  }

  if (diskPath) {
    try {
      fs.statSync(diskPath);
      const stats = fs.statfsSync ? fs.statfsSync(diskPath) : null;
      const freeMb = stats ? Math.floor((stats.bavail * stats.bsize) / (1024 * 1024)) : null;
      if (freeMb !== null && freeMb < minFreeMb) {
        ok = false;
        console.error(`Freier Speicher zu niedrig (${freeMb} MB < ${minFreeMb} MB).`);
      } else {
        console.log(`Disk: ok${freeMb !== null ? ` (${freeMb} MB frei)` : ''}`);
      }
    } catch {
      ok = false;
      console.error('Disk-Prüfung fehlgeschlagen.');
    }
  }

  console.log(ok ? 'ERGEBNIS: OK' : 'ERGEBNIS: FEHLER');
  process.exitCode = ok ? 0 : 1;
}

main();
