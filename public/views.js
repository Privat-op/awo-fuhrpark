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

function requestStatusBadge(status) {
  const meta = BOOKING_REQUEST_STATUS[status] || { label: status, badge: 'gray' };
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

function leasingCardMarkup(vehicle) {
  const leasing = vehicle.leasing;
  if (!leasing || !Array.isArray(leasing.warnings) || !leasing.warnings.length) return '';
  const warning = leasing.warnings[0];
  const critical = leasing.status === 'critical';
  return `
    <div class="leasing-strip ${critical ? 'is-critical' : 'is-warning'}">
      <span class="leasing-strip-icon">${icon(warning.kind === 'end' ? 'calendar' : 'gauge')}</span>
      <div class="leasing-strip-copy">
        <strong>${esc(warning.title)}</strong>
        <span>${esc(warning.text)}</span>
      </div>
    </div>`;
}

function leasingDetailMarkup(vehicle) {
  const leasing = vehicle.leasing;
  if (!leasing) return '';
  const warnings = Array.isArray(leasing.warnings) ? leasing.warnings : [];
  const warningMarkup = warnings.length
    ? warnings.map((warning) => `<div class="info-banner ${warning.severity === 'danger' ? 'is-danger' : ''}" style="margin-bottom:10px">${icon('alert')}<div><strong>${esc(warning.title)}</strong><p>${esc(warning.text)}</p></div></div>`).join('')
    : '';
  const progress = leasing.percent === null ? null : Math.min(100, Math.max(0, leasing.percent));
  return `
    ${warningMarkup}
    <div class="leasing-detail">
      <div class="leasing-detail-head">
        <div>
          <strong>Leasingüberwachung</strong>
          <span>${leasing.start ? `Beginn ${formatDate(leasing.start)} · ` : ''}Ende ${formatDate(leasing.end)}${leasing.daysRemaining !== null ? ` (${leasing.daysRemaining < 0 ? `${Math.abs(leasing.daysRemaining)} Tage überfällig` : `in ${leasing.daysRemaining} Tagen`})` : ''}</span>
        </div>
        ${leasing.kmLimit ? `<span class="badge badge-${leasing.status === 'critical' ? 'red' : leasing.status === 'warning' ? 'amber' : 'green'} no-dot">${formatDecimal(leasing.percent, 1)} %</span>` : ''}
      </div>
      ${leasing.kmLimit ? `
        <div class="leasing-meter" role="img" aria-label="${esc(`Leasing-Kilometer zu ${formatDecimal(leasing.percent, 1)} Prozent verbraucht`)}">
          <span class="leasing-meter-fill ${leasing.status === 'critical' ? 'is-critical' : leasing.status === 'warning' ? 'is-warning' : ''}" style="width:${progress}%"></span>
        </div>
        <div class="leasing-facts">
          <span><strong>${formatKm(leasing.usedKm)}</strong> verbraucht</span>
          <span><strong>${leasing.remainingKm < 0 ? `−${formatKm(Math.abs(leasing.remainingKm))}` : formatKm(leasing.remainingKm)}</strong> Rest</span>
          <span><strong>${formatKm(leasing.kmLimit)}</strong> Limit</span>
        </div>` : ''}
    </div>`;
}

function renderVehicleCard(vehicle) {
  const status = VEHICLE_STATUS[vehicle.status] || VEHICLE_STATUS.available;
  const tuvDays = daysUntil(vehicle.tuv);
  const tuvAlert = tuvDays !== null && tuvDays <= 60;
  const bookedToday = db.bookings.some((booking) => booking.vehicleId === vehicle.id && booking.start.slice(0, 10) === todayISO() && booking.status !== 'canceled');
  const disabled = vehicle.status === 'maintenance';
  const blocked = Boolean(vehicle.blocked);
  const hasPhoto = Boolean(vehicle.image);
  const canManage = canOn('vehicle', vehicle.id, 'vehicles_manage');

  return `
    <article class="vehicle-card ${blocked ? 'is-blocked' : ''}" style="--vehicle-soft:${hexToRgba(vehicle.color, 0.13)}">
      <div class="vehicle-visual ${hasPhoto ? 'has-photo' : ''}">
        ${hasPhoto
          ? `<img class="vehicle-photo" src="${esc(vehicle.image)}" alt="${esc(vehicle.name)}"><span class="vehicle-photo-shade"></span>`
          : `<div class="vehicle-art">${vehicleArt(vehicle.type, vehicle.color)}</div>`}
        <div class="vehicle-visual-top">
          ${blocked ? '<span class="badge badge-red">Gesperrt</span>' : `<span class="badge badge-${status.badge}">${status.label}</span>`}
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
              ${vehicle.costCenterCode ? `<span>·</span><span>${esc(vehicle.costCenterCode)}</span>` : ''}
            </div>
          </div>
          ${blocked ? '<span class="badge badge-red no-dot">Dauerhaft gesperrt</span>' : bookedToday ? `<span class="badge badge-blue no-dot">Heute gebucht</span>` : ''}
        </div>
        ${blocked ? `<div class="info-banner" style="margin:12px 0 0;padding:10px 12px">${icon('alert')}<div><strong>Sperre aktiv</strong><p>${esc(vehicle.blockedReason || 'Keine Begründung hinterlegt.')}</p></div></div>` : ''}
        ${leasingCardMarkup(vehicle)}
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
            ${canManage ? `<button class="btn btn-ghost btn-sm" type="button" data-action="toggle-vehicle-block" data-id="${vehicle.id}">${blocked ? icon('check-circle') : icon('alert')} ${blocked ? 'Entsperren' : 'Sperren'}</button>` : ''}
            <button class="btn btn-ghost btn-sm" type="button" data-action="vehicle-details" data-id="${vehicle.id}">Details</button>
            ${canOn('vehicle', vehicle.id, 'bookings_create') ? `<button class="btn btn-soft btn-sm" type="button" data-action="book-vehicle" data-id="${vehicle.id}" ${disabled || blocked ? `disabled title="${blocked ? 'Fahrzeug ist dauerhaft gesperrt' : 'Fahrzeug befindet sich in Wartung'}"` : ''}>${icon('calendar')} Buchen</button>` : ''}
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
      canBase('vehicles_manage') ? `<button class="btn btn-ghost" type="button" data-action="new-vehicle">${icon('plus')} Fahrzeug anlegen</button>` : '')}
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
  const canCreateVehicle = canBase('vehicles_manage');
  const canCreateDriver = canBase('drivers_manage');
  const canPlanTrip = can('bookings_create');
  const hasSetupRight = canCreateVehicle || canCreateDriver;
  const headActions = [
    canCreateVehicle ? `<button class="btn btn-primary" type="button" data-action="new-vehicle">${icon('plus')} Erstes Fahrzeug</button>` : '',
    canPlanTrip ? `<button class="btn btn-ghost" type="button" data-action="new-booking">${icon('calendar')} Erste Buchung</button>` : ''
  ].join('');
  const asideActions = [
    canCreateVehicle ? `<button class="btn btn-primary" type="button" data-action="new-vehicle">${icon('car')} Fahrzeug anlegen</button>` : '',
    canCreateDriver ? `<button class="btn btn-ghost" type="button" data-action="new-driver">${icon('users')} Fahrer:in anlegen</button>` : ''
  ].join('');
  return `
    ${pageHead(formatDateLong(today), `${greeting}, ${esc(displayName)} <span class="wave">👋</span>`,
      hasSetupRight ? 'Willkommen im Fuhrparkmanagement. Legen Sie jetzt die ersten Stammdaten an.' : 'Willkommen im Fuhrparkmanagement. Die Stammdaten werden von der Administration gepflegt.',
      headActions)}
    <section class="card onboarding-card">
      <div class="onboarding-inner">
        <div>
          <span class="eyebrow">Erste Schritte</span>
          <h3 class="onboarding-title">${hasSetupRight ? 'Ihr Fuhrpark ist startklar – es fehlen nur noch die Stammdaten.' : 'Der Fuhrpark ist startklar – die Stammdaten werden zentral gepflegt.'}</h3>
          <p class="onboarding-text">Sobald Fahrzeuge und Fahrer:innen hinterlegt sind, können Sie Fahrten planen, Kilometerstände erfassen und Wartungen im Blick behalten.</p>
          <div class="onboarding-steps">
            <div class="onboarding-step"><span class="onboarding-step-number">1</span><div><strong>Fahrzeug anlegen</strong><span>Kennzeichen, Standort, Kilometerstand und HU/AU erfassen.</span></div></div>
            <div class="onboarding-step"><span class="onboarding-step-number">2</span><div><strong>Fahrer:in anlegen</strong><span>Kontaktdaten und Führerscheinklassen hinterlegen.</span></div></div>
            <div class="onboarding-step"><span class="onboarding-step-number">3</span><div><strong>Erste Fahrt planen</strong><span>Fahrzeug und Fahrer:in im Kalender zusammenbringen.</span></div></div>
          </div>
        </div>
        <aside class="onboarding-aside">
          <span class="onboarding-aside-label">${hasSetupRight ? 'Jetzt loslegen' : 'Hinweis'}</span>
          ${asideActions || '<p class="onboarding-text">Für das Anlegen von Stammdaten fehlt Ihrer Rolle die Berechtigung. Wenden Sie sich an die Administration.</p>'}
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
  const hasFleetAccess = ['vehicles_view', 'bookings_view', 'logbook_view', 'maintenance_view', 'costs_view', 'drivers_view'].some(can);
  if (!hasFleetAccess) {
    return `
      ${pageHead(formatDateLong(today), `${greeting}, ${esc(displayName)} <span class="wave">👋</span>`, 'Ihre Rolle enthält derzeit keine Einsicht in Fuhrparkdaten.', '<a class="btn btn-ghost" href="#/einstellungen">Einstellungen</a>')}
      <section class="card">${emptyState('shield', 'Keine Fuhrparkdaten freigegeben', 'Die Administration kann Ihrer Rolle unter „Rollen & Rechte“ die passenden Berechtigungen zuweisen.', '<a class="btn btn-primary btn-sm" href="#/einstellungen">Zum Konto</a>')}</section>`;
  }
  if (!db.vehicles.length && !db.drivers.length) {
    if (db.bookings.length) {
      return `
        ${pageHead(formatDateLong(today), `${greeting}, ${esc(displayName)} <span class="wave">👋</span>`, 'Ihre Rolle sieht abgeschlossene Fahrten im Fahrtenbuch.', '<a class="btn btn-primary" href="#/fahrtenbuch">Fahrtenbuch öffnen</a>')}
        <section class="card">${emptyState('book', 'Fahrtenbuch verfügbar', `${db.bookings.length} abgeschlossene ${db.bookings.length === 1 ? 'Fahrt ist' : 'Fahrten sind'} für Ihre Rolle sichtbar. Die allgemeine Fahrzeug- und Buchungsverwaltung bleibt gesperrt.`, '<a class="btn btn-primary btn-sm" href="#/fahrtenbuch">Zum Fahrtenbuch</a>')}</section>`;
    }
    return renderOnboarding(greeting, displayName);
  }
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

  const dashboardActions = [
    canBase('vehicles_manage') ? `<button class="btn btn-ghost" type="button" data-action="new-vehicle">${icon('plus')} Fahrzeug</button>` : '',
    can('bookings_create') ? `<button class="btn btn-primary" type="button" data-action="new-booking">${icon('plus')} Neue Buchung</button>` : ''
  ].join('');
  return `
    ${pageHead(formatDateLong(today), `${greeting}, ${esc(displayName)} <span class="wave">👋</span>`, 'Hier ist der aktuelle Überblick über Ihren Fuhrpark.', dashboardActions)}

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
          ${todayRows ? `<div class="trip-list">${todayRows}</div>` : emptyState('calendar', 'Heute keine Fahrten', 'Für heute sind noch keine Buchungen eingetragen.', can('bookings_create') ? '<button class="btn btn-soft btn-sm" type="button" data-action="new-booking">Buchung anlegen</button>' : '', true)}
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
  const canCreate = can('bookings_create');

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
    const vehicleCanCreate = canCreate && !vehicle.blocked && canOn('vehicle', vehicle.id, 'bookings_create');
    const cells = days.map((dateISO) => {
      const dayBookings = sortByDateAsc(bookings.filter((booking) => booking.vehicleId === vehicle.id && booking.start.slice(0, 10) === dateISO));
      return `<div class="cal-cell ${dateISO === today ? 'is-today' : ''} ${vehicleCanCreate ? '' : 'is-readonly'}"
        ${vehicleCanCreate ? `role="button" tabindex="0" data-action="calendar-cell" data-vehicle="${vehicle.id}" data-date="${dateISO}" aria-label="Buchung für ${esc(vehicle.name)} am ${formatDate(dateISO)} anlegen"` : ''}>
        ${dayBookings.length ? dayBookings.map(renderCalendarBookingChip).join('') : (vehicleCanCreate ? '<span class="cal-add">+</span>' : '')}
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
        <span>${canCreate ? 'Freie Zelle anklicken, um eine Buchung anzulegen.' : 'Lesende Ansicht – keine Berechtigung zum Buchen.'}</span>
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
    return emptyState('calendar', 'Noch keine Buchungen', 'Legen Sie die erste Fahrt für Ihren Fuhrpark an.', can('bookings_create') ? '<button class="btn btn-primary btn-sm" type="button" data-action="new-booking">Buchung anlegen</button>' : '');
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
            ${canOn('booking', booking.id, 'bookings_manage') && booking.status === 'planned' ? `<button class="table-action" type="button" title="Fahrt starten" aria-label="Fahrt starten" data-action="start-booking" data-id="${booking.id}">${icon('play')}</button>` : ''}
            ${canOn('booking', booking.id, 'bookings_manage') && booking.status === 'active' ? `<button class="table-action" type="button" title="Fahrt beenden" aria-label="Fahrt beenden" data-action="end-booking" data-id="${booking.id}">${icon('stop')}</button>` : ''}
            ${canOn('booking', booking.id, 'bookings_manage') && booking.status === 'planned' ? `<button class="table-action danger" type="button" title="Buchung stornieren" aria-label="Buchung stornieren" data-action="cancel-booking" data-id="${booking.id}">${icon('x')}</button>` : ''}
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
    const setupActions = [
      canBase('drivers_manage') ? `<button class="btn btn-ghost" type="button" data-action="new-driver">${icon('plus')} Fahrer:in</button>` : '',
      canBase('vehicles_manage') ? `<button class="btn btn-primary" type="button" data-action="new-vehicle">${icon('plus')} Fahrzeug anlegen</button>` : ''
    ].join('');
    return `
      ${pageHead('Planung', 'Buchungen', 'Fahrten planen, Konflikte vermeiden und den Überblick behalten.', setupActions)}
      <section class="card">${emptyState('calendar', 'Noch keine Buchungen möglich', 'Legen Sie zuerst ein Fahrzeug und eine Fahrer:in an, um Fahrten zu planen.', canBase('vehicles_manage') ? '<button class="btn btn-primary btn-sm" type="button" data-action="new-vehicle">Erstes Fahrzeug anlegen</button>' : '')}</section>`;
  }
  const headerActions = can('bookings_create') ? `<button class="btn btn-primary" type="button" data-action="new-booking">${icon('plus')} Neue Buchung</button>` : '';
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
      <div class="card-body tight">${rows || emptyState('shield', 'Keine Fahrzeuge vorhanden', 'Sobald Fahrzeuge angelegt sind, erscheinen hier die HU/AU-Termine.', canBase('vehicles_manage') ? '<button class="btn btn-soft btn-sm" type="button" data-action="new-vehicle">Fahrzeug anlegen</button>' : '', true)}</div>
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
              : (canOn('maintenance', item.id, 'maintenance_manage') ? `<button class="table-action" type="button" title="Als erledigt markieren" aria-label="Als erledigt markieren" data-action="mark-maintenance-done" data-id="${item.id}">${icon('check')}</button>` : '')}
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
  const showCosts = can('costs_view');

  return `
    ${pageHead('Fuhrpark', 'Wartung & TÜV', 'Werkstatttermine, Hauptuntersuchungen und offene Arbeiten zentral verwalten.',
      can('maintenance_manage') ? `<button class="btn btn-primary" type="button" data-action="new-maintenance">${icon('plus')} Wartung erfassen</button>` : '')}
    <div class="kpi-grid">
      ${metricCard({ label: 'Offene Arbeiten', value: openItems.length, sub: `${doneCount} in den letzten Monaten erledigt`, iconName: 'wrench', tint: 'tint-amber', badge: '<span class="badge badge-amber no-dot">Wartungsplan</span>', glow: 'rgba(184,104,0,.06)' })}
      ${metricCard({ label: 'Überfällig', value: overdueMaintenance.length + tuvOverdue.length, sub: `${overdueMaintenance.length} Wartungen · ${tuvOverdue.length} HU/AU`, iconName: 'alert', tint: 'tint-red', badge: `<span class="badge badge-${(overdueMaintenance.length + tuvOverdue.length) ? 'red' : 'green'}">${(overdueMaintenance.length + tuvOverdue.length) ? 'Handeln' : 'Ok'}</span>` })}
      ${metricCard({ label: 'HU/AU in 60 Tagen', value: tuvDue.length, sub: `${db.vehicles.length} Fahrzeuge insgesamt`, iconName: 'shield', tint: 'tint-blue', badge: '<span class="badge badge-blue no-dot">TÜV</span>', glow: 'rgba(37,99,235,.055)' })}
      ${showCosts ? metricCard({ label: 'Wartungskosten', value: formatMoney(maintenanceCosts), sub: 'Letzte 6 Monate', iconName: 'receipt', tint: 'tint-violet', badge: '<span class="badge badge-violet no-dot">Betrieb</span>', glow: 'rgba(109,71,217,.05)' }) : ''}
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
          ${showCosts ? `<a class="link-arrow" href="#/kosten">Kosten ${icon('arrow-right')}</a>` : ''}
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
  const canManageCosts = can('costs_manage');
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
  if (ui.costCenter === 'none') filteredCosts = filteredCosts.filter((cost) => !cost.costCenterId);
  else if (ui.costCenter !== 'all') filteredCosts = filteredCosts.filter((cost) => cost.costCenterId === ui.costCenter);
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
        <td>${costCenterBadge(cost)}</td>
        <td class="num"><span class="money">${formatMoney(cost.amount, 2)}</span></td>
        <td>
          <div class="table-actions">
            ${cost.receipt && canOn('cost', cost.id, 'costs_view') ? `<button class="table-action" type="button" title="Beleg ansehen" aria-label="Beleg ansehen" data-action="view-receipt" data-id="${cost.id}">${icon('paperclip')}</button>` : ''}
            ${canOn('cost', cost.id, 'costs_manage') ? `<button class="table-action danger" type="button" title="Kosten löschen" aria-label="Kosten löschen" data-action="delete-cost" data-id="${cost.id}">${icon('trash')}</button>` : ''}
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

  const costCenterTotals = new Map();
  for (const cost of entries) {
    const key = cost.costCenterId || '';
    const entry = costCenterTotals.get(key) || {
      id: key,
      label: cost.costCenterCode ? `${cost.costCenterCode} · ${cost.costCenterName || ''}`.trim() : 'Ohne Kostenstelle',
      amount: 0
    };
    entry.amount += Number(cost.amount);
    costCenterTotals.set(key, entry);
  }
  const costCenterRankingRows = [...costCenterTotals.values()].sort((a, b) => b.amount - a.amount);
  const maxCostCenter = costCenterRankingRows.length ? Math.max(...costCenterRankingRows.map((row) => row.amount)) : 0;
  const costCenterRanking = costCenterRankingRows.length ? costCenterRankingRows.slice(0, 8).map((row) => `
    <div class="hbar-item">
      <div class="hbar-head">
        <span>${esc(row.label)}</span>
        <strong>${formatMoney(row.amount)}</strong>
      </div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((row.amount / Math.max(maxCostCenter, 1)) * 100)}%;--bar-color:#0f8f8a"></div></div>
    </div>`).join('') : emptyState('receipt', 'Keine Kostenstellen', 'Ordnen Sie Kostenpositionen einer Kostenstelle zu, um die Auswertung zu sehen.', '', true);

  return `
    ${pageHead('Controlling', 'Kosten', 'Betriebskosten der letzten sechs Monate transparent aufbereitet.',
      canManageCosts ? `<button class="btn btn-primary" type="button" data-action="new-cost">${icon('plus')} Kosten erfassen</button>` : '')}
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
          ${can('cost_centers_view') ? `<select class="select select-sm" id="costCenterFilter" aria-label="Kostenstelle filtern">
            <option value="all">Alle Kostenstellen</option>
            <option value="none" ${ui.costCenter === 'none' ? 'selected' : ''}>Ohne Kostenstelle</option>
            ${(db.costCenters || []).map((costCenter) => `<option value="${costCenter.id}" ${ui.costCenter === costCenter.id ? 'selected' : ''}>${esc(costCenter.code)} · ${esc(costCenter.name)}${costCenter.active ? '' : ' · inaktiv'}</option>`).join('')}
          </select>` : ''}
        </div>
        ${filteredCosts.length ? `<div class="table-wrap is-scroll"><table class="data-table">
          <thead><tr><th>Datum</th><th>Fahrzeug</th><th>Kostenart / Beschreibung</th><th>Kostenstelle</th><th class="num">Betrag</th><th class="num"></th></tr></thead>
          <tbody>${costRows}</tbody>
        </table></div>` : emptyState('receipt', 'Keine Kosten gefunden', 'Ändern Sie die Filter oder erfassen Sie eine neue Kostenposition.', '', true)}
        <div class="card-footer">
          <span class="text-muted">Belege werden serverseitig gespeichert und sind für berechtigte Nutzer:innen abrufbar.</span>
          ${canManageCosts ? `<button class="btn-link" type="button" data-action="new-cost">${icon('plus')} Kosten hinzufügen</button>` : ''}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div><h3 class="card-title">Kosten nach Fahrzeug</h3><p class="card-sub">Betriebskosten der letzten 6 Monate</p></div></div>
        <div class="card-body"><div class="hbar-list">${vehicleRanking}</div></div>
        <div class="card-footer"><span class="text-muted">Höchster Wert: ${formatMoney(maxVehicle)}</span><a class="link-arrow" href="#/fahrzeuge">Flotte ${icon('arrow-right')}</a></div>
      </section>
    </div>

    <section class="card mt-18">
      <div class="card-head"><div><h3 class="card-title">Kosten nach Kostenstelle</h3><p class="card-sub">Betriebskosten der letzten 6 Monate</p></div></div>
      <div class="card-body"><div class="hbar-list">${costCenterRanking}</div></div>
      <div class="card-footer"><span class="text-muted">Höchster Wert: ${formatMoney(maxCostCenter)}</span>${can('cost_centers_view') ? `<a class="link-arrow" href="#/einstellungen">Kostenstellen ${icon('arrow-right')}</a>` : ''}</div>
    </section>`;
}

/* =========================================================
   Fahrtenbuch
   ========================================================= */
function renderLogbook() {
  const canManageLog = can('logbook_manage');
  const canExportLog = can('logbook_export');
  const trips = getLogbookTrips();
  const distance = trips.reduce((sum, trip) => sum + Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0)), 0);
  const average = trips.length ? distance / trips.length : 0;
  const vehiclesUsed = new Set(trips.map((trip) => trip.vehicleId)).size;

  const rows = trips.map((trip) => {
    const vehicle = bookingVehicle(trip);
    const driver = bookingDriver(trip);
    const km = Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0));
    return `
      <tr>
        <td><span class="table-main">${formatDate(trip.start)}</span><span class="table-sub">${WEEKDAYS[(parseISODate(trip.start).getDay() + 6) % 7]}</span></td>
        <td><div class="table-vehicle">${vehicleDot(vehicle)}<div><span class="table-main">${esc(vehicle ? vehicle.name : '—')}</span><span class="table-sub">${esc(vehicle ? vehicle.plate : '')}</span></div></div></td>
        <td><div class="table-person">${driverAvatar(driver, 'avatar-sm')}<span>${esc(driver ? driver.name : '—')}</span></div></td>
        <td><span class="table-main">${esc(trip.purpose)}</span><span class="table-sub">${formatTimeRange(trip.start, trip.end)}</span></td>
        <td>${costCenterBadge(trip)}</td>
        <td><span class="table-main">${formatNumber(trip.startKm)}</span><span class="table-sub">bis ${formatNumber(trip.endKm)} km</span></td>
        <td class="num"><span class="money">${formatNumber(km)} km</span></td>
        <td><div class="table-actions"><button class="table-action" type="button" title="Details ansehen" aria-label="Details ansehen" data-action="booking-details" data-id="${trip.id}">${icon('info')}</button></div></td>
      </tr>`;
  }).join('');

  return `
    ${pageHead('Fahrtenbuch', 'Fahrtenbuch', 'Gefahrene Strecken, Kilometerstände und Fahrer:innen dokumentieren.',
      [
        canExportLog ? `<button class="btn btn-ghost" type="button" data-action="export-log">${icon('download')} CSV exportieren</button>` : '',
        canManageLog ? `<button class="btn btn-primary" type="button" data-action="new-log">${icon('plus')} Fahrt nachtragen</button>` : ''
      ].join(''))}
    <div class="kpi-grid">
      ${metricCard({ label: 'Fahrten', value: trips.length, sub: ui.logPeriod === 'all' ? 'Alle dokumentierten Fahrten' : 'Im ausgewählten Zeitraum', iconName: 'route', tint: 'tint-blue', badge: '<span class="badge badge-blue no-dot">Fahrtenbuch</span>', glow: 'rgba(37,99,235,.055)' })}
      ${metricCard({ label: 'Gefahrene Kilometer', value: formatNumber(distance), sub: `≈ ${formatDecimal(average, 0)} km pro Fahrt`, iconName: 'gauge', tint: 'tint-green', badge: '<span class="badge badge-green no-dot">Strecke</span>', glow: 'rgba(17,138,91,.055)' })}
      ${metricCard({ label: 'Fahrzeuge im Einsatz', value: vehiclesUsed, sub: `${vehiclesUsed} ${vehiclesUsed === 1 ? 'Fahrzeug' : 'Fahrzeuge'} im Fahrtenbuch`, iconName: 'car', tint: 'tint-teal', badge: '<span class="badge badge-teal no-dot">Flotte</span>', glow: 'rgba(15,143,138,.055)' })}
      ${metricCard({ label: 'Ø Distanz', value: `${formatDecimal(average, 0)} km`, sub: 'Pro dokumentierter Fahrt', iconName: 'trend-up', tint: 'tint-violet', badge: '<span class="badge badge-violet no-dot">Kennzahl</span>', glow: 'rgba(109,71,217,.05)' })}
    </div>
    <section class="card mt-18">
      <div class="card-head bordered">
        <div><h3 class="card-title">Fahrtenübersicht</h3><p class="card-sub">${trips.length} abgeschlossene Fahrten · ${formatNumber(distance)} km</p></div>
        <div class="card-head-side">
          ${can('cost_centers_view') ? `<select class="select select-sm" id="logCostCenterFilter" style="width:auto" aria-label="Kostenstelle filtern">
            <option value="all">Alle Kostenstellen</option>
            <option value="none" ${ui.logCostCenter === 'none' ? 'selected' : ''}>Ohne Kostenstelle</option>
            ${(db.costCenters || []).map((costCenter) => `<option value="${costCenter.id}" ${ui.logCostCenter === costCenter.id ? 'selected' : ''}>${esc(costCenter.code)} · ${esc(costCenter.name)}${costCenter.active ? '' : ' · inaktiv'}</option>`).join('')}
          </select>` : ''}
          <select class="select select-sm" id="logPeriod" style="width:auto" aria-label="Zeitraum auswählen">
            <option value="30" ${ui.logPeriod === '30' ? 'selected' : ''}>Letzte 30 Tage</option>
            <option value="90" ${ui.logPeriod === '90' ? 'selected' : ''}>Letzte 90 Tage</option>
            <option value="all" ${ui.logPeriod === 'all' ? 'selected' : ''}>Alle Fahrten</option>
          </select>
        </div>
      </div>
      ${trips.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Datum</th><th>Fahrzeug</th><th>Fahrer:in</th><th>Zweck / Zeit</th><th>Kostenstelle</th><th>Kilometerstand</th><th class="num">Distanz</th><th class="num"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('book', 'Keine Fahrten im Zeitraum', 'Wählen Sie einen anderen Zeitraum oder tragen Sie eine Fahrt nach.', canManageLog ? '<button class="btn btn-soft btn-sm" type="button" data-action="new-log">Fahrt nachtragen</button>' : '')}
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
            ${costCenterBadge(driver, 'Keine Kostenstelle')}
          </div>
          ${canOn('driver', driver.id, 'drivers_manage') ? `<button class="table-action" type="button" title="Fahrer:in bearbeiten" aria-label="Fahrer:in bearbeiten" data-action="edit-driver" data-id="${driver.id}">${icon('edit')}</button>` : ''}
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
      canBase('drivers_manage') ? `<button class="btn btn-primary" type="button" data-action="new-driver">${icon('plus')} Fahrer:in anlegen</button>` : '')}
    <div class="summary-chips" style="margin-bottom:18px">
      <span class="summary-chip"><span class="dot" style="--dot:var(--green)"></span><strong>${available}</strong> verfügbar</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--blue)"></span><strong>${active}</strong> im Einsatz</span>
      <span class="summary-chip"><span class="dot" style="--dot:#aeb5c0"></span><strong>${away}</strong> abwesend</span>
      <span class="summary-chip">${icon('id')} ${db.drivers.filter((driver) => driver.license.some((license) => ['BE', 'C1', 'D1'].includes(license))).length} mit erweitertem Führerschein</span>
    </div>
    ${db.drivers.length ? `<div class="driver-grid">${cards}</div>` : emptyState('users', 'Noch keine Fahrer:innen', 'Legen Sie die ersten Mitarbeitenden an, damit Fahrten zugewiesen werden können.', canBase('drivers_manage') ? '<button class="btn btn-primary btn-sm" type="button" data-action="new-driver">Fahrer:in anlegen</button>' : '')}`;
}

/* =========================================================
   Einstellungen
   ========================================================= */
function renderBrandingCard() {
  if (!can('branding_manage')) return '';
  const theme = db.settings.theme === 'neutral' ? 'neutral' : 'awo';
  const neutralName = db.settings.brandName || db.settings.orgName || 'Fuhrparkmanagement';
  const pickColor = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
  const customAccent = pickColor(db.settings.accentColor, '#0f766e');
  const customSidebar = db.settings.sidebarStyle === 'light' ? 'light' : 'dark';
  const customPageBackground = pickColor(db.settings.pageBackground, '#f4f5f7');
  const customSurface = pickColor(db.settings.surfaceColor, '#ffffff');
  const customText = pickColor(db.settings.textColor, '#191c23');
  const customMuted = pickColor(db.settings.mutedColor, '#737a88');
  const customBorder = pickColor(db.settings.borderColor, '#e7e9ee');
  const initialsValue = initials(neutralName);
  const neutralLogoPreview = db.settings.logoUrl
    ? `<img src="${esc(db.settings.logoUrl)}" alt="Aktuelles Logo">`
    : `<span class="theme-initials" style="background:${esc(customAccent)}">${esc(initialsValue)}</span>`;
  const accentPresets = [
    ['#0f766e', 'Petrol'],
    ['#2563eb', 'Blau'],
    ['#7c3aed', 'Violett'],
    ['#047857', 'Grün'],
    ['#b45309', 'Bernstein'],
    ['#be123c', 'Rot'],
    ['#475569', 'Grau']
  ];
  const accentSwatches = accentPresets.map(([color, label]) => `<button class="accent-swatch ${customAccent.toLowerCase() === color ? 'is-selected' : ''}" type="button" title="${label}" aria-label="Akzentfarbe ${label}" data-action="set-brand-accent" data-color="${color}" style="--swatch:${color}"></button>`).join('');
  const colorField = (id, label, value) => `
    <label class="color-field" for="${id}">
      <span>${label}</span>
      <span class="color-field-control">
        <input type="color" id="${id}" name="${id}" value="${esc(value)}">
        <em>${esc(value.toUpperCase())}</em>
      </span>
    </label>`;
  return `
    <form class="card settings-card" id="brandingForm">
      <div class="card-head bordered">
        <div><h3 class="card-title">Erscheinungsbild</h3><p class="card-sub">Global für alle Nutzer:innen und die Anmeldeseite.</p></div>
        <span class="badge badge-red no-dot">Administration</span>
      </div>
      <div class="card-body">
        <div class="theme-grid">
          <label class="theme-choice ${theme === 'awo' ? 'is-selected' : ''}">
            <input type="radio" name="brandingTheme" value="awo" ${theme === 'awo' ? 'checked' : ''}>
            <span class="theme-choice-preview theme-preview-awo"><img src="/branding/awo-logo.svg" alt="AWO"></span>
            <span class="theme-choice-copy"><strong>AWO</strong><span>Allgemeines AWO-Theme mit offiziellem Logo.</span></span>
          </label>
          <label class="theme-choice ${theme === 'neutral' ? 'is-selected' : ''}">
            <input type="radio" name="brandingTheme" value="neutral" ${theme === 'neutral' ? 'checked' : ''}>
            <span class="theme-choice-preview theme-preview-neutral" id="brandingNeutralPreview">${neutralLogoPreview}</span>
            <span class="theme-choice-copy"><strong>Neutral</strong><span>Eigenes Branding ohne feste Organisation.</span></span>
          </label>
        </div>

        <div class="branding-logo-field" id="brandingLogoField" ${theme === 'neutral' ? '' : 'hidden'}>
          <div class="field">
            <label for="brandingName">Anzeigename <span class="optional">*</span></label>
            <input class="input" id="brandingName" name="brandingName" type="text" value="${esc(neutralName)}" maxlength="120">
            <p class="field-hint">Erscheint im Menü, auf der Anmeldeseite und im Footer des neutralen Themes.</p>
          </div>

          <div class="branding-options">
            <div class="field">
              <label for="brandingAccent">Akzentfarbe</label>
              <div class="accent-picker">
                <input class="accent-color-input" id="brandingAccent" name="brandingAccent" type="color" value="${esc(customAccent)}" aria-label="Eigene Akzentfarbe">
                <span class="accent-value">${esc(customAccent.toUpperCase())}</span>
              </div>
              <div class="accent-swatches">${accentSwatches}</div>
              <p class="field-hint">Bestimmt Buttons, aktive Navigation und Hervorhebungen.</p>
            </div>

            <div class="field">
              <label>Sidebar-Stil</label>
              <div class="sidebar-style-grid">
                <label class="sidebar-style-choice ${customSidebar === 'dark' ? 'is-selected' : ''}">
                  <input type="radio" name="brandingSidebar" value="dark" ${customSidebar === 'dark' ? 'checked' : ''}>
                  <span class="sidebar-style-preview is-dark"><i></i><i></i><i></i></span>
                  <strong>Dunkel</strong>
                </label>
                <label class="sidebar-style-choice ${customSidebar === 'light' ? 'is-selected' : ''}">
                  <input type="radio" name="brandingSidebar" value="light" ${customSidebar === 'light' ? 'checked' : ''}>
                  <span class="sidebar-style-preview is-light"><i></i><i></i><i></i></span>
                  <strong>Hell</strong>
                </label>
              </div>
            </div>
          </div>

          <details class="branding-advanced">
            <summary>Weitere Farben <span>Seite, Karten, Text und Rahmen</span></summary>
            <div class="branding-color-grid">
              ${colorField('brandingPageBackground', 'Seitenhintergrund', customPageBackground)}
              ${colorField('brandingSurface', 'Karten / Flächen', customSurface)}
              ${colorField('brandingText', 'Textfarbe', customText)}
              ${colorField('brandingMuted', 'Sekundärtext', customMuted)}
              ${colorField('brandingBorder', 'Rahmen', customBorder)}
            </div>
            <button class="btn btn-ghost btn-sm" type="button" data-action="reset-brand-colors">Standardfarben</button>
          </details>

          <div class="branding-preview">
            <div class="branding-preview-head"><span>Live-Vorschau</span><span class="badge badge-gray no-dot">Neutral</span></div>
            <div class="theme-preview-app ${customSidebar === 'light' ? 'is-light-sidebar' : ''}" id="themePreviewApp" style="--preview-accent:${esc(customAccent)};--preview-bg:${esc(customPageBackground)};--preview-surface:${esc(customSurface)};--preview-text:${esc(customText)};--preview-muted:${esc(customMuted)};--preview-border:${esc(customBorder)};">
              <div class="preview-sidebar">
                <div class="preview-brand"><span class="preview-logo" id="previewLogo">${esc(initialsValue)}</span><span class="preview-brand-name" id="previewBrandName">${esc(neutralName)}</span></div>
                <span class="preview-nav is-active">Dashboard</span>
                <span class="preview-nav">Fahrzeuge</span>
                <span class="preview-nav">Buchungen</span>
              </div>
              <div class="preview-content">
                <div class="preview-top"><strong>Dashboard</strong><span class="preview-button">Neue Buchung</span></div>
                <div class="preview-kpis">
                  <div class="preview-kpi"><span>Fahrzeuge</span><strong>8</strong></div>
                  <div class="preview-kpi"><span>Buchungen</span><strong>4</strong></div>
                  <div class="preview-kpi"><span>Verfügbar</span><strong>5</strong></div>
                </div>
                <div class="preview-content-box"><strong>Heute im Einsatz</strong><span>Hausbesuche Ambulante Pflege</span><span>Seniorenausflug Weserpromenade</span></div>
              </div>
            </div>
          </div>

          <label>Eigenes Logo <span class="optional">optional</span></label>
          <div class="image-upload">
            <div class="image-upload-preview" id="brandingLogoPreview">${neutralLogoPreview}</div>
            <div class="image-upload-copy">
              <strong>Logo für das neutrale Theme</strong>
              <p>PNG, JPG oder WebP. Das Logo wird auf weißem Hintergrund angezeigt und automatisch verkleinert.</p>
              <div class="image-upload-actions">
                <label class="btn btn-ghost btn-sm" for="brandingLogoInput">${icon('download')} Logo auswählen</label>
                <button class="btn btn-ghost btn-sm" type="button" id="brandingLogoRemove" data-action="remove-branding-logo" ${db.settings.logoUrl ? '' : 'hidden'}>${icon('trash')} Entfernen</button>
              </div>
            </div>
            <input class="sr-only" id="brandingLogoInput" type="file" accept="image/png,image/jpeg,image/webp">
            <input type="hidden" id="brandingRemoveLogo" value="0">
          </div>
        </div>

        <div class="info-banner" style="margin-top:16px">
          ${icon('info')}
          <div><strong>Zentrale Einstellung</strong><p>Diese Auswahl gilt für alle Benutzer:innen und die Anmeldeseite. Andere Nutzer sehen die Änderung beim nächsten Laden. Individuelle Themes pro Konto gibt es nicht.</p></div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Das Theme wird beim Speichern sofort übernommen.</span>
        <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Erscheinungsbild speichern</button>
      </div>
    </form>`;
}

function driverLinkStatus(driver) {
  if (!driver) return null;
  if (driver.status === 'away') return { label: 'Abwesend', badge: 'gray' };
  const active = (db.bookings || []).some((booking) => booking.driverId === driver.id && booking.status === 'active');
  return active
    ? { label: 'Im Einsatz', badge: 'blue' }
    : { label: 'Verfügbar', badge: 'green' };
}

function renderAdminDriverProfileCard() {
  if (!capabilities?.isAdmin && !currentUser?.isAdmin) return '';
  const drivers = Array.isArray(db.drivers) ? db.drivers : [];
  const linkedDriver = drivers.find((driver) => driver.userId === currentUser?.id) || null;
  const availableDrivers = drivers
    .filter((driver) => !driver.userId || driver.id === linkedDriver?.id)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  const status = driverLinkStatus(linkedDriver);
  const ownTripsChecked = linkedDriver ? linkedDriver.ownTripsAccess !== false : true;
  const driverOptions = availableDrivers.map((driver) => `
    <option value="${esc(driver.id)}" ${driver.id === linkedDriver?.id ? 'selected' : ''}>${esc(driver.name)} · ${esc(driver.role || 'Fahrer:in')}</option>
  `).join('');
  const currentLink = linkedDriver
    ? `<div class="detail-list-item">
        ${driverAvatar(linkedDriver, 'avatar-lg')}
        <div class="main"><strong>${esc(linkedDriver.name)}</strong><span>${esc(linkedDriver.role || 'Fahrer:in')}</span></div>
        <span class="badge badge-${status.badge} no-dot">${status.label}</span>
      </div>`
    : `<div class="detail-list-item">
        <span class="mini-icon tint-blue">${icon('users')}</span>
        <div class="main"><strong>Nicht verknüpft</strong><span>Ihr Administratorkonto ist derzeit keinem Fahrerprofil zugeordnet.</span></div>
      </div>`;
  const cardHead = `
    <div class="card-head bordered">
      <div><h3 class="card-title">Fahrerprofil</h3><p class="card-sub">Verknüpfung mit Ihrem Administratorkonto</p></div>
      <span class="badge badge-red no-dot">Administration</span>
    </div>`;
  if (!availableDrivers.length) {
    const emptyTitle = drivers.length ? 'Keine freien Fahrer:innen' : 'Noch keine Fahrer:innen';
    const emptyText = drivers.length
      ? 'Alle Fahrerprofile sind bereits mit anderen Konten verknüpft. Entfernen Sie dort zuerst die Verknüpfung.'
      : 'Legen Sie zuerst ein Fahrerprofil an, um es mit Ihrem Administratorkonto zu verknüpfen.';
    return `
      <section class="card settings-card">
        ${cardHead}
        <div class="card-body">
          <div class="detail-list" style="margin-bottom:16px">${currentLink}</div>
          ${emptyState('users', emptyTitle, emptyText, '', true)}
        </div>
      </section>`;
  }
  return `
    <form class="card settings-card" id="driverLinkForm" novalidate>
      ${cardHead}
      <div class="card-body">
        <div class="form-alert">${icon('alert')}<span></span></div>
        <div class="detail-list" style="margin-bottom:16px">${currentLink}</div>
        <div class="form-grid">
          <div class="field field-full">
            <label for="driverLinkSelect">${linkedDriver ? 'Fahrerprofil wechseln' : 'Fahrerprofil auswählen'}</label>
            <select class="select" id="driverLinkSelect" name="driverId" data-linked-driver="${esc(linkedDriver?.id || '')}" required>
              ${linkedDriver ? '' : '<option value="" selected disabled>Bitte auswählen …</option>'}
              ${driverOptions}
            </select>
            <p class="field-hint">Nur freie Fahrerprofile oder Ihre eigene Verknüpfung sind auswählbar.</p>
          </div>
          <div class="field field-full" id="driverLinkAccessField" ${linkedDriver ? '' : 'hidden'}>
            <label class="check-row"><input type="checkbox" id="driverLinkOwnTripsAccess" name="ownTripsAccess" ${ownTripsChecked ? 'checked' : ''} ${linkedDriver ? '' : 'disabled'}> Standardzugriff auf Meine Fahrten aktiv</label>
            <p class="field-hint">Gilt für die Verknüpfung mit Ihrem Administratorkonto. Explizite Rollen- und Benutzerregeln können den Standard übersteuern.</p>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">${linkedDriver ? 'Änderungen gelten sofort für Ihr Konto.' : 'Die Verknüpfung ist optional.'}</span>
        <div class="setting-actions" style="margin-top:0">
          ${linkedDriver ? `<button class="btn btn-danger-ghost btn-sm" type="button" data-action="unlink-admin-driver">${icon('x')} Entfernen</button>` : ''}
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} ${linkedDriver ? 'Speichern' : 'Verknüpfen'}</button>
        </div>
      </div>
    </form>`;
}

function renderSmtpCard() {
  const isAdmin = Boolean(capabilities.isAdmin || capabilities.isSuperadmin);
  const smtp = db.smtp;
  if (!isAdmin || !smtp) return '';
  return `
    <form class="card settings-card" id="smtpForm" autocomplete="off">
      <div class="card-head bordered">
        <div><h3 class="card-title">E-Mail-Versand</h3><p class="card-sub">SMTP für Leasing-Warnungen. Nur für Administrator:innen sichtbar.</p></div>
        <span class="badge badge-${smtp.enabled ? 'green' : 'gray'} no-dot">${smtp.enabled ? 'Aktiv' : 'Inaktiv'}</span>
      </div>
      <div class="card-body">
        <div class="info-banner" style="margin-bottom:16px">
          ${icon('lock')}
          <div><strong>Passwort getrennt gespeichert</strong><p>Das SMTP-Passwort liegt ausschließlich in einer geschützten Datei im Datenverzeichnis. Es erscheint nicht im State, im Export oder in Audit-Einträgen.</p></div>
        </div>
        <div class="form-grid">
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" id="smtpEnabled" name="smtpEnabled" ${smtp.enabled ? 'checked' : ''}> E-Mail-Versand aktivieren</label>
            <p class="field-hint">Ohne Aktivierung werden keine Leasing-Benachrichtigungen versendet.</p>
          </div>
          <div class="field">
            <label for="smtpHost">SMTP-Host</label>
            <input class="input" id="smtpHost" name="smtpHost" type="text" value="${esc(smtp.host)}" maxlength="255" placeholder="smtp.example.org">
          </div>
          <div class="field">
            <label for="smtpPort">Port</label>
            <input class="input" id="smtpPort" name="smtpPort" type="number" min="1" max="65535" value="${Number(smtp.port) || 587}">
          </div>
          <div class="field">
            <label class="check-row"><input type="checkbox" id="smtpSecure" name="smtpSecure" ${smtp.secure ? 'checked' : ''}> Implizites TLS (meist Port 465)</label>
          </div>
          <div class="field">
            <label for="smtpFrom">Absenderadresse</label>
            <input class="input" id="smtpFrom" name="smtpFrom" type="email" value="${esc(smtp.fromAddress)}" maxlength="200" placeholder="fuhrpark@example.org">
          </div>
          <div class="field">
            <label for="smtpUsername">Benutzername <span class="optional">optional</span></label>
            <input class="input" id="smtpUsername" name="smtpUsername" type="text" value="${esc(smtp.username)}" maxlength="200" autocomplete="username">
          </div>
          <div class="field">
            <label for="smtpPassword">Passwort <span class="optional">optional</span></label>
            <input class="input" id="smtpPassword" name="smtpPassword" type="password" value="" maxlength="500" autocomplete="new-password" placeholder="${smtp.passwordSet ? 'Gespeichert – leer lassen zum Beibehalten' : 'Noch kein Passwort gespeichert'}">
          </div>
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" id="smtpClearPassword" name="smtpClearPassword"> Gespeichertes Passwort entfernen</label>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">${smtp.ready ? 'Konfiguration vollständig.' : smtp.enabled ? 'Konfiguration unvollständig.' : 'Versand ist deaktiviert.'}</span>
        <div class="setting-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="smtp-test">${icon('mail')} Test-E-Mail</button>
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </div>
    </form>`;
}

function renderColorModeSwitch() {
  const preference = currentUser?.colorMode || db.settings.defaultColorMode || 'light';
  const options = [
    ['light', 'Hell', 'sun', 'Helles Farbschema'],
    ['dark', 'Dunkel', 'moon', 'Dunkles Farbschema'],
    ['auto', 'Auto', 'monitor', 'Automatik folgt der Systemeinstellung']
  ];
  return `
    <div class="color-mode-setting">
      <div class="color-mode-setting-head"><strong>Farbschema</strong><span>Gilt für Ihr Konto</span></div>
      <div class="color-mode-switch" role="group" aria-label="Farbschema">
        ${options.map(([mode, label, iconName, ariaLabel]) => `<button class="color-mode-option" type="button" data-action="set-color-mode" data-mode="${mode}" data-color-mode-option="${mode}" aria-pressed="${preference === mode ? 'true' : 'false'}" aria-label="${ariaLabel}" title="${ariaLabel}">${icon(iconName)}<span>${label}</span></button>`).join('')}
      </div>
      <p class="field-hint">${preference === 'auto' ? 'Automatik folgt der Systemeinstellung des Geräts.' : `Aktuell: ${preference === 'dark' ? 'Dunkel' : 'Hell'}.`}</p>
    </div>`;
}

function renderCostCentersCard() {
  if (!can('cost_centers_view')) return '';
  const canManage = can('cost_centers_manage');
  const centers = db.costCenters || [];
  const rows = centers.map((costCenter) => {
    const usage = costCenter.usage || {};
    const usageTotal = Number(usage.total) || 0;
    return `
      <tr>
        <td><span class="badge badge-gray no-dot">${esc(costCenter.code)}</span></td>
        <td><span class="table-main">${esc(costCenter.name)}</span><span class="table-sub">${esc(costCenter.description || 'Keine Beschreibung')}</span></td>
        <td>${costCenter.active ? '<span class="badge badge-green no-dot">Aktiv</span>' : '<span class="badge badge-gray no-dot">Inaktiv</span>'}</td>
        <td><span class="table-main">${usageTotal}</span><span class="table-sub">${usageTotal === 1 ? 'Verwendung' : 'Verwendungen'}</span></td>
        <td>
          <div class="table-actions">
            ${canManage ? `<button class="table-action" type="button" title="Kostenstelle bearbeiten" aria-label="Kostenstelle bearbeiten" data-action="edit-cost-center" data-id="${costCenter.id}">${icon('edit')}</button>` : ''}
            ${canManage ? `<button class="table-action" type="button" title="${costCenter.active ? 'Kostenstelle deaktivieren' : 'Kostenstelle aktivieren'}" aria-label="${costCenter.active ? 'Kostenstelle deaktivieren' : 'Kostenstelle aktivieren'}" data-action="toggle-cost-center-active" data-id="${costCenter.id}">${icon(costCenter.active ? 'x' : 'check-circle')}</button>` : ''}
            ${canManage && usageTotal === 0 ? `<button class="table-action danger" type="button" title="Kostenstelle löschen" aria-label="Kostenstelle löschen" data-action="delete-cost-center" data-id="${costCenter.id}">${icon('trash')}</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
  return `
    <section class="card" id="costCentersCard">
      <div class="card-head bordered">
        <div><h3 class="card-title">Kostenstellen</h3><p class="card-sub">Stammdaten, Zuordnungen und Nutzung verwalten.</p></div>
        ${canManage ? `<button class="btn btn-primary btn-sm" type="button" data-action="new-cost-center">${icon('plus')} Kostenstelle anlegen</button>` : '<span class="badge badge-gray no-dot">Nur lesen</span>'}
      </div>
      <div class="card-body">
        ${centers.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Code</th><th>Bezeichnung</th><th>Status</th><th>Nutzung</th><th class="num"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : emptyState('receipt', 'Noch keine Kostenstellen', 'Legen Sie Kostenstellen an, um Fahrzeuge, Fahrer:innen, Buchungen und Kosten zuzuordnen.', canManage ? '<button class="btn btn-primary btn-sm" type="button" data-action="new-cost-center">Kostenstelle anlegen</button>' : '')}
      </div>
      <div class="card-footer"><span class="text-muted">Löschen ist nur ohne Zuordnungen möglich; sonst bitte deaktivieren.</span></div>
    </section>`;
}

function renderSecurityCard() {
  const security = db.security || {};
  const active = Boolean(security.totpEnabled);
  const lockedUntil = security.lockedUntil ? new Date(security.lockedUntil) : null;
  const locked = lockedUntil && lockedUntil.getTime() > Date.now();
  const statusBadge = active
    ? '<span class="badge badge-green no-dot">TOTP aktiv</span>'
    : '<span class="badge badge-gray no-dot">Nicht eingerichtet</span>';
  const statusText = active
    ? `Bestätigt${security.confirmedAt ? ` am ${formatDate(security.confirmedAt)}` : ''}`
    : 'Optionaler Schutz mit Authenticator-App und Recovery-Codes.';
  const lockBanner = locked
    ? `<div class="info-banner is-danger" style="margin-top:14px">
        ${icon('alert')}
        <div><strong>Vorübergehend gesperrt</strong><p>Zu viele Fehlversuche. Neue Versuche sind ab ${formatDateTime(security.lockedUntil)} wieder möglich.</p></div>
      </div>`
    : '';
  return `
    <section class="card" id="securityCard">
      <div class="card-head">
        <div><h3 class="card-title">Sicherheit</h3><p class="card-sub">Freiwillige Zwei-Faktor-Authentifizierung für Ihr Konto</p></div>
        ${statusBadge}
      </div>
      <div class="card-body">
        <div class="detail-list">
          <div class="detail-list-item">
            <span class="mini-icon tint-green">${icon('shield')}</span>
            <div class="main"><strong>Authenticator-App (TOTP)</strong><span>${statusText}</span></div>
          </div>
          <div class="detail-list-item">
            <span class="mini-icon tint-blue">${icon('lock')}</span>
            <div class="main"><strong>Recovery-Codes</strong><span>${active ? `${security.recoveryCodesRemaining || 0} von 10 Codes verfügbar` : 'Werden bei der Einrichtung einmalig ausgegeben.'}</span></div>
          </div>
          ${active && security.lastVerifiedAt ? `<div class="detail-list-item">
            <span class="mini-icon tint-violet">${icon('history')}</span>
            <div class="main"><strong>Zuletzt bestätigt</strong><span>${formatDateTime(security.lastVerifiedAt)}</span></div>
          </div>` : ''}
        </div>
        ${security.passkeyEnabled ? `
          <div class="passkey-feature">
            <div class="passkey-head">
              <div><strong>Passkeys</strong><span>${security.passkeyCount ? `${security.passkeyCount} hinterlegt` : 'Noch kein Passkey hinterlegt'}</span></div>
              <button class="btn btn-ghost btn-sm" type="button" data-action="add-passkey">${icon('plus')} Passkey hinzufügen</button>
            </div>
            ${(security.passkeys || []).length ? `<div class="passkey-list">
              ${(security.passkeys || []).map((passkey) => `<div class="passkey-item">
                <span class="mini-icon tint-violet">${icon('lock')}</span>
                <div class="main"><strong>${esc(passkey.name || 'Passkey')}</strong><span>Angelegt ${formatDateTime(passkey.createdAt)}${passkey.lastUsedAt ? ` · zuletzt ${formatDateTime(passkey.lastUsedAt)}` : ''}</span></div>
                <div class="passkey-actions">
                  <button class="table-action" type="button" title="Passkey umbenennen" aria-label="Passkey umbenennen" data-action="rename-passkey" data-id="${passkey.id}">${icon('edit')}</button>
                  <button class="table-action danger" type="button" title="Passkey entfernen" aria-label="Passkey entfernen" data-action="delete-passkey" data-id="${passkey.id}">${icon('trash')}</button>
                </div>
              </div>`).join('')}
            </div>` : '<p class="passkey-empty">Fügen Sie einen Passkey für diesen Browser oder ein Gerät hinzu.</p>'}
          </div>` : `<div class="info-banner" style="margin-top:14px">${icon('info')}<div><strong>Passkeys nicht konfiguriert</strong><p>Die Administration muss WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME und WEBAUTHN_ORIGIN einrichten.</p></div></div>`}
        <div class="setting-actions">
          ${active
            ? `<button class="btn btn-ghost btn-sm" type="button" data-action="mfa-regenerate">${icon('history')} Recovery-Codes neu ausgeben</button>
               <button class="btn btn-danger-ghost btn-sm" type="button" data-action="mfa-disable">${icon('lock')} MFA deaktivieren</button>`
            : `<button class="btn btn-primary btn-sm" type="button" data-action="mfa-enroll">${icon('shield')} TOTP einrichten</button>`}
        </div>
        ${lockBanner}
      </div>
      <div class="card-footer">
        <span class="text-muted">MFA ist freiwillig und gilt nur für Ihr Konto. Administrator:innen können MFA zu Support-Zwecken zurücksetzen.</span>
      </div>
    </section>`;
}

function renderLocationsCard() {
  const locations = db.locations || [];
  return `
    <section class="card settings-card" id="locationsCard">
      <div class="card-head bordered">
        <div><h3 class="card-title">Standorte</h3><p class="card-sub">Stammdaten für Sichtbarkeit und Freigaberouting.</p></div>
        <button class="btn btn-primary btn-sm" type="button" data-action="new-location">${icon('plus')} Standort anlegen</button>
      </div>
      <div class="card-body">
        ${locations.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Standort</th><th>Status</th><th class="num">Aktion</th></tr></thead>
          <tbody>${locations.map((location) => `<tr>
            <td><span class="table-main">${esc(location.name)}</span></td>
            <td>${location.active ? '<span class="badge badge-green no-dot">Aktiv</span>' : '<span class="badge badge-gray no-dot">Inaktiv</span>'}</td>
            <td><div class="table-actions">
              <button class="table-action" type="button" title="Standort bearbeiten" aria-label="Standort bearbeiten" data-action="edit-location" data-id="${location.id}">${icon('edit')}</button>
              <button class="table-action" type="button" title="${location.active ? 'Standort deaktivieren' : 'Standort aktivieren'}" aria-label="${location.active ? 'Standort deaktivieren' : 'Standort aktivieren'}" data-action="toggle-location-active" data-id="${location.id}">${icon(location.active ? 'x' : 'check-circle')}</button>
              <button class="table-action danger" type="button" title="Standort löschen" aria-label="Standort löschen" data-action="delete-location" data-id="${location.id}">${icon('trash')}</button>
            </div></td>
          </tr>`).join('')}</tbody>
        </table></div>` : emptyState('map-pin', 'Noch keine Standorte', 'Legen Sie den ersten Standort an, um Fahrzeuge und Konten zuzuordnen.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-location">Standort anlegen</button>')}
      </div>
      <div class="card-footer"><span class="text-muted">Löschen ist nur ohne Zuordnungen möglich; sonst bitte deaktivieren.</span></div>
    </section>`;
}

function renderRetentionCard() {
  const settings = db.settings || {};
  return `
    <form class="card settings-card" id="retentionForm">
      <div class="card-head bordered">
        <div><h3 class="card-title">Datenaufbewahrung</h3><p class="card-sub">Technische und auditnahe Daten regelmäßig bereinigen.</p></div>
        <span class="badge badge-gray no-dot">0 = aus</span>
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field">
            <label for="auditRetentionDays">Audit-Log</label>
            <div class="inline-number"><input class="input" id="auditRetentionDays" name="auditRetentionDays" type="number" min="0" max="3650" step="1" value="${Number(settings.auditRetentionDays) || 0}"><span>Tage</span></div>
          </div>
          <div class="field">
            <label for="sessionRetentionDays">Abgelaufene Sitzungen</label>
            <div class="inline-number"><input class="input" id="sessionRetentionDays" name="sessionRetentionDays" type="number" min="0" max="3650" step="1" value="${Number(settings.sessionRetentionDays) || 0}"><span>Tage</span></div>
          </div>
          <div class="field">
            <label for="passwordResetRetentionDays">Passwort-Reset-Tokens</label>
            <div class="inline-number"><input class="input" id="passwordResetRetentionDays" name="passwordResetRetentionDays" type="number" min="0" max="3650" step="1" value="${Number(settings.passwordResetRetentionDays) || 0}"><span>Tage</span></div>
          </div>
          <div class="field">
            <label for="notificationRetentionDays">Benachrichtigungs-Deliveries</label>
            <div class="inline-number"><input class="input" id="notificationRetentionDays" name="notificationRetentionDays" type="number" min="0" max="3650" step="1" value="${Number(settings.notificationRetentionDays) || 0}"><span>Tage</span></div>
          </div>
          <div class="info-banner field-full">
            ${icon('shield')}
            <div><strong>Keine automatische Löschung von Geschäftsdaten</strong><p>Buchungen, Kosten und Fahrtenbuch werden durch diese Retention nicht gelöscht. Diese Entscheidung bleibt der rechtlichen Prüfung vorbehalten. Der tägliche Lauf entfernt nur technische und auditnahe Daten.</p></div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Dry-Run prüft die Mengen, ohne Daten zu löschen.</span>
        <div class="setting-actions" style="margin-top:0">
          <button class="btn btn-ghost btn-sm" type="button" data-action="retention-dry-run">${icon('search')} Dry-Run prüfen</button>
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </div>
    </form>`;
}

function integrationField({
  id,
  label,
  value = '',
  locked = false,
  type = 'text',
  hint = '',
  placeholder = '',
  min = 0,
  max = 65535,
  required = false,
  autocomplete = ''
}) {
  const typeAttr = type === 'number' ? `type="number" min="${min}" max="${max}" step="1"` : `type="${type}"`;
  const attrs = [
    typeAttr,
    locked ? 'disabled aria-disabled="true"' : '',
    required && !locked ? 'required' : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '',
    autocomplete ? `autocomplete="${esc(autocomplete)}"` : ''
  ].filter(Boolean).join(' ');
  return `<div class="field">
    <label for="${id}">${label}${locked ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
    <input class="input" id="${id}" name="${id}" ${attrs} value="${esc(value)}">
    ${hint ? `<p class="field-hint">${hint}</p>` : ''}
  </div>`;
}

function integrationSecretField({ id, label, clearName, set, locked, hint }) {
  return `<div class="field">
    <label for="${id}">${label}${locked ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
    <input class="input" id="${id}" name="${id}" type="password" autocomplete="new-password" ${locked ? 'disabled aria-disabled="true"' : ''}
      placeholder="${set ? '•••••••• (gesetzt)' : 'Noch kein Secret gesetzt'}">
    ${hint ? `<p class="field-hint">${hint}</p>` : ''}
    ${!locked && set ? `<label class="check-row" style="margin-top:6px"><input type="checkbox" name="${clearName}"> Secret entfernen</label>` : ''}
  </div>`;
}

function integrationStatusBadge({ enabled, configured, missing = false }) {
  if (enabled && configured) return '<span class="badge badge-green no-dot">Aktiv</span>';
  if (enabled || missing) return '<span class="badge badge-amber no-dot">Unvollständig</span>';
  return '<span class="badge badge-gray no-dot">Inaktiv</span>';
}

function integrationTestButton(kind, label = 'Testen') {
  return `<button class="btn btn-ghost btn-sm" type="button" data-action="integration-test" data-kind="${kind}">${icon('play')} ${label}</button>`;
}

function renderSsoIntegrationCard(integrations) {
  const sso = integrations.sso || {};
  const locked = sso.envLocked || {};
  const roles = (db.roles || []).filter((role) => role.id !== 'superadmin');
  return `
    <form class="card settings-card" id="integrationSsoForm" data-integration="sso">
      <div class="card-head bordered">
        <div><h3 class="card-title">SSO / Entra ID</h3><p class="card-sub">OIDC-Anmeldung mit PKCE, State und Nonce.</p></div>
        ${integrationStatusBadge({ enabled: Boolean(sso.enabled), configured: Boolean(sso.configured) })}
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" name="ssoEnabled" ${sso.enabled ? 'checked' : ''} ${locked.enabled ? 'disabled' : ''}> SSO aktivieren${locked.enabled ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
            <p class="field-hint">Solange SSO aus ist, werden die Detailfelder ausgeblendet.</p>
          </div>
        </div>
        <div class="integration-details" ${sso.enabled ? '' : 'hidden'}>
          <div class="form-grid">
            ${integrationField({ id: 'ssoIssuer', label: 'Issuer', value: sso.issuer || '', locked: locked.issuer, placeholder: 'https://login.microsoftonline.com/<tenant>/v2.0', hint: 'Nur http(s); der Issuer wird ohne abschließenden Schrägstrich gespeichert.' })}
            ${integrationField({ id: 'ssoRedirectUri', label: 'Redirect-URI', value: sso.redirectUri || '', locked: locked.redirectUri, placeholder: 'https://fuhrpark.example.de/auth/sso/callback' })}
            ${integrationField({ id: 'ssoClientId', label: 'Client-ID', value: sso.clientId || '', locked: locked.clientId })}
            ${integrationSecretField({ id: 'ssoClientSecret', label: 'Client-Secret', clearName: 'clearSsoClientSecret', set: Boolean(sso.clientSecretSet), locked: locked.clientSecret, hint: 'Wird verschlüsselt gespeichert und nie angezeigt.' })}
            ${integrationField({ id: 'ssoScopes', label: 'Scopes', value: sso.scopes || '', locked: locked.scopes })}
            ${integrationField({ id: 'ssoAllowedDomains', label: 'Erlaubte Domains', value: sso.allowedDomains || '', locked: locked.allowedDomains, placeholder: 'awo-bremerhaven.de, example.de', hint: 'Kommagetrennt. Leer = alle vom IdP bestätigten Domains.' })}
            <div class="field">
              <label class="check-row"><input type="checkbox" name="ssoAutoProvision" ${sso.autoProvision ? 'checked' : ''} ${locked.autoProvision ? 'disabled' : ''}> JIT-Provisioning aktivieren${locked.autoProvision ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
            </div>
            <div class="field">
              <label for="ssoDefaultRole">Standardrolle für JIT</label>
              ${roles.length ? `<select class="select" id="ssoDefaultRole" name="ssoDefaultRole" ${locked.defaultRole ? 'disabled' : ''}>
                ${sso.defaultRole && !roles.some((role) => role.id === sso.defaultRole) ? `<option value="${esc(sso.defaultRole)}" selected>${esc(sso.defaultRole)}</option>` : ''}
                ${roles.map((role) => `<option value="${esc(role.id)}" ${role.id === (sso.defaultRole || 'user') ? 'selected' : ''}>${esc(role.name)}</option>`).join('')}
              </select>` : `<input class="input" id="ssoDefaultRole" name="ssoDefaultRole" value="${esc(sso.defaultRole || 'user')}" ${locked.defaultRole ? 'disabled' : ''}>`}
              ${locked.defaultRole ? '<p class="field-hint">durch Umgebung gesetzt</p>' : '<p class="field-hint">Die Rolle <code>user</code> legt zusätzlich ein verknüpftes Fahrerprofil an.</p>'}
            </div>
            ${integrationField({ id: 'ssoGroupClaim', label: 'Gruppen-Claim', value: sso.groupClaim || '', locked: locked.groupClaim })}
            ${integrationField({ id: 'ssoAdminGroup', label: 'Admin-Gruppe', value: sso.adminGroup || '', locked: locked.adminGroup })}
            ${integrationField({ id: 'ssoManagerGroup', label: 'Fuhrparkleitungs-Gruppe', value: sso.managerGroup || '', locked: locked.managerGroup })}
          </div>
          <div class="info-banner" style="margin-top:16px">${icon('shield')}<div><strong>ENV hat Vorrang</strong><p>Felder mit „durch Umgebung gesetzt“ werden aus der Serverumgebung gelesen und können hier nicht geändert werden. Änderungen wirken ohne Neustart.</p></div></div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Der Test prüft Discovery und JWKS, ohne eine Anmeldung auszulösen.</span>
        <div class="setting-actions" style="margin-top:0">
          ${integrationTestButton('sso', 'Discovery testen')}
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </div>
    </form>`;
}

function renderTeamsIntegrationCard(integrations) {
  const teams = integrations.teams || {};
  const locked = teams.envLocked || {};
  return `
    <form class="card settings-card" id="integrationTeamsForm" data-integration="teams">
      <div class="card-head bordered">
        <div><h3 class="card-title">Microsoft Teams <span class="badge badge-gray no-dot">Legacy/Preset</span></h3><p class="card-sub">Bestehender Teams-Webhook. Neue Endpunkte bitte unter Webhooks verwalten.</p></div>
        ${integrationStatusBadge({ enabled: Boolean(teams.enabled), configured: Boolean(teams.configured) })}
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" name="teamsEnabled" ${teams.enabled ? 'checked' : ''} ${locked.enabled ? 'disabled' : ''}> Teams-Benachrichtigungen aktivieren${locked.enabled ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
            <p class="field-hint">Solange Teams aus ist, werden die Detailfelder ausgeblendet.</p>
          </div>
        </div>
        <div class="integration-details" ${teams.enabled ? '' : 'hidden'}>
          <div class="form-grid">
            ${integrationSecretField({ id: 'teamsWebhookUrl', label: 'Webhook-URL', clearName: 'clearTeamsWebhook', set: Boolean(teams.webhookSet), locked: locked.webhookUrl, hint: 'Die URL ist ein Secret und wird verschlüsselt gespeichert.' })}
            <div class="field">
              <label class="check-row"><input type="checkbox" name="teamsSendLeasing" ${teams.sendLeasing ? 'checked' : ''}> Leasing-Schwellen senden</label>
            </div>
            <div class="field">
              <label class="check-row"><input type="checkbox" name="teamsSendBookingRequests" ${teams.sendBookingRequests ? 'checked' : ''}> Buchungsanfragen senden</label>
            </div>
            <div class="field">
              <label class="check-row"><input type="checkbox" name="teamsSendMaintenance" ${teams.sendMaintenance ? 'checked' : ''}> Wartung/TÜV senden</label>
            </div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Der Test sendet eine Testkarte an den konfigurierten Webhook.</span>
        <div class="setting-actions" style="margin-top:0">
          ${integrationTestButton('teams', 'Testkarte senden')}
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </div>
    </form>`;
}

function renderClamavIntegrationCard(integrations) {
  const clamav = integrations.clamav || {};
  const locked = clamav.envLocked || {};
  return `
    <form class="card settings-card" id="integrationClamavForm" data-integration="clamav">
      <div class="card-head bordered">
        <div><h3 class="card-title">ClamAV</h3><p class="card-sub">Virenscan für Uploads über clamd.</p></div>
        ${integrationStatusBadge({ enabled: Boolean(clamav.enabled), configured: Boolean(clamav.enabled) })}
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" name="clamavEnabled" ${clamav.enabled ? 'checked' : ''} ${locked.enabled ? 'disabled' : ''}> Virenscan aktivieren${locked.enabled ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
            <p class="field-hint">Solange der Scan aus ist, werden die Detailfelder ausgeblendet.</p>
          </div>
        </div>
        <div class="integration-details" ${clamav.enabled ? '' : 'hidden'}>
          <div class="form-grid">
            ${integrationField({ id: 'clamavHost', label: 'clamd-Host', value: clamav.host || '', locked: locked.host })}
            ${integrationField({ id: 'clamavPort', label: 'clamd-Port', value: Number(clamav.port) || 3310, locked: locked.port, type: 'number', min: 1, max: 65535 })}
            <div class="field field-full">
              <label class="check-row"><input type="checkbox" name="clamavFailClosed" ${clamav.failClosed ? 'checked' : ''} ${locked.failClosed ? 'disabled' : ''}> Fail-closed: Uploads bei Scanfehler ablehnen${locked.failClosed ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
            </div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Der Test scannt eine harmlose Testdatei.</span>
        <div class="setting-actions" style="margin-top:0">
          ${integrationTestButton('clamav', 'clamd testen')}
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </div>
    </form>`;
}

function renderWebauthnIntegrationCard(integrations) {
  const webauthn = integrations.webauthn || {};
  const locked = webauthn.envLocked || {};
  return `
    <form class="card settings-card" id="integrationWebauthnForm" data-integration="webauthn">
      <div class="card-head bordered">
        <div><h3 class="card-title">WebAuthn / Passkeys</h3><p class="card-sub">Relying-Party für Passkey-Anmeldung.</p></div>
        ${integrationStatusBadge({ enabled: Boolean(webauthn.enabled), configured: Boolean(webauthn.enabled), missing: Boolean(webauthn.rpID || webauthn.origins) })}
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field field-full">
            <label class="check-row"><input type="checkbox" name="webauthnEnabled" ${webauthn.enabledFlag ? 'checked' : ''}> WebAuthn / Passkeys aktivieren</label>
            <p class="field-hint">Solange WebAuthn aus ist, werden die Detailfelder ausgeblendet.</p>
          </div>
        </div>
        <div class="integration-details" ${webauthn.enabledFlag ? '' : 'hidden'}>
          <div class="form-grid">
            ${integrationField({ id: 'webauthnRpId', label: 'RP-ID', value: webauthn.rpID || '', locked: locked.rpID, placeholder: 'fuhrpark.example.de' })}
            ${integrationField({ id: 'webauthnRpName', label: 'RP-Name', value: webauthn.rpName || '', locked: locked.rpName, placeholder: 'AWO Fuhrparkmanagement' })}
            ${integrationField({ id: 'webauthnOrigin', label: 'Origins', value: webauthn.origins || '', locked: locked.origins, placeholder: 'https://fuhrpark.example.de', hint: 'Kommagetrennt. Jede Origin muss zur RP-ID passen.' })}
            <div class="info-banner field-full">${icon('alert')}<div><strong>Bestehende Passkeys können ungültig werden</strong><p>Eine Änderung von RP-ID oder Origin macht bereits registrierte Passkeys unbrauchbar. Prüfen Sie die Werte vor dem Speichern.</p></div></div>
          </div>
          <p class="field-hint" style="margin-top:8px">WebAuthn ist aktiv, sobald der Schalter an ist und RP-ID, RP-Name und eine passende Origin gespeichert sind.</p>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Der Test validiert RP-ID und Origins ohne Netzwerkzugriff.</span>
        <div class="setting-actions" style="margin-top:0">
          ${integrationTestButton('webauthn', 'Konfiguration prüfen')}
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </div>
    </form>`;
}

function renderLocationsToggleCard(integrations) {
  const locations = integrations.locations || {};
  const locked = locations.envLocked || {};
  return `
    <form class="card settings-card" id="integrationLocationsForm" data-integration="locations">
      <div class="card-head bordered">
        <div><h3 class="card-title">Standorte</h3><p class="card-sub">Sichtbarkeit und Freigaberouting nach Standort.</p></div>
        ${integrationStatusBadge({ enabled: Boolean(locations.enabled), configured: Boolean(locations.enabled) })}
      </div>
      <div class="card-body">
        <label class="check-row"><input type="checkbox" name="locationsEnabled" ${locations.enabled ? 'checked' : ''} ${locked.enabled ? 'disabled' : ''}> Standortfunktion aktivieren${locked.enabled ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
        <div class="info-banner" style="margin-top:16px">${icon('map-pin')}<div><strong>Standortfilter nur bei aktivem Feature</strong><p>Bei aktivierter Funktion sehen Nicht-Administrator:innen mit Standort nur Daten ihres Standorts. Bestehende Konten und Fahrzeuge ohne Standort bleiben global sichtbar. Die Standort-Stammdaten verwalten Sie anschließend unter Einstellungen.</p></div></div>
      </div>
      <div class="card-footer">
        <span class="text-muted">Änderungen wirken sofort, ohne Neustart.</span>
        <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
      </div>
    </form>`;
}

function formatDurationMs(value) {
  const ms = Math.max(0, Number(value) || 0);
  if (ms < 60000) return `${Math.round(ms / 1000)} Sek.`;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} Min.`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} Std.`;
  return `${hours.toFixed(1)} Std.`;
}

