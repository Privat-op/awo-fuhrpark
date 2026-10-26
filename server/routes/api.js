'use strict';

const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { db } = require('../db');
const { getState, mapUser } = require('../lib/state');
const {
  HttpError,
  requiredString,
  optionalString,
  optionalDate,
  requiredDate,
  intValue,
  numericValue,
  emailValue,
  oneOf,
  hexColorValue,
  licensesValue,
  booleanValue,
  isoNow,
  todayISO,
  combineDateTime
} = require('../lib/validation');
const { storeVehicleImage, storeReceipt, deleteUpload, uploadPath } = require('../lib/files');
const { writeAudit } = require('../lib/audit');

const router = express.Router();

const VEHICLE_TYPES = ['Pkw', 'Transporter', 'Bus'];
const FUEL_TYPES = ['Diesel', 'Benzin', 'Elektro', 'Hybrid'];
const VEHICLE_STATUSES = ['available', 'in_use', 'maintenance'];
const DRIVER_STATUSES = ['available', 'away'];
const COST_CATEGORIES = ['Kraftstoff', 'Laden', 'Wartung', 'Versicherung', 'Kfz-Steuer', 'Sonstiges'];
const ROLE_VALUES = ['admin', 'manager'];
const VEHICLE_COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#059669', '#e2600f', '#0891b2', '#4338ca', '#b45309', '#be123c', '#475569'];
const DRIVER_COLORS = ['#e2001a', '#0f766e', '#7c3aed', '#2563eb', '#b45309', '#be123c', '#0f8f8a', '#4338ca'];

function sendState(req, res, status = 200) {
  res.status(status).json(getState(db, req.user));
}

function getVehicle(id) {
  return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
}

function getDriver(id) {
  return db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
}

function getCost(id) {
  return db.prepare('SELECT * FROM costs WHERE id = ?').get(id);
}

function requireAdmin(req, _res, next) {
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Nur Administratoren dürfen Benutzer verwalten.'));
  return next();
}

function audit(req, action, entityType, entityId, details = null) {
  writeAudit(db, { userId: req.user.id, action, entityType, entityId, details });
}

function ensureVehicleExists(id) {
  const vehicle = getVehicle(id);
  if (!vehicle) throw new HttpError(404, 'Fahrzeug wurde nicht gefunden.');
  return vehicle;
}

function ensureDriverExists(id) {
  const driver = getDriver(id);
  if (!driver) throw new HttpError(404, 'Fahrer:in wurde nicht gefunden.');
  return driver;
}

function formatConflictTime(value) {
  return String(value).slice(11, 16);
}

function assertBookingConflict(vehicleId, driverId, start, end, vehicleName, driverName) {
  const vehicleConflict = db.prepare(`
    SELECT id, purpose, start_at, end_at FROM bookings
    WHERE vehicle_id = ? AND status IN ('planned', 'active')
      AND start_at < ? AND end_at > ?
    ORDER BY start_at LIMIT 1
  `).get(vehicleId, end, start);
  if (vehicleConflict) {
    throw new HttpError(409, `${vehicleName} ist in diesem Zeitraum bereits von ${formatConflictTime(vehicleConflict.start_at)} bis ${formatConflictTime(vehicleConflict.end_at)} gebucht (${vehicleConflict.purpose}). Bitte wählen Sie einen anderen Zeitraum.`);
  }
  const driverConflict = db.prepare(`
    SELECT id, purpose, start_at, end_at FROM bookings
    WHERE driver_id = ? AND status IN ('planned', 'active')
      AND start_at < ? AND end_at > ?
    ORDER BY start_at LIMIT 1
  `).get(driverId, end, start);
  if (driverConflict) {
    throw new HttpError(409, `${driverName} ist in diesem Zeitraum bereits eingeplant (${driverConflict.purpose}). Bitte wählen Sie eine andere Fahrer:in.`);
  }
}

