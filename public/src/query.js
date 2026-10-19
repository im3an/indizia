// Indizia query language, shared by document search and the findings filter.
//
//   words              all must match (fuzzy and prefix where the index supports it)
//   "exact phrase"     must appear as written
//   -word  -"phrase"   must not appear
//   a OR b             either side (groups of plain terms)
//   field:value        filters: type: status: tag: source: conf: entity: page:
//   after:2020-01  before:2021-06-30   date range on the record's date
//
// Pure: parse() returns a structure; matchText() tests a plain string against it.

const FIELD_RE = /^([a-z]+):(.+)$/i;

/** Split respecting quotes: `a "b c" -d` → ['a', '"b c"', '-d'] */
export function tokenize(q) {
  const out = [];
  const re = /(-?)"([^"]*)"|(\S+)/g;
  for (const m of String(q).matchAll(re)) out.push(m[2] !== undefined ? `${m[1]}"${m[2]}"` : m[3]);
  return out;
}

/**
 * @returns {{ any: string[][], phrases: string[], not: string[], filters: Record<string, string[]>, after: string|null, before: string|null, empty: boolean }}
 *   any: OR-groups; every group must match at least one of its terms.
 */
export function parse(q) {
  const res = { any: [], phrases: [], not: [], filters: {}, after: null, before: null, empty: true };
  const toks = tokenize(q);
  let pendingOr = false;
  for (const t of toks) {
    if (t === 'OR' || t === '|') {
      pendingOr = true;
      continue;
    }
    const neg = t.startsWith('-') && t.length > 1;
    const body = neg ? t.slice(1) : t;
    const quoted = /^"(.*)"$/.exec(body);
    if (quoted) {
      if (!quoted[1].trim()) continue;
      (neg ? res.not : res.phrases).push(quoted[1].toLowerCase());
      res.empty = false;
      pendingOr = false;
      continue;
    }
    const f = FIELD_RE.exec(body);
    if (f && !/^https?$/i.test(f[1])) {
      const key = f[1].toLowerCase();
      const val = f[2].replace(/^"|"$/g, '').toLowerCase();
      if (key === 'after') res.after = val;
      else if (key === 'before') res.before = val;
      else (res.filters[neg ? `-${key}` : key] ||= []).push(val);
      res.empty = false;
      pendingOr = false;
      continue;
    }
    const term = body.toLowerCase();
    if (neg) res.not.push(term);
    else if (pendingOr && res.any.length) res.any.at(-1).push(term);
    else res.any.push([term]);
    res.empty = false;
    pendingOr = false;
  }
  return res;
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Does `text` satisfy the term, phrase and exclusion parts of a parsed query? (Filters are the caller's job.) */
export function matchText(p, text) {
  const t = norm(text);
  for (const ph of p.phrases) if (!t.includes(norm(ph))) return false;
  for (const n of p.not) if (t.includes(norm(n))) return false;
  for (const group of p.any) if (!group.some((term) => t.includes(norm(term)))) return false;
  return true;
}

/** Date range check on an ISO-ish string ("2021", "2021-03", "2021-03-05T…"). Missing dates fail a range. */
export function inRange(p, date) {
  if (!p.after && !p.before) return true;
  if (!date) return false;
  const d = String(date).slice(0, 10);
  if (p.after && d < p.after) return false;
  if (p.before && d.slice(0, p.before.length) > p.before) return false;
  return true;
}

/** Filter helper: does a record value satisfy field filters `key` and `-key`? */
export function fieldOk(p, key, values) {
  const vals = (Array.isArray(values) ? values : [values]).filter((v) => v !== undefined && v !== null).map((v) => norm(v));
  const want = p.filters[key];
  const avoid = p.filters[`-${key}`];
  if (want && !want.some((w) => vals.some((v) => v.includes(norm(w))))) return false;
  if (avoid && avoid.some((w) => vals.some((v) => v.includes(norm(w))))) return false;
  return true;
}

/** Words to highlight in a result. */
export const highlightTerms = (p) => [...p.any.flat(), ...p.phrases].filter((t) => t.length > 1);
