'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.TZ = process.env.TZ || 'Europe/Berlin';

const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const { db, initSchema, DATA_DIR, UPLOAD_DIR, PROJECT_ROOT } = require('./db');
const { bootstrap } = require('./bootstrap');
const SQLiteSessionStore = require('./lib/session-store');
const { randomToken, safeEqual, ensureCsrfToken, csrfProtection } = require('./lib/security');
const { HttpError } = require('./lib/validation');
const { writeAudit } = require('./lib/audit');
const { logger, requestLogger, logRequestError } = require('./lib/logger');
const { migrateAuditSchema } = require('./lib/audit-migration');
const { getBranding } = require('./lib/branding');
const { uploadPath } = require('./lib/files');
const { startAutoAnonymizer } = require('./lib/anonymize');
const { migrateSuperadminSchema, ensureSuperadmin } = require('./lib/superadmin');
const { migrateLeasingSchema } = require('./lib/leasing-schema');
const { migrateCostCentersSchema } = require('./lib/cost-centers-schema');
const { migrateColorModeSchema } = require('./lib/color-mode-schema');
const { normalizeColorMode } = require('./lib/color-mode');
const { migrateMfaSchema } = require('./lib/mfa-schema');
const { migratePasswordResetSchema } = require('./lib/password-reset-schema');
const { migratePasskeySchema } = require('./lib/passkey-schema');
const { migrateSsoSchema } = require('./lib/sso-schema');
const { migrateRetentionSchema } = require('./lib/retention-schema');
const { migrateLocationsSchema } = require('./lib/locations-schema');
const { migrateIntegrationsSchema, migrateAdvancedSchema } = require('./lib/integrations-schema');
const { migrateWebhooksSchema } = require('./lib/webhook-schema');
const { migrateCompaniesSchema } = require('./lib/companies-schema');
const { migrateVehiclesSchema } = require('./lib/vehicles-schema');
const {
  FLOW_TTL_MS: SSO_FLOW_TTL_MS,
  getSsoConfig,
  randomFlowValue,
  verifyIdToken,
  buildAuthorizationUrl,
  exchangeCode,
  resolveSsoUser,
  auditSsoFailure
} = require('./lib/sso');
const { requestPasswordReset, resetPasswordWithToken, validatePasswordResetToken } = require('./lib/password-reset');
const { getMfaKey } = require('./lib/mfa-crypto');
const { getIntegrationsKey } = require('./lib/integrations-crypto');
const {
  getMfaRow,
  isTotpEnabled,
  isLocked,
  verifyTotpForUser,
  verifyRecoveryForUser
} = require('./lib/mfa');
const {
  getWebAuthnConfig,
  countPasskeys,
  buildAuthenticationOptions,
  verifyAuthentication,
  storeAuthenticationChallenge,
  takeAuthenticationChallenge,
  isPasskeyLocked,
  lockRemainingMs,
  registerPasskeyFailure,
  clearPasskeyFailures
} = require('./lib/webauthn');
const { startLeasingScheduler } = require('./lib/leasing');
const { startMaintenanceReminderScheduler } = require('./lib/maintenance-reminders');
const { startRetentionScheduler } = require('./lib/retention');
const { registerScheduler, startAllSchedulers } = require('./lib/scheduler-control');
const {
  getRetentionSchedulerConfig,
  getAppBaseUrl,
  getSsoIntegrationConfig,
  getTeamsIntegrationConfig,
  getClamavIntegrationConfig,
  getWebAuthnIntegrationConfig,
  getLocationsIntegrationConfig,
  getSystemStatus
} = require('./lib/integrations');
const {
  ensureRoles,
  getRolePermissions,
  getRoleObjectPermissions,
  getUserPermissionOverrides,
  getUserObjectPermissions,
  effectiveGlobalPermissions,
  driverDefaultPermissions,
  roleName
} = require('./lib/permissions');
const apiRouter = require('./routes/api');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VIEWS_DIR = path.join(__dirname, 'views');
let passkeyBrowserBundle = null;
try {
  passkeyBrowserBundle = path.join(
    path.dirname(require.resolve('@simplewebauthn/browser')),
    '..', 'dist', 'bundle', 'index.umd.min.js'
  );
} catch {
  passkeyBrowserBundle = null;
}
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.COOKIE_SECURE === 'true';
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) {
    throw new Error('SESSION_SECRET muss gesetzt sein und mindestens 32 Zeichen lang sein.');
  }
  sessionSecret = 'development-only-session-secret-change-me-now';
  logger.warn('SESSION_SECRET fehlt; es wird ein unsicherer Entwicklungswert verwendet.');
}

const loginTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'login.html'), 'utf8');
const loginMfaTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'login-mfa.html'), 'utf8');
const forgotPasswordTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'forgot-password.html'), 'utf8');
const resetPasswordTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'reset-password.html'), 'utf8');
const indexTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'index.html'), 'utf8');

function inlineScriptHashes(templates) {
  const hashes = new Set();
  for (const template of templates) {
    for (const match of template.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      const script = match[1].replace(/\r\n/g, '\n');
      hashes.add(`'sha256-${crypto.createHash('sha256').update(script).digest('base64')}'`);
    }
  }
  return [...hashes];
}

const themeScriptHashes = inlineScriptHashes([
  loginTemplate,
  loginMfaTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  indexTemplate
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function currentBranding() {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  return { settings, branding: getBranding(settings || {}) };
}

function applyBrandingTemplate(template, branding, colorMode = 'light') {
  return template
    .replaceAll('{{THEME}}', escapeHtml(branding.theme))
    .replaceAll('{{SIDEBAR_STYLE}}', escapeHtml(branding.sidebarStyle))
    .replaceAll('{{COLOR_MODE}}', escapeHtml(normalizeColorMode(colorMode, 'light')))
    .replaceAll('{{BRAND_STYLES}}', branding.brandStyles)
    .replaceAll('{{THEME_COLOR}}', escapeHtml(branding.themeColor))
    .replaceAll('{{BRAND_MARK_CLASS}}', escapeHtml(branding.markClass))
    .replaceAll('{{BRAND_MARK}}', branding.logoMarkup)
    .replaceAll('{{BRAND_NAME}}', escapeHtml(branding.name))
    .replaceAll('{{BRAND_SUBTITLE}}', escapeHtml(branding.subtitle))
    .replaceAll('{{BRAND_TOP}}', escapeHtml(branding.topName))
    .replaceAll('{{FOOTER_BRAND}}', escapeHtml(branding.footerName))
    .replaceAll('{{LOGIN_FOOTER_BRAND}}', escapeHtml(branding.loginFooter))
    .replaceAll('{{PAGE_TITLE}}', escapeHtml(branding.pageTitle))
    .replaceAll('{{LOGIN_PAGE_TITLE}}', escapeHtml(branding.loginPageTitle))
    .replaceAll('{{FAVICON}}', escapeHtml(branding.favicon));
}

function noticeMarkup(notice) {
  return notice ? `<div class="login-notice" role="status">${escapeHtml(notice)}</div>` : '';
}

function ssoLoginMarkup() {
  const config = getSsoConfig(db);
  if (!config.enabled || !config.configured) return '';
  return `
    <div class="login-sso">
      <a class="login-button login-sso-button" href="/auth/sso/start">Mit Microsoft anmelden</a>
      <div class="login-divider"><span>oder lokal anmelden</span></div>
    </div>`;
}

function renderLogin(req, res, { status = 200, error = '', email = '', notice = '' } = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const { settings, branding } = currentBranding();
  const colorMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const html = applyBrandingTemplate(loginTemplate, branding, colorMode)
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{NOTICE}}', noticeMarkup(notice))
    .replaceAll('{{SSO_BLOCK}}', ssoLoginMarkup())
    .replaceAll('{{EMAIL}}', escapeHtml(email));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

function renderForgotPassword(req, res, { status = 200, error = '', notice = '', email = '' } = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const { settings, branding } = currentBranding();
  const colorMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const html = applyBrandingTemplate(forgotPasswordTemplate, branding, colorMode)
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{NOTICE}}', noticeMarkup(notice))
    .replaceAll('{{EMAIL}}', escapeHtml(email));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

function renderResetPassword(req, res, { status = 200, error = '', notice = '', token = '' } = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const { settings, branding } = currentBranding();
  const colorMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const html = applyBrandingTemplate(resetPasswordTemplate, branding, colorMode)
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{NOTICE}}', noticeMarkup(notice))
    .replaceAll('{{TOKEN}}', escapeHtml(token));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

function renderLoginMfa(req, res, {
  status = 200,
  error = '',
  email = '',
  passkeyEnabled = false,
  totpEnabled = true
} = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const { settings, branding } = currentBranding();
  const colorMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const factorHint = passkeyEnabled && !totpEnabled
    ? 'Bestätigen Sie die Anmeldung mit Ihrem hinterlegten Passkey.'
    : 'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein oder nutzen Sie einen Passkey.';
  const html = applyBrandingTemplate(loginMfaTemplate, branding, colorMode)
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{PASSKEY_ENABLED}}', passkeyEnabled ? '1' : '0')
    .replaceAll('{{TOTP_HIDDEN}}', totpEnabled ? '' : 'hidden')
    .replaceAll('{{FACTOR_HINT}}', escapeHtml(factorHint))
    .replaceAll('{{EMAIL}}', escapeHtml(email));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

function loginMfaFactors(userId) {
  const row = getMfaRow(db, userId);
  return {
    totpEnabled: isTotpEnabled(row),
    passkeyEnabled: getWebAuthnConfig(db).enabled && countPasskeys(db, userId) > 0
  };
}

function renderApp(req, res) {
  const { settings, branding } = currentBranding();
  const userMode = normalizeColorMode(req.user?.color_mode, '');
  const defaultMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const html = applyBrandingTemplate(indexTemplate, branding, userMode || defaultMode);
  res.set('Cache-Control', 'no-store').type('html').send(html);
}

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/');
}

initSchema();
ensureRoles(db);
migrateAuditSchema(db);
migrateSuperadminSchema(db);
migrateLeasingSchema(db);
migrateCostCentersSchema(db);
migrateColorModeSchema(db);
migrateMfaSchema(db);
migratePasswordResetSchema(db);
migratePasskeySchema(db);
migrateSsoSchema(db);
migrateRetentionSchema(db);
migrateLocationsSchema(db);
migrateIntegrationsSchema(db);
migrateAdvancedSchema(db);
getMfaKey(DATA_DIR);
try {
  getIntegrationsKey(DATA_DIR);
} catch (error) {
  logger.warn('Integrations-Secrets sind nicht verfügbar.', { error });
}
try {
  migrateWebhooksSchema(db, { dataDir: DATA_DIR });
} catch (error) {
  logger.warn('Webhook-Migration konnte nicht abgeschlossen werden.', { error });
}
try {
  migrateCompaniesSchema(db);
} catch (error) {
  logger.warn('Gesellschafts-Migration konnte nicht abgeschlossen werden.', { error });
}
try {
  migrateVehiclesSchema(db);
} catch (error) {
  logger.warn('Fahrzeug-Migration konnte nicht abgeschlossen werden.', { error });
}
bootstrap(db);
try {
  ensureSuperadmin(db, { projectRoot: PROJECT_ROOT, dataDir: DATA_DIR, uploadDir: UPLOAD_DIR, logger });
} catch (error) {
  logger.warn('Superadmin-Bootstrap fehlgeschlagen; der Superadmin-Login bleibt gesperrt.', { error });
}
try {
  startAutoAnonymizer();
} catch (error) {
  logger.warn('Automatische Anonymisierung konnte nicht gestartet werden.', { error });
}
registerScheduler('leasing', () => startLeasingScheduler(db, { dataDir: DATA_DIR }));
registerScheduler('maintenance', () => startMaintenanceReminderScheduler(db, { dataDir: DATA_DIR }));
registerScheduler('retention', () => startRetentionScheduler(db, { config: getRetentionSchedulerConfig(db) }));
startAllSchedulers();

app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);
app.set('etag', 'strong');

