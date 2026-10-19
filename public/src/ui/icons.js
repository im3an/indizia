// Favicons for sources and links. Fetched through the Indizia API (server-side, cached) so the user's
// browser never contacts a third-party icon service. Falls back to a monogram on static deployments.
import { getSetting } from '../settings.js';

let apiOk = false;
export function setIconApi(ok) {
  apiOk = ok;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function monogram(host) {
  const letter = (host.split('.').slice(-2, -1)[0] || host || '?').charAt(0).toUpperCase();
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="fav mono" data-hue="${h % 12}" aria-hidden="true">${esc(letter)}</span>`;
}

/** Icon markup for a host. */
export function fav(host) {
  if (!host) return '<span class="fav mono" aria-hidden="true">·</span>';
  if (!apiOk || !getSetting('favicons')) return monogram(host);
  return `<img class="fav" src="/api/icon?host=${encodeURIComponent(host)}" alt="" width="16" height="16" loading="lazy" decoding="async" data-host="${esc(host)}">`;
}

/** Icon for a source: device glyph for local processing, favicon of its homepage otherwise. */
export function sourceFav(source) {
  if (source.local) return '<span class="fav local" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M5 14h6"/></svg></span>';
  if (source.id === 'sherlock') return '<span class="fav local" aria-hidden="true">✓</span>';
  return fav(hostOf(source.homepage));
}

// Broken icons become monograms. Delegated, because inline onerror handlers are blocked by the CSP.
document.addEventListener(
  'error',
  (ev) => {
    const img = ev.target;
    if (img instanceof HTMLImageElement && img.classList.contains('fav')) img.outerHTML = monogram(img.dataset.host || '');
  },
  true,
);

/** Magnifier for search fields (`.field`). */
export const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6" cy="6" r="4.2"/><path d="m9.2 9.2 3.3 3.3"/></svg>';

/** Sliders paint their filled part from --fill (WebKit has no native progress track). */
export function paintRange(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min || 1)) * 100}%`);
}
