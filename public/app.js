'use strict';

/* =========================================================
   Zustand & Datenzugriff
   ========================================================= */
let db;
let currentUser = null;
let csrfToken = '';
let permissions = new Set();
let permissionGroups = [];
let objectTypes = [];
let capabilities = { isAdmin: false, manageUsers: false, viewCosts: false };
let ui = {
  route: 'dashboard',
  vehicleQuery: '',
  vehicleType: 'all',
  vehicleStatus: 'all',
  bookingTab: 'calendar',
  weekOffset: 0,
  maintenanceFilter: 'all',
  costCategory: 'all',
  costVehicle: 'all',
  logPeriod: '30'
};

const ROLE_LABELS = { admin: 'Administrator', manager: 'Fuhrparkleitung' };

function can(permission) {
  if (!permission) return true;
  if (capabilities.isAdmin || permissions.has(permission)) return true;
  return Boolean(db?.access?.modules?.[permission]);
}

function canBase(permission) {
  if (!permission) return true;
  return Boolean(capabilities.isAdmin || permissions.has(permission));
}

function canOn(type, id, permission) {
  if (capabilities.isAdmin) return true;
  return Boolean(db?.access?.objects?.[type]?.[id]?.[permission]);
}

function roleLabel(roleId) {
  const role = db?.roles?.find((entry) => entry.id === roleId);
  if (role) return role.name;
  if (currentUser?.role === roleId && currentUser?.roleName) return currentUser.roleName;
  return ROLE_LABELS[roleId] || roleId || '—';
}

function routeAllowed(route) {
  if (route === 'benutzer' || route === 'rollen') return Boolean(capabilities.isAdmin);
  const permission = ROUTE_PERMISSIONS[route];
  return !permission || can(permission);
}

function firstAllowedRoute() {
  const order = ['dashboard', 'fahrzeuge', 'buchungen', 'fahrtenbuch', 'wartung', 'kosten', 'fahrer', 'einstellungen'];
  return order.find((route) => routeAllowed(route)) || 'dashboard';
}

function getVehicle(id) {
  return db.vehicles.find((vehicle) => vehicle.id === id);
}

function getDriver(id) {
  return db.drivers.find((driver) => driver.id === id);
}

function isMaintenanceDone(item) {
  return Boolean(item && (item.completedAt || item.status === 'done'));
}

function maintenanceState(item) {
  if (isMaintenanceDone(item)) {
    return { key: 'done', label: 'Erledigt', badge: 'green', days: null };
  }
  const days = daysUntil(item.dueDate);
  if (days < 0) return { key: 'overdue', label: 'Überfällig', badge: 'red', days };
  if (days <= 14) return { key: 'due', label: 'Bald fällig', badge: 'amber', days };
  return { key: 'planned', label: 'Geplant', badge: 'gray', days };
}

function getOpenMaintenance() {
  return db.maintenance.filter((item) => !isMaintenanceDone(item));
}

function driverDisplayStatus(driver) {
  if (driver.status === 'away') return { key: 'away', label: 'Abwesend', badge: 'gray' };
  const active = db.bookings.some((booking) => booking.driverId === driver.id && booking.status === 'active');
  if (active) return { key: 'active', label: 'Im Einsatz', badge: 'blue' };
  return { key: 'available', label: 'Verfügbar', badge: 'green' };
}

function getAlerts() {
  const items = [];
  db.vehicles.forEach((vehicle) => {
    const days = daysUntil(vehicle.tuv);
    if (days === null || days > 60) return;
    const overdue = days < 0;
    items.push({
      id: `tuv-${vehicle.id}`,
      readKey: `tuv-${vehicle.id}-${overdue ? 'danger' : 'warning'}`,
      severity: overdue ? 'danger' : 'warning',
      icon: 'shield',
      title: overdue ? 'HU/AU überfällig' : 'HU/AU steht an',
      text: `${vehicle.name} · ${overdue ? `seit ${Math.abs(days)} ${Math.abs(days) === 1 ? 'Tag' : 'Tagen'} überfällig` : `${formatDate(vehicle.tuv)} (${humanDays(days)})`}`,
      route: 'wartung',
      days
    });
  });
  getOpenMaintenance().forEach((item) => {
    const days = daysUntil(item.dueDate);
    if (days > 30) return;
    const vehicle = getVehicle(item.vehicleId);
    const overdue = days < 0;
    items.push({
      id: `maint-${item.id}`,
      readKey: `maint-${item.id}-${overdue ? 'danger' : 'warning'}`,
      severity: overdue ? 'danger' : 'warning',
      icon: 'wrench',
      title: item.title,
      text: `${vehicle ? vehicle.name : 'Fahrzeug'} · ${overdue ? `seit ${Math.abs(days)} ${Math.abs(days) === 1 ? 'Tag' : 'Tagen'} fällig` : `${formatDate(item.dueDate)} (${humanDays(days)})`}`,
      route: 'wartung',
      days
    });
  });
  const rank = { danger: 0, warning: 1, info: 2 };
  return items.sort((a, b) => (rank[a.severity] - rank[b.severity]) || ((a.days ?? 0) - (b.days ?? 0)) || a.title.localeCompare(b.title, 'de'));
}

