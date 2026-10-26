'use strict';

/* =========================================================
   Darstellung der Seiten
   ========================================================= */

function pageHead(eyebrow, title, subtitle, actions = '') {
  return `
    <div class="page-head">
      <div class="page-head-copy">
        <span class="eyebrow">${eyebrow}</span>
        <h2>${title}</h2>
        ${subtitle ? `<p class="page-sub">${subtitle}</p>` : ''}
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </div>`;
}

function emptyState(iconName, title, text, action = '', small = false) {
  return `
    <div class="empty ${small ? 'empty-sm' : ''}">
      <span class="empty-icon">${icon(iconName)}</span>
      <strong>${title}</strong>
      <span>${text}</span>
      ${action}
    </div>`;
}

function metricCard({ label, value, sub, iconName, tint = 'tint-red', badge = '', glow = 'rgba(226,0,26,.055)' }) {
  return `
    <article class="kpi" style="--kpi-glow:${glow}">
      <div class="kpi-top">
        <span class="kpi-icon ${tint}">${icon(iconName)}</span>
        ${badge}
      </div>
      <p class="kpi-label">${label}</p>
      <p class="kpi-value">${value}</p>
      <p class="kpi-sub">${sub}</p>
    </article>`;
}

function statusBadge(status, type = 'booking') {
  const meta = (type === 'vehicle' ? VEHICLE_STATUS : BOOKING_STATUS)[status] || { label: status, badge: 'gray' };
  return `<span class="badge badge-${meta.badge}">${meta.label}</span>`;
}

function vehicleDot(vehicle) {
  return `<span class="vehicle-dot" style="--dot:${vehicle ? vehicle.color : '#cbd2dc'}"></span>`;
}

function driverAvatar(driver, size = '') {
  if (!driver) return `<span class="avatar ${size}">?</span>`;
  return `<span class="avatar ${size}" style="color:${driver.color};background:${hexToRgba(driver.color, 0.12)}">${esc(initials(driver.name))}</span>`;
}

function getVehicleBookingCount(vehicleId, onlyUpcoming = false) {
  const today = todayISO();
  return db.bookings.filter((booking) => {
    if (booking.vehicleId !== vehicleId || booking.status === 'canceled') return false;
    if (!onlyUpcoming) return true;
    return booking.start.slice(0, 10) >= today && ['planned', 'active'].includes(booking.status);
  }).length;
}

/* =========================================================
   Fahrzeug-Illustrationen
   ========================================================= */
function vehicleArt(type, color) {
  if (type === 'Bus') {
    return `<svg viewBox="0 0 320 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="164" cy="112" rx="128" ry="8" fill="#111827" opacity=".08"/>
      <path d="M35 98c-6 0-10-4-10-10V55c0-9 7-16 16-16h205c10 0 19 4 25 11l20 24c4 4 5 8 5 13v4c0 4-4 7-8 7H35z" fill="${color}"/>
      <rect x="45" y="49" width="36" height="23" rx="3" fill="#fff" opacity=".9"/>
      <rect x="87" y="49" width="36" height="23" rx="3" fill="#fff" opacity=".9"/>
      <rect x="129" y="49" width="36" height="23" rx="3" fill="#fff" opacity=".9"/>
      <rect x="171" y="49" width="36" height="23" rx="3" fill="#fff" opacity=".9"/>
      <rect x="213" y="49" width="26" height="23" rx="3" fill="#fff" opacity=".9"/>
      <path d="M249 42l21 22 9 8h-30V42z" fill="#fff" opacity=".9"/>
      <path d="M204 67v31M248 72v23" stroke="${hexToRgba('#ffffff', 0.4)}" stroke-width="2"/>
      <path d="M55 82h24M282 85h8" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
      <circle cx="94" cy="101" r="16" fill="#22262e"/><circle cx="94" cy="101" r="7" fill="#b6bdc7"/>
      <circle cx="248" cy="101" r="16" fill="#22262e"/><circle cx="248" cy="101" r="7" fill="#b6bdc7"/>
    </svg>`;
  }

  if (type === 'Transporter') {
    return `<svg viewBox="0 0 320 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="160" cy="112" rx="122" ry="8" fill="#111827" opacity=".08"/>
      <path d="M39 98c-5 0-9-4-9-9V55c0-7 6-13 13-13h169l48 15c13 4 22 12 27 24l4 10c2 4-1 7-5 7H39z" fill="${color}"/>
      <rect x="52" y="51" width="49" height="23" rx="3" fill="#fff" opacity=".9"/>
      <rect x="108" y="51" width="49" height="23" rx="3" fill="#fff" opacity=".9"/>
      <rect x="164" y="51" width="37" height="23" rx="3" fill="#fff" opacity=".9"/>
      <path d="M217 45l40 14 19 15h-59V45z" fill="#fff" opacity=".9"/>
      <path d="M208 42v34M164 74v23M215 72v25" stroke="${hexToRgba('#ffffff', 0.35)}" stroke-width="2"/>
      <path d="M54 83h31M274 85h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
      <circle cx="97" cy="101" r="17" fill="#22262e"/><circle cx="97" cy="101" r="7" fill="#b6bdc7"/>
      <circle cx="248" cy="101" r="17" fill="#22262e"/><circle cx="248" cy="101" r="7" fill="#b6bdc7"/>
    </svg>`;
  }

  return `<svg viewBox="0 0 320 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="164" cy="112" rx="116" ry="8" fill="#111827" opacity=".08"/>
    <path d="M45 98c-7 0-11-4-11-10v-7c0-6 4-9 10-10l23-5 20-18c4-4 9-6 15-6h51c7 0 13 2 18 7l25 22 28 5c9 2 14 7 14 14v1c0 4-3 7-7 7H45z" fill="${color}"/>
    <path d="M88 58l16-14c3-3 7-4 11-4h44c5 0 9 2 12 5l21 18H88z" fill="#fff" opacity=".9"/>
    <path d="M162 40v20" stroke="${color}" stroke-width="3.5" opacity=".68"/>
    <path d="M56 84h14M122 84h26" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>
    <path d="M276 86h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>
    <circle cx="106" cy="101" r="16" fill="#22262e"/><circle cx="106" cy="101" r="7" fill="#b6bdc7"/>
    <circle cx="238" cy="101" r="16" fill="#22262e"/><circle cx="238" cy="101" r="7" fill="#b6bdc7"/>
  </svg>`;
}

/* =========================================================
   Fahrzeuge
   ========================================================= */
function filteredVehicles() {
  const query = ui.vehicleQuery.trim().toLowerCase();
  return db.vehicles.filter((vehicle) => {
    const matchesQuery = !query || [vehicle.name, vehicle.plate, vehicle.location, vehicle.department, vehicle.type, vehicle.fuel]
      .join(' ').toLowerCase().includes(query);
    const matchesType = ui.vehicleType === 'all' || vehicle.type === ui.vehicleType;
    const matchesStatus = ui.vehicleStatus === 'all' || vehicle.status === ui.vehicleStatus;
    return matchesQuery && matchesType && matchesStatus;
  });
}

function vehicleCountText(count) {
  const total = db.vehicles.length;
  if (count === total) return `${count} ${count === 1 ? 'Fahrzeug' : 'Fahrzeuge'}`;
  return `${count} von ${total} Fahrzeugen`;
}

function renderVehicleCard(vehicle) {
  const status = VEHICLE_STATUS[vehicle.status] || VEHICLE_STATUS.available;
  const tuvDays = daysUntil(vehicle.tuv);
  const tuvAlert = tuvDays !== null && tuvDays <= 60;
  const bookedToday = db.bookings.some((booking) => booking.vehicleId === vehicle.id && booking.start.slice(0, 10) === todayISO() && booking.status !== 'canceled');
  const disabled = vehicle.status === 'maintenance';
  const hasPhoto = Boolean(vehicle.image);

  return `
    <article class="vehicle-card" style="--vehicle-soft:${hexToRgba(vehicle.color, 0.13)}">
      <div class="vehicle-visual ${hasPhoto ? 'has-photo' : ''}">
        ${hasPhoto
          ? `<img class="vehicle-photo" src="${esc(vehicle.image)}" alt="${esc(vehicle.name)}"><span class="vehicle-photo-shade"></span>`
          : `<div class="vehicle-art">${vehicleArt(vehicle.type, vehicle.color)}</div>`}
        <div class="vehicle-visual-top">
          <span class="badge badge-${status.badge}">${status.label}</span>
          <span class="vehicle-type">${icon('car')} ${esc(vehicle.type)}</span>
        </div>
      </div>
      <div class="vehicle-body">
        <div class="vehicle-title-row">
          <div>
            <h3 class="vehicle-name">${esc(vehicle.name)}</h3>
            <div class="vehicle-sub">
              <span class="plate">${esc(vehicle.plate)}</span>
              <span>·</span>
              <span>${esc(vehicle.department)}</span>
            </div>
          </div>
          ${bookedToday ? `<span class="badge badge-blue no-dot">Heute gebucht</span>` : ''}
        </div>
        <div class="vehicle-specs">
          <div class="spec">${icon('fuel')}<div><span class="spec-label">Kraftstoff</span><span class="spec-value">${esc(vehicle.fuel)}</span></div></div>
          <div class="spec">${icon('seat')}<div><span class="spec-label">Sitzplätze</span><span class="spec-value">${vehicle.seats} Plätze</span></div></div>
          <div class="spec">${icon('map-pin')}<div><span class="spec-label">Standort</span><span class="spec-value">${esc(vehicle.location)}</span></div></div>
          <div class="spec">${icon('gauge')}<div><span class="spec-label">Kilometerstand</span><span class="spec-value">${formatKm(vehicle.mileage)}</span></div></div>
        </div>
        <div class="vehicle-footer">
          <div class="vehicle-due ${tuvAlert ? 'is-alert' : ''}">
            ${icon('shield')}
            <span>${tuvDays === null ? 'HU/AU nicht hinterlegt' : tuvDays < 0 ? `HU/AU ${Math.abs(tuvDays)} Tage überfällig` : `HU/AU ${formatDate(vehicle.tuv)}`}</span>
          </div>
          <div class="vehicle-card-actions">
            <button class="btn btn-ghost btn-sm" type="button" data-action="vehicle-details" data-id="${vehicle.id}">Details</button>
            <button class="btn btn-soft btn-sm" type="button" data-action="book-vehicle" data-id="${vehicle.id}" ${disabled ? 'disabled title="Fahrzeug befindet sich in Wartung"' : ''}>${icon('calendar')} Buchen</button>
          </div>
        </div>
      </div>
    </article>`;
}