function advancedCard({ id, title, subtitle, badge = '', content }) {
  return `
    <details class="card settings-card advanced-card" id="${id}">
      <summary class="card-head bordered">
        <div><h3 class="card-title">${title}</h3><p class="card-sub">${subtitle}</p></div>
        ${badge}
      </summary>
      ${content}
    </details>`;
}

function advancedNumberField({ id, label, value, locked, min, max, hint }) {
  return integrationField({ id, label, value, locked, type: 'number', min, max, hint });
}

function schedulerAdvancedCard({ kind, title, subtitle, config, fields }) {
  const locked = config.envLocked || {};
  const formId = `advanced${kind[0].toUpperCase()}${kind.slice(1)}Form`;
  return advancedCard({
    id: `advanced-${kind}`,
    title,
    subtitle,
    badge: integrationStatusBadge({ enabled: Boolean(config.enabled), configured: true }),
    content: `
      <form id="${formId}" data-advanced="${kind}">
        <div class="card-body">
          <label class="check-row"><input type="checkbox" name="${kind}SchedulerEnabled" ${config.enabled ? 'checked' : ''} ${locked.enabled ? 'disabled' : ''}> Scheduler aktivieren${locked.enabled ? ' <span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>' : ''}</label>
          <div class="integration-details" ${config.enabled ? '' : 'hidden'}>
            <div class="form-grid" style="margin-top:16px">
              ${fields.map((field) => advancedNumberField({ ...field, locked: locked[field.lockKey] })).join('')}
            </div>
          </div>
        </div>
        <div class="card-footer">
          <span class="text-muted">Änderungen starten den Scheduler sofort neu, ohne Prozessneustart.</span>
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </form>`
  });
}

