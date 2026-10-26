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

function getBranding(settings = {}) {
  const theme = settings.theme === 'neutral' ? 'neutral' : 'awo';
  const isAwo = theme === 'awo';
  const orgName = String(settings.org_name || '').trim();
  const name = isAwo ? 'AWO' : (String(settings.brand_name || '').trim() || orgName || 'Fuhrparkmanagement');
  const subtitle = 'Fuhrparkmanagement';
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
    themeColor: isAwo ? '#e2001a' : '#0f766e',
    pageTitle: isAwo ? 'AWO · Fuhrparkmanagement' : name,
    loginPageTitle: isAwo ? 'Anmelden · AWO Fuhrparkmanagement' : `Anmelden · ${name}`,
    initials: initials(name)
  };
}

module.exports = { getBranding, escapeHtml, initials };