function renderVehicleGrid() {
  const vehicles = filteredVehicles();
  if (!vehicles.length) {
    return emptyState('car', 'Keine Fahrzeuge gefunden', 'Passen Sie die Suche oder die ausgewählten Filter an.', '<button class="btn btn-ghost btn-sm" type="button" data-action="reset-vehicle-filters">Filter zurücksetzen</button>');
  }
  return vehicles.map(renderVehicleCard).join('');
}

function renderVehicles() {
  const typeCount = (type) => db.vehicles.filter((vehicle) => vehicle.type === type).length;
  const available = db.vehicles.filter((vehicle) => vehicle.status === 'available').length;
  const inUse = db.vehicles.filter((vehicle) => vehicle.status === 'in_use').length;
  const maintenance = db.vehicles.filter((vehicle) => vehicle.status === 'maintenance').length;
  const count = filteredVehicles().length;

  return `
    ${pageHead('Fuhrpark', 'Fahrzeuge', `${db.vehicles.length} Fahrzeuge · ${available} verfügbar · ${inUse} unterwegs · ${maintenance} in Wartung`,
      `<button class="btn btn-ghost" type="button" data-action="new-vehicle">${icon('plus')} Fahrzeug anlegen</button>`)}
    <div class="toolbar" style="margin-bottom:16px">
      <div class="filter-tabs">
        ${[['all', 'Alle', db.vehicles.length], ['Pkw', 'Pkw', typeCount('Pkw')], ['Transporter', 'Transporter', typeCount('Transporter')], ['Bus', 'Bus', typeCount('Bus')]]
          .map(([value, label, amount]) => `<button class="filter-tab ${ui.vehicleType === value ? 'is-active' : ''}" type="button" data-action="vehicle-type" data-type="${value}">${label} <span class="count">${amount}</span></button>`).join('')}
      </div>
      <div class="toolbar-spacer"></div>
      <div class="input-icon-wrap">
        ${icon('search')}
        <input class="input" id="vehicleSearch" type="search" value="${esc(ui.vehicleQuery)}" placeholder="Fahrzeug, Kennzeichen, Standort …" aria-label="Fahrzeuge durchsuchen">
      </div>
      <select class="select filter-select" id="vehicleStatusFilter" aria-label="Nach Status filtern">
        <option value="all" ${ui.vehicleStatus === 'all' ? 'selected' : ''}>Alle Status</option>
        <option value="available" ${ui.vehicleStatus === 'available' ? 'selected' : ''}>Verfügbar</option>
        <option value="in_use" ${ui.vehicleStatus === 'in_use' ? 'selected' : ''}>Unterwegs</option>
        <option value="maintenance" ${ui.vehicleStatus === 'maintenance' ? 'selected' : ''}>In Wartung</option>
      </select>
      <span class="toolbar-label" id="vehicleCount">${vehicleCountText(count)}</span>
    </div>
    <div class="vehicle-grid" id="vehicleGrid">${renderVehicleGrid()}</div>`;
}

/* =========================================================
   Dashboard
   ========================================================= */
function getUtilizationDays(days = 7) {
  const start = todayISO();
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    const bookings = db.bookings.filter((booking) => booking.status !== 'canceled' && booking.start.slice(0, 10) === date);
    const bookedMinutes = bookings.reduce((sum, booking) => sum + durationMinutes(booking.start, booking.end), 0);
    const capacity = Math.max(1, db.vehicles.length * 8 * 60);
    return {
      date,
      bookings: bookings.length,
      minutes: bookedMinutes,
      pct: Math.min(100, Math.round((bookedMinutes / capacity) * 100))
    };
  });
}

function renderAlertItem(alert) {
  const tint = alert.severity === 'danger' ? 'tint-red' : alert.severity === 'warning' ? 'tint-amber' : 'tint-blue';
  return `
    <div class="alert-item">
      <span class="alert-icon ${tint}">${icon(alert.icon || 'alert')}</span>
      <div class="alert-body">
        <strong>${esc(alert.title)}</strong>
        <span>${esc(alert.text)}</span>
      </div>
      <a class="alert-action" href="#/${alert.route || 'wartung'}" aria-label="Hinweis ansehen">${icon('chevron-right')}</a>
    </div>`;
}

function renderOnboarding(greeting, displayName) {
  const today = todayISO();
  return `
    ${pageHead(formatDateLong(today), `${greeting}, ${esc(displayName)} <span class="wave">👋</span>`, 'Willkommen im Fuhrparkmanagement. Legen Sie jetzt die ersten Stammdaten an.',
      `<button class="btn btn-primary" type="button" data-action="new-vehicle">${icon('plus')} Erstes Fahrzeug</button>`)}
    <section class="card onboarding-card">
      <div class="onboarding-inner">
        <div>
          <span class="eyebrow">Erste Schritte</span>
          <h3 class="onboarding-title">Ihr Fuhrpark ist startklar – es fehlen nur noch die Stammdaten.</h3>
          <p class="onboarding-text">Sobald Fahrzeuge und Fahrer:innen hinterlegt sind, können Sie Fahrten planen, Kilometerstände erfassen und Wartungen im Blick behalten.</p>
          <div class="onboarding-steps">
            <div class="onboarding-step"><span class="onboarding-step-number">1</span><div><strong>Fahrzeug anlegen</strong><span>Kennzeichen, Standort, Kilometerstand und HU/AU erfassen.</span></div></div>
            <div class="onboarding-step"><span class="onboarding-step-number">2</span><div><strong>Fahrer:in anlegen</strong><span>Kontaktdaten und Führerscheinklassen hinterlegen.</span></div></div>
            <div class="onboarding-step"><span class="onboarding-step-number">3</span><div><strong>Erste Fahrt planen</strong><span>Fahrzeug und Fahrer:in im Kalender zusammenbringen.</span></div></div>
          </div>
        </div>
        <aside class="onboarding-aside">
          <span class="onboarding-aside-label">Jetzt loslegen</span>
          <button class="btn btn-primary" type="button" data-action="new-vehicle">${icon('car')} Fahrzeug anlegen</button>
          <button class="btn btn-ghost" type="button" data-action="new-driver">${icon('users')} Fahrer:in anlegen</button>
          <div class="onboarding-hint">
            ${icon('shield')}
            <p>Alle Daten werden zentral auf dem Server gespeichert und sind für berechtigte Kolleg:innen sichtbar.</p>
          </div>
        </aside>
      </div>
    </section>`;
}