app.use(requestLogger());

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...themeScriptHashes],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
// Base64 inflates image uploads by about one third, so the JSON limit must be
// larger than the 12 MB binary limit enforced in server/lib/files.js.
app.use(express.json({ limit: '24mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { index: false, etag: true, maxAge: 0 }));

app.get('/vendor/simplewebauthn-browser.js', (req, res) => {
  if (!passkeyBrowserBundle) return res.status(404).type('text').send('WebAuthn-Browserbibliothek nicht gefunden.');
  res.set('Cache-Control', 'public, max-age=86400');
  return res.type('application/javascript').sendFile(passkeyBrowserBundle);
});

app.use(session({
  store: new SQLiteSessionStore(db, { defaultTtlMs: 8 * 60 * 60 * 1000 }),
  name: 'awo.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

app.get('/branding/logo', (req, res) => {
  const settings = db.prepare('SELECT logo_file FROM settings WHERE id = 1').get();
  if (!settings?.logo_file) return res.status(404).type('text').send('Kein Logo hinterlegt.');
  const fullPath = uploadPath(settings.logo_file);
  if (!fullPath) return res.status(404).type('text').send('Logo nicht gefunden.');
  res.set('Cache-Control', 'public, max-age=300');
  return res.type('image/png').sendFile(fullPath);
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).type('text').send('Zu viele SSO-Anfragen. Bitte warten Sie einen Moment.')
});

const passkeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({
    error: 'Zu viele Passkey-Anfragen. Bitte warten Sie einen Moment.'
  })
});

const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => renderForgotPassword(req, res, {
    status: 429,
    error: 'Zu viele Anfragen. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.'
  })
});

const passwordResetSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => renderResetPassword(req, res, {
    status: 429,
    error: 'Zu viele Anfragen. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.',
    token: String(req.body?.token || '')
  })
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Zu viele Anfragen. Bitte warten Sie einen Moment.' })
});

