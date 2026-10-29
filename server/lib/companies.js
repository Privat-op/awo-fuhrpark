'use strict';

const { HttpError, booleanValue, requiredString } = require('./validation');

function normalizeCompanyCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(code)) {
    throw new HttpError(400, 'Der Gesellschaftscode muss mit einem Buchstaben oder einer Zahl beginnen und darf maximal 40 Zeichen enthalten.');
  }
  return code;
}

function parseCompanyPayload(body, existing = null) {
  const code = normalizeCompanyCode(body.code === undefined ? existing?.code : body.code);
  const name = requiredString(body.name === undefined ? existing?.name : body.name, 'Name der Gesellschaft', { max: 160 });
  const active = body.active === undefined ? Boolean(existing?.active ?? true) : booleanValue(body.active, true);
  return { code, name, active };
}

function mapCompany(row, costCenterCount = 0) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: Boolean(row.active),
    costCenterCount: Number(costCenterCount) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listCompanies(db) {
  const hasCompanyColumn = db.prepare('PRAGMA table_info(cost_centers)').all()
    .some((column) => column.name === 'company_id');
  const countExpression = hasCompanyColumn
    ? '(SELECT COUNT(*) FROM cost_centers cc WHERE cc.company_id = c.id)'
    : '0';
  return db.prepare(`
    SELECT c.*, ${countExpression} AS cost_center_count
    FROM companies c
    ORDER BY c.active DESC, c.code, c.name, c.id
  `).all().map((row) => mapCompany(row, row.cost_center_count));
}

function getCompany(db, id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id) || null;
}

function assertCompanyAssignable(db, id, { existingId = null } = {}) {
  if (id === undefined || id === null || id === '') {
    throw new HttpError(400, 'Die Gesellschaft ist erforderlich.');
  }
  const company = getCompany(db, String(id));
  if (!company) throw new HttpError(400, 'Die ausgewählte Gesellschaft existiert nicht.');
  if (!company.active && String(id) !== String(existingId || '')) {
    throw new HttpError(400, 'Eine inaktive Gesellschaft kann nicht neu zugeordnet werden.');
  }
  return company.id;
}

module.exports = {
  normalizeCompanyCode,
  parseCompanyPayload,
  mapCompany,
  listCompanies,
  getCompany,
  assertCompanyAssignable
};