function getCompletedBookings(period = ui.logPeriod) {
  const today = todayISO();
  let cutoff = null;
  if (period === '30') cutoff = addDays(today, -30);
  if (period === '90') cutoff = addDays(today, -90);
  return db.bookings
    .filter((booking) => booking.status === 'completed')
    .filter((booking) => {
      if (!cutoff) return true;
      const date = booking.start.slice(0, 10);
      return date >= cutoff && date <= today;
    })
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

/* =========================================================
   Server-Kommunikation
   ========================================================= */
function applyState(state) {
  if (!state || typeof state !== 'object') throw new Error('Der Server hat keine gültigen Daten geliefert.');
  db = {
    meta: state.meta || { version: 1, seededAt: null },
    settings: state.settings || { orgName: 'Ihre Organisation', brandName: '', location: '', email: '', phone: '', theme: 'awo', accentColor: '#0f766e', sidebarStyle: 'dark', pageBackground: '#f4f5f7', surfaceColor: '#ffffff', textColor: '#191c23', mutedColor: '#737a88', borderColor: '#e7e9ee', autoAnonymizeDays: 0, logoUrl: null },
    vehicles: Array.isArray(state.vehicles) ? state.vehicles : [],
    drivers: Array.isArray(state.drivers) ? state.drivers : [],
    bookings: Array.isArray(state.bookings) ? state.bookings : [],
    maintenance: Array.isArray(state.maintenance) ? state.maintenance : [],
    costs: Array.isArray(state.costs) ? state.costs : [],
    notificationReads: Array.isArray(state.notificationReads) ? state.notificationReads : [],
    users: Array.isArray(state.users) ? state.users : [],
    roles: Array.isArray(state.roles) ? state.roles : [],
    access: state.access && typeof state.access === 'object'
      ? {
          modules: state.access.modules || {},
          objects: {
            vehicle: state.access.objects?.vehicle || {},
            driver: state.access.objects?.driver || {},
            booking: state.access.objects?.booking || {},
            cost: state.access.objects?.cost || {},
            maintenance: state.access.objects?.maintenance || {}
          }
        }
      : { modules: {}, objects: { vehicle: {}, driver: {}, booking: {}, cost: {}, maintenance: {} } }
  };
}

async function apiFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    method,
    headers,
    body
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Sitzung abgelaufen.');
  }
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Serverfehler (${response.status}).`);
    error.status = response.status;
    error.details = data?.details || null;
    throw error;
  }
  return data;
}

async function refreshSession() {
  const session = await apiFetch('/api/session');
  currentUser = session.user;
  csrfToken = session.csrfToken;
  permissions = new Set(Array.isArray(session.permissions) ? session.permissions : []);
  permissionGroups = Array.isArray(session.permissionGroups) ? session.permissionGroups : [];
  objectTypes = Array.isArray(session.objectTypes) ? session.objectTypes : [];
  capabilities = {
    isAdmin: Boolean(session.capabilities?.isAdmin),
    manageUsers: Boolean(session.capabilities?.manageUsers),
    viewCosts: Boolean(session.capabilities?.viewCosts)
  };
}

function applyServerState(state) {
  applyState(state);
  updateChrome();
  updateSaveIndicator();
}

async function loadInitialData() {
  await refreshSession();
  const state = await apiFetch('/api/state');
  applyState(state);
}

function getReadNotificationKeys() {
  return new Set(Array.isArray(db.notificationReads) ? db.notificationReads : []);
}

async function markNotificationsRead(keys) {
  const validKeys = [...new Set(keys.filter(Boolean))];
  if (!validKeys.length) return;
  try {
    const state = await apiFetch('/api/notifications/read', { method: 'POST', body: { keys: validKeys } });
    applyServerState(state);
  } catch (error) {
    toast('Benachrichtigung konnte nicht aktualisiert werden', error.message, 'error');
    throw error;
  }
}

async function markAllNotificationsRead() {
  const unread = getAlerts().filter((alert) => !getReadNotificationKeys().has(alert.readKey));
  if (!unread.length) return;
  try {
    await markNotificationsRead(unread.map((alert) => alert.readKey));
    toast('Alle Hinweise gelesen', `${unread.length} ${unread.length === 1 ? 'Benachrichtigung wurde' : 'Benachrichtigungen wurden'} als gelesen markiert.`, 'info');
  } catch {
    // Fehler wird bereits angezeigt.
  }
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  } catch (error) {
    toast('Abmelden fehlgeschlagen', error.message || 'Bitte versuchen Sie es erneut.', 'error');
  }
}

function updateSaveIndicator() {
  const indicator = $('#saveIndicator');
  if (!indicator) return;
  const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  indicator.textContent = `Server synchronisiert · ${time} Uhr`;
}

/* =========================================================
   App-Chrome
   ========================================================= */
function brandDisplayName() {
  if (db?.settings?.theme === 'neutral') return db.settings.brandName || db.settings.orgName || 'Fuhrparkmanagement';
  return 'AWO';
}

function normalizeHex(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : fallback;
}

function mixHex(hex, target, weight) {
  const parse = (value) => {
    const clean = value.replace('#', '');
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  };
  const from = parse(hex);
  const to = parse(target);
  const mixed = from.map((channel, index) => Math.round(channel + (to[index] - channel) * weight));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function rgbTriplet(hex) {
  const clean = hex.replace('#', '');
  return `${parseInt(clean.slice(0, 2), 16)}, ${parseInt(clean.slice(2, 4), 16)}, ${parseInt(clean.slice(4, 6), 16)}`;
}

function getClientBranding() {
  const theme = db.settings.theme === 'neutral' ? 'neutral' : 'awo';
  const name = theme === 'awo' ? 'AWO' : (db.settings.brandName || db.settings.orgName || 'Fuhrparkmanagement');
  const accentColor = theme === 'awo' ? '#e2001a' : normalizeHex(db.settings.accentColor, '#0f766e');
  const accentDark = mixHex(accentColor, '#000000', theme === 'awo' ? 0.2 : 0.28);
  const accentSoft = mixHex(accentColor, '#ffffff', 0.9);
  const accentDeep = mixHex(accentColor, '#000000', 0.65);
  const pageBackground = theme === 'awo' ? '#f4f5f7' : normalizeHex(db.settings.pageBackground, '#f4f5f7');
  const surfaceColor = theme === 'awo' ? '#ffffff' : normalizeHex(db.settings.surfaceColor, '#ffffff');
  const textColor = theme === 'awo' ? '#191c23' : normalizeHex(db.settings.textColor, '#191c23');
  const mutedColor = theme === 'awo' ? '#737a88' : normalizeHex(db.settings.mutedColor, '#737a88');
  const borderColor = theme === 'awo' ? '#e7e9ee' : normalizeHex(db.settings.borderColor, '#e7e9ee');
  const surface2Color = mixHex(surfaceColor, pageBackground, 0.45);
  const ink2Color = mixHex(textColor, surfaceColor, 0.16);
  const lineSoftColor = mixHex(borderColor, surfaceColor, 0.45);
  const sidebarStyle = theme === 'awo' ? 'dark' : (db.settings.sidebarStyle === 'light' ? 'light' : 'dark');
  const logoUrl = theme === 'awo' ? '/branding/awo-logo.svg' : db.settings.logoUrl;
  const markClass = logoUrl ? 'has-image' : 'is-initials';
  const markHtml = logoUrl
    ? `<img class="brand-logo" src="${esc(logoUrl)}" alt="${esc(name)}">`
    : `<span class="brand-initials">${esc(initials(name))}</span>`;
  const favicon = logoUrl || '/branding/neutral-favicon.svg';
  return {
    theme,
    name,
    subtitle: 'Fuhrparkmanagement',
    topName: theme === 'awo' ? 'AWO' : name,
    footerName: name,
    logoUrl,
    markClass,
    markHtml,
    favicon,
    accentColor,
    accentDark,
    accentSoft,
    accentDeep,
    brandRgb: rgbTriplet(accentColor),
    pageBackground,
    surfaceColor,
    surface2Color,
    textColor,
    ink2Color,
    mutedColor,
    borderColor,
    lineSoftColor,
    sidebarStyle,
    themeColor: accentColor
  };
}

function applyBranding() {
  if (!db?.settings) return;
  const branding = getClientBranding();
  const root = document.documentElement;
  root.dataset.theme = branding.theme;
  root.dataset.sidebar = branding.sidebarStyle;
  root.style.setProperty('--awo', branding.accentColor);
  root.style.setProperty('--awo-dark', branding.accentDark);
  root.style.setProperty('--awo-soft', branding.accentSoft);
  root.style.setProperty('--brand-deep', branding.accentDeep);
  root.style.setProperty('--brand-rgb', branding.brandRgb);
  root.style.setProperty('--bg', branding.pageBackground);
  root.style.setProperty('--surface', branding.surfaceColor);
  root.style.setProperty('--surface-2', branding.surface2Color);
  root.style.setProperty('--ink', branding.textColor);
  root.style.setProperty('--ink-2', branding.ink2Color);
  root.style.setProperty('--muted', branding.mutedColor);
  root.style.setProperty('--line', branding.borderColor);
  root.style.setProperty('--line-soft', branding.lineSoftColor);
  const mark = $('#brandMark');
  if (mark) {
    mark.className = `brand-mark ${branding.markClass}`;
    mark.innerHTML = branding.markHtml;
  }
  const brandName = $('#brandName');
  const brandSubtitle = $('#brandSubtitle');
  const topbarOrg = $('#topbarOrg');
  const footerOrg = $('#footerOrg');
  const brandLink = $('.brand-link');
  if (brandName) brandName.textContent = branding.name;
  if (brandSubtitle) brandSubtitle.textContent = branding.subtitle;
  if (topbarOrg) topbarOrg.textContent = branding.topName;
  if (footerOrg) footerOrg.textContent = branding.footerName;
  if (brandLink) brandLink.setAttribute('aria-label', `${branding.name} Fuhrparkmanagement – zum Dashboard`);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', branding.themeColor);
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.setAttribute('href', branding.favicon);
}

function updateChrome() {
  if (!db) return;
  applyBranding();
  const userName = $('#userName');
  const userRole = $('#userRole');
  const userAvatar = $('#userAvatar');
  if (currentUser) {
    if (userName) userName.textContent = currentUser.name;
    if (userRole) userRole.textContent = currentUser.roleName || roleLabel(currentUser.role);
    if (userAvatar) userAvatar.textContent = initials(currentUser.name);
  }
  $$('.nav-item').forEach((item) => {
    const route = item.dataset.route;
    if (route) item.hidden = !routeAllowed(route);
  });
  $$('.nav-group').forEach((group) => {
    const items = $$('.nav-item', group);
    if (items.length) group.hidden = items.every((item) => item.hidden);
  });

  const today = todayISO();
  const todayBookings = db.bookings.filter((booking) => booking.start.slice(0, 10) === today && booking.status !== 'canceled').length;
  const navBookingCount = $('#navBookingCount');
  const navVehicleCount = $('#navVehicleCount');
  const navMaintenanceCount = $('#navMaintenanceCount');
  if (navBookingCount) navBookingCount.textContent = todayBookings || '';
  if (navVehicleCount) navVehicleCount.textContent = db.vehicles.length;
  if (navMaintenanceCount) navMaintenanceCount.textContent = getAlerts().length || '';

  const alerts = getAlerts();
  const readKeys = getReadNotificationKeys();
  const unreadAlerts = alerts.filter((alert) => !readKeys.has(alert.readKey));
  const badge = $('#notifBadge');
  const subtitle = $('#notifSubtitle');
  const list = $('#notifList');
  const readAllButton = $('#notifReadAll');
  const notifButton = $('#notifBtn');

  if (badge) {
    badge.textContent = unreadAlerts.length > 9 ? '9+' : String(unreadAlerts.length);
    badge.hidden = unreadAlerts.length === 0;
  }
  if (notifButton) {
    notifButton.setAttribute('aria-label', unreadAlerts.length
      ? `Benachrichtigungen, ${unreadAlerts.length} ungelesen`
      : 'Benachrichtigungen, alle gelesen');
  }
  if (readAllButton) {
    readAllButton.hidden = unreadAlerts.length === 0;
    readAllButton.disabled = unreadAlerts.length === 0;
  }
  if (subtitle) {
    subtitle.textContent = alerts.length
      ? unreadAlerts.length
        ? `${unreadAlerts.length} ungelesen · ${alerts.length} ${alerts.length === 1 ? 'Hinweis' : 'Hinweise'}`
        : `${alerts.length} ${alerts.length === 1 ? 'Hinweis' : 'Hinweise'} · alle gelesen`
      : 'Keine offenen Hinweise';
  }
  if (list) {
    const scrollTop = list.scrollTop;
    list.innerHTML = alerts.length
      ? alerts.slice(0, 7).map((alert) => {
          const tint = alert.severity === 'danger' ? 'tint-red' : alert.severity === 'warning' ? 'tint-amber' : 'tint-blue';
          const isRead = readKeys.has(alert.readKey);
          return `<div class="notif-item ${isRead ? 'is-read' : ''}" data-notif-key="${esc(alert.readKey)}">
            <a class="notif-item-link" href="#/${alert.route}">
              <span class="notif-icon ${tint}">${icon(alert.icon)}</span>
              <span class="notif-body">
                <strong>${isRead ? '' : '<span class="notif-unread-dot"></span>'}${esc(alert.title)}</strong>
                <span>${esc(alert.text)}</span>
              </span>
            </a>
            ${isRead
              ? `<span class="notif-read-state" title="Gelesen" aria-label="Gelesen">${icon('check')}</span>`
              : `<button class="notif-mark" type="button" data-notif-read="${esc(alert.readKey)}" title="Als gelesen markieren" aria-label="Als gelesen markieren">${icon('check')}</button>`}
          </div>`;
        }).join('')
      : `<div class="empty empty-sm"><span class="empty-icon">${icon('check-circle')}</span><strong>Alles im grünen Bereich</strong><span>Aktuell gibt es keine offenen Hinweise.</span></div>`;
    list.scrollTop = scrollTop;
  }
}

function updateNavActive(route) {
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.route === route;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function getRouteFromHash() {
  const route = location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  return ROUTES[route] ? route : 'dashboard';
}

function renderRoute(scrollToTop = true) {
  const requestedRoute = getRouteFromHash();
  ui.route = routeAllowed(requestedRoute) ? requestedRoute : firstAllowedRoute();
  if (ui.route !== requestedRoute) {
    history.replaceState(null, '', `#/${ui.route}`);
  }
  const page = PAGES.find((entry) => entry.route === ui.route) || PAGES[0];
  document.title = `${page.title} · ${brandDisplayName()}`;
  const topbarTitle = $('#topbarTitle');
  if (topbarTitle) topbarTitle.textContent = page.title;
  updateNavActive(ui.route);
  const view = $('#view');
  if (view) view.innerHTML = ROUTES[ui.route]();
  closeNotifications();
  closeSidebar();
  closeSearch(true);
  if (scrollToTop) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function renderCurrentView() {
  const view = $('#view');
  if (!view) return;
  view.innerHTML = ROUTES[ui.route]();
}

