'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { writeAudit } = require('./audit');

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const FLOW_TTL_MS = 10 * 60 * 1000;
const ALGORITHMS = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512'
};
const discoveryCache = new Map();
const jwksCache = new Map();

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function normalizeIssuer(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function splitList(value) {
  return [...new Set(String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean))];
}

function getSsoConfig() {
  const enabled = truthy(process.env.SSO_ENABLED);
  const issuer = normalizeIssuer(process.env.SSO_ISSUER);
  const clientId = String(process.env.SSO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SSO_CLIENT_SECRET || '');
  const redirectUri = String(process.env.SSO_REDIRECT_URI || '').trim();
  const scopes = String(process.env.SSO_SCOPES || 'openid profile email').trim();
  const allowedDomains = splitList(process.env.SSO_ALLOWED_DOMAINS).map((entry) => entry.toLowerCase());
  const autoProvision = truthy(process.env.SSO_AUTO_PROVISION);
  const defaultRole = String(process.env.SSO_DEFAULT_ROLE || 'manager').trim();
  const groupClaim = String(process.env.SSO_GROUP_CLAIM || 'groups').trim();
  const adminGroup = String(process.env.SSO_ADMIN_GROUP || '').trim();
  const managerGroup = String(process.env.SSO_MANAGER_GROUP || '').trim();
  const missing = [];
  if (!issuer) missing.push('SSO_ISSUER');
  if (!clientId) missing.push('SSO_CLIENT_ID');
  if (!redirectUri) missing.push('SSO_REDIRECT_URI');
  return {
    enabled,
    configured: enabled && missing.length === 0,
    missing,
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    allowedDomains,
    autoProvision,
    defaultRole,
    groupClaim,
    adminGroup,
    managerGroup
  };
}

