'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const COST = 12;
const MIN_LENGTH = 12;

function usage() {
  console.log('Erstellt eine lokale Superadmin-Datei mit eigenem Passwort.');
  console.log('Aufruf: npm run superadmin:setup');
  console.log('Optional: npm run superadmin:setup -- --out "C:\\pfad\\superadmin.json"');
  console.log('Das Passwort wird verdeckt eingegeben, nicht geloggt und nur als bcrypt-Hash gespeichert.');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}

function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    return Promise.reject(new Error('Bitte in einem interaktiven Terminal ausführen (kein Pipe-/CI-Modus).'));
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = '';
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Abgebrochen.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function defaultOutputPath() {
  if (process.platform === 'win32' && fs.existsSync('C:\\awo-fuhrpark-local')) {
    return 'C:\\awo-fuhrpark-local\\superadmin.json';
  }
  return path.join(os.homedir(), '.awo-fuhrpark', 'superadmin.json');
}

function outputPathFromArgs() {
  const index = process.argv.indexOf('--out');
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : defaultOutputPath();
}

function lockDown(file) {
  if (process.platform === 'win32') {
    const identity = process.env.USERNAME;
    if (identity) spawnSync('icacls', [file, '/inheritance:r', '/grant:r', `${identity}:F`], { stdio: 'ignore' });
  } else {
    fs.chmodSync(file, 0o600);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const output = outputPathFromArgs();
  if (fs.existsSync(output) && !process.argv.includes('--force')) {
    throw new Error(`Datei existiert bereits: ${output}. Nutze --force zum Überschreiben.`);
  }
  const email = (await ask('Superadmin-E-Mail: ')).trim().toLowerCase();
  const name = (await ask('Superadmin-Name: ')).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Die E-Mail-Adresse ist ungültig.');
  if (!name) throw new Error('Der Name darf nicht leer sein.');
  const password = await promptHidden('Passwort: ');
  const confirmation = await promptHidden('Passwort wiederholen: ');
  if (password.length < MIN_LENGTH) throw new Error(`Das Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`);
  if (password !== confirmation) throw new Error('Die Passwörter stimmen nicht überein.');
  const passwordHash = await bcrypt.hash(password, COST);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ email, name, passwordHash }, null, 2) + '\n', { mode: 0o600 });
  lockDown(output);
  console.log(`Datei erstellt: ${output}`);
  console.log('Die Datei enthält nur den bcrypt-Hash, kein Klartextpasswort.');
  console.log('Auf dem Server nach /etc/awo-fuhrpark/superadmin.json kopieren und Container neu starten.');
}

main().catch((error) => {
  console.error(`Fehler: ${error.message}`);
  process.exitCode = 1;
});
