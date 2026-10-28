'use strict';

const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { db, DATA_DIR } = require('../db');
const { getState, mapUser } = require('../lib/state');
const {
  HttpError,
  requiredString,
  optionalString,
  optionalDate,
  requiredDate,
  intValue,
  numericValue,
  emailValue,
  oneOf,
  hexColorValue,
  licensesValue,
  booleanValue,
  isoNow,
  todayISO,
  combineDateTime
} = require('../lib/validation');
const { storeVehicleImage, storeReceipt, storeBrandingLogo, deleteUpload, uploadPath } = require('../lib/files');
const { writeAudit } = require('../lib/audit');
const { queryAudit, recordAuditRead } = require('../lib/audit-query');
const { anonymizeUser, runAutoAnonymization } = require('../lib/anonymize');
const {
  normalizeBookingRequestPolicy,
  isRequestVisibleToApprover,
  cancelOpenBookingRequests
} = require('../lib/booking-requests');
const {
  PERMISSION_GROUPS,
  normalizePermissions,
  parsePermissions,
  normalizePermissionOverrides,
  parsePermissionOverrides,
  parseObjectPermissions,
  normalizeObjectPermissions,
  requirePermission,
  hasEffectivePermission,
  getRoleRank,
  rolePermissionsWithin,
  isObjectPermissionDenied,
  publicObjectTypes
} = require('../lib/permissions');
const { SUPERADMIN_USER_ID, SUPERADMIN_ROLE_ID } = require('../lib/superadmin');
const {
  parseCostCenterPayload,
  getCostCenter,
  assertCostCenterAssignable,
  resolveBookingCostCenter,
  resolveCostCostCenter,
  getCostCenterUsage
} = require('../lib/cost-centers');
const { COLOR_MODES } = require('../lib/color-mode');
const { leasingWarningForVehicle, triggerLeasingCheck } = require('../lib/leasing');
const {
  loadSmtpConfig,
  saveSmtpConfig,
  sendMail,
  sanitizeSmtpError,
  smtpErrorMessage
} = require('../lib/smtp');

const router = express.Router();

router.use('/security', require('./security'));

const VEHICLE_TYPES = ['Pkw', 'Transporter', 'Bus'];
const FUEL_TYPES = ['Diesel', 'Benzin', 'Elektro', 'Hybrid'];
const VEHICLE_STATUSES = ['available', 'in_use', 'maintenance'];
const DRIVER_STATUSES = ['available', 'away'];
const COST_CATEGORIES = ['Kraftstoff', 'Laden', 'Wartung', 'Versicherung', 'Kfz-Steuer', 'Sonstiges'];
const VEHICLE_COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#059669', '#e2600f', '#0891b2', '#4338ca', '#b45309', '#be123c', '#475569'];
const DRIVER_COLORS = ['#e2001a', '#0f766e', '#7c3aed', '#2563eb', '#b45309', '#be123c', '#0f8f8a', '#4338ca'];

function sendState(req, res, status = 200, extra = null) {
  const state = getState(db, req.user, req.auth);
  res.status(status).json(extra ? { ...state, ...extra } : state);
}

function assertCan(req, permission, context = {}) {
  if (!hasEffectivePermission(req, permission, context)) {
    throw new HttpError(403, 'Für diese Aktion fehlt die erforderliche Berechtigung.');
  }
}

function assertBookingAction(req, booking, vehicle, driver) {
  const context = { booking, vehicle, driver };
  if (hasEffectivePermission(req, 'bookings_manage', context)) return;
  if (booking.driver_id === req.auth?.linkedDriverId
    && hasEffectivePermission(req, 'own_trips_execute', context)) return;
  throw new HttpError(403, 'Für diese Buchung fehlt die Berechtigung.');
}

function getVehicle(id) {
  return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
}

function getDriver(id) {
  return db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
}

function getCost(id) {
  return db.prepare('SELECT * FROM costs WHERE id = ?').get(id);
}

function requireCostCenterViewForSelection(req, id) {
  if (id && !hasEffectivePermission(req, 'cost_centers_view')) {
    throw new HttpError(403, 'Für die Auswahl einer Kostenstelle fehlt die Berechtigung „Kostenstellen ansehen“.');
  }
}

function costCenterIdForPayload(req, body, existingId = null) {
  const provided = Object.prototype.hasOwnProperty.call(body || {}, 'costCenterId');
  const raw = provided ? body.costCenterId : existingId;
  if (raw === undefined || raw === null || raw === '') return null;
  const id = requiredString(raw, 'Kostenstelle', { max: 120 });
  if (provided && id !== (existingId || null)) requireCostCenterViewForSelection(req, id);
  return assertCostCenterAssignable(db, id, { existingId });
}

function resolveBookingCostCenterFromPayload(req, body, { driver = null, vehicle = null, user = null } = {}) {
  const explicit = Object.prototype.hasOwnProperty.call(body || {}, 'costCenterId');
  if (!explicit) {
    return resolveBookingCostCenter(db, { explicit: false, driver, vehicle, user });
  }
  const raw = body.costCenterId;
  const explicitId = raw === undefined || raw === null || raw === '' ? null : requiredString(raw, 'Kostenstelle', { max: 120 });
  requireCostCenterViewForSelection(req, explicitId);
  return resolveBookingCostCenter(db, { explicit: true, explicitId });
}

function resolveCostCostCenterFromPayload(req, body, { vehicle = null, user = null } = {}) {
  const explicit = Object.prototype.hasOwnProperty.call(body || {}, 'costCenterId');
  if (!explicit) {
    return resolveCostCostCenter(db, { explicit: false, vehicle, user });
  }
  const raw = body.costCenterId;
  const explicitId = raw === undefined || raw === null || raw === '' ? null : requiredString(raw, 'Kostenstelle', { max: 120 });
  requireCostCenterViewForSelection(req, explicitId);
  return resolveCostCostCenter(db, { explicit: true, explicitId });
}

const ADMIN_ROLE_ID = 'admin';

function isSuperadminActor(req) {
  return req.user?.role === SUPERADMIN_ROLE_ID;
}

function isPrivilegedActor(req) {
  return req.user?.role === ADMIN_ROLE_ID || isSuperadminActor(req);
}

function requireAdmin(req, _res, next) {
  if (!isPrivilegedActor(req)) {
    return next(new HttpError(403, 'Diese Aktion ist Administrator:innen vorbehalten.'));
  }
  return next();
}

function assertLastActiveAdminChange(existing, nextRole, nextActive) {
  if (existing.role !== ADMIN_ROLE_ID || !existing.active) return;
  if (nextRole === ADMIN_ROLE_ID && nextActive) return;
  const otherAdmins = db.prepare(`
    SELECT COUNT(*) AS count FROM users
    WHERE role = ? AND active = 1 AND id <> ?
  `).get(ADMIN_ROLE_ID, existing.id).count;
  if (otherAdmins === 0) {
    throw new HttpError(400, 'Mindestens ein aktives Administratorkonto muss bestehen bleiben.');
  }
}

function actorRank(req) {
  return getRoleRank(db, req.user.role);
}

function assertRoleGrantable(req, roleId) {
  if (roleId === SUPERADMIN_ROLE_ID) {
    throw new HttpError(403, 'Die Superadmin-Rolle kann nicht über die Benutzerverwaltung vergeben werden.');
  }
  if (roleId === ADMIN_ROLE_ID && !isSuperadminActor(req)) {
    throw new HttpError(403, 'Administratorkonten können nur durch den Superadmin angelegt oder verwaltet werden.');
  }
  const role = db.prepare('SELECT id, name, rank FROM roles WHERE id = ?').get(roleId);
  if (!role) throw new HttpError(400, 'Die ausgewählte Rolle existiert nicht.');
  if ((Number(role.rank) || 0) >= actorRank(req)) {
    throw new HttpError(403, 'Rollen können nur unterhalb des eigenen Rangs vergeben werden.');
  }
  if (!isPrivilegedActor(req) && !rolePermissionsWithin(db, roleId, req.permissions)) {
    throw new HttpError(403, 'Diese Rolle enthält Rechte, die Ihre eigene Rolle nicht vergeben darf.');
  }
  return role;
}

function assertRoleManageable(req, role) {
  if (role.id === ADMIN_ROLE_ID) {
    throw new HttpError(409, 'Die Administrator-Rolle ist geschützt und kann nicht bearbeitet werden.');
  }
  if (role.id === SUPERADMIN_ROLE_ID) {
    throw new HttpError(409, 'Die Superadmin-Rolle ist systemgeschützt und kann ausschließlich über die Superadmin-Datei verwaltet werden.');
  }
  if ((Number(role.rank) || 0) >= actorRank(req)) {
    throw new HttpError(403, 'Rollen können nur unterhalb des eigenen Rangs verwaltet werden.');
  }
  if (!isPrivilegedActor(req) && !rolePermissionsWithin(db, role.id, req.permissions)) {
    throw new HttpError(403, 'Diese Rolle enthält Rechte, die Ihre eigene Rolle nicht verwalten darf.');
  }
}

function assertUserManageable(req, user) {
  if (user.id === SUPERADMIN_USER_ID || user.role === SUPERADMIN_ROLE_ID) {
    throw new HttpError(403, 'Das Superadmin-Konto ist systemgeschützt und kann nicht über die Benutzerverwaltung bearbeitet werden.');
  }
  if (user.id === req.user.id) {
    throw new HttpError(400, 'Das eigene Konto kann nicht über die Benutzerverwaltung bearbeitet werden.');
  }
  if (user.role === ADMIN_ROLE_ID && !isSuperadminActor(req)) {
    throw new HttpError(403, 'Administratorkonten können nur durch den Superadmin verwaltet werden.');
  }
  const targetRank = getRoleRank(db, user.role);
  if (targetRank >= actorRank(req)) {
    throw new HttpError(403, 'Benutzerkonten können nur unterhalb des eigenen Rangs verwaltet werden.');
  }
  if (!isPrivilegedActor(req)) {
    if (!rolePermissionsWithin(db, user.role, req.permissions)) {
      throw new HttpError(403, 'Diese Rolle enthält Rechte, die Ihre eigene Rolle nicht verwalten darf.');
    }
    const overrides = parsePermissionOverrides(user.permission_overrides);
    const objectPermissions = parseObjectPermissions(user.object_permissions);
    if ((overrides.allow || []).some((permission) => !req.permissions.has(permission))) {
      throw new HttpError(403, 'Dieses Konto besitzt Rechte, die Ihre eigene Rolle nicht verwalten darf.');
    }
    for (const entries of Object.values(objectPermissions)) {
      for (const rule of Object.values(entries || {})) {
        if ((rule.allow || []).some((permission) => !req.permissions.has(permission))) {
          throw new HttpError(403, 'Dieses Konto besitzt Rechte, die Ihre eigene Rolle nicht verwalten darf.');
        }
      }
    }
  }
}

