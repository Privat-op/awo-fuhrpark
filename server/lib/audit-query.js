'use strict';

const { HttpError, optionalDate, todayISO } = require('./validation');
const { writeAudit } = require('./audit');
const { getRoleRank, hasEffectivePermission } = require('./permissions');

const ENTITY_LABELS = {
  vehicle: 'Fahrzeug',
  driver: 'Fahrer:in',
  booking: 'Buchung',
  trip: 'Fahrt',
  cost: 'Kostenposition',
  maintenance: 'Wartung',
  user: 'Benutzerkonto',
  role: 'Rolle',
  role_object_permissions: 'Rollen-Objektausnahmen',
  user_permissions: 'Benutzer-Ausnahmen',
  user_policy: 'Benutzerrichtlinie',
  settings: 'Einstellungen',
  branding: 'Erscheinungsbild',
  logbook: 'Fahrtenbuch',
  data: 'Datenexport',
  audit: 'Audit-Log',
  system: 'System'
};

const ACTION_LABELS = {
  create: 'Erstellt',
  update: 'Aktualisiert',
  delete: 'Gelöscht',
  login: 'Anmeldung',
  login_failed: 'Fehlgeschlagene Anmeldung',
  logout: 'Abmeldung',
  export: 'Export',
  start: 'Gestartet',
  complete: 'Abgeschlossen',
  cancel: 'Storniert',
  change_password: 'Passwort geändert',
  anonymize: 'Anonymisiert',
  read: 'Audit-Log gelesen'
};

const OBJECT_TARGETS = {
  vehicle: { table: 'vehicles', permission: 'vehicles_view' },
  driver: { table: 'drivers', permission: 'drivers_view' },
  booking: { table: 'bookings', permission: 'bookings_view' },
  trip: { table: 'bookings', permission: 'logbook_view' },
  cost: { table: 'costs', permission: 'costs_view' },
  maintenance: { table: 'maintenance', permission: 'maintenance_view' }
};

const TARGET_IDENTIFYING_FIELDS = new Set([
  'name', 'plate', 'purpose', 'title', 'category',
  'orgName', 'brandName', 'theme', 'accentColor', 'sidebarStyle',
  'role', 'roleRank', 'active', 'rank', 'permissions', 'objectPermissions', 'permissionOverrides',
  'logoChanged', 'logoRemoved'
]);

function textValue(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function addDaysISO(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateRange(query) {
  const today = todayISO();
  const fromValue = textValue(query.from, 10);
  const toValue = textValue(query.to, 10);
  let from = fromValue ? optionalDate(fromValue, 'Von-Datum') : null;
  let to = toValue ? optionalDate(toValue, 'Bis-Datum') : null;
  if (!from && !to) {
    from = addDaysISO(today, -30);
    to = today;
  } else if (!from) {
    from = addDaysISO(to, -30);
  } else if (!to) {
    to = today;
  }
  if (from > to) {
    throw new HttpError(400, 'Der Zeitraum ist ungültig: „Von“ liegt nach „Bis“.');
  }
  return { from, to };
}

function integerParam(value, fallback, min, max) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function resolveAuditScope(db, req) {
  if (req.user?.role === 'admin' || req.auth?.isAdmin) {
    return { key: 'all', rank: null };
  }
  if (hasEffectivePermission(req, 'audit_view_all')) {
    return { key: 'all', rank: null };
  }
  if (hasEffectivePermission(req, 'audit_view')) {
    return { key: 'rank', rank: getRoleRank(db, req.user.role) };
  }
  return { key: 'self', rank: null };
}

function shortId(value) {
  const text = String(value || '');
  if (!text) return '';
  return text.length > 10 ? `${text.slice(0, 8)}…` : text;
}

function entityLabel(entityType) {
  return ENTITY_LABELS[entityType] || entityType || 'Objekt';
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action || '';
}

function fallbackTargetLabel(entityType, entityId) {
  const label = entityLabel(entityType);
  const short = shortId(entityId);
  return short ? `${label} · ${short}` : label;
}

function toIsoTimestamp(value) {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return `${text.replace(' ', 'T')}Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return `${text}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function maskEmail(value) {
  const text = String(value || '');
  const at = text.indexOf('@');
  if (at < 1) return text ? '••••' : '';
  return `${text.slice(0, 1)}***@${text.slice(at + 1)}`;
}

function maskPhone(value) {
  const text = String(value || '');
  const digits = text.replace(/\D/g, '');
  if (!digits) return text ? '••••' : '';
  return `•••• ${digits.slice(-2)}`;
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(number);
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (Array.isArray(value)) return `${value.length} Einträge`;
  if (value && typeof value === 'object') return null;
  return textValue(value, 240);
}

function countRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let count = 0;
  for (const entries of Object.values(value)) {
    if (entries && typeof entries === 'object') count += Object.keys(entries).length;
  }
  return String(count);
}

function countOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return String((Array.isArray(value.allow) ? value.allow.length : 0) + (Array.isArray(value.deny) ? value.deny.length : 0));
}

function formatFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parts = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === '') continue;
    parts.push(`${key}: ${textValue(entry, 120)}`);
  }
  return parts.join(' · ').slice(0, 500);
}

