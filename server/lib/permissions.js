'use strict';

const { HttpError } = require('./validation');

const PERMISSION_GROUPS = [
  {
    key: 'vehicles',
    label: 'Fahrzeuge',
    permissions: [
      { key: 'vehicles_view', label: 'Ansehen' },
      { key: 'vehicles_manage', label: 'Anlegen und bearbeiten' }
    ]
  },
  {
    key: 'bookings',
    label: 'Buchungen',
    permissions: [
      { key: 'bookings_view', label: 'Ansehen' },
      { key: 'bookings_create', label: 'Buchen' },
      { key: 'bookings_manage', label: 'Starten, beenden und stornieren' },
      { key: 'booking_requests_manage', label: 'Buchungsanfragen verwalten' }
    ]
  },
  {
    key: 'own_trips',
    label: 'Meine Fahrten',
    permissions: [
      { key: 'own_trips_view', label: 'Eigene Fahrten ansehen' },
      { key: 'own_trips_request', label: 'Buchung anfragen' },
      { key: 'own_trips_execute', label: 'Eigene Fahrten starten und beenden' }
    ]
  },
  {
    key: 'logbook',
    label: 'Fahrtenbuch',
    permissions: [
      { key: 'logbook_view', label: 'Ansehen' },
      { key: 'logbook_manage', label: 'Fahrten nachtragen' },
      { key: 'logbook_export', label: 'CSV exportieren' }
    ]
  },
  {
    key: 'maintenance',
    label: 'Wartung & TÜV',
    permissions: [
      { key: 'maintenance_view', label: 'Ansehen' },
      { key: 'maintenance_manage', label: 'Erfassen und erledigen' }
    ]
  },
  {
    key: 'costs',
    label: 'Kosten',
    permissions: [
      { key: 'costs_view', label: 'Ansehen' },
      { key: 'costs_manage', label: 'Erfassen und löschen' }
    ]
  },
  {
    key: 'drivers',
    label: 'Fahrer:innen',
    permissions: [
      { key: 'drivers_view', label: 'Ansehen' },
      { key: 'drivers_manage', label: 'Anlegen und bearbeiten' }
    ]
  },
  {
    key: 'administration',
    label: 'Verwaltung',
    permissions: [
      { key: 'users_manage', label: 'Benutzer verwalten' },
      { key: 'roles_manage', label: 'Rollen verwalten' },
      { key: 'settings_manage', label: 'Organisation bearbeiten' },
      { key: 'branding_manage', label: 'Erscheinungsbild verwalten' },
      { key: 'export_data', label: 'Datenexport' }
    ]
  },
  {
    key: 'audit',
    label: 'Audit-Log',
    permissions: [
      { key: 'audit_view', label: 'Eigene und niedrigere Ränge ansehen' },
      { key: 'audit_view_all', label: 'Alle Aktivitäten ansehen' }
    ]
  }
];

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key));

const IMPLICATIONS = {
  vehicles_manage: ['vehicles_view'],
  bookings_view: ['vehicles_view', 'drivers_view'],
  bookings_create: ['bookings_view'],
  bookings_manage: ['bookings_view'],
  logbook_manage: ['logbook_view', 'vehicles_view', 'drivers_view'],
  logbook_export: ['logbook_view'],
  maintenance_view: ['vehicles_view'],
  maintenance_manage: ['maintenance_view'],
  costs_view: ['vehicles_view'],
  costs_manage: ['costs_view'],
  drivers_manage: ['drivers_view'],
  own_trips_request: ['own_trips_view'],
  own_trips_execute: ['own_trips_view'],
  audit_view_all: ['audit_view']
};

const DEFAULT_MANAGER_PERMISSIONS = [
  'vehicles_view', 'vehicles_manage',
  'bookings_view', 'bookings_create', 'bookings_manage', 'booking_requests_manage',
  'logbook_view', 'logbook_manage', 'logbook_export',
  'maintenance_view', 'maintenance_manage',
  'costs_view', 'costs_manage',
  'drivers_view', 'drivers_manage',
  'users_manage', 'roles_manage',
  'settings_manage', 'export_data',
  'audit_view'
];

const ROLE_SCHEMA_VERSION = 3;
const RANK_ADMIN = 1000000;
const RANK_MANAGER = 900000;
const RANK_CUSTOM_BASE = 100000;