/* =========================================================
   Suche
   ========================================================= */
function closeSearch(clearInput = false) {
  const results = $('#searchResults');
  const input = $('#globalSearch');
  if (results) results.hidden = true;
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    if (clearInput) input.value = '';
  }
}

function searchResultMarkup(kind, id, title, subtitle, iconName, route = '') {
  return `<button class="search-result" type="button" role="option" data-search-kind="${kind}" ${id ? `data-search-id="${esc(id)}"` : ''} ${route ? `data-search-route="${esc(route)}"` : ''}>
    <span class="search-result-icon">${icon(iconName)}</span>
    <span class="search-result-main"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></span>
    ${icon('chevron-right', 'icon-sm')}
  </button>`;
}

function renderSearchResults() {
  const input = $('#globalSearch');
  const results = $('#searchResults');
  if (!input || !results) return;
  const query = input.value.trim().toLowerCase();
  if (!query) {
    closeSearch();
    return;
  }

  const pages = PAGES.filter((page) => routeAllowed(page.route) && `${page.title} ${page.description}`.toLowerCase().includes(query)).slice(0, 4);
  const vehicles = db.vehicles.filter((vehicle) => `${vehicle.name} ${vehicle.plate} ${vehicle.location} ${vehicle.department} ${vehicle.type}`.toLowerCase().includes(query)).slice(0, 4);
  const drivers = db.drivers.filter((driver) => `${driver.name} ${driver.role} ${driver.department}`.toLowerCase().includes(query)).slice(0, 4);
  const bookings = db.bookings.filter((booking) => {
    const vehicle = getVehicle(booking.vehicleId);
    const driver = getDriver(booking.driverId);
    return `${booking.purpose} ${vehicle?.name || ''} ${vehicle?.plate || ''} ${driver?.name || ''}`.toLowerCase().includes(query);
  }).slice(0, 3);

  let html = '';
  if (pages.length) {
    html += `<div class="search-group-label">Seiten</div>${pages.map((page) => searchResultMarkup('page', '', page.title, page.description, page.icon, page.route)).join('')}`;
  }
  if (vehicles.length) {
    html += `<div class="search-group-label">Fahrzeuge</div>${vehicles.map((vehicle) => searchResultMarkup('vehicle', vehicle.id, vehicle.name, `${vehicle.plate} · ${VEHICLE_STATUS[vehicle.status]?.label || ''} · ${vehicle.location}`, 'car')).join('')}`;
  }
  if (drivers.length) {
    html += `<div class="search-group-label">Fahrer:innen</div>${drivers.map((driver) => searchResultMarkup('driver', driver.id, driver.name, `${driver.role} · ${driver.department}`, 'users')).join('')}`;
  }
  if (bookings.length) {
    html += `<div class="search-group-label">Buchungen</div>${bookings.map((booking) => {
      const vehicle = getVehicle(booking.vehicleId);
      return searchResultMarkup('booking', booking.id, booking.purpose, `${formatDate(booking.start)} · ${vehicle?.name || ''}`, 'calendar');
    }).join('')}`;
  }
  if (!html) html = `<div class="search-empty">Keine Treffer für „${esc(input.value.trim())}“.</div>`;
  results.innerHTML = html;
  results.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

/* =========================================================
   Benachrichtigungen & Sidebar
   ========================================================= */
function closeNotifications() {
  const panel = $('#notifPanel');
  const button = $('#notifBtn');
  if (panel) panel.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function toggleNotifications() {
  const panel = $('#notifPanel');
  const button = $('#notifBtn');
  if (!panel || !button) return;
  const willOpen = panel.hidden;
  closeSearch();
  panel.hidden = !willOpen;
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}

function openSidebar() {
  $('#sidebar')?.classList.add('is-open');
  const scrim = $('#sidebarScrim');
  if (scrim) scrim.hidden = false;
  document.body.classList.add('nav-open');
  $('#menuBtn')?.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  $('#sidebar')?.classList.remove('is-open');
  const scrim = $('#sidebarScrim');
  if (scrim) scrim.hidden = true;
  document.body.classList.remove('nav-open');
  $('#menuBtn')?.setAttribute('aria-expanded', 'false');
}

/* =========================================================
   Aktionen
   ========================================================= */
async function startBooking(bookingId) {
  if (!canOn('booking', bookingId, 'bookings_manage')) {
    toast('Keine Berechtigung', 'Für diese Buchung fehlt die Berechtigung zum Starten.', 'error');
    return;
  }
  const booking = db.bookings.find((item) => item.id === bookingId);
  const vehicle = booking ? getVehicle(booking.vehicleId) : null;
  try {
    const state = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}/start`, { method: 'POST' });
    applyServerState(state);
    closeModal(false);
    renderCurrentView();
    toast('Fahrt gestartet', vehicle ? `${vehicle.name} wurde als unterwegs markiert.` : 'Die Fahrt wurde gestartet.');
  } catch (error) {
    toast('Fahrt konnte nicht gestartet werden', error.message, 'error');
  }
}

function cancelBooking(bookingId) {
  if (!canOn('booking', bookingId, 'bookings_manage')) {
    toast('Keine Berechtigung', 'Für diese Buchung fehlt die Berechtigung zum Stornieren.', 'error');
    return;
  }
  const booking = db.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  const vehicle = getVehicle(booking.vehicleId);
  openConfirm({
    title: 'Buchung stornieren?',
    text: `Die Buchung <strong>${esc(booking.purpose)}</strong> für <strong>${esc(vehicle ? vehicle.name : 'das Fahrzeug')}</strong> am ${formatDate(booking.start)} wird storniert. Der Zeitraum wird wieder frei.`,
    confirmLabel: 'Buchung stornieren',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' });
        applyServerState(state);
        renderCurrentView();
        toast('Buchung storniert', 'Der Zeitraum ist wieder verfügbar.');
      } catch (error) {
        toast('Buchung konnte nicht storniert werden', error.message, 'error');
      }
    }
  });
}

function deleteBooking(bookingId) {
  if (!canOn('booking', bookingId, 'bookings_manage')) {
    toast('Keine Berechtigung', 'Für diese Buchung fehlt die Berechtigung zum Löschen.', 'error');
    return;
  }
  const booking = db.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  openConfirm({
    title: 'Buchung löschen?',
    text: `Die stornierte Buchung <strong>${esc(booking.purpose)}</strong> wird endgültig entfernt.`,
    confirmLabel: 'Endgültig löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Buchung gelöscht', 'Der Eintrag wurde entfernt.');
      } catch (error) {
        toast('Buchung konnte nicht gelöscht werden', error.message, 'error');
      }
    }
  });
}

function deleteCost(costId) {
  if (!canOn('cost', costId, 'costs_manage')) {
    toast('Keine Berechtigung', 'Für diese Kostenposition fehlt die Berechtigung zum Löschen.', 'error');
    return;
  }
  const cost = db.costs.find((item) => item.id === costId);
  if (!cost) return;
  const vehicle = getVehicle(cost.vehicleId);
  openConfirm({
    title: 'Kostenposition löschen?',
    text: `${esc(cost.category)} über <strong>${formatMoney(cost.amount, 2)}</strong> für <strong>${esc(vehicle ? vehicle.name : 'das Fahrzeug')}</strong> wird entfernt.`,
    confirmLabel: 'Kosten löschen',
    danger: true,
    onConfirm: async () => {
      try {
        const state = await apiFetch(`/api/costs/${encodeURIComponent(costId)}`, { method: 'DELETE' });
        applyServerState(state);
        renderCurrentView();
        toast('Kostenposition gelöscht', 'Die Auswertung wurde aktualisiert.');
      } catch (error) {
        toast('Kostenposition konnte nicht gelöscht werden', error.message, 'error');
      }
    }
  });
}

function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() {
  if (!canBase('export_data')) {
    toast('Keine Berechtigung', 'Für den Datenexport fehlt die erforderliche Berechtigung.', 'error');
    return;
  }
  downloadFile(
    `fuhrpark-daten-${todayISO()}.json`,
    JSON.stringify(db, null, 2),
    'application/json;charset=utf-8'
  );
  toast('Daten exportiert', 'Die JSON-Datei wurde heruntergeladen.');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[;"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportLogbook() {
  if (!can('logbook_export')) {
    toast('Keine Berechtigung', 'Für den Fahrtenbuch-Export fehlt die erforderliche Berechtigung.', 'error');
    return;
  }
  const trips = getCompletedBookings(ui.logPeriod);
  if (!trips.length) {
    toast('Keine Fahrten', 'Im ausgewählten Zeitraum gibt es keine Einträge.', 'info');
    return;
  }
  const header = ['Datum', 'Fahrzeug', 'Kennzeichen', 'Fahrer:in', 'Zweck', 'Von', 'Bis', 'Start-km', 'End-km', 'Distanz-km'];
  const rows = trips.map((trip) => {
    const vehicle = getVehicle(trip.vehicleId);
    const driver = getDriver(trip.driverId);
    const distance = Math.max(0, Number(trip.endKm || 0) - Number(trip.startKm || 0));
    return [
      formatDate(trip.start),
      vehicle ? vehicle.name : '',
      vehicle ? vehicle.plate : '',
      driver ? driver.name : '',
      trip.purpose,
      formatTime(trip.start),
      formatTime(trip.end),
      trip.startKm ?? '',
      trip.endKm ?? '',
      distance
    ];
  });
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n');
  downloadFile(`fahrtenbuch-${todayISO()}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  toast('Fahrtenbuch exportiert', `${trips.length} Fahrten wurden als CSV heruntergeladen.`);
}

function dispatchAction(element) {
  const action = element.dataset.action;
  const id = element.dataset.id;
  switch (action) {
    case 'new-booking': openBookingModal(); break;
    case 'new-vehicle': openVehicleModal(); break;
    case 'new-driver': openDriverModal(); break;
    case 'new-maintenance': openMaintenanceModal(); break;
    case 'new-cost': openCostModal(); break;
    case 'new-log': openLogModal(); break;
    case 'new-user': openUserModal(); break;
    case 'edit-user-permissions': openUserPermissionModal(id); break;
    case 'new-role': openRoleModal(); break;
    case 'edit-role': openRoleModal(id); break;
    case 'edit-role-objects': openRoleObjectModal(id); break;
    case 'delete-role': openDeleteRoleConfirm(id); break;
    case 'vehicle-details': openVehicleDetails(id); break;
    case 'edit-vehicle': openVehicleModal(id); break;
    case 'book-vehicle': openBookingModal({ vehicleId: id }); break;
    case 'edit-driver': openDriverModal(id); break;
    case 'edit-user': openUserModal(id); break;
    case 'booking-details': openBookingDetails(id); break;
    case 'start-booking': startBooking(id); break;
    case 'end-booking': openEndTripModal(id); break;
    case 'cancel-booking': cancelBooking(id); break;
    case 'delete-booking': deleteBooking(id); break;
    case 'calendar-cell': openBookingModal({ vehicleId: element.dataset.vehicle, date: element.dataset.date }); break;
    case 'booking-tab': ui.bookingTab = element.dataset.tab; renderCurrentView(); break;
    case 'week-prev': ui.weekOffset -= 1; renderCurrentView(); break;
    case 'week-next': ui.weekOffset += 1; renderCurrentView(); break;
    case 'week-today': ui.weekOffset = 0; renderCurrentView(); break;
    case 'vehicle-type': ui.vehicleType = element.dataset.type; renderCurrentView(); break;
    case 'reset-vehicle-filters':
      ui.vehicleQuery = '';
      ui.vehicleType = 'all';
      ui.vehicleStatus = 'all';
      renderCurrentView();
      break;
    case 'maintenance-filter': ui.maintenanceFilter = element.dataset.filter; renderCurrentView(); break;
    case 'mark-maintenance-done': openMaintenanceDoneConfirm(id); break;
    case 'view-receipt': openReceiptModal(id); break;
    case 'delete-cost': deleteCost(id); break;
    case 'export-log': exportLogbook(); break;
    case 'export-data': exportData(); break;
    case 'logout': logout(); break;
    case 'change-password': openPasswordModal(); break;
    case 'remove-branding-logo': removeBrandingLogoPreview(); break;
    case 'set-brand-accent': setBrandAccent(element.dataset.color); break;
    case 'reset-brand-colors': resetBrandColors(); break;
    case 'anonymize-user': openAnonymizeUserConfirm(id); break;
    default: break;
  }
}

function refreshVehicleGrid() {
  const grid = $('#vehicleGrid');
  const count = $('#vehicleCount');
  if (grid) grid.innerHTML = renderVehicleGrid();
  if (count) count.textContent = vehicleCountText(filteredVehicles().length);
}

function updateBrandingThemeUI() {
  const form = $('#brandingForm');
  if (!form) return;
  const selected = form.querySelector('input[name="brandingTheme"]:checked')?.value || 'awo';
  form.querySelectorAll('.theme-choice').forEach((choice) => {
    choice.classList.toggle('is-selected', Boolean(choice.querySelector('input')?.checked));
  });
  const logoField = $('#brandingLogoField');
  if (logoField) logoField.hidden = selected !== 'neutral';
}

function setBrandingLogoPreview(html) {
  const preview = $('#brandingLogoPreview');
  const neutralPreview = $('#brandingNeutralPreview');
  if (preview) preview.innerHTML = html;
  if (neutralPreview) neutralPreview.innerHTML = html;
}

function previewBrandingLogo(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('Kein Bild', 'Bitte wählen Sie eine PNG-, JPG- oder WebP-Datei aus.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    setBrandingLogoPreview(`<img src="${reader.result}" alt="Logo-Vorschau">`);
    const removeLogo = $('#brandingRemoveLogo');
    if (removeLogo) removeLogo.value = '0';
    const removeButton = $('#brandingLogoRemove');
    if (removeButton) removeButton.hidden = false;
  };
  reader.readAsDataURL(file);
}

function removeBrandingLogoPreview() {
  const removeLogo = $('#brandingRemoveLogo');
  if (removeLogo) removeLogo.value = '1';
  const input = $('#brandingLogoInput');
  if (input) input.value = '';
  const removeButton = $('#brandingLogoRemove');
  if (removeButton) removeButton.hidden = true;
  const name = $('#brandingName')?.value?.trim() || db.settings.brandName || db.settings.orgName || 'Fuhrparkmanagement';
  const accent = $('#brandingAccent')?.value || db.settings.accentColor || '#0f766e';
  setBrandingLogoPreview(`<span class="theme-initials" style="background:${esc(accent)}">${esc(initials(name))}</span>`);
}

function setBrandAccent(color) {
  const input = $('#brandingAccent');
  if (!input || !/^#[0-9a-fA-F]{6}$/.test(String(color || ''))) return;
  input.value = color;
  updateAccentSelection();
}

function updateAccentSelection() {
  const value = String($('#brandingAccent')?.value || '').toLowerCase();
  $$('.accent-swatch').forEach((swatch) => {
    swatch.classList.toggle('is-selected', String(swatch.dataset.color || '').toLowerCase() === value);
  });
  const label = $('.accent-value');
  if (label) label.textContent = value.toUpperCase();
  $$('#brandingNeutralPreview .theme-initials, #brandingLogoPreview .theme-initials').forEach((element) => {
    element.style.background = value;
  });
  updateBrandingPreview();
}

function updateSidebarStyleUI() {
  $$('.sidebar-style-choice').forEach((choice) => {
    choice.classList.toggle('is-selected', Boolean(choice.querySelector('input')?.checked));
  });
  updateBrandingPreview();
}

function resetBrandColors() {
  const defaults = {
    brandingAccent: '#0f766e',
    brandingPageBackground: '#f4f5f7',
    brandingSurface: '#ffffff',
    brandingText: '#191c23',
    brandingMuted: '#737a88',
    brandingBorder: '#e7e9ee'
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  updateAccentSelection();
  updateBrandingPreview();
}

function updateBrandingPreview() {
  const preview = $('#themePreviewApp');
  if (!preview) return;
  const accent = $('#brandingAccent')?.value || '#0f766e';
  const background = $('#brandingPageBackground')?.value || '#f4f5f7';
  const surface = $('#brandingSurface')?.value || '#ffffff';
  const text = $('#brandingText')?.value || '#191c23';
  const muted = $('#brandingMuted')?.value || '#737a88';
  const border = $('#brandingBorder')?.value || '#e7e9ee';
  const sidebar = document.querySelector('input[name="brandingSidebar"]:checked')?.value === 'light' ? 'light' : 'dark';
  const name = $('#brandingName')?.value?.trim() || 'Fuhrparkmanagement';
  preview.style.setProperty('--preview-accent', accent);
  preview.style.setProperty('--preview-bg', background);
  preview.style.setProperty('--preview-surface', surface);
  preview.style.setProperty('--preview-text', text);
  preview.style.setProperty('--preview-muted', muted);
  preview.style.setProperty('--preview-border', border);
  preview.classList.toggle('is-light-sidebar', sidebar === 'light');
  const previewName = $('#previewBrandName');
  const previewLogo = $('#previewLogo');
  if (previewName) previewName.textContent = name;
  if (previewLogo) previewLogo.textContent = initials(name);
}

/* =========================================================
   Events
   ========================================================= */
function bindEvents() {
  const view = $('#view');
  const modal = $('#modalRoot');
  const searchInput = $('#globalSearch');
  const searchResults = $('#searchResults');
  const notifButton = $('#notifBtn');
  const notifList = $('#notifList');
  const notifReadAll = $('#notifReadAll');
  const sidebar = $('#sidebar');

  window.addEventListener('hashchange', () => renderRoute(true));

  $('#menuBtn')?.addEventListener('click', openSidebar);
  $('#sidebarClose')?.addEventListener('click', closeSidebar);
  $('#sidebarScrim')?.addEventListener('click', closeSidebar);
  $('#logoutBtn')?.addEventListener('click', logout);
  sidebar?.addEventListener('click', (event) => {
    if (event.target.closest('.nav-item')) closeSidebar();
  });

  notifButton?.addEventListener('click', toggleNotifications);
  notifReadAll?.addEventListener('click', markAllNotificationsRead);
  notifList?.addEventListener('click', (event) => {
    const markButton = event.target.closest('[data-notif-read]');
    if (markButton) {
      event.preventDefault();
      event.stopPropagation();
      markNotificationsRead([markButton.dataset.notifRead]).catch(() => {});
      return;
    }
    const link = event.target.closest('.notif-item-link');
    if (!link) return;
    event.preventDefault();
    const item = link.closest('[data-notif-key]');
    const key = item?.dataset.notifKey;
    closeNotifications();
    if (key) markNotificationsRead([key]).catch(() => {});
    const href = link.getAttribute('href');
    if (href) {
      if (location.hash === href) renderRoute();
      else location.hash = href;
    }
  });

  searchInput?.addEventListener('input', renderSearchResults);
  searchInput?.addEventListener('focus', () => {
    if (searchInput.value.trim()) renderSearchResults();
  });
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !searchResults.hidden) {
      const first = searchResults.querySelector('[data-search-kind]');
      if (first) {
        event.preventDefault();
        first.click();
      }
    }
  });
  searchResults?.addEventListener('click', (event) => {
    const result = event.target.closest('[data-search-kind]');
    if (!result) return;
    const kind = result.dataset.searchKind;
    const id = result.dataset.searchId;
    const route = result.dataset.searchRoute;
    closeSearch(true);
    if (kind === 'page' && route) {
      if (location.hash === `#/${route}`) renderRoute();
      else location.hash = `#/${route}`;
    } else if (kind === 'vehicle' && id) {
      openVehicleDetails(id);
    } else if (kind === 'driver') {
      if (location.hash === '#/fahrer') renderRoute();
      else location.hash = '#/fahrer';
    } else if (kind === 'booking' && id) {
      openBookingDetails(id);
    }
  });

  view?.addEventListener('click', (event) => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    event.preventDefault();
    dispatchAction(actionElement);
  });

  view?.addEventListener('input', (event) => {
    if (event.target.id === 'vehicleSearch') {
      ui.vehicleQuery = event.target.value;
      refreshVehicleGrid();
    } else if (event.target.id === 'brandingAccent') {
      updateAccentSelection();
    } else if (['brandingPageBackground', 'brandingSurface', 'brandingText', 'brandingMuted', 'brandingBorder'].includes(event.target.id)) {
      updateBrandingPreview();
    } else if (event.target.id === 'brandingName') {
      const previews = $$('#brandingNeutralPreview .theme-initials, #brandingLogoPreview .theme-initials');
      if (previews.length) {
        const value = event.target.value.trim() || 'Fuhrparkmanagement';
        const accent = $('#brandingAccent')?.value || db.settings.accentColor || '#0f766e';
        previews.forEach((element) => {
          element.textContent = initials(value);
          element.style.background = accent;
        });
      }
      updateBrandingPreview();
    }
  });

  view?.addEventListener('change', (event) => {
    if (event.target.id === 'vehicleStatusFilter') {
      ui.vehicleStatus = event.target.value;
      refreshVehicleGrid();
    } else if (event.target.id === 'costCategoryFilter') {
      ui.costCategory = event.target.value;
      renderCurrentView();
    } else if (event.target.id === 'costVehicleFilter') {
      ui.costVehicle = event.target.value;
      renderCurrentView();
    } else if (event.target.id === 'logPeriod') {
      ui.logPeriod = event.target.value;
      renderCurrentView();
    } else if (event.target.name === 'brandingTheme') {
      updateBrandingThemeUI();
    } else if (event.target.name === 'brandingSidebar') {
      updateSidebarStyleUI();
    } else if (event.target.id === 'brandingLogoInput') {
      const file = event.target.files?.[0];
      if (file) previewBrandingLogo(file);
    }
  });

  view?.addEventListener('submit', async (event) => {
    const form = event.target;
    if (form.id === 'brandingForm') {
      event.preventDefault();
      const data = new FormData(form);
      const theme = String(data.get('brandingTheme') || 'awo');
      const brandName = String(data.get('brandingName') || '').trim();
      if (theme === 'neutral' && !brandName) {
        toast('Anzeigename fehlt', 'Bitte geben Sie einen Namen für das neutrale Theme an.', 'error');
        return;
      }
      let logoData = null;
      let removeLogo = false;
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        if (theme === 'neutral') {
          const logoInput = form.querySelector('#brandingLogoInput');
          const file = logoInput?.files?.[0];
          removeLogo = form.querySelector('#brandingRemoveLogo')?.value === '1';
          if (file) {
            logoData = await resizeVehicleImage(file);
            removeLogo = false;
          }
        }
        const state = await apiFetch('/api/branding', {
          method: 'PATCH',
          body: {
            theme,
            brandName,
            logoData,
            removeLogo,
            accentColor: String(data.get('brandingAccent') || db.settings.accentColor || '#0f766e'),
            sidebarStyle: String(data.get('brandingSidebar') || db.settings.sidebarStyle || 'dark'),
            pageBackground: String(data.get('brandingPageBackground') || db.settings.pageBackground || '#f4f5f7'),
            surfaceColor: String(data.get('brandingSurface') || db.settings.surfaceColor || '#ffffff'),
            textColor: String(data.get('brandingText') || db.settings.textColor || '#191c23'),
            mutedColor: String(data.get('brandingMuted') || db.settings.mutedColor || '#737a88'),
            borderColor: String(data.get('brandingBorder') || db.settings.borderColor || '#e7e9ee')
          }
        });
        applyServerState(state);
        renderRoute(false);
        toast('Erscheinungsbild gespeichert', 'Das Theme gilt jetzt für alle Nutzer:innen.');
      } catch (error) {
        toast('Erscheinungsbild konnte nicht gespeichert werden', error.message, 'error');
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
      return;
    }

    if (form.id === 'settingsForm') {
      event.preventDefault();
      const data = new FormData(form);
      const orgName = String(data.get('orgName') || '').trim();
      if (!orgName) {
        toast('Name fehlt', 'Bitte geben Sie den Namen der Einrichtung an.', 'error');
        return;
      }
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        const state = await apiFetch('/api/settings', {
          method: 'PATCH',
          body: {
            orgName,
            location: String(data.get('location') || '').trim(),
            phone: String(data.get('phone') || '').trim(),
            email: String(data.get('email') || '').trim()
          }
        });
        applyServerState(state);
        if (ui.route === 'einstellungen') renderCurrentView();
        toast('Einstellungen gespeichert', 'Die Organisationsdaten wurden auf dem Server aktualisiert.');
      } catch (error) {
        toast('Speichern fehlgeschlagen', error.message, 'error');
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
      return;
    }

    if (form.id === 'userPolicyForm') {
      event.preventDefault();
      const data = new FormData(form);
      const days = Number(String(data.get('autoAnonymizeDays') || '0'));
      if (!Number.isInteger(days) || days < 0 || days > 3650) {
        toast('Ungültige Frist', 'Bitte geben Sie eine ganze Zahl zwischen 0 und 3650 Tagen an.', 'error');
        return;
      }
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        const state = await apiFetch('/api/user-policy', {
          method: 'PATCH',
          body: { autoAnonymizeDays: days }
        });
        applyServerState(state);
        renderCurrentView();
        toast('Frist gespeichert', days > 0 ? `Deaktivierte Konten werden nach ${days} Tagen automatisch anonymisiert.` : 'Die automatische Anonymisierung ist deaktiviert.');
      } catch (error) {
        toast('Frist konnte nicht gespeichert werden', error.message, 'error');
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
      return;
    }
  });

  view?.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.cal-cell[data-action="calendar-cell"]')) {
      event.preventDefault();
      openBookingModal({ vehicleId: event.target.dataset.vehicle, date: event.target.dataset.date });
    }
  });

  modal?.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-backdrop')) {
      closeModal();
      return;
    }
    if (event.target.closest('[data-close-modal]')) {
      closeModal();
      return;
    }
    const actionElement = event.target.closest('[data-action]');
    if (actionElement) {
      event.preventDefault();
      dispatchAction(actionElement);
    }
  });

  document.addEventListener('click', (event) => {
    const notifPanel = $('#notifPanel');
    if (notifPanel && !notifPanel.hidden && !event.target.closest('.notif-wrap')) closeNotifications();
    if (searchResults && !searchResults.hidden && !event.target.closest('#searchBox')) closeSearch();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      closeNotifications();
      searchInput?.focus();
      searchInput?.select();
      if (searchInput?.value.trim()) renderSearchResults();
      return;
    }

    if (event.key === 'Escape') {
      if (modal && modal.children.length) {
        event.preventDefault();
        closeModal();
        return;
      }
      if (searchResults && !searchResults.hidden) {
        closeSearch();
        return;
      }
      if (!$('#notifPanel')?.hidden) {
        closeNotifications();
        return;
      }
      closeSidebar();
      return;
    }

    if (event.key === 'Tab' && modal && modal.children.length) {
      const focusables = $$('.modal button:not([disabled]), .modal input:not([disabled]), .modal select:not([disabled]), .modal textarea:not([disabled]), .modal a[href]', modal)
        .filter((element) => element.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) closeSidebar();
  });
}