const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
const MFA_ERROR_MESSAGE = 'Der Bestätigungscode ist nicht gültig. Bitte versuchen Sie es erneut.';
const PASSWORD_RESET_NOTICE = 'Wenn ein Konto mit dieser E-Mail-Adresse existiert, wurde ein Link zum Zurücksetzen versendet.';

function csrfMatches(req, value) {
  return Boolean(req.session?.csrfToken && value && safeEqual(req.session.csrfToken, value));
}

function ssoFailure(req, res, reason, status = 401) {
  auditSsoFailure(db, reason);
  return renderLogin(req, res, {
    status,
    error: 'Die SSO-Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut oder nutzen Sie die lokale Anmeldung.'
  });
}

app.get('/auth/sso/start', ssoLimiter, async (req, res, next) => {
  try {
    const config = getSsoConfig(db);
    if (!config.enabled) return res.status(404).type('text').send('SSO ist nicht aktiviert.');
    if (!config.configured) {
      return renderLogin(req, res, {
        status: 503,
        error: 'SSO ist derzeit nicht vollständig konfiguriert.'
      });
    }
    const flow = {
      state: randomFlowValue(),
      nonce: randomFlowValue(),
      codeVerifier: randomFlowValue(),
      createdAt: Date.now()
    };
    const url = await buildAuthorizationUrl(config, flow);
    req.session.ssoFlow = flow;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    return res.redirect(302, url);
  } catch {
    return ssoFailure(req, res, 'start', 502);
  }
});

app.get('/auth/sso/callback', ssoLimiter, async (req, res, next) => {
  try {
    const config = getSsoConfig(db);
    if (!config.enabled) return res.status(404).type('text').send('SSO ist nicht aktiviert.');
    if (!config.configured) return ssoFailure(req, res, 'configuration', 503);
    const flow = req.session?.ssoFlow;
    delete req.session?.ssoFlow;
    if (!flow || Date.now() - Number(flow.createdAt || 0) > SSO_FLOW_TTL_MS) {
      return ssoFailure(req, res, 'state');
    }
    if (!safeEqual(String(req.query.state || ''), String(flow.state || ''))) {
      return ssoFailure(req, res, 'state');
    }
    if (req.query.error) return ssoFailure(req, res, 'provider_error');
    const code = String(req.query.code || '');
    if (!code) return ssoFailure(req, res, 'missing_code');

    let idToken;
    try {
      idToken = await exchangeCode(config, code, flow.codeVerifier);
    } catch {
      return ssoFailure(req, res, 'token_exchange');
    }
    let verified;
    try {
      verified = await verifyIdToken(idToken, config, { nonce: flow.nonce });
    } catch {
      return ssoFailure(req, res, 'token_verification');
    }
    if (!verified.valid) return ssoFailure(req, res, verified.reason || 'invalid_token');

    const resolved = resolveSsoUser(db, config, verified.claims);
    if (!resolved.ok) return ssoFailure(req, res, resolved.reason || 'account');

    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    const now = new Date().toISOString();
    req.session.userId = resolved.user.id;
    req.session.csrfToken = randomToken();
    req.session.authMethod = 'sso';
    req.session.ssoIssuer = config.issuer;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, resolved.user.id);
    writeAudit(db, {
      userId: resolved.user.id,
      action: 'sso_login',
      entityType: 'user',
      entityId: resolved.user.id,
      details: {
        provisioned: Boolean(resolved.provisioned),
        role: resolved.role,
        roleChanged: Boolean(resolved.roleChanged)
      }
    });
    if (resolved.provisioned) {
      writeAudit(db, {
        userId: resolved.user.id,
        action: 'sso_provision',
        entityType: 'user',
        entityId: resolved.user.id,
        details: { role: resolved.role, driverCreated: Boolean(resolved.driverCreated) }
      });
    }
    return res.redirect(303, '/');
  } catch (error) {
    return next(error);
  }
});