function renderAdvanced() {
  const integrations = db.integrations;
  if (!integrations) {
    return `${pageHead('Einstellungen', 'Erweitert', 'Betriebsparameter und Systemstatus.', '')}
      <section class="card">${emptyState('shield', 'Keine erweiterten Einstellungen verfügbar', 'Diese Seite ist für Rollen mit der Berechtigung „Organisation bearbeiten“ vorgesehen.')}</section>`;
  }
  const advanced = integrations.advanced || {};
  const system = integrations.system || {};
  const appBaseUrl = advanced.appBaseUrl || {};
  const leasing = advanced.leasing || {};
  const reminder = advanced.reminder || {};
  const retention = advanced.retention || {};
  const keySourceLabel = (value) => (value === 'env'
    ? 'Umgebungsvariable'
    : value === 'file'
      ? 'Datei im Datenverzeichnis'
      : 'nicht vorhanden');

  const generalCard = advancedCard({
    id: 'advanced-general',
    title: 'Allgemein / Betrieb',
    subtitle: 'Öffentliche Basis-URL für Links in E-Mails.',
    badge: appBaseUrl.envLocked
      ? '<span class="badge badge-amber no-dot">durch Umgebung gesetzt</span>'
      : '',
    content: `
      <form id="advancedGeneralForm" data-advanced="general">
        <div class="card-body">
          <div class="form-grid">
            ${integrationField({
              id: 'appBaseUrl',
              label: 'APP_BASE_URL',
              value: appBaseUrl.value || '',
              locked: Boolean(appBaseUrl.envLocked),
              placeholder: 'https://fuhrpark.example.de',
              hint: 'Wird für Passwort-Reset-Links verwendet. Ohne Wert wird die Host-Information der Anfrage genutzt. Kein abschließender Schrägstrich.'
            })}
          </div>
        </div>
        <div class="card-footer">
          <span class="text-muted">Nur http(s). Änderungen gelten sofort für neue E-Mails.</span>
          <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Speichern</button>
        </div>
      </form>`
  });

  const leasingCard = schedulerAdvancedCard({
    kind: 'leasing',
    title: 'Leasing-Scheduler',
    subtitle: 'Prüft Leasing-Schwellen und versendet Warnungen.',
    config: leasing,
    fields: [
      { id: 'leasingIntervalMs', label: 'Intervall (ms)', value: leasing.intervalMs, lockKey: 'intervalMs', min: 60000, max: 2592000000, hint: `Aktuell: ${formatDurationMs(leasing.intervalMs)}; Minimum 60.000 ms.` },
      { id: 'leasingInitialDelayMs', label: 'Startverzögerung (ms)', value: leasing.initialDelayMs, lockKey: 'initialDelayMs', min: 0, max: 86400000 },
      { id: 'leasingDebounceMs', label: 'Debounce (ms)', value: leasing.debounceMs, lockKey: 'debounceMs', min: 0, max: 3600000, hint: 'Verzögerung nach Änderungen an Fahrzeugen oder SMTP.' }
    ]
  });

  const reminderCard = schedulerAdvancedCard({
    kind: 'reminder',
    title: 'Wartungs-/TÜV-Scheduler',
    subtitle: 'Erinnert an fällige Wartungen und TÜV-Termine.',
    config: reminder,
    fields: [
      { id: 'reminderIntervalMs', label: 'Intervall (ms)', value: reminder.intervalMs, lockKey: 'intervalMs', min: 60000, max: 2592000000, hint: `Aktuell: ${formatDurationMs(reminder.intervalMs)}; Minimum 60.000 ms.` },
      { id: 'reminderInitialDelayMs', label: 'Startverzögerung (ms)', value: reminder.initialDelayMs, lockKey: 'initialDelayMs', min: 0, max: 86400000 }
    ]
  });

  const retentionCard = schedulerAdvancedCard({
    kind: 'retention',
    title: 'Retention-Scheduler',
    subtitle: 'Bereinigt technische Daten gemäß den Aufbewahrungsfristen.',
    config: retention,
    fields: [
      { id: 'retentionIntervalMs', label: 'Intervall (ms)', value: retention.intervalMs, lockKey: 'intervalMs', min: 60000, max: 2592000000, hint: `Aktuell: ${formatDurationMs(retention.intervalMs)}; Minimum 60.000 ms.` },
      { id: 'retentionInitialDelayMs', label: 'Startverzögerung (ms)', value: retention.initialDelayMs, lockKey: 'initialDelayMs', min: 0, max: 86400000 }
    ]
  });

  const statusRows = [
    ['NODE_ENV', system.nodeEnv || '—'],
    ['HOST', system.host || '—'],
    ['PORT', String(system.port || '—')],
    ['DATA_DIR', system.dataDir || '—'],
    ['TRUST_PROXY', String(system.trustProxy ?? '0')],
    ['COOKIE_SECURE', system.cookieSecure ? 'true' : 'false'],
    ['SUPERADMIN_FILE', system.superadminFile?.configured
      ? (system.superadminFile.exists ? 'gesetzt, Datei vorhanden' : 'gesetzt, Datei fehlt')
      : 'nicht gesetzt'],
    ['MFA-Schlüssel', keySourceLabel(system.mfaKeySource)],
    ['Integrations-Schlüssel', keySourceLabel(system.integrationsKeySource)]
  ];
  const systemCard = advancedCard({
    id: 'advanced-system',
    title: 'Systemstatus',
    subtitle: 'Nur lesen. Diese Werte bleiben bewusst ENV-only.',
    badge: '<span class="badge badge-gray no-dot">Read-only</span>',
    content: `
      <div class="card-body">
        <div class="detail-list">
          ${statusRows.map(([label, value]) => `<div class="detail-list-item">
            <span class="mini-icon tint-blue">${icon('monitor')}</span>
            <div class="main"><strong>${esc(label)}</strong><span>${esc(value)}</span></div>
          </div>`).join('')}
        </div>
        <div class="info-banner" style="margin-top:16px">${icon('shield')}<div><strong>Infrastruktur bleibt in der Umgebung</strong><p>Diese Werte betreffen Bootstrap, Sicherheit und Container und sind deshalb nicht über die UI änderbar. Secrets werden nur als „gesetzt/nicht gesetzt“ und Quelle angezeigt.</p></div></div>
      </div>`
  });

  return `
    ${pageHead('Einstellungen', 'Erweitert', 'Betriebsparameter, Scheduler und Systemstatus. Karten sind standardmäßig eingeklappt.', '<span class="badge badge-gray no-dot">Eingeklappt</span>')}
    <div class="stack">
      ${generalCard}
      ${leasingCard}
      ${reminderCard}
      ${retentionCard}
      ${systemCard}
    </div>`;
}

