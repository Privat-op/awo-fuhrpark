'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SECRET_FILE = 'smtp-secret.json';

function defaultDataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
}

function secretPath(dataDir) {
  return path.join(dataDir || defaultDataDir(), SECRET_FILE);
}

function readPassword(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(secretPath(dataDir), 'utf8'));
    return typeof parsed.password === 'string' ? parsed.password : '';
  } catch {
    return '';
  }
}

function writePassword(dataDir, password) {
  const file = secretPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ password }), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(temporary, 0o600);
  } catch {
    // Windows kennt keine POSIX-Modi; die Datei liegt dennoch im geschützten Datenverzeichnis.
  }
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Siehe oben.
  }
}

function removePassword(dataDir) {
  try {
    fs.unlinkSync(secretPath(dataDir));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function emailLooksValid(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function blankSettings() {
  return {
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    username: '',
    fromAddress: '',
    passwordSet: false,
    updatedAt: null
  };
}

function loadSmtpConfig(db, { dataDir } = {}) {
  const row = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get();
  const password = readPassword(dataDir);
  if (!row) return { ...blankSettings(), password, passwordSet: Boolean(password) };
  return {
    enabled: Boolean(row.enabled),
    host: row.host || '',
    port: Number(row.port) || 587,
    secure: Boolean(row.secure),
    username: row.username || '',
    fromAddress: row.from_address || '',
    password,
    passwordSet: Boolean(password),
    updatedAt: row.updated_at || null
  };
}

function validateSmtpConfig(config, { requireEnabled = false } = {}) {
  const errors = [];
  const active = requireEnabled || config.enabled;
  if (requireEnabled && !config.enabled) errors.push('SMTP ist nicht aktiviert.');
  if (active && !String(config.host || '').trim()) errors.push('SMTP-Host ist erforderlich.');
  if (!Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535) {
    errors.push('SMTP-Port ist ungültig.');
  }
  if (active && !emailLooksValid(config.fromAddress)) errors.push('Absenderadresse ist ungültig.');
  if (!active && config.fromAddress && !emailLooksValid(config.fromAddress)) errors.push('Absenderadresse ist ungültig.');
  if (config.username && !config.password && active) errors.push('Für den SMTP-Benutzer fehlt ein Passwort.');
  return errors;
}

function getPublicSmtpConfig(db, { dataDir } = {}) {
  const config = loadSmtpConfig(db, { dataDir });
  const errors = validateSmtpConfig(config);
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    fromAddress: config.fromAddress,
    passwordSet: config.passwordSet,
    updatedAt: config.updatedAt,
    ready: config.enabled && errors.length === 0
  };
}

function saveSmtpConfig(db, input, { dataDir } = {}) {
  const host = String(input?.host || '').trim().slice(0, 255);
  const portValue = Number(input?.port ?? 587);
  const port = Number.isInteger(portValue) ? portValue : 0;
  const secure = Boolean(input?.secure);
  const username = String(input?.username || '').trim().slice(0, 200);
  const fromAddress = String(input?.fromAddress || '').trim().slice(0, 200).toLowerCase();
  const enabled = Boolean(input?.enabled);
  const passwordProvided = typeof input?.password === 'string' && input.password.length > 0;
  const clearPassword = input?.clearPassword === true;

  if (passwordProvided && input.password.length > 500) {
    throw new Error('Das SMTP-Passwort ist zu lang.');
  }
  if (clearPassword && passwordProvided) {
    throw new Error('Passwort kann nicht gleichzeitig gesetzt und entfernt werden.');
  }

  const existingPassword = readPassword(dataDir);
  const password = clearPassword ? '' : (passwordProvided ? input.password : existingPassword);
  const config = { enabled, host, port, secure, username, fromAddress, password, passwordSet: Boolean(password) };
  const errors = validateSmtpConfig(config, { requireEnabled: enabled });
  if (errors.length) {
    const error = new Error(errors[0]);
    error.details = errors;
    throw error;
  }

  if (passwordProvided) writePassword(dataDir, input.password);
  if (clearPassword) removePassword(dataDir);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE smtp_settings
    SET host = ?, port = ?, secure = ?, username = ?, from_address = ?, enabled = ?, updated_at = ?
    WHERE id = 1
  `).run(host, port, secure ? 1 : 0, username, fromAddress, enabled ? 1 : 0, now);

  return getPublicSmtpConfig(db, { dataDir });
}

function createTransport(config, { transportFactory } = {}) {
  if (typeof transportFactory === 'function') return transportFactory(config);
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

async function sendMail({ config, to, subject, text, transportFactory }) {
  const errors = validateSmtpConfig(config, { requireEnabled: true });
  if (errors.length) throw new Error(errors[0]);
  const recipients = (Array.isArray(to) ? to : [to]).map((value) => String(value || '').trim()).filter(Boolean);
  if (!recipients.length) throw new Error('Es sind keine Empfängeradressen hinterlegt.');
  const transport = createTransport(config, { transportFactory });
  try {
    return await transport.sendMail({
      from: config.fromAddress,
      to: recipients.join(', '),
      subject,
      text
    });
  } finally {
    try {
      if (typeof transport.close === 'function') transport.close();
    } catch {
      // Ein fehlgeschlagenes Schließen darf einen erfolgreichen Versand nicht als Fehler werten.
    }
  }
}

function sanitizeSmtpError(error) {
  const name = error?.name && error.name !== 'Error' ? error.name : '';
  const raw = String(error?.code || name || 'SMTP_ERROR').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return raw ? raw.toUpperCase() : 'SMTP_ERROR';
}

function smtpErrorMessage(code, error, options = {}) {
  const responseCode = Number(error?.responseCode) || 0;
  if (responseCode === 530 || responseCode === 535) {
    return 'Der SMTP-Server verlangt eine Anmeldung. Bitte SMTP-Benutzer und Passwort hinterlegen.';
  }
  if (code === 'ECONNECTION' && !error?.errno) {
    const base = 'Der SMTP-Server hat die Verbindung abgebrochen.';
    return options.hasCredentials === false
      ? `${base} Es ist kein SMTP-Benutzer hinterlegt – der Server verlangt für den Versand eine Anmeldung.`
      : `${base} Bitte Host, Port, TLS und Zugangsdaten prüfen.`;
  }
  const known = {
    EAUTH: 'Anmeldung am SMTP-Server fehlgeschlagen. Bitte Benutzer und Passwort prüfen.',
    ECONNECTION: 'Verbindung zum SMTP-Server fehlgeschlagen.',
    ETIMEDOUT: 'Zeitüberschreitung beim SMTP-Versand.',
    ESOCKET: 'SMTP-Verbindung wurde unerwartet beendet.',
    EENVELOPE: 'Der SMTP-Server hat die Absender- oder Empfängeradresse abgelehnt.'
  };
  if (known[code]) return known[code];
  if (code === 'SMTP_ERROR') {
    const message = String(error?.message || '').trim();
    if (message) return message.slice(0, 200);
  }
  return 'Der SMTP-Versand ist fehlgeschlagen.';
}

module.exports = {
  SECRET_FILE,
  defaultDataDir,
  secretPath,
  readPassword,
  writePassword,
  removePassword,
  loadSmtpConfig,
  getPublicSmtpConfig,
  saveSmtpConfig,
  validateSmtpConfig,
  createTransport,
  sendMail,
  sanitizeSmtpError,
  smtpErrorMessage
};
