'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ALL_PERMISSIONS, normalizePermissions } = require('./permissions');
const { writeAudit } = require('./audit');
const { isoNow } = require('./validation');

const SUPERADMIN_USER_ID = 'superadmin';
const SUPERADMIN_ROLE_ID = 'superadmin';
const SUPERADMIN_ROLE_NAME = 'Superadmin';
const SUPERADMIN_RANK = 2000000;
const SUPERADMIN_SCHEMA_VERSION = 4;
const MAX_FILE_BYTES = 64 * 1024;
const BCRYPT_COST_12 = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isInside(target, parent) {
  if (!target || !parent) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function defaultSuperadminFile(env = process.env) {
  if (env.SUPERADMIN_FILE) return path.resolve(env.SUPERADMIN_FILE);
  const docker = fs.existsSync('/.dockerenv') || env.CONTAINER === 'docker';
  return docker ? '/run/secrets/awo-superadmin.json' : '/etc/awo-fuhrpark/superadmin.json';
}

function pathSafetyWarnings(filePath, { projectRoot, dataDir, uploadDir } = {}) {
  const warnings = [];
  if (!filePath) return warnings;
  if (projectRoot && isInside(filePath, projectRoot)) warnings.push('inside_project');
  if (dataDir && isInside(filePath, dataDir)) warnings.push('inside_data');
  if (uploadDir && isInside(filePath, uploadDir)) warnings.push('inside_upload');
  return [...new Set(warnings)];
}

function fileSecurityWarnings(stat, { platform = process.platform, expectedUid = 0 } = {}) {
  const warnings = [];
  if (!stat) return ['missing_stat'];
  if (stat.isSymbolicLink) warnings.push('symlink');
  if (!stat.isFile) warnings.push('not_regular_file');
  if (platform !== 'win32') {
    const mode = Number(stat.mode) & 0o777;
    if (mode !== 0o600) warnings.push('unsafe_permissions');
    if (expectedUid !== null && expectedUid !== undefined && Number(stat.uid) !== Number(expectedUid)) {
      warnings.push('unexpected_owner');
    }
  }
  return warnings;
}

function directorySecurityWarnings(stat, { platform = process.platform, expectedUid = 0 } = {}) {
  const warnings = [];
  if (!stat) return ['missing_stat'];
  if (platform !== 'win32') {
    const mode = Number(stat.mode) & 0o777;
    if ((mode & 0o022) !== 0) warnings.push('unsafe_directory_permissions');
    if (expectedUid !== null && expectedUid !== undefined && Number(stat.uid) !== Number(expectedUid)) {
      warnings.push('unexpected_directory_owner');
    }
  }
  return warnings;
}

function readSuperadminFile(filePath, { logger = console, projectRoot, dataDir, uploadDir } = {}) {
  const pathWarnings = pathSafetyWarnings(filePath, { projectRoot, dataDir, uploadDir });
  for (const warning of pathWarnings) {
    logger.warn('Warnung: Superadmin-Datei liegt im Repo-, Daten- oder Upload-Bereich. Bitte außerhalb von Repo, Daten-Volume und Backup ablegen.');
    break;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { ok: false, reason: 'missing', pathWarnings };
  }

  let linkStat = null;
  try {
    linkStat = fs.lstatSync(filePath);
  } catch {
    linkStat = null;
  }
  const securityWarnings = fileSecurityWarnings({
    mode: stat.mode,
    uid: stat.uid,
    isFile: stat.isFile(),
    isSymbolicLink: Boolean(linkStat?.isSymbolicLink())
  });
  let directoryStat = null;
  try {
    directoryStat = fs.statSync(path.dirname(filePath));
  } catch {
    directoryStat = null;
  }
  securityWarnings.push(...directorySecurityWarnings(directoryStat ? { mode: directoryStat.mode, uid: directoryStat.uid } : null));
  if (securityWarnings.length) {
    logger.warn('Warnung: Superadmin-Datei oder -Verzeichnis hat unsichere Rechte oder Eigentümer. Erwartet werden eine reguläre Datei mit root:root und 0600 in einem nicht gruppen-/weltbeschreibbaren Verzeichnis.');
  }

  if (!stat.isFile()) return { ok: false, reason: 'not_regular_file', pathWarnings, securityWarnings };
  if (Number(stat.size) > MAX_FILE_BYTES) return { ok: false, reason: 'too_large', pathWarnings, securityWarnings };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { ok: false, reason: 'unreadable_or_invalid_json', pathWarnings, securityWarnings };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_structure', pathWarnings, securityWarnings };
  }
  if (Object.keys(parsed).some((key) => String(key).toLowerCase() === 'password')) {
    return { ok: false, reason: 'plaintext_password_not_allowed', pathWarnings, securityWarnings };
  }
  const email = typeof parsed.email === 'string' ? parsed.email.trim().toLowerCase() : '';
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const passwordHash = typeof parsed.passwordHash === 'string' ? parsed.passwordHash : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 200) {
    return { ok: false, reason: 'invalid_email', pathWarnings, securityWarnings };
  }
  if (!name || name.length > 120) {
    return { ok: false, reason: 'invalid_name', pathWarnings, securityWarnings };
  }
  if (!BCRYPT_COST_12.test(passwordHash)) {
    return { ok: false, reason: 'invalid_password_hash', pathWarnings, securityWarnings };
  }

  return {
    ok: true,
    data: { email, name, passwordHash },
    pathWarnings,
    securityWarnings
  };
}