const OBJECT_TYPES = [
  {
    key: 'vehicle',
    label: 'Fahrzeuge',
    dataKey: 'vehicles',
    table: 'vehicles',
    permissions: [
      'vehicles_view', 'vehicles_manage',
      'bookings_view', 'bookings_create', 'bookings_manage',
      'logbook_view', 'logbook_manage',
      'maintenance_view', 'maintenance_manage',
      'costs_view', 'costs_manage'
    ]
  },
  {
    key: 'driver',
    label: 'Fahrer:innen',
    dataKey: 'drivers',
    table: 'drivers',
    permissions: [
      'drivers_view', 'drivers_manage',
      'bookings_view', 'bookings_create', 'bookings_manage',
      'logbook_view', 'logbook_manage',
      'own_trips_view', 'own_trips_request', 'own_trips_execute'
    ]
  },
  {
    key: 'booking',
    label: 'Buchungen',
    dataKey: 'bookings',
    table: 'bookings',
    permissions: ['bookings_view', 'bookings_manage', 'logbook_view', 'logbook_manage']
  },
  {
    key: 'cost',
    label: 'Kosten',
    dataKey: 'costs',
    table: 'costs',
    permissions: ['costs_view', 'costs_manage']
  },
  {
    key: 'maintenance',
    label: 'Wartung & TÜV',
    dataKey: 'maintenance',
    table: 'maintenance',
    permissions: ['maintenance_view', 'maintenance_manage']
  }
];

const OBJECT_BY_KEY = Object.fromEntries(OBJECT_TYPES.map((type) => [type.key, type]));
const OBJECT_TABLES = Object.fromEntries(OBJECT_TYPES.map((type) => [type.key, type.table]));

const OBJECT_IMPLICATIONS = {
  vehicle: {
    vehicles_manage: ['vehicles_view'],
    bookings_view: ['vehicles_view'],
    bookings_create: ['bookings_view'],
    bookings_manage: ['bookings_view'],
    logbook_manage: ['logbook_view'],
    maintenance_view: ['vehicles_view'],
    maintenance_manage: ['maintenance_view'],
    costs_view: ['vehicles_view'],
    costs_manage: ['costs_view']
  },
  driver: {
    drivers_manage: ['drivers_view'],
    bookings_view: ['drivers_view'],
    bookings_create: ['bookings_view'],
    bookings_manage: ['bookings_view'],
    logbook_manage: ['logbook_view'],
    own_trips_request: ['own_trips_view'],
    own_trips_execute: ['own_trips_view']
  },
  booking: {
    bookings_manage: ['bookings_view'],
    logbook_manage: ['logbook_view']
  },
  cost: {
    costs_manage: ['costs_view']
  },
  maintenance: {
    maintenance_manage: ['maintenance_view']
  }
};

const OBJECT_PREREQUISITES = {
  vehicle: {
    vehicles_manage: ['vehicles_view'],
    bookings_view: ['vehicles_view'],
    bookings_create: ['bookings_view'],
    bookings_manage: ['bookings_view'],
    logbook_manage: ['logbook_view'],
    maintenance_view: ['vehicles_view'],
    maintenance_manage: ['maintenance_view'],
    costs_view: ['vehicles_view'],
    costs_manage: ['costs_view']
  },
  driver: {
    drivers_manage: ['drivers_view'],
    bookings_view: ['drivers_view'],
    bookings_create: ['bookings_view'],
    bookings_manage: ['bookings_view'],
    logbook_manage: ['logbook_view'],
    own_trips_request: ['own_trips_view'],
    own_trips_execute: ['own_trips_view']
  },
  booking: {
    bookings_manage: ['bookings_view'],
    logbook_manage: ['logbook_view']
  },
  cost: {
    costs_manage: ['costs_view']
  },
  maintenance: {
    maintenance_manage: ['maintenance_view']
  }
};

function normalizePermissions(input) {
  const provided = new Set(Array.isArray(input) ? input.filter((key) => ALL_PERMISSIONS.includes(key)) : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...provided]) {
      for (const implied of IMPLICATIONS[permission] || []) {
        if (!provided.has(implied)) {
          provided.add(implied);
          changed = true;
        }
      }
    }
  }
  return ALL_PERMISSIONS.filter((permission) => provided.has(permission));
}

function parsePermissions(value) {
  try {
    return normalizePermissions(JSON.parse(value || '[]'));
  } catch {
    return [];
  }
}

