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

function mapBooking(row) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
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
    active: Boolean(row.active),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getState(db, user) {
  const settingsRow = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  const vehicles = db.prepare('SELECT * FROM vehicles ORDER BY created_at, id').all().map(mapVehicle);
  const drivers = db.prepare('SELECT * FROM drivers ORDER BY created_at, id').all().map(mapDriver);
  const bookings = db.prepare('SELECT * FROM bookings ORDER BY start_at, id').all().map(mapBooking);
  const maintenance = db.prepare('SELECT * FROM maintenance ORDER BY due_date, id').all().map(mapMaintenance);
  const costs = db.prepare('SELECT * FROM costs ORDER BY date DESC, id DESC').all().map(mapCost);
  const notificationReads = db.prepare('SELECT alert_key FROM notification_reads WHERE user_id = ?').all(user.id).map((row) => row.alert_key);

  const state = {
    meta: {
      version: 1,
      seededAt: settingsRow?.seeded_at || null
    },
    settings: {
      orgName: settingsRow?.org_name || 'AWO Bremerhaven',
      location: settingsRow?.location || 'Bremerhaven',
      email: settingsRow?.email || '',
      phone: settingsRow?.phone || ''
    },
    vehicles,
    drivers,
    bookings,
    maintenance,
    costs,
    notificationReads
  };

  if (user.role === 'admin') {
    state.users = db.prepare(`
      SELECT id, email, name, role, active, last_login_at, created_at, updated_at
      FROM users ORDER BY created_at, name
    `).all().map(mapUser);
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
