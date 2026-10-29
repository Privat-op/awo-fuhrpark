'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns');
const net = require('node:net');
const { HttpError } = require('./validation');
const { writeAudit } = require('./audit');
const { encryptIntegrationSecret, decryptIntegrationSecret } = require('./integrations-crypto');

const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const PENDING_TIMEOUT_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 2;
const MAX_BODY_BYTES = 64 * 1024;
const DISCORD_MAX_LENGTH = 2000;

const WEBHOOK_FORMATS = ['generic', 'teams', 'discord', 'slack'];
const WEBHOOK_EVENTS = ['leasing', 'booking_request', 'maintenance', 'test'];

class WebhookError extends Error {
  constructor(code, message, { status = null } = {}) {
    super(message || code);
    this.name = 'WebhookError';
    this.code = code;
    this.status = status;
  }
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function allowPrivateHosts() {
  return new Set(String(process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
}

function isPrivateAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return true;
  const family = net.isIP(value);
  if (family === 4) {
    const parts = value.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('::ffff:')) {
      const mapped = value.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) return isPrivateAddress(mapped);
    }
    if (value.startsWith('fc') || value.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (value.startsWith('ff')) return true;
    if (value.startsWith('2001:db8')) return true;
    return false;
  }
  return true;
}

async function defaultLookup(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

async function validateWebhookTarget(rawUrl, { lookupImpl = defaultLookup } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch {
    throw new WebhookError('invalid_url', 'Webhook-URL ist keine gültige URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new WebhookError('unsupported_protocol', 'Webhook-URL muss http oder https verwenden.');
  }
  if (url.username || url.password) {
    throw new WebhookError('credentials', 'Webhook-URL darf keine Zugangsdaten enthalten.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new WebhookError('invalid_url', 'Webhook-URL enthält keinen Host.');
  const allowlist = allowPrivateHosts();
  const allowed = allowlist.has(hostname);
  let addresses;
  try {
    addresses = await lookupImpl(hostname);
  } catch {
    throw new WebhookError('dns', 'Der Webhook-Host konnte nicht aufgelöst werden.');
  }
  const list = Array.isArray(addresses) ? addresses : [addresses];
  const resolved = list
    .map((entry) => (typeof entry === 'string' ? entry : entry?.address))
    .filter(Boolean);
  if (!resolved.length) throw new WebhookError('dns', 'Der Webhook-Host konnte nicht aufgelöst werden.');
  if (!allowed && resolved.some((address) => isPrivateAddress(address))) {
    throw new WebhookError('blocked', 'Webhook-Ziel ist privat, lokal oder ein Metadaten-Endpunkt und nicht erlaubt.');
  }
  return { url, hostname, addresses: resolved, allowed };
}

function parseEvents(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map(String).filter((entry) => WEBHOOK_EVENTS.includes(entry)))];
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function decryptUrl(row, dataDir) {
  return decryptIntegrationSecret(row.url_enc, 'webhook_url', { dataDir });
}

function decryptSecret(row, dataDir) {
  if (!row.secret_enc) return '';
  return decryptIntegrationSecret(row.secret_enc, 'webhook_secret', { dataDir });
}

function safeWebhook(row, { dataDir } = {}) {
  if (!row) return null;
  let host = '';
  try {
    host = hostFromUrl(decryptUrl(row, dataDir));
  } catch {
    host = '';
  }
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    events: parseEvents(row.events),
    enabled: Boolean(Number(row.enabled)),
    host,
    urlSet: Boolean(row.url_enc),
    secretSet: Boolean(row.secret_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listWebhooksSafe(db, { dataDir } = {}) {
  return db.prepare('SELECT * FROM webhooks ORDER BY created_at, id').all()
    .map((row) => safeWebhook(row, { dataDir }));
}

function getWebhookRow(db, id) {
  return db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) || null;
}

function webhooksForEvent(db, event) {
  return db.prepare('SELECT * FROM webhooks WHERE enabled = 1 ORDER BY created_at, id').all()
    .filter((row) => parseEvents(row.events).includes(event));
}

function webhooksConfiguredForEvent(db, event) {
  return webhooksForEvent(db, event).length > 0;
}

function buildWebhookPayload(format, { event, title, text, data = {}, timestamp = new Date().toISOString() } = {}) {
  const safeTitle = String(title || '').slice(0, 500);
  const safeText = String(text || '').slice(0, 4000);
  if (format === 'teams') {
    return {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      summary: safeTitle.slice(0, 200),
      themeColor: '0f766e',
      title: safeTitle.slice(0, 200),
      text: safeText.slice(0, 12000)
    };
  }
  if (format === 'discord') {
    const content = `**${safeTitle}**\n${safeText}`;
    return { content: content.slice(0, DISCORD_MAX_LENGTH) };
  }
  if (format === 'slack') {
    return { text: `*${safeTitle}*\n${safeText}`.slice(0, 4000) };
  }
  return {
    event,
    title: safeTitle,
    text: safeText,
    timestamp,
    data
  };
}

async function readLimitedBody(response) {
  if (!response?.body?.getReader) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.length || 0;
    }
  } catch {
    // Response bodies are never logged or used.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

function signatureFor(secret, timestamp, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;
}

async function sendOnce(url, body, headers, { fetchImpl, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new WebhookError('timeout', 'Webhook-Zeitüberschreitung.');
    }
    throw new WebhookError('network', 'Webhook-Ziel konnte nicht erreicht werden.');
  }
  await readLimitedBody(response);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new WebhookError('http', `Webhook-Ziel antwortete mit HTTP ${response.status}.`, { status: response.status });
    }
    return { redirect: location, status: response.status };
  }
  if (!response.ok) {
    throw new WebhookError('http', `Webhook-Ziel antwortete mit HTTP ${response.status}.`, { status: response.status });
  }
  return { ok: true, status: response.status };
}

async function deliverWebhook({ url, secret, format, message }, { fetchImpl = fetch, lookupImpl = defaultLookup, timeoutMs = TIMEOUT_MS } = {}) {
  const body = JSON.stringify(buildWebhookPayload(format, message));
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await validateWebhookTarget(currentUrl, { lookupImpl });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'AWO-Fuhrparkmanagement-Webhook/1.0',
      'X-AWO-Event': String(message?.event || ''),
      'X-AWO-Delivery': String(message?.delivery || '')
    };
    if (secret) {
      headers['X-AWO-Timestamp'] = timestamp;
      headers['X-AWO-Signature'] = signatureFor(secret, timestamp, body);
    }
    const result = await sendOnce(target.url.href, body, headers, { fetchImpl, timeoutMs });
    if (!result.redirect) return { ok: true, status: result.status };
    if (hop === MAX_REDIRECTS) throw new WebhookError('blocked', 'Zu viele Webhook-Weiterleitungen.');
    try {
      currentUrl = new URL(result.redirect, target.url).href;
    } catch {
      throw new WebhookError('blocked', 'Webhook-Weiterleitung ist ungültig.');
    }
  }
  throw new WebhookError('blocked', 'Webhook-Weiterleitung ist ungültig.');
}

