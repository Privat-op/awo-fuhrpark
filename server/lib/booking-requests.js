'use strict';

const { writeAudit } = require('./audit');
const { HttpError, isoNow } = require('./validation');
const { getRoleRank } = require('./permissions');

const REQUEST_STATUSES = ['requested', 'approved', 'rejected', 'canceled'];

function parseBookingRequestPolicy(value) {
  let input = value;
  if (typeof value === 'string') {
    try {
      input = JSON.parse(value || '{}');
    } catch {
      input = {};
    }
  }
  const unique = (items) => [...new Set((Array.isArray(items) ? items : []).map(String).filter(Boolean))];
  return {
    allow: unique(input?.allow),
    deny: unique(input?.deny)
  };
}

function normalizeBookingRequestPolicy(db, input, { actorRank = 0 } = {}) {
  const policy = parseBookingRequestPolicy(input);
  const roleStmt = db.prepare('SELECT id, rank FROM roles WHERE id = ?');
  for (const roleId of [...policy.allow, ...policy.deny]) {
    const role = roleStmt.get(roleId);
    if (!role) throw new HttpError(400, 'Die Buchungsanfrage-Policy enthält eine unbekannte Rolle.');
    if ((Number(role.rank) || 0) >= actorRank) {
      throw new HttpError(403, 'In der Buchungsanfrage-Policy dürfen nur Rollen unterhalb des eigenen Rangs stehen.');
    }
  }
  return policy;
}

function getRoleBookingRequestPolicy(db, roleId) {
  const role = db.prepare('SELECT booking_request_policy FROM roles WHERE id = ?').get(roleId);
  if (!role) return { allow: [], deny: [] };
  return parseBookingRequestPolicy(role.booking_request_policy);
}

function isRequestVisibleToApprover(db, actorUser, request, requesterUser, { isAdmin = false } = {}) {
  if (!request || !actorUser) return false;
  if (request.requested_by && request.requested_by === actorUser.id) return false;
  if (isAdmin) return true;
  if (!requesterUser) return false;
  const actorRank = getRoleRank(db, actorUser.role);
  const requesterRank = getRoleRank(db, requesterUser.role);
  if (requesterRank >= actorRank) return false;
  const policy = getRoleBookingRequestPolicy(db, actorUser.role);
  if (policy.deny.includes(requesterUser.role)) return false;
  if (policy.allow.length && !policy.allow.includes(requesterUser.role)) return false;
  return true;
}

function cancelOpenBookingRequests(db, userId, { actorId = null, reason = 'requester_deactivated' } = {}) {
  if (!userId) return 0;
  const openRequests = db.prepare(`
    SELECT id, vehicle_id, driver_id, purpose, start_at, end_at
    FROM booking_requests
    WHERE requested_by = ? AND status = 'requested'
    ORDER BY created_at, id
  `).all(userId);
  if (!openRequests.length) return 0;
  const now = isoNow();
  const update = db.prepare(`
    UPDATE booking_requests
    SET status = 'canceled', decided_at = ?, decision_note = ?, updated_at = ?
    WHERE id = ? AND status = 'requested'
  `);
  for (const request of openRequests) {
    update.run(now, 'Automatisch storniert, weil das anfragende Konto deaktiviert oder anonymisiert wurde.', now, request.id);
    writeAudit(db, {
      userId: actorId,
      action: 'cancel',
      entityType: 'booking_request',
      entityId: request.id,
      details: {
        reason,
        requestedBy: userId,
        vehicleId: request.vehicle_id,
        driverId: request.driver_id,
        purpose: request.purpose,
        start: request.start_at,
        end: request.end_at
      }
    });
  }
  return openRequests.length;
}

function mapBookingRequest(row, { vehicle = null, driver = null, requester = null } = {}) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    vehicleName: vehicle?.name || '',
    vehiclePlate: vehicle?.plate || '',
    vehicleType: vehicle?.type || 'Pkw',
    vehicleColor: vehicle?.color || '#64748b',
    driverName: driver?.name || '',
    requesterName: requester?.name || '',
    requesterRole: requester?.role || '',
    purpose: row.purpose,
    start: row.start_at,
    end: row.end_at,
    notes: row.notes,
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedAt: row.decided_at || null,
    bookingId: row.booking_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  REQUEST_STATUSES,
  parseBookingRequestPolicy,
  normalizeBookingRequestPolicy,
  getRoleBookingRequestPolicy,
  isRequestVisibleToApprover,
  cancelOpenBookingRequests,
  mapBookingRequest
};