function buildDetailsSummary(rawDetails, { maskPersonal, targetVisible, anonymized }) {
  if (!rawDetails) return [];
  let details;
  try {
    details = JSON.parse(rawDetails);
  } catch {
    return [];
  }
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];

  const summary = [];
  const add = (key, label, formatter = formatValue) => {
    if (!Object.prototype.hasOwnProperty.call(details, key)) return;
    if (TARGET_IDENTIFYING_FIELDS.has(key) && !targetVisible) return;
    let value;
    if (key === 'email' && maskPersonal) value = maskEmail(details[key]);
    else if (key === 'phone' && maskPersonal) value = maskPhone(details[key]);
    else value = formatter(details[key]);
    if (value === null || value === undefined || value === '') return;
    summary.push({ label, value });
  };
  const addOverride = (key, label, formatter) => {
    if (!Object.prototype.hasOwnProperty.call(details, key)) return;
    if (TARGET_IDENTIFYING_FIELDS.has(key) && !targetVisible) return;
    const value = formatter(details[key]);
    if (value === null || value === undefined || value === '') return;
    summary.push({ label, value });
  };

  add('name', 'Name');
  add('plate', 'Kennzeichen');
  add('purpose', 'Zweck');
  add('title', 'Titel');
  add('orgName', 'Einrichtung');
  add('brandName', 'Anzeigename');
  add('email', 'E-Mail');
  add('phone', 'Telefon');
  add('role', 'Rolle');
  add('roleRank', 'Rang');
  add('active', 'Aktiv');
  add('category', 'Kategorie');
  add('amount', 'Betrag', (value) => formatCurrency(value));
  add('start', 'Start');
  add('end', 'Ende');
  add('startKm', 'Startkilometer');
  add('endKm', 'Endkilometer');
  add('distance', 'Distanz');
  add('theme', 'Erscheinungsbild');
  add('accentColor', 'Akzentfarbe');
  add('sidebarStyle', 'Sidebar');
  add('logoChanged', 'Logo geändert');
  add('logoRemoved', 'Logo entfernt');
  add('autoAnonymizeDays', 'Frist (Tage)');
  add('period', 'Zeitraum');
  add('count', 'Anzahl');
  add('passwordChanged', 'Passwort geändert');
  add('rank', 'Rang');
  addOverride('permissions', 'Rechte', (value) => Array.isArray(value) ? `${value.length} Rechte` : formatValue(value));
  addOverride('objectPermissions', 'Objekt-Ausnahmen', countRules);
  addOverride('permissionOverrides', 'Rechte-Ausnahmen', countOverrides);
  addOverride('filters', 'Filter', formatFilters);

  if (anonymized) {
    return summary.filter((entry) => entry.label !== 'E-Mail' && entry.label !== 'Telefon');
  }
  return summary;
}