function webhookFormatLabel(format) {
  return { generic: 'Generisch', teams: 'Teams', discord: 'Discord', slack: 'Slack' }[format] || format;
}

function webhookEventLabel(event) {
  return { leasing: 'Leasing', booking_request: 'Buchungsanfragen', maintenance: 'Wartung/TÜV', test: 'Test' }[event] || event;
}

function renderWebhooksCard(integrations) {
  const webhooks = Array.isArray(integrations.webhooks) ? integrations.webhooks : [];
  return `
    <section class="card settings-card" id="webhooksCard">
      <div class="card-head bordered">
        <div><h3 class="card-title">Webhooks</h3><p class="card-sub">Ereignisse an generische, Teams-, Discord- oder Slack-Endpunkte senden.</p></div>
        <button class="btn btn-primary btn-sm" type="button" data-action="new-webhook">${icon('plus')} Webhook hinzufügen</button>
      </div>
      <div class="card-body">
        ${webhooks.length ? `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Host</th><th>Format</th><th>Events</th><th>Status</th><th class="num">Aktion</th></tr></thead>
          <tbody>${webhooks.map((webhook) => `<tr>
            <td><span class="table-main">${esc(webhook.name)}</span>${webhook.secretSet ? '<span class="badge badge-blue no-dot">HMAC</span>' : ''}</td>
            <td><code>${esc(webhook.host || '—')}</code></td>
            <td>${esc(webhookFormatLabel(webhook.format))}</td>
            <td><div class="summary-chips">${webhook.events.map((event) => `<span class="badge badge-gray no-dot">${esc(webhookEventLabel(event))}</span>`).join('')}</div></td>
            <td>${webhook.enabled ? '<span class="badge badge-green no-dot">Aktiv</span>' : '<span class="badge badge-gray no-dot">Inaktiv</span>'}</td>
            <td><div class="table-actions">
              <button class="table-action" type="button" title="Webhook testen" aria-label="Webhook testen" data-action="test-webhook" data-id="${webhook.id}">${icon('play')}</button>
              <button class="table-action" type="button" title="Webhook bearbeiten" aria-label="Webhook bearbeiten" data-action="edit-webhook" data-id="${webhook.id}">${icon('edit')}</button>
              <button class="table-action danger" type="button" title="Webhook löschen" aria-label="Webhook löschen" data-action="delete-webhook" data-id="${webhook.id}">${icon('trash')}</button>
            </div></td>
          </tr>`).join('')}</tbody>
        </table></div>` : emptyState('zap', 'Noch keine Webhooks', 'Legen Sie einen Endpunkt an, um Leasing-, Buchungs- oder Wartungsereignisse zu senden.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-webhook">Webhook hinzufügen</button>')}
        <div class="info-banner" style="margin-top:16px">${icon('shield')}<div><strong>URLs und Secrets bleiben geschützt</strong><p>Webhook-URL und HMAC-Secret werden verschlüsselt gespeichert. Private, lokale und Metadaten-Ziele sind blockiert, sofern der Host nicht über <code>WEBHOOK_ALLOW_PRIVATE_HOSTS</code> freigegeben ist.</p></div></div>
      </div>
      <div class="card-footer"><span class="text-muted">Retry alle 6 Stunden; Dedupe über Benachrichtigungs-Deliveries.</span><span class="text-muted">Keine E-Mail-Adressen in Webhook-Payloads.</span></div>
    </section>`;
}