function renderDashboard() {
  const today = todayISO();
  const displayName = firstName(currentUser?.name || '') || 'Team';
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 11 ? 'Guten Morgen' : greetingHour < 18 ? 'Guten Tag' : 'Guten Abend';
  if (!db.vehicles.length && !db.drivers.length) return renderOnboarding(greeting, displayName);
  const todayBookings = sortByDateAsc(db.bookings.filter((booking) => booking.start.slice(0, 10) === today && booking.status !== 'canceled'));
  const activeToday = todayBookings.filter((booking) => booking.status === 'active').length;
  const available = db.vehicles.filter((vehicle) => vehicle.status === 'available').length;
  const inUse = db.vehicles.filter((vehicle) => vehicle.status === 'in_use').length;
  const maintenance = db.vehicles.filter((vehicle) => vehicle.status === 'maintenance').length;
  const pkw = db.vehicles.filter((vehicle) => vehicle.type === 'Pkw').length;
  const transporter = db.vehicles.filter((vehicle) => vehicle.type === 'Transporter').length;
  const bus = db.vehicles.filter((vehicle) => vehicle.type === 'Bus').length;
  const alerts = getAlerts();
  const overdueAlerts = alerts.filter((alert) => alert.severity === 'danger').length;
  const soonAlerts = alerts.filter((alert) => alert.severity === 'warning').length;
  const utilization = getUtilizationDays(7);
  const totalBookedHours = formatDecimal(utilization.reduce((sum, day) => sum + day.minutes, 0) / 60, 1);
  const openMaintenance = getOpenMaintenance().sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 3);

  const chartColumns = utilization.map((day) => {
    const date = parseISODate(day.date);
    const isToday = day.date === today;
    const height = day.pct > 0 ? Math.max(day.pct, 3) : 2;
    return `<div class="bar-col ${isToday ? 'is-today' : ''} ${day.pct === 0 ? 'is-muted' : ''}" title="${WEEKDAYS[(date.getDay() + 6) % 7]}, ${formatDate(day.date)}: ${day.bookings} Buchungen">
      <div class="bar-fill" style="height:${height}%"></div>
    </div>`;
  }).join('');

  const chartLabels = utilization.map((day) => {
    const date = parseISODate(day.date);
    const isToday = day.date === today;
    return `<span class="${isToday ? 'is-today' : ''}">${WEEKDAYS_SHORT[(date.getDay() + 6) % 7]}<em>${date.getDate()}.</em></span>`;
  }).join('');

  const todayRows = todayBookings.slice(0, 4).map((booking) => {
    const vehicle = getVehicle(booking.vehicleId);
    const driver = getDriver(booking.driverId);
    return `
      <div class="trip-row">
        <div class="trip-time"><strong>${formatTime(booking.start)}</strong><span>bis ${formatTime(booking.end)}</span></div>
        <div class="trip-side" style="--trip-color:${vehicle ? vehicle.color : '#cbd2dc'}"></div>
        <div class="trip-main">
          <strong>${esc(booking.purpose)}</strong>
          <span>${vehicleDot(vehicle)} ${esc(vehicle ? vehicle.name : 'Fahrzeug')} · ${esc(vehicle ? vehicle.plate : '')}</span>
        </div>
        <div class="trip-person">${driverAvatar(driver, 'avatar-sm')}<span>${esc(driver ? driver.name : '—')}</span></div>
        <div class="trip-status">${booking.status === 'active' ? `<span class="badge badge-green"><span class="live-dot"></span>Aktiv</span>` : booking.status === 'planned' ? `<span class="badge badge-blue">Geplant</span>` : statusBadge(booking.status)}</div>
      </div>`;
  }).join('');

  const maintenanceRows = openMaintenance.map((item) => {
    const vehicle = getVehicle(item.vehicleId);
    const state = maintenanceState(item);
    return `
      <div class="mini-item">
        <span class="mini-icon">${icon('wrench')}</span>
        <div class="mini-main">
          <strong>${esc(item.title)}</strong>
          <span>${esc(vehicle ? vehicle.name : 'Fahrzeug')} · ${state.label}</span>
        </div>
        <span class="mini-date ${state.key === 'overdue' ? 'is-alert' : ''}">${formatDate(item.dueDate)}</span>
      </div>`;
  }).join('');

  return `
    ${pageHead(formatDateLong(today), `${greeting}, ${esc(displayName)} <span class="wave">👋</span>`, 'Hier ist der aktuelle Überblick über den Fuhrpark der AWO Bremerhaven.',
      `<button class="btn btn-ghost" type="button" data-action="new-vehicle">${icon('plus')} Fahrzeug</button>
       <button class="btn btn-primary" type="button" data-action="new-booking">${icon('plus')} Neue Buchung</button>`)}

    <div class="kpi-grid">
      ${metricCard({
        label: 'Fahrzeuge gesamt', value: db.vehicles.length,
        sub: `${pkw} Pkw · ${transporter} Transporter · ${bus} Bus`,
        iconName: 'car', tint: 'tint-red',
        badge: `<span class="badge badge-gray no-dot">Flotte</span>`
      })}
      ${metricCard({
        label: 'Verfügbare Fahrzeuge', value: available,
        sub: `<strong>${inUse}</strong> unterwegs · <strong>${maintenance}</strong> in Wartung`,
        iconName: 'check-circle', tint: 'tint-green',
        badge: `<span class="badge badge-green">${Math.round((available / Math.max(db.vehicles.length, 1)) * 100)} %</span>`,
        glow: 'rgba(17,138,91,.06)'
      })}
      ${metricCard({
        label: 'Buchungen heute', value: todayBookings.length,
        sub: `<strong>${activeToday}</strong> ${activeToday === 1 ? 'Fahrt' : 'Fahrten'} aktuell aktiv`,
        iconName: 'calendar', tint: 'tint-blue',
        badge: `<span class="badge badge-blue">Heute</span>`,
        glow: 'rgba(37,99,235,.055)'
      })}
      ${metricCard({
        label: 'Wartung & TÜV', value: alerts.length,
        sub: `<span class="danger">${overdueAlerts} überfällig</span> · ${soonAlerts} bald fällig`,
        iconName: 'wrench', tint: 'tint-amber',
        badge: `<span class="badge badge-${overdueAlerts ? 'red' : 'green'}">${overdueAlerts ? 'Aktion nötig' : 'Im Plan'}</span>`,
        glow: 'rgba(184,104,0,.06)'
      })}
    </div>

    <div class="grid grid-dash mt-18">
      <section class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Auslastung der nächsten Tage</h3>
            <p class="card-sub">Gebuchte Zeit im Verhältnis zur verfügbaren Tageskapazität</p>
          </div>
          <div class="card-head-side"><span class="badge badge-gray no-dot">7 Tage</span></div>
        </div>
        <div class="card-body">
          <div class="chart-bars">
            <div class="chart-y"><span>100 %</span><span>75 %</span><span>50 %</span><span>25 %</span><span>0 %</span></div>
            <div class="chart-bars-right">
              <div class="chart-plot">
                <div class="chart-columns" style="--cols:7">${chartColumns}</div>
              </div>
              <div class="chart-x" style="--cols:7">${chartLabels}</div>
            </div>
          </div>
          <div class="chart-legend">
            <span><i class="legend-dot"></i> Auslastung</span>
            <span><i class="legend-dot muted"></i> Keine Buchung</span>
            <span style="margin-left:auto"><strong>${totalBookedHours} h</strong> gebucht</span>
          </div>
        </div>
        <div class="card-footer">
          <span class="text-muted">Basis: 8 Stunden pro Fahrzeug und Tag</span>
          <a class="link-arrow" href="#/buchungen">Buchungen ansehen ${icon('arrow-right')}</a>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Handlungsbedarf</h3>
            <p class="card-sub">Fällige Wartungen und Hauptuntersuchungen</p>
          </div>
          <div class="card-head-side"><span class="alert-count">${alerts.length}</span></div>
        </div>
        <div class="card-body tight">
          ${alerts.length ? `<div class="alert-list">${alerts.slice(0, 4).map(renderAlertItem).join('')}</div>` : emptyState('check-circle', 'Alles im grünen Bereich', 'Aktuell sind keine Wartungen oder HU/AU-Termine auffällig.', '', true)}
        </div>
        <div class="card-footer">
          <span class="text-muted">${overdueAlerts ? `${overdueAlerts} überfällige Punkte` : 'Keine überfälligen Punkte'}</span>
          <a class="link-arrow" href="#/wartung">Wartung öffnen ${icon('arrow-right')}</a>
        </div>
      </section>
    </div>

    <div class="grid grid-dash mt-18">
      <section class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Heute im Einsatz</h3>
            <p class="card-sub">${formatDateLong(today)}</p>
          </div>
          <div class="card-head-side"><span class="badge badge-green no-dot">${todayBookings.length} Buchungen</span></div>
        </div>
        <div class="card-body tight">
          ${todayRows ? `<div class="trip-list">${todayRows}</div>` : emptyState('calendar', 'Heute keine Fahrten', 'Für heute sind noch keine Buchungen eingetragen.', '<button class="btn btn-soft btn-sm" type="button" data-action="new-booking">Buchung anlegen</button>', true)}
        </div>
        <div class="card-footer">
          <span class="text-muted">${activeToday} aktiv · ${todayBookings.filter((booking) => booking.status === 'planned').length} geplant</span>
          <a class="link-arrow" href="#/buchungen">Alle Buchungen ${icon('arrow-right')}</a>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">Anstehende Wartungen</h3>
            <p class="card-sub">Nächste geplante Werkstatttermine</p>
          </div>
          <a class="link-arrow" href="#/wartung">Alle ${icon('arrow-right')}</a>
        </div>
        <div class="card-body tight">
          ${maintenanceRows ? `<div class="mini-list">${maintenanceRows}</div>` : emptyState('wrench', 'Keine offenen Arbeiten', 'Der Wartungsplan ist aktuell leer.', '', true)}
        </div>
        <div class="card-footer">
          <span class="text-muted">${getOpenMaintenance().length} offene ${getOpenMaintenance().length === 1 ? 'Arbeit' : 'Arbeiten'}</span>
          <a class="link-arrow" href="#/wartung">Wartungsplan ${icon('arrow-right')}</a>
        </div>
      </section>
    </div>`;
}

/* =========================================================
   Buchungen
   ========================================================= */
function getWeekBookings(startISO) {
  const endISO = addDays(startISO, 6);
  return db.bookings.filter((booking) => {
    const date = booking.start.slice(0, 10);
    return date >= startISO && date <= endISO && booking.status !== 'canceled';
  });
}