function availableSuperadminRoleName(db) {
  const conflict = db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE AND id <> ?')
    .get(SUPERADMIN_ROLE_NAME, SUPERADMIN_ROLE_ID);
  if (!conflict) return SUPERADMIN_ROLE_NAME;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${SUPERADMIN_ROLE_NAME} (System${index === 1 ? '' : ` ${index}`})`;
    const existing = db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(candidate, SUPERADMIN_ROLE_ID);
    if (!existing) return candidate;
  }
  return `${SUPERADMIN_ROLE_NAME} (System ${Date.now()})`;
}

function ensureSuperadminRole(db) {
  const now = isoNow();
  const permissions = JSON.stringify(normalizePermissions(ALL_PERMISSIONS));
  const roleName = availableSuperadminRoleName(db);
  const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(SUPERADMIN_ROLE_ID);
  if (!existing) {
    db.prepare(`
      INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
      VALUES (?, ?, ?, '{}', '{"allow":[],"deny":[]}', 1, ?, ?, ?)
    `).run(SUPERADMIN_ROLE_ID, roleName, permissions, SUPERADMIN_RANK, now, now);
    return true;
  }
  const unchanged = existing.name === roleName
    && existing.permissions === permissions
    && existing.object_permissions === '{}'
    && existing.booking_request_policy === '{"allow":[],"deny":[]}'
    && Number(existing.is_system) === 1
    && Number(existing.rank) === SUPERADMIN_RANK;
  if (unchanged) return false;
  db.prepare(`
    UPDATE roles
    SET name = ?, permissions = ?, object_permissions = '{}',
      booking_request_policy = '{"allow":[],"deny":[]}', is_system = 1, rank = ?, updated_at = ?
    WHERE id = ?
  `).run(roleName, permissions, SUPERADMIN_RANK, now, SUPERADMIN_ROLE_ID);
  return true;
}

function migrateSuperadminSchema(db) {
  const previous = Number(db.pragma('user_version', { simple: true })) || 0;
  db.transaction(() => {
    ensureSuperadminRole(db);
    if (previous < SUPERADMIN_SCHEMA_VERSION) db.pragma(`user_version = ${SUPERADMIN_SCHEMA_VERSION}`);
  })();
  return previous < SUPERADMIN_SCHEMA_VERSION;
}

function invalidateSuperadminSessions(db) {
  return db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(SUPERADMIN_USER_ID).changes;
}

function auditSuperadminUpdate(db, details) {
  writeAudit(db, {
    userId: null,
    action: 'superadmin_update',
    entityType: 'user',
    entityId: SUPERADMIN_USER_ID,
    details
  });
}

function auditSuperadminCreated(db) {
  writeAudit(db, {
    userId: null,
    action: 'superadmin_created',
    entityType: 'user',
    entityId: SUPERADMIN_USER_ID,
    details: { source: 'SUPERADMIN_FILE' }
  });
}

function auditSuperadminState(db, action, reason) {
  writeAudit(db, {
    userId: null,
    action,
    entityType: 'user',
    entityId: SUPERADMIN_USER_ID,
    details: { reason }
  });
}

function disableSuperadmin(db, reason, logger) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(SUPERADMIN_USER_ID);
  if (!existing) {
    logger.warn(`Warnung: Superadmin-Datei ${reason === 'missing' ? 'fehlt' : 'ist ungültig'}. Der Superadmin-Login ist gesperrt; das System läuft weiter.`);
    return { status: 'disabled', reason, changed: false };
  }
  let changed = false;
  if (Number(existing.active) !== 0) {
    const now = isoNow();
    db.prepare(`
      UPDATE users
      SET active = 0, deactivated_at = COALESCE(deactivated_at, ?), updated_at = ?
      WHERE id = ?
    `).run(now, now, SUPERADMIN_USER_ID);
    changed = true;
  }
  const sessions = invalidateSuperadminSessions(db);
  if (changed) auditSuperadminState(db, 'superadmin_disabled', reason);
  logger.warn(`Warnung: Superadmin-Datei ${reason === 'missing' ? 'fehlt' : 'ist ungültig'}. Der Superadmin-Login ist gesperrt; das System läuft weiter.`);
  return { status: 'disabled', reason, changed, sessionsInvalidated: sessions };
}

function applyValidSuperadmin(db, data, logger) {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(SUPERADMIN_USER_ID);
  const conflict = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?')
    .get(data.email, SUPERADMIN_USER_ID);
  if (conflict) {
    logger.warn('Warnung: Superadmin-Datei konnte nicht angewendet werden, weil die E-Mail-Adresse bereits von einem anderen Konto verwendet wird. Der Superadmin-Login ist gesperrt.');
    return disableSuperadmin(db, 'email_conflict', logger);
  }

  const now = isoNow();
  if (!existing) {
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(SUPERADMIN_USER_ID, data.email, data.name, data.passwordHash, SUPERADMIN_ROLE_ID, now, now);
    invalidateSuperadminSessions(db);
    auditSuperadminCreated(db);
    logger.log('Superadmin-Konto wurde aus der Datei angelegt und ist aktiv.');
    return { status: 'active', reason: 'created', changed: true, created: true };
  }

  const emailChanged = String(existing.email).toLowerCase() !== data.email;
  const nameChanged = String(existing.name) !== data.name;
  const hashChanged = String(existing.password_hash) !== data.passwordHash;
  const reactivated = Number(existing.active) !== 1 || Boolean(existing.anonymized_at);
  const roleChanged = existing.role !== SUPERADMIN_ROLE_ID;
  if (!emailChanged && !nameChanged && !hashChanged && !reactivated && !roleChanged) {
    return { status: 'active', reason: 'unchanged', changed: false };
  }

  db.prepare(`
    UPDATE users
    SET email = ?, name = ?, password_hash = ?, role = ?, active = 1,
      deactivated_at = NULL, anonymized_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(data.email, data.name, data.passwordHash, SUPERADMIN_ROLE_ID, now, SUPERADMIN_USER_ID);

  let sessions = 0;
  if (emailChanged || hashChanged || reactivated) sessions = invalidateSuperadminSessions(db);
  auditSuperadminUpdate(db, {
    emailChanged,
    nameChanged,
    passwordChanged: hashChanged,
    reactivated,
    roleRestored: roleChanged
  });
  logger.log(reactivated ? 'Superadmin-Konto wurde aus der Datei reaktiviert.' : 'Superadmin-Konto wurde aus der Datei aktualisiert.');
  return {
    status: 'active',
    reason: reactivated ? 'reactivated' : 'updated',
    changed: true,
    emailChanged,
    passwordChanged: hashChanged,
    sessionsInvalidated: sessions
  };
}

