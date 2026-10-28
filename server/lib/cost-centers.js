'use strict';

const { HttpError, booleanValue, optionalString, requiredString } = require('./validation');

const USAGE_TABLES = ['vehicles', 'drivers', 'users', 'bookings', 'booking_requests', 'costs'];

function normalizeCostCenterCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(code)) {
    throw new HttpError(400, 'Der Kostenstellencode muss mit einem Buchstaben oder einer Zahl beginnen und darf maximal 40 Zeichen enthalten.');
  }
  return code;
}

function parseCostCenterPayload(body, existing = null) {
  const code = normalizeCostCenterCode(body.code === undefined ? existing?.code : body.code);
  const name = requiredString(body.name === undefined ? existing?.name : body.name, 'Bezeichnung', { max: 160 });
  const description = optionalString(body.description === undefined ? existing?.description : body.description, { max: 500 });
  const active = body.active === undefined ? Boolean(existing?.active ?? true) : booleanValue(body.active, true);
  return { code, name, description, active };
}

function getCostCenter(db, id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(id) || null;
}

function assertCostCenterAssignable(db, id, { existingId = null } = {}) {
  if (id === undefined || id === null || id === '') return null;
  const costCenter = getCostCenter(db, String(id));
  if (!costCenter) throw new HttpError(400, 'Die ausgewählte Kostenstelle existiert nicht.');
  if (!costCenter.active && String(id) !== String(existingId || '')) {
    throw new HttpError(400, 'Eine inaktive Kostenstelle kann nicht neu zugeordnet werden.');
  }
  return costCenter.id;
}

function pickActiveCostCenter(db, ids) {
  for (const id of ids) {
    if (!id) continue;
    const costCenter = getCostCenter(db, id);
    if (costCenter?.active) return costCenter.id;
  }
  return null;
}

function resolveBookingCostCenter(db, { explicit = false, explicitId = null, driver = null, vehicle = null, user = null, existingId = null } = {}) {
  if (explicit) {
    if (explicitId === null || explicitId === undefined || explicitId === '') return null;
    return assertCostCenterAssignable(db, explicitId, { existingId });
  }
  return pickActiveCostCenter(db, [
    driver?.cost_center_id,
    vehicle?.cost_center_id,
    user?.cost_center_id
  ]);
}

function resolveCostCostCenter(db, { explicit = false, explicitId = null, vehicle = null, user = null, existingId = null } = {}) {
  if (explicit) {
    if (explicitId === null || explicitId === undefined || explicitId === '') return null;
    return assertCostCenterAssignable(db, explicitId, { existingId });
  }
  return pickActiveCostCenter(db, [
    vehicle?.cost_center_id,
    user?.cost_center_id
  ]);
}

function getAllCostCenterUsage(db) {
  const usage = new Map();
  for (const table of USAGE_TABLES) {
    const rows = db.prepare(`
      SELECT cost_center_id, COUNT(*) AS count
      FROM ${table}
      WHERE cost_center_id IS NOT NULL
      GROUP BY cost_center_id
    `).all();
    for (const row of rows) {
      const entry = usage.get(row.cost_center_id) || {};
      entry[table] = Number(row.count) || 0;
      entry.total = (entry.total || 0) + (Number(row.count) || 0);
      usage.set(row.cost_center_id, entry);
    }
  }
  return usage;
}

function getCostCenterUsage(db, id) {
  const usage = getAllCostCenterUsage(db).get(id) || {};
  return {
    vehicles: usage.vehicles || 0,
    drivers: usage.drivers || 0,
    users: usage.users || 0,
    bookings: usage.bookings || 0,
    bookingRequests: usage.booking_requests || 0,
    costs: usage.costs || 0,
    total: usage.total || 0
  };
}

module.exports = {
  normalizeCostCenterCode,
  parseCostCenterPayload,
  getCostCenter,
  assertCostCenterAssignable,
  pickActiveCostCenter,
  resolveBookingCostCenter,
  resolveCostCostCenter,
  getAllCostCenterUsage,
  getCostCenterUsage
};