function assertGrantCeiling(req, permissions, objectPermissions = null) {
  if (isPrivilegedActor(req)) return;
  for (const permission of permissions || []) {
    if (!req.permissions.has(permission)) {
      throw new HttpError(403, 'Es können nur Rechte der eigenen Rolle weitergegeben werden.');
    }
  }
  for (const entries of Object.values(objectPermissions || {})) {
    for (const rule of Object.values(entries || {})) {
      for (const permission of rule.allow || []) {
        if (!req.permissions.has(permission)) {
          throw new HttpError(403, 'Es können nur Rechte der eigenen Rolle weitergegeben werden.');
        }
      }
    }
  }
}

function defaultRoleRank(req) {
  return Math.max(1, Math.min(899999, actorRank(req) - 1));
}

function rankBelowActor(req, value) {
  const rank = intValue(value, 'Rang', { min: 1, max: Number.MAX_SAFE_INTEGER, required: true });
  if (rank >= actorRank(req)) {
    throw new HttpError(403, 'Der Rang muss strikt unterhalb des eigenen Rangs liegen.');
  }
  return rank;
}

function audit(req, action, entityType, entityId, details = null) {
  writeAudit(db, { userId: req.user.id, action, entityType, entityId, details });
}

function ensureVehicleExists(id) {
  const vehicle = getVehicle(id);
  if (!vehicle) throw new HttpError(404, 'Fahrzeug wurde nicht gefunden.');
  return vehicle;
}

function ensureDriverExists(id) {
  const driver = getDriver(id);
  if (!driver) throw new HttpError(404, 'Fahrer:in wurde nicht gefunden.');
  return driver;
}

function getLinkedDriver(userId) {
  return db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(userId) || null;
}

function formatConflictTime(value) {
  return String(value).slice(11, 16);
}

function getBookingConflict(vehicleId, driverId, start, end, vehicleName, driverName) {
  const vehicleConflict = db.prepare(`
    SELECT id, purpose, start_at, end_at FROM bookings
    WHERE vehicle_id = ? AND status IN ('planned', 'active')
      AND start_at < ? AND end_at > ?
    ORDER BY start_at LIMIT 1
  `).get(vehicleId, end, start);
  const driverConflict = db.prepare(`
    SELECT id, purpose, start_at, end_at FROM bookings
    WHERE driver_id = ? AND status IN ('planned', 'active')
      AND start_at < ? AND end_at > ?
    ORDER BY start_at LIMIT 1
  `).get(driverId, end, start);
  const messages = [];
  if (vehicleConflict) {
    messages.push(`${vehicleName} ist in diesem Zeitraum bereits von ${formatConflictTime(vehicleConflict.start_at)} bis ${formatConflictTime(vehicleConflict.end_at)} gebucht (${vehicleConflict.purpose}). Bitte wählen Sie einen anderen Zeitraum.`);
  }
  if (driverConflict) {
    messages.push(`${driverName} ist in diesem Zeitraum bereits eingeplant (${driverConflict.purpose}). Bitte wählen Sie eine andere Fahrer:in.`);
  }
  return {
    hasConflict: messages.length > 0,
    vehicleConflict,
    driverConflict,
    message: messages.join(' ')
  };
}

function assertBookingConflict(vehicleId, driverId, start, end, vehicleName, driverName) {
  const conflict = getBookingConflict(vehicleId, driverId, start, end, vehicleName, driverName);
  if (conflict.hasConflict) throw new HttpError(409, conflict.message);
}

function syncVehicleStatus(vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle || vehicle.status === 'maintenance') return;
  const active = db.prepare("SELECT 1 FROM bookings WHERE vehicle_id = ? AND status = 'active' LIMIT 1").get(vehicleId);
  db.prepare('UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?')
    .run(active ? 'in_use' : 'available', isoNow(), vehicleId);
}

function mapSessionUser(user) {
  const costCenter = user?.cost_center_id ? getCostCenter(user.cost_center_id) : null;
  const settings = db.prepare('SELECT default_color_mode FROM settings WHERE id = 1').get();
  return mapUser(user, costCenter, settings?.default_color_mode || 'light');
}

/* =========================================================
   Session & Benachrichtigungen
   ========================================================= */
router.get('/session', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const isSuperadmin = req.user.role === SUPERADMIN_ROLE_ID;
  const isPrivileged = isAdmin || isSuperadmin;
  res.json({
    user: {
      ...mapSessionUser(req.user),
      roleName: req.roleName,
      roleRank: getRoleRank(db, req.user.role),
      isAdmin,
      isSuperadmin
    },
    csrfToken: req.session.csrfToken,
    permissions: [...req.permissions],
    permissionGroups: PERMISSION_GROUPS,
    objectTypes: publicObjectTypes(),
    capabilities: {
      manageUsers: isPrivileged || req.permissions.has('users_manage'),
      manageRoles: isPrivileged || req.permissions.has('roles_manage'),
      manageBookingRequests: isPrivileged || req.permissions.has('booking_requests_manage'),
      manageAdmins: isSuperadmin,
      hasOwnTrips: Boolean(req.auth?.linkedDriverId),
      isAdmin,
      isSuperadmin,
      canChangePassword: !isSuperadmin,
      viewCosts: req.permissions.has('costs_view')
    }
  });
});

router.get('/state', (req, res) => {
  sendState(req, res);
});

function csvEscape(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function localISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

router.get('/export/logbook.csv', requirePermission('logbook_export'), (req, res, next) => {
  try {
    const period = ['30', '90', 'all'].includes(String(req.query.period)) ? String(req.query.period) : '30';
    const rawCostCenterFilter = req.query.costCenter;
    const hasCostCenterFilter = rawCostCenterFilter !== undefined;
    const costCenterFilter = rawCostCenterFilter === 'none' ? null : (rawCostCenterFilter ? String(rawCostCenterFilter) : null);
    const state = getState(db, req.user, req.auth);
    const today = todayISO();
    let cutoff = null;
    if (period !== 'all') {
      const date = new Date(`${today}T00:00:00`);
      date.setDate(date.getDate() - Number(period));
      cutoff = localISODate(date);
    }
    const trips = state.bookings
      .filter((booking) => booking.status === 'completed')
      .filter((booking) => !cutoff || booking.start.slice(0, 10) >= cutoff)
      .filter((booking) => !hasCostCenterFilter || (costCenterFilter === null ? !booking.costCenterId : booking.costCenterId === costCenterFilter))
      .sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const vehicles = new Map(state.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const drivers = new Map(state.drivers.map((driver) => [driver.id, driver]));
    const rows = [
      ['Datum', 'Fahrzeug', 'Kennzeichen', 'Fahrer:in', 'Zweck', 'Von', 'Bis', 'Start-km', 'End-km', 'Distanz-km', 'Kostenstelle'],
      ...trips.map((trip) => {
        const vehicle = vehicles.get(trip.vehicleId);
        const driver = drivers.get(trip.driverId);
        const distance = Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0));
        const costCenter = trip.costCenterCode
          ? `${trip.costCenterCode} · ${trip.costCenterName || ''}`.trim()
          : (trip.costCenterName || '');
        return [
          trip.start.slice(0, 10).split('-').reverse().join('.'),
          vehicle?.name || trip.vehicleName || '',
          vehicle?.plate || trip.vehiclePlate || '',
          driver?.name || trip.driverName || '',
          trip.purpose,
          trip.start.slice(11, 16),
          trip.end.slice(11, 16),
          trip.startKm ?? '',
          trip.endKm ?? '',
          distance,
          costCenter
        ];
      })
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fahrtenbuch-${today}.csv"`);
    res.send(`\uFEFF${csv}`);
    audit(req, 'export', 'logbook', 'csv', { period, costCenter: costCenterFilter || null, count: trips.length });
  } catch (error) {
    next(error);
  }
});

router.get('/export/data.json', requirePermission('export_data'), (req, res, next) => {
  try {
    const state = getState(db, req.user, req.auth);
    delete state.smtp;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fuhrpark-daten-${todayISO()}.json"`);
    res.send(JSON.stringify(state, null, 2));
    audit(req, 'export', 'data', 'json');
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', (req, res) => {
  audit(req, 'logout', 'user', req.user.id);
  req.session.destroy((error) => {
    if (error) console.warn('Session konnte beim Logout nicht gelöscht werden:', error.message);
    res.clearCookie('awo.sid');
    res.status(204).end();
  });
});

router.post('/auth/password', async (req, res, next) => {
  try {
    if (isSuperadminActor(req)) {
      throw new HttpError(403, 'Das Superadmin-Passwort kann ausschließlich über die Superadmin-Datei und einen Neustart geändert werden.');
    }
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = passwordValue(req.body?.newPassword);
    const valid = await bcrypt.compare(currentPassword, req.user.password_hash);
    if (!valid) throw new HttpError(400, 'Das aktuelle Passwort ist nicht korrekt.');
    const now = isoNow();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 12), now, req.user.id);
    // Alle anderen Sitzungen dieses Kontos beenden, die aktuelle Sitzung bleibt bestehen.
    db.prepare("DELETE FROM sessions WHERE sid <> ? AND json_extract(sess, '$.userId') = ?").run(req.sessionID, req.user.id);
    audit(req, 'change_password', 'user', req.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.patch('/me/driver-link', requireAdmin, (req, res, next) => {
  try {
    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'driverId')) {
      throw new HttpError(400, 'Bitte wählen Sie ein Fahrerprofil aus oder entfernen Sie die Verknüpfung.');
    }
    const driverId = body.driverId === null || body.driverId === ''
      ? null
      : requiredString(body.driverId, 'Fahrer:in', { max: 120 });
    const ownTripsAccess = booleanValue(body.ownTripsAccess, true) ? 1 : 0;
    const currentDriver = getLinkedDriver(req.user.id);
    let nextDriver = null;

    if (driverId) {
      nextDriver = getDriver(driverId);
      if (!nextDriver) throw new HttpError(400, 'Die ausgewählte Fahrer:in existiert nicht.');
      if (nextDriver.user_id && nextDriver.user_id !== req.user.id) {
        throw new HttpError(409, 'Diese Fahrer:in ist bereits mit einem Benutzerkonto verknüpft.');
      }
    }

    const linkChanged = (currentDriver?.id || null) !== driverId;
    const accessChanged = Boolean(driverId) && Number(currentDriver?.own_trips_access ?? 1) !== ownTripsAccess;
    if (linkChanged || accessChanged) {
      const now = isoNow();
      db.transaction(() => {
        if (currentDriver && currentDriver.id !== driverId) {
          db.prepare('UPDATE drivers SET user_id = NULL, updated_at = ? WHERE id = ?')
            .run(now, currentDriver.id);
        }
        if (nextDriver) {
          db.prepare('UPDATE drivers SET user_id = ?, own_trips_access = ?, updated_at = ? WHERE id = ?')
            .run(req.user.id, ownTripsAccess, now, nextDriver.id);
        }
        if (driverId) {
          audit(req, 'link_driver', 'user', req.user.id, {
            driverId,
            ownTripsAccess
          });
        } else {
          audit(req, 'unlink_driver', 'user', req.user.id, {
            driverId: currentDriver?.id || null,
            ownTripsAccess: null
          });
        }
      })();
    }
    sendState(req, res);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(error.message).includes('drivers.user_id')) {
      return next(new HttpError(409, 'Diese Fahrer:in ist bereits mit einem Benutzerkonto verknüpft.'));
    }
    next(error);
  }
});

router.patch('/me/preferences', (req, res, next) => {
  try {
    const colorMode = oneOf(req.body?.colorMode, COLOR_MODES, 'Farbschema');
    db.prepare('UPDATE users SET color_mode = ?, updated_at = ? WHERE id = ?')
      .run(colorMode, isoNow(), req.user.id);
    audit(req, 'update', 'user', req.user.id, { colorMode });
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: mapSessionUser(updated) });
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/read', (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const validKeys = [...new Set(keys.map(String).filter((key) => key.length > 0 && key.length <= 200))].slice(0, 250);
  if (!validKeys.length) return sendState(req, res);
  const now = isoNow();
  const insert = db.prepare('INSERT INTO notification_reads (user_id, alert_key, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, alert_key) DO NOTHING');
  const transaction = db.transaction(() => {
    validKeys.forEach((key) => insert.run(req.user.id, key, now));
  });
  transaction();
  sendState(req, res);
});