function sanitizePermissionOverrides(input) {
  const allow = new Set(Array.isArray(input?.allow) ? input.allow.filter((key) => ALL_PERMISSIONS.includes(key)) : []);
  const deny = new Set(Array.isArray(input?.deny) ? input.deny.filter((key) => ALL_PERMISSIONS.includes(key)) : []);

  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...allow]) {
      for (const implied of IMPLICATIONS[permission] || []) {
        if (!allow.has(implied)) {
          allow.add(implied);
          changed = true;
        }
      }
    }
  }

  for (const permission of deny) allow.delete(permission);

  return {
    allow: ALL_PERMISSIONS.filter((permission) => allow.has(permission)),
    deny: ALL_PERMISSIONS.filter((permission) => deny.has(permission))
  };
}

function normalizePermissionOverrides(input) {
  return sanitizePermissionOverrides(input);
}

function parsePermissionOverrides(value) {
  try {
    return sanitizePermissionOverrides(JSON.parse(value || '{}'));
  } catch {
    return { allow: [], deny: [] };
  }
}

function sanitizeObjectRule(type, rule) {
  const allowedKeys = new Set(type.permissions);
  const allow = new Set(Array.isArray(rule?.allow) ? rule.allow.filter((key) => allowedKeys.has(key)) : []);
  const deny = new Set(Array.isArray(rule?.deny) ? rule.deny.filter((key) => allowedKeys.has(key)) : []);

  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...allow]) {
      for (const implied of OBJECT_IMPLICATIONS[type.key]?.[permission] || []) {
        if (!allow.has(implied)) {
          allow.add(implied);
          changed = true;
        }
      }
    }
  }

  for (const permission of deny) allow.delete(permission);

  return {
    allow: type.permissions.filter((permission) => allow.has(permission)),
    deny: type.permissions.filter((permission) => deny.has(permission))
  };
}

function parseObjectPermissions(value) {
  try {
    const input = JSON.parse(value || '{}');
    return sanitizeObjectPermissions(input);
  } catch {
    return {};
  }
}

function sanitizeObjectPermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const type of OBJECT_TYPES) {
    const rules = input[type.key];
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) continue;
    const entries = {};
    for (const [id, rule] of Object.entries(rules)) {
      if (!id) continue;
      const clean = sanitizeObjectRule(type, rule);
      if (clean.allow.length || clean.deny.length) entries[id] = clean;
    }
    if (Object.keys(entries).length) result[type.key] = entries;
  }
  return result;
}

function normalizeObjectPermissions(db, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const type of OBJECT_TYPES) {
    const rules = input[type.key];
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) continue;
    const entries = {};
    for (const [id, rule] of Object.entries(rules)) {
      const exists = db.prepare(`SELECT id FROM ${OBJECT_TABLES[type.key]} WHERE id = ?`).get(id);
      if (!exists) throw new HttpError(400, `Das ausgewählte Objekt in „${type.label}“ existiert nicht.`);
      const clean = sanitizeObjectRule(type, rule);
      if (clean.allow.length || clean.deny.length) entries[id] = clean;
    }
    if (Object.keys(entries).length) result[type.key] = entries;
  }
  return result;
}