function renderIntegrations() {
  const integrations = db.integrations;
  if (!integrations) {
    return `${pageHead('Einstellungen', 'Integrationen', 'Zentrale Konfiguration für SSO, Teams, ClamAV, WebAuthn, Aufbewahrung und Standorte.', '')}
      <section class="card">${emptyState('shield', 'Keine Integrationsdaten verfügbar', 'Diese Seite ist für Rollen mit der Berechtigung „Organisation bearbeiten“ vorgesehen.')}</section>`;
  }
  const cards = [
    renderWebhooksCard(integrations),
    renderSsoIntegrationCard(integrations),
    renderTeamsIntegrationCard(integrations),
    renderClamavIntegrationCard(integrations),
    renderWebauthnIntegrationCard(integrations),
    privileged() ? renderRetentionCard() : '',
    privileged() ? renderLocationsToggleCard(integrations) : ''
  ].filter(Boolean).join('');
  return `
    ${pageHead('Einstellungen', 'Integrationen', 'SSO, Teams, Virenscan, Passkeys, Aufbewahrung und Standorte zentral verwalten.', '<span class="badge badge-blue no-dot">ENV hat Vorrang</span>')}
    <div class="stack">${cards}</div>`;
}

function renderSettings() {
  const roleDisplay = currentUser?.roleName || roleLabel(currentUser?.role);
  const canEditSettings = can('settings_manage');
  const canManageBranding = can('branding_manage');
  const canManageSmtp = Boolean(capabilities.isAdmin || capabilities.isSuperadmin);
  const canManageIntegrations = can('settings_manage');
  const canViewCostCenters = can('cost_centers_view');
  const canExport = can('export_data');
  const canManageUsers = can('users_manage');
  const canManageRoles = can('roles_manage');
  const managementLinks = [
    canManageUsers ? `<a class="link-arrow" href="#/benutzer">Benutzer verwalten ${icon('arrow-right')}</a>` : '',
    canManageRoles ? `<a class="link-arrow" href="#/rollen">Rollen verwalten ${icon('arrow-right')}</a>` : ''
  ].filter(Boolean).join(' ');
  const adminAreas = [
    canEditSettings ? 'Organisation' : '',
    canManageBranding ? 'Erscheinungsbild' : '',
    canViewCostCenters ? 'Kostenstellen' : '',
    canExport ? 'Datenexport' : '',
    canManageUsers ? 'Benutzer' : '',
    canManageRoles ? 'Rollen' : ''
  ].filter(Boolean);
  const showInstallationInfo = adminAreas.length > 0;
  const subtitle = showInstallationInfo
    ? `${adminAreas.join(', ')} sowie Ihr Konto verwalten.`
    : 'Ihr Konto und Ihre Zugangsdaten verwalten.';
  const eyebrow = canEditSettings
    ? 'Organisation'
    : (canManageUsers || canManageRoles)
      ? 'Verwaltung'
      : canExport
        ? 'Datenexport'
        : canManageBranding
          ? 'Erscheinungsbild'
          : canViewCostCenters
            ? 'Kostenstellen'
            : 'Konto';
  const adminSections = [
    canViewCostCenters ? renderCostCentersCard() : '',
    canManageBranding ? renderBrandingCard() : '',
    canManageSmtp ? renderSmtpCard() : '',
    db.features?.locationsEnabled && privileged() ? renderLocationsCard() : '',
    canManageIntegrations ? `
      <section class="card settings-card" id="integrationsLinkCard">
        <div class="card-head bordered">
          <div><h3 class="card-title">Integrationen</h3><p class="card-sub">SSO, Teams, ClamAV, WebAuthn, Aufbewahrung und Standorte.</p></div>
          <span class="badge badge-blue no-dot">Zentral</span>
        </div>
        <div class="card-body">
          <p class="text-muted">Diese Einstellungen sind auf einer eigenen Seite gebündelt. Gesetzte Umgebungsvariablen haben Vorrang und werden dort schreibgeschützt angezeigt.</p>
        </div>
        <div class="card-footer">
          <span class="text-muted">Secrets werden verschlüsselt gespeichert und nie im Browser angezeigt.</span>
          <a class="btn btn-ghost btn-sm" href="#/integrationen">Integrationen öffnen ${icon('arrow-right')}</a>
        </div>
      </section>` : '',
    canManageIntegrations ? `
      <details class="card settings-card advanced-card" id="advancedSettingsEntry">
        <summary class="card-head bordered">
          <div><h3 class="card-title">Erweitert</h3><p class="card-sub">Basis-URL, Scheduler und Systemstatus.</p></div>
          <span class="badge badge-gray no-dot">Eingeklappt</span>
        </summary>
        <div class="card-body">
          <p class="text-muted">Betriebsparameter und Scheduler sind bewusst auf einer separaten Seite gebündelt und dort zusätzlich eingeklappt.</p>
        </div>
        <div class="card-footer">
          <span class="text-muted">Infrastruktur- und Bootstrap-Werte bleiben ENV-only.</span>
          <a class="btn btn-ghost btn-sm" href="#/erweitert">Erweitert öffnen ${icon('arrow-right')}</a>
        </div>
      </details>` : '',
    canEditSettings ? `
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
              <p class="field-hint">Wird in den Stammdaten und in der Organisation verwendet.</p>
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
            <div class="field field-full">
              <label for="defaultColorMode">Standard-Farbschema</label>
              <select class="select" id="defaultColorMode" name="defaultColorMode">
                <option value="light" ${db.settings.defaultColorMode === 'light' ? 'selected' : ''}>Hell</option>
                <option value="dark" ${db.settings.defaultColorMode === 'dark' ? 'selected' : ''}>Dunkel</option>
                <option value="auto" ${db.settings.defaultColorMode === 'auto' ? 'selected' : ''}>Automatik (Systemeinstellung)</option>
              </select>
              <p class="field-hint">Gilt für Nutzer:innen ohne eigene Auswahl und für die Anmeldeseite.</p>
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
      </form>` : '',
    canExport ? `
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
            <span class="version-badge">Server-MVP 0.11.0-dev</span>
          </div>
        </div>
      </section>` : ''
  ].filter(Boolean).join('');
  return `
    ${pageHead(eyebrow, 'Einstellungen', subtitle, '')}
    <div class="settings-grid${adminSections ? '' : ' is-single'}">
      ${adminSections ? `<div class="stack">${adminSections}</div>` : ''}

      <div class="stack">
        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Ihr Konto</h3><p class="card-sub">Aktuell angemeldete Person</p></div></div>
          <div class="card-body">
            <div class="detail-list">
              <div class="detail-list-item">
                ${driverAvatar({ name: currentUser?.name || '?', color: '#e2001a' }, 'avatar-lg')}
                <div class="main"><strong>${esc(currentUser?.name || '—')}</strong><span>${esc(currentUser?.email || '—')}</span></div>
                <span class="badge badge-red no-dot">${esc(roleDisplay)}</span>
              </div>
            </div>
            ${renderColorModeSwitch()}
            <div class="setting-actions">
              ${capabilities.isSuperadmin
                ? `<span class="text-muted">${icon('lock')} Passwort ausschließlich über die Superadmin-Datei und Neustart änderbar.</span>`
                : `<button class="btn btn-ghost btn-sm" type="button" data-action="change-password">${icon('shield')} Passwort ändern</button>`}
              ${managementLinks}
            </div>
          </div>
          <div class="card-footer">
            <span class="text-muted">Sitzung sicher beenden</span>
            <button class="btn btn-danger-ghost btn-sm" type="button" data-action="logout">${icon('log-out')} Abmelden</button>
          </div>
        </section>

        ${renderSecurityCard()}

        ${renderAdminDriverProfileCard()}

        ${showInstallationInfo ? `
        <section class="card">
          <div class="card-head"><div><h3 class="card-title">Über diese Installation</h3><p class="card-sub">Fuhrparkmanagement für ${esc(brandDisplayName())}</p></div></div>
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
              <div><strong>Interner Betrieb</strong><p>Diese Instanz ist für den internen Gebrauch bestimmt. Zugriff, Aufbewahrungsfristen und Datenschutz müssen organisatorisch geregelt sein.</p></div>
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
        </section>` : ''}
      </div>
    </div>`;
}