/* =========================================================
   Kostenstellen
   ========================================================= */
router.post('/cost-centers', requirePermission('cost_centers_manage'), (req, res, next) => {
  try {
    const values = parseCostCenterPayload(req.body || {});
    const duplicate = db.prepare('SELECT id FROM cost_centers WHERE code = ? COLLATE NOCASE').get(values.code);
    if (duplicate) throw new HttpError(409, 'Eine Kostenstelle mit diesem Code existiert bereits.');
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO cost_centers (id, code, name, description, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, values.code, values.name, values.description, values.active ? 1 : 0, now, now);
    audit(req, 'create', 'cost_center', id, values);
    sendState(req, res, 201);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Eine Kostenstelle mit diesem Code existiert bereits.'));
    next(error);
  }
});

router.patch('/cost-centers/:id', requirePermission('cost_centers_manage'), (req, res, next) => {
  try {
    const existing = getCostCenter(db, req.params.id);
    if (!existing) throw new HttpError(404, 'Kostenstelle wurde nicht gefunden.');
    const values = parseCostCenterPayload(req.body || {}, existing);
    const duplicate = db.prepare('SELECT id FROM cost_centers WHERE code = ? COLLATE NOCASE AND id <> ?').get(values.code, existing.id);
    if (duplicate) throw new HttpError(409, 'Eine Kostenstelle mit diesem Code existiert bereits.');
    const activeChanged = Boolean(existing.active) !== values.active;
    db.transaction(() => {
      db.prepare(`
        UPDATE cost_centers
        SET code = ?, name = ?, description = ?, active = ?, updated_at = ?
        WHERE id = ?
      `).run(values.code, values.name, values.description, values.active ? 1 : 0, isoNow(), existing.id);
      audit(req, 'update', 'cost_center', existing.id, {
        code: values.code,
        name: values.name,
        active: values.active,
        previousCode: existing.code,
        previousName: existing.name,
        previousActive: Boolean(existing.active)
      });
      if (activeChanged) {
        audit(req, values.active ? 'activate' : 'deactivate', 'cost_center', existing.id, { code: values.code });
      }
    })();
    sendState(req, res);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Eine Kostenstelle mit diesem Code existiert bereits.'));
    next(error);
  }
});

