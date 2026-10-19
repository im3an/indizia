// Scheduled watches: the pure part (no DOM, no storage), so it can be tested in Node.
// A watch lives on a saved search: inv.watch = { interval: 'daily'|'weekly', since, lastCheck, retryAt, carry }.
// The scheduler (scheduler.js) asks which watches are due, re-runs one at a time, and records what changed.

import { diffSnapshots } from '../snapshot.js';
import { RESTRICTED } from '../detect.js';

const HOUR = 3_600_000;
export const INTERVALS = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR };
export const INTERVAL_LABEL = { daily: 'Daily', weekly: 'Weekly' };

/** After a run where no source answered (offline, relay down), try again after this long instead of a full interval. */
export const RETRY_AFTER = HOUR;
/** A source that answered HTTP 429 (or said its quota is used up) is left out of watch runs for this long. */
export const COOLDOWN = 6 * HOUR;
/** The scheduler runs at most one watch per tick, so this is also the minimum gap between two watch runs. */
export const TICK = 2 * 60_000;

const NOT_WATCHABLE = new Set(['file', 'question', 'objective']);
const ANSWERED = new Set(['done', 'empty']);
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/**
 * Restricted lenses (username, email, phone) need a purpose prompt every time and never run unattended.
 * Files and questions are not repeatable searches.
 */
export function canWatch(type) {
  return !!type && !RESTRICTED[type] && !NOT_WATCHABLE.has(type);
}

/** The watch record for a saved search that starts now. The existing snapshot counts as the first check. */
export function newWatch(inv, interval = 'daily', now = Date.now()) {
  const last = inv.snapshot?.finishedAt || inv.snapshot?.startedAt || inv.savedAt;
  return { interval: INTERVALS[interval] ? interval : 'daily', since: new Date(now).toISOString(), lastCheck: last || new Date(now).toISOString(), retryAt: null, carry: [] };
}

/** When a watch is next due, as a timestamp (ms). NaN for no or a broken watch. */
export function nextDue(watch) {
  if (!watch || !INTERVALS[watch.interval]) return NaN;
  const base = ms(watch.lastCheck) || ms(watch.since);
  if (!Number.isFinite(base)) return NaN;
  const regular = base + INTERVALS[watch.interval];
  const retry = ms(watch.retryAt);
  return Number.isFinite(retry) ? Math.max(regular, retry) : regular;
}

export const isDue = (watch, now = Date.now()) => nextDue(watch) <= now;

/**
 * Every watch that is due, oldest first. Closed cases and restricted lenses are skipped, whatever the record says.
 * @returns {{ caseId, caseName, invId, query, type, due }[]}
 */
export function dueWatches(cases, now = Date.now()) {
  const out = [];
  for (const c of cases || []) {
    if (c.status === 'closed') continue;
    for (const inv of c.investigations || []) {
      const type = inv.snapshot?.root?.type || inv.root?.type;
      if (!inv.watch || !canWatch(type)) continue;
      const due = nextDue(inv.watch);
      if (due <= now) out.push({ caseId: c.id, caseName: c.name, invId: inv.id, query: inv.query, type, due });
    }
  }
  return out.sort((a, b) => a.due - b.due);
}

/** How many saved searches are watched across all cases (the desktop app keeps running in the background only if > 0). */
export const countWatches = (cases) => (cases || []).filter((c) => c.status !== 'closed').reduce((n, c) => n + c.investigations.filter((i) => i.watch && canWatch(i.snapshot?.root?.type || i.root?.type)).length, 0);

/* ---------- Source rate limits ---------- */

/** Sources still cooling down after a rate limit: Set of source ids. `map` is { sourceId: untilIso }. */
export function coolingDown(map, now = Date.now()) {
  return new Set(Object.entries(map || {}).filter(([, until]) => ms(until) > now).map(([id]) => id));
}

/** Add the sources that rate-limited this run, drop expired entries. Returns a new map. */
export function updateCooldowns(map, ledger, now = Date.now()) {
  const next = {};
  for (const [id, until] of Object.entries(map || {})) if (ms(until) > now) next[id] = until;
  for (const r of ledger || []) if (r.state === 'rate_limited' && r.sourceId) next[r.sourceId] = new Date(now + COOLDOWN).toISOString();
  return next;
}

/* ---------- What changed ---------- */

/**
 * Change between the last check and this one, without false alarms: a finding only counts as gone when its
 * source answered this time. Findings from sources that failed, were rate-limited or were left out (cooldown)
 * are carried forward and compared again on the next check instead.
 * @param {object} before  the saved snapshot
 * @param {object} after   the new snapshot
 * @param {{source:string,title:string}[]} carry  findings carried forward from earlier checks
 */
export function watchDiff(before, after, carry = []) {
  const sig = (f) => `${f.source}|${f.title}`;
  const own = new Set((before?.findings || []).map(sig));
  const base = { ...before, findings: [...(before?.findings || []), ...carry.filter((f) => !own.has(sig(f)))] };
  const d = diffSnapshots(base, after);
  // Sources known to the before or after run, and which of them answered now.
  const known = new Set([...(before?.ledger || []), ...(after?.ledger || [])].map((r) => r.source));
  const answered = new Set((after?.ledger || []).filter((r) => ANSWERED.has(r.state)).map((r) => r.source));
  const unanswered = [...new Set((after?.ledger || []).filter((r) => !ANSWERED.has(r.state) && !['not_applicable', 'skipped'].includes(r.state)).map((r) => r.source))];
  const missing = [...known].some((s) => !answered.has(s));
  // Derived findings (cross-checks) have no ledger row: their removal only counts when every source answered.
  const silent = (f) => (known.has(f.source) ? !answered.has(f.source) : missing);
  const held = d.removed.filter(silent);
  return {
    added: d.added,
    removed: d.removed.filter((f) => !silent(f)),
    grown: d.grown,
    changed: d.changed,
    carry: held.map((f) => ({ source: f.source, sourceId: f.sourceId, title: f.title })),
    unanswered,
  };
}

export const hasChange = (d) => !!d && (d.added.length + d.removed.length + d.grown.length + d.changed.length) > 0;

/** No source answered: the run says nothing about the target (offline, every source down). */
export const noAnswer = (snap) => !(snap?.ledger || []).some((r) => ANSWERED.has(r.state));

/** Short text for a notification or the audit trail: "2 new, 1 gone". */
export function describeDiff(d) {
  const parts = [];
  if (d.added.length) parts.push(`${d.added.length} new`);
  if (d.removed.length) parts.push(`${d.removed.length} gone`);
  if (d.grown.length) parts.push(`${d.grown.length} changed`);
  if (d.changed.length) parts.push(`${d.changed.length} facts changed`);
  return parts.join(', ') || 'no changes';
}

/** Plain titles for storage, as in inv.lastDiff. */
export const diffTitles = (d) => ({
  added: d.added.map((f) => f.title),
  removed: d.removed.map((f) => f.title),
  grown: d.grown.map((g) => `${g.from.title} → ${g.to.title}`),
  changed: d.changed.map((x) => `${x.key}: ${x.from} → ${x.to}`),
});
