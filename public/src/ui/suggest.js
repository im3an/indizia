// Typeahead under the search box (prompt-kit "PromptSuggestion" highlight style).
// Local suggestions are instant; organisation names can also be completed from Wikidata and GLEIF.
import { detect, DISPLAY } from '../detect.js';
import { getSetting } from '../settings.js';

const HISTORY_KEY = 'sherlock.history.v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}
export function pushHistory(q) {
  try {
    const next = [q, ...getHistory().filter((x) => x !== q)].slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* storage unavailable */
  }
}

const PREFIXES = [
  ['domain:', 'Domain lens'], ['ip:', 'IP address'], ['org:', 'Organisation or company'], ['lei:', 'Legal Entity Identifier'],
  ['user:', 'Username across 600 sites'], ['phone:', 'Phone numbering metadata'], ['geo:', 'Coordinates'], ['doi:', 'Publication'],
  ['hash:', 'File hash'], ['tool:', 'Search the tool library'],
];

/** Highlight the first occurrence of `needle` (prompt-kit style: muted text, matched part strong). */
export function highlight(text, needle) {
  const i = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return `<span class="s-rest">${esc(text)}</span>`;
  return `<span class="s-rest">${esc(text.slice(0, i))}</span><span class="s-hit">${esc(text.slice(i, i + needle.length))}</span><span class="s-rest">${esc(text.slice(i + needle.length))}</span>`;
}

export function localSuggestions(text) {
  const t = text.trim();
  const out = [];
  if (!t) {
    for (const q of getHistory().slice(0, 5)) out.push({ q, label: q, meta: 'recent', kind: 'history' });
    for (const [p, d] of PREFIXES) out.push({ q: p, label: p, meta: d, kind: 'prefix', fill: true });
    return out;
  }
  const d = detect(t);
  if (d) out.push({ q: t, label: t, meta: `Investigate · ${DISPLAY[d.type] || d.type}`, kind: 'primary' });
  if (d?.type === 'organisation' && !/^org:/i.test(t)) out.push({ q: `tool:${t}`, label: `Tools for “${t}”`, meta: 'tool library', kind: 'tool' });
  for (const [p, desc] of PREFIXES) if (p.startsWith(t.toLowerCase()) && p !== t.toLowerCase()) out.push({ q: p, label: p, meta: desc, kind: 'prefix', fill: true });
  for (const q of getHistory()) if (q.toLowerCase().includes(t.toLowerCase()) && q !== t) out.push({ q, label: q, meta: 'recent', kind: 'history' });
  return out.slice(0, 8);
}

let ctrl = null;
/** Remote completions for organisation names. Sends the typed text to Wikidata and GLEIF, so it is optional. */
export async function remoteSuggestions(text) {
  const t = text.trim().replace(/^org:\s*/i, '');
  const d = detect(t);
  if (!getSetting('remoteSuggestions') || t.length < 3 || d?.type !== 'organisation') return [];
  ctrl?.abort();
  ctrl = new AbortController();
  const signal = ctrl.signal;
  const wd = fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(t)}&language=en&type=item&limit=5&format=json&origin=*`, { signal, headers: { 'Api-User-Agent': 'Indizia/0.2' } })
    .then((r) => r.json())
    .then((j) => (j.search || []).map((s) => ({ q: `org:${s.label}`, label: s.label, meta: s.description ? `${s.description} · Wikidata` : 'Wikidata', kind: 'remote' })))
    .catch(() => []);
  const gl = fetch(`https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(t)}`, { signal })
    .then((r) => r.json())
    .then((j) => (j.data || []).slice(0, 5).map((s) => ({ q: s.relationships?.['lei-records']?.data?.id || `org:${s.attributes.value}`, label: s.attributes.value, meta: 'legal entity · GLEIF', kind: 'remote' })))
    .catch(() => []);
  const [a, b] = await Promise.all([wd, gl]);
  if (signal.aborted) return [];
  return [...a, ...b];
}
