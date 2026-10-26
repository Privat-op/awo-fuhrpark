'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(PROJECT_ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(DATA_DIR, 'uploads');
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'awo-fuhrpark.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'vehicles'), { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'receipts'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

module.exports = {
  db,
  initSchema,
  DATA_DIR,
  UPLOAD_DIR,
  DB_PATH,
  PROJECT_ROOT
};