function objectContext(db, cache, entityType, entityId) {
  const target = OBJECT_TARGETS[entityType];
  if (!target || !entityId) return null;
  const key = `${entityType}:${entityId}`;
  if (cache.has(key)) return cache.get(key);
  let context = null;
  const row = db.prepare(`SELECT * FROM ${target.table} WHERE id = ?`).get(entityId);
  if (row) {
    if (entityType === 'vehicle') context = { vehicle: row };
    else if (entityType === 'driver') context = { driver: row };
    else if (entityType === 'booking' || entityType === 'trip') {
      context = {
        booking: row,
        vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(row.vehicle_id),
        driver: db.prepare('SELECT * FROM drivers WHERE id = ?').get(row.driver_id)
      };
    } else if (entityType === 'cost') {
      context = { cost: row, vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(row.vehicle_id) };
    } else if (entityType === 'maintenance') {
      context = { maintenance: row, vehicle: db.prepare('SELECT * FROM vehicles WHERE id = ?').get(row.vehicle_id) };
    }
  }
  cache.set(key, context);
  return context;
}

function canSeeTarget(req, entityType, context, row) {
  if (!context) return false;
  if (entityType === 'booking') {
    return hasEffectivePermission(req, 'bookings_view', context)
      || (context.booking?.status === 'completed' && hasEffectivePermission(req, 'logbook_view', context));
  }
  if (entityType === 'trip') {
    return hasEffectivePermission(req, 'logbook_view', context)
      || hasEffectivePermission(req, 'bookings_view', context);
  }
  const target = OBJECT_TARGETS[entityType];
  return target ? hasEffectivePermission(req, target.permission, context) : false;
}

function targetVisibleFor(req, db, cache, entityType, entityId, row) {
  if (OBJECT_TARGETS[entityType]) {
    const context = objectContext(db, cache, entityType, entityId);
    return canSeeTarget(req, entityType, context, row);
  }
  if (entityType === 'user') return hasEffectivePermission(req, 'users_manage');
  if (entityType === 'role' || entityType === 'role_object_permissions') return hasEffectivePermission(req, 'roles_manage');
  if (entityType === 'settings' || entityType === 'user_policy') return hasEffectivePermission(req, 'settings_manage');
  if (entityType === 'branding') return hasEffectivePermission(req, 'branding_manage');
  if (entityType === 'audit') return hasEffectivePermission(req, 'audit_view_all') || req.user?.role === 'admin';
  return false;
}

function targetLabelFor(db, cache, entityType, entityId, visible) {
  if (!visible) return fallbackTargetLabel(entityType, entityId);
  const target = OBJECT_TARGETS[entityType];
  if (!target || !entityId) return fallbackTargetLabel(entityType, entityId);
  const context = objectContext(db, cache, entityType, entityId);
  if (!context) return fallbackTargetLabel(entityType, entityId);
  if (entityType === 'vehicle') {
    const vehicle = context.vehicle;
    return [vehicle.name, vehicle.plate].filter(Boolean).join(' · ');
  }
  if (entityType === 'driver') return context.driver.name;
  if (entityType === 'booking' || entityType === 'trip') return context.booking.purpose;
  if (entityType === 'cost') return context.cost.category;
  if (entityType === 'maintenance') return context.maintenance.title;
  return fallbackTargetLabel(entityType, entityId);
}

function mapActor(row) {
  if (!row.user_id) {
    return {
      id: null,
      name: 'System',
      roleId: null,
      roleName: null,
      rank: null,
      anonymized: false
    };
  }
  return {
    id: row.user_id,
    name: row.actor_anonymized_at ? 'Anonymisiertes Konto' : (row.actor_name || 'Unbekanntes Konto'),
    roleId: row.actor_role_id || null,
    roleName: row.actor_role_name || null,
    rank: row.actor_rank === null || row.actor_rank === undefined ? null : Number(row.actor_rank),
    anonymized: Boolean(row.actor_anonymized_at)
  };
}

