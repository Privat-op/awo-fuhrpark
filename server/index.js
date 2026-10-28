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
const { getMfaKey } = require('./lib/mfa-crypto');
const {
  getMfaRow,
  isTotpEnabled,
  isLocked,
  verifyTotpForUser,
  verifyRecoveryForUser
} = require('./lib/mfa');
const { startLeasingScheduler } = require('./lib/leasing');
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
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.COOKIE_SECURE === 'true';
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) {
    throw new Error('SESSION_SECRET muss gesetzt sein und mindestens 32 Zeichen lang sein.');
  }
  sessionSecret = 'development-only-session-secret-change-me-now';
  console.warn('Warnung: SESSION_SECRET fehlt. Es wird ein unsicherer Entwicklungswert verwendet.');
}

const loginTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'login.html'), 'utf8');
const loginMfaTemplate = fs.readFileSync(path.join(VIEWS_DIR, 'login-mfa.html'), 'utf8');
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

const themeScriptHashes = inlineScriptHashes([loginTemplate, loginMfaTemplate, indexTemplate]);

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

function renderLogin(req, res, { status = 200, error = '', email = '' } = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const { settings, branding } = currentBranding();
  const colorMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const html = applyBrandingTemplate(loginTemplate, branding, colorMode)
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{EMAIL}}', escapeHtml(email));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

function renderLoginMfa(req, res, { status = 200, error = '', email = '' } = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const { settings, branding } = currentBranding();
  const colorMode = normalizeColorMode(settings?.default_color_mode, 'light');
  const html = applyBrandingTemplate(loginMfaTemplate, branding, colorMode)
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{EMAIL}}', escapeHtml(email));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
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
getMfaKey(DATA_DIR);
bootstrap(db);
try {
  ensureSuperadmin(db, { projectRoot: PROJECT_ROOT, dataDir: DATA_DIR, uploadDir: UPLOAD_DIR });
} catch (error) {
  console.warn('Warnung: Superadmin-Bootstrap konnte nicht abgeschlossen werden; der Superadmin-Login bleibt gesperrt. Das System läuft weiter.');
}
try {
  startAutoAnonymizer();
} catch (error) {
  console.warn('Automatische Anonymisierung konnte nicht gestartet werden:', error.message);
}
try {
  startLeasingScheduler(db, { dataDir: DATA_DIR });
} catch (error) {
  console.warn('Leasing-Prüfung konnte nicht gestartet werden:', error.message);
}

app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);
app.set('etag', 'strong');

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
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { index: false, etag: true, maxAge: 0 }));

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

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Zu viele Anfragen. Bitte warten Sie einen Moment.' })
});

const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
const MFA_ERROR_MESSAGE = 'Der Bestätigungscode ist nicht gültig. Bitte versuchen Sie es erneut.';

function csrfMatches(req, value) {
  return Boolean(req.session?.csrfToken && value && safeEqual(req.session.csrfToken, value));
}

app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  if (req.session?.mfaPendingUserId) return res.redirect('/login/mfa');
  return renderLogin(req, res);
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

    const mfaEnabled = isTotpEnabled(getMfaRow(db, user.id));
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
  return renderLoginMfa(req, res, { email: user.email });
});

app.post('/login/mfa', mfaLimiter, async (req, res, next) => {
  try {
    const pendingUserId = req.session?.mfaPendingUserId;
    if (!pendingUserId) return res.redirect('/login');
    if (!csrfMatches(req, String(req.body?._csrf || ''))) {
      return renderLoginMfa(req, res, { status: 403, error: 'Die Anmeldung ist abgelaufen. Bitte versuchen Sie es erneut.' });
    }
    if (Date.now() - Number(req.session.mfaPendingAt || 0) > MFA_PENDING_TTL_MS) {
      return req.session.destroy(() => {
        res.clearCookie('awo.sid');
        res.redirect('/login');
      });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(pendingUserId);
    const row = user ? getMfaRow(db, user.id) : null;
    if (!user || !isTotpEnabled(row)) {
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
        email: user.email
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
        email: user.email
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
    if (error) console.warn('MFA-Sitzung konnte nicht verworfen werden:', error.message);
    res.clearCookie('awo.sid');
    res.redirect(303, '/login');
  });
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
  if (res.headersSent) return;
  const status = error instanceof HttpError ? error.status : Number(error.status) || 500;
  const message = status >= 500 ? 'Interner Serverfehler.' : error.message;
  if (status >= 500) console.error(error);
  if (wantsJson(req)) {
    return res.status(status).json({ error: message, details: error.details || null });
  }
  return res.status(status).type('text').send(message);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`AWO Fuhrparkmanagement läuft auf http://${HOST}:${PORT}`);
  console.log(`Datenverzeichnis: ${DATA_DIR}`);
  if (!cookieSecure) console.log('Hinweis: Secure-Cookies sind deaktiviert (COOKIE_SECURE=false). Für HTTPS-Produktivbetrieb aktivieren.');
  if (isProduction && !cookieSecure) console.warn('Warnung: NODE_ENV=production, aber COOKIE_SECURE ist nicht aktiviert. Bitte hinter HTTPS betreiben und COOKIE_SECURE=true setzen.');
});

function shutdown(signal) {
  console.log(`${signal} empfangen, Server wird beendet …`);
  server.close(() => {
    try {
      db.close();
    } catch (error) {
      console.warn('Datenbank konnte nicht sauber geschlossen werden:', error.message);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
