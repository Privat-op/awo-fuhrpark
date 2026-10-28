#!/usr/bin/env node
'use strict';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function isLocal(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

async function main() {
  const urlText = arg('url', process.env.LOADTEST_URL || 'http://127.0.0.1:3000/healthz');
  const concurrency = Math.max(1, Math.min(100, Number(arg('concurrency', '10')) || 10));
  const duration = Math.max(1, Math.min(300, Number(arg('duration', '10')) || 10));
  const confirmed = process.argv.includes('--confirm');
  const allowRemote = process.argv.includes('--allow-remote');
  const dryRun = process.argv.includes('--dry-run');

  let url;
  try {
    url = new URL(urlText);
  } catch {
    console.error('Ungültige Loadtest-URL.');
    process.exitCode = 1;
    return;
  }
  if (!isLocal(url.hostname) && !allowRemote) {
    console.error('Loadtest gegen nicht-lokale Ziele ist ohne --allow-remote gesperrt. Nicht gegen Produktion ausführen.');
    process.exitCode = 2;
    return;
  }
  if (!confirmed && !dryRun) {
    console.error('Bestätigung fehlt: --confirm erforderlich. Nur gegen eine dedizierte Testinstanz ausführen.');
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    console.log(JSON.stringify({ url: url.toString(), concurrency, durationSeconds: duration, dryRun: true }, null, 2));
    return;
  }

  const end = Date.now() + duration * 1000;
  const statuses = {};
  let requests = 0;
  let errors = 0;
  async function worker() {
    while (Date.now() < end) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        await response.arrayBuffer();
      } catch {
        errors += 1;
      }
      requests += 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(JSON.stringify({ url: url.toString(), concurrency, durationSeconds: duration, requests, errors, statuses }, null, 2));
}

main().catch(() => {
  console.error('Loadtest fehlgeschlagen.');
  process.exitCode = 1;
});