router.post('/cost-centers/:id/deactivate', requirePermission('cost_centers_manage'), (req, res, next) => {
  try {
    const existing = getCostCenter(db, req.params.id);
    if (!existing) throw new HttpError(404, 'Kostenstelle wurde nicht gefunden.');
    if (existing.active) {
      db.prepare('UPDATE cost_centers SET active = 0, updated_at = ? WHERE id = ?').run(isoNow(), existing.id);
      audit(req, 'deactivate', 'cost_center', existing.id, { code: existing.code });
    }
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.delete('/cost-centers/:id', requirePermission('cost_centers_manage'), (req, res, next) => {
  try {
    const existing = getCostCenter(db, req.params.id);
    if (!existing) throw new HttpError(404, 'Kostenstelle wurde nicht gefunden.');
    const usage = getCostCenterUsage(db, existing.id);
    if (usage.total > 0) {
      throw new HttpError(
        409,
        'Die Kostenstelle wird noch verwendet und kann nicht gelöscht werden. Deaktivieren Sie sie stattdessen.',
        { usage }
      );
    }
    db.prepare('DELETE FROM cost_centers WHERE id = ?').run(existing.id);
    audit(req, 'delete', 'cost_center', existing.id, { code: existing.code, name: existing.name });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Fahrzeuge
   ========================================================= */
function parseLeasingPayload(body, existing = null, mileage = 0) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const pick = (key, column) => (has(key) ? body[key] : existing?.[column]);
  const start = optionalDate(pick('leasingStart', 'leasing_start'), 'Leasingbeginn');
  const end = optionalDate(pick('leasingEnd', 'leasing_end'), 'Leasingende');
  const startKmRaw = pick('leasingStartKm', 'leasing_start_km');
  const limitRaw = pick('leasingKmLimit', 'leasing_km_limit');
  const startKm = startKmRaw === undefined || startKmRaw === null || startKmRaw === ''
    ? null
    : intValue(startKmRaw, 'Leasing-Startkilometer', { min: 0, max: 10_000_000, required: true });
  const kmLimit = limitRaw === undefined || limitRaw === null || limitRaw === ''
    ? null
    : intValue(limitRaw, 'Leasing-Kilometerlimit', { min: 1, max: 10_000_000, required: true });

  if (!start && !end && startKm === null && kmLimit === null) {
    return { leasingStart: null, leasingEnd: null, leasingStartKm: null, leasingKmLimit: null };
  }
  if (!end) throw new HttpError(400, 'Bitte geben Sie für die Leasingüberwachung ein Leasingende an.');
  if (kmLimit === null) throw new HttpError(400, 'Bitte geben Sie ein Gesamt-Kilometerlimit für das Leasing an.');
  if (start && end < start) throw new HttpError(400, 'Das Leasingende muss nach dem Leasingbeginn liegen.');
  if (startKm !== null && startKm > mileage) {
    throw new HttpError(400, 'Der Leasing-Startkilometerstand darf den aktuellen Kilometerstand nicht übersteigen.');
  }
  return {
    leasingStart: start,
    leasingEnd: end,
    leasingStartKm: startKm,
    leasingKmLimit: kmLimit
  };
}

function parseVehiclePayload(body, existing = null) {
  const name = requiredString(body.name, 'Bezeichnung', { max: 120 });
  const plate = requiredString(body.plate, 'Kennzeichen', { max: 30 }).toUpperCase();
  const blocked = body.blocked === undefined ? Boolean(existing?.blocked) : booleanValue(body.blocked, false);
  const blockedReason = blocked
    ? optionalString(body.blockedReason === undefined ? existing?.blocked_reason : body.blockedReason, { max: 500 })
    : '';
  const mileage = intValue(body.mileage ?? 0, 'Kilometerstand', { min: 0, max: 10_000_000, required: true });
  const leasing = parseLeasingPayload(body, existing, mileage);
  return {
    name,
    plate,
    type: oneOf(body.type, VEHICLE_TYPES, 'Fahrzeugtyp'),
    fuel: oneOf(body.fuel, FUEL_TYPES, 'Kraftstoff'),
    seats: intValue(body.seats ?? 5, 'Sitzplätze', { min: 1, max: 100, required: true }),
    status: oneOf(body.status || 'available', VEHICLE_STATUSES, 'Status'),
    location: optionalString(body.location, { max: 160 }),
    department: optionalString(body.department, { max: 160 }),
    mileage,
    nextService: optionalDate(body.nextService, 'Nächste Inspektion'),
    tuv: optionalDate(body.tuv, 'HU/AU'),
    insurance: optionalString(body.insurance, { max: 160 }),
    notes: optionalString(body.notes, { max: 1000 }),
    blocked,
    blockedReason,
    ...leasing,
    color: hexColorValue(body.color, VEHICLE_COLORS[db.prepare('SELECT COUNT(*) AS count FROM vehicles').get().count % VEHICLE_COLORS.length])
  };
}

function vehicleBlockedMessage(vehicle) {
  const reason = vehicle.blocked_reason ? ` Grund: ${vehicle.blocked_reason}` : '';
  return `${vehicle.name} ist dauerhaft gesperrt und für neue Buchungen oder Buchungsanfragen nicht verfügbar.${reason}`;
}

router.post('/vehicles', requirePermission('vehicles_manage'), async (req, res, next) => {
  let imageFile = null;
  try {
    const values = parseVehiclePayload(req.body || {});
    values.costCenterId = costCenterIdForPayload(req, req.body || {}, null);
    const duplicate = db.prepare('SELECT id FROM vehicles WHERE UPPER(plate) = ?').get(values.plate);
    if (duplicate) throw new HttpError(409, `Das Kennzeichen ${values.plate} ist bereits vergeben.`);
    if (req.body?.imageData) imageFile = await storeVehicleImage(req.body.imageData);

    const id = crypto.randomUUID();
    const now = isoNow();
    const activeBooking = false;
    if (activeBooking) values.status = 'in_use';
    db.prepare(`
      INSERT INTO vehicles
        (id, name, plate, type, fuel, seats, location, department, status, mileage, blocked, blocked_reason, next_service, tuv, insurance, acquired, color, notes, image_file, cost_center_id, leasing_start, leasing_end, leasing_start_km, leasing_km_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, values.name, values.plate, values.type, values.fuel, values.seats,
      values.location, values.department, values.status, values.mileage,
      values.blocked ? 1 : 0, values.blockedReason,
      values.nextService, values.tuv, values.insurance, todayISO(),
      values.color, values.notes, imageFile, values.costCenterId,
      values.leasingStart, values.leasingEnd, values.leasingStartKm, values.leasingKmLimit,
      now, now
    );
    audit(req, 'create', 'vehicle', id, {
      name: values.name,
      plate: values.plate,
      blocked: values.blocked,
      blockedReason: values.blockedReason,
      costCenterId: values.costCenterId
    });
    if (values.blocked) audit(req, 'block', 'vehicle', id, { reason: values.blockedReason });
    if (values.leasingEnd) {
      audit(req, 'leasing_update', 'vehicle', id, {
        leasingStart: values.leasingStart,
        leasingEnd: values.leasingEnd,
        leasingStartKm: values.leasingStartKm,
        leasingKmLimit: values.leasingKmLimit
      });
    }
    triggerLeasingCheck(db, { dataDir: DATA_DIR });
    sendState(req, res, 201);
  } catch (error) {
    if (imageFile) deleteUpload(imageFile);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Dieses Kennzeichen ist bereits vergeben.'));
    next(error);
  }
});

router.patch('/vehicles/:id', async (req, res, next) => {
  let newImageFile = null;
  try {
    assertCan(req, 'vehicles_manage', { vehicle: { id: req.params.id } });
    const existing = ensureVehicleExists(req.params.id);
    const values = parseVehiclePayload(req.body || {}, existing);
    values.costCenterId = costCenterIdForPayload(req, req.body || {}, existing.cost_center_id);
    const duplicate = db.prepare('SELECT id FROM vehicles WHERE UPPER(plate) = ? AND id <> ?').get(values.plate, existing.id);
    if (duplicate) throw new HttpError(409, `Das Kennzeichen ${values.plate} ist bereits vergeben.`);

    if (req.body?.imageData) newImageFile = await storeVehicleImage(req.body.imageData);
    const removeImage = booleanValue(req.body?.removeImage, false);
    const imageFile = newImageFile || (removeImage ? null : existing.image_file);

    const active = db.prepare("SELECT 1 FROM bookings WHERE vehicle_id = ? AND status = 'active' LIMIT 1").get(existing.id);
    if (active && values.status !== 'maintenance') values.status = 'in_use';
    const blockedChanged = Boolean(existing.blocked) !== values.blocked;
    const leasingChanged = String(existing.leasing_start || '') !== String(values.leasingStart || '')
      || String(existing.leasing_end || '') !== String(values.leasingEnd || '')
      || String(existing.leasing_start_km ?? '') !== String(values.leasingStartKm ?? '')
      || String(existing.leasing_km_limit ?? '') !== String(values.leasingKmLimit ?? '');
    const mileageChanged = Number(existing.mileage) !== Number(values.mileage);
    const costCenterChanged = (existing.cost_center_id || null) !== (values.costCenterId || null);

    db.transaction(() => {
      db.prepare(`
        UPDATE vehicles SET
          name = ?, plate = ?, type = ?, fuel = ?, seats = ?, location = ?, department = ?,
          status = ?, mileage = ?, blocked = ?, blocked_reason = ?, next_service = ?, tuv = ?, insurance = ?, color = ?, notes = ?,
          cost_center_id = ?, leasing_start = ?, leasing_end = ?, leasing_start_km = ?, leasing_km_limit = ?,
          image_file = ?, updated_at = ?
        WHERE id = ?
      `).run(
        values.name, values.plate, values.type, values.fuel, values.seats,
        values.location, values.department, values.status, values.mileage,
        values.blocked ? 1 : 0, values.blockedReason,
        values.nextService, values.tuv, values.insurance, values.color, values.notes,
        values.costCenterId, values.leasingStart, values.leasingEnd, values.leasingStartKm, values.leasingKmLimit,
        imageFile, isoNow(), existing.id
      );
      audit(req, 'update', 'vehicle', existing.id, {
        name: values.name,
        plate: values.plate,
        blocked: values.blocked,
        blockedReason: values.blockedReason,
        costCenterId: values.costCenterId
      });
      if (costCenterChanged) {
        audit(req, 'assign_cost_center', 'vehicle', existing.id, {
          costCenterId: values.costCenterId,
          previousCostCenterId: existing.cost_center_id || null
        });
      }
      if (blockedChanged) {
        audit(req, values.blocked ? 'block' : 'unblock', 'vehicle', existing.id, {
          reason: values.blockedReason,
          previousReason: existing.blocked_reason || ''
        });
      }
      if (leasingChanged) {
        audit(req, 'leasing_update', 'vehicle', existing.id, {
          leasingStart: values.leasingStart,
          leasingEnd: values.leasingEnd,
          leasingStartKm: values.leasingStartKm,
          leasingKmLimit: values.leasingKmLimit,
          previous: {
            leasingStart: existing.leasing_start || null,
            leasingEnd: existing.leasing_end || null,
            leasingStartKm: existing.leasing_start_km ?? null,
            leasingKmLimit: existing.leasing_km_limit ?? null
          }
        });
      }
    })();
    if (existing.image_file && existing.image_file !== imageFile) deleteUpload(existing.image_file);
    if (leasingChanged || mileageChanged) triggerLeasingCheck(db, { dataDir: DATA_DIR });
    sendState(req, res);
  } catch (error) {
    if (newImageFile) deleteUpload(newImageFile);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Dieses Kennzeichen ist bereits vergeben.'));
    next(error);
  }
});

router.get('/vehicles/:id/image', (req, res, next) => {
  try {
    assertCan(req, 'vehicles_view', { vehicle: { id: req.params.id } });
    const vehicle = ensureVehicleExists(req.params.id);
    if (!vehicle.image_file) throw new HttpError(404, 'Für dieses Fahrzeug ist kein Bild hinterlegt.');
    const fullPath = uploadPath(vehicle.image_file);
    if (!fullPath) throw new HttpError(404, 'Das Bild wurde nicht gefunden.');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type('image/jpeg');
    res.sendFile(fullPath);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Fahrer:innen
   ========================================================= */
function parseDriverPayload(body) {
  const email = String(body.email || '').trim();
  return {
    name: requiredString(body.name, 'Name', { max: 120 }),
    role: requiredString(body.role, 'Funktion', { max: 120 }),
    department: optionalString(body.department, { max: 160 }),
    phone: optionalString(body.phone, { max: 80 }),
    email: email ? emailValue(email, 'E-Mail') : '',
    license: licensesValue(body.license),
    status: oneOf(body.status || 'available', DRIVER_STATUSES, 'Status'),
    color: hexColorValue(body.color, DRIVER_COLORS[db.prepare('SELECT COUNT(*) AS count FROM drivers').get().count % DRIVER_COLORS.length])
  };
}

router.post('/drivers', requirePermission('drivers_manage'), (req, res, next) => {
  try {
    const values = parseDriverPayload(req.body || {});
    values.costCenterId = costCenterIdForPayload(req, req.body || {}, null);
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, cost_center_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, values.name, values.role, values.department, values.phone, values.email, JSON.stringify(values.license), values.status, values.color, values.costCenterId, now, now);
    audit(req, 'create', 'driver', id, { name: values.name, costCenterId: values.costCenterId });
    sendState(req, res, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/drivers/:id', (req, res, next) => {
  try {
    const existing = ensureDriverExists(req.params.id);
    assertCan(req, 'drivers_manage', { driver: existing });
    const values = parseDriverPayload(req.body || {});
    values.costCenterId = costCenterIdForPayload(req, req.body || {}, existing.cost_center_id);
    const costCenterChanged = (existing.cost_center_id || null) !== (values.costCenterId || null);
    db.transaction(() => {
      db.prepare(`
        UPDATE drivers SET name = ?, role = ?, department = ?, phone = ?, email = ?, license = ?, status = ?, color = ?, cost_center_id = ?, updated_at = ?
        WHERE id = ?
      `).run(values.name, values.role, values.department, values.phone, values.email, JSON.stringify(values.license), values.status, values.color, values.costCenterId, isoNow(), existing.id);
      audit(req, 'update', 'driver', existing.id, { name: values.name, costCenterId: values.costCenterId });
      if (costCenterChanged) {
        audit(req, 'assign_cost_center', 'driver', existing.id, {
          costCenterId: values.costCenterId,
          previousCostCenterId: existing.cost_center_id || null
        });
      }
    })();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Buchungen
   ========================================================= */
router.post('/bookings', (req, res, next) => {
  try {
    const body = req.body || {};
    const vehicleId = requiredString(body.vehicleId, 'Fahrzeug');
    const driverId = requiredString(body.driverId, 'Fahrer:in');
    const purpose = requiredString(body.purpose, 'Einsatzzweck', { max: 200 });
    const date = requiredDate(body.date, 'Datum');
    const startTime = String(body.startTime || '');
    const endTime = String(body.endTime || '');
    const start = combineDateTime(date, startTime, 'Start');
    const end = combineDateTime(date, endTime, 'Ende');
    if (end <= start) throw new HttpError(400, 'Das Ende der Buchung muss nach dem Beginn liegen.');
    assertCan(req, 'bookings_create', { vehicle: { id: vehicleId }, driver: { id: driverId } });
    const vehicle = ensureVehicleExists(vehicleId);
    const driver = ensureDriverExists(driverId);
    if (vehicle.blocked) throw new HttpError(409, vehicleBlockedMessage(vehicle));
    if (vehicle.status === 'maintenance') throw new HttpError(409, `${vehicle.name} befindet sich in Wartung.`);
    if (driver.status === 'away') throw new HttpError(409, `${driver.name} ist aktuell abwesend.`);
    assertBookingConflict(vehicle.id, driver.id, start, end, vehicle.name, driver.name);
    const costCenterId = resolveBookingCostCenterFromPayload(req, body, { driver, vehicle, user: req.user });

    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, notes, cost_center_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
    `).run(id, vehicle.id, driver.id, purpose, start, end, optionalString(body.notes, { max: 1000 }), costCenterId, req.user.id, now, now);
    audit(req, 'create', 'booking', id, { purpose, vehicleId, driverId, start, end, costCenterId });
    sendState(req, res, 201, { leasingWarning: leasingWarningForVehicle(vehicle) });
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:id/start', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
      if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
      if (booking.status !== 'planned') throw new HttpError(409, 'Nur geplante Fahrten können gestartet werden.');
      assertBookingAction(req, booking, { id: booking.vehicle_id }, { id: booking.driver_id });
      const vehicle = ensureVehicleExists(booking.vehicle_id);
      const driver = getDriver(booking.driver_id);
      if (vehicle.status === 'maintenance') throw new HttpError(409, `${vehicle.name} befindet sich in Wartung.`);
      const activeVehicle = db.prepare("SELECT id FROM bookings WHERE vehicle_id = ? AND status = 'active' AND id <> ? LIMIT 1").get(vehicle.id, booking.id);
      if (activeVehicle) throw new HttpError(409, 'Für dieses Fahrzeug läuft bereits eine andere Fahrt.');
      const activeDriver = db.prepare("SELECT id FROM bookings WHERE driver_id = ? AND status = 'active' AND id <> ? LIMIT 1").get(booking.driver_id, booking.id);
      if (activeDriver) throw new HttpError(409, 'Diese Fahrer:in ist bereits in einer anderen Fahrt.');
      const now = isoNow();
      const startKm = booking.start_km ?? vehicle.mileage;
      db.prepare("UPDATE bookings SET status = 'active', start_km = ?, updated_at = ? WHERE id = ?").run(startKm, now, booking.id);
      db.prepare("UPDATE vehicles SET status = 'in_use', updated_at = ? WHERE id = ?").run(now, vehicle.id);
      audit(req, 'start', 'booking', booking.id, { startKm });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:id/end', (req, res, next) => {
  try {
    const endKm = intValue(req.body?.endKm, 'Endkilometerstand', { min: 0, max: 10_000_000, required: true });
    const transaction = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
      if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
      if (booking.status !== 'active') throw new HttpError(409, 'Nur aktive Fahrten können beendet werden.');
      assertBookingAction(req, booking, { id: booking.vehicle_id }, { id: booking.driver_id });
      const vehicle = ensureVehicleExists(booking.vehicle_id);
      const driver = getDriver(booking.driver_id);
      const startKm = booking.start_km ?? vehicle.mileage;
      if (endKm < startKm) throw new HttpError(400, 'Der Endkilometerstand darf nicht kleiner als der Startkilometerstand sein.');
      const now = isoNow();
      db.prepare(`
        UPDATE bookings SET status = 'completed', start_km = ?, end_km = ?, completed_at = ?, updated_at = ? WHERE id = ?
      `).run(startKm, endKm, todayISO(), now, booking.id);
      const newMileage = Math.max(vehicle.mileage, endKm);
      const otherActive = db.prepare("SELECT 1 FROM bookings WHERE vehicle_id = ? AND status = 'active' AND id <> ? LIMIT 1").get(vehicle.id, booking.id);
      const nextStatus = vehicle.status === 'maintenance' ? 'maintenance' : otherActive ? 'in_use' : 'available';
      db.prepare('UPDATE vehicles SET mileage = ?, status = ?, updated_at = ? WHERE id = ?').run(newMileage, nextStatus, now, vehicle.id);
      audit(req, 'complete', 'booking', booking.id, { startKm, endKm, distance: endKm - startKm });
    });
    transaction();
    const completedBooking = db.prepare('SELECT vehicle_id FROM bookings WHERE id = ?').get(req.params.id);
    const updatedVehicle = completedBooking ? getVehicle(completedBooking.vehicle_id) : null;
    triggerLeasingCheck(db, { dataDir: DATA_DIR });
    sendState(req, res, 200, { leasingWarning: updatedVehicle ? leasingWarningForVehicle(updatedVehicle) : null });
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:id/cancel', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
      if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
      if (!['planned', 'active'].includes(booking.status)) throw new HttpError(409, 'Diese Buchung kann nicht storniert werden.');
      assertCan(req, 'bookings_manage', {
        booking,
        vehicle: { id: booking.vehicle_id },
        driver: { id: booking.driver_id }
      });
      const vehicle = ensureVehicleExists(booking.vehicle_id);
      const driver = getDriver(booking.driver_id);
      const now = isoNow();
      db.prepare("UPDATE bookings SET status = 'canceled', updated_at = ? WHERE id = ?").run(now, booking.id);
      if (booking.status === 'active') syncVehicleStatus(booking.vehicle_id);
      audit(req, 'cancel', 'booking', booking.id, { purpose: booking.purpose });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.delete('/bookings/:id', (req, res, next) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
    if (booking.status !== 'canceled') throw new HttpError(409, 'Nur stornierte Buchungen können gelöscht werden.');
    assertCan(req, 'bookings_manage', {
      booking,
      vehicle: { id: booking.vehicle_id },
      driver: { id: booking.driver_id }
    });
    const vehicle = ensureVehicleExists(booking.vehicle_id);
    const driver = getDriver(booking.driver_id);
    db.prepare('DELETE FROM bookings WHERE id = ?').run(booking.id);
    audit(req, 'delete', 'booking', booking.id, { purpose: booking.purpose });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Eigene Fahrten & Buchungsanfragen
   ========================================================= */
router.post('/booking-requests', (req, res, next) => {
  try {
    const body = req.body || {};
    const linkedDriver = getLinkedDriver(req.user.id);
    if (!linkedDriver) {
      throw new HttpError(403, 'Für Buchungsanfragen ist kein Fahrerprofil mit Ihrem Konto verknüpft.');
    }
    const vehicleId = requiredString(body.vehicleId, 'Fahrzeug');
    if (isObjectPermissionDenied(req.auth, 'vehicle', vehicleId, 'vehicles_view')) {
      throw new HttpError(403, 'Für dieses Fahrzeug fehlt die erforderliche Sichtberechtigung.');
    }
    assertCan(req, 'own_trips_request', { driver: linkedDriver, vehicle: { id: vehicleId } });
    const vehicle = ensureVehicleExists(vehicleId);
    if (vehicle.blocked) throw new HttpError(409, vehicleBlockedMessage(vehicle));
    const purpose = requiredString(body.purpose, 'Einsatzzweck', { max: 200 });
    const date = requiredDate(body.date, 'Datum');
    const start = combineDateTime(date, String(body.startTime || ''), 'Start');
    const end = combineDateTime(date, String(body.endTime || ''), 'Ende');
    if (end <= start) throw new HttpError(400, 'Das Ende der Buchungsanfrage muss nach dem Beginn liegen.');
    const conflict = getBookingConflict(vehicle.id, linkedDriver.id, start, end, vehicle.name, linkedDriver.name);
    const costCenterId = resolveBookingCostCenterFromPayload(req, body, { driver: linkedDriver, vehicle, user: req.user });
    const id = crypto.randomUUID();
    const now = isoNow();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO booking_requests
          (id, vehicle_id, driver_id, requested_by, purpose, start_at, end_at, notes, cost_center_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
      `).run(
        id, vehicle.id, linkedDriver.id, req.user.id, purpose, start, end,
        optionalString(body.notes, { max: 1000 }), costCenterId, now, now
      );
      audit(req, 'create', 'booking_request', id, {
        vehicleId: vehicle.id,
        driverId: linkedDriver.id,
        purpose,
        start,
        end,
        costCenterId,
        conflictWarning: conflict.hasConflict
      });
    })();
    const state = getState(db, req.user, req.auth);
    res.status(201).json({
      ...state,
      requestWarning: conflict.hasConflict ? conflict.message : null,
      leasingWarning: leasingWarningForVehicle(vehicle)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/booking-requests/:id/approve', requirePermission('booking_requests_manage'), (req, res, next) => {
  try {
    const decisionNote = optionalString(req.body?.decisionNote, { max: 500 });
    let bookingId = null;
    const transaction = db.transaction(() => {
      const request = db.prepare('SELECT * FROM booking_requests WHERE id = ?').get(req.params.id);
      if (!request) throw new HttpError(404, 'Buchungsanfrage wurde nicht gefunden.');
      const requester = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(request.requested_by);
      if (!isRequestVisibleToApprover(db, req.user, request, requester, { isAdmin: req.user.role === 'admin' })) {
        throw new HttpError(403, 'Diese Buchungsanfrage darf nicht von Ihnen entschieden werden.');
      }
      if (request.status !== 'requested') {
        throw new HttpError(409, 'Diese Buchungsanfrage wurde bereits entschieden.');
      }
      const vehicle = ensureVehicleExists(request.vehicle_id);
      const driver = ensureDriverExists(request.driver_id);
      if (vehicle.blocked) throw new HttpError(409, vehicleBlockedMessage(vehicle));
      if (vehicle.status === 'maintenance') throw new HttpError(409, `${vehicle.name} befindet sich in Wartung.`);
      if (driver.status === 'away') throw new HttpError(409, `${driver.name} ist aktuell abwesend.`);
      assertBookingConflict(vehicle.id, driver.id, request.start_at, request.end_at, vehicle.name, driver.name);
      bookingId = crypto.randomUUID();
      const now = isoNow();
      db.prepare(`
        INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, notes, cost_center_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?)
      `).run(
        bookingId, vehicle.id, driver.id, request.purpose, request.start_at, request.end_at,
        request.notes || '', request.cost_center_id || null, req.user.id, now, now
      );
      const changed = db.prepare(`
        UPDATE booking_requests
        SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, booking_id = ?, updated_at = ?
        WHERE id = ? AND status = 'requested'
      `).run(req.user.id, now, decisionNote, bookingId, now, request.id).changes;
      if (changed !== 1) throw new HttpError(409, 'Diese Buchungsanfrage wurde bereits entschieden.');
      audit(req, 'create', 'booking', bookingId, {
        purpose: request.purpose,
        vehicleId: vehicle.id,
        driverId: driver.id,
        start: request.start_at,
        end: request.end_at,
        costCenterId: request.cost_center_id || null,
        requestId: request.id
      });
      audit(req, 'approve', 'booking_request', request.id, {
        bookingId,
        vehicleId: vehicle.id,
        driverId: driver.id,
        start: request.start_at,
        end: request.end_at
      });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/booking-requests/:id/reject', requirePermission('booking_requests_manage'), (req, res, next) => {
  try {
    const decisionNote = optionalString(req.body?.decisionNote, { max: 500 });
    const transaction = db.transaction(() => {
      const request = db.prepare('SELECT * FROM booking_requests WHERE id = ?').get(req.params.id);
      if (!request) throw new HttpError(404, 'Buchungsanfrage wurde nicht gefunden.');
      const requester = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(request.requested_by);
      if (!isRequestVisibleToApprover(db, req.user, request, requester, { isAdmin: req.user.role === 'admin' })) {
        throw new HttpError(403, 'Diese Buchungsanfrage darf nicht von Ihnen entschieden werden.');
      }
      if (request.status !== 'requested') {
        throw new HttpError(409, 'Diese Buchungsanfrage wurde bereits entschieden.');
      }
      const now = isoNow();
      const changed = db.prepare(`
        UPDATE booking_requests
        SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?
        WHERE id = ? AND status = 'requested'
      `).run(req.user.id, now, decisionNote, now, request.id).changes;
      if (changed !== 1) throw new HttpError(409, 'Diese Buchungsanfrage wurde bereits entschieden.');
      audit(req, 'reject', 'booking_request', request.id, {
        vehicleId: request.vehicle_id,
        driverId: request.driver_id,
        start: request.start_at,
        end: request.end_at,
        decisionNote
      });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/booking-requests/:id/cancel', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const request = db.prepare('SELECT * FROM booking_requests WHERE id = ?').get(req.params.id);
      if (!request) throw new HttpError(404, 'Buchungsanfrage wurde nicht gefunden.');
      if (request.requested_by !== req.user.id) {
        throw new HttpError(403, 'Nur die anfragende Person kann diese Buchungsanfrage zurückziehen.');
      }
      if (request.status !== 'requested') {
        throw new HttpError(409, 'Nur offene Buchungsanfragen können zurückgezogen werden.');
      }
      const now = isoNow();
      db.prepare(`
        UPDATE booking_requests
        SET status = 'canceled', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ?
        WHERE id = ? AND status = 'requested'
      `).run(req.user.id, now, 'Vom Antragsteller zurückgezogen.', now, request.id);
      audit(req, 'cancel', 'booking_request', request.id, {
        vehicleId: request.vehicle_id,
        driverId: request.driver_id,
        start: request.start_at,
        end: request.end_at,
        reason: 'requester_canceled'
      });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/trips', (req, res, next) => {
  try {
    const body = req.body || {};
    const vehicleId = requiredString(body.vehicleId, 'Fahrzeug');
    const driverId = requiredString(body.driverId, 'Fahrer:in');
    assertCan(req, 'logbook_manage', { vehicle: { id: vehicleId }, driver: { id: driverId } });
    const vehicle = ensureVehicleExists(vehicleId);
    const driver = ensureDriverExists(driverId);
    const date = requiredDate(body.date, 'Datum');
    const start = combineDateTime(date, String(body.startTime || ''), 'Start');
    const end = combineDateTime(date, String(body.endTime || ''), 'Ende');
    if (end <= start) throw new HttpError(400, 'Die Ankunftszeit muss nach der Abfahrtszeit liegen.');
    const startKm = intValue(body.startKm, 'Startkilometerstand', { min: 0, max: 10_000_000, required: true });
    const endKm = intValue(body.endKm, 'Endkilometerstand', { min: 0, max: 10_000_000, required: true });
    if (endKm < startKm) throw new HttpError(400, 'Der Endkilometerstand muss größer oder gleich dem Startkilometerstand sein.');
    const costCenterId = resolveBookingCostCenterFromPayload(req, body, { driver, vehicle, user: req.user });

    const transaction = db.transaction(() => {
      const id = crypto.randomUUID();
      const now = isoNow();
      db.prepare(`
        INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, start_km, end_km, notes, cost_center_id, created_by, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, vehicle.id, driver.id, requiredString(body.purpose, 'Zweck der Fahrt', { max: 200 }), start, end, startKm, endKm, optionalString(body.notes, { max: 1000 }), costCenterId, req.user.id, date, now, now);
      if (endKm > vehicle.mileage) {
        db.prepare('UPDATE vehicles SET mileage = ?, updated_at = ? WHERE id = ?').run(endKm, now, vehicle.id);
      }
      audit(req, 'create', 'trip', id, { vehicleId: vehicle.id, driverId: driver.id, startKm, endKm, costCenterId });
    });
    transaction();
    triggerLeasingCheck(db, { dataDir: DATA_DIR });
    const updatedVehicle = getVehicle(vehicle.id);
    sendState(req, res, 201, { leasingWarning: updatedVehicle ? leasingWarningForVehicle(updatedVehicle) : null });
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Wartung
   ========================================================= */
router.post('/maintenance', (req, res, next) => {
  try {
    const body = req.body || {};
    const vehicleId = requiredString(body.vehicleId, 'Fahrzeug');
    assertCan(req, 'maintenance_manage', { vehicle: { id: vehicleId } });
    const vehicle = ensureVehicleExists(vehicleId);
    const title = requiredString(body.title, 'Ma?nahme', { max: 160 });
    const dueDate = requiredDate(body.dueDate, 'Fälligkeitsdatum');
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO maintenance (id, vehicle_id, title, due_date, workshop, cost, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
    `).run(id, vehicle.id, title, dueDate, optionalString(body.workshop, { max: 160 }), numericValue(body.cost ?? 0, 'Geschätzte Kosten', { min: 0, max: 1_000_000 }), optionalString(body.notes, { max: 1000 }), now, now);
    audit(req, 'create', 'maintenance', id, { vehicleId: vehicle.id, title });
    sendState(req, res, 201);
  } catch (error) {
    next(error);
  }
});

router.post('/maintenance/:id/done', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const item = db.prepare('SELECT * FROM maintenance WHERE id = ?').get(req.params.id);
      if (!item) throw new HttpError(404, 'Wartung wurde nicht gefunden.');
      if (item.completed_at || item.status === 'done') throw new HttpError(409, 'Diese Wartung ist bereits erledigt.');
      assertCan(req, 'maintenance_manage', { maintenance: item, vehicle: { id: item.vehicle_id } });
      const vehicle = ensureVehicleExists(item.vehicle_id);
      const now = isoNow();
      db.prepare("UPDATE maintenance SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(todayISO(), now, item.id);
      let costId = null;
      if (Number(item.cost) > 0) {
        costId = crypto.randomUUID();
        const costCenterId = resolveCostCostCenter(db, { explicit: false, vehicle, user: req.user });
        db.prepare(`
          INSERT INTO costs (id, vehicle_id, date, category, amount, note, cost_center_id, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'Wartung', ?, ?, ?, ?, ?, ?)
        `).run(costId, vehicle.id, todayISO(), Number(item.cost), `${item.title}${item.workshop ? ` · ${item.workshop}` : ''}`, costCenterId, req.user.id, now, now);
      }
      if (vehicle.status === 'maintenance') {
        const stillOpen = db.prepare('SELECT 1 FROM maintenance WHERE vehicle_id = ? AND completed_at IS NULL AND id <> ? LIMIT 1').get(vehicle.id, item.id);
        if (!stillOpen) syncVehicleStatus(vehicle.id);
      }
      audit(req, 'complete', 'maintenance', item.id, { title: item.title, costId });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Kosten & Belege
   ========================================================= */
router.post('/costs', async (req, res, next) => {
  let receipt = null;
  try {
    const body = req.body || {};
    const vehicleId = requiredString(body.vehicleId, 'Fahrzeug');
    assertCan(req, 'costs_manage', { vehicle: { id: vehicleId } });
    const vehicle = ensureVehicleExists(vehicleId);
    const date = requiredDate(body.date, 'Datum');
    const category = oneOf(body.category, COST_CATEGORIES, 'Kostenart');
    const amount = numericValue(body.amount, 'Betrag', { min: 0.01, max: 10_000_000 });
    const note = optionalString(body.note, { max: 300 });
    const costCenterId = resolveCostCostCenterFromPayload(req, body, { vehicle, user: req.user });
    if (body.receipt) receipt = await storeReceipt(body.receipt);
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO costs
        (id, vehicle_id, date, category, amount, note, cost_center_id, receipt_file, receipt_name, receipt_mime, receipt_size, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, vehicle.id, date, category, amount, note, costCenterId,
      receipt?.file || null, receipt?.name || null, receipt?.mime || null, receipt?.size || null,
      req.user.id, now, now
    );
    audit(req, 'create', 'cost', id, { vehicleId: vehicle.id, category, amount, costCenterId });
    sendState(req, res, 201);
  } catch (error) {
    if (receipt?.file) deleteUpload(receipt.file);
    next(error);
  }
});

router.delete('/costs/:id', (req, res, next) => {
  try {
    const cost = getCost(req.params.id);
    if (!cost) throw new HttpError(404, 'Kostenposition wurde nicht gefunden.');
    const vehicle = getVehicle(cost.vehicle_id);
    assertCan(req, 'costs_manage', { cost, vehicle });
    db.prepare('DELETE FROM costs WHERE id = ?').run(cost.id);
    if (cost.receipt_file) deleteUpload(cost.receipt_file);
    audit(req, 'delete', 'cost', cost.id, { category: cost.category, amount: cost.amount });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.get('/costs/:id/receipt', (req, res, next) => {
  try {
    const cost = getCost(req.params.id);
    if (!cost || !cost.receipt_file) throw new HttpError(404, 'Für diese Kostenposition ist kein Beleg hinterlegt.');
    const vehicle = getVehicle(cost.vehicle_id);
    assertCan(req, 'costs_view', { cost, vehicle });
    const fullPath = uploadPath(cost.receipt_file);
    if (!fullPath) throw new HttpError(404, 'Der Beleg wurde nicht gefunden.');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(cost.receipt_name || 'beleg')}`);
    res.type(cost.receipt_mime || 'application/octet-stream');
    res.sendFile(fullPath);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Einstellungen
   ========================================================= */
router.patch('/settings', requirePermission('settings_manage'), (req, res, next) => {
  try {
    const body = req.body || {};
    const orgName = requiredString(body.orgName, 'Name der Einrichtung', { max: 160 });
    const current = db.prepare('SELECT default_color_mode FROM settings WHERE id = 1').get();
    const defaultColorMode = body.defaultColorMode === undefined
      ? (current?.default_color_mode || 'light')
      : oneOf(body.defaultColorMode, COLOR_MODES, 'Standard-Farbschema');
    db.prepare(`
      UPDATE settings
      SET org_name = ?, location = ?, email = ?, phone = ?, default_color_mode = ?, updated_at = ?
      WHERE id = 1
    `).run(
      orgName,
      optionalString(body.location, { max: 160 }),
      optionalString(body.email, { max: 200 }),
      optionalString(body.phone, { max: 80 }),
      defaultColorMode,
      isoNow()
    );
    audit(req, 'update', 'settings', '1', { orgName, defaultColorMode });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.patch('/smtp', requireAdmin, (req, res, next) => {
  try {
    const previous = loadSmtpConfig(db, { dataDir: DATA_DIR });
    let config;
    try {
      config = saveSmtpConfig(db, req.body || {}, { dataDir: DATA_DIR });
    } catch (error) {
      const httpError = new HttpError(400, error.message);
      httpError.details = error.details || null;
      throw httpError;
    }
    audit(req, 'update', 'smtp', '1', {
      enabled: config.enabled,
      secure: config.secure,
      hostChanged: previous.host !== config.host,
      fromAddressChanged: previous.fromAddress !== config.fromAddress,
      usernameChanged: previous.username !== config.username,
      passwordChanged: Boolean(req.body?.password),
      passwordCleared: req.body?.clearPassword === true
    });
    if (config.enabled) triggerLeasingCheck(db, { dataDir: DATA_DIR });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/smtp/test', requireAdmin, async (req, res, next) => {
  try {
    const config = loadSmtpConfig(db, { dataDir: DATA_DIR });
    const organization = db.prepare('SELECT org_name FROM settings WHERE id = 1').get()?.org_name || 'Fuhrpark';
    try {
      await sendMail({
        config,
        to: req.user.email,
        subject: `[${organization}] SMTP-Test`,
        text: 'Diese Testnachricht bestätigt den SMTP-Versand aus dem AWO Fuhrparkmanagement.'
      });
    } catch (error) {
      const code = sanitizeSmtpError(error);
      audit(req, 'smtp_test', 'smtp', '1', { ok: false, errorCode: code });
      throw new HttpError(400, smtpErrorMessage(code, error, {
        hasCredentials: Boolean(config.username && config.password)
      }));
    }
    audit(req, 'smtp_test', 'smtp', '1', { ok: true });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.patch('/branding', requirePermission('branding_manage'), async (req, res, next) => {
  let newLogoFile = null;
  try {
    const theme = oneOf(req.body?.theme, ['awo', 'neutral'], 'Erscheinungsbild');
    const current = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    if (!current) throw new HttpError(404, 'Einstellungen wurden nicht gefunden.');
    let brandName = current.brand_name || current.org_name || '';
    if (theme === 'neutral') {
      brandName = requiredString(req.body?.brandName ?? brandName, 'Anzeigename', { max: 120 });
    } else if (req.body?.brandName !== undefined) {
      brandName = optionalString(req.body.brandName, { max: 120 });
    }
    const accentColor = hexColorValue(req.body?.accentColor ?? current.accent_color, '#0f766e');
    const sidebarStyle = oneOf(req.body?.sidebarStyle ?? current.sidebar_style ?? 'dark', ['dark', 'light'], 'Sidebar-Stil');
    const pageBackground = hexColorValue(req.body?.pageBackground ?? current.page_background, '#f4f5f7');
    const surfaceColor = hexColorValue(req.body?.surfaceColor ?? current.surface_color, '#ffffff');
    const textColor = hexColorValue(req.body?.textColor ?? current.text_color, '#191c23');
    const mutedColor = hexColorValue(req.body?.mutedColor ?? current.muted_color, '#737a88');
    const borderColor = hexColorValue(req.body?.borderColor ?? current.border_color, '#e7e9ee');
    if (req.body?.logoData) newLogoFile = await storeBrandingLogo(req.body.logoData);
    const removeLogo = booleanValue(req.body?.removeLogo, false);
    const logoFile = newLogoFile || (removeLogo ? null : current.logo_file);
    const now = isoNow();
    db.prepare(`
      UPDATE settings SET theme = ?, brand_name = ?, logo_file = ?, accent_color = ?, sidebar_style = ?,
        page_background = ?, surface_color = ?, text_color = ?, muted_color = ?, border_color = ?, updated_at = ?
      WHERE id = 1
    `).run(
      theme, brandName, logoFile, accentColor, sidebarStyle,
      pageBackground, surfaceColor, textColor, mutedColor, borderColor, now
    );
    if (current.logo_file && current.logo_file !== logoFile) deleteUpload(current.logo_file);
    audit(req, 'update', 'branding', '1', {
      theme, brandName, accentColor, sidebarStyle,
      colors: { pageBackground, surfaceColor, textColor, mutedColor, borderColor },
      logoChanged: Boolean(newLogoFile),
      logoRemoved: removeLogo
    });
    sendState(req, res);
  } catch (error) {
    if (newLogoFile) deleteUpload(newLogoFile);
    next(error);
  }
});

/* =========================================================
   Rollen und Rechte (delegierbar, Rang- und Grant-Ceiling-gebunden)
   ========================================================= */
router.post('/roles', requirePermission('roles_manage'), (req, res, next) => {
  try {
    const name = requiredString(req.body?.name, 'Rollenname', { max: 120 });
    const permissions = normalizePermissions(req.body?.permissions);
    const rank = rankBelowActor(req, req.body?.rank ?? defaultRoleRank(req));
    assertGrantCeiling(req, permissions);
    const bookingRequestPolicy = normalizeBookingRequestPolicy(db, req.body?.bookingRequestPolicy, { actorRank: actorRank(req) });
    const duplicate = db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE').get(name);
    if (duplicate) throw new HttpError(409, 'Eine Rolle mit diesem Namen existiert bereits.');
    const id = `role-${crypto.randomUUID()}`;
    const now = isoNow();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO roles (id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at)
        VALUES (?, ?, ?, '{}', ?, 0, ?, ?, ?)
      `).run(id, name, JSON.stringify(permissions), JSON.stringify(bookingRequestPolicy), rank, now, now);
      audit(req, 'create', 'role', id, { name, permissions, rank, bookingRequestPolicy });
    })();
    sendState(req, res, 201);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Eine Rolle mit diesem Namen existiert bereits.'));
    next(error);
  }
});

router.patch('/roles/:id', requirePermission('roles_manage'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Rolle wurde nicht gefunden.');
    assertRoleManageable(req, existing);
    const name = requiredString(req.body?.name, 'Rollenname', { max: 120 });
    const permissionsProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'permissions');
    const permissions = permissionsProvided ? normalizePermissions(req.body.permissions) : null;
    const rank = req.body?.rank === undefined
      ? Number(existing.rank) || 0
      : rankBelowActor(req, req.body.rank);
    assertGrantCeiling(req, permissionsProvided ? permissions : parsePermissions(existing.permissions));
    const policyProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'bookingRequestPolicy');
    const bookingRequestPolicy = policyProvided
      ? normalizeBookingRequestPolicy(db, req.body.bookingRequestPolicy, { actorRank: actorRank(req) })
      : null;
    const duplicate = db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, existing.id);
    if (duplicate) throw new HttpError(409, 'Eine Rolle mit diesem Namen existiert bereits.');
    db.transaction(() => {
      db.prepare(`
        UPDATE roles SET name = ?, permissions = COALESCE(?, permissions), rank = ?,
          booking_request_policy = COALESCE(?, booking_request_policy), updated_at = ?
        WHERE id = ?
      `).run(name, permissionsProvided ? JSON.stringify(permissions) : null, rank, bookingRequestPolicy ? JSON.stringify(bookingRequestPolicy) : null, isoNow(), existing.id);
      audit(req, 'update', 'role', existing.id, {
        name,
        ...(permissionsProvided ? { permissions } : {}),
        rank,
        ...(policyProvided ? { bookingRequestPolicy } : {})
      });
    })();
    sendState(req, res);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Eine Rolle mit diesem Namen existiert bereits.'));
    next(error);
  }
});

router.patch('/roles/:id/object-permissions', requirePermission('roles_manage'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Rolle wurde nicht gefunden.');
    assertRoleManageable(req, existing);
    const objectPermissions = normalizeObjectPermissions(db, req.body?.objectPermissions);
    assertGrantCeiling(req, [], objectPermissions);
    db.transaction(() => {
      db.prepare('UPDATE roles SET object_permissions = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(objectPermissions), isoNow(), existing.id);
      audit(req, 'update', 'role_object_permissions', existing.id, { objectPermissions });
    })();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.delete('/roles/:id', requirePermission('roles_manage'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Rolle wurde nicht gefunden.');
    assertRoleManageable(req, existing);
    if (existing.is_system) throw new HttpError(409, 'Systemrollen können nicht gelöscht werden.');
    db.transaction(() => {
      const assigned = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ?').get(existing.id).count;
      if (assigned > 0) throw new HttpError(409, 'Diese Rolle ist noch Benutzern zugewiesen und kann nicht gelöscht werden.');
      db.prepare('DELETE FROM roles WHERE id = ?').run(existing.id);
      audit(req, 'delete', 'role', existing.id, { name: existing.name, rank: existing.rank });
    })();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Benutzer (delegierbar, Rang- und Grant-Ceiling-gebunden)
   ========================================================= */
function passwordValue(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(400, 'Das Passwort muss mindestens 10 Zeichen lang sein.');
  }
  return password;
}

router.post('/users', requirePermission('users_manage'), (req, res, next) => {
  try {
    const body = req.body || {};
    const email = emailValue(body.email, 'E-Mail');
    const name = requiredString(body.name, 'Name', { max: 120 });
    const role = assertRoleGrantable(req, requiredString(body.role, 'Rolle', { max: 120 })).id;
    const password = passwordValue(body.password);
    const driverId = body.driverId ? requiredString(body.driverId, 'Fahrer:in', { max: 120 }) : null;
    const ownTripsAccess = booleanValue(body.ownTripsAccess, true) ? 1 : 0;
    const costCenterId = costCenterIdForPayload(req, body, null);
    if (driverId) {
      const driver = getDriver(driverId);
      if (!driver) throw new HttpError(400, 'Die ausgewählte Fahrer:in existiert nicht.');
      if (driver.user_id) throw new HttpError(409, 'Diese Fahrer:in ist bereits mit einem Benutzerkonto verknüpft.');
    }
    const duplicate = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (duplicate) throw new HttpError(409, 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    const id = crypto.randomUUID();
    const now = isoNow();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, email, name, password_hash, role, active, cost_center_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, email, name, bcrypt.hashSync(password, 12), role, 1, costCenterId, now, now);
      if (driverId) {
        db.prepare('UPDATE drivers SET user_id = ?, own_trips_access = ?, updated_at = ? WHERE id = ?')
          .run(id, ownTripsAccess, now, driverId);
      }
      audit(req, 'create', 'user', id, {
        email,
        role,
        roleRank: getRoleRank(db, role),
        driverId,
        ownTripsAccess: driverId ? ownTripsAccess : null,
        costCenterId
      });
      if (driverId) audit(req, 'link_driver', 'user', id, { driverId, ownTripsAccess });
    })();
    sendState(req, res, 201);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (String(error.message).includes('drivers.user_id')) return next(new HttpError(409, 'Diese Fahrer:in ist bereits mit einem Benutzerkonto verknüpft.'));
      return next(new HttpError(409, 'Diese E-Mail-Adresse ist bereits vergeben.'));
    }
    next(error);
  }
});

router.patch('/users/:id', requirePermission('users_manage'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Benutzerkonto wurde nicht gefunden.');
    if (existing.anonymized_at) throw new HttpError(409, 'Anonymisierte Konten können nicht mehr bearbeitet werden.');
    assertUserManageable(req, existing);
    const body = req.body || {};
    const email = emailValue(body.email, 'E-Mail');
    const name = requiredString(body.name, 'Name', { max: 120 });
    const role = assertRoleGrantable(req, requiredString(body.role, 'Rolle', { max: 120 })).id;
    const active = booleanValue(body.active, Boolean(existing.active));
    assertLastActiveAdminChange(existing, role, active);
    const duplicate = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?').get(email, existing.id);
    if (duplicate) throw new HttpError(409, 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    const password = body.password ? passwordValue(body.password) : null;
    const costCenterId = costCenterIdForPayload(req, body, existing.cost_center_id);
    const costCenterChanged = (existing.cost_center_id || null) !== (costCenterId || null);

    const currentDriver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(existing.id) || null;
    let nextDriverId = currentDriver?.id || null;
    if (Object.prototype.hasOwnProperty.call(body, 'driverId')) {
      nextDriverId = body.driverId ? requiredString(body.driverId, 'Fahrer:in', { max: 120 }) : null;
    }
    let nextOwnTripsAccess = currentDriver ? Number(currentDriver.own_trips_access) : 1;
    if (Object.prototype.hasOwnProperty.call(body, 'ownTripsAccess')) {
      nextOwnTripsAccess = booleanValue(body.ownTripsAccess, true) ? 1 : 0;
    }
    if (nextDriverId) {
      const driver = getDriver(nextDriverId);
      if (!driver) throw new HttpError(400, 'Die ausgewählte Fahrer:in existiert nicht.');
      if (driver.user_id && driver.user_id !== existing.id) {
        throw new HttpError(409, 'Diese Fahrer:in ist bereits mit einem Benutzerkonto verknüpft.');
      }
    }

    const now = isoNow();
    let deactivatedAt = existing.deactivated_at;
    if (active) deactivatedAt = null;
    else if (existing.active || !deactivatedAt) deactivatedAt = now;
    db.transaction(() => {
      if (password) {
        db.prepare(`
          UPDATE users SET email = ?, name = ?, role = ?, active = ?, deactivated_at = ?, password_hash = ?, cost_center_id = ?, updated_at = ? WHERE id = ?
        `).run(email, name, role, active ? 1 : 0, deactivatedAt, bcrypt.hashSync(password, 12), costCenterId, now, existing.id);
      } else {
        db.prepare(`
          UPDATE users SET email = ?, name = ?, role = ?, active = ?, deactivated_at = ?, cost_center_id = ?, updated_at = ? WHERE id = ?
        `).run(email, name, role, active ? 1 : 0, deactivatedAt, costCenterId, now, existing.id);
      }
      if (role === 'admin') {
        db.prepare("UPDATE users SET permission_overrides = '{}', object_permissions = '{}' WHERE id = ?").run(existing.id);
      }
      const linkChanged = (currentDriver?.id || null) !== nextDriverId;
      if (linkChanged) {
        if (currentDriver && currentDriver.id !== nextDriverId) {
          db.prepare('UPDATE drivers SET user_id = NULL, updated_at = ? WHERE id = ?').run(now, currentDriver.id);
        }
        if (nextDriverId) {
          db.prepare('UPDATE drivers SET user_id = ?, own_trips_access = ?, updated_at = ? WHERE id = ?')
            .run(existing.id, nextOwnTripsAccess, now, nextDriverId);
        }
      } else if (currentDriver && nextDriverId && Number(currentDriver.own_trips_access) !== nextOwnTripsAccess) {
        db.prepare('UPDATE drivers SET own_trips_access = ?, updated_at = ? WHERE id = ?')
          .run(nextOwnTripsAccess, now, currentDriver.id);
      }
      if (!active) {
        cancelOpenBookingRequests(db, existing.id, { actorId: req.user.id, reason: 'requester_deactivated' });
      }
      if (password || !active) {
        db.prepare("DELETE FROM sessions WHERE sid <> ? AND json_extract(sess, '$.userId') = ?").run(req.sessionID, existing.id);
      }
      audit(req, 'update', 'user', existing.id, {
        email,
        role,
        roleRank: getRoleRank(db, role),
        active,
        passwordChanged: Boolean(password),
        driverId: nextDriverId,
        ownTripsAccess: nextDriverId ? nextOwnTripsAccess : null,
        costCenterId
      });
      if (costCenterChanged) {
        audit(req, 'assign_cost_center', 'user', existing.id, {
          costCenterId,
          previousCostCenterId: existing.cost_center_id || null
        });
      }
      if (linkChanged) {
        audit(req, nextDriverId ? 'link_driver' : 'unlink_driver', 'user', existing.id, {
          driverId: nextDriverId || currentDriver?.id || null,
          ownTripsAccess: nextDriverId ? nextOwnTripsAccess : null
        });
      }
    })();
    sendState(req, res);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (String(error.message).includes('drivers.user_id')) return next(new HttpError(409, 'Diese Fahrer:in ist bereits mit einem Benutzerkonto verknüpft.'));
      return next(new HttpError(409, 'Diese E-Mail-Adresse ist bereits vergeben.'));
    }
    next(error);
  }
});

router.patch('/users/:id/permissions', requirePermission('users_manage'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Benutzerkonto wurde nicht gefunden.');
    if (existing.anonymized_at) throw new HttpError(409, 'Anonymisierte Konten können nicht mehr bearbeitet werden.');
    assertUserManageable(req, existing);
    if (existing.role === 'admin') throw new HttpError(409, 'Die Administrator-Rolle hat immer vollständigen Zugriff.');
    const permissionOverrides = normalizePermissionOverrides(req.body?.permissionOverrides);
    const objectPermissions = normalizeObjectPermissions(db, req.body?.objectPermissions);
    assertGrantCeiling(req, permissionOverrides.allow, objectPermissions);
    db.transaction(() => {
      db.prepare('UPDATE users SET permission_overrides = ?, object_permissions = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(permissionOverrides), JSON.stringify(objectPermissions), isoNow(), existing.id);
      audit(req, 'update', 'user_permissions', existing.id, { permissionOverrides, objectPermissions });
    })();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/anonymize', requirePermission('users_manage'), (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Benutzerkonto wurde nicht gefunden.');
    assertUserManageable(req, existing);
    anonymizeUser(req.params.id, { actorId: req.user.id, reason: 'manual' });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.patch('/user-policy', requireAdmin, (req, res, next) => {
  try {
    const days = intValue(req.body?.autoAnonymizeDays, 'Frist für automatische Anonymisierung', {
      min: 0,
      max: 3650,
      required: true
    });
    db.transaction(() => {
      db.prepare('UPDATE settings SET auto_anonymize_days = ?, updated_at = ? WHERE id = 1').run(days, isoNow());
      audit(req, 'update', 'user_policy', '1', { autoAnonymizeDays: days });
    })();
    runAutoAnonymization();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Audit-Log
   ========================================================= */
router.get('/audit', (req, res, next) => {
  try {
    const result = queryAudit(db, req, req.query);
    recordAuditRead(db, req, result);
    const { filters, ...response } = result;
    res.json(response);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