/* =========================================================
   Benutzerverwaltung
   ========================================================= */
function renderUsers() {
  if (!can('users_manage')) return emptyState('shield', 'Keine Berechtigung', 'Für die Benutzerverwaltung fehlt die Berechtigung „Benutzer verwalten“.');
  const users = db.users || [];
  const admins = users.filter((user) => user.role === 'admin' && user.active).length;
  const active = users.filter((user) => user.active).length;
  const anonymized = users.filter((user) => user.anonymizedAt).length;
  const deactivated = users.filter((user) => !user.active && !user.anonymizedAt).length;
  const autoAnonymizeDays = Number(db.settings.autoAnonymizeDays) || 0;
  const rows = users.map((user) => {
    const isSelf = currentUser?.id === user.id;
    const isAnonymized = Boolean(user.anonymizedAt);
    const overrideCount = (user.permissionOverrides?.allow?.length || 0) + (user.permissionOverrides?.deny?.length || 0)
      + Object.values(user.objectPermissions || {}).reduce((sum, entries) => sum + Object.keys(entries || {}).length, 0);
    const manageable = canManageUser(user);
    const canEditOverrides = !isAnonymized && manageable && user.role !== 'admin';
    const meta = isAnonymized
      ? `Anonymisiert${user.anonymizedAt ? ` am ${formatDate(user.anonymizedAt)}` : ''}`
      : !user.active
        ? `Deaktiviert${user.deactivatedAt ? ` am ${formatDate(user.deactivatedAt)}` : ''}`
        : user.createdAt ? `Angelegt am ${formatDate(user.createdAt)}` : '';
    const actions = isAnonymized
      ? `<span class="table-action" title="Anonymisiert" aria-label="Anonymisiert" style="pointer-events:none;color:var(--muted)">${icon('user-x')}</span>`
      : manageable
        ? `${canEditOverrides ? `<button class="table-action" type="button" title="Benutzer-Ausnahmen bearbeiten" aria-label="Benutzer-Ausnahmen bearbeiten" data-action="edit-user-permissions" data-id="${user.id}">${icon('filter')}</button>` : ''}
           <button class="table-action" type="button" title="Benutzer bearbeiten" aria-label="Benutzer bearbeiten" data-action="edit-user" data-id="${user.id}">${icon('edit')}</button>
           ${user.canResetMfa ? `<button class="table-action danger" type="button" title="MFA und Passkeys zurücksetzen" aria-label="MFA und Passkeys zurücksetzen" data-action="mfa-admin-reset" data-id="${user.id}">${icon('shield')}</button>` : ''}
           ${!user.active ? `<button class="table-action danger" type="button" title="Benutzerkonto anonymisieren" aria-label="Benutzerkonto anonymisieren" data-action="anonymize-user" data-id="${user.id}">${icon('user-x')}</button>` : ''}`
        : `<span class="table-action" title="Nur eigene oder niedrigere Ränge bearbeitbar" aria-label="Nur lesbar" style="pointer-events:none;color:var(--muted)">${icon('shield')}</span>`;
    return `
      <tr>
        <td>
          <div class="table-person">
            ${driverAvatar({ name: user.name, color: isAnonymized ? '#94a3b8' : user.role === 'admin' ? '#e2001a' : '#2563eb' }, 'avatar-sm')}
            <div><span class="table-main">${esc(user.name)} ${isSelf ? '<span class="badge badge-gray no-dot">Sie</span>' : ''}</span><span class="table-sub">${meta}</span></div>
          </div>
        </td>
        <td><span class="table-main">${esc(user.email)}</span></td>
        <td>
          <span class="badge badge-${user.role === 'admin' ? 'red' : 'blue'}">${esc(roleLabel(user.role))}</span>
          <span class="table-sub">Rang ${formatNumber(user.roleRank || roleRankOf(user.role))}</span>
          ${user.mfaEnabled ? '<span class="badge badge-green no-dot" title="TOTP aktiv">MFA</span>' : ''}
          ${user.passkeyCount ? `<span class="badge badge-blue no-dot" title="Passkey aktiv">${user.passkeyCount} Passkey${user.passkeyCount === 1 ? '' : 's'}</span>` : ''}
          ${user.costCenterId ? costCenterBadge(user) : ''}
          ${overrideCount ? `<span class="badge badge-violet no-dot">${overrideCount} Ausnahmen</span>` : ''}
          ${user.driverId ? `<span class="badge badge-${user.ownTripsAccess ? 'green' : 'gray'} no-dot">Fahrer:in: ${esc(user.driverName)}${user.ownTripsAccess ? '' : ' · ohne Standardzugriff'}</span>` : ''}
        </td>
        <td>${isAnonymized ? '<span class="badge badge-gray">Anonymisiert</span>' : user.active ? '<span class="badge badge-green">Aktiv</span>' : '<span class="badge badge-gray">Deaktiviert</span>'}</td>
        <td>${isAnonymized ? '<span class="text-muted">—</span>' : user.lastLoginAt ? `<span class="table-main">${formatDateTime(user.lastLoginAt)}</span>` : '<span class="text-muted">Noch nicht angemeldet</span>'}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
  }).join('');
  return `
    ${pageHead('Organisation', 'Benutzer', 'Zugänge, Rollen und persönliche Ausnahmen innerhalb des eigenen Rangbereichs verwalten.',
      `${can('roles_manage') ? `<a class="btn btn-ghost" href="#/rollen">${icon('shield')} Rollen &amp; Rechte</a>` : ''}
       <button class="btn btn-primary" type="button" data-action="new-user">${icon('plus')} Benutzer anlegen</button>`)}
    <div class="summary-chips" style="margin-bottom:18px">
      <span class="summary-chip"><strong>${users.length}</strong> Zugänge</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--green)"></span><strong>${active}</strong> aktiv</span>
      ${privileged() ? `<span class="summary-chip"><span class="dot" style="--dot:var(--awo)"></span><strong>${admins}</strong> Administrator:in</span>` : ''}
      <span class="summary-chip"><span class="dot" style="--dot:#aeb5c0"></span><strong>${deactivated}</strong> deaktiviert</span>
      <span class="summary-chip"><span class="dot" style="--dot:#94a3b8"></span><strong>${anonymized}</strong> anonymisiert</span>
      <span class="summary-chip">${icon('shield')} ${db.roles?.length || 0} Rollen</span>
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
        <span class="text-muted">Nur deaktivierte Konten können anonymisiert werden. Aktive Konten müssen zuerst deaktiviert werden.</span>
      </div>
    </section>

    ${privileged() ? `<form class="card settings-card mt-18" id="userPolicyForm">
      <div class="card-head bordered">
        <div><h3 class="card-title">Automatische Anonymisierung</h3><p class="card-sub">Gilt global für deaktivierte Benutzerkonten.</p></div>
        <span class="badge badge-${autoAnonymizeDays ? 'green' : 'gray'} no-dot">${autoAnonymizeDays ? `Aktiv · ${autoAnonymizeDays} Tage` : 'Deaktiviert'}</span>
      </div>
      <div class="card-body">
        <div class="form-grid">
          <div class="field">
            <label for="autoAnonymizeDays">Frist nach Deaktivierung</label>
            <div class="inline-number">
              <input class="input" id="autoAnonymizeDays" name="autoAnonymizeDays" type="number" min="0" max="3650" step="1" value="${autoAnonymizeDays}">
              <span>Tage</span>
            </div>
            <p class="field-hint">0 bedeutet: keine automatische Anonymisierung. Die Prüfung erfolgt regelmäßig auf dem Server.</p>
          </div>
          <div class="info-banner">
            ${icon('shield')}
            <div><strong>Was wird anonymisiert?</strong><p>Name, E-Mail-Adresse, Passwort und Sitzungen werden entfernt. Verknüpfte Buchungen, Kosten und Audit-Einträge bleiben erhalten. Die Aktion ist endgültig.</p></div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="text-muted">${deactivated ? `${deactivated} deaktivierte ${deactivated === 1 ? 'Konto ist' : 'Konten sind'} aktuell nicht anonymisiert.` : 'Keine deaktivierten Konten vorhanden.'}</span>
        <button class="btn btn-primary btn-sm" type="submit">${icon('check')} Frist speichern</button>
      </div>
    </form>` : `<section class="card settings-card mt-18">
      <div class="card-head bordered">
        <div><h3 class="card-title">Automatische Anonymisierung</h3><p class="card-sub">Gilt global für deaktivierte Benutzerkonten.</p></div>
        <span class="badge badge-gray no-dot">Nur Administrator:innen</span>
      </div>
      <div class="card-body">
        <div class="info-banner">
          ${icon('shield')}
          <div><strong>Administrator:innen vorbehalten</strong><p>Die globale Frist für die automatische Anonymisierung wird zentral durch Administrator:innen verwaltet. Die Benutzerverwaltung bleibt davon unberührt.</p></div>
        </div>
      </div>
    </section>`}`;
}

/* =========================================================
   Rollen & Rechte
   ========================================================= */
function renderRoles() {
  if (!can('roles_manage')) return emptyState('shield', 'Keine Berechtigung', 'Für die Rollenverwaltung fehlt die Berechtigung „Rollen verwalten“.');
  const roles = db.roles || [];
  const customCount = roles.filter((role) => !role.isSystem).length;
  const assigned = roles.reduce((sum, role) => sum + Number(role.userCount || 0), 0);

  const permissionSummary = (role) => permissionGroups.map((group) => {
    const count = group.permissions.filter((permission) => role.permissions.includes(permission.key)).length;
    return `<span class="badge badge-${count ? 'blue' : 'gray'} no-dot">${esc(group.label)} ${count}/${group.permissions.length}</span>`;
  }).join('');

  const rows = roles.map((role) => {
    const superadminRole = role.id === 'superadmin';
    const protectedRole = role.id === 'admin' || superadminRole;
    const manageable = canManageRole(role);
    const objectOverrideCount = Object.values(role.objectPermissions || {})
      .reduce((sum, entries) => sum + Object.keys(entries || {}).length, 0);
    const policyCount = (role.bookingRequestPolicy?.allow?.length || 0) + (role.bookingRequestPolicy?.deny?.length || 0);
    const typeBadge = superadminRole
      ? `<span class="badge badge-red no-dot">${icon('lock', 'icon-xs')} Datei-verwaltet</span>`
      : protectedRole
        ? '<span class="badge badge-red no-dot">Geschützt</span>'
        : role.isSystem
          ? '<span class="badge badge-gray no-dot">Systemrolle</span>'
          : '<span class="badge badge-blue no-dot">Eigene Rolle</span>';
    const actions = manageable
      ? [
          `<button class="table-action" type="button" title="Rolle bearbeiten" aria-label="Rolle bearbeiten" data-action="edit-role" data-id="${role.id}">${icon('edit')}</button>`,
          `<button class="table-action" type="button" title="Objekt-Ausnahmen bearbeiten" aria-label="Objekt-Ausnahmen bearbeiten" data-action="edit-role-objects" data-id="${role.id}">${icon('filter')}</button>`,
          !role.isSystem && !role.userCount
            ? `<button class="table-action danger" type="button" title="Rolle löschen" aria-label="Rolle löschen" data-action="delete-role" data-id="${role.id}">${icon('trash')}</button>`
            : ''
        ].join('')
      : `<span class="table-action" title="${superadminRole ? 'Die Superadmin-Rolle ist systemgeschützt und ausschließlich datei-verwaltet' : protectedRole ? 'Die Administrator-Rolle ist geschützt' : 'Nur Rollen unterhalb des eigenen Rangs und innerhalb des Grant Ceilings bearbeitbar'}" aria-label="Nur lesbar" style="pointer-events:none;color:var(--muted)">${superadminRole ? icon('lock') : icon('shield')}</span>`;
    return `
      <tr>
        <td>
          <span class="table-main">${esc(role.name)}</span>
          <span class="table-sub">${superadminRole ? 'Sonderrolle · ausschließlich über SUPERADMIN_FILE' : protectedRole ? 'Voller Zugriff auf alle Funktionen' : role.isSystem ? 'Standardrolle der Fuhrparkleitung' : 'Individuell konfigurierbare Rolle'}</span>
        </td>
        <td><span class="table-main">${formatNumber(role.rank || 0)}</span><span class="table-sub">Höher = mehr Rechte</span></td>
        <td><span class="table-main">${role.userCount || 0}</span><span class="table-sub">${role.userCount === 1 ? 'Benutzer:in' : 'Benutzer:innen'}</span></td>
        <td>
          <div class="role-permissions">
            ${permissionSummary(role)}
            ${objectOverrideCount ? `<span class="badge badge-violet no-dot">${objectOverrideCount} Objekt-Ausnahmen</span>` : ''}
            ${policyCount ? `<span class="badge badge-amber no-dot">${policyCount} Policy-Einträge</span>` : ''}
          </div>
        </td>
        <td>${typeBadge}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
  }).join('');

  return `
    ${pageHead('Organisation', 'Rollen & Rechte', 'Rangfolge, Modulrechte und feine Objekt-Ausnahmen innerhalb des eigenen Grant Ceilings verwalten.',
      `<button class="btn btn-primary" type="button" data-action="new-role">${icon('plus')} Rolle anlegen</button>`)}
    <div class="summary-chips" style="margin-bottom:18px">
      <span class="summary-chip"><strong>${roles.length}</strong> Rollen</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--blue)"></span><strong>${customCount}</strong> eigene Rollen</span>
      <span class="summary-chip"><span class="dot" style="--dot:var(--green)"></span><strong>${assigned}</strong> Zuweisungen</span>
    </div>
    <section class="card">
      <div class="card-head bordered">
        <div><h3 class="card-title">Rollenübersicht</h3><p class="card-sub">Modulrechte steuern und pro Objekt übersteuern</p></div>
        <span class="badge badge-gray no-dot">${roles.length} gesamt</span>
      </div>
      ${roles.length ? `<div class="table-wrap is-scroll"><table class="data-table">
        <thead><tr><th>Rolle</th><th>Rang</th><th>Benutzer:innen</th><th>Berechtigungen</th><th>Typ</th><th class="num">Aktion</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('shield', 'Noch keine Rollen', 'Legen Sie die erste eigene Rolle an.', '<button class="btn btn-primary btn-sm" type="button" data-action="new-role">Rolle anlegen</button>')}
      <div class="card-footer">
        <span class="text-muted">Verwaltungsrechte schließen die zugehörigen Ansichtsrechte automatisch ein.</span>
        <span class="text-muted">Objekt-Ausnahmen haben Vorrang vor den Modulrechten.</span>
      </div>
    </section>`;
}

/* =========================================================
   Eigene Fahrten & Buchungsanfragen
   ========================================================= */
function renderOwnTrips() {
  if (!db.ownTrips) {
    return emptyState('shield', 'Keine Fahrtenfreigabe', 'Ihr Konto ist nicht mit einem Fahrerprofil verknüpft oder der Zugriff auf eigene Fahrten ist nicht freigegeben.');
  }
  const trips = db.ownTrips.bookings;
  const requests = db.ownTrips.requests;
  const openRequests = requests.filter((request) => request.status === 'requested').length;
  const planned = trips.filter((trip) => trip.status === 'planned').length;
  const active = trips.filter((trip) => trip.status === 'active').length;
  const completed = trips.filter((trip) => trip.status === 'completed').length;
  const canExecute = Boolean(db.ownTrips.canExecute);

  const tripRows = trips.map((trip) => {
    const distance = trip.startKm != null && trip.endKm != null ? Math.max(0, Number(trip.endKm) - Number(trip.startKm)) : null;
    const action = canExecute && trip.status === 'planned'
      ? `<button class="btn btn-soft btn-sm" type="button" data-action="start-booking" data-id="${trip.id}">${icon('play')} Fahrt starten</button>`
      : canExecute && trip.status === 'active'
        ? `<button class="btn btn-primary btn-sm" type="button" data-action="end-booking" data-id="${trip.id}">${icon('stop')} Fahrt beenden</button>`
        : '<span class="text-muted">—</span>';
    return `
      <tr>
        <td><span class="table-main">${formatDate(trip.start)}</span><span class="table-sub">${formatTimeRange(trip.start, trip.end)}</span></td>
        <td><div class="table-vehicle"><span class="vehicle-dot" style="--dot:${esc(trip.vehicleColor)}"></span><div><span class="table-main">${esc(trip.vehicleName || '-')}</span><span class="table-sub">${esc(trip.vehiclePlate || '')}</span></div></div></td>
        <td><span class="table-main">${esc(trip.purpose)}</span>${distance != null ? `<span class="table-sub">${formatKm(distance)}</span>` : ''}</td>
        <td>${statusBadge(trip.status)}</td>
        <td class="num">${action}</td>
      </tr>`;
  }).join('');

  const requestRows = requests.map((request) => `
    <tr>
      <td><span class="table-main">${formatDate(request.start)}</span><span class="table-sub">${formatTimeRange(request.start, request.end)}</span></td>
      <td><div class="table-vehicle"><span class="vehicle-dot" style="--dot:${esc(request.vehicleColor)}"></span><div><span class="table-main">${esc(request.vehicleName || '—')}</span><span class="table-sub">${esc(request.vehiclePlate || '')}</span></div></div></td>
      <td><span class="table-main">${esc(request.purpose)}</span>${request.notes ? `<span class="table-sub">${esc(request.notes)}</span>` : ''}</td>
      <td>${requestStatusBadge(request.status)}${request.decisionNote ? `<span class="table-sub">${esc(request.decisionNote)}</span>` : ''}</td>
      <td class="num">${request.status === 'requested' ? `<button class="btn btn-ghost btn-sm" type="button" data-action="cancel-booking-request" data-id="${request.id}">Zurückziehen</button>` : '<span class="text-muted">—</span>'}</td>
    </tr>`).join('');

  return `
    ${pageHead('Eigene Fahrten', 'Meine Fahrten', `${esc(db.ownTrips.driver.name)} · eigene Buchungen und Anfragen im Überblick.`,
      db.ownTrips.canRequest ? `<button class="btn btn-primary" type="button" data-action="new-booking-request">${icon('plus')} Buchung anfragen</button>` : '')}
    <div class="info-banner" style="margin-bottom:18px">
      ${icon('shield')}
      <div><strong>${canExecute ? 'Eigene Fahrten verwalten' : 'Schreibgeschützte Ansicht'}</strong><p>${canExecute ? 'Sie können Ihre eigenen geplanten Fahrten starten und aktive Fahrten beenden.' : 'Hier sehen Sie ausschließlich Ihre eigenen Buchungen und Anfragen.'} Stammdaten, fremde Fahrten und Exporte sind nicht freigegeben.</p></div>
    </div>
    <div class="kpi-grid">
      ${metricCard({ label: 'Geplante Fahrten', value: planned, sub: 'Eigene geplante Buchungen', iconName: 'calendar', tint: 'tint-blue', badge: '<span class="badge badge-blue no-dot">Geplant</span>', glow: 'rgba(37,99,235,.055)' })}
      ${metricCard({ label: 'Aktive Fahrten', value: active, sub: 'Eigene laufende Fahrten', iconName: 'route', tint: 'tint-green', badge: '<span class="badge badge-green no-dot">Aktiv</span>', glow: 'rgba(17,138,91,.055)' })}
      ${metricCard({ label: 'Abgeschlossen', value: completed, sub: 'Eigene dokumentierte Fahrten', iconName: 'book', tint: 'tint-violet', badge: '<span class="badge badge-violet no-dot">Historie</span>', glow: 'rgba(109,71,217,.05)' })}
      ${metricCard({ label: 'Offene Anfragen', value: openRequests, sub: 'Warten auf Entscheidung', iconName: 'calendar-check', tint: 'tint-amber', badge: '<span class="badge badge-amber no-dot">Anfragen</span>', glow: 'rgba(184,104,0,.06)' })}
    </div>
    <section class="card mt-18">
      <div class="card-head bordered">
        <div><h3 class="card-title">Meine Buchungen</h3><p class="card-sub">Geplant, aktiv und abgeschlossen</p></div>
        <span class="badge badge-gray no-dot">${trips.length} gesamt</span>
      </div>
      ${trips.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Zeitraum</th><th>Fahrzeug</th><th>Zweck</th><th>Status</th><th class="num">Aktion</th></tr></thead>
        <tbody>${tripRows}</tbody>
      </table></div>` : emptyState('calendar', 'Noch keine eigenen Buchungen', 'Sobald für Sie eine Fahrt gebucht wurde, erscheint sie hier.', '', true)}
    </section>
    <section class="card mt-18">
      <div class="card-head bordered">
        <div><h3 class="card-title">Meine Buchungsanfragen</h3><p class="card-sub">Offene und entschiedene Anfragen</p></div>
        <span class="badge badge-gray no-dot">${requests.length} gesamt</span>
      </div>
      ${requests.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Zeitraum</th><th>Fahrzeug</th><th>Zweck / Notiz</th><th>Status / Entscheidung</th><th class="num">Aktion</th></tr></thead>
        <tbody>${requestRows}</tbody>
      </table></div>` : emptyState('calendar-check', 'Noch keine Anfragen', db.ownTrips.canRequest ? 'Stellen Sie eine Buchungsanfrage für ein Fahrzeug.' : 'Für Buchungsanfragen fehlt die Freigabe.', db.ownTrips.canRequest ? '<button class="btn btn-soft btn-sm" type="button" data-action="new-booking-request">Buchung anfragen</button>' : '', true)}
    </section>`;
}

function renderBookingRequests() {
  if (!can('booking_requests_manage')) {
    return emptyState('shield', 'Keine Berechtigung', 'Für Buchungsanfragen fehlt die Berechtigung „Buchungsanfragen verwalten“.');
  }
  const requests = db.bookingRequests || [];
  const rows = requests.map((request) => `
    <tr>
      <td>
        <span class="table-main">${esc(request.requesterName || 'Unbekannt')}</span>
        <span class="table-sub">${esc(roleLabel(request.requesterRole))}</span>
      </td>
      <td>
        <span class="table-main">${formatDate(request.start)}</span>
        <span class="table-sub">${formatTimeRange(request.start, request.end)}</span>
      </td>
      <td>
        <div class="table-vehicle">
          <span class="vehicle-dot" style="--dot:${esc(request.vehicleColor)}"></span>
          <div><span class="table-main">${esc(request.vehicleName || '—')}</span><span class="table-sub">${esc(request.vehiclePlate || '')}</span></div>
        </div>
      </td>
      <td>
        <span class="table-main">${esc(request.purpose)}</span>
        ${request.notes ? `<span class="table-sub">${esc(request.notes)}</span>` : ''}
      </td>
      <td class="num">
        <div class="table-actions">
          <button class="btn btn-primary btn-sm" type="button" data-action="approve-booking-request" data-id="${request.id}">${icon('check')} Genehmigen</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="reject-booking-request" data-id="${request.id}">${icon('x')} Ablehnen</button>
        </div>
      </td>
    </tr>`).join('');
  return `
    ${pageHead('Buchungen', 'Buchungsanfragen', 'Offene Anfragen innerhalb Ihres Rang- und Rollenbereichs prüfen und entscheiden.', '')}
    <div class="summary-chips" style="margin-bottom:18px">
      <span class="summary-chip"><strong>${requests.length}</strong> offene ${requests.length === 1 ? 'Anfrage' : 'Anfragen'}</span>
      <span class="summary-chip">${icon('shield')} Sichtbarkeit nach Rang und Rollen-Policy</span>
      <span class="summary-chip">${icon('calendar-check')} Genehmigung erzeugt genau eine geplante Buchung</span>
    </div>
    <section class="card">
      <div class="card-head bordered">
        <div><h3 class="card-title">Offene Anfragen</h3><p class="card-sub">Eigene Anfragen können nicht selbst entschieden werden.</p></div>
        <span class="badge badge-${requests.length ? 'amber' : 'gray'} no-dot">${requests.length} offen</span>
      </div>
      ${requests.length ? `<div class="table-wrap is-scroll"><table class="data-table">
        <thead><tr><th>Antragsteller:in</th><th>Zeitraum</th><th>Fahrzeug</th><th>Zweck / Notiz</th><th class="num">Entscheidung</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : emptyState('calendar-check', 'Keine offenen Buchungsanfragen', 'Aktuell liegen keine Anfragen in Ihrem zulässigen Rang- und Rollenbereich vor.', '', true)}
      <div class="card-footer">
        <span class="text-muted">Mehrere offene Anfragen für denselben Zeitraum sind möglich. Die erste Genehmigung gewinnt.</span>
      </div>
    </section>`;
}