function syncVehicleStatus(vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle || vehicle.status === 'maintenance') return;
  const active = db.prepare("SELECT 1 FROM bookings WHERE vehicle_id = ? AND status = 'active' LIMIT 1").get(vehicleId);
  db.prepare('UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?')
    .run(active ? 'in_use' : 'available', isoNow(), vehicleId);
}

function mapSessionUser(user) {
  return mapUser(user);
}

/* =========================================================
   Session & Benachrichtigungen
   ========================================================= */
router.get('/session', (req, res) => {
  res.json({
    user: mapSessionUser(req.user),
    csrfToken: req.session.csrfToken,
    capabilities: {
      manageFleet: true,
      manageUsers: req.user.role === 'admin',
      viewCosts: true
    }
  });
});

router.get('/state', (req, res) => {
  sendState(req, res);
});

router.post('/auth/logout', (req, res) => {
  audit(req, 'logout', 'user', req.user.id);
  req.session.destroy((error) => {
    if (error) console.warn('Session konnte beim Logout nicht gelöscht werden:', error.message);
    res.clearCookie('awo.sid');
    res.status(204).end();
  });
});

router.post('/auth/password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = passwordValue(req.body?.newPassword);
    const valid = await bcrypt.compare(currentPassword, req.user.password_hash);
    if (!valid) throw new HttpError(400, 'Das aktuelle Passwort ist nicht korrekt.');
    const now = isoNow();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(bcrypt.hashSync(newPassword, 12), now, req.user.id);
    // Alle anderen Sitzungen dieses Kontos beenden, die aktuelle Sitzung bleibt bestehen.
    db.prepare("DELETE FROM sessions WHERE sid <> ? AND json_extract(sess, '$.userId') = ?").run(req.sessionID, req.user.id);
    audit(req, 'change_password', 'user', req.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/read', (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const validKeys = [...new Set(keys.map(String).filter((key) => key.length > 0 && key.length <= 200))].slice(0, 250);
  if (!validKeys.length) return sendState(req, res);
  const now = isoNow();
  const insert = db.prepare('INSERT INTO notification_reads (user_id, alert_key, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, alert_key) DO NOTHING');
  const transaction = db.transaction(() => {
    validKeys.forEach((key) => insert.run(req.user.id, key, now));
  });
  transaction();
  sendState(req, res);
});

/* =========================================================
   Fahrzeuge
   ========================================================= */
function parseVehiclePayload(body) {
  const name = requiredString(body.name, 'Bezeichnung', { max: 120 });
  const plate = requiredString(body.plate, 'Kennzeichen', { max: 30 }).toUpperCase();
  return {
    name,
    plate,
    type: oneOf(body.type, VEHICLE_TYPES, 'Fahrzeugtyp'),
    fuel: oneOf(body.fuel, FUEL_TYPES, 'Kraftstoff'),
    seats: intValue(body.seats ?? 5, 'Sitzplätze', { min: 1, max: 100, required: true }),
    status: oneOf(body.status || 'available', VEHICLE_STATUSES, 'Status'),
    location: optionalString(body.location, { max: 160 }),
    department: optionalString(body.department, { max: 160 }),
    mileage: intValue(body.mileage ?? 0, 'Kilometerstand', { min: 0, max: 10_000_000, required: true }),
    nextService: optionalDate(body.nextService, 'Nächste Inspektion'),
    tuv: optionalDate(body.tuv, 'HU/AU'),
    insurance: optionalString(body.insurance, { max: 160 }),
    notes: optionalString(body.notes, { max: 1000 }),
    color: hexColorValue(body.color, VEHICLE_COLORS[db.prepare('SELECT COUNT(*) AS count FROM vehicles').get().count % VEHICLE_COLORS.length])
  };
}

