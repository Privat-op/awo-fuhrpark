#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const CORE_TABLES = [
  'users', 'roles', 'settings', 'vehicles', 'drivers', 'bookings', 'maintenance', 'costs',
  'audit_logs', 'sessions', 'notification_deliveries', 'user_mfa', 'user_passkeys',
  'password_reset_tokens', 'user_sso'
];

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fail(message) {
  console.error(`FEHLER: ${message}`);
  process.exitCode = 1;
}

function main() {
  const dataDir = path.resolve(arg('data', process.env.DATA_DIR || path.join(ROOT, 'data')));
  const dbPath = path.resolve(arg('db', process.env.DB_PATH || path.join(dataDir, 'awo-fuhrpark.sqlite')));
  const uploadsDir = path.resolve(arg('uploads', process.env.UPLOAD_DIR || path.join(dataDir, 'uploads')));
  const mfaKeyPath = path.join(dataDir, 'mfa.key');

  console.log(`Backup-Verifikation: ${dbPath}`);
  if (!fs.existsSync(dbPath)) return fail('Datenbankdatei fehlt.');
  if (!fs.existsSync(uploadsDir) || !fs.statSync(uploadsDir).isDirectory()) {
    return fail('Upload-Verzeichnis fehlt.');
  }

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    const integrity = db.pragma('integrity_check');
    if (!integrity.length || integrity[0].integrity_check !== 'ok') return fail('SQLite-Integritätsprüfung fehlgeschlagen.');
    const foreignKeys = db.pragma('foreign_key_check');
    if (foreignKeys.length) return fail(`Fremdschlüsselprüfung fehlgeschlagen (${foreignKeys.length} Treffer).`);

    let counts = 0;
    for (const table of CORE_TABLES) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      if (!row) return fail(`Kerntabelle fehlt: ${table}`);
      counts += Number(row.count) || 0;
    }
    console.log(`SQLite: ok · ${CORE_TABLES.length} Kerntabellen · ${counts} Datensätze`);

    const mfaRows = Number(db.prepare('SELECT COUNT(*) AS count FROM user_mfa WHERE totp_enabled = 1').get().count) || 0;
    const keyFromEnv = Boolean(String(process.env.MFA_ENCRYPTION_KEY || '').trim());
    const keyFile = fs.existsSync(mfaKeyPath);
    let keyValid = keyFromEnv;
    if (!keyValid && keyFile) {
      const key = fs.readFileSync(mfaKeyPath, 'utf8').trim();
      keyValid = Buffer.from(key, 'base64').length === 32;
    }
    if (mfaRows > 0 && !keyValid) return fail('MFA-Schlüssel fehlt oder ist ungültig, obwohl aktive TOTP-Geheimnisse existieren.');
    console.log(`MFA-Schlüssel: ${keyValid ? 'vorhanden' : 'nicht erforderlich/fehlt (keine aktiven TOTP-Geheimnisse)'}`);
    console.log('Uploads: Verzeichnis vorhanden');
    console.log('ERGEBNIS: OK');
  } catch (error) {
    fail(`Prüfung fehlgeschlagen: ${error.message}`);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

main();
