'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./validation');
const { getRetentionSettings } = require('./retention');
const { encryptIntegrationSecret, decryptIntegrationSecret } = require('./integrations-crypto');
const { listWebhooksSafe } = require('./webhooks');

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const MIN_INTERVAL_MS = 60000;
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  sso_enabled: 0,
  sso_issuer: '',
  sso_client_id: '',
  sso_client_secret_enc: null,
  sso_redirect_uri: '',
  sso_scopes: 'openid profile email',
  sso_allowed_domains: '',
  sso_auto_provision: 0,
  sso_default_role: 'user',
  sso_group_claim: 'groups',
  sso_admin_group: '',
  sso_manager_group: '',
  teams_enabled: 0,
  teams_webhook_enc: null,
  teams_send_leasing: 1,
  teams_send_booking_requests: 1,
  teams_send_maintenance: 1,
  clamav_enabled: 0,
  clamav_host: '127.0.0.1',
  clamav_port: 3310,
  clamav_fail_closed: 1,
  webauthn_rp_id: '',
  webauthn_rp_name: '',
  webauthn_origin: '',
  webauthn_enabled: 1,
  locations_enabled: 0,
  app_base_url: '',
  leasing_scheduler_enabled: 1,
  leasing_interval_ms: 21600000,
  leasing_initial_delay_ms: 5000,
  leasing_debounce_ms: 3000,
  reminder_scheduler_enabled: 1,
  reminder_interval_ms: 21600000,
  reminder_initial_delay_ms: 5000,
  retention_scheduler_enabled: 1,
  retention_interval_ms: 86400000,
  retention_initial_delay_ms: 10000,
  updated_at: null
};

function truthy(value) {
  return TRUTHY.has(String(value || '').toLowerCase());
}

function envValue(name) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) return null;
  const value = String(process.env[name] ?? '').trim();
  return value === '' ? null : value;
}

function tableAvailable(db) {
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'integration_settings'").get());
  } catch {
    return false;
  }
}

function rowFor(db) {
  if (!tableAvailable(db)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...db.prepare('SELECT * FROM integration_settings WHERE id = 1').get() };
  } catch {
    return { ...DEFAULTS };
  }
}

function pick(dbValue, envName, parse = (value) => value) {
  const env = envValue(envName);
  if (env !== null) return { value: parse(env), source: 'env' };
  return { value: parse(dbValue), source: 'db' };
}

