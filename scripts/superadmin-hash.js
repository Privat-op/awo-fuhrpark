'use strict';

const path = require('node:path');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

const COST = 12;
const MIN_LENGTH = 12;

function usage() {
  console.log('Erzeugt einen bcrypt-Hash (Cost 12) für die Superadmin-Datei.');
  console.log('Aufruf: npm run superadmin:hash');
  console.log('Das Passwort wird verdeckt eingegeben und nicht gespeichert oder geloggt.');
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

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const password = await promptHidden('Neues Superadmin-Passwort: ');
  const confirmation = await promptHidden('Passwort wiederholen: ');
  if (password.length < MIN_LENGTH) {
    throw new Error(`Das Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`);
  }
  if (password !== confirmation) {
    throw new Error('Die Passwörter stimmen nicht überein.');
  }
  const hash = await bcrypt.hash(password, COST);
  process.stdout.write('\nHash (nur diesen Wert in passwordHash eintragen):\n');
  process.stdout.write(hash + '\n');
  process.stdout.write('Danach Superadmin-Datei speichern und Container/Service neu starten.\n');
}

main().catch((error) => {
  console.error(`\nFehler: ${error.message}`);
  process.exitCode = 1;
});
