'use strict';

const { calculateLeasingState } = require('./leasing');
const { getPublicSmtpConfig } = require('./smtp');
const { getAllCostCenterUsage } = require('./cost-centers');
const { getDefaultColorMode, getResolvedColorMode, getUserColorMode } = require('./color-mode');

function costCenterFields(row, costCenter = null) {
  return {
    costCenterId: row?.cost_center_id || null,
    costCenterCode: costCenter?.code || '',
    costCenterName: costCenter?.name || ''
  };
}

function mapVehicle(row, costCenter = null) {
  const version = encodeURIComponent(row.updated_at || '');
  return {
    id: row.id,
    name: row.name,
    plate: row.plate,
    type: row.type,
    fuel: row.fuel,
    seats: row.seats,
    location: row.location,
    department: row.department,
    status: row.status,
    mileage: row.mileage,
    nextService: row.next_service,
    tuv: row.tuv,
    insurance: row.insurance,
    acquired: row.acquired,
    color: row.color,
    notes: row.notes,
    blocked: Boolean(row.blocked),
    blockedReason: row.blocked_reason || '',
    ...costCenterFields(row, costCenter),
    leasing: calculateLeasingState(row),
    image: row.image_file ? `/api/vehicles/${encodeURIComponent(row.id)}/image?v=${version}` : ''
  };
}

function mapDriver(row, costCenter = null) {
  let license = [];
  try {
    license = JSON.parse(row.license);
  } catch {
    license = ['B'];
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    phone: row.phone,
    email: row.email,
    license: Array.isArray(license) ? license : ['B'],
    status: row.status,
    color: row.color,
    userId: row.user_id || null,
    ownTripsAccess: Number(row.own_trips_access) !== 0,
    ...costCenterFields(row, costCenter)
  };
}

function mapBooking(row, vehicle = null, driver = null, costCenter = null) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    vehicleName: vehicle?.name || '',
    vehiclePlate: vehicle?.plate || '',
    vehicleType: vehicle?.type || 'Pkw',
    vehicleColor: vehicle?.color || '#64748b',
    vehicleLocation: vehicle?.location || '',
    driverName: driver?.name || '',
    driverRole: driver?.role || '',
    driverColor: driver?.color || '#64748b',
    ...costCenterFields(row, costCenter),
    purpose: row.purpose,
    start: row.start_at,
    end: row.end_at,
    status: row.status,
    startKm: row.start_km,
    endKm: row.end_km,
    notes: row.notes,
    completedAt: row.completed_at
  };
}

function mapMaintenance(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    title: row.title,
    dueDate: row.due_date,
    workshop: row.workshop,
    cost: Number(row.cost) || 0,
    status: row.status,
    notes: row.notes,
    completedAt: row.completed_at
  };
}

function mapCost(row, costCenter = null) {
  const version = encodeURIComponent(row.updated_at || '');
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.date,
    category: row.category,
    amount: Number(row.amount) || 0,
    note: row.note,
    ...costCenterFields(row, costCenter),
    receipt: row.receipt_file ? {
      name: row.receipt_name || 'Beleg',
      type: row.receipt_mime || 'application/octet-stream',
      size: row.receipt_size || 0,
      url: `/api/costs/${encodeURIComponent(row.id)}/receipt?v=${version}`
    } : null
  };
}

