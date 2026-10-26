'use strict';

/* =========================================================
   Grundlagen & Helfer
   ========================================================= */

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const VEHICLE_STATUS = {
  available: { label: 'Verfügbar', badge: 'green' },
  in_use: { label: 'Unterwegs', badge: 'blue' },
  maintenance: { label: 'In Wartung', badge: 'amber' }
};

const BOOKING_STATUS = {
  planned: { label: 'Geplant', badge: 'blue' },
  active: { label: 'Aktiv', badge: 'green' },
  completed: { label: 'Abgeschlossen', badge: 'gray' },
  canceled: { label: 'Storniert', badge: 'red' }
};

const CATEGORY_META = {
  'Kraftstoff': { color: '#e2001a', icon: 'fuel' },
  'Laden': { color: '#0f8f8a', icon: 'zap' },
  'Wartung': { color: '#c27a00', icon: 'wrench' },
  'Versicherung': { color: '#2563eb', icon: 'shield' },
  'Kfz-Steuer': { color: '#7c3aed', icon: 'receipt' },
  'Sonstiges': { color: '#8993a2', icon: 'receipt' }
};

const COST_CATEGORIES = Object.keys(CATEGORY_META);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const pad2 = (value) => String(value).padStart(2, '0');

function toISODate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayISO() {
  return toISODate(new Date());
}

function parseISODate(value) {
  if (!value) return new Date(NaN);
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function parseISODateTime(value) {
  if (!value) return new Date(NaN);
  const [datePart, timePart = '00:00'] = String(value).split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hours || 0, minutes || 0);
}

function addDays(isoDate, days) {
  const date = parseISODate(isoDate);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const today = parseISODate(todayISO());
  const target = parseISODate(isoDate);
  return Math.round((target - today) / 86400000);
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE').format(Number(value) || 0);
}

function formatDecimal(value, digits = 1) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(Number(value) || 0);
}

function formatMoney(value, digits = 0) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
}

function formatKm(value) {
  return `${formatNumber(value)} km`;
}

function formatDate(isoDate) {
  const date = parseISODate(isoDate);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatDateShort(isoDate) {
  const date = parseISODate(isoDate);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getDate()}. ${MONTHS_SHORT[date.getMonth()]}`;
}

function formatDateLong(isoDate) {
  const date = parseISODate(isoDate);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function formatTime(value) {
  if (!value) return '—';
  return String(value).slice(11, 16);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function formatTimeRange(start, end) {
  if (!start || !end) return '—';
  return `${formatTime(start)}–${formatTime(end)} Uhr`;
}

function formatWeekRange(startISO, endISO) {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()}. ${MONTHS_SHORT[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()}. ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()}. ${MONTHS_SHORT[start.getMonth()]} – ${end.getDate()}. ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${start.getDate()}. – ${end.getDate()}. ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

function startOfWeekISO(isoDate) {
  const date = parseISODate(isoDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toISODate(date);
}

function durationMinutes(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((parseISODateTime(end) - parseISODateTime(start)) / 60000));
}

function humanDays(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gestern';
  if (days < 0) return `vor ${Math.abs(days)} Tagen`;
  return `in ${days} Tagen`;
}

function monthKey(isoDate) {
  return String(isoDate || '').slice(0, 7);
}

function lastMonths(count) {
  const now = new Date();
  const result = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    result.push({
      key: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`,
      label: MONTHS_SHORT[date.getMonth()],
      longLabel: `${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
      year: date.getFullYear()
    });
  }
  return result;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (char) => map[char]);
}

const esc = escapeHtml;

function hexToRgba(hex, alpha = 0.1) {
  let color = String(hex || '').replace('#', '').trim();
  if (color.length === 3) color = color.split('').map((char) => char + char).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(color)) return `rgba(120, 128, 140, ${alpha})`;
  const number = parseInt(color, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function sortByDateAsc(items, field = 'start') {
  return [...items].sort((a, b) => String(a[field]).localeCompare(String(b[field])));
}

function sortByDateDesc(items, field = 'start') {
  return [...items].sort((a, b) => String(b[field]).localeCompare(String(a[field])));
}

const PAGES = [
  { route: 'dashboard', title: 'Dashboard', description: 'Überblick über Flotte, Buchungen und Hinweise', icon: 'grid' },
  { route: 'fahrzeuge', title: 'Fahrzeuge', description: 'Flotte, Standorte und Fahrzeugdetails', icon: 'car' },
  { route: 'buchungen', title: 'Buchungen', description: 'Fahrten planen und verwalten', icon: 'calendar' },
  { route: 'fahrtenbuch', title: 'Fahrtenbuch', description: 'Gefahrene Strecken und Kilometer', icon: 'book' },
  { route: 'wartung', title: 'Wartung & TÜV', description: 'Wartungsplan und Hauptuntersuchungen', icon: 'wrench' },
  { route: 'kosten', title: 'Kosten', description: 'Betriebskosten und Auswertungen', icon: 'receipt' },
  { route: 'fahrer', title: 'Fahrer:innen', description: 'Mitarbeitende und Führerscheine', icon: 'users' },
  { route: 'benutzer', title: 'Benutzer', description: 'Zugänge, Rollen und Berechtigungen', icon: 'id' },
  { route: 'einstellungen', title: 'Einstellungen', description: 'Organisation und Datenexport', icon: 'settings' }
];
