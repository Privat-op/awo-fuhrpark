'use strict';

const { HttpError } = require('./validation');

const VEHICLE_STATUSES = ['available', 'in_use', 'maintenance', 'defect', 'sold', 'not_drivable'];
const VEHICLE_OWNERSHIP_TYPES = ['owned', 'leasing'];
const NON_BOOKABLE_STATUSES = new Set(['maintenance', 'defect', 'sold', 'not_drivable']);
const PRESERVED_STATUSES = new Set(['maintenance', 'defect', 'sold', 'not_drivable']);

const STATUS_MESSAGES = {
  maintenance: 'befindet sich in Wartung.',
  defect: 'ist defekt.',
  sold: 'ist als veräußert markiert.',
  not_drivable: 'ist nicht fahrbereit.'
};

function vehicleUnavailableReason(vehicle) {
  if (!vehicle) return 'Fahrzeug wurde nicht gefunden.';
  const name = vehicle.name || 'Das Fahrzeug';
  if (Number(vehicle.blocked)) {
    const reason = vehicle.blocked_reason ? ` Grund: ${vehicle.blocked_reason}` : '';
    return `${name} ist dauerhaft gesperrt und für neue Buchungen oder Buchungsanfragen nicht verfügbar.${reason}`;
  }
  const message = STATUS_MESSAGES[vehicle.status];
  if (message) return `${name} ${message}`;
  return null;
}

function assertVehicleBookable(vehicle) {
  const reason = vehicleUnavailableReason(vehicle);
  if (reason) throw new HttpError(409, reason);
  return vehicle;
}

function isVehicleStatusBookable(status) {
  return !NON_BOOKABLE_STATUSES.has(String(status));
}

module.exports = {
  VEHICLE_STATUSES,
  VEHICLE_OWNERSHIP_TYPES,
  NON_BOOKABLE_STATUSES,
  PRESERVED_STATUSES,
  vehicleUnavailableReason,
  assertVehicleBookable,
  isVehicleStatusBookable
};