function activeAdminCount(db, exceptUserId = null) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM users
    WHERE role = 'admin' AND active = 1 AND anonymized_at IS NULL AND id <> ?
  `).get(exceptUserId || '').count;
}

function roleFromGroups(config, groups) {
  const values = new Set((Array.isArray(groups) ? groups : [groups]).map(String));
  if (config.adminGroup && values.has(config.adminGroup)) return 'admin';
  if (config.managerGroup && values.has(config.managerGroup)) return 'manager';
  return null;
}

function normalizeGroups(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,\s]+/).map(String).filter(Boolean);
  return [];
}

function randomFlowValue() {
  return crypto.randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('sso_provider_error');
  return response.json();
}

async function getDiscovery(config, { fetchImpl = fetch, now = Date.now() } = {}) {
  const cached = discoveryCache.get(config.issuer);
  if (cached && now - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.value;
  const value = await fetchJson(fetchImpl, `${config.issuer}/.well-known/openid-configuration`);
  if (!value?.authorization_endpoint || !value?.token_endpoint || !value?.jwks_uri) {
    throw new Error('sso_discovery_invalid');
  }
  discoveryCache.set(config.issuer, { value, fetchedAt: now });
  return value;
}

async function getJwks(uri, { fetchImpl = fetch, now = Date.now() } = {}) {
  const cached = jwksCache.get(uri);
  if (cached && now - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.value;
  const value = await fetchJson(fetchImpl, uri);
  if (!Array.isArray(value?.keys)) throw new Error('sso_jwks_invalid');
  jwksCache.set(uri, { value: value.keys, fetchedAt: now });
  return value.keys;
}

function clearSsoCache() {
  discoveryCache.clear();
  jwksCache.clear();
}

async function verifyIdToken(idToken, config, { nonce, now = Date.now(), fetchImpl = fetch } = {}) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'invalid_token' };
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'invalid_token' };
  }
  if (!ALGORITHMS[header.alg] || !header.kid) return { valid: false, reason: 'invalid_algorithm' };
  const discovery = await getDiscovery(config, { fetchImpl, now });
  const keys = await getJwks(discovery.jwks_uri, { fetchImpl, now });
  const jwk = keys.find((entry) => entry.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) return { valid: false, reason: 'unknown_key' };
  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return { valid: false, reason: 'invalid_key' };
  }
  const signatureValid = crypto.verify(
    ALGORITHMS[header.alg],
    Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
    key,
    Buffer.from(parts[2], 'base64url')
  );
  if (!signatureValid) return { valid: false, reason: 'invalid_signature' };

  const nowSeconds = Math.floor(now / 1000);
  if (normalizeIssuer(payload.iss) !== config.issuer) return { valid: false, reason: 'issuer' };
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(config.clientId)) return { valid: false, reason: 'audience' };
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= nowSeconds - 60) {
    return { valid: false, reason: 'expired' };
  }
  if (payload.nbf !== undefined && Number(payload.nbf) > nowSeconds + 60) {
    return { valid: false, reason: 'not_yet_valid' };
  }
  if (String(payload.nonce || '') !== String(nonce || '')) return { valid: false, reason: 'nonce' };
  if (payload.email_verified !== undefined && payload.email_verified !== true && payload.email_verified !== 'true') {
    return { valid: false, reason: 'unverified_email' };
  }
  const email = String(payload.email || payload.preferred_username || payload.upn || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { valid: false, reason: 'email' };
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (config.allowedDomains.length && !config.allowedDomains.includes(domain)) {
    return { valid: false, reason: 'domain' };
  }
  if (!payload.sub) return { valid: false, reason: 'subject' };
  return {
    valid: true,
    claims: {
      sub: String(payload.sub),
      email,
      name: String(payload.name || email.split('@')[0]).slice(0, 120),
      groups: normalizeGroups(payload[config.groupClaim])
    }
  };
}

async function buildAuthorizationUrl(config, flow, { fetchImpl = fetch, now = Date.now() } = {}) {
  const discovery = await getDiscovery(config, { fetchImpl, now });
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', flow.state);
  url.searchParams.set('nonce', flow.nonce);
  url.searchParams.set('code_challenge', pkceChallenge(flow.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('response_mode', 'query');
  return url.toString();
}

async function exchangeCode(config, code, codeVerifier, { fetchImpl = fetch, now = Date.now() } = {}) {
  const discovery = await getDiscovery(config, { fetchImpl, now });
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('sso_token_exchange_failed');
  const data = await response.json();
  if (typeof data?.id_token !== 'string') throw new Error('sso_id_token_missing');
  return data.id_token;
}

function upsertSsoLink(db, userId, config, claims, nowISO) {
  db.prepare(`
    INSERT INTO user_sso (user_id, issuer, subject, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      issuer = excluded.issuer,
      subject = excluded.subject,
      email = excluded.email,
      updated_at = excluded.updated_at
  `).run(userId, config.issuer, claims.sub, claims.email, nowISO, nowISO);
}

function applyRoleMapping(db, config, user, claims, nowISO) {
  const mapped = roleFromGroups(config, claims.groups);
  let roleChanged = false;
  if (mapped && mapped !== user.role && mapped !== 'superadmin') {
    const canDemoteAdmin = user.role !== 'admin'
      || mapped === 'admin'
      || activeAdminCount(db, user.id) > 0;
    if (canDemoteAdmin) {
      db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(mapped, nowISO, user.id);
      roleChanged = true;
    }
  }
  return { roleChanged, role: roleChanged ? mapped : user.role };
}

function resolveSsoUser(db, config, claims, { now = new Date() } = {}) {
  const nowISO = now.toISOString();
  const linked = db.prepare(`
    SELECT u.* FROM user_sso s JOIN users u ON u.id = s.user_id
    WHERE s.issuer = ? AND s.subject = ?
  `).get(config.issuer, claims.sub);
  if (linked) {
    if (!linked.active || linked.anonymized_at || linked.role === 'superadmin') {
      return { ok: false, reason: 'account_unavailable' };
    }
    db.prepare('UPDATE user_sso SET email = ?, updated_at = ? WHERE user_id = ?')
      .run(claims.email, nowISO, linked.id);
    const mapped = applyRoleMapping(db, config, linked, claims, nowISO);
    return { ok: true, user: db.prepare('SELECT * FROM users WHERE id = ?').get(linked.id), provisioned: false, ...mapped };
  }

  const byEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(claims.email);
  if (byEmail) {
    if (!byEmail.active || byEmail.anonymized_at || byEmail.role === 'superadmin') {
      return { ok: false, reason: 'account_unavailable' };
    }
    const conflict = db.prepare('SELECT user_id FROM user_sso WHERE issuer = ? AND subject = ? AND user_id <> ?')
      .get(config.issuer, claims.sub, byEmail.id);
    if (conflict) return { ok: false, reason: 'link_conflict' };
    upsertSsoLink(db, byEmail.id, config, claims, nowISO);
    const mapped = applyRoleMapping(db, config, byEmail, claims, nowISO);
    return { ok: true, user: db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id), provisioned: false, ...mapped };
  }

  if (!config.autoProvision) return { ok: false, reason: 'no_account' };
  const mapped = roleFromGroups(config, claims.groups);
  const role = mapped || config.defaultRole;
  const roleRow = db.prepare('SELECT id FROM roles WHERE id = ?').get(role);
  if (!roleRow || role === 'superadmin') return { ok: false, reason: 'role' };
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('base64url'), 12);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, claims.email, claims.name, passwordHash, role, nowISO, nowISO);
    upsertSsoLink(db, id, config, claims, nowISO);
  })();
  return {
    ok: true,
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    provisioned: true,
    roleChanged: false,
    role
  };
}

function auditSsoFailure(db, reason) {
  writeAudit(db, {
    userId: null,
    action: 'sso_failed',
    entityType: 'sso',
    details: { reason: String(reason || 'failed').slice(0, 80) }
  });
}

module.exports = {
  FLOW_TTL_MS,
  getSsoConfig,
  roleFromGroups,
  randomFlowValue,
  pkceChallenge,
  getDiscovery,
  clearSsoCache,
  verifyIdToken,
  buildAuthorizationUrl,
  exchangeCode,
  resolveSsoUser,
  auditSsoFailure
};
