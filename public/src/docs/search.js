// Full-text search across a case's documents. MiniSearch indexes every page (or sheet, slide) on its own,
// so each hit carries a page reference. Fuzzy and prefix matching for words, the query language in
// query.js for phrases, exclusions, OR and filters, and every result says why it matched.
// Optional semantic ranking (local embeddings via Ollama) is fused in by docs/semantic.js.

import { parse, matchText, inRange, fieldOk, highlightTerms } from '../query.js';

let MiniSearch = null;
async function lib() {
  MiniSearch ||= (await import('/vendor/minisearch/index.js')).default;
  return MiniSearch;
}

const cache = new Map(); // caseId → { key, index, pages }

/**
 * Words with diacritics stay whole (German, French). Compounds such as domains, IDs and hyphenated words
 * are indexed whole and as their parts: "bundesdruckerei.de" finds "bundesdruckerei" and the domain.
 */
export function tokenize(s) {
  const out = [];
  for (const m of String(s).toLowerCase().normalize('NFKC').matchAll(/[\p{L}\p{N}]+(?:['’._@-][\p{L}\p{N}]+)*/gu)) {
    out.push(m[0]);
    if (/['’._@-]/.test(m[0])) for (const part of m[0].split(/['’._@-]/)) if (part) out.push(part);
  }
  return out;
}

/** Index (or reuse the index of) a case's documents. */
export async function indexFor(caseId, docs) {
  const key = docs.map((d) => `${d.id}:${d.history?.length || 0}`).join('|');
  const hit = cache.get(caseId);
  if (hit && hit.key === key) return hit;
  const MS = await lib();
  const index = new MS({
    fields: ['text', 'name', 'title'],
    storeFields: ['docId', 'n'],
    searchOptions: { boost: { name: 3, title: 2 }, prefix: true, fuzzy: 0.2 },
    tokenize,
    processTerm: (t) => (t.length > 1 ? t.toLowerCase() : null),
  });
  const pages = new Map();
  const rows = [];
  for (const d of docs) {
    for (const p of d.pages || []) {
      const id = `${d.id}#${p.n}`;
      pages.set(id, { doc: d, page: p });
      rows.push({ id, docId: d.id, n: p.n, text: p.text, name: d.name, title: d.meta?.title || '' });
    }
  }
  await index.addAllAsync(rows, { chunkSize: 50 });
  const entry = { key, index, pages };
  cache.set(caseId, entry);
  return entry;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An excerpt around the first matching term, HTML-escaped, with <mark> around matches. */
export function snippet(text, terms, radius = 110) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - radius);
  const end = Math.min(t.length, at + radius * 2);
  let s = esc((start > 0 ? '…' : '') + t.slice(start, end).replace(/\s+/g, ' ') + (end < t.length ? '…' : ''));
  const words = [...new Set(terms.filter((x) => x.length > 1))].sort((a, b) => b.length - a.length);
  if (words.length) s = s.replace(new RegExp(`(${words.map((w) => reEsc(esc(w))).join('|')})`, 'gi'), '<mark>$1</mark>');
  return s;
}

/** Record-level filters from the query language. */
function docOk(p, doc, page) {
  if (!fieldOk(p, 'type', [doc.kind, doc.label, doc.signature?.ext])) return false;
  if (!fieldOk(p, 'status', doc.status)) return false;
  if (!fieldOk(p, 'tag', doc.tags || [])) return false;
  if (!fieldOk(p, 'name', doc.name)) return false;
  if (!fieldOk(p, 'entity', (doc.entities || []).map((e) => e.value))) return false;
  if (p.filters.page && !p.filters.page.includes(String(page.n))) return false;
  if (p.filters.ocr && !page.ocr) return false;
  const date = doc.meta?.created || doc.meta?.date || doc.dates?.[0]?.date || null;
  return inRange(p, date);
}

/**
 * @returns {Promise<{ results: { id, doc, page, score, snippet, why: string[] }[], parsed, total: number }>}
 */
export async function searchDocs(caseId, docs, q, { limit = 200, semantic = null } = {}) {
  const p = parse(q);
  const { index, pages } = await indexFor(caseId, docs);
  const terms = highlightTerms(p);
  let hits;
  if (p.any.length) {
    const query = { combineWith: 'AND', queries: p.any.map((g) => ({ combineWith: 'OR', queries: g })) };
    hits = index.search(query).map((r) => ({ id: r.id, score: r.score, match: r.match, terms: r.terms, queryTerms: r.queryTerms }));
  } else {
    // Phrases or filters only: every page is a candidate.
    hits = [...pages.keys()].map((id) => ({ id, score: 1, match: {}, terms: [], queryTerms: [] }));
  }
  if (semantic) hits = await semantic(hits, p);
  const results = [];
  for (const h of hits) {
    const entry = pages.get(h.id);
    if (!entry) continue;
    const { doc, page } = entry;
    if (!docOk(p, doc, page)) continue;
    if ((p.phrases.length || p.not.length) && !matchText({ ...p, any: [] }, `${page.text}\n${doc.name}`)) continue;
    const why = [];
    for (const [term, fields] of Object.entries(h.match || {})) {
      const asked = h.queryTerms?.find((qt) => qt === term) ? '' : ` (close to “${h.queryTerms?.find((qt) => term.startsWith(qt)) || h.queryTerms?.[0] || ''}”)`;
      why.push(`“${term}” in ${fields.join(', ')}${asked}`);
    }
    for (const ph of p.phrases) why.push(`phrase “${ph}”`);
    if (h.semantic) why.push(`meaning similar to the question (${Math.round(h.semantic * 100)}%)`);
    results.push({ id: h.id, doc, page, score: h.score, snippet: snippet(page.text, [...terms, ...(h.terms || [])]), why });
  }
  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, limit), total: results.length, parsed: p };
}

export function invalidate(caseId) {
  cache.delete(caseId);
}
