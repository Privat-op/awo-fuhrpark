'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  COLOR_MODES,
  isColorMode,
  normalizeColorMode,
  getUserColorMode,
  getDefaultColorMode,
  getEffectiveColorMode,
  getResolvedColorMode
} = require('../server/lib/color-mode');
const { migrateColorModeSchema, COLOR_MODE_SCHEMA_VERSION } = require('../server/lib/color-mode-schema');

const ROOT = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function extractBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return '';
}

function token(block, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  return match ? match[1].trim().replace(/\s*!important$/, '') : null;
}

function hexToRgb(hex) {
  const value = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  if (!a || !b) return 0;
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test('Farbmodus-Helfer validieren light/dark/auto und NULL-Fallback', () => {
  assert.deepEqual(COLOR_MODES, ['light', 'dark', 'auto']);
  assert.equal(isColorMode('dark'), true);
  assert.equal(isColorMode('system'), false);
  assert.equal(normalizeColorMode('auto'), 'auto');
  assert.equal(normalizeColorMode('invalid', 'light'), 'light');
  assert.equal(getUserColorMode({ color_mode: 'dark' }), 'dark');
  assert.equal(getUserColorMode({ color_mode: null }), null);
  assert.equal(getUserColorMode({ color_mode: 'invalid' }), null);
  assert.equal(getDefaultColorMode({ default_color_mode: 'auto' }), 'auto');
  assert.equal(getDefaultColorMode({}), 'light');
  assert.equal(getEffectiveColorMode({ color_mode: null }, { default_color_mode: 'dark' }), 'dark');
  assert.equal(getEffectiveColorMode({ color_mode: 'auto' }, { default_color_mode: 'dark' }), 'auto');
  assert.equal(getResolvedColorMode({ color_mode: 'dark' }, { default_color_mode: 'light' }), 'dark');
  assert.equal(getResolvedColorMode({ color_mode: 'auto' }, { default_color_mode: 'dark' }), 'light');
});

test('Migration 7 ist idempotent und ergänzt Color-Mode-Spalten mit Check', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), org_name TEXT NOT NULL);
      INSERT INTO settings (id, org_name) VALUES (1, 'Test');
      PRAGMA user_version = 6;
    `);
    assert.equal(migrateColorModeSchema(db), true);
    assert.equal(Number(db.pragma('user_version', { simple: true })), COLOR_MODE_SCHEMA_VERSION);
    assert.ok(db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'color_mode'));
    assert.ok(db.prepare('PRAGMA table_info(settings)').all().some((column) => column.name === 'default_color_mode'));
    assert.equal(db.prepare('SELECT default_color_mode FROM settings WHERE id = 1').get().default_color_mode, 'light');

    db.prepare("INSERT INTO users (id, color_mode) VALUES ('u1', 'auto')").run();
    assert.throws(() => db.prepare("INSERT INTO users (id, color_mode) VALUES ('u2', 'system')").run());
    assert.throws(() => db.prepare("UPDATE settings SET default_color_mode = 'system' WHERE id = 1").run());

    assert.equal(migrateColorModeSchema(db), false);
    assert.equal(Number(db.pragma('user_version', { simple: true })), COLOR_MODE_SCHEMA_VERSION);
  } finally {
    db.close();
  }
});

test('CSS-Token-Vertrag: Light/Dark, color-scheme, Fokus und Print', () => {
  const css = read('public/styles.css');
  const root = extractBlock(css, ':root');
  const dark = extractBlock(css, ':root[data-color-mode="dark"]');
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.ok(dark, 'Dark-Tokenblock fehlt');
  assert.equal(token(root, '--bg'), '#f4f5f7');
  assert.equal(token(dark, '--bg'), '#111418');
  assert.equal(token(dark, '--surface'), '#191d23');
  assert.equal(token(dark, '--ink'), '#f2f4f7');
  assert.equal(token(dark, '--muted'), '#a7b0bd');
  assert.match(css, /color-scheme:\s*light/);
  assert.match(dark, /color-scheme:\s*dark/);
  assert.match(css, /outline:\s*3px solid var\(--focus-ring\)/);
  assert.match(print, /--bg:\s*#fff\s*!important/);
  assert.match(print, /color-scheme:\s*light\s*!important/);
  assert.match(css, /\.color-mode-switch\s*\{/);
  assert.match(css, /\.color-mode-option\[aria-pressed="true"\]/);

  for (const selector of ['.card', '.modal', '.input, .select, .textarea', '.data-table']) {
    const block = extractBlock(css, selector);
    assert.ok(block, `${selector} fehlt`);
    assert.doesNotMatch(block, /#fff(?:fff)?\b/i, `${selector} enthält hartkodiertes Weiß`);
    assert.doesNotMatch(block, /#f4f5f7|#191c23|#e7e9ee/i, `${selector} enthält alte Light-Hardcodes`);
  }
  const body = extractBlock(css, 'body');
  assert.match(body, /color:\s*var\(--ink\)/);
  assert.match(body, /background:\s*var\(--bg\)/);
});

test('UI enthält Header- und Einstellungs-Umschalter mit ARIA und Icons', () => {
  const index = read('server/views/index.html');
  const views = read('public/views.js');
  const app = read('public/app.js');
  assert.match(index, /data-color-mode="\{\{COLOR_MODE\}\}"/);
  assert.match(index, /data-color-mode-preference="\{\{COLOR_MODE\}\}"/);
  assert.match(index, /aria-label="Farbschema"/);
  assert.match(index, /data-color-mode-option="light"/);
  assert.match(index, /data-color-mode-option="dark"/);
  assert.match(index, /data-color-mode-option="auto"/);
  assert.ok(index.indexOf('<script>') < index.indexOf('styles.css'), 'Bootstrap vor CSS');
  assert.match(views, /function renderColorModeSwitch\(/);
  assert.match(views, /data-action="set-color-mode"/);
  assert.match(app, /async function setColorMode\(/);
  assert.match(app, /data-color-mode-option/);
});

test('Login-CSS nutzt Tokens und hat einen Dark-Block', () => {
  const css = read('public/login.css');
  const dark = extractBlock(css, ':root[data-color-mode="dark"]');
  assert.ok(dark);
  assert.equal(token(dark, '--bg'), '#111418');
  assert.equal(token(dark, '--surface'), '#191d23');
  assert.match(dark, /color-scheme:\s*dark/);
  assert.match(css, /\.login-card\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /\.login-field input\s*\{[^}]*background:\s*var\(--surface-2\)/s);
  assert.match(css, /\.login-form-panel\s*\{[^}]*var\(--bg\)/s);
  assert.doesNotMatch(extractBlock(css, '.login-field input'), /#fff(?:fff)?\b/i);
});

test('Kontrast der zentralen Light-/Dark-Tokens erfüllt WCAG AA', () => {
  const css = read('public/styles.css');
  const root = extractBlock(css, ':root');
  const dark = extractBlock(css, ':root[data-color-mode="dark"]');
  const awoDark = extractBlock(css, ':root[data-theme="awo"][data-color-mode="dark"]');
  const lightSurfaces = [token(root, '--bg'), token(root, '--surface'), token(root, '--surface-2')];
  const darkSurfaces = [token(dark, '--bg'), token(dark, '--surface'), token(dark, '--surface-2')];
  for (const surface of lightSurfaces) {
    assert.ok(contrast(token(root, '--ink'), surface) >= 4.5, `Light ink auf ${surface}`);
    assert.ok(contrast(token(root, '--muted'), surface) >= 4.5, `Light muted auf ${surface}`);
    assert.ok(contrast(token(root, '--subtle'), surface) >= 3, `Light subtle auf ${surface}`);
  }
  for (const surface of darkSurfaces) {
    assert.ok(contrast(token(dark, '--ink'), surface) >= 4.5, `Dark ink auf ${surface}`);
    assert.ok(contrast(token(dark, '--muted'), surface) >= 4.5, `Dark muted auf ${surface}`);
    assert.ok(contrast(token(dark, '--subtle'), surface) >= 3, `Dark subtle auf ${surface}`);
  }
  const darkAccent = token(awoDark, '--awo');
  assert.ok(contrast(darkAccent, token(dark, '--surface')) >= 3, 'AWO-Akzent auf Dark-Surface');
  assert.ok(contrast(token(root, '--awo'), token(root, '--surface')) >= 3, 'AWO-Akzent auf Light-Surface');
});