app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  if (req.session?.mfaPendingUserId) return res.redirect('/login/mfa');
  const notice = String(req.query.reset || '') === '1' ? 'Ihr Passwort wurde geändert. Bitte melden Sie sich neu an.' : '';
  return renderLogin(req, res, { notice });
});

app.post('/login', loginLimiter, async (req, res, next) => {
  try {
    if (!csrfMatches(req, String(req.body?._csrf || ''))) {
      return renderLogin(req, res, { status: 403, error: 'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es erneut.' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND active = 1').get(email);
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) {
      if (user) writeAudit(db, { userId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, details: { email } });
      return renderLogin(req, res, { status: 401, error: 'E-Mail-Adresse oder Passwort ist nicht korrekt.', email });
    }

    const mfaEnabled = isTotpEnabled(getMfaRow(db, user.id)) || countPasskeys(db, user.id) > 0;
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.csrfToken = randomToken();

    if (mfaEnabled) {
      req.session.mfaPendingUserId = user.id;
      req.session.mfaPendingAt = Date.now();
      await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
      return res.redirect(303, '/login/mfa');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);
    req.session.userId = user.id;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    writeAudit(db, { userId: user.id, action: 'login', entityType: 'user', entityId: user.id, details: { email } });
    return res.redirect(303, '/');
  } catch (error) {
    return next(error);
  }
});

app.get('/forgot-password', (req, res) => {
  return renderForgotPassword(req, res);
});

app.post('/forgot-password', passwordResetRequestLimiter, async (req, res, next) => {
  try {
    if (!csrfMatches(req, String(req.body?._csrf || ''))) {
      return renderForgotPassword(req, res, {
        status: 403,
        error: 'Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.'
      });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return renderForgotPassword(req, res, {
        status: 400,
        error: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
        email
      });
    }
    const baseUrl = getAppBaseUrl(db) || `${req.protocol}://${req.get('host')}`;
    requestPasswordReset(db, { email, dataDir: DATA_DIR, baseUrl })
      .catch((error) => logger.warn('Passwort-Reset konnte nicht verarbeitet werden.', { error }));
    return renderForgotPassword(req, res, { notice: PASSWORD_RESET_NOTICE, email });
  } catch (error) {
    return next(error);
  }
});

app.get('/reset-password', (req, res) => {
  const token = String(req.query.token || '');
  const check = token ? validatePasswordResetToken(db, token) : { valid: false };
  if (!check.valid) {
    return renderResetPassword(req, res, {
      status: 400,
      error: 'Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen Link an.'
    });
  }
  return renderResetPassword(req, res, { token });
});

app.post('/reset-password', passwordResetSubmitLimiter, (req, res) => {
  const token = String(req.body?.token || '');
  if (!csrfMatches(req, String(req.body?._csrf || ''))) {
    return renderResetPassword(req, res, {
      status: 403,
      error: 'Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.',
      token
    });
  }
  const newPassword = String(req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (newPassword.length < 10 || newPassword.length > 200) {
    return renderResetPassword(req, res, {
      status: 400,
      error: 'Das Passwort muss mindestens 10 Zeichen lang sein.',
      token
    });
  }
  if (newPassword !== confirmPassword) {
    return renderResetPassword(req, res, {
      status: 400,
      error: 'Die Passwörter stimmen nicht überein.',
      token
    });
  }

  let result;
  try {
    result = resetPasswordWithToken(db, token, newPassword);
  } catch (error) {
    logger.error('Passwort-Reset konnte nicht abgeschlossen werden.', { error });
    return renderResetPassword(req, res, {
      status: 500,
      error: 'Das Passwort konnte nicht geändert werden. Bitte fordern Sie einen neuen Link an.',
      token
    });
  }
  if (!result.ok) {
    return renderResetPassword(req, res, {
      status: 400,
      error: 'Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen Link an.',
      token
    });
  }
  return req.session.destroy((error) => {
    if (error) logger.warn('Reset-Sitzung konnte nicht verworfen werden.', { error });
    res.clearCookie('awo.sid');
    return res.redirect(303, '/login?reset=1');
  });
});

app.get('/login/mfa', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  const pendingUserId = req.session?.mfaPendingUserId;
  if (!pendingUserId) return res.redirect('/login');
  if (Date.now() - Number(req.session.mfaPendingAt || 0) > MFA_PENDING_TTL_MS) {
    return req.session.destroy(() => {
      res.clearCookie('awo.sid');
      res.redirect('/login');
    });
  }
  const user = db.prepare('SELECT id, email FROM users WHERE id = ? AND active = 1').get(pendingUserId);
  if (!user) {
    return req.session.destroy(() => {
      res.clearCookie('awo.sid');
      res.redirect('/login');
    });
  }
  const factors = loginMfaFactors(user.id);
  if (!factors.totpEnabled && !factors.passkeyEnabled) {
    return req.session.destroy(() => {
      res.clearCookie('awo.sid');
      res.redirect('/login');
    });
  }
  return renderLoginMfa(req, res, { email: user.email, ...factors });
});

app.post('/login/mfa', mfaLimiter, async (req, res, next) => {
  try {
    const pendingUserId = req.session?.mfaPendingUserId;
    if (!pendingUserId) return res.redirect('/login');
    if (!csrfMatches(req, String(req.body?._csrf || ''))) {
      const pending = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(pendingUserId);
      const factors = pending ? loginMfaFactors(pending.id) : { totpEnabled: true, passkeyEnabled: false };
      return renderLoginMfa(req, res, {
        status: 403,
        error: 'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es erneut.',
        ...factors
      });
    }
    if (Date.now() - Number(req.session.mfaPendingAt || 0) > MFA_PENDING_TTL_MS) {
      return req.session.destroy(() => {
        res.clearCookie('awo.sid');
        res.redirect('/login');
      });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(pendingUserId);
    if (!user) {
      return req.session.destroy(() => {
        res.clearCookie('awo.sid');
        res.redirect('/login');
      });
    }
    const row = getMfaRow(db, user.id);
    const factors = loginMfaFactors(user.id);
    if (!factors.totpEnabled && !factors.passkeyEnabled) {
      return req.session.destroy(() => {
        res.clearCookie('awo.sid');
        res.redirect('/login');
      });
    }

    const useRecovery = ['1', 'true', 'on'].includes(String(req.body?.useRecovery || '').toLowerCase());
    const code = String(req.body?.code || '');
    if (isLocked(row)) {
      writeAudit(db, {
        userId: user.id,
        action: 'mfa_verify_failed',
        entityType: 'user',
        entityId: user.id,
        details: { method: useRecovery ? 'recovery' : 'totp', reason: 'locked' }
      });
      return renderLoginMfa(req, res, {
        status: 429,
        error: 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.',
        email: user.email,
        ...factors
      });
    }

    const result = useRecovery
      ? verifyRecoveryForUser(db, user.id, code, { dataDir: DATA_DIR })
      : verifyTotpForUser(db, row, code, { dataDir: DATA_DIR });

    if (!result.valid) {
      writeAudit(db, {
        userId: user.id,
        action: 'mfa_verify_failed',
        entityType: 'user',
        entityId: user.id,
        details: { method: useRecovery ? 'recovery' : 'totp', reason: result.reason || 'invalid' }
      });
      if (result.justLocked) {
        writeAudit(db, {
          userId: user.id,
          action: 'mfa_locked',
          entityType: 'user',
          entityId: user.id,
          details: { method: useRecovery ? 'recovery' : 'totp', lockedUntil: result.lockedUntil || null }
        });
      }
      const locked = result.justLocked || result.reason === 'locked';
      return renderLoginMfa(req, res, {
        status: locked ? 429 : 401,
        error: locked
          ? 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.'
          : MFA_ERROR_MESSAGE,
        email: user.email,
        ...factors
      });
    }

    if (useRecovery) {
      writeAudit(db, {
        userId: user.id,
        action: 'mfa_recovery_used',
        entityType: 'user',
        entityId: user.id,
        details: { context: 'login' }
      });
    }

    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    const now = new Date().toISOString();
    req.session.userId = user.id;
    req.session.mfaVerifiedAt = now;
    req.session.csrfToken = randomToken();
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);
    writeAudit(db, {
      userId: user.id,
      action: 'mfa_verify_success',
      entityType: 'user',
      entityId: user.id,
      details: { method: useRecovery ? 'recovery' : 'totp' }
    });
    writeAudit(db, {
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email }
    });
    return res.redirect(303, '/');
  } catch (error) {
    return next(error);
  }
});

app.post('/login/mfa/cancel', (req, res) => {
  if (!csrfMatches(req, String(req.body?._csrf || ''))) return res.redirect('/login');
  req.session.destroy((error) => {
    if (error) logger.warn('MFA-Sitzung konnte nicht verworfen werden.', { error });
    res.clearCookie('awo.sid');
    res.redirect(303, '/login');
  });
});

function pendingPasskeyUser(req) {
  if (req.session?.userId || !req.session?.mfaPendingUserId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.session.mfaPendingUserId) || null;
}

function passkeyLoginError(res, status = 401) {
  return res.set('Cache-Control', 'no-store').status(status).json({
    error: 'Die Passkey-Anmeldung ist nicht möglich. Bitte verwenden Sie TOTP oder einen Recovery-Code.'
  });
}

app.post('/api/auth/passkey/options', passkeyLimiter, csrfProtection, async (req, res, next) => {
  try {
    const config = getWebAuthnConfig(db);
    if (!config.enabled) {
      return res.status(503).json({ error: 'Passkeys sind auf dieser Installation nicht konfiguriert.' });
    }
    const user = pendingPasskeyUser(req);
    if (!user) return res.status(400).json({ error: 'Es steht keine Passkey-Anmeldung an.' });
    if (isPasskeyLocked(db, user.id)) {
      return res.status(429).json({
        error: 'Zu viele Passkey-Versuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.',
        retryAfter: lockRemainingMs(db, user.id)
      });
    }
    const result = await buildAuthenticationOptions(db, user.id, config);
    if (!result.options) return res.status(400).json({ error: 'Für dieses Konto ist kein Passkey hinterlegt.' });
    storeAuthenticationChallenge(req, result.challenge, user.id);
    return res.set('Cache-Control', 'no-store').json({ options: result.options });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/passkey/verify', passkeyLimiter, csrfProtection, async (req, res, next) => {
  try {
    const config = getWebAuthnConfig(db);
    if (!config.enabled) {
      return res.status(503).json({ error: 'Passkeys sind auf dieser Installation nicht konfiguriert.' });
    }
    const user = pendingPasskeyUser(req);
    if (!user) return res.status(400).json({ error: 'Es steht keine Passkey-Anmeldung an.' });
    if (isPasskeyLocked(db, user.id)) {
      return res.status(429).json({
        error: 'Zu viele Passkey-Versuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.',
        retryAfter: lockRemainingMs(db, user.id)
      });
    }
    const challenge = takeAuthenticationChallenge(req, user.id);
    if (!challenge) return passkeyLoginError(res, 400);
    const response = req.body?.response;
    if (!response || typeof response !== 'object') return passkeyLoginError(res, 400);

    let result;
    try {
      result = await verifyAuthentication(db, user.id, response, challenge, config);
    } catch {
      result = { valid: false, reason: 'invalid' };
    }
    if (!result.valid) {
      const failure = registerPasskeyFailure(db, user.id);
      writeAudit(db, {
        userId: user.id,
        action: 'passkey_login_failed',
        entityType: 'user',
        entityId: user.id,
        details: { reason: result.reason || 'invalid' }
      });
      if (failure.lockedUntil) {
        return res.status(429).json({
          error: 'Zu viele Passkey-Versuche. Bitte warten Sie 15 Minuten und versuchen Sie es erneut.',
          retryAfter: lockRemainingMs(db, user.id)
        });
      }
      return passkeyLoginError(res);
    }

    clearPasskeyFailures(db, user.id);
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    const now = new Date().toISOString();
    req.session.userId = user.id;
    req.session.mfaVerifiedAt = now;
    req.session.csrfToken = randomToken();
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);
    writeAudit(db, {
      userId: user.id,
      action: 'passkey_login_success',
      entityType: 'user',
      entityId: user.id,
      details: { method: 'passkey' }
    });
    writeAudit(db, {
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email }
    });
    return res.set('Cache-Control', 'no-store').json({ ok: true, redirect: '/' });
  } catch (error) {
    return next(error);
  }
});