function disableSecondarySuperadmins(db, logger) {
  const rows = db.prepare(`
    SELECT id, active FROM users
    WHERE role = ? AND id <> ?
  `).all(SUPERADMIN_ROLE_ID, SUPERADMIN_USER_ID);
  if (!rows.length) return 0;
  const now = isoNow();
  for (const row of rows) {
    if (Number(row.active) === 1) {
      db.prepare('UPDATE users SET active = 0, deactivated_at = COALESCE(deactivated_at, ?), updated_at = ? WHERE id = ?')
        .run(now, now, row.id);
      writeAudit(db, {
        userId: null,
        action: 'superadmin_disabled',
        entityType: 'user',
        entityId: row.id,
        details: { reason: 'duplicate_superadmin_role' }
      });
    }
    db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(row.id);
  }
  logger.warn('Warnung: Weitere Konten mit der Superadmin-Rolle wurden deaktiviert. Es darf nur das datei-verwaltete Superadmin-Konto geben.');
  return rows.length;
}

function ensureSuperadmin(db, options = {}) {
  const logger = options.logger || console;
  disableSecondarySuperadmins(db, logger);
  const filePath = options.filePath || defaultSuperadminFile();
  const read = readSuperadminFile(filePath, {
    logger,
    projectRoot: options.projectRoot,
    dataDir: options.dataDir,
    uploadDir: options.uploadDir
  });
  if (!read.ok) return disableSuperadmin(db, read.reason, logger);

  try {
    return applyValidSuperadmin(db, read.data, logger);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      logger.warn('Warnung: Superadmin-Datei konnte wegen eines Eindeutigkeitskonflikts nicht angewendet werden. Der Superadmin-Login ist gesperrt.');
      return disableSuperadmin(db, 'email_conflict', logger);
    }
    logger.warn('Warnung: Superadmin-Datei konnte nicht angewendet werden. Der Superadmin-Login ist gesperrt; das System läuft weiter.');
    return disableSuperadmin(db, 'apply_failed', logger);
  }
}

module.exports = {
  SUPERADMIN_USER_ID,
  SUPERADMIN_ROLE_ID,
  SUPERADMIN_ROLE_NAME,
  SUPERADMIN_RANK,
  SUPERADMIN_SCHEMA_VERSION,
  defaultSuperadminFile,
  pathSafetyWarnings,
  fileSecurityWarnings,
  directorySecurityWarnings,
  readSuperadminFile,
  ensureSuperadminRole,
  migrateSuperadminSchema,
  disableSecondarySuperadmins,
  ensureSuperadmin,
  invalidateSuperadminSessions
};
