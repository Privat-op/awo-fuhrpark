'use strict';

const { isoNow } = require('./validation');
const { createLogger } = require('./logger');

const logger = createLogger('audit');

const SECRET_KEYS = new Set([
  'password', 'passwords', 'passwort', 'passwordhash', 'hash', 'token', 'tokens', 'accesstoken', 'refreshtoken',
  'csrf', 'csrftoken', 'cookie', 'cookies', 'session', 'sessions', 'sessionid', 'sid',
  'ip', 'ipaddress', 'clientip', 'remoteip', 'authorization', 'secret', 'apikey'
]);

function isSecretKey(key) {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SECRET_KEYS.has(normalized) || /(hash|token|secret|password)$/.test(normalized);
}

function sanitizeDetailsForStorage(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((entry) => sanitizeDetailsForStorage(entry, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSecretKey(key)) continue;
      result[key] = sanitizeDetailsForStorage(entry, depth + 1);
    }
    return result;
  }
  return value;
}

function writeAudit(db, {
  userId = null,
  action,
  entityType,
  entityId = null,
  details = null,
  isMeta = false
}) {
  try {
    let actorRoleId = null;
    let actorRoleName = null;
    let actorRank = null;
    if (userId) {
      const actor = db.prepare(`
        SELECT u.role, r.name AS role_name, r.rank
        FROM users u
        LEFT JOIN roles r ON r.id = u.role
        WHERE u.id = ?
      `).get(userId);
      if (actor) {
        actorRoleId = actor.role || null;
        actorRoleName = actor.role_name || null;
        actorRank = actor.rank === null || actor.rank === undefined ? null : Number(actor.rank);
      }
    }
    const storedDetails = details ? JSON.stringify(sanitizeDetailsForStorage(details)) : null;
    db.prepare(`
      INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, details, actor_role_id, actor_role_name, actor_rank, is_meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      action,
      entityType,
      entityId,
      storedDetails,
      actorRoleId,
      actorRoleName,
      actorRank,
      isMeta ? 1 : 0,
      isoNow()
    );
  } catch (error) {
    logger.warn('Audit-Log konnte nicht geschrieben werden.', { error });
  }
}

module.exports = { writeAudit };