function requireAuth(req, res, next) {
  if (!req.session?.userId && req.session?.mfaPendingUserId) {
    if (wantsJson(req)) return res.status(401).json({ error: 'Die MFA-Bestätigung ist noch ausstehend.' });
    return res.redirect('/login/mfa');
  }
  if (!req.session?.userId) {
    if (wantsJson(req)) return res.status(401).json({ error: 'Nicht angemeldet.' });
    return res.redirect('/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    if (wantsJson(req)) return res.status(401).json({ error: 'Sitzung ist abgelaufen.' });
    return res.redirect('/login');
  }
  req.user = user;
  const linkedDriver = db.prepare('SELECT id, user_id, own_trips_access FROM drivers WHERE user_id = ?').get(user.id) || null;
  req.auth = {
    isAdmin: user.role === 'admin',
    isSuperadmin: user.role === 'superadmin',
    rolePermissions: new Set(getRolePermissions(db, user.role)),
    roleObjectPermissions: getRoleObjectPermissions(db, user.role),
    userPermissionOverrides: getUserPermissionOverrides(db, user.id),
    userObjectPermissions: getUserObjectPermissions(db, user.id),
    linkedDriverId: linkedDriver?.id || null,
    driverDefaultPermissions: driverDefaultPermissions(linkedDriver)
  };
  req.permissions = effectiveGlobalPermissions(req.auth);
  req.roleName = roleName(db, user.role);
  if (!req.session.csrfToken) req.session.csrfToken = randomToken();
  return next();
}

app.use('/api', apiLimiter, requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, csrfProtection, apiRouter);

app.get('/', requireAuth, (req, res) => {
  renderApp(req, res);
});
app.get('/index.html', requireAuth, (req, res) => {
  renderApp(req, res);
});

app.use((req, res) => {
  if (wantsJson(req)) return res.status(404).json({ error: 'Nicht gefunden.' });
  return res.status(404).type('text').send('Nicht gefunden');
});

app.use((error, req, res, _next) => {
  const status = error instanceof HttpError ? error.status : Number(error.status) || 500;
  logRequestError(req, status, error);
  if (status >= 500) {
    console.error('SERVERERR', error.stack || error);
  }
  if (res.headersSent) return;
  const message = status >= 500 ? 'Interner Serverfehler.' : error.message;
  if (wantsJson(req)) {
    return res.status(status).json({ error: message, details: error.details || null });
  }
  return res.status(status).type('text').send(message);
});

const server = app.listen(PORT, HOST, () => {
  const version = (() => {
    try { return require('../package.json').version; } catch { return 'unknown'; }
  })();
  const system = getSystemStatus();
  logger.info('Server gestartet', {
    version,
    commit: process.env.APP_COMMIT || 'unknown',
    userVersion: Number(db.pragma('user_version', { simple: true })) || 0,
    dataDir: DATA_DIR,
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    features: {
      ssoConfigured: Boolean(getSsoIntegrationConfig(db).configured),
      teamsConfigured: Boolean(getTeamsIntegrationConfig(db).configured),
      clamavEnabled: Boolean(getClamavIntegrationConfig(db).enabled),
      webAuthnEnabled: Boolean(getWebAuthnIntegrationConfig(db).enabled),
      locationsEnabled: Boolean(getLocationsIntegrationConfig(db).enabled)
    },
    keys: {
      mfa: system.mfaKeySource,
      integrations: system.integrationsKeySource
    }
  });
  if (!cookieSecure) logger.warn('Secure-Cookies sind deaktiviert; für HTTPS-Produktivbetrieb COOKIE_SECURE=true setzen.');
  if (isProduction && !cookieSecure) logger.warn('NODE_ENV=production, aber COOKIE_SECURE ist nicht aktiviert.');
});

function shutdown(signal) {
  logger.info('Server wird beendet.', { signal });
  server.close(() => {
    try {
      db.close();
    } catch (error) {
      logger.warn('Datenbank konnte nicht sauber geschlossen werden.', { error });
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
