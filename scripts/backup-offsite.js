#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/backup-offsite.js --source DATA_DIR --target RCLONE_TARGET [--rclone PATH] [--dry-run]');
    return;
  }
  const source = path.resolve(arg('source', process.env.OFFSITE_SOURCE || process.env.DATA_DIR || path.join(__dirname, '..', 'data')));
  const target = String(arg('target', process.env.OFFSITE_TARGET || '')).trim();
  const rclone = arg('rclone', process.env.RCLONE_BIN || 'rclone');
  const config = String(process.env.OFFSITE_RCLONE_CONFIG || '').trim();
  const dryRun = process.argv.includes('--dry-run');

  if (!target) {
    console.warn('Offsite-Backup nicht konfiguriert (OFFSITE_TARGET leer) – No-op.');
    return;
  }
  if (!fs.existsSync(source)) {
    console.error('Offsite-Backup: Quellverzeichnis fehlt.');
    process.exitCode = 1;
    return;
  }
  const args = ['copy', source, target];
  if (config) args.push('--config', config);
  console.log(`Offsite-Backup: ${rclone} ${args.map((entry) => (entry.includes(' ') ? `"${entry}"` : entry)).join(' ')}`);
  if (dryRun) {
    console.log('Dry-Run: kein Kopiervorgang ausgeführt.');
    return;
  }
  const result = spawnSync(rclone, args, { stdio: 'inherit' });
  if (result.error) {
    console.error('Offsite-Backup konnte nicht gestartet werden.');
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    console.error(`Offsite-Backup fehlgeschlagen (Exit ${result.status}).`);
    process.exitCode = result.status || 1;
  }
}

main();
