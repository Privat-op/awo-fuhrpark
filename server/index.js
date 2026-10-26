'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.TZ = process.env.TZ || 'Europe/Berlin';

const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const { db, initSchema, DATA_DIR } = require('./db');
const { bootstrap } = require('./bootstrap');
const SQLiteSessionStore = require('./lib/session-store');
const { randomToken, safeEqual, ensureCsrfToken, csrfProtection } = require('./lib/security');
const { HttpError } = require('./lib/validation');
const { writeAudit } = require('./lib/audit');
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderLogin(req, res, { status = 200, error = '', email = '' } = {}) {
  const csrfToken = ensureCsrfToken(req);
  const errorMarkup = error ? `<div class="login-error" role="alert">${escapeHtml(error)}</div>` : '';
  const html = loginTemplate
    .replaceAll('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
    .replaceAll('{{ERROR}}', errorMarkup)
    .replaceAll('{{EMAIL}}', escapeHtml(email));
  res.status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(html);
}

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/');
}

initSchema();
bootstrap(db);

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
      scriptSrc: ["'self'"],
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
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

app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  return renderLogin(req, res);
});

app.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const providedToken = String(req.body?._csrf || '');
    if (!req.session?.csrfToken || !providedToken || !safeEqual(req.session.csrfToken, providedToken)) {
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

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);
    writeAudit(db, { userId: user.id, action: 'login', entityType: 'user', entityId: user.id, details: { email } });

    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.csrfToken = randomToken();
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    return res.redirect(303, '/');
  } catch (error) {
    return next(error);
  }
});

function requireAuth(req, res, next) {
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
  if (!req.session.csrfToken) req.session.csrfToken = randomToken();
  return next();
}

app.use('/api', apiLimiter, requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, csrfProtection, apiRouter);

app.get('/', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(VIEWS_DIR, 'index.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(VIEWS_DIR, 'index.html'));
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
