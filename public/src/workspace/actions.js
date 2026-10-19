// Workspace actions shared by the results page and the case page: saving investigations (with change
// detection on re-runs), headless runs, and repeatable workflows.

import { startInvestigation } from '../engine.js';
import { detect } from '../detect.js';
import { toSnapshot, diffSnapshots } from '../snapshot.js';
import { mutate, uid } from './store.js';
import { describeDiff, diffTitles, watchDiff, hasChange, noAnswer, newWatch, canWatch, INTERVALS, INTERVAL_LABEL, RETRY_AFTER } from './watch.js';

export { describeDiff };

const sameRoot = (a, b) => a.type === b.type && a.value.toLowerCase() === b.value.toLowerCase();

/** Save (or update) an investigation in a case. Re-saving the same query records what changed. */
export async function saveInvestigation(caseId, snap, query = snap.root.value) {
  let diff = null;
  const c = await mutate(caseId, (c) => {
    const found = c.investigations.find((i) => sameRoot(i.snapshot.root, snap.root));
    const run = { at: snap.finishedAt || new Date().toISOString(), findings: snap.findings.length, sources: snap.ledger.filter((r) => r.state === 'done').length };
    if (found) {
      if (found.snapshot.startedAt === snap.startedAt) {
        found.snapshot = snap;
        return null;
      }
      diff = diffSnapshots(found.snapshot, snap);
      run.change = describeDiff(diff);
      found.previous = { startedAt: found.snapshot.startedAt, findings: found.snapshot.findings.map((f) => ({ title: f.title, source: f.source })) };
      found.snapshot = snap;
      found.savedAt = new Date().toISOString();
      found.runs = [...(found.runs || []), run].slice(-20);
      found.lastDiff = diffTitles(diff);
      // A manual re-run of a watched search counts as its check.
      if (found.watch) Object.assign(found.watch, { lastCheck: run.at, retryAt: null, carry: [] });
      return `Re-ran “${query}”: ${run.change}`;
    }
    c.investigations.push({ id: uid('i'), query, root: snap.root, savedAt: new Date().toISOString(), snapshot: snap, runs: [run] });
    return `Saved investigation “${query}” (${snap.findings.length} findings from ${run.sources} sources)`;
  });
  return { case: c, diff };
}

/** Turn a watch on (interval 'daily' | 'weekly') or off (null) for a saved search. */
export async function setWatch(caseId, invId, interval) {
  return mutate(caseId, (c) => {
    const inv = c.investigations.find((i) => i.id === invId);
    if (!inv) return null;
    if (!interval) {
      if (!inv.watch) return null;
      delete inv.watch;
      return `Stopped watching “${inv.query}”`;
    }
    if (!canWatch(inv.snapshot?.root?.type || inv.root?.type)) throw new Error('Restricted lenses (username, email, phone) are never re-run automatically');
    if (!INTERVALS[interval]) return null;
    if (inv.watch) {
      if (inv.watch.interval === interval) return null;
      inv.watch.interval = interval;
      return `Watch on “${inv.query}” now checks ${INTERVAL_LABEL[interval].toLowerCase()}`;
    }
    inv.watch = newWatch(inv, interval);
    return `Watching “${inv.query}” (${INTERVAL_LABEL[interval].toLowerCase()}): changes are recorded here`;
  });
}

/**
 * Record a scheduled re-run of a watched search: new snapshot, what changed (without false alarms from
 * sources that did not answer), an audit entry, and an unseen entry in the case's watch log when anything changed.
 * @returns {Promise<{ changed:boolean, summary:string, entry?:object, case?:object }|null>}
 */
export async function recordWatchRun(caseId, invId, snap) {
  let result = null;
  const c = await mutate(caseId, (c) => {
    const inv = c.investigations.find((i) => i.id === invId);
    if (!inv?.watch) return null;
    const at = snap.finishedAt || new Date().toISOString();
    const log = (text) => c.activity.push({ at: new Date().toISOString(), kind: 'watch', text });
    if (noAnswer(snap)) {
      // Offline or every source down: says nothing about the target. Try again soon; log only the first miss.
      if (!inv.watch.retryAt) log(`Watch check of “${inv.query}”: no source answered, trying again in an hour`);
      inv.watch.retryAt = new Date(Date.now() + RETRY_AFTER).toISOString();
      result = { changed: false, summary: 'no answer' };
      return null;
    }
    const d = watchDiff(inv.snapshot, snap, inv.watch.carry || []);
    const summary = describeDiff(d);
    const run = { at, findings: snap.findings.length, sources: snap.ledger.filter((r) => r.state === 'done').length, change: summary, watch: true };
    inv.previous = { startedAt: inv.snapshot.startedAt, findings: inv.snapshot.findings.map((f) => ({ title: f.title, source: f.source })) };
    inv.snapshot = snap;
    inv.savedAt = new Date().toISOString();
    inv.runs = [...(inv.runs || []), run].slice(-20);
    inv.lastDiff = diffTitles(d);
    Object.assign(inv.watch, { lastCheck: at, retryAt: null, carry: d.carry });
    const quiet = d.unanswered.length ? ` (${d.unanswered.length} source${d.unanswered.length === 1 ? '' : 's'} did not answer; their findings are compared next time)` : '';
    if (hasChange(d)) {
      const entry = { id: uid('w'), at, invId, query: inv.query, summary, ...diffTitles(d), unanswered: d.unanswered, seen: false };
      c.watchLog = [...(c.watchLog || []), entry].slice(-200);
      log(`Watch: “${inv.query}” changed: ${summary}${quiet}`);
      result = { changed: true, summary, entry };
    } else {
      log(`Watch check of “${inv.query}”: no changes${quiet}`);
      result = { changed: false, summary };
    }
    return null;
  });
  return result && { ...result, case: c };
}