function splitList(value) {
  return [...new Set(String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeIssuer(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseOrigins(value) {
  const origins = [];
  for (const raw of splitList(value)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    origins.push(url.origin);
  }
  return origins;
}

function validHttpUrl(value, { allowPath = true } = {}) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    if (!url.hostname) return false;
    if (!allowPath && (url.pathname !== '/' || url.search || url.hash)) return false;
    return true;
  } catch {
    return false;
  }
}

function webAuthnValid(rpID, origins) {
  if (!rpID || !/^[a-z0-9.-]+$/i.test(rpID) || rpID.startsWith('.') || rpID.endsWith('.') || rpID.includes('..')) {
    return false;
  }
  const parsed = parseOrigins(origins);
  if (!parsed || !parsed.length) return false;
  return parsed.every((origin) => {
    const host = new URL(origin).hostname;
    return host === rpID || host.endsWith(`.${rpID}`);
  });
}

function readSecret(row, column, field, envName, dataDir) {
  const env = envValue(envName);
  if (env !== null) return { value: env, source: 'env' };
  if (!row[column]) return { value: '', source: 'none' };
  try {
    return { value: decryptIntegrationSecret(row[column], field, { dataDir }), source: 'db' };
  } catch {
    return { value: '', source: 'error' };
  }
}

function getSsoIntegrationConfig(db, { dataDir } = {}) {
  const row = rowFor(db);
  const enabled = pick(row.sso_enabled, 'SSO_ENABLED', truthy);
  const issuer = pick(row.sso_issuer, 'SSO_ISSUER', normalizeIssuer);
  const clientId = pick(row.sso_client_id, 'SSO_CLIENT_ID', (value) => String(value || '').trim());
  const redirectUri = pick(row.sso_redirect_uri, 'SSO_REDIRECT_URI', (value) => String(value || '').trim());
  const scopes = pick(row.sso_scopes, 'SSO_SCOPES', (value) => String(value || '').trim());
  const allowedDomains = pick(row.sso_allowed_domains, 'SSO_ALLOWED_DOMAINS', (value) => String(value || ''));
  const autoProvision = pick(row.sso_auto_provision, 'SSO_AUTO_PROVISION', truthy);
  const defaultRole = pick(row.sso_default_role, 'SSO_DEFAULT_ROLE', (value) => String(value || '').trim());
  const groupClaim = pick(row.sso_group_claim, 'SSO_GROUP_CLAIM', (value) => String(value || '').trim());
  const adminGroup = pick(row.sso_admin_group, 'SSO_ADMIN_GROUP', (value) => String(value || '').trim());
  const managerGroup = pick(row.sso_manager_group, 'SSO_MANAGER_GROUP', (value) => String(value || '').trim());
  const secret = readSecret(row, 'sso_client_secret_enc', 'sso_client_secret', 'SSO_CLIENT_SECRET', dataDir);

  const missing = [];
  if (!issuer.value) missing.push('SSO_ISSUER');
  if (!clientId.value) missing.push('SSO_CLIENT_ID');
  if (!redirectUri.value) missing.push('SSO_REDIRECT_URI');

  return {
    enabled: enabled.value,
    configured: enabled.value && missing.length === 0,
    missing,
    issuer: issuer.value,
    clientId: clientId.value,
    clientSecret: secret.value,
    secretSource: secret.source,
    redirectUri: redirectUri.value,
    scopes: scopes.value || 'openid profile email',
    allowedDomains: splitList(allowedDomains.value).map((entry) => entry.toLowerCase()),
    autoProvision: autoProvision.value,
    defaultRole: defaultRole.value || 'user',
    groupClaim: groupClaim.value || 'groups',
    adminGroup: adminGroup.value,
    managerGroup: managerGroup.value,
    envLocked: {
      enabled: enabled.source === 'env',
      issuer: issuer.source === 'env',
      clientId: clientId.source === 'env',
      clientSecret: secret.source === 'env',
      redirectUri: redirectUri.source === 'env',
      scopes: scopes.source === 'env',
      allowedDomains: allowedDomains.source === 'env',
      autoProvision: autoProvision.source === 'env',
      defaultRole: defaultRole.source === 'env',
      groupClaim: groupClaim.source === 'env',
      adminGroup: adminGroup.source === 'env',
      managerGroup: managerGroup.source === 'env'
    }
  };
}

function getTeamsIntegrationConfig(db, { dataDir } = {}) {
  const row = rowFor(db);
  const webhook = readSecret(row, 'teams_webhook_enc', 'teams_webhook_url', 'TEAMS_WEBHOOK_URL', dataDir);
  const enabledEnv = envValue('TEAMS_ENABLED');
  // A webhook supplied via environment keeps the legacy behaviour (active without TEAMS_ENABLED).
  const enabled = enabledEnv !== null
    ? truthy(enabledEnv)
    : (Boolean(Number(row.teams_enabled ?? 0)) || (webhook.source === 'env' && Boolean(webhook.value)));
  return {
    enabled,
    webhookUrl: webhook.value,
    secretSource: webhook.source,
    sendLeasing: Boolean(Number(row.teams_send_leasing ?? 1)),
    sendBookingRequests: Boolean(Number(row.teams_send_booking_requests ?? 1)),
    sendMaintenance: Boolean(Number(row.teams_send_maintenance ?? 1)),
    envLocked: {
      enabled: enabledEnv !== null,
      webhookUrl: webhook.source === 'env'
    },
    configured: Boolean(enabled && webhook.value)
  };
}

function getClamavIntegrationConfig(db) {
  const row = rowFor(db);
  const enabled = pick(row.clamav_enabled, 'VIRUS_SCAN_ENABLED', truthy);
  const host = pick(row.clamav_host, 'CLAMAV_HOST', (value) => String(value || '').trim());
  const port = pick(row.clamav_port, 'CLAMAV_PORT', (value) => Number(value));
  const failClosed = pick(row.clamav_fail_closed, 'VIRUS_SCAN_FAIL_CLOSED', truthy);
  const portValue = Number.isInteger(port.value) && port.value > 0 ? port.value : 3310;
  return {
    enabled: enabled.value,
    host: host.value || '127.0.0.1',
    port: portValue,
    failClosed: failClosed.value,
    envLocked: {
      enabled: enabled.source === 'env',
      host: host.source === 'env',
      port: port.source === 'env',
      failClosed: failClosed.source === 'env'
    }
  };
}

function getWebAuthnIntegrationConfig(db) {
  const row = rowFor(db);
  const rpID = pick(row.webauthn_rp_id, 'WEBAUTHN_RP_ID', (value) => String(value || '').trim().toLowerCase());
  const rpName = pick(row.webauthn_rp_name, 'WEBAUTHN_RP_NAME', (value) => String(value || '').trim());
  const origins = pick(row.webauthn_origin, 'WEBAUTHN_ORIGIN', (value) => String(value || '').trim());
  const parsed = parseOrigins(origins.value);
  let reason = '';
  if (!rpID.value || !rpName.value || !origins.value) reason = 'WebAuthn ist nicht konfiguriert.';
  else if (!rpID.value || !/^[a-z0-9.-]+$/.test(rpID.value) || rpID.value.startsWith('.') || rpID.value.endsWith('.') || rpID.value.includes('..')) {
    reason = 'WEBAUTHN_RP_ID ist ungültig.';
  } else if (!parsed || !parsed.length) reason = 'WEBAUTHN_ORIGIN ist ungültig.';
  else if (!webAuthnValid(rpID.value, origins.value)) reason = 'WEBAUTHN_ORIGIN passt nicht zu WEBAUTHN_RP_ID.';
  const enabledFlag = Boolean(Number(row.webauthn_enabled ?? 1));
  return {
    enabled: enabledFlag && !reason,
    enabledFlag,
    configured: !reason,
    reason: reason || (enabledFlag ? null : 'WebAuthn ist deaktiviert.'),
    rpID: rpID.value,
    rpName: rpName.value,
    origins: parsed ? [...new Set(parsed)] : [],
    rawOrigins: origins.value,
    envLocked: {
      rpID: rpID.source === 'env',
      rpName: rpName.source === 'env',
      origins: origins.source === 'env'
    }
  };
}

function getLocationsIntegrationConfig(db) {
  const row = rowFor(db);
  const enabled = pick(row.locations_enabled, 'LOCATIONS_ENABLED', truthy);
  return {
    enabled: enabled.value,
    envLocked: { enabled: enabled.source === 'env' }
  };
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getAppBaseUrlConfig(db) {
  const row = rowFor(db);
  const env = envValue('APP_BASE_URL');
  return {
    value: normalizeBaseUrl(env !== null ? env : row.app_base_url),
    source: env !== null ? 'env' : 'db',
    envLocked: env !== null
  };
}

function getAppBaseUrl(db) {
  return getAppBaseUrlConfig(db).value;
}

function schedulerEnabledSetting(rowValue, envName) {
  const env = envValue(envName);
  if (env !== null) return { value: !truthy(env), source: 'env' };
  return { value: Boolean(Number(rowValue ?? 1)), source: 'db' };
}

function numericSetting(rowValue, envName, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const env = envValue(envName);
  const raw = env !== null ? Number(env) : Number(rowValue);
  const value = Number.isFinite(raw) ? raw : fallback;
  return { value: Math.min(max, Math.max(min, Math.trunc(value))), source: env !== null ? 'env' : 'db' };
}

function schedulerConfig(row, prefix, envPrefix, defaults) {
  const enabled = schedulerEnabledSetting(row[`${prefix}_scheduler_enabled`], `${envPrefix}_SCHEDULER_DISABLED`);
  const interval = numericSetting(row[`${prefix}_interval_ms`], `${envPrefix}_INTERVAL_MS`, defaults.intervalMs, {
    min: MIN_INTERVAL_MS,
    max: MAX_INTERVAL_MS
  });
  const initialDelay = numericSetting(row[`${prefix}_initial_delay_ms`], `${envPrefix}_INITIAL_DELAY_MS`, defaults.initialDelayMs, {
    min: 0,
    max: MAX_DELAY_MS
  });
  return {
    enabled: enabled.value,
    intervalMs: interval.value,
    initialDelayMs: initialDelay.value,
    envLocked: {
      enabled: enabled.source === 'env',
      intervalMs: interval.source === 'env',
      initialDelayMs: initialDelay.source === 'env'
    }
  };
}

function getLeasingSchedulerConfig(db) {
  const row = rowFor(db);
  const config = schedulerConfig(row, 'leasing', 'LEASING', { intervalMs: 21600000, initialDelayMs: 5000 });
  const debounce = numericSetting(row.leasing_debounce_ms, 'LEASING_DEBOUNCE_MS', 3000, {
    min: 0,
    max: 60 * 60 * 1000
  });
  return {
    ...config,
    debounceMs: debounce.value,
    envLocked: { ...config.envLocked, debounceMs: debounce.source === 'env' }
  };
}

function getReminderSchedulerConfig(db) {
  return schedulerConfig(rowFor(db), 'reminder', 'REMINDER', { intervalMs: 21600000, initialDelayMs: 5000 });
}

function getRetentionSchedulerConfig(db) {
  return schedulerConfig(rowFor(db), 'retention', 'RETENTION', { intervalMs: 86400000, initialDelayMs: 10000 });
}

function defaultDataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
}

function keySource(envName, fileName) {
  if (envValue(envName) !== null) return 'env';
  try {
    return fs.existsSync(path.join(defaultDataDir(), fileName)) ? 'file' : 'missing';
  } catch {
    return 'missing';
  }
}

function getSystemStatus() {
  const superadminFile = envValue('SUPERADMIN_FILE');
  let superadminExists = false;
  if (superadminFile) {
    try {
      superadminExists = fs.existsSync(path.resolve(superadminFile));
    } catch {
      superadminExists = false;
    }
  }
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 3000,
    dataDir: defaultDataDir(),
    trustProxy: process.env.TRUST_PROXY || '0',
    cookieSecure: truthy(process.env.COOKIE_SECURE),
    superadminFile: {
      configured: Boolean(superadminFile),
      exists: superadminExists
    },
    mfaKeySource: keySource('MFA_ENCRYPTION_KEY', 'mfa.key'),
    integrationsKeySource: keySource('INTEGRATIONS_ENCRYPTION_KEY', 'integrations.key')
  };
}

function safeIntegrationsConfig(db, { dataDir } = {}) {
  const sso = getSsoIntegrationConfig(db, { dataDir });
  const teams = getTeamsIntegrationConfig(db, { dataDir });
  const clamav = getClamavIntegrationConfig(db);
  const webauthn = getWebAuthnIntegrationConfig(db);
  const locations = getLocationsIntegrationConfig(db);
  return {
    sso: {
      enabled: sso.enabled,
      configured: sso.configured,
      issuer: sso.issuer,
      clientId: sso.clientId,
      clientSecretSet: Boolean(sso.clientSecret),
      secretSource: sso.secretSource,
      redirectUri: sso.redirectUri,
      scopes: sso.scopes,
      allowedDomains: sso.allowedDomains.join(', '),
      autoProvision: sso.autoProvision,
      defaultRole: sso.defaultRole,
      groupClaim: sso.groupClaim,
      adminGroup: sso.adminGroup,
      managerGroup: sso.managerGroup,
      envLocked: sso.envLocked
    },
    teams: {
      enabled: teams.enabled,
      configured: teams.configured,
      webhookSet: Boolean(teams.webhookUrl),
      secretSource: teams.secretSource,
      sendLeasing: teams.sendLeasing,
      sendBookingRequests: teams.sendBookingRequests,
      sendMaintenance: teams.sendMaintenance,
      envLocked: teams.envLocked
    },
    clamav: {
      enabled: clamav.enabled,
      host: clamav.host,
      port: clamav.port,
      failClosed: clamav.failClosed,
      envLocked: clamav.envLocked
    },
    webauthn: {
      enabled: webauthn.enabled,
      enabledFlag: webauthn.enabledFlag,
      configured: webauthn.configured,
      reason: webauthn.reason,
      rpID: webauthn.rpID,
      rpName: webauthn.rpName,
      origins: webauthn.rawOrigins,
      envLocked: webauthn.envLocked
    },
    locations: {
      enabled: locations.enabled,
      envLocked: locations.envLocked
    },
    advanced: {
      appBaseUrl: getAppBaseUrlConfig(db),
      leasing: getLeasingSchedulerConfig(db),
      reminder: getReminderSchedulerConfig(db),
      retention: getRetentionSchedulerConfig(db)
    },
    webhooks: (() => {
      try {
        return listWebhooksSafe(db);
      } catch {
        return [];
      }
    })(),
    system: getSystemStatus(),
    retention: getRetentionSettings(db)
  };
}

function assertSsoValid(db, config) {
  if (!config.enabled) return;
  if (!config.issuer || !validHttpUrl(config.issuer)) {
    throw new HttpError(400, 'SSO-Issuer muss eine gültige http(s)-URL sein.');
  }
  if (!config.clientId) throw new HttpError(400, 'SSO-Client-ID ist erforderlich.');
  if (!config.redirectUri || !validHttpUrl(config.redirectUri)) {
    throw new HttpError(400, 'SSO-Redirect-URI muss eine gültige http(s)-URL sein.');
  }
  if (!config.scopes) throw new HttpError(400, 'SSO-Scopes dürfen nicht leer sein.');
  if (config.defaultRole === 'superadmin') {
    throw new HttpError(400, 'SSO darf niemals Superadmin als Default-Rolle verwenden.');
  }
  if (config.autoProvision && config.defaultRole
    && !db.prepare('SELECT id FROM roles WHERE id = ?').get(config.defaultRole)) {
    throw new HttpError(400, 'Die SSO-Default-Rolle existiert nicht.');
  }
}

function assertTeamsValid(config) {
  if (!config.enabled) return;
  if (!config.webhookUrl || !validHttpUrl(config.webhookUrl)) {
    throw new HttpError(400, 'Teams-Webhook muss eine gültige http(s)-URL sein.');
  }
}

function assertClamavValid(config) {
  if (!config.enabled) return;
  if (!config.host) throw new HttpError(400, 'ClamAV-Host ist erforderlich.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new HttpError(400, 'ClamAV-Port muss zwischen 1 und 65535 liegen.');
  }
}

function assertWebAuthnValid(config) {
  if (!config.rpID && !config.rpName && !config.rawOrigins) return;
  if (!config.rpID || !config.rpName || !config.rawOrigins) {
    throw new HttpError(400, 'WebAuthn benötigt RP-ID, RP-Name und Origin.');
  }
  if (!webAuthnValid(config.rpID, config.rawOrigins)) {
    throw new HttpError(400, 'WebAuthn-Origin passt nicht zur RP-ID.');
  }
}

// Fields that may be changed through the admin API. ENV-set fields are ignored.
const FIELD_MAP = [
  ['ssoEnabled', 'sso_enabled', 'SSO_ENABLED', 'bool'],
  ['ssoIssuer', 'sso_issuer', 'SSO_ISSUER', 'string'],
  ['ssoClientId', 'sso_client_id', 'SSO_CLIENT_ID', 'string'],
  ['ssoRedirectUri', 'sso_redirect_uri', 'SSO_REDIRECT_URI', 'string'],
  ['ssoScopes', 'sso_scopes', 'SSO_SCOPES', 'string'],
  ['ssoAllowedDomains', 'sso_allowed_domains', 'SSO_ALLOWED_DOMAINS', 'string'],
  ['ssoAutoProvision', 'sso_auto_provision', 'SSO_AUTO_PROVISION', 'bool'],
  ['ssoDefaultRole', 'sso_default_role', 'SSO_DEFAULT_ROLE', 'string'],
  ['ssoGroupClaim', 'sso_group_claim', 'SSO_GROUP_CLAIM', 'string'],
  ['ssoAdminGroup', 'sso_admin_group', 'SSO_ADMIN_GROUP', 'string'],
  ['ssoManagerGroup', 'sso_manager_group', 'SSO_MANAGER_GROUP', 'string'],
  ['teamsEnabled', 'teams_enabled', 'TEAMS_ENABLED', 'bool'],
  ['teamsSendLeasing', 'teams_send_leasing', null, 'bool'],
  ['teamsSendBookingRequests', 'teams_send_booking_requests', null, 'bool'],
  ['teamsSendMaintenance', 'teams_send_maintenance', null, 'bool'],
  ['clamavEnabled', 'clamav_enabled', 'VIRUS_SCAN_ENABLED', 'bool'],
  ['clamavHost', 'clamav_host', 'CLAMAV_HOST', 'string'],
  ['clamavPort', 'clamav_port', 'CLAMAV_PORT', 'int', { min: 1, max: 65535, label: 'ClamAV-Port' }],
  ['clamavFailClosed', 'clamav_fail_closed', 'VIRUS_SCAN_FAIL_CLOSED', 'bool'],
  ['webauthnEnabled', 'webauthn_enabled', null, 'bool'],
  ['webauthnRpId', 'webauthn_rp_id', 'WEBAUTHN_RP_ID', 'string'],
  ['webauthnRpName', 'webauthn_rp_name', 'WEBAUTHN_RP_NAME', 'string'],
  ['webauthnOrigin', 'webauthn_origin', 'WEBAUTHN_ORIGIN', 'string'],
  ['locationsEnabled', 'locations_enabled', 'LOCATIONS_ENABLED', 'bool'],
  ['appBaseUrl', 'app_base_url', 'APP_BASE_URL', 'string', { baseUrl: true }],
  ['leasingSchedulerEnabled', 'leasing_scheduler_enabled', 'LEASING_SCHEDULER_DISABLED', 'bool'],
  ['leasingIntervalMs', 'leasing_interval_ms', 'LEASING_INTERVAL_MS', 'int', { min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS, label: 'Leasing-Intervall' }],
  ['leasingInitialDelayMs', 'leasing_initial_delay_ms', 'LEASING_INITIAL_DELAY_MS', 'int', { min: 0, max: MAX_DELAY_MS, label: 'Leasing-Startverzögerung' }],
  ['leasingDebounceMs', 'leasing_debounce_ms', 'LEASING_DEBOUNCE_MS', 'int', { min: 0, max: 60 * 60 * 1000, label: 'Leasing-Debounce' }],
  ['reminderSchedulerEnabled', 'reminder_scheduler_enabled', 'REMINDER_SCHEDULER_DISABLED', 'bool'],
  ['reminderIntervalMs', 'reminder_interval_ms', 'REMINDER_INTERVAL_MS', 'int', { min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS, label: 'Wartungs-Intervall' }],
  ['reminderInitialDelayMs', 'reminder_initial_delay_ms', 'REMINDER_INITIAL_DELAY_MS', 'int', { min: 0, max: MAX_DELAY_MS, label: 'Wartungs-Startverzögerung' }],
  ['retentionSchedulerEnabled', 'retention_scheduler_enabled', 'RETENTION_SCHEDULER_DISABLED', 'bool'],
  ['retentionIntervalMs', 'retention_interval_ms', 'RETENTION_INTERVAL_MS', 'int', { min: MIN_INTERVAL_MS, max: MAX_INTERVAL_MS, label: 'Retention-Intervall' }],
  ['retentionInitialDelayMs', 'retention_initial_delay_ms', 'RETENTION_INITIAL_DELAY_MS', 'int', { min: 0, max: MAX_DELAY_MS, label: 'Retention-Startverzögerung' }]
];

function updateIntegrations(db, input, { dataDir } = {}) {
  if (!tableAvailable(db)) throw new HttpError(503, 'Integrations-Einstellungen sind nicht verfügbar.');
  const body = input || {};
  const row = rowFor(db);
  const values = { updated_at: new Date().toISOString() };
  const changed = [];

  for (const [key, column, envName, type, options = {}] of FIELD_MAP) {
    if (envName && envValue(envName) !== null) continue;
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];
    let next;
    if (type === 'bool') next = truthy(raw) ? 1 : 0;
    else if (type === 'int') {
      next = Number(raw);
      if (!Number.isInteger(next) || next < options.min || next > options.max) {
        const range = `${options.min} und ${options.max}`;
        throw new HttpError(400, `${options.label || 'Wert'} muss zwischen ${range} liegen.`);
      }
    } else {
      next = String(raw ?? '');
      if (options.baseUrl) {
        next = normalizeBaseUrl(next);
        if (next && !validHttpUrl(next)) {
          throw new HttpError(400, 'APP_BASE_URL muss eine gültige http(s)-URL sein.');
        }
      }
    }
    if (String(row[column] ?? '') === String(next ?? '')) continue;
    values[column] = next;
    changed.push(column);
  }

  if (envValue('SSO_CLIENT_SECRET') === null) {
    if (body.clearSsoClientSecret === true && row.sso_client_secret_enc) {
      values.sso_client_secret_enc = null;
      changed.push('sso_client_secret_enc');
    } else if (typeof body.ssoClientSecret === 'string' && body.ssoClientSecret.length > 0) {
      values.sso_client_secret_enc = encryptIntegrationSecret(body.ssoClientSecret, 'sso_client_secret', { dataDir });
      changed.push('sso_client_secret_enc');
    }
  }
  if (envValue('TEAMS_WEBHOOK_URL') === null) {
    if (body.clearTeamsWebhook === true && row.teams_webhook_enc) {
      values.teams_webhook_enc = null;
      // A cleared webhook cannot keep the channel active.
      if (envValue('TEAMS_ENABLED') === null) values.teams_enabled = 0;
      changed.push('teams_webhook_enc');
    } else if (typeof body.teamsWebhookUrl === 'string' && body.teamsWebhookUrl.length > 0) {
      values.teams_webhook_enc = encryptIntegrationSecret(body.teamsWebhookUrl, 'teams_webhook_url', { dataDir });
      changed.push('teams_webhook_enc');
    }
  }

  const assignments = Object.keys(values).map((column) => `${column} = ?`).join(', ');
  const parameters = Object.values(values);
  db.transaction(() => {
    db.prepare(`UPDATE integration_settings SET ${assignments} WHERE id = 1`).run(...parameters);
    assertSsoValid(db, getSsoIntegrationConfig(db, { dataDir }));
    assertTeamsValid(getTeamsIntegrationConfig(db, { dataDir }));
    assertClamavValid(getClamavIntegrationConfig(db));
    assertWebAuthnValid(getWebAuthnIntegrationConfig(db));
  })();

  return {
    config: safeIntegrationsConfig(db, { dataDir }),
    changed: changed.map((column) => column.replace(/_enc$/, ''))
  };
}

module.exports = {
  DEFAULTS,
  MIN_INTERVAL_MS,
  envValue,
  truthy,
  splitList,
  normalizeIssuer,
  parseOrigins,
  validHttpUrl,
  webAuthnValid,
  getSsoIntegrationConfig,
  getTeamsIntegrationConfig,
  getClamavIntegrationConfig,
  getWebAuthnIntegrationConfig,
  getLocationsIntegrationConfig,
  getAppBaseUrlConfig,
  getAppBaseUrl,
  getLeasingSchedulerConfig,
  getReminderSchedulerConfig,
  getRetentionSchedulerConfig,
  getSystemStatus,
  safeIntegrationsConfig,
  updateIntegrations
};