/* =========================================================
   Toasts
   ========================================================= */
function toast(title, message = '', type = 'success') {
  const root = $('#toastRoot');
  if (!root) return;
  const toastElement = document.createElement('div');
  toastElement.className = `toast toast-${type}`;
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check-circle';
  toastElement.innerHTML = `
    <span class="toast-icon">${icon(iconName)}</span>
    <div class="toast-copy"><strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}</div>
    <button class="toast-close" type="button" aria-label="Meldung schließen">${icon('x')}</button>`;
  root.appendChild(toastElement);
  const remove = () => {
    if (!toastElement.isConnected) return;
    toastElement.classList.add('is-leaving');
    setTimeout(() => toastElement.remove(), 180);
  };
  const timer = setTimeout(remove, 4600);
  toastElement.querySelector('.toast-close')?.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

/* =========================================================
   Start
   ========================================================= */
async function init() {
  try {
    await loadInitialData();
    bindEvents();
    const initialRoute = getRouteFromHash();
    if (location.hash !== `#/${initialRoute}`) {
      history.replaceState(null, '', `#/${initialRoute}`);
    }
    updateChrome();
    updateSaveIndicator();
    renderRoute(false);
  } catch (error) {
    console.error('Initialisierung fehlgeschlagen:', error);
    const view = $('#view');
    if (view) {
      view.innerHTML = `
        <div class="empty" style="min-height:60vh">
          <span class="empty-icon">${icon('alert')}</span>
          <strong>Daten konnten nicht geladen werden</strong>
          <span>${esc(error.message || 'Der Server ist momentan nicht erreichbar.')}</span>
          <a class="btn btn-primary btn-sm" href="/">Erneut versuchen</a>
        </div>`;
    }
    const indicator = $('#saveIndicator');
    if (indicator) indicator.textContent = 'Keine Serververbindung';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
});
