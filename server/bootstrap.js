'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

function ensureSettings(db) {
  const existing = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (existing) return;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (id, org_name, location, email, phone, seeded_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(
    process.env.ORG_NAME || 'AWO Bremerhaven',
    process.env.ORG_LOCATION || 'Bremerhaven',
    process.env.ORG_EMAIL || process.env.ADMIN_EMAIL || '',
    process.env.ORG_PHONE || '',
    now.slice(0, 10),
    now
  );
}

function ensureAdmin(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return null;

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Fuhrparkleitung').trim();

  if (!email || !password) {
    throw new Error('Erster Start: Bitte ADMIN_EMAIL und ADMIN_PASSWORD in der .env-Datei setzen.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL ist keine gültige E-Mail-Adresse.');
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD muss mindestens 10 Zeichen lang sein.');
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
  `).run(id, email, name || 'Fuhrparkleitung', hash, now, now);
  console.log(`Administratorkonto angelegt: ${email}`);
  return id;
}

function bootstrap(db) {
  ensureSettings(db);
  return ensureAdmin(db);
}

module.exports = { bootstrap, ensureAdmin, ensureSettings };
