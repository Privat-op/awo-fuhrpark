'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'FM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function normalizeHex(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : fallback;
}

function mixColor(hex, target, weight) {
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

function getBranding(settings = {}) {
  const theme = settings.theme === 'neutral' ? 'neutral' : 'awo';
  const isAwo = theme === 'awo';
  const orgName = String(settings.org_name || '').trim();
  const name = isAwo ? 'AWO' : (String(settings.brand_name || '').trim() || orgName || 'Fuhrparkmanagement');
  const subtitle = 'Fuhrparkmanagement';
  const accentColor = isAwo ? '#e2001a' : normalizeHex(settings.accent_color, '#0f766e');
  const accentDark = mixColor(accentColor, '#000000', isAwo ? 0.2 : 0.28);
  const accentDeep = mixColor(accentColor, '#000000', 0.65);
  const accentSoft = mixColor(accentColor, '#ffffff', 0.9);
  const accentOnDark = isAwo ? '#ff5a6a' : mixColor(accentColor, '#ffffff', 0.5);
  const accentDarkOnDark = mixColor(accentOnDark, '#000000', 0.2);
  const accentSoftOnDark = mixColor(accentOnDark, '#111418', 0.82);
  const pageBackground = isAwo ? '#f4f5f7' : normalizeHex(settings.page_background, '#f4f5f7');
  const surfaceColor = isAwo ? '#ffffff' : normalizeHex(settings.surface_color, '#ffffff');
  const textColor = isAwo ? '#191c23' : normalizeHex(settings.text_color, '#191c23');
  const mutedColor = isAwo ? '#737a88' : normalizeHex(settings.muted_color, '#737a88');
  const borderColor = isAwo ? '#e7e9ee' : normalizeHex(settings.border_color, '#e7e9ee');
  const surface2Color = mixColor(surfaceColor, pageBackground, 0.45);
  const ink2Color = mixColor(textColor, surfaceColor, 0.16);
  const lineSoftColor = mixColor(borderColor, surfaceColor, 0.45);
  const sidebarStyle = isAwo ? 'dark' : settings.sidebar_style === 'light' ? 'light' : 'dark';
  const logoUrl = isAwo
    ? '/branding/awo-logo.svg'
    : (settings.logo_file ? `/branding/logo?v=${encodeURIComponent(settings.updated_at || '')}` : null);
  const logoMarkup = logoUrl
    ? `<img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(name)}">`
    : `<span class="brand-initials">${escapeHtml(initials(name))}</span>`;
  const markClass = logoUrl ? 'has-image' : 'is-initials';
  const favicon = logoUrl || '/branding/neutral-favicon.svg';
  return {
    theme,
    isAwo,
    name,
    subtitle,
    topName: isAwo ? 'AWO' : name,
    footerName: name,
    loginFooter: isAwo ? 'Arbeiterwohlfahrt' : name,
    logoMarkup,
    markClass,
    favicon,
    accentColor,
    accentDark,
    accentSoft,
    accentDeep,
    accentOnDark,
    accentDarkOnDark,
    accentSoftOnDark,
    brandRgb: rgbTriplet(accentColor),
    brandRgbOnDark: rgbTriplet(accentOnDark),
    pageBackground,
    surfaceColor,
    surface2Color,
    textColor,
    ink2Color,
    mutedColor,
    borderColor,
    lineSoftColor,
    sidebarStyle,
    brandStyles: `--awo:${accentColor};--awo-dark:${accentDark};--awo-soft:${accentSoft};--brand-deep:${accentDeep};--brand-rgb:${rgbTriplet(accentColor)};--awo-on-dark:${accentOnDark};--awo-dark-on-dark:${accentDarkOnDark};--awo-soft-on-dark:${accentSoftOnDark};--brand-rgb-on-dark:${rgbTriplet(accentOnDark)};--bg:${pageBackground};--surface:${surfaceColor};--surface-2:${surface2Color};--ink:${textColor};--ink-2:${ink2Color};--muted:${mutedColor};--line:${borderColor};--line-soft:${lineSoftColor};`,
    themeColor: accentColor,
    pageTitle: isAwo ? 'AWO · Fuhrparkmanagement' : name,
    loginPageTitle: isAwo ? 'Anmelden · AWO Fuhrparkmanagement' : `Anmelden · ${name}`,
    initials: initials(name)
  };
}

module.exports = { getBranding, escapeHtml, initials };
