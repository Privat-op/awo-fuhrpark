'use strict';

const COLOR_MODES = ['light', 'dark', 'auto'];

function isColorMode(value) {
  return COLOR_MODES.includes(String(value || ''));
}

function normalizeColorMode(value, fallback = 'light') {
  return isColorMode(value) ? String(value) : fallback;
}

function getUserColorMode(user) {
  return isColorMode(user?.color_mode) ? user.color_mode : null;
}

function getDefaultColorMode(settings) {
  return isColorMode(settings?.default_color_mode) ? settings.default_color_mode : 'light';
}

function getEffectiveColorMode(user, settings) {
  return getUserColorMode(user) || getDefaultColorMode(settings);
}

function getResolvedColorMode(user, settings) {
  const mode = getEffectiveColorMode(user, settings);
  return mode === 'dark' ? 'dark' : 'light';
}

module.exports = {
  COLOR_MODES,
  isColorMode,
  normalizeColorMode,
  getUserColorMode,
  getDefaultColorMode,
  getEffectiveColorMode,
  getResolvedColorMode
};
