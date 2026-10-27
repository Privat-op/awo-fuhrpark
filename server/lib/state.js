'use strict';

function mapVehicle(row) {
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
    image: row.image_file ? `/api/vehicles/${encodeURIComponent(row.id)}/image?v=${version}` : ''
  };
}

function mapDriver(row) {
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
    color: row.color
  };
}

function mapBooking(row, vehicle = null, driver = null) {
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

function mapCost(row) {
  const version = encodeURIComponent(row.updated_at || '');
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.date,
    category: row.category,
    amount: Number(row.amount) || 0,
    note: row.note,
    receipt: row.receipt_file ? {
      name: row.receipt_name || 'Beleg',
      type: row.receipt_mime || 'application/octet-stream',
      size: row.receipt_size || 0,
      url: `/api/costs/${encodeURIComponent(row.id)}/receipt?v=${version}`
    } : null
  };
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    permissionOverrides: parsePermissionOverrides(row.permission_overrides),
    objectPermissions: parseObjectPermissions(row.object_permissions),
    active: Boolean(row.active),
    lastLoginAt: row.last_login_at,
    deactivatedAt: row.deactivated_at || null,
    anonymizedAt: row.anonymized_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const { parsePermissions, parsePermissionOverrides, parseObjectPermissions, resolvePermission } = require('./permissions');

function getState(db, user, auth = null) {
  const layers = auth || {
    isAdmin: user.role === 'admin',
    rolePermissions: new Set(),
    roleObjectPermissions: {},
    userPermissionOverrides: { allow: [], deny: [] },
    userObjectPermissions: {}
  };
  const isAdmin = Boolean(layers.isAdmin);
  const can = (permission, context = {}) => resolvePermission(layers, permission, context);
  const settingsRow = db.prepare('SELECT * FROM settings WHERE id = 1').get();

  const vehicleRows = db.prepare('SELECT * FROM vehicles ORDER BY created_at, id').all();
  const driverRows = db.prepare('SELECT * FROM drivers ORDER BY created_at, id').all();
  const bookingRows = db.prepare('SELECT * FROM bookings ORDER BY start_at, id').all();
  const maintenanceRows = db.prepare('SELECT * FROM maintenance ORDER BY due_date, id').all();
  const costRows = db.prepare('SELECT * FROM costs ORDER BY date DESC, id DESC').all();

  const vehicleById = new Map(vehicleRows.map((row) => [row.id, row]));
  const driverById = new Map(driverRows.map((row) => [row.id, row]));
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
    settings_manage: can('settings_manage'),
    branding_manage: can('branding_manage'),
    export_data: can('export_data')
  };

  if (moduleAccess.vehicles_manage) moduleAccess.vehicles_view = true;
  if (moduleAccess.drivers_manage) moduleAccess.drivers_view = true;
  if (moduleAccess.bookings_create || moduleAccess.bookings_manage) moduleAccess.bookings_view = true;
  if (moduleAccess.logbook_manage) moduleAccess.logbook_view = true;
  if (moduleAccess.maintenance_manage) moduleAccess.maintenance_view = true;
  if (moduleAccess.costs_manage) moduleAccess.costs_view = true;

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
      autoAnonymizeDays: Number(settingsRow?.auto_anonymize_days) || 0,
      logoUrl: settingsRow?.logo_file
        ? `/branding/logo?v=${encodeURIComponent(settingsRow.updated_at || '')}`
        : null
    },
    access: {
      modules: moduleAccess,
      objects: objectAccess
    },
    vehicles: visibleVehicleRows.map(mapVehicle),
    drivers: visibleDriverRows.map(mapDriver),
    bookings: visibleBookingRows.map((row) => mapBooking(row, vehicleById.get(row.vehicle_id), driverById.get(row.driver_id))),
    maintenance: visibleMaintenanceRows.map(mapMaintenance),
    costs: visibleCostRows.map(mapCost),
    notificationReads
  };

  if (isAdmin) {
    state.users = db.prepare(`
      SELECT id, email, name, role, permission_overrides, object_permissions, active, last_login_at, deactivated_at, anonymized_at, created_at, updated_at
      FROM users ORDER BY created_at, name
    `).all().map(mapUser);
    const roleRows = db.prepare(`
      SELECT id, name, permissions, object_permissions, is_system, created_at, updated_at
      FROM roles ORDER BY is_system DESC, name
    `).all();
    state.roles = roleRows.map((row) => ({
      id: row.id,
      name: row.name,
      permissions: parsePermissions(row.permissions),
      objectPermissions: parseObjectPermissions(row.object_permissions),
      isSystem: Boolean(row.is_system),
      userCount: state.users.filter((entry) => entry.role === row.id).length
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