function renderCalendarBookingChip(booking) {
  const vehicle = getVehicle(booking.vehicleId);
  const driver = getDriver(booking.driverId);
  return `<button class="booking-chip ${booking.status === 'canceled' ? 'is-canceled' : ''}" type="button"
    style="--chip-color:${vehicle ? vehicle.color : '#9aa1ad'};--chip-soft:${vehicle ? hexToRgba(vehicle.color, 0.11) : '#f3f4f6'};--chip-status:${booking.status === 'active' ? '#118a5b' : '#2563eb'}"
    data-action="booking-details" data-id="${booking.id}"
    title="${esc(booking.purpose)} · ${esc(driver ? driver.name : '')}">
    <strong>${formatTime(booking.start)} ${esc(shortName(driver ? driver.name : ''))}</strong>
    <span><i class="chip-status"></i>${esc(booking.purpose)}</span>
  </button>`;
}

function renderWeekCalendar() {
  const weekStart = addDays(startOfWeekISO(todayISO()), ui.weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const bookings = getWeekBookings(weekStart);
  const totalMinutes = bookings.reduce((sum, booking) => sum + durationMinutes(booking.start, booking.end), 0);
  const today = todayISO();

  const headerDays = days.map((dateISO) => {
    const date = parseISODate(dateISO);
    const isToday = dateISO === today;
    return `<div class="cal-day ${isToday ? 'is-today' : ''}">
      <span>${WEEKDAYS_SHORT[(date.getDay() + 6) % 7]}</span>
      <strong>${date.getDate()}</strong>
      <span>${MONTHS_SHORT[date.getMonth()]}</span>
    </div>`;
  }).join('');

  const rows = db.vehicles.map((vehicle) => {
    const cells = days.map((dateISO) => {
      const dayBookings = sortByDateAsc(bookings.filter((booking) => booking.vehicleId === vehicle.id && booking.start.slice(0, 10) === dateISO));
      return `<div class="cal-cell ${dateISO === today ? 'is-today' : ''}" role="button" tabindex="0"
        data-action="calendar-cell" data-vehicle="${vehicle.id}" data-date="${dateISO}"
        aria-label="Buchung für ${esc(vehicle.name)} am ${formatDate(dateISO)} anlegen">
        ${dayBookings.length ? dayBookings.map(renderCalendarBookingChip).join('') : '<span class="cal-add">+</span>'}
      </div>`;
    }).join('');
    return `
      <div class="cal-row">
        <div class="cal-vehicle">
          ${vehicleDot(vehicle)}
          <div class="cal-vehicle-copy">
            <strong>${esc(vehicle.name)}</strong>
            <span>${esc(vehicle.plate)}</span>
          </div>
        </div>
        ${cells}
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="week-toolbar">
        <div class="week-nav">
          <button class="icon-btn" type="button" data-action="week-prev" aria-label="Vorherige Woche">${icon('chevron-left')}</button>
          <div class="week-range">
            <strong>${formatWeekRange(weekStart, weekEnd)}</strong>
            <span>${bookings.length} Buchungen in dieser Woche</span>
          </div>
          <button class="icon-btn" type="button" data-action="week-next" aria-label="Nächste Woche">${icon('chevron-right')}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="week-today">Heute</button>
        </div>
        <div class="toolbar">
          <div class="week-legend">
            <span><i class="legend-dot" style="background:var(--blue)"></i> Geplant</span>
            <span><i class="legend-dot" style="background:var(--green)"></i> Aktiv</span>
          </div>
        </div>
      </div>
      <div class="calendar-scroll">
        <div class="week-calendar">
          <div class="cal-header">
            <div class="cal-corner">Fahrzeug</div>
            ${headerDays}
          </div>
          ${rows}
        </div>
      </div>
      <div class="calendar-foot">
        <div class="calendar-stats">
          <span><strong>${bookings.length}</strong> Buchungen</span>
          <span><strong>${formatDecimal(totalMinutes / 60, 1)} h</strong> gebucht</span>
          <span><strong>${activeTodayCount()}</strong> Fahrten aktiv</span>
        </div>
        <span>Freie Zelle anklicken, um eine Buchung anzulegen.</span>
      </div>
    </div>`;
}

function activeTodayCount() {
  const today = todayISO();
  return db.bookings.filter((booking) => booking.status === 'active' && booking.start.slice(0, 10) === today).length;
}

function renderBookingTable() {
  const today = todayISO();
  const upcoming = sortByDateAsc(db.bookings.filter((booking) => booking.start.slice(0, 10) >= today && booking.status !== 'canceled'));
  const past = sortByDateDesc(db.bookings.filter((booking) => booking.start.slice(0, 10) < today || booking.status === 'canceled'));
  const ordered = [...upcoming, ...past];

  if (!ordered.length) {
    return emptyState('calendar', 'Noch keine Buchungen', 'Legen Sie die erste Fahrt für Ihren Fuhrpark an.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-booking">Buchung anlegen</button>');
  }

  const rows = ordered.map((booking) => {
    const vehicle = getVehicle(booking.vehicleId);
    const driver = getDriver(booking.driverId);
    const distance = booking.startKm != null && booking.endKm != null ? Math.max(0, booking.endKm - booking.startKm) : null;
    return `
      <tr>
        <td>
          <span class="table-main">${formatDate(booking.start)}</span>
          <span class="table-sub">${formatTimeRange(booking.start, booking.end)}</span>
        </td>
        <td>
          <div class="table-vehicle">
            ${vehicleDot(vehicle)}
            <div><span class="table-main">${esc(vehicle ? vehicle.name : '—')}</span><span class="table-sub">${esc(vehicle ? vehicle.plate : '')}</span></div>
          </div>
        </td>
        <td>
          <div class="table-person">${driverAvatar(driver, 'avatar-sm')}<span>${esc(driver ? driver.name : '—')}</span></div>
        </td>
        <td>
          <span class="table-main">${esc(booking.purpose)}</span>
          ${distance != null ? `<span class="table-sub">${formatKm(distance)} gefahren</span>` : `<span class="table-sub">${esc(vehicle ? vehicle.location : '')}</span>`}
        </td>
        <td>${statusBadge(booking.status)}</td>
        <td>
          <div class="table-actions">
            <button class="table-action" type="button" title="Details ansehen" aria-label="Details ansehen" data-action="booking-details" data-id="${booking.id}">${icon('info')}</button>
            ${booking.status === 'planned' ? `<button class="table-action" type="button" title="Fahrt starten" aria-label="Fahrt starten" data-action="start-booking" data-id="${booking.id}">${icon('play')}</button>` : ''}
            ${booking.status === 'active' ? `<button class="table-action" type="button" title="Fahrt beenden" aria-label="Fahrt beenden" data-action="end-booking" data-id="${booking.id}">${icon('stop')}</button>` : ''}
            ${booking.status === 'planned' ? `<button class="table-action danger" type="button" title="Buchung stornieren" aria-label="Buchung stornieren" data-action="cancel-booking" data-id="${booking.id}">${icon('x')}</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap is-scroll">
      <table class="data-table">
        <thead><tr><th>Zeitraum</th><th>Fahrzeug</th><th>Fahrer:in</th><th>Zweck</th><th>Status</th><th class="num">Aktionen</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderBookings() {
  const plannedCount = db.bookings.filter((booking) => booking.status === 'planned').length;
  const activeCount = db.bookings.filter((booking) => booking.status === 'active').length;
  if (!db.vehicles.length) {
    return `
      ${pageHead('Planung', 'Buchungen', 'Fahrten planen, Konflikte vermeiden und den Überblick behalten.',
        `<button class="btn btn-ghost" type="button" data-action="new-driver">${icon('plus')} Fahrer:in</button>
         <button class="btn btn-primary" type="button" data-action="new-vehicle">${icon('plus')} Fahrzeug anlegen</button>`)}
      <section class="card">${emptyState('calendar', 'Noch keine Buchungen möglich', 'Legen Sie zuerst ein Fahrzeug und eine Fahrer:in an, um Fahrten zu planen.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-vehicle">Erstes Fahrzeug anlegen</button>')}</section>`;
  }
  const headerActions = `<button class="btn btn-primary" type="button" data-action="new-booking">${icon('plus')} Neue Buchung</button>`;
  return `
    ${pageHead('Planung', 'Buchungen', 'Fahrten planen, Konflikte vermeiden und den Überblick behalten.', headerActions)}
    ${!db.drivers.length ? `<div class="info-banner" style="margin-bottom:14px">${icon('info')}<div><strong>Noch keine Fahrer:innen</strong><p>Buchungen benötigen eine Fahrer:in. Legen Sie dafür zuerst einen Eintrag unter „Fahrer:innen“ an.</p></div></div>` : ''}
    <div class="toolbar" style="margin-bottom:14px">
      <div class="segmented">
        <button class="${ui.bookingTab === 'calendar' ? 'is-active' : ''}" type="button" data-action="booking-tab" data-tab="calendar">Wochenansicht</button>
        <button class="${ui.bookingTab === 'list' ? 'is-active' : ''}" type="button" data-action="booking-tab" data-tab="list">Liste</button>
      </div>
      <div class="toolbar-spacer"></div>
      <span class="toolbar-label">${plannedCount} geplant · ${activeCount} aktiv</span>
    </div>
    ${ui.bookingTab === 'list'
      ? `<section class="card">
          <div class="card-head bordered">
            <div><h3 class="card-title">Buchungsübersicht</h3><p class="card-sub">Anstehende und vergangene Fahrten</p></div>
            <div class="card-head-side"><span class="badge badge-gray no-dot">${db.bookings.length} gesamt</span></div>
          </div>
          ${renderBookingTable()}
        </section>`
      : renderWeekCalendar()}`;
}

/* =========================================================
   Wartung & TÜV
   ========================================================= */
function renderTuvList() {
  const vehicles = [...db.vehicles].sort((a, b) => String(a.tuv).localeCompare(String(b.tuv)));
  const rows = vehicles.map((vehicle) => {
    const rawDays = daysUntil(vehicle.tuv);
    const missingDate = rawDays === null;
    const days = missingDate ? 0 : rawDays;
    const stateClass = missingDate ? 'warning' : days < 0 ? 'danger' : days <= 60 ? 'warning' : '';
    const pct = missingDate ? 4 : days < 0 ? 100 : Math.max(4, Math.min(100, Math.round((days / 365) * 100)));
    return `
      <div class="tuv-row">
        <div class="tuv-main">
          <strong>${esc(vehicle.name)}</strong>
          <span>${esc(vehicle.plate)} · ${missingDate ? 'Kein Termin hinterlegt' : formatDate(vehicle.tuv)}</span>
        </div>
        <div class="tuv-progress">
          <div class="progress"><div class="progress-fill ${stateClass === 'danger' ? 'is-danger' : stateClass === 'warning' ? 'is-warning' : ''}" style="width:${pct}%"></div></div>
        </div>
        <div class="tuv-date ${stateClass ? `is-${stateClass}` : ''}">${missingDate ? 'offen' : days < 0 ? `${Math.abs(days)} T. überf.` : `${days} Tage`}</div>
      </div>`;
  }).join('');
  return `
    <section class="card">
      <div class="card-head">
        <div><h3 class="card-title">HU/AU im Blick</h3><p class="card-sub">Nächste Hauptuntersuchungen der Flotte</p></div>
        <span class="badge badge-amber">${db.vehicles.filter((vehicle) => daysUntil(vehicle.tuv) <= 60).length} fällig</span>
      </div>
      <div class="card-body tight">${rows || emptyState('shield', 'Keine Fahrzeuge vorhanden', 'Sobald Fahrzeuge angelegt sind, erscheinen hier die HU/AU-Termine.', '<button class="btn btn-soft btn-sm" type="button" data-action="new-vehicle">Fahrzeug anlegen</button>', true)}</div>
      <div class="card-footer">
        <span class="text-muted">Warnung ab 60 Tagen</span>
        <a class="link-arrow" href="#/fahrzeuge">Fahrzeuge ${icon('arrow-right')}</a>
      </div>
    </section>`;
}

function renderMaintenanceTable() {
  let items = [...db.maintenance];
  if (ui.maintenanceFilter === 'open') items = items.filter((item) => !isMaintenanceDone(item));
  if (ui.maintenanceFilter === 'done') items = items.filter(isMaintenanceDone);
  items.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));

  if (!items.length) {
    return emptyState('wrench', 'Keine Einträge', 'Für diesen Filter sind keine Wartungsarbeiten hinterlegt.', '', true);
  }

  const rows = items.map((item) => {
    const vehicle = getVehicle(item.vehicleId);
    const state = maintenanceState(item);
    return `
      <tr>
        <td>
          <div class="table-vehicle">
            ${vehicleDot(vehicle)}
            <div><span class="table-main">${esc(vehicle ? vehicle.name : '—')}</span><span class="table-sub">${esc(vehicle ? vehicle.plate : '')}</span></div>
          </div>
        </td>
        <td>
          <span class="table-main">${esc(item.title)}</span>
          <span class="table-sub">${esc(item.workshop || 'Werkstatt offen')}</span>
        </td>
        <td>
          <span class="table-main">${formatDate(item.dueDate)}</span>
          <span class="table-sub">${isMaintenanceDone(item) ? `Erledigt am ${formatDate(item.completedAt)}` : state.label}</span>
        </td>
        <td><span class="badge badge-${state.badge}">${state.label}</span></td>
        <td class="num"><span class="money">${item.cost ? formatMoney(item.cost) : '—'}</span></td>
        <td>
          <div class="table-actions">
            ${isMaintenanceDone(item)
              ? `<span class="table-action" title="Erledigt" style="color:var(--green);pointer-events:none">${icon('check')}</span>`
              : `<button class="table-action" type="button" title="Als erledigt markieren" aria-label="Als erledigt markieren" data-action="mark-maintenance-done" data-id="${item.id}">${icon('check')}</button>`}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Fahrzeug</th><th>Maßnahme</th><th>Fällig</th><th>Status</th><th class="num">Kosten</th><th class="num">Aktion</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderMaintenance() {
  const openItems = getOpenMaintenance();
  const overdueMaintenance = openItems.filter((item) => daysUntil(item.dueDate) < 0);
  const tuvDue = db.vehicles.filter((vehicle) => daysUntil(vehicle.tuv) <= 60);
  const tuvOverdue = tuvDue.filter((vehicle) => daysUntil(vehicle.tuv) < 0);
  const alerts = getAlerts();
  const maintenanceCosts = getCostsLastMonths(6).filter((cost) => cost.category === 'Wartung').reduce((sum, cost) => sum + Number(cost.amount), 0);
  const doneCount = db.maintenance.filter(isMaintenanceDone).length;

  return `
    ${pageHead('Fuhrpark', 'Wartung & TÜV', 'Werkstatttermine, Hauptuntersuchungen und offene Arbeiten zentral verwalten.',
      `<button class="btn btn-primary" type="button" data-action="new-maintenance">${icon('plus')} Wartung erfassen</button>`)}
    <div class="kpi-grid">
      ${metricCard({ label: 'Offene Arbeiten', value: openItems.length, sub: `${doneCount} in den letzten Monaten erledigt`, iconName: 'wrench', tint: 'tint-amber', badge: '<span class="badge badge-amber no-dot">Wartungsplan</span>', glow: 'rgba(184,104,0,.06)' })}
      ${metricCard({ label: 'Überfällig', value: overdueMaintenance.length + tuvOverdue.length, sub: `${overdueMaintenance.length} Wartungen · ${tuvOverdue.length} HU/AU`, iconName: 'alert', tint: 'tint-red', badge: `<span class="badge badge-${(overdueMaintenance.length + tuvOverdue.length) ? 'red' : 'green'}">${(overdueMaintenance.length + tuvOverdue.length) ? 'Handeln' : 'Ok'}</span>` })}
      ${metricCard({ label: 'HU/AU in 60 Tagen', value: tuvDue.length, sub: `${db.vehicles.length} Fahrzeuge insgesamt`, iconName: 'shield', tint: 'tint-blue', badge: '<span class="badge badge-blue no-dot">TÜV</span>', glow: 'rgba(37,99,235,.055)' })}
      ${metricCard({ label: 'Wartungskosten', value: formatMoney(maintenanceCosts), sub: 'Letzte 6 Monate', iconName: 'receipt', tint: 'tint-violet', badge: '<span class="badge badge-violet no-dot">Betrieb</span>', glow: 'rgba(109,71,217,.05)' })}
    </div>

    <div class="grid grid-dash mt-18">
      <section class="card">
        <div class="card-head bordered">
          <div><h3 class="card-title">Wartungsplan</h3><p class="card-sub">Alle geplanten und abgeschlossenen Arbeiten</p></div>
          <span class="badge badge-gray no-dot">${alerts.length} Hinweise</span>
        </div>
        <div class="table-toolbar">
          <div class="filter-tabs">
            <button class="filter-tab ${ui.maintenanceFilter === 'all' ? 'is-active' : ''}" type="button" data-action="maintenance-filter" data-filter="all">Alle <span class="count">${db.maintenance.length}</span></button>
            <button class="filter-tab ${ui.maintenanceFilter === 'open' ? 'is-active' : ''}" type="button" data-action="maintenance-filter" data-filter="open">Offen <span class="count">${openItems.length}</span></button>
            <button class="filter-tab ${ui.maintenanceFilter === 'done' ? 'is-active' : ''}" type="button" data-action="maintenance-filter" data-filter="done">Erledigt <span class="count">${doneCount}</span></button>
          </div>
        </div>
        ${renderMaintenanceTable()}
        <div class="card-footer">
          <span class="text-muted">Erledigte Arbeiten werden automatisch als Kosten erfasst.</span>
          <a class="link-arrow" href="#/kosten">Kosten ${icon('arrow-right')}</a>
        </div>
      </section>
      ${renderTuvList()}
    </div>`;
}

/* =========================================================
   Kosten
   ========================================================= */
function getCostsLastMonths(months = 6) {
  const keys = lastMonths(months).map((month) => month.key);
  return db.costs.filter((cost) => keys.includes(monthKey(cost.date)));
}

function renderDonut(categories, total) {
  if (!total) return emptyState('receipt', 'Noch keine Kosten', 'Erfassen Sie Betriebskosten, um die Verteilung zu sehen.');
  let running = 0;
  const gradient = categories.map((category) => {
    const meta = CATEGORY_META[category.name] || CATEGORY_META.Sonstiges;
    const start = (running / total) * 100;
    running += category.amount;
    const end = (running / total) * 100;
    return `${meta.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(', ');
  const legend = categories.map((category) => {
    const meta = CATEGORY_META[category.name] || CATEGORY_META.Sonstiges;
    const pct = Math.round((category.amount / total) * 100);
    return `<div class="legend-row">
      <span class="dot" style="background:${meta.color}"></span>
      <span class="legend-label">${esc(category.name)}</span>
      <span class="legend-value">${formatMoney(category.amount)}</span>
      <span class="legend-pct">${pct} %</span>
    </div>`;
  }).join('');
  return `
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${gradient})" role="img" aria-label="Kostenverteilung">
        <div class="donut-center"><strong>${formatMoney(total)}</strong><span>Gesamt</span></div>
      </div>
      <div class="legend">${legend}</div>
    </div>`;
}

function renderCosts() {
  const entries = getCostsLastMonths(6);
  const total = entries.reduce((sum, cost) => sum + Number(cost.amount), 0);
  const months = lastMonths(6);
  const monthly = months.map((month) => ({
    ...month,
    amount: entries.filter((cost) => monthKey(cost.date) === month.key).reduce((sum, cost) => sum + Number(cost.amount), 0)
  }));
  const maxMonth = Math.max(...monthly.map((month) => month.amount), 1);
  const categoryTotals = COST_CATEGORIES.map((name) => ({
    name,
    amount: entries.filter((cost) => cost.category === name).reduce((sum, cost) => sum + Number(cost.amount), 0)
  })).filter((category) => category.amount > 0).sort((a, b) => b.amount - a.amount);
  const fuel = entries.filter((cost) => ['Kraftstoff', 'Laden'].includes(cost.category)).reduce((sum, cost) => sum + Number(cost.amount), 0);
  const workshop = entries.filter((cost) => cost.category === 'Wartung').reduce((sum, cost) => sum + Number(cost.amount), 0);

  const vehicleTotals = db.vehicles.map((vehicle) => ({
    vehicle,
    amount: entries.filter((cost) => cost.vehicleId === vehicle.id).reduce((sum, cost) => sum + Number(cost.amount), 0)
  })).sort((a, b) => b.amount - a.amount);
  const maxVehicle = Math.max(...vehicleTotals.map((row) => row.amount), 1);

  let filteredCosts = [...db.costs];
  if (ui.costCategory !== 'all') filteredCosts = filteredCosts.filter((cost) => cost.category === ui.costCategory);
  if (ui.costVehicle !== 'all') filteredCosts = filteredCosts.filter((cost) => cost.vehicleId === ui.costVehicle);
  filteredCosts.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const costRows = filteredCosts.map((cost) => {
    const vehicle = getVehicle(cost.vehicleId);
    const category = CATEGORY_META[cost.category] || CATEGORY_META.Sonstiges;
    return `
      <tr>
        <td><span class="table-main">${formatDate(cost.date)}</span></td>
        <td>
          <div class="table-vehicle">
            ${vehicleDot(vehicle)}
            <div><span class="table-main">${esc(vehicle ? vehicle.name : '—')}</span><span class="table-sub">${esc(vehicle ? vehicle.plate : '')}</span></div>
          </div>
        </td>
        <td>
          <span class="badge no-dot" style="color:${category.color};background:${hexToRgba(category.color, 0.1)}">${esc(cost.category)}</span>
          <span class="table-sub">${esc(cost.note || 'Betriebskosten')}</span>
        </td>
        <td class="num"><span class="money">${formatMoney(cost.amount, 2)}</span></td>
        <td>
          <div class="table-actions">
            ${cost.receipt ? `<button class="table-action" type="button" title="Beleg ansehen" aria-label="Beleg ansehen" data-action="view-receipt" data-id="${cost.id}">${icon('paperclip')}</button>` : ''}
            <button class="table-action danger" type="button" title="Kosten löschen" aria-label="Kosten löschen" data-action="delete-cost" data-id="${cost.id}">${icon('trash')}</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  const monthColumns = monthly.map((month) => {
    const height = month.amount > 0 ? Math.max(3, Math.round((month.amount / maxMonth) * 100)) : 2;
    return `<div class="bar-col ${month.key === monthKey(todayISO()) ? 'is-today' : ''} ${month.amount === 0 ? 'is-muted' : ''}" title="${month.longLabel}: ${formatMoney(month.amount, 2)}">
      <div class="bar-fill" style="height:${height}%"></div>
    </div>`;
  }).join('');
  const monthLabels = monthly.map((month) => `<span>${month.label}<em>${String(month.year).slice(2)}</em></span>`).join('');
  const axis = [1, 0.75, 0.5, 0.25, 0].map((part) => `<span>${part === 0 ? '0 €' : `${formatDecimal((maxMonth * part) / 1000, 1)}k €`}</span>`).join('');

  const vehicleRanking = vehicleTotals.slice(0, 8).map((row) => `
    <div class="hbar-item">
      <div class="hbar-head">
        <span>${vehicleDot(row.vehicle)} ${esc(row.vehicle.name)}</span>
        <strong>${formatMoney(row.amount)}</strong>
      </div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((row.amount / maxVehicle) * 100)}%;--bar-color:${row.vehicle.color}"></div></div>
    </div>`).join('');

  return `
    ${pageHead('Controlling', 'Kosten', 'Betriebskosten der letzten sechs Monate transparent aufbereitet.',
      `<button class="btn btn-primary" type="button" data-action="new-cost">${icon('plus')} Kosten erfassen</button>`)}
    <div class="kpi-grid">
      ${metricCard({ label: 'Gesamtkosten', value: formatMoney(total), sub: 'Letzte 6 Monate', iconName: 'receipt', tint: 'tint-red', badge: '<span class="badge badge-red no-dot">Betrieb</span>' })}
      ${metricCard({ label: 'Durchschnitt pro Monat', value: formatMoney(total / 6), sub: 'Über alle Fahrzeuge', iconName: 'trend-up', tint: 'tint-blue', badge: `<span class="badge badge-blue no-dot">${db.vehicles.length} Fahrzeuge</span>`, glow: 'rgba(37,99,235,.055)' })}
      ${metricCard({ label: 'Kraftstoff & Laden', value: formatMoney(fuel), sub: `≈ ${formatMoney(fuel / Math.max(db.vehicles.length, 1) / 6)} pro Fahrzeug/Monat`, iconName: 'fuel', tint: 'tint-teal', badge: '<span class="badge badge-teal no-dot">Energie</span>', glow: 'rgba(15,143,138,.055)' })}
      ${metricCard({ label: 'Wartung', value: formatMoney(workshop), sub: 'Werkstatt und Instandhaltung', iconName: 'wrench', tint: 'tint-amber', badge: '<span class="badge badge-amber no-dot">Service</span>', glow: 'rgba(184,104,0,.06)' })}
    </div>

    <div class="grid grid-focus mt-18">
      <section class="card">
        <div class="card-head"><div><h3 class="card-title">Kostenverteilung</h3><p class="card-sub">Nach Kostenart · letzte 6 Monate</p></div></div>
        <div class="card-body">${renderDonut(categoryTotals, total)}</div>
      </section>
      <section class="card">
        <div class="card-head">
          <div><h3 class="card-title">Monatliche Entwicklung</h3><p class="card-sub">${months[0].longLabel} bis ${months[months.length - 1].longLabel}</p></div>
          <span class="badge badge-gray no-dot">${formatMoney(total / 6)} Ø</span>
        </div>
        <div class="card-body">
          <div class="chart-bars">
            <div class="chart-y">${axis}</div>
            <div class="chart-bars-right">
              <div class="chart-plot"><div class="chart-columns" style="--cols:6">${monthColumns}</div></div>
              <div class="chart-x" style="--cols:6">${monthLabels}</div>
            </div>
          </div>
          <div class="chart-legend"><span><i class="legend-dot"></i> Monatssumme</span><span style="margin-left:auto">Ø <strong>${formatMoney(total / 6)}</strong></span></div>
        </div>
      </section>
    </div>

    <div class="grid grid-dash mt-18">
      <section class="card">
        <div class="card-head bordered">
          <div><h3 class="card-title">Kostenbuchungen</h3><p class="card-sub">${filteredCosts.length} von ${db.costs.length} Einträgen</p></div>
          <span class="badge badge-gray no-dot">${formatMoney(filteredCosts.reduce((sum, cost) => sum + Number(cost.amount), 0), 2)}</span>
        </div>
        <div class="table-toolbar">
          <select class="select select-sm" id="costCategoryFilter" aria-label="Kostenart filtern">
            <option value="all">Alle Kostenarten</option>
            ${COST_CATEGORIES.map((category) => `<option value="${category}" ${ui.costCategory === category ? 'selected' : ''}>${category}</option>`).join('')}
          </select>
          <select class="select select-sm" id="costVehicleFilter" aria-label="Fahrzeug filtern">
            <option value="all">Alle Fahrzeuge</option>
            ${db.vehicles.map((vehicle) => `<option value="${vehicle.id}" ${ui.costVehicle === vehicle.id ? 'selected' : ''}>${esc(vehicle.name)} · ${esc(vehicle.plate)}</option>`).join('')}
          </select>
        </div>
        ${filteredCosts.length ? `<div class="table-wrap is-scroll"><table class="data-table">
          <thead><tr><th>Datum</th><th>Fahrzeug</th><th>Kostenart / Beschreibung</th><th class="num">Betrag</th><th class="num"></th></tr></thead>
          <tbody>${costRows}</tbody>
        </table></div>` : emptyState('receipt', 'Keine Kosten gefunden', 'Ändern Sie die Filter oder erfassen Sie eine neue Kostenposition.', '', true)}
        <div class="card-footer">
          <span class="text-muted">Belege werden serverseitig gespeichert und sind für berechtigte Nutzer:innen abrufbar.</span>
          <button class="btn-link" type="button" data-action="new-cost">${icon('plus')} Kosten hinzufügen</button>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div><h3 class="card-title">Kosten nach Fahrzeug</h3><p class="card-sub">Betriebskosten der letzten 6 Monate</p></div></div>
        <div class="card-body"><div class="hbar-list">${vehicleRanking}</div></div>
        <div class="card-footer"><span class="text-muted">Höchster Wert: ${formatMoney(maxVehicle)}</span><a class="link-arrow" href="#/fahrzeuge">Flotte ${icon('arrow-right')}</a></div>
      </section>
    </div>`;
}

/* =========================================================
   Fahrtenbuch
   ========================================================= */
function renderLogbook() {
  const trips = getCompletedBookings(ui.logPeriod);
  const distance = trips.reduce((sum, trip) => sum + Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0)), 0);
  const average = trips.length ? distance / trips.length : 0;
  const vehiclesUsed = new Set(trips.map((trip) => trip.vehicleId)).size;

  const rows = trips.map((trip) => {
    const vehicle = getVehicle(trip.vehicleId);
    const driver = getDriver(trip.driverId);
    const km = Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0));
    return `
      <tr>
        <td><span class="table-main">${formatDate(trip.start)}</span><span class="table-sub">${WEEKDAYS[(parseISODate(trip.start).getDay() + 6) % 7]}</span></td>
        <td><div class="table-vehicle">${vehicleDot(vehicle)}<div><span class="table-main">${esc(vehicle ? vehicle.name : '—')}</span><span class="table-sub">${esc(vehicle ? vehicle.plate : '')}</span></div></div></td>
        <td><div class="table-person">${driverAvatar(driver, 'avatar-sm')}<span>${esc(driver ? driver.name : '—')}</span></div></td>
        <td><span class="table-main">${esc(trip.purpose)}</span><span class="table-sub">${formatTimeRange(trip.start, trip.end)}</span></td>
        <td><span class="table-main">${formatNumber(trip.startKm)}</span><span class="table-sub">bis ${formatNumber(trip.endKm)} km</span></td>
        <td class="num"><span class="money">${formatNumber(km)} km</span></td>
        <td><div class="table-actions"><button class="table-action" type="button" title="Details ansehen" aria-label="Details ansehen" data-action="booking-details" data-id="${trip.id}">${icon('info')}</button></div></td>
      </tr>`;
  }).join('');

  return `
    ${pageHead('Fahrtenbuch', 'Fahrtenbuch', 'Gefahrene Strecken, Kilometerstände und Fahrer:innen dokumentieren.',
      `<button class="btn btn-ghost" type="button" data-action="export-log">${icon('download')} CSV exportieren</button>
       <button class="btn btn-primary" type="button" data-action="new-log">${icon('plus')} Fahrt nachtragen</button>`)}
    <div class="kpi-grid">
      ${metricCard({ label: 'Fahrten', value: trips.length, sub: ui.logPeriod === 'all' ? 'Alle dokumentierten Fahrten' : 'Im ausgewählten Zeitraum', iconName: 'route', tint: 'tint-blue', badge: '<span class="badge badge-blue no-dot">Fahrtenbuch</span>', glow: 'rgba(37,99,235,.055)' })}
      ${metricCard({ label: 'Gefahrene Kilometer', value: formatNumber(distance), sub: `≈ ${formatDecimal(average, 0)} km pro Fahrt`, iconName: 'gauge', tint: 'tint-green', badge: '<span class="badge badge-green no-dot">Strecke</span>', glow: 'rgba(17,138,91,.055)' })}
      ${metricCard({ label: 'Fahrzeuge im Einsatz', value: vehiclesUsed, sub: `${db.vehicles.length} Fahrzeuge in der Flotte`, iconName: 'car', tint: 'tint-teal', badge: '<span class="badge badge-teal no-dot">Flotte</span>', glow: 'rgba(15,143,138,.055)' })}
      ${metricCard({ label: 'Ø Distanz', value: `${formatDecimal(average, 0)} km`, sub: 'Pro dokumentierter Fahrt', iconName: 'trend-up', tint: 'tint-violet', badge: '<span class="badge badge-violet no-dot">Kennzahl</span>', glow: 'rgba(109,71,217,.05)' })}
    </div>
    <section class="card mt-18">
      <div class="card-head bordered">
        <div><h3 class="card-title">Fahrtenübersicht</h3><p class="card-sub">${trips.length} abgeschlossene Fahrten · ${formatNumber(distance)} km</p></div>
        <div class="card-head-side">
          <select class="select select-sm" id="logPeriod" style="width:auto" aria-label="Zeitraum auswählen">
            <option value="30" ${ui.logPeriod === '30' ? 'selected' : ''}>Letzte 30 Tage</option>
            <option value="90" ${ui.logPeriod === '90' ? 'selected' : ''}>Letzte 90 Tage</option>
            <option value="all" ${ui.logPeriod === 'all' ? 'selected' : ''}>Alle Fahrten</option>
          </select>
        </div>
      </div>
      ${trips.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Datum</th><th>Fahrzeug</th><th>Fahrer:in</th><th>Zweck / Zeit</th><th>Kilometerstand</th><th class="num">Distanz</th><th class="num"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('book', 'Keine Fahrten im Zeitraum', 'Wählen Sie einen anderen Zeitraum oder tragen Sie eine Fahrt nach.', '<button class="btn btn-soft btn-sm" type="button" data-action="new-log">Fahrt nachtragen</button>')}
      <div class="table-footer">
        <span>${trips.length} Fahrten · ${new Set(trips.map((trip) => trip.driverId)).size} Fahrer:innen</span>
        <span>Gesamtstrecke: <strong>${formatNumber(distance)} km</strong></span>
      </div>
    </section>`;
}

/* =========================================================
   Fahrer:innen
   ========================================================= */
function renderDrivers() {
  const available = db.drivers.filter((driver) => driverDisplayStatus(driver).key === 'available').length;
  const active = db.drivers.filter((driver) => driverDisplayStatus(driver).key === 'active').length;
  const away = db.drivers.filter((driver) => driverDisplayStatus(driver).key === 'away').length;

  const cards = db.drivers.map((driver) => {
    const status = driverDisplayStatus(driver);
    const upcoming = db.bookings.filter((booking) => booking.driverId === driver.id && booking.start.slice(0, 10) >= todayISO() && ['planned', 'active'].includes(booking.status));
    return `
      <article class="card driver-card">
        <div class="driver-head">
          <div class="driver-avatar">
            ${driverAvatar(driver, 'avatar-lg')}
            <span class="status-indicator ${status.key === 'away' ? 'is-away' : status.key === 'active' ? 'is-active' : ''}"></span>
          </div>
          <div class="driver-copy">
            <h3>${esc(driver.name)}</h3>
            <p>${esc(driver.role)} · ${esc(driver.department)}</p>
            <span class="badge badge-${status.badge}">${status.label}</span>
          </div>
          <button class="table-action" type="button" title="Fahrer:in bearbeiten" aria-label="Fahrer:in bearbeiten" data-action="edit-driver" data-id="${driver.id}">${icon('edit')}</button>
        </div>
        <div class="driver-contact">
          <a href="tel:${esc(driver.phone.replace(/\s/g, ''))}">${icon('phone')}<span>${esc(driver.phone)}</span></a>
          <a href="mailto:${esc(driver.email)}">${icon('mail')}<span>${esc(driver.email)}</span></a>
        </div>
        <div class="driver-bottom">
          <div class="license-list">${driver.license.map((license) => `<span class="license">${esc(license)}</span>`).join('')}</div>
          <span class="driver-meta"><strong>${upcoming.length}</strong> ${upcoming.length === 1 ? 'Buchung' : 'Buchungen'}</span>
        </div>
      </article>`;
  }).join('');

  return `
    ${pageHead('Team', 'Fahrer:innen', 'Führerscheine, Kontaktdaten und Einsätze der Mitarbeitenden verwalten.',
      `<button class="btn btn-primary" type="button" data-action="new-driver">${icon('plus')} Fahrer:in anlegen</button>`)}
    <div class="summary-chips" style="margin-bottom:18px">
      <span class="summary-chip"><span class="dot" style="--dot:var(--green)"></span><strong>${available}</strong> verfügbar</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--blue)"></span><strong>${active}</strong> im Einsatz</span>
      <span class="summary-chip"><span class="dot" style="--dot:#aeb5c0"></span><strong>${away}</strong> abwesend</span>
      <span class="summary-chip">${icon('id')} ${db.drivers.filter((driver) => driver.license.some((license) => ['BE', 'C1', 'D1'].includes(license))).length} mit erweitertem Führerschein</span>
    </div>
    ${db.drivers.length ? `<div class="driver-grid">${cards}</div>` : emptyState('users', 'Noch keine Fahrer:innen', 'Legen Sie die ersten Mitarbeitenden an, damit Fahrten zugewiesen werden können.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-driver">Fahrer:in anlegen</button>')}`;
}

/* =========================================================
   Einstellungen
   ========================================================= */
function renderSettings() {
  const roleLabel = ROLE_LABELS[currentUser?.role] || currentUser?.role || '—';
  const adminLink = capabilities.manageUsers
    ? `<a class="link-arrow" href="#/benutzer">Benutzer verwalten ${icon('arrow-right')}</a>`
    : '';
  return `
    ${pageHead('Organisation', 'Einstellungen', 'Organisation, Konto und Datenexport verwalten.', '')}
    <div class="settings-grid">
      <div class="stack">
        <form class="card settings-card" id="settingsForm">
          <div class="card-head bordered">
            <div><h3 class="card-title">Organisation</h3><p class="card-sub">Diese Angaben erscheinen in der Anwendung.</p></div>
            <span class="badge badge-green no-dot">Server gespeichert</span>
          </div>
          <div class="card-body">
            <div class="form-grid">
              <div class="field field-full">
                <label for="orgName">Name der Einrichtung</label>
                <input class="input" id="orgName" name="orgName" value="${esc(db.settings.orgName)}" required>
              </div>
              <div class="field">
                <label for="orgLocation">Standort</label>
                <input class="input" id="orgLocation" name="location" value="${esc(db.settings.location)}" required>
              </div>
              <div class="field">
                <label for="orgPhone">Telefon</label>
                <input class="input" id="orgPhone" name="phone" value="${esc(db.settings.phone)}">
              </div>
              <div class="field field-full">
                <label for="orgEmail">E-Mail Fuhrpark</label>
                <input class="input" id="orgEmail" name="email" type="email" value="${esc(db.settings.email)}">
              </div>
            </div>
            <div class="info-banner" style="margin-top:16px">
              ${icon('shield')}
              <div><strong>Zentrale Datenhaltung</strong><p>Alle Stammdaten, Buchungen und Dateien werden auf dem Server gespeichert. Regelmäßige Sicherungen des Datenverzeichnisses sind Aufgabe des Betriebs.</p></div>
            </div>
          </div>
          <div class="card-footer">
            <span class="text-muted">Änderungen gelten sofort für alle angemeldeten Nutzer:innen.</span>
            <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
          </div>
        </form>

        <section class="card">
          <div class="card-head bordered">
            <div><h3 class="card-title">Datenexport</h3><p class="card-sub">Stammdaten und Bewegungsdaten als JSON sichern.</p></div>
          </div>
          <div class="card-body">
            <div class="detail-list">
              <div class="detail-list-item">
                <span class="mini-icon tint-blue">${icon('download')}</span>
                <div class="main"><strong>Datenexport</strong><span>Fahrzeuge, Fahrer:innen, Buchungen, Wartungen und Kosten. Bild- und Belegdateien sind separat im Datenverzeichnis gesichert.</span></div>
                <button class="btn btn-ghost btn-sm" type="button" data-action="export-data">Exportieren</button>
              </div>
              <div class="detail-list-item">
                <span class="mini-icon tint-green">${icon('shield')}</span>
                <div class="main"><strong>Server-Sicherung</strong><span>Für den Produktivbetrieb müssen Datenbank und Upload-Verzeichnis regelmäßig gesichert werden.</span></div>
              </div>
            </div>
            <div class="version-box">
              <span>Installation vom ${db.meta.seededAt ? formatDate(db.meta.seededAt) : '—'}</span>
              <span class="version-badge">Server-MVP 0.1</span>
            </div>
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Ihr Konto</h3><p class="card-sub">Aktuell angemeldete Person</p></div></div>
          <div class="card-body">
            <div class="detail-list">
              <div class="detail-list-item">
                ${driverAvatar({ name: currentUser?.name || '?', color: '#e2001a' }, 'avatar-lg')}
                <div class="main"><strong>${esc(currentUser?.name || '—')}</strong><span>${esc(currentUser?.email || '—')}</span></div>
                <span class="badge badge-red no-dot">${esc(roleLabel)}</span>
              </div>
            </div>
            <div class="setting-actions">
              <button class="btn btn-ghost btn-sm" type="button" data-action="change-password">${icon('shield')} Passwort ändern</button>
              ${adminLink}
            </div>
          </div>
          <div class="card-footer">
            <span class="text-muted">Sitzung sicher beenden</span>
            <button class="btn btn-danger-ghost btn-sm" type="button" data-action="logout">${icon('log-out')} Abmelden</button>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Über diese Installation</h3><p class="card-sub">Fuhrparkmanagement für die AWO Bremerhaven</p></div></div>
          <div class="card-body">
            <div class="detail-list">
              <div class="detail-list-item">
                <span class="mini-icon tint-green">${icon('check-circle')}</span>
                <div class="main"><strong>Buchungen mit Konfliktprüfung</strong><span>Doppelbelegungen werden serverseitig verhindert.</span></div>
              </div>
              <div class="detail-list-item">
                <span class="mini-icon tint-blue">${icon('calendar-check')}</span>
                <div class="main"><strong>Wartung und HU/AU</strong><span>Automatische Hinweise zu fälligen Terminen und offenen Arbeiten.</span></div>
              </div>
              <div class="detail-list-item">
                <span class="mini-icon tint-violet">${icon('receipt')}</span>
                <div class="main"><strong>Kostenauswertung</strong><span>Betriebskosten nach Monat, Kostenart und Fahrzeug.</span></div>
              </div>
            </div>
            <div class="info-banner" style="margin-top:14px">
              ${icon('info')}
              <div><strong>Betrieb durch die AWO</strong><p>Diese Instanz ist für den internen Gebrauch bestimmt. Zugriff, Aufbewahrungsfristen und Datenschutz müssen organisatorisch geregelt sein.</p></div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Tastenkürzel</h3><p class="card-sub">Schneller durch die Anwendung navigieren</p></div></div>
          <div class="card-body">
            <div class="shortcut-list">
              <div class="shortcut-row"><span>Globale Suche öffnen</span><kbd>Strg K</kbd></div>
              <div class="shortcut-row"><span>Dialog schließen</span><kbd>Esc</kbd></div>
              <div class="shortcut-row"><span>Erstes Suchergebnis öffnen</span><kbd>Enter</kbd></div>
            </div>
          </div>
        </section>
      </div>
    </div>`;
}

/* =========================================================
   Benutzerverwaltung
   ========================================================= */
function renderUsers() {
  if (!capabilities.manageUsers) return emptyState('shield', 'Keine Berechtigung', 'Die Benutzerverwaltung ist Administratoren vorbehalten.');
  const users = db.users || [];
  const admins = users.filter((user) => user.role === 'admin' && user.active).length;
  const active = users.filter((user) => user.active).length;
  const rows = users.map((user) => {
    const isSelf = currentUser?.id === user.id;
    return `
      <tr>
        <td>
          <div class="table-person">
            ${driverAvatar({ name: user.name, color: user.role === 'admin' ? '#e2001a' : '#2563eb' }, 'avatar-sm')}
            <div><span class="table-main">${esc(user.name)} ${isSelf ? '<span class="badge badge-gray no-dot">Sie</span>' : ''}</span><span class="table-sub">${user.createdAt ? `Angelegt am ${formatDate(user.createdAt)}` : ''}</span></div>
          </div>
        </td>
        <td><span class="table-main">${esc(user.email)}</span></td>
        <td><span class="badge badge-${user.role === 'admin' ? 'red' : 'blue'}">${esc(ROLE_LABELS[user.role] || user.role)}</span></td>
        <td>${user.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Deaktiviert</span>'}</td>
        <td>${user.lastLoginAt ? `<span class="table-main">${formatDateTime(user.lastLoginAt)}</span>` : '<span class="text-muted">Noch nicht angemeldet</span>'}</td>
        <td><div class="table-actions"><button class="table-action" type="button" title="Benutzer bearbeiten" aria-label="Benutzer bearbeiten" data-action="edit-user" data-id="${user.id}">${icon('edit')}</button></div></td>
      </tr>`;
  }).join('');
  return `
    ${pageHead('Organisation', 'Benutzer', 'Zugänge, Rollen und Berechtigungen der Fuhrparkverwaltung verwalten.',
      `<button class="btn btn-primary" type="button" data-action="new-user">${icon('plus')} Benutzer anlegen</button>`)}
    <div class="summary-chips" style="margin-bottom:18px">
      <span class="summary-chip"><strong>${users.length}</strong> Zugänge</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--green)"></span><strong>${active}</strong> aktiv</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--awo)"></span><strong>${admins}</strong> Administrator:in</span>
    </div>
    <section class="card">
      <div class="card-head bordered">
        <div><h3 class="card-title">Benutzerkonten</h3><p class="card-sub">Alle Zugänge zu dieser Installation</p></div>
        <span class="badge badge-gray no-dot">${users.length} gesamt</span>
      </div>
      ${users.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Benutzer:in</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th>Letzte Anmeldung</th><th class="num">Aktion</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('users', 'Keine Benutzer', 'Legen Sie den ersten Zugang für die Fuhrparkverwaltung an.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-user">Benutzer anlegen</button>')}
      <div class="card-footer">
        <span class="text-muted">Passwörter werden verschlüsselt gespeichert und nie im Klartext angezeigt.</span>
      </div>
    </section>`;
}

/* =========================================================
   Routen
   ========================================================= */
const ROUTES = {
  dashboard: renderDashboard,
  fahrzeuge: renderVehicles,
  buchungen: renderBookings,
  fahrtenbuch: renderLogbook,
  wartung: renderMaintenance,
  kosten: renderCosts,
  fahrer: renderDrivers,
  benutzer: renderUsers,
  einstellungen: renderSettings
};