function errorCodeFor(error) {
  if (error instanceof WebhookError) {
    if (error.code === 'timeout') return 'WEBHOOK_TIMEOUT';
    if (error.code === 'http' && error.status) return `WEBHOOK_HTTP_${error.status}`;
    if (['blocked', 'dns', 'redirect', 'invalid_url', 'unsupported_protocol', 'credentials'].includes(error.code)) {
      return 'WEBHOOK_BLOCKED';
    }
  }
  return 'WEBHOOK_ERROR';
}

function deliveryIsDue(delivery, nowMs) {
  if (!delivery) return true;
  if (delivery.status === 'sent') return false;
  const lastAttempt = Date.parse(delivery.last_attempt_at || delivery.updated_at || '');
  if (delivery.status === 'pending' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < PENDING_TIMEOUT_MS) return false;
  if (delivery.status === 'failed' && Number.isFinite(lastAttempt) && nowMs - lastAttempt < RETRY_AFTER_MS) return false;
  return true;
}

function upsertPending(db, { key, channel, vehicleId, kind, nowISO }) {
  db.prepare(`
    INSERT INTO notification_deliveries
      (dedupe_key, channel, vehicle_id, kind, status, attempts, last_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      status = 'pending',
      attempts = notification_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).run(key, channel, vehicleId || null, kind, nowISO, nowISO, nowISO);
}

function finishDelivery(db, key, status, errorCode, nowISO) {
  db.prepare(`
    UPDATE notification_deliveries
    SET status = ?, error_code = ?, last_attempt_at = ?, updated_at = ?
    WHERE dedupe_key = ?
  `).run(status, errorCode || null, nowISO, nowISO, key);
}

async function dispatchWebhooks(db, event, payload = {}, options = {}) {
  if (!WEBHOOK_EVENTS.includes(event)) return { sent: 0, failed: 0, skipped: 0 };
  const now = options.now || new Date();
  const nowISO = now.toISOString();
  const nowMs = now.getTime();
  const rows = webhooksForEvent(db, event);
  if (!rows.length) return { sent: 0, failed: 0, skipped: 0, noop: true };
  const dataDir = options.dataDir;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const key = `webhook:${row.id}:${event}:${payload.dedupeKey || nowISO}`;
    const delivery = db.prepare('SELECT * FROM notification_deliveries WHERE dedupe_key = ?').get(key);
    if (!deliveryIsDue(delivery, nowMs)) {
      skipped += 1;
      continue;
    }
    const channel = `webhook:${row.id}`;
    upsertPending(db, { key, channel, vehicleId: payload.vehicleId, kind: payload.kind || event, nowISO });
    try {
      const url = decryptUrl(row, dataDir);
      const secret = decryptSecret(row, dataDir);
      await deliverWebhook({
        url,
        secret,
        format: row.format,
        message: {
          event,
          title: payload.title,
          text: payload.text,
          data: payload.data || {},
          delivery: key
        }
      }, options);
      finishDelivery(db, key, 'sent', null, nowISO);
      writeAudit(db, {
        userId: options.actorId || null,
        action: 'webhook_delivery',
        entityType: 'webhook',
        entityId: row.id,
        details: { event, status: 'sent' }
      });
      sent += 1;
    } catch (error) {
      const code = errorCodeFor(error);
      finishDelivery(db, key, 'failed', code, nowISO);
      writeAudit(db, {
        userId: options.actorId || null,
        action: 'webhook_delivery',
        entityType: 'webhook',
        entityId: row.id,
        details: { event, status: 'failed', errorCode: code }
      });
      failed += 1;
    }
  }
  return { sent, failed, skipped };
}

async function testWebhook(db, id, options = {}) {
  const row = getWebhookRow(db, id);
  if (!row) return null;
  let result;
  try {
    const url = decryptUrl(row, options.dataDir);
    const secret = decryptSecret(row, options.dataDir);
    const delivered = await deliverWebhook({
      url,
      secret,
      format: row.format,
      message: {
        event: 'test',
        title: `Testnachricht: ${row.name}`,
        text: 'Diese Testnachricht bestätigt die Webhook-Konfiguration.',
        data: { test: true },
        delivery: `webhook-test:${row.id}:${Date.now()}`
      }
    }, options);
    result = { ok: true, status: delivered.status || 200, errorCode: null };
  } catch (error) {
    result = { ok: false, status: error?.status || null, errorCode: errorCodeFor(error) };
  }
  writeAudit(db, {
    userId: options.actorId || null,
    action: 'webhook_test',
    entityType: 'webhook',
    entityId: row.id,
    details: { ok: result.ok, errorCode: result.errorCode }
  });
  return result;
}

function normalizeName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new HttpError(400, 'Webhook-Name ist erforderlich.');
  return name;
}

function normalizeFormat(value, fallback = 'generic') {
  const format = String(value || fallback).trim().toLowerCase();
  if (!WEBHOOK_FORMATS.includes(format)) throw new HttpError(400, 'Unbekanntes Webhook-Format.');
  return format;
}

function normalizeEvents(value) {
  const events = parseEvents(value);
  if (!events.length) throw new HttpError(400, 'Mindestens ein Webhook-Event ist erforderlich.');
  return events;
}

function normalizeUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) throw new HttpError(400, 'Webhook-URL ist erforderlich.');
  return url;
}

async function createWebhook(db, input, { dataDir, lookupImpl } = {}) {
  const body = input || {};
  const name = normalizeName(body.name);
  const format = normalizeFormat(body.format);
  const events = normalizeEvents(body.events);
  const url = normalizeUrl(body.url);
  await validateWebhookTarget(url, { lookupImpl });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
  db.prepare(`
    INSERT INTO webhooks (id, name, url_enc, enabled, format, events, secret_enc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    encryptIntegrationSecret(url, 'webhook_url', { dataDir }),
    truthy(body.enabled ?? true) ? 1 : 0,
    format,
    JSON.stringify(events),
    secret ? encryptIntegrationSecret(secret, 'webhook_secret', { dataDir }) : null,
    now,
    now
  );
  return safeWebhook(getWebhookRow(db, id), { dataDir });
}

async function updateWebhook(db, id, input, { dataDir, lookupImpl } = {}) {
  const existing = getWebhookRow(db, id);
  if (!existing) throw new HttpError(404, 'Webhook wurde nicht gefunden.');
  const body = input || {};
  const values = { updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(body, 'name')) values.name = normalizeName(body.name);
  if (Object.prototype.hasOwnProperty.call(body, 'format')) values.format = normalizeFormat(body.format, existing.format);
  if (Object.prototype.hasOwnProperty.call(body, 'events')) values.events = JSON.stringify(normalizeEvents(body.events));
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) values.enabled = truthy(body.enabled) ? 1 : 0;
  if (Object.prototype.hasOwnProperty.call(body, 'url') && String(body.url ?? '').trim()) {
    const url = normalizeUrl(body.url);
    await validateWebhookTarget(url, { lookupImpl });
    values.url_enc = encryptIntegrationSecret(url, 'webhook_url', { dataDir });
  }
  if (body.clearSecret === true) values.secret_enc = null;
  else if (typeof body.secret === 'string' && body.secret.trim()) {
    values.secret_enc = encryptIntegrationSecret(body.secret.trim(), 'webhook_secret', { dataDir });
  }
  const assignments = Object.keys(values).map((column) => `${column} = ?`).join(', ');
  db.prepare(`UPDATE webhooks SET ${assignments} WHERE id = ?`).run(...Object.values(values), id);
  return safeWebhook(getWebhookRow(db, id), { dataDir });
}

function deleteWebhook(db, id) {
  const existing = getWebhookRow(db, id);
  if (!existing) return null;
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  return safeWebhook(existing);
}

module.exports = {
  RETRY_AFTER_MS,
  PENDING_TIMEOUT_MS,
  TIMEOUT_MS,
  MAX_REDIRECTS,
  DISCORD_MAX_LENGTH,
  WEBHOOK_FORMATS,
  WEBHOOK_EVENTS,
  WebhookError,
  isPrivateAddress,
  validateWebhookTarget,
  buildWebhookPayload,
  signatureFor,
  errorCodeFor,
  listWebhooksSafe,
  getWebhookRow,
  webhooksForEvent,
  webhooksConfiguredForEvent,
  safeWebhook,
  dispatchWebhooks,
  deliverWebhook,
  testWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook
};