function mapUser(row, costCenter = null, defaultColorMode = 'light') {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    permissionOverrides: parsePermissionOverrides(row.permission_overrides),
    objectPermissions: parseObjectPermissions(row.object_permissions),
    ...costCenterFields(row, costCenter),
    colorMode: getUserColorMode(row),
    resolvedColorMode: getResolvedColorMode(row, { default_color_mode: defaultColorMode }),
    active: Boolean(row.active),
    lastLoginAt: row.last_login_at,
    deactivatedAt: row.deactivated_at || null,
    anonymizedAt: row.anonymized_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMinimalVehicle(row, costCenter = null) {
  return {
    id: row.id,
    name: row.name,
    plate: row.plate,
    type: row.type,
    color: row.color,
    status: row.status,
    blocked: Boolean(row.blocked),
    blockedReason: row.blocked_reason || '',
    ...costCenterFields(row, costCenter),
    leasing: calculateLeasingState(row)
  };
}

function mapOwnTrip(row, vehicle, costCenter = null) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleName: vehicle?.name || '',
    vehiclePlate: vehicle?.plate || '',
    vehicleType: vehicle?.type || 'Pkw',
    vehicleColor: vehicle?.color || '#64748b',
    ...costCenterFields(row, costCenter),
    purpose: row.purpose,
    start: row.start_at,
    end: row.end_at,
    status: row.status,
    startKm: row.start_km,
    endKm: row.end_km,
    notes: row.notes
  };
}

const { parsePermissions, parsePermissionOverrides, parseObjectPermissions, resolvePermission, isObjectPermissionDenied } = require('./permissions');
const { isRequestVisibleToApprover, mapBookingRequest, parseBookingRequestPolicy } = require('./booking-requests');
const { SUPERADMIN_USER_ID, SUPERADMIN_ROLE_ID } = require('./superadmin');