function queryAudit(db, req, query = {}) {
  const scope = resolveAuditScope(db, req);
  const { from, to } = dateRange(query);
  const action = textValue(query.action, 80);
  const entityType = textValue(query.entityType, 80);
  const q = textValue(query.q, 200).toLocaleLowerCase('de');
  const actorFilter = textValue(query.actor, 160).toLocaleLowerCase('de');
  const targetFilter = textValue(query.target, 200).toLocaleLowerCase('de');
  const page = integerParam(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = integerParam(query.pageSize, 25, 1, 100);

  const conditions = [];
  const params = [];
  if (scope.key === 'self') {
    conditions.push('a.is_meta = 0');
    conditions.push('a.user_id = ?');
    params.push(req.user.id);
  } else if (scope.key === 'rank') {
    conditions.push('a.is_meta = 0');
    conditions.push('a.user_id IS NOT NULL');
    conditions.push("(a.actor_role_id IS NULL OR a.actor_role_id <> 'admin')");
    conditions.push('(a.user_id = ? OR (a.actor_rank IS NOT NULL AND a.actor_rank < ?))');
    params.push(req.user.id, scope.rank);
  }
  conditions.push('date(a.created_at) >= ?');
  conditions.push('date(a.created_at) <= ?');
  params.push(from, to);
  if (action) {
    conditions.push('LOWER(a.action) = ?');
    params.push(action.toLocaleLowerCase('de'));
  }
  if (entityType) {
    conditions.push('LOWER(a.entity_type) = ?');
    params.push(entityType.toLocaleLowerCase('de'));
  }

  const rows = db.prepare(`
    SELECT
      a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.details,
      a.actor_role_id, a.actor_role_name, a.actor_rank, a.is_meta, a.created_at,
      u.name AS actor_name, u.anonymized_at AS actor_anonymized_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY datetime(a.created_at) DESC, a.id DESC
  `).all(...params);

  const cache = new Map();
  const mapped = rows.map((row) => {
    const isOwn = Boolean(row.user_id) && row.user_id === req.user.id;
    const targetVisible = targetVisibleFor(req, db, cache, row.entity_type, row.entity_id, row);
    const targetLabel = targetLabelFor(db, cache, row.entity_type, row.entity_id, targetVisible);
    const actor = mapActor(row);
    const maskPersonal = !isOwn && scope.key !== 'all';
    const detailsSummary = buildDetailsSummary(row.details, {
      maskPersonal,
      targetVisible,
      anonymized: actor.anonymized
    });
    const item = {
      id: row.id,
      createdAt: toIsoTimestamp(row.created_at),
      action: row.action,
      actionLabel: actionLabel(row.action),
      entityType: row.entity_type,
      entityTypeLabel: entityLabel(row.entity_type),
      entityId: row.entity_id,
      targetLabel,
      actor,
      isMeta: Boolean(row.is_meta),
      detailsSummary
    };
    item.searchText = [
      actor.name,
      actor.id,
      actor.roleName,
      row.action,
      item.actionLabel,
      row.entity_type,
      item.entityTypeLabel,
      row.entity_id,
      targetLabel
    ].filter(Boolean).join(' ').toLocaleLowerCase('de');
    item.actorSearchText = [actor.name, actor.id].filter(Boolean).join(' ').toLocaleLowerCase('de');
    item.targetSearchText = [targetLabel, row.entity_id].filter(Boolean).join(' ').toLocaleLowerCase('de');
    return item;
  });

  const filtered = mapped.filter((item) => {
    if (q && !item.searchText.includes(q)) return false;
    if (actorFilter && !item.actorSearchText.includes(actorFilter)) return false;
    if (targetFilter && !item.targetSearchText.includes(targetFilter)) return false;
    return true;
  });
  const total = filtered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const items = filtered.slice(offset, offset + pageSize).map(({ searchText, actorSearchText, targetSearchText, ...item }) => item);

  const filters = {
    q: textValue(query.q, 200) || undefined,
    actor: textValue(query.actor, 160) || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    target: textValue(query.target, 200) || undefined,
    from,
    to,
    page,
    pageSize
  };

  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    scope: scope.key,
    filters
  };
}

function recordAuditRead(db, req, result) {
  writeAudit(db, {
    userId: req.user.id,
    action: 'read',
    entityType: 'audit',
    entityId: null,
    details: {
      filters: result.filters,
      count: result.total,
      page: result.page,
      pageSize: result.pageSize,
      scope: result.scope
    },
    isMeta: true
  });
}

module.exports = {
  queryAudit,
  recordAuditRead,
  resolveAuditScope,
  maskEmail,
  maskPhone
};