router.post('/vehicles', async (req, res, next) => {
  let imageFile = null;
  try {
    const values = parseVehiclePayload(req.body || {});
    const duplicate = db.prepare('SELECT id FROM vehicles WHERE UPPER(plate) = ?').get(values.plate);
    if (duplicate) throw new HttpError(409, `Das Kennzeichen ${values.plate} ist bereits vergeben.`);
    if (req.body?.imageData) imageFile = await storeVehicleImage(req.body.imageData);

    const id = crypto.randomUUID();
    const now = isoNow();
    const activeBooking = false;
    if (activeBooking) values.status = 'in_use';
    db.prepare(`
      INSERT INTO vehicles
        (id, name, plate, type, fuel, seats, location, department, status, mileage, next_service, tuv, insurance, acquired, color, notes, image_file, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, values.name, values.plate, values.type, values.fuel, values.seats,
      values.location, values.department, values.status, values.mileage,
      values.nextService, values.tuv, values.insurance, todayISO(),
      values.color, values.notes, imageFile, now, now
    );
    audit(req, 'create', 'vehicle', id, { name: values.name, plate: values.plate });
    sendState(req, res, 201);
  } catch (error) {
    if (imageFile) deleteUpload(imageFile);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Dieses Kennzeichen ist bereits vergeben.'));
    next(error);
  }
});

router.patch('/vehicles/:id', async (req, res, next) => {
  let newImageFile = null;
  try {
    const existing = ensureVehicleExists(req.params.id);
    const values = parseVehiclePayload(req.body || {});
    const duplicate = db.prepare('SELECT id FROM vehicles WHERE UPPER(plate) = ? AND id <> ?').get(values.plate, existing.id);
    if (duplicate) throw new HttpError(409, `Das Kennzeichen ${values.plate} ist bereits vergeben.`);

    if (req.body?.imageData) newImageFile = await storeVehicleImage(req.body.imageData);
    const removeImage = booleanValue(req.body?.removeImage, false);
    const imageFile = newImageFile || (removeImage ? null : existing.image_file);

    const active = db.prepare("SELECT 1 FROM bookings WHERE vehicle_id = ? AND status = 'active' LIMIT 1").get(existing.id);
    if (active && values.status !== 'maintenance') values.status = 'in_use';

    db.prepare(`
      UPDATE vehicles SET
        name = ?, plate = ?, type = ?, fuel = ?, seats = ?, location = ?, department = ?,
        status = ?, mileage = ?, next_service = ?, tuv = ?, insurance = ?, color = ?, notes = ?,
        image_file = ?, updated_at = ?
      WHERE id = ?
    `).run(
      values.name, values.plate, values.type, values.fuel, values.seats,
      values.location, values.department, values.status, values.mileage,
      values.nextService, values.tuv, values.insurance, values.color, values.notes,
      imageFile, isoNow(), existing.id
    );
    if (existing.image_file && existing.image_file !== imageFile) deleteUpload(existing.image_file);
    audit(req, 'update', 'vehicle', existing.id, { name: values.name, plate: values.plate });
    sendState(req, res);
  } catch (error) {
    if (newImageFile) deleteUpload(newImageFile);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Dieses Kennzeichen ist bereits vergeben.'));
    next(error);
  }
});

router.get('/vehicles/:id/image', (req, res, next) => {
  try {
    const vehicle = ensureVehicleExists(req.params.id);
    if (!vehicle.image_file) throw new HttpError(404, 'Für dieses Fahrzeug ist kein Bild hinterlegt.');
    const fullPath = uploadPath(vehicle.image_file);
    if (!fullPath) throw new HttpError(404, 'Das Bild wurde nicht gefunden.');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type('image/jpeg');
    res.sendFile(fullPath);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Fahrer:innen
   ========================================================= */
function parseDriverPayload(body) {
  const email = String(body.email || '').trim();
  return {
    name: requiredString(body.name, 'Name', { max: 120 }),
    role: requiredString(body.role, 'Funktion', { max: 120 }),
    department: optionalString(body.department, { max: 160 }),
    phone: optionalString(body.phone, { max: 80 }),
    email: email ? emailValue(email, 'E-Mail') : '',
    license: licensesValue(body.license),
    status: oneOf(body.status || 'available', DRIVER_STATUSES, 'Status'),
    color: hexColorValue(body.color, DRIVER_COLORS[db.prepare('SELECT COUNT(*) AS count FROM drivers').get().count % DRIVER_COLORS.length])
  };
}

router.post('/drivers', (req, res, next) => {
  try {
    const values = parseDriverPayload(req.body || {});
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO drivers (id, name, role, department, phone, email, license, status, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, values.name, values.role, values.department, values.phone, values.email, JSON.stringify(values.license), values.status, values.color, now, now);
    audit(req, 'create', 'driver', id, { name: values.name });
    sendState(req, res, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/drivers/:id', (req, res, next) => {
  try {
    const existing = ensureDriverExists(req.params.id);
    const values = parseDriverPayload(req.body || {});
    db.prepare(`
      UPDATE drivers SET name = ?, role = ?, department = ?, phone = ?, email = ?, license = ?, status = ?, color = ?, updated_at = ?
      WHERE id = ?
    `).run(values.name, values.role, values.department, values.phone, values.email, JSON.stringify(values.license), values.status, values.color, isoNow(), existing.id);
    audit(req, 'update', 'driver', existing.id, { name: values.name });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Buchungen
   ========================================================= */
router.post('/bookings', (req, res, next) => {
  try {
    const body = req.body || {};
    const vehicleId = requiredString(body.vehicleId, 'Fahrzeug');
    const driverId = requiredString(body.driverId, 'Fahrer:in');
    const purpose = requiredString(body.purpose, 'Einsatzzweck', { max: 200 });
    const date = requiredDate(body.date, 'Datum');
    const startTime = String(body.startTime || '');
    const endTime = String(body.endTime || '');
    const start = combineDateTime(date, startTime, 'Start');
    const end = combineDateTime(date, endTime, 'Ende');
    if (end <= start) throw new HttpError(400, 'Das Ende der Buchung muss nach dem Beginn liegen.');
    const vehicle = ensureVehicleExists(vehicleId);
    const driver = ensureDriverExists(driverId);
    if (vehicle.status === 'maintenance') throw new HttpError(409, `${vehicle.name} befindet sich in Wartung.`);
    if (driver.status === 'away') throw new HttpError(409, `${driver.name} ist aktuell abwesend.`);
    assertBookingConflict(vehicle.id, driver.id, start, end, vehicle.name, driver.name);

    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?)
    `).run(id, vehicle.id, driver.id, purpose, start, end, optionalString(body.notes, { max: 1000 }), req.user.id, now, now);
    audit(req, 'create', 'booking', id, { purpose, vehicleId, driverId, start, end });
    sendState(req, res, 201);
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:id/start', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
      if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
      if (booking.status !== 'planned') throw new HttpError(409, 'Nur geplante Fahrten können gestartet werden.');
      const vehicle = ensureVehicleExists(booking.vehicle_id);
      if (vehicle.status === 'maintenance') throw new HttpError(409, `${vehicle.name} befindet sich in Wartung.`);
      const activeVehicle = db.prepare("SELECT id FROM bookings WHERE vehicle_id = ? AND status = 'active' AND id <> ? LIMIT 1").get(vehicle.id, booking.id);
      if (activeVehicle) throw new HttpError(409, 'Für dieses Fahrzeug läuft bereits eine andere Fahrt.');
      const activeDriver = db.prepare("SELECT id FROM bookings WHERE driver_id = ? AND status = 'active' AND id <> ? LIMIT 1").get(booking.driver_id, booking.id);
      if (activeDriver) throw new HttpError(409, 'Diese Fahrer:in ist bereits in einer anderen Fahrt.');
      const now = isoNow();
      const startKm = booking.start_km ?? vehicle.mileage;
      db.prepare("UPDATE bookings SET status = 'active', start_km = ?, updated_at = ? WHERE id = ?").run(startKm, now, booking.id);
      db.prepare("UPDATE vehicles SET status = 'in_use', updated_at = ? WHERE id = ?").run(now, vehicle.id);
      audit(req, 'start', 'booking', booking.id, { startKm });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:id/end', (req, res, next) => {
  try {
    const endKm = intValue(req.body?.endKm, 'Endkilometerstand', { min: 0, max: 10_000_000, required: true });
    const transaction = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
      if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
      if (booking.status !== 'active') throw new HttpError(409, 'Nur aktive Fahrten können beendet werden.');
      const vehicle = ensureVehicleExists(booking.vehicle_id);
      const startKm = booking.start_km ?? vehicle.mileage;
      if (endKm < startKm) throw new HttpError(400, 'Der Endkilometerstand darf nicht kleiner als der Startkilometerstand sein.');
      const now = isoNow();
      db.prepare(`
        UPDATE bookings SET status = 'completed', start_km = ?, end_km = ?, completed_at = ?, updated_at = ? WHERE id = ?
      `).run(startKm, endKm, todayISO(), now, booking.id);
      const newMileage = Math.max(vehicle.mileage, endKm);
      const otherActive = db.prepare("SELECT 1 FROM bookings WHERE vehicle_id = ? AND status = 'active' AND id <> ? LIMIT 1").get(vehicle.id, booking.id);
      const nextStatus = vehicle.status === 'maintenance' ? 'maintenance' : otherActive ? 'in_use' : 'available';
      db.prepare('UPDATE vehicles SET mileage = ?, status = ?, updated_at = ? WHERE id = ?').run(newMileage, nextStatus, now, vehicle.id);
      audit(req, 'complete', 'booking', booking.id, { startKm, endKm, distance: endKm - startKm });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/bookings/:id/cancel', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
      if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
      if (!['planned', 'active'].includes(booking.status)) throw new HttpError(409, 'Diese Buchung kann nicht storniert werden.');
      const now = isoNow();
      db.prepare("UPDATE bookings SET status = 'canceled', updated_at = ? WHERE id = ?").run(now, booking.id);
      if (booking.status === 'active') syncVehicleStatus(booking.vehicle_id);
      audit(req, 'cancel', 'booking', booking.id, { purpose: booking.purpose });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.delete('/bookings/:id', (req, res, next) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) throw new HttpError(404, 'Buchung wurde nicht gefunden.');
    if (booking.status !== 'canceled') throw new HttpError(409, 'Nur stornierte Buchungen können gelöscht werden.');
    db.prepare('DELETE FROM bookings WHERE id = ?').run(booking.id);
    audit(req, 'delete', 'booking', booking.id, { purpose: booking.purpose });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.post('/trips', (req, res, next) => {
  try {
    const body = req.body || {};
    const vehicle = ensureVehicleExists(requiredString(body.vehicleId, 'Fahrzeug'));
    const driver = ensureDriverExists(requiredString(body.driverId, 'Fahrer:in'));
    const date = requiredDate(body.date, 'Datum');
    const start = combineDateTime(date, String(body.startTime || ''), 'Start');
    const end = combineDateTime(date, String(body.endTime || ''), 'Ende');
    if (end <= start) throw new HttpError(400, 'Die Ankunftszeit muss nach der Abfahrtszeit liegen.');
    const startKm = intValue(body.startKm, 'Startkilometerstand', { min: 0, max: 10_000_000, required: true });
    const endKm = intValue(body.endKm, 'Endkilometerstand', { min: 0, max: 10_000_000, required: true });
    if (endKm < startKm) throw new HttpError(400, 'Der Endkilometerstand muss grö�xer oder gleich dem Startkilometerstand sein.');

    const transaction = db.transaction(() => {
      const id = crypto.randomUUID();
      const now = isoNow();
      db.prepare(`
        INSERT INTO bookings (id, vehicle_id, driver_id, purpose, start_at, end_at, status, start_km, end_km, notes, created_by, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
      `).run(id, vehicle.id, driver.id, requiredString(body.purpose, 'Zweck der Fahrt', { max: 200 }), start, end, startKm, endKm, optionalString(body.notes, { max: 1000 }), req.user.id, date, now, now);
      if (endKm > vehicle.mileage) {
        db.prepare('UPDATE vehicles SET mileage = ?, updated_at = ? WHERE id = ?').run(endKm, now, vehicle.id);
      }
      audit(req, 'create', 'trip', id, { vehicleId: vehicle.id, driverId: driver.id, startKm, endKm });
    });
    transaction();
    sendState(req, res, 201);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Wartung
   ========================================================= */
router.post('/maintenance', (req, res, next) => {
  try {
    const body = req.body || {};
    const vehicle = ensureVehicleExists(requiredString(body.vehicleId, 'Fahrzeug'));
    const title = requiredString(body.title, 'Ma�xnahme', { max: 160 });
    const dueDate = requiredDate(body.dueDate, 'Fälligkeitsdatum');
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO maintenance (id, vehicle_id, title, due_date, workshop, cost, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
    `).run(id, vehicle.id, title, dueDate, optionalString(body.workshop, { max: 160 }), numericValue(body.cost ?? 0, 'Geschätzte Kosten', { min: 0, max: 1_000_000 }), optionalString(body.notes, { max: 1000 }), now, now);
    audit(req, 'create', 'maintenance', id, { vehicleId: vehicle.id, title });
    sendState(req, res, 201);
  } catch (error) {
    next(error);
  }
});

router.post('/maintenance/:id/done', (req, res, next) => {
  try {
    const transaction = db.transaction(() => {
      const item = db.prepare('SELECT * FROM maintenance WHERE id = ?').get(req.params.id);
      if (!item) throw new HttpError(404, 'Wartung wurde nicht gefunden.');
      if (item.completed_at || item.status === 'done') throw new HttpError(409, 'Diese Wartung ist bereits erledigt.');
      const vehicle = ensureVehicleExists(item.vehicle_id);
      const now = isoNow();
      db.prepare("UPDATE maintenance SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(todayISO(), now, item.id);
      let costId = null;
      if (Number(item.cost) > 0) {
        costId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO costs (id, vehicle_id, date, category, amount, note, created_by, created_at, updated_at)
          VALUES (?, ?, ?, 'Wartung', ?, ?, ?, ?, ?)
        `).run(costId, vehicle.id, todayISO(), Number(item.cost), `${item.title}${item.workshop ? ` · ${item.workshop}` : ''}`, req.user.id, now, now);
      }
      if (vehicle.status === 'maintenance') {
        const stillOpen = db.prepare('SELECT 1 FROM maintenance WHERE vehicle_id = ? AND completed_at IS NULL AND id <> ? LIMIT 1').get(vehicle.id, item.id);
        if (!stillOpen) syncVehicleStatus(vehicle.id);
      }
      audit(req, 'complete', 'maintenance', item.id, { title: item.title, costId });
    });
    transaction();
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Kosten & Belege
   ========================================================= */
router.post('/costs', async (req, res, next) => {
  let receipt = null;
  try {
    const body = req.body || {};
    const vehicle = ensureVehicleExists(requiredString(body.vehicleId, 'Fahrzeug'));
    const date = requiredDate(body.date, 'Datum');
    const category = oneOf(body.category, COST_CATEGORIES, 'Kostenart');
    const amount = numericValue(body.amount, 'Betrag', { min: 0.01, max: 10_000_000 });
    const note = optionalString(body.note, { max: 300 });
    if (body.receipt) receipt = await storeReceipt(body.receipt);
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO costs
        (id, vehicle_id, date, category, amount, note, receipt_file, receipt_name, receipt_mime, receipt_size, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, vehicle.id, date, category, amount, note,
      receipt?.file || null, receipt?.name || null, receipt?.mime || null, receipt?.size || null,
      req.user.id, now, now
    );
    audit(req, 'create', 'cost', id, { vehicleId: vehicle.id, category, amount });
    sendState(req, res, 201);
  } catch (error) {
    if (receipt?.file) deleteUpload(receipt.file);
    next(error);
  }
});

router.delete('/costs/:id', (req, res, next) => {
  try {
    const cost = getCost(req.params.id);
    if (!cost) throw new HttpError(404, 'Kostenposition wurde nicht gefunden.');
    db.prepare('DELETE FROM costs WHERE id = ?').run(cost.id);
    if (cost.receipt_file) deleteUpload(cost.receipt_file);
    audit(req, 'delete', 'cost', cost.id, { category: cost.category, amount: cost.amount });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

router.get('/costs/:id/receipt', (req, res, next) => {
  try {
    const cost = getCost(req.params.id);
    if (!cost || !cost.receipt_file) throw new HttpError(404, 'Für diese Kostenposition ist kein Beleg hinterlegt.');
    const fullPath = uploadPath(cost.receipt_file);
    if (!fullPath) throw new HttpError(404, 'Der Beleg wurde nicht gefunden.');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(cost.receipt_name || 'beleg')}`);
    res.type(cost.receipt_mime || 'application/octet-stream');
    res.sendFile(fullPath);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Einstellungen
   ========================================================= */
router.patch('/settings', (req, res, next) => {
  try {
    const body = req.body || {};
    const orgName = requiredString(body.orgName, 'Name der Einrichtung', { max: 160 });
    db.prepare(`
      UPDATE settings SET org_name = ?, location = ?, email = ?, phone = ?, updated_at = ? WHERE id = 1
    `).run(
      orgName,
      optionalString(body.location, { max: 160 }),
      optionalString(body.email, { max: 200 }),
      optionalString(body.phone, { max: 80 }),
      isoNow()
    );
    audit(req, 'update', 'settings', '1', { orgName });
    sendState(req, res);
  } catch (error) {
    next(error);
  }
});

/* =========================================================
   Benutzer (nur Admin)
   ========================================================= */
function passwordValue(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(400, 'Das Passwort muss mindestens 10 Zeichen lang sein.');
  }
  return password;
}

router.post('/users', requireAdmin, (req, res, next) => {
  try {
    const body = req.body || {};
    const email = emailValue(body.email, 'E-Mail');
    const name = requiredString(body.name, 'Name', { max: 120 });
    const role = oneOf(body.role, ROLE_VALUES, 'Rolle');
    const password = passwordValue(body.password);
    const duplicate = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (duplicate) throw new HttpError(409, 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    const id = crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, name, bcrypt.hashSync(password, 12), role, 1, now, now);
    audit(req, 'create', 'user', id, { email, role });
    sendState(req, res, 201);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Diese E-Mail-Adresse ist bereits vergeben.'));
    next(error);
  }
});

router.patch('/users/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) throw new HttpError(404, 'Benutzerkonto wurde nicht gefunden.');
    const body = req.body || {};
    const email = emailValue(body.email, 'E-Mail');
    const name = requiredString(body.name, 'Name', { max: 120 });
    const role = oneOf(body.role, ROLE_VALUES, 'Rolle');
    const active = booleanValue(body.active, Boolean(existing.active));
    if (existing.id === req.user.id && !active) throw new HttpError(400, 'Das eigene Konto kann nicht deaktiviert werden.');
    if (existing.role === 'admin' && existing.active && (role !== 'admin' || !active)) {
      const otherAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(existing.id).count;
      if (otherAdmins === 0) throw new HttpError(400, 'Mindestens ein aktives Administratorkonto muss bestehen bleiben.');
    }
    const duplicate = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?').get(email, existing.id);
    if (duplicate) throw new HttpError(409, 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
    const password = body.password ? passwordValue(body.password) : null;
    const now = isoNow();
    if (password) {
      db.prepare(`
        UPDATE users SET email = ?, name = ?, role = ?, active = ?, password_hash = ?, updated_at = ? WHERE id = ?
      `).run(email, name, role, active ? 1 : 0, bcrypt.hashSync(password, 12), now, existing.id);
    } else {
      db.prepare(`
        UPDATE users SET email = ?, name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?
      `).run(email, name, role, active ? 1 : 0, now, existing.id);
    }
    if (password || !active) {
      db.prepare("DELETE FROM sessions WHERE sid <> ? AND json_extract(sess, '$.userId') = ?").run(req.sessionID, existing.id);
    }
    audit(req, 'update', 'user', existing.id, { email, role, active, passwordChanged: Boolean(password) });
    sendState(req, res);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return next(new HttpError(409, 'Diese E-Mail-Adresse ist bereits vergeben.'));
    next(error);
  }
});

module.exports = router;

