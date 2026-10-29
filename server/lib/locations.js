'use strict';

const { HttpError } = require('./validation');
const { getLocationsIntegrationConfig } = require('./integrations');

function isLocationsEnabled(db) {
  return getLocationsIntegrationConfig(db).enabled;
}

function listLocations(db) {
  return db.prepare('SELECT * FROM locations ORDER BY active DESC, name, id').all().map((row) => ({
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function getLocation(db, id) {
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(id) || null;
}

function locationName(db, id) {
  if (!id) return '';
  return getLocation(db, id)?.name || '';
}

function assertLocationAssignable(db, id, { existingId = null } = {}) {
  if (id === undefined || id === null || id === '') return null;
  const location = getLocation(db, id);
  if (!location) throw new HttpError(400, 'Der ausgewählte Standort existiert nicht.');
  if (!location.active && id !== existingId) {
    throw new HttpError(400, 'Der ausgewählte Standort ist nicht aktiv.');
  }
  return id;
}

module.exports = {
  isLocationsEnabled,
  listLocations,
  getLocation,
  locationName,
  assertLocationAssignable
};