/* =========================================================
   Audit-Log
   ========================================================= */
function auditScopeMeta(scope) {
  if (scope === 'all') {
    return {
      label: 'Alle Aktivitäten',
      description: 'Sie sehen alle Audit-Einträge, einschließlich Meta- und Systemeinträgen.'
    };
  }
  if (scope === 'rank') {
    return {
      label: 'Mein Rangbereich',
      description: 'Sie sehen Ihre eigenen Aktionen sowie Aktionen von Personen mit strikt niedrigerem Rang.'
    };
  }
  if (scope === 'self') {
    return {
      label: 'Meine Aktivitäten',
      description: 'Sie sehen ausschließlich Ihre eigenen Aktionen. Suche und Filter können diesen Bereich nicht erweitern.'
    };
  }
  return {
    label: 'Ihre Aktivitäten',
    description: 'Der Server bestimmt den sichtbaren Bereich anhand Ihrer Berechtigungen.'
  };
}

function auditActionTone(action) {
  if (['create', 'start', 'complete', 'login'].includes(action)) return 'green';
  if (['delete', 'cancel', 'login_failed'].includes(action)) return 'red';
  if (['update', 'change_password'].includes(action)) return 'blue';
  if (['export', 'anonymize'].includes(action)) return 'violet';
  if (['read', 'logout'].includes(action)) return 'gray';
  return 'gray';
}

