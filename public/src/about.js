// Fills the source table on the About page from the live source registry, so it never drifts.
import { SOURCES } from './sources/index.js';
import { DISPLAY } from './detect.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const access = (s) => (s.desktopOnly ? 'desktop app, in Docker on your computer' : s.local ? 'on your device' : s.cors === false ? 'via relay' : s.cors === 'mixed' ? 'browser + relay' : 'from your browser');
document.querySelector('#source-table tbody').innerHTML = SOURCES.map(
  (s) => `<tr><td><a href="${esc(s.homepage)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></td><td>${esc(s.provider)}</td><td>${esc(s.accepts.map((a) => DISPLAY[a] || a).join(', '))}</td><td>${access(s)}</td><td title="${esc(s.reliabilityWhy || '')}">${esc(s.reliability || '')}</td><td>${s.terms ? `<a href="${esc(s.terms)}" target="_blank" rel="noopener noreferrer">${esc(s.licence)}</a>` : esc(s.licence)}</td></tr>`,
).join('');