function ensureRoles(db) {
  const now = new Date().toISOString();
  const schemaVersion = Number(db.pragma('user_version', { simple: true })) || 0;
  const insert = db.prepare(`
    INSERT INTO roles (id, name, permissions, object_permissions, is_system, rank, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  insert.run('admin', 'Administrator', JSON.stringify(ALL_PERMISSIONS), '{}', 1, RANK_ADMIN, now, now);
  insert.run('manager', 'Fuhrparkleitung', JSON.stringify(normalizePermissions(DEFAULT_MANAGER_PERMISSIONS)), '{}', 1, RANK_MANAGER, now, now);

  db.prepare("UPDATE roles SET permissions = ?, object_permissions = '{}', rank = ? WHERE id = 'admin'")
    .run(JSON.stringify(ALL_PERMISSIONS), RANK_ADMIN);

  if (schemaVersion < ROLE_SCHEMA_VERSION) {
    if (schemaVersion < 1) {
      db.prepare('UPDATE roles SET rank = ? WHERE id = ? AND (rank IS NULL OR rank = 0)')
        .run(RANK_MANAGER, 'manager');

      const customRoles = db.prepare(`
        SELECT id FROM roles
        WHERE id NOT IN ('admin', 'manager') AND (rank IS NULL OR rank = 0)
        ORDER BY created_at, id
      `).all();
      const setCustomRank = db.prepare('UPDATE roles SET rank = ? WHERE id = ?');
      customRoles.forEach((role, index) => setCustomRank.run(RANK_CUSTOM_BASE + index, role.id));

      const manager = db.prepare('SELECT permissions FROM roles WHERE id = ?').get('manager');
      if (manager) {
        const permissions = new Set(parsePermissions(manager.permissions));
        permissions.add('users_manage');
        permissions.add('roles_manage');
        db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
          .run(JSON.stringify(normalizePermissions([...permissions])), 'manager');
      }
    }

    if (schemaVersion < 2) {
      const manager = db.prepare('SELECT permissions FROM roles WHERE id = ?').get('manager');
      if (manager) {
        const permissions = new Set(parsePermissions(manager.permissions));
        permissions.add('booking_requests_manage');
        db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
          .run(JSON.stringify(normalizePermissions([...permissions])), 'manager');
      }
    }

    if (schemaVersion < 3) {
      const manager = db.prepare('SELECT permissions FROM roles WHERE id = ?').get('manager');
      if (manager) {
        const permissions = new Set(parsePermissions(manager.permissions));
        permissions.add('audit_view');
        db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
          .run(JSON.stringify(normalizePermissions([...permissions])), 'manager');
      }
    }

    db.pragma(`user_version = ${ROLE_SCHEMA_VERSION}`);
  }
}

function getRoleRank(db, roleId) {
  const role = db.prepare('SELECT rank FROM roles WHERE id = ?').get(roleId);
  return Number(role?.rank) || 0;
}

function rolePermissionsWithin(db, roleId, allowedPermissions) {
  const allowed = allowedPermissions instanceof Set
    ? allowedPermissions
    : new Set(allowedPermissions || []);
  const role = db.prepare('SELECT permissions, object_permissions FROM roles WHERE id = ?').get(roleId);
  if (!role) return false;
  const permissions = parsePermissions(role.permissions);
  if (permissions.some((permission) => !allowed.has(permission))) return false;
  const objectPermissions = parseObjectPermissions(role.object_permissions);
  for (const entries of Object.values(objectPermissions)) {
    for (const rule of Object.values(entries)) {
      if ((rule.allow || []).some((permission) => !allowed.has(permission))) return false;
    }
  }
  return true;
}

function getRolePermissions(db, roleId) {
  if (roleId === 'admin' || roleId === 'superadmin') return [...ALL_PERMISSIONS];
  const role = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(roleId);
  if (!role) return [];
  return parsePermissions(role.permissions);
}

function getRoleObjectPermissions(db, roleId) {
  if (roleId === 'admin' || roleId === 'superadmin') return {};
  const role = db.prepare('SELECT object_permissions FROM roles WHERE id = ?').get(roleId);
  if (!role) return {};
  return parseObjectPermissions(role.object_permissions);
}

function getUserPermissionOverrides(db, userId) {
  const user = db.prepare('SELECT permission_overrides FROM users WHERE id = ?').get(userId);
  if (!user) return { allow: [], deny: [] };
  return parsePermissionOverrides(user.permission_overrides);
}

function getUserObjectPermissions(db, userId) {
  const user = db.prepare('SELECT object_permissions FROM users WHERE id = ?').get(userId);
  if (!user) return {};
  return parseObjectPermissions(user.object_permissions);
}

function getContextRefs(context = {}) {
  const refs = [];
  for (const key of ['vehicle', 'driver', 'booking', 'cost', 'maintenance']) {
    const row = context[key];
    if (row?.id) refs.push({ type: key, id: String(row.id) });
  }
  return refs;
}

function evaluateObjectLayer(objectPermissions, refs, permission) {
  let explicit = false;
  for (const ref of refs) {
    const type = OBJECT_BY_KEY[ref.type];
    if (!type || !type.permissions.includes(permission)) continue;
    const rule = objectPermissions?.[ref.type]?.[ref.id];
    if (!rule) continue;
    if (rule.deny?.includes(permission)) return false;
    if (rule.allow?.includes(permission)) explicit = true;
  }
  return explicit ? true : null;
}

function permissionRelevantToContext(permission, context) {
  const refs = getContextRefs(context);
  if (!refs.length) return true;
  return refs.some((ref) => OBJECT_BY_KEY[ref.type]?.permissions.includes(permission));
}

function checkPrerequisites(layers, permission, context) {
  for (const prerequisite of IMPLICATIONS[permission] || []) {
    if (!permissionRelevantToContext(prerequisite, context)) continue;
    if (!resolvePermission(layers, prerequisite, context)) return false;
  }
  const refs = getContextRefs(context);
  for (const ref of refs) {
    const type = OBJECT_BY_KEY[ref.type];
    if (!type || !type.permissions.includes(permission)) continue;
    for (const prerequisite of OBJECT_PREREQUISITES[ref.type]?.[permission] || []) {
      if (!resolvePermission(layers, prerequisite, context)) return false;
    }
  }
  return true;
}

function resolvePermission(layers = {}, permission, context = {}) {
  if (layers.isAdmin || layers.isSuperadmin) return true;
  if (!ALL_PERMISSIONS.includes(permission)) return false;
  const refs = getContextRefs(context);

  let result = evaluateObjectLayer(layers.userObjectPermissions, refs, permission);
  if (result === false) return false;
  if (result === true) return checkPrerequisites(layers, permission, context);

  const userOverrides = layers.userPermissionOverrides || {};
  if (userOverrides.deny?.includes(permission)) return false;
  if (userOverrides.allow?.includes(permission)) return checkPrerequisites(layers, permission, context);

  result = evaluateObjectLayer(layers.roleObjectPermissions, refs, permission);
  if (result === false) return false;
  if (result === true) return checkPrerequisites(layers, permission, context);

  const rolePermissions = layers.rolePermissions instanceof Set
    ? layers.rolePermissions
    : new Set(layers.rolePermissions || []);
  if (rolePermissions.has(permission)) return checkPrerequisites(layers, permission, context);

  const driverDefaults = layers.driverDefaultPermissions instanceof Set
    ? layers.driverDefaultPermissions
    : new Set(layers.driverDefaultPermissions || []);
  if (driverDefaults.has(permission)) return checkPrerequisites(layers, permission, context);
  return false;
}

function effectivePermission(basePermissions, objectPermissions, permission, context = {}) {
  return resolvePermission({
    rolePermissions: basePermissions instanceof Set ? basePermissions : new Set(basePermissions || []),
    roleObjectPermissions: objectPermissions || {},
    userPermissionOverrides: { allow: [], deny: [] },
    userObjectPermissions: {}
  }, permission, context);
}

function driverDefaultPermissions(driver) {
  const defaults = new Set();
  if (!driver || !driver.user_id) return defaults;
  if (Number(driver.own_trips_access) !== 1) return defaults;
  defaults.add('own_trips_view');
  defaults.add('own_trips_request');
  defaults.add('own_trips_execute');
  return defaults;
}

function effectiveGlobalPermissions(layers) {
  const result = new Set();
  for (const permission of ALL_PERMISSIONS) {
    if (resolvePermission(layers, permission, {})) result.add(permission);
  }
  return result;
}

function requirePermission(permission) {
  return (req, _res, next) => {
    if (req.permissions?.has(permission)) return next();
    return next(new HttpError(403, 'Für diese Aktion fehlt die erforderliche Berechtigung.'));
  };
}

function hasEffectivePermission(req, permission, context = {}) {
  if (req.user?.role === 'admin' || req.user?.role === 'superadmin' || req.auth?.isAdmin || req.auth?.isSuperadmin) return true;
  const layers = req.auth || {
    rolePermissions: req.permissions || new Set(),
    roleObjectPermissions: req.objectPermissions || {},
    userPermissionOverrides: req.userPermissionOverrides || { allow: [], deny: [] },
    userObjectPermissions: req.userObjectPermissions || {}
  };
  return resolvePermission(layers, permission, context);
}

function roleName(db, roleId) {
  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId);
  return role?.name || roleId;
}

function publicObjectTypes() {
  return OBJECT_TYPES.map(({ table, ...type }) => type);
}

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  DEFAULT_MANAGER_PERMISSIONS,
  OBJECT_TYPES,
  normalizePermissions,
  parsePermissions,
  normalizePermissionOverrides,
  parsePermissionOverrides,
  parseObjectPermissions,
  normalizeObjectPermissions,
  ensureRoles,
  getRoleRank,
  rolePermissionsWithin,
  getRolePermissions,
  getRoleObjectPermissions,
  getUserPermissionOverrides,
  getUserObjectPermissions,
  effectivePermission,
  effectiveGlobalPermissions,
  driverDefaultPermissions,
  resolvePermission,
  hasEffectivePermission,
  requirePermission,
  roleName,
  publicObjectTypes
};