/** Mark watch changes as seen ("changes since you last looked" empties). */
export async function markWatchSeen(caseId, ids = null) {
  return mutate(caseId, (c) => {
    for (const e of c.watchLog || []) if (!ids || ids.includes(e.id)) e.seen = true;
    return null;
  });
}

/** Run an investigation without UI and resolve with its final state (or a partial one after the timeout). */
export function runHeadless(entity, { timeout = 120_000, sources } = {}) {
  return new Promise((resolve) => {
    let handle = null;
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(state);
    };
    const timer = setTimeout(() => {
      handle?.abort();
      if (handle) finish({ ...handle.state, finishedAt: new Date().toISOString(), partial: true });
    }, timeout);
    handle = startInvestigation(entity, (state) => {
      if (state.finishedAt) setTimeout(() => finish(state), 0);
    }, sources ? { sources } : {});
    if (handle.state.finishedAt) finish(handle.state);
  });
}

/** Repeatable workflows: a seed search, then the pivots of the listed types the seed turned up. */
export const WORKFLOWS = [
  { id: 'domain', name: 'Domain infrastructure sweep', input: 'domain', example: 'example.com', describe: 'The domain, then its main IP addresses and the organisation, LEI or redirect target found.', follow: ['ip', 'organisation', 'lei', 'domain'], max: 4 },
  { id: 'company', name: 'Company due diligence', input: 'organisation', example: 'Deutsche Bahn', describe: 'The organisation, then its LEI record and its official website.', follow: ['lei', 'domain'], max: 3 },
  { id: 'ip', name: 'IP triage', input: 'ip', example: '9.9.9.9', describe: 'The address, its network (ASN), and domains seen on it.', follow: ['asn', 'domain'], max: 4 },
];

export async function runQuery(caseId, text, onProgress) {
  const entity = detect(text);
  if (!entity) return null;
  if (entity.type === 'username') throw new Error('Username searches need the purpose check and run on the results page only');
  if (entity.type === 'file' || entity.type === 'question') throw new Error('Files and questions cannot be saved as searches');
  onProgress?.(`Searching ${entity.value}…`);
  const state = await runHeadless(entity);
  const snap = toSnapshot(state);
  const res = await saveInvestigation(caseId, snap, text);
  return { state, ...res };
}

export async function runWorkflow(caseId, wf, seedText, onProgress) {
  const prefix = { organisation: 'org:', ip: '', domain: '', asn: '', lei: '' }[wf.input] ?? '';
  const seed = detect(seedText) && detect(seedText).type === wf.input ? seedText : `${prefix}${seedText}`;
  const steps = [];
  onProgress?.({ step: 1, total: 1 + wf.max, label: `Seed: ${seedText}` });
  const first = await runQuery(caseId, seed);
  if (!first) throw new Error('Could not understand the seed');
  steps.push({ query: seed, findings: first.state.findings.length });
  // Open questions (engine) name the entities worth following; older engines exposed them as suggestions.
  const leads = first.state.questions?.length
    ? first.state.questions.filter((q) => q.entity?.value).map((q) => ({ type: q.entity.type, value: q.entity.value, label: q.text }))
    : first.state.suggestions || [];
  const follow = leads.filter((s) => wf.follow.includes(s.type)).slice(0, wf.max);
  for (let i = 0; i < follow.length; i++) {
    const s = follow[i];
    const q = s.type === 'organisation' ? `org:${s.value}` : s.value;
    onProgress?.({ step: i + 2, total: 1 + follow.length, label: s.label });
    try {
      const r = await runQuery(caseId, q);
      steps.push({ query: q, findings: r?.state.findings.length ?? 0 });
    } catch (err) {
      steps.push({ query: q, error: err.message });
    }
  }
  await mutate(caseId, () => `Ran workflow “${wf.name}” on “${seedText}”: ${steps.length} searches`);
  return steps;
}