function getState(db, user, auth = null) {
  const layers = auth || {
    isAdmin: user.role === 'admin',
    isSuperadmin: user.role === 'superadmin',
    rolePermissions: new Set(),
    roleObjectPermissions: {},
    userPermissionOverrides: { allow: [], deny: [] },
    userObjectPermissions: {}
  };
  const isAdmin = Boolean(layers.isAdmin);
  const isSuperadmin = Boolean(layers.isSuperadmin);
  const isPrivileged = isAdmin || isSuperadmin;
  const can = (permission, context = {}) => resolvePermission(layers, permission, context);
  const settingsRow = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const defaultColorMode = getDefaultColorMode(settingsRow);
  const mfaByUserId = new Map(
    db.prepare('SELECT user_id, totp_enabled, totp_confirmed_at, last_verified_at, locked_until FROM user_mfa')
      .all()
      .map((row) => [row.user_id, row])
  );
  const recoveryCountByUserId = new Map(
    db.prepare(`
      SELECT user_id, COUNT(*) AS count FROM mfa_recovery_codes
      WHERE used_at IS NULL GROUP BY user_id
    `).all()
      .map((row) => [row.user_id, Number(row.count) || 0])
  );
  const costCenterRows = db.prepare('SELECT * FROM cost_centers ORDER BY active DESC, code, id').all();
  const costCenterById = new Map(costCenterRows.map((row) => [row.id, row]));
  const costCenterUsage = getAllCostCenterUsage(db);
  const costCenterFor = (row) => costCenterById.get(row?.cost_center_id) || null;
  const mapCostCenter = (row) => {
    const usage = costCenterUsage.get(row.id) || {};
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description || '',
      active: Boolean(row.active),
      usage: {
        vehicles: usage.vehicles || 0,
        drivers: usage.drivers || 0,
        users: usage.users || 0,
        bookings: usage.bookings || 0,
        bookingRequests: usage.booking_requests || 0,
        costs: usage.costs || 0,
        total: usage.total || 0
      }
    };
  };

  const vehicleRows = db.prepare('SELECT * FROM vehicles ORDER BY created_at, id').all();
  const driverRows = db.prepare('SELECT * FROM drivers ORDER BY created_at, id').all();
  const bookingRows = db.prepare('SELECT * FROM bookings ORDER BY start_at, id').all();
  const maintenanceRows = db.prepare('SELECT * FROM maintenance ORDER BY due_date, id').all();
  const costRows = db.prepare('SELECT * FROM costs ORDER BY date DESC, id DESC').all();

  const vehicleById = new Map(vehicleRows.map((row) => [row.id, row]));
  const driverById = new Map(driverRows.map((row) => [row.id, row]));
  const driverByUserId = new Map(driverRows.filter((row) => row.user_id).map((row) => [row.user_id, row]));
  const linkedDriverRow = driverByUserId.get(user.id) || null;
  const bookingContext = (row) => ({
    booking: row,
    vehicle: vehicleById.get(row.vehicle_id),
    driver: driverById.get(row.driver_id)
  });
  const maintenanceContext = (row) => ({
    maintenance: row,
    vehicle: vehicleById.get(row.vehicle_id)
  });
  const costContext = (row) => ({
    cost: row,
    vehicle: vehicleById.get(row.vehicle_id)
  });

  const visibleVehicleRows = vehicleRows.filter((row) => can('vehicles_view', { vehicle: row }));
  const ownTripVehicleRows = visibleVehicleRows.length
    ? visibleVehicleRows
    : vehicleRows.filter((row) => !isObjectPermissionDenied(layers, 'vehicle', row.id, 'vehicles_view'));
  const visibleDriverRows = driverRows.filter((row) => can('drivers_view', { driver: row }));
  const visibleBookingRows = bookingRows.filter((row) => {
    const context = bookingContext(row);
    return can('bookings_view', context) || (row.status === 'completed' && can('logbook_view', context));
  });
  const visibleMaintenanceRows = maintenanceRows.filter((row) => can('maintenance_view', maintenanceContext(row)));
  const visibleCostRows = costRows.filter((row) => can('costs_view', costContext(row)));

  const objectAccess = { vehicle: {}, driver: {}, booking: {}, cost: {}, maintenance: {} };
  const accessKeys = {
    vehicle: [
      'vehicles_view', 'vehicles_manage',
      'bookings_view', 'bookings_create', 'bookings_manage',
      'logbook_view', 'logbook_manage',
      'maintenance_view', 'maintenance_manage',
      'costs_view', 'costs_manage'
    ],
    driver: [
      'drivers_view', 'drivers_manage',
      'bookings_view', 'bookings_create', 'bookings_manage',
      'logbook_view', 'logbook_manage'
    ],
    booking: ['bookings_view', 'bookings_manage', 'logbook_view', 'logbook_manage'],
    cost: ['costs_view', 'costs_manage'],
    maintenance: ['maintenance_view', 'maintenance_manage']
  };
  for (const row of visibleVehicleRows) {
    objectAccess.vehicle[row.id] = Object.fromEntries(accessKeys.vehicle.map((permission) => [permission, can(permission, { vehicle: row })]));
  }
  for (const row of visibleDriverRows) {
    objectAccess.driver[row.id] = Object.fromEntries(accessKeys.driver.map((permission) => [permission, can(permission, { driver: row })]));
  }
  for (const row of visibleBookingRows) {
    const context = bookingContext(row);
    objectAccess.booking[row.id] = Object.fromEntries(accessKeys.booking.map((permission) => [permission, can(permission, context)]));
  }
  for (const row of visibleCostRows) {
    const context = costContext(row);
    objectAccess.cost[row.id] = Object.fromEntries(accessKeys.cost.map((permission) => [permission, can(permission, context)]));
  }
  for (const row of visibleMaintenanceRows) {
    const context = maintenanceContext(row);
    objectAccess.maintenance[row.id] = Object.fromEntries(accessKeys.maintenance.map((permission) => [permission, can(permission, context)]));
  }

  const anyObject = (type, permission) => Object.values(objectAccess[type]).some((entry) => entry[permission]);
  const moduleAccess = {
    vehicles_view: can('vehicles_view') || anyObject('vehicle', 'vehicles_view'),
    vehicles_manage: can('vehicles_manage') || anyObject('vehicle', 'vehicles_manage'),
    drivers_view: can('drivers_view') || anyObject('driver', 'drivers_view'),
    drivers_manage: can('drivers_manage') || anyObject('driver', 'drivers_manage'),
    bookings_view: can('bookings_view') || anyObject('booking', 'bookings_view') || anyObject('vehicle', 'bookings_view') || anyObject('driver', 'bookings_view'),
    bookings_create: can('bookings_create') || anyObject('vehicle', 'bookings_create') || anyObject('driver', 'bookings_create'),
    bookings_manage: can('bookings_manage') || anyObject('booking', 'bookings_manage') || anyObject('vehicle', 'bookings_manage') || anyObject('driver', 'bookings_manage'),
    logbook_view: can('logbook_view') || anyObject('booking', 'logbook_view') || anyObject('vehicle', 'logbook_view') || anyObject('driver', 'logbook_view'),
    logbook_manage: can('logbook_manage') || anyObject('booking', 'logbook_manage') || anyObject('vehicle', 'logbook_manage') || anyObject('driver', 'logbook_manage'),
    logbook_export: can('logbook_export'),
    maintenance_view: can('maintenance_view') || anyObject('maintenance', 'maintenance_view') || anyObject('vehicle', 'maintenance_view'),
    maintenance_manage: can('maintenance_manage') || anyObject('maintenance', 'maintenance_manage') || anyObject('vehicle', 'maintenance_manage'),
    costs_view: can('costs_view') || anyObject('cost', 'costs_view') || anyObject('vehicle', 'costs_view'),
    costs_manage: can('costs_manage') || anyObject('cost', 'costs_manage') || anyObject('vehicle', 'costs_manage'),
    own_trips_view: Boolean(linkedDriverRow) && can('own_trips_view', linkedDriverRow ? { driver: linkedDriverRow } : {}),
    own_trips_request: Boolean(linkedDriverRow) && can('own_trips_request', linkedDriverRow ? { driver: linkedDriverRow } : {}),
    own_trips_execute: Boolean(linkedDriverRow) && can('own_trips_execute', linkedDriverRow ? { driver: linkedDriverRow } : {}),
    booking_requests_manage: isPrivileged || can('booking_requests_manage'),
    users_manage: isPrivileged || can('users_manage'),
    roles_manage: isPrivileged || can('roles_manage'),
    settings_manage: can('settings_manage'),
    branding_manage: can('branding_manage'),
    cost_centers_view: can('cost_centers_view'),
    cost_centers_manage: can('cost_centers_manage'),
    export_data: can('export_data')
  };

  if (moduleAccess.vehicles_manage) moduleAccess.vehicles_view = true;
  if (moduleAccess.drivers_manage) moduleAccess.drivers_view = true;
  if (moduleAccess.bookings_create || moduleAccess.bookings_manage) moduleAccess.bookings_view = true;
  if (moduleAccess.logbook_manage) moduleAccess.logbook_view = true;
  if (moduleAccess.maintenance_manage) moduleAccess.maintenance_view = true;
  if (moduleAccess.costs_manage) moduleAccess.costs_view = true;
  if (moduleAccess.cost_centers_manage) moduleAccess.cost_centers_view = true;

  let ownTrips = null;
  if (moduleAccess.own_trips_view && linkedDriverRow) {
    const ownBookings = bookingRows
      .filter((row) => row.driver_id === linkedDriverRow.id && ['planned', 'active', 'completed'].includes(row.status))
      .sort((a, b) => String(b.start_at).localeCompare(String(a.start_at)) || String(b.id).localeCompare(String(a.id)))
      .map((row) => mapOwnTrip(row, vehicleById.get(row.vehicle_id), costCenterFor(row)));
    const ownRequestRows = db.prepare(`
      SELECT * FROM booking_requests
      WHERE requested_by = ?
      ORDER BY created_at DESC, id DESC
    `).all(user.id);
    ownTrips = {
      driver: {
        id: linkedDriverRow.id,
        name: linkedDriverRow.name,
        role: linkedDriverRow.role,
        color: linkedDriverRow.color,
        ...costCenterFields(linkedDriverRow, costCenterFor(linkedDriverRow))
      },
      canRequest: moduleAccess.own_trips_request,
      canExecute: moduleAccess.own_trips_execute,
      vehicles: ownTripVehicleRows.map((row) => mapMinimalVehicle(row, costCenterFor(row))),
      bookings: ownBookings,
      requests: ownRequestRows.map((row) => mapBookingRequest(row, {
        vehicle: vehicleById.get(row.vehicle_id),
        costCenter: costCenterFor(row)
      }))
    };
  }

  let bookingRequests = [];
  if (moduleAccess.booking_requests_manage) {
    const requesterById = new Map(
      db.prepare('SELECT id, name, role FROM users').all().map((row) => [row.id, row])
    );
    bookingRequests = db.prepare(`
      SELECT * FROM booking_requests
      WHERE status = 'requested'
      ORDER BY created_at, id
    `).all()
      .filter((row) => isRequestVisibleToApprover(db, user, row, requesterById.get(row.requested_by), { isAdmin }))
      .map((row) => mapBookingRequest(row, {
        vehicle: vehicleById.get(row.vehicle_id),
        driver: driverById.get(row.driver_id),
        requester: requesterById.get(row.requested_by),
        costCenter: costCenterFor(row)
      }));
  }

  const notificationReads = db.prepare('SELECT alert_key FROM notification_reads WHERE user_id = ?').all(user.id).map((row) => row.alert_key);

  const state = {
    meta: {
      version: 1,
      seededAt: settingsRow?.seeded_at || null
    },
    settings: {
      orgName: settingsRow?.org_name || 'AWO Bremerhaven',
      brandName: settingsRow?.brand_name || '',
      location: settingsRow?.location || 'Bremerhaven',
      email: settingsRow?.email || '',
      phone: settingsRow?.phone || '',
      theme: settingsRow?.theme === 'neutral' ? 'neutral' : 'awo',
      accentColor: settingsRow?.accent_color || '#0f766e',
      sidebarStyle: settingsRow?.sidebar_style === 'light' ? 'light' : 'dark',
      pageBackground: settingsRow?.page_background || '#f4f5f7',
      surfaceColor: settingsRow?.surface_color || '#ffffff',
      textColor: settingsRow?.text_color || '#191c23',
      mutedColor: settingsRow?.muted_color || '#737a88',
      borderColor: settingsRow?.border_color || '#e7e9ee',
      defaultColorMode,
      autoAnonymizeDays: Number(settingsRow?.auto_anonymize_days) || 0,
      logoUrl: settingsRow?.logo_file
        ? `/branding/logo?v=${encodeURIComponent(settingsRow.updated_at || '')}`
        : null
    },
    access: {
      modules: moduleAccess,
      objects: objectAccess
    },
    vehicles: visibleVehicleRows.map((row) => mapVehicle(row, costCenterFor(row))),
    drivers: visibleDriverRows.map((row) => mapDriver(row, costCenterFor(row))),
    bookings: visibleBookingRows.map((row) => mapBooking(
      row,
      vehicleById.get(row.vehicle_id),
      driverById.get(row.driver_id),
      costCenterFor(row)
    )),
    maintenance: visibleMaintenanceRows.map(mapMaintenance),
    costs: visibleCostRows.map((row) => mapCost(row, costCenterFor(row))),
    ownTrips,
    bookingRequests,
    notificationReads
  };

  const ownMfa = mfaByUserId.get(user.id) || null;
  state.security = {
    totpEnabled: Number(ownMfa?.totp_enabled) === 1,
    confirmedAt: ownMfa?.totp_confirmed_at || null,
    lastVerifiedAt: ownMfa?.last_verified_at || null,
    recoveryCodesRemaining: recoveryCountByUserId.get(user.id) || 0,
    lockedUntil: ownMfa?.locked_until || null
  };

  if (moduleAccess.cost_centers_view) {
    state.costCenters = costCenterRows.map(mapCostCenter);
  }

  if (isPrivileged) {
    state.smtp = getPublicSmtpConfig(db);
  }

  const canManageUsers = isPrivileged || can('users_manage');
  const canManageRoles = isPrivileged || can('roles_manage');
  moduleAccess.users_manage = canManageUsers;
  moduleAccess.roles_manage = canManageRoles;

  const roleRows = db.prepare(`
    SELECT id, name, permissions, object_permissions, booking_request_policy, is_system, rank, created_at, updated_at
    FROM roles ORDER BY rank DESC, is_system DESC, name
  `).all();
  const visibleRoleRows = roleRows.filter((row) => row.id !== SUPERADMIN_ROLE_ID);
  const roleRankById = new Map(roleRows.map((row) => [row.id, Number(row.rank) || 0]));
  const userCountByRole = new Map(
    db.prepare('SELECT role, COUNT(*) AS count FROM users WHERE id <> ? AND role <> ? GROUP BY role')
      .all(SUPERADMIN_USER_ID, SUPERADMIN_ROLE_ID)
      .map((row) => [row.role, Number(row.count) || 0])
  );
  const mapRoleState = (row) => ({
    id: row.id,
    name: row.name,
    permissions: parsePermissions(row.permissions),
    objectPermissions: parseObjectPermissions(row.object_permissions),
    bookingRequestPolicy: parseBookingRequestPolicy(row.booking_request_policy),
    isSystem: Boolean(row.is_system),
    rank: Number(row.rank) || 0,
    userCount: userCountByRole.get(row.id) || 0
  });
  const actorRank = roleRankById.get(user.role) || 0;
  const mapStateUser = (row) => {
    const linkedDriver = driverByUserId.get(row.id) || null;
    const mfa = mfaByUserId.get(row.id) || null;
    const mfaEnabled = Number(mfa?.totp_enabled) === 1;
    const targetRank = roleRankById.get(row.role) || 0;
    return {
      ...mapUser(row, costCenterFor(row), defaultColorMode),
      roleRank: targetRank,
      driverId: linkedDriver?.id || null,
      driverName: linkedDriver?.name || '',
      ownTripsAccess: linkedDriver ? Number(linkedDriver.own_trips_access) !== 0 : null,
      mfaEnabled,
      mfaConfirmedAt: mfa?.totp_confirmed_at || null,
      mfaLastVerifiedAt: mfa?.last_verified_at || null,
      canResetMfa: mfaEnabled
        && isPrivileged
        && row.id !== user.id
        && (isSuperadmin || (row.role !== 'admin' && targetRank < actorRank))
    };
  };

  if (isPrivileged) {
    state.users = db.prepare(`
      SELECT id, email, name, role, permission_overrides, object_permissions, active, cost_center_id, color_mode, last_login_at, deactivated_at, anonymized_at, created_at, updated_at
      FROM users WHERE id <> ? AND role <> ? ORDER BY created_at, name
    `).all(SUPERADMIN_USER_ID, SUPERADMIN_ROLE_ID).map(mapStateUser);
    state.roles = visibleRoleRows.map(mapRoleState);
  } else if (canManageUsers || canManageRoles) {
    const actorRank = roleRankById.get(user.role) || 0;
    state.roles = visibleRoleRows
      .filter((role) => role.id === user.role || (Number(role.rank) || 0) < actorRank)
      .map(mapRoleState);
    if (canManageUsers) {
      state.users = db.prepare(`
        SELECT id, email, name, role, permission_overrides, object_permissions, active, cost_center_id, color_mode, last_login_at, deactivated_at, anonymized_at, created_at, updated_at
        FROM users WHERE id <> ? AND role <> ? ORDER BY created_at, name
      `).all(SUPERADMIN_USER_ID, SUPERADMIN_ROLE_ID)
        .map(mapStateUser)
        .filter((entry) => entry.id === user.id || entry.roleRank < actorRank);
    }
  }

  if (canManageUsers) {
    state.driversForLinking = driverRows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      department: row.department,
      linkedUserId: row.user_id || null
    }));
  }

  return state;
}

module.exports = {
  getState,
  mapVehicle,
  mapDriver,
  mapBooking,
  mapMaintenance,
  mapCost,
  mapUser
};