function shortAuditId(value) {
  const text = String(value || '');
  if (!text) return '';
  return text.length > 10 ? `${text.slice(0, 8)}…` : text;
}

function renderAuditResults(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    if (hasActiveAuditFilters()) {
      return emptyState(
        'search',
        'Keine Treffer',
        'Für die gewählten Such- und Filterkriterien gibt es im freigegebenen Bereich keine Einträge.',
        '<button class="btn btn-ghost btn-sm" type="button" data-action="audit-reset">Filter zurücksetzen</button>'
      );
    }
    if (data?.scope === 'self') {
      return emptyState('history', 'Noch keine eigenen Aktionen', 'Sobald Sie Änderungen vornehmen, erscheinen Ihre Aktivitäten hier.');
    }
    if (data?.scope === 'rank') {
      return emptyState('shield', 'Keine Aktionen im Rangbereich', 'Im freigegebenen Rangbereich sind für den gewählten Zeitraum keine Aktivitäten vorhanden.');
    }
    return emptyState('history', 'Noch keine Audit-Einträge', 'Für den gewählten Zeitraum liegen keine protokollierten Aktivitäten vor.');
  }

  const rows = items.map((item) => {
    const actor = item.actor || { id: null, name: 'System', roleName: null, rank: null };
    const isSelf = actor.id && currentUser?.id === actor.id;
    const roleMeta = actor.roleName
      ? `<span class="table-main">${esc(actor.roleName)}</span>`
      : actor.id
        ? '<span class="table-main">—</span>'
        : '<span class="table-main">System</span>';
    const rankMeta = actor.rank === null || actor.rank === undefined
      ? ''
      : `<span class="table-sub">Rang ${formatNumber(actor.rank)}</span>`;
    const actionText = item.actionLabel || AUDIT_ACTION_LABELS[item.action] || item.action;
    const details = Array.isArray(item.detailsSummary) && item.detailsSummary.length
      ? `<div class="audit-details">${item.detailsSummary.map((entry) => `
          <span class="audit-detail"><span>${esc(entry.label)}</span><strong>${esc(entry.value)}</strong></span>
        `).join('')}</div>`
      : '<span class="text-muted">—</span>';
    const targetMeta = item.entityId
      ? `<span class="table-sub">#${esc(shortAuditId(item.entityId))}</span>`
      : '';
    return `
      <tr>
        <td>
          <span class="table-main">${esc(formatDateTime(item.createdAt))}</span>
          <span class="table-sub">#${esc(item.id)}${item.isMeta ? ' · Meta' : ''}</span>
        </td>
        <td>
          <div class="table-person">
            ${driverAvatar({ name: actor.name || 'System', color: actor.anonymized ? '#94a3b8' : '#2563eb' }, 'avatar-sm')}
            <div>
              <span class="table-main">${esc(actor.name || 'System')} ${isSelf ? '<span class="badge badge-gray no-dot">Sie</span>' : ''}</span>
              ${actor.anonymized ? '<span class="table-sub">Konto anonymisiert</span>' : ''}
            </div>
          </div>
        </td>
        <td>${roleMeta}${rankMeta}</td>
        <td>
          <span class="badge badge-${auditActionTone(item.action)}">${esc(actionText)}</span>
          <span class="table-sub">${esc(item.entityTypeLabel || AUDIT_ENTITY_LABELS[item.entityType] || item.entityType)}</span>
        </td>
        <td>
          <span class="table-main">${esc(item.targetLabel || '—')}</span>
          ${targetMeta}
        </td>
        <td>${details}</td>
      </tr>`;
  }).join('');

  return `<div class="table-wrap"><table class="data-table audit-table">
    <thead><tr><th>Zeit</th><th>Akteur:in</th><th>Rolle</th><th>Aktion</th><th>Ziel</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderAuditPagination(data) {
  const page = Math.max(1, Number(data?.page) || 1);
  const totalPages = Math.max(0, Number(data?.totalPages) || 0);
  const total = Number(data?.total) || 0;
  const lastPage = Math.max(1, totalPages);
  return `
    <div class="table-footer audit-pagination">
      <span>${formatNumber(total)} ${total === 1 ? 'Eintrag' : 'Einträge'} · Seite ${page} von ${lastPage}</span>
      <div class="audit-pager">
        <button class="btn btn-ghost btn-sm" type="button" data-action="audit-page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Vorherige Seite">
          ${icon('chevron-left')} Zurück
        </button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="audit-page" data-page="${page + 1}" ${totalPages === 0 || page >= totalPages ? 'disabled' : ''} aria-label="Nächste Seite">
          Weiter ${icon('chevron-right')}
        </button>
      </div>
    </div>`;
}

function renderAudit() {
  ensureAuditFilters();
  const scope = auditScopeMeta(ui.auditData?.scope);
  const actionOptions = Object.entries(AUDIT_ACTION_LABELS)
    .map(([value, label]) => `<option value="${esc(value)}" ${ui.auditAction === value ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
  const entityOptions = Object.entries(AUDIT_ENTITY_LABELS)
    .map(([value, label]) => `<option value="${esc(value)}" ${ui.auditEntityType === value ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
  const pageSizeOptions = [25, 50, 100]
    .map((value) => `<option value="${value}" ${Number(ui.auditPageSize) === value ? 'selected' : ''}>${value}</option>`)
    .join('');

  return `
    ${pageHead('Transparenz', 'Audit-Log', 'Nachvollziehbare Aktivitäten im Rahmen Ihrer Berechtigungen. Einträge sind schreibgeschützt.',
      '<span class="badge badge-gray no-dot">Schreibgeschützt</span>')}
    <section class="audit-scope-banner" aria-labelledby="auditScopeLabel">
      <span class="audit-scope-icon">${icon('shield')}</span>
      <div class="audit-scope-copy">
        <span class="eyebrow">Ihr Sichtbereich</span>
        <strong id="auditScopeLabel">${esc(scope.label)}</strong>
        <span id="auditScopeText">${esc(scope.description)}</span>
      </div>
    </section>

    <form class="card audit-filter-card" id="auditFilterForm">
      <div class="card-body">
        <div class="audit-filter-grid">
          <div class="field audit-filter-wide">
            <label for="auditQuery">Suche</label>
            <div class="input-icon-wrap audit-search-wrap">
              ${icon('search')}
              <input class="input" id="auditQuery" name="q" type="search" value="${esc(ui.auditQuery)}" placeholder="Akteur:in, Rolle, Aktion, Ziel …" autocomplete="off">
            </div>
          </div>
          <div class="field">
            <label for="auditActor">Akteur:in</label>
            <input class="input" id="auditActor" name="actor" type="search" value="${esc(ui.auditActor)}" placeholder="Name oder ID" autocomplete="off">
          </div>
          <div class="field">
            <label for="auditAction">Aktion</label>
            <select class="select" id="auditAction" name="action">
              <option value="">Alle Aktionen</option>
              ${actionOptions}
            </select>
          </div>
          <div class="field">
            <label for="auditEntityType">Zieltyp</label>
            <select class="select" id="auditEntityType" name="entityType">
              <option value="">Alle Zieltypen</option>
              ${entityOptions}
            </select>
          </div>
          <div class="field">
            <label for="auditTarget">Ziel/Objekt</label>
            <input class="input" id="auditTarget" name="target" type="search" value="${esc(ui.auditTarget)}" placeholder="Label oder ID" autocomplete="off">
          </div>
          <div class="field">
            <label for="auditFrom">Von</label>
            <input class="input" id="auditFrom" name="from" type="date" value="${esc(ui.auditFrom)}">
          </div>
          <div class="field">
            <label for="auditTo">Bis</label>
            <input class="input" id="auditTo" name="to" type="date" value="${esc(ui.auditTo)}">
          </div>
          <div class="field">
            <label for="auditPageSize">Einträge pro Seite</label>
            <select class="select" id="auditPageSize" name="pageSize">
              ${pageSizeOptions}
            </select>
          </div>
        </div>
        <div class="audit-filter-actions">
          <span class="text-muted">Die Suche nutzt ausschließlich freigegebene Felder; Details werden serverseitig reduziert.</span>
          <div class="audit-filter-buttons">
            <button class="btn btn-ghost btn-sm" type="button" data-action="audit-reset">${icon('x')} Zurücksetzen</button>
            <button class="btn btn-primary btn-sm" type="submit">${icon('filter')} Filter anwenden</button>
          </div>
        </div>
      </div>
    </form>

    <section class="card mt-18">
      <div class="card-head bordered">
        <div><h3 class="card-title">Ereignisse</h3><p class="card-sub">Neueste Einträge zuerst · Zeitraum inklusive</p></div>
        <span id="auditTotal" class="badge badge-gray no-dot">Wird geladen …</span>
      </div>
      <div id="auditResults" aria-live="polite">
        <div class="audit-loading" role="status"><span class="app-spinner"></span><span>Audit-Einträge werden geladen …</span></div>
      </div>
      <div id="auditPagination"></div>
    </section>`;
}

/* =========================================================
   Routen
   ========================================================= */
const ROUTES = {
  dashboard: renderDashboard,
  'meine-fahrten': renderOwnTrips,
  fahrzeuge: renderVehicles,
  buchungen: renderBookings,
  anfragen: renderBookingRequests,
  fahrtenbuch: renderLogbook,
  wartung: renderMaintenance,
  kosten: renderCosts,
  fahrer: renderDrivers,
  audit: renderAudit,
  benutzer: renderUsers,
  rollen: renderRoles,
  einstellungen: renderSettings,
  integrationen: renderIntegrations,
  erweitert: renderAdvanced
};

