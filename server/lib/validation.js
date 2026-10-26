'use strict';

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requiredString(value, field, { min = 1, max = 500 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) throw new HttpError(400, `${field} ist erforderlich.`);
  if (text.length > max) throw new HttpError(400, `${field} ist zu lang (max. ${max} Zeichen).`);
  return text;
}

function optionalString(value, { max = 2000 } = {}) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (text.length > max) throw new HttpError(400, `Der Text ist zu lang (max. ${max} Zeichen).`);
  return text;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00`))) {
    throw new HttpError(400, `${field} ist kein gültiges Datum.`);
  }
  return text;
}

function requiredDate(value, field) {
  const date = optionalDate(value, field);
  if (!date) throw new HttpError(400, `${field} ist erforderlich.`);
  return date;
}

function requiredTime(value, field) {
  const text = String(value || '');
  if (!/^\d{2}:\d{2}$/.test(text)) throw new HttpError(400, `${field} ist keine gültige Uhrzeit.`);
  const [hours, minutes] = text.split(':').map(Number);
  if (hours > 23 || minutes > 59) throw new HttpError(400, `${field} ist keine gültige Uhrzeit.`);
  return text;
}

function intValue(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${field} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  }
  return number;
}

function numericValue(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, `${field} ist ungültig.`);
  }
  return number;
}

function emailValue(value, field = 'E-Mail') {
  const text = requiredString(value, field, { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new HttpError(400, `${field} ist ungültig.`);
  return text;
}

function oneOf(value, allowed, field) {
  const text = String(value || '');
  if (!allowed.includes(text)) throw new HttpError(400, `${field} ist ungültig.`);
  return text;
}

function hexColorValue(value, fallback = '#2563eb') {
  const text = String(value || '');
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function licensesValue(value) {
  const allowed = ['B', 'BE', 'C1', 'D1'];
  if (!Array.isArray(value)) throw new HttpError(400, 'Führerscheinklassen sind ungültig.');
  const licenses = [...new Set(value.map(String))];
  if (!licenses.length || licenses.some((item) => !allowed.includes(item))) {
    throw new HttpError(400, 'Bitte wählen Sie gültige Führerscheinklassen.');
  }
  return licenses;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isoNow() {
  return new Date().toISOString();
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function combineDateTime(date, time, field) {
  return `${requiredDate(date, `${field}datum`)}T${requiredTime(time, `${field}zeit`)}`;
}

module.exports = {
  HttpError,
  asyncHandler,
  requiredString,
  optionalString,
  optionalDate,
  requiredDate,
  requiredTime,
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
};
