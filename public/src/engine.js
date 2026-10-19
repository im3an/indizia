// Investigation engine: plans sources from the registry, runs them in parallel, records every outcome
// in the coverage ledger, follows safe pivots within a depth limit and a budget, and correlates results
// across sources. Pivots it does not follow, and leads in findings, become open questions (questions.js).

import { SourceError } from './http.js';
import { fetchJson } from './http.js';
import { SOURCES } from './sources/index.js';
import { launchPadsFor } from './sources/launch.js';
import { RESTRICTED } from './detect.js';
import { buildQuestions } from './questions.js';

/**
 * Pivots the engine may follow on its own, keyed "from>to". `depth`: the furthest step from the search
 * the target may sit at. `again`: the source that found the pivot also runs on it, so a chain can be
 * walked (GLEIF parent → its parent). Restricted types (username, email, phone, people) never appear here.
 */
export const PIVOT_RULES = {
  'url>domain': { depth: 1 },
  'email>domain': { depth: 1 },
  'domain>ip': { depth: 2 },
  'domain>lei': { depth: 2 },
  'organisation>lei': { depth: 2 },
  'lei>lei': { depth: 3, again: true },
  'ip>asn': { depth: 3 },
};
/** depth: steps away from the search · budget: source runs that automatic pivots may start. */
export const PIVOT_DEFAULTS = { depth: 2, budget: 30 };
const MAX_PIVOTS_PER_ENTITY = 3;

export const FINAL_STATES = new Set(['done', 'empty', 'rate_limited', 'failed', 'timeout', 'needs_relay', 'skipped', 'not_applicable']);

const key = (e) => `${e.type}:${e.value}`;

export function startInvestigation(root, onChange, opts = {}) {
  const ctrl = new AbortController();
  const sources = opts.sources || SOURCES;
  const limits = {
    depth: Math.min(3, Math.max(1, Math.round(opts.depth ?? PIVOT_DEFAULTS.depth))),
    budget: Math.max(0, Math.round(opts.budget ?? PIVOT_DEFAULTS.budget)),
  };
  const state = {
    root,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    runs: [],
    findings: [],
    facts: {},
    shared: {},
    launches: [],
    restricted: RESTRICTED[root.type] || null,
    questions: [], // open research questions, rebuilt whenever the investigation settles
    relations: [], // { from:{type,value,label}, to:{type,value,label}, label, sourceId, evidence, pivot }
    geo: [], // { lat, lon, label, precision, sourceId }
    seen: new Set([key(root)]),
    // Every pivot the sources proposed: followed automatically, followed by the user, or held (and why).
    pivots: [], // { k, entity, from, reason, sourceId, source, hop, evidence, status: 'followed'|'held', held, cost, manual }
    budget: { ...limits, spent: 0 },
    hops: { [key(root)]: 0 },
  };
  let seq = 0;
  let pending = 0;
  const changed = () => onChange(state);

  function addRow(source, entity, via, initial = 'queued', hop = 0, manual = false) {
    const row = { key: `${source.id}@${key(entity)}`, source, entity, via, hop, manual, state: initial, ms: null, count: 0, message: '', notes: [], evidence: [], progress: '' };
    state.runs.push(row);
    return row;
  }

  function makeCtx(row) {
    return {
      entity: row.entity,
      root,
      signal: ctrl.signal,
      async fetch(url, opts = {}) {
        try {
          // A source may pass its own signal (to cancel hedged requests); the run's signal always applies too.
          const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal;
          const res = await fetchJson(url, { ...opts, signal });
          row.evidence.push(res.evidence);
          if (res.evidence.viaRelay) row.viaRelay = true;
          return res;
        } catch (err) {
          if (err.evidence) row.evidence.push(err.evidence);
          if (opts.relay && err.state !== 'needs_relay') row.viaRelay = true;
          throw err;
        }
      },
      finding(f) {
        const finding = { id: `F${++seq}`, sourceId: row.source.id, source: row.source, runKey: row.key, entity: row.entity, via: row.via, ...f };
        state.findings.push(finding);
        row.count++;
        changed();
        return finding;
      },
      /** Revise a finding already published, e.g. one that grows while a long source is still running. */
      update(finding, patch) {
        Object.assign(finding, patch);
        finding.rev = (finding.rev || 0) + 1;
        changed();
        return finding;
      },
      fact(baseGroup, fact) {
        // Facts about a pivoted entity (e.g. the IP behind a domain) get their own, labelled card.
        const group = row.entity.value === root.value || (root.type === 'url' && row.entity.type === 'url') ? baseGroup : `${baseGroup} · ${row.entity.value}`;
        const list = (state.facts[group] ||= []);
        const dup = list.find((x) => x.label === fact.label && String(x.value).toLowerCase() === String(fact.value).toLowerCase());
        if (dup) {
          if (!dup.sources.some((s) => s.id === row.source.id)) {
            dup.sources.push(row.source);
            dup.confidence = 'corroborated';
          }
        } else {
          list.push({ ...fact, sources: [row.source], confidence: fact.confidence || 'confirmed' });
        }
        changed();
      },
      /** Evidence record for work done on the user's device (no network request). */
      local(label, data) {
        const text = JSON.stringify(data, null, 2) ?? '';
        const ev = { url: `local:${label}`, method: 'LOCAL', status: 200, retrievedAt: new Date().toISOString(), ms: 0, bytes: text.length, sha256: null, excerpt: text.slice(0, 6000), local: true };
        row.evidence.push(ev);
        return ev;
      },
      relate(from, to, label) {
        addRelation(from, to, label, row);
      },
      geo(point) {
        if (!Number.isFinite(+point.lat) || !Number.isFinite(+point.lon)) return;
        state.geo.push({ ...point, lat: +point.lat, lon: +point.lon, sourceId: row.source.id, source: row.source.name });
        changed();
      },
      progress(text) {
        row.progress = text;
        changed();
      },
      share(k, v) {
        // Shared data describes the subject of the search. Entities further out, or ones the user added,
        // must not overwrite it (a parent company's GLEIF record is not the searched company's).
        if (v === undefined || v === null || row.hop > 1 || row.manual) return;
        state.shared[k] = v;
      },
      note(text) {
        row.notes.push(text);
        changed();
      },
      /**
       * Wait until another source has finished on the same entity (or `ms` passed) and return what the
       * investigation shared so far. Lets a source build on another's result, e.g. CVEs for fingerprinted software.
       */
      async waitFor(sourceId, ms = 45_000) {
        const t0 = Date.now();
        const done = () => {
          const r = state.runs.find((x) => x.source.id === sourceId && x.entity.value === row.entity.value);
          return !r || FINAL_STATES.has(r.state);
        };
        while (!done() && Date.now() - t0 < ms && !ctrl.signal.aborted) await new Promise((res) => setTimeout(res, 250));
        return state.shared;
      },
      /** Propose a pivot. The engine follows it if policy, depth and budget allow; otherwise it is held. */
      pivot(entity, reason, { again = false } = {}) {
        if (!entity?.value || key(entity) === key(row.entity)) return;
        addRelation(row.entity, entity, reason, row, true);
        const k = key(entity);
        if (state.seen.has(k) || state.pivots.some((p) => p.k === k)) return;
        const rule = PIVOT_RULES[`${row.entity.type}>${entity.type}`];
        const hop = row.hop + 1;
        const rerun = !!(rule?.again || (rule && again));
        const cost = plan(entity, rerun ? null : row.source.id, rerun).length;
        const record = { k, entity, from: row.entity, reason, sourceId: row.source.id, source: row.source.name, hop, evidence: row.evidence.at(-1) || null, cost, again: rerun };
        const fromHere = state.pivots.filter((p) => p.status === 'followed' && p.from && key(p.from) === key(row.entity)).length;
        const held =
          !rule ? 'policy'
          : hop > rule.depth || hop > limits.depth ? 'depth'
          : fromHere >= MAX_PIVOTS_PER_ENTITY ? 'fanout'
          : state.budget.spent + cost > limits.budget ? 'budget'
          : null;
        if (held) {
          state.pivots.push({ ...record, status: 'held', held });
          changed();
          return;
        }
        state.pivots.push({ ...record, status: 'followed' });
        state.budget.spent += cost;
        state.seen.add(k);
        state.hops[k] = hop;
        schedule(entity, `${reason} · ${row.source.name}`, rerun ? null : row.source.id, { hop, again: rerun });
      },
    };
  }

  function addRelation(from, to, label, row, pivot = false) {
    if (!from?.value || !to?.value) return;
    const k = `${key(from)}>${key(to)}>${label}`;
    const old = state.relations.find((r) => r.k === k);
    if (old) {
      old.pivot ||= pivot;
      return;
    }
    state.relations.push({ k, from, to, label, sourceId: row?.source.id, evidence: row?.evidence.at(-1) || null, hop: row?.hop ?? 0, pivot });
  }

  async function execute(row) {
    pending++;
    row.state = 'running';
    const t0 = performance.now();
    changed();
    try {
      await row.source.run(makeCtx(row));
      row.state = row.count > 0 || hasFacts(row) ? 'done' : 'empty';
      if (row.state === 'empty' && !row.notes.length) row.message = 'Answered, nothing found';
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err instanceof SourceError) {
        row.state = err.state;
        row.message = err.message;
      } else {
        row.state = 'failed';
        row.message = 'Unexpected response shape';
        console.error(row.source.id, err);
      }
    } finally {
      row.ms = Math.round(performance.now() - t0);
      pending--;
      afterRow(row);
      changed();
      if (pending === 0) finish();
    }
  }

  function hasFacts(row) {
    return Object.values(state.facts).some((list) => list.some((f) => f.sources.some((s) => s.id === row.source.id)));
  }

  function afterRow(row) {
    // Fallbacks: a standby source runs only if its primary did not answer.
    for (const fb of state.runs.filter((r) => r.state === 'standby' && r.source.fallbackFor === row.source.id && r.entity === row.entity)) {
      if (['failed', 'timeout', 'needs_relay', 'rate_limited'].includes(row.state)) {
        fb.via = fb.via || `fallback for ${row.source.name}`;
        execute(fb);
      } else {
        fb.state = 'skipped';
        fb.message = `${row.source.name} answered, so the fallback was not needed`;
      }
    }
  }

  /** Sources that would run on an entity. A source that already ran on the search itself is not repeated
   *  for a pivot of the same type, unless `again` (walking a chain). */
  function plan(entity, excludeSourceId, again = false, root = false) {
    return sources.filter((source) => {
      if (!source.accepts.includes(entity.type) || (source.when && !source.when(entity)) || source.id === excludeSourceId) return false;
      if (!root && !again && state.runs.some((r) => r.source.id === source.id && r.state !== 'not_applicable' && !r.via && r.entity.type === entity.type)) return false;
      return true;
    });
  }

  function schedule(entity, via, excludeSourceId, { hop = 0, again = false, manual = false } = {}) {
    const list = plan(entity, excludeSourceId, again, !via);
    for (const source of list) {
      // A pivot now covers this source, so drop its "not applicable" row.
      state.runs = state.runs.filter((r) => !(r.source.id === source.id && r.state === 'not_applicable'));
      const row = addRow(source, entity, via, source.fallbackFor ? 'standby' : 'queued', hop, manual);
      if (!source.fallbackFor) execute(row);
    }
    state.launches.push(...launchPadsFor(entity, padContext()).filter((p) => !state.launches.some((l) => l.id === p.id)));
    return list.filter((s) => !s.fallbackFor).length;
  }

  /** Source runs a pivot would cost: fallbacks run only when their primary fails, so they are free.
   *  The user's own follow-ups (the default here) run every source, even ones that ran on the search. */
  function estimate(entity, excludeSourceId = null, again = true) {
    return plan(entity, excludeSourceId, again).filter((s) => !s.fallbackFor).length;
  }

  /**
   * Follow an entity inside this investigation because the user asked: a held pivot or a lead from a
   * finding. Ignores the budget (the user decided) but not the source policy.
   */
  function follow(entity, { reason = 'asked by you', from = null, sourceId = null } = {}) {
    if (!entity?.value || ctrl.signal.aborted) return 0;
    const k = key(entity);
    if (state.seen.has(k)) return 0;
    const held = state.pivots.find((p) => p.k === k);
    const fromEntity = held?.from || from;
    const hop = held ? held.hop : (fromEntity ? (state.hops[key(fromEntity)] ?? 0) + 1 : 1);
    // The user asked, so every applicable source runs, except the one that proposed a held pivot.
    const exclude = held && !held.again ? held.sourceId : null;
    if (held) Object.assign(held, { status: 'followed', manual: true });
    else {
      state.pivots.push({ k, entity, from: fromEntity, reason, sourceId, source: sources.find((s) => s.id === sourceId)?.name || '', hop, evidence: null, cost: estimate(entity), status: 'followed', manual: true });
      if (fromEntity) addRelation(fromEntity, entity, reason, { source: { id: sourceId || 'user' }, evidence: [], hop: hop - 1 }, true);
    }
    state.seen.add(k);
    state.hops[k] = hop;
    state.finishedAt = null;
    const n = schedule(entity, `${held?.reason || reason}${held?.source ? ` · ${held.source}` : ''} · run by you`, exclude, { hop, again: true, manual: true });
    if (pending === 0) finish();
    changed();
    return n;
  }

  function padContext() {
    const g = state.shared['gleif.record'];
    return { registerNumber: g?.registeredAs ? `${g.registeredAs}${g.city ? ' ' + g.city : ''}` : null, legalName: g?.name };
  }

  function finish() {
    if (state.finishedAt) return;
    state.finishedAt = new Date().toISOString();
    correlate(state, () => ({ id: `F${++seq}` }));
    state.questions = buildQuestions(state, { estimate: (e) => estimate(e) });
    // Findings whose questions changed must re-render.
    for (const f of state.findings) {
      const sig = state.questions.filter((q) => q.findingId === f.id).map((q) => q.id).join(',');
      if ((f.qsig || '') !== sig) {
        f.qsig = sig;
        f.rev = (f.rev || 0) + 1;
      }
    }
    // Rebuild launch pads with anything learned (e.g. the register number for Handelsregister).
    const ctx = padContext();
    for (const e of [root, ...state.runs.map((r) => r.entity)]) {
      for (const p of launchPadsFor(e, ctx)) {
        const i = state.launches.findIndex((l) => l.id === p.id);
        if (i >= 0) state.launches[i] = p;
      }
    }
    changed();
  }

  // Plan
  const rootTypeForSources = root.type;
  for (const source of sources) {
    if (!source.accepts.includes(rootTypeForSources) || (source.when && !source.when(root))) {
      const row = addRow(source, root, null, 'not_applicable');
      row.message = 'Not a source for this input type';
    }
  }
  schedule(root, null);
  if (root.type === 'url' && root.host) {
    const domain = { type: 'domain', value: root.host.replace(/^www\./, '') };
    state.seen.add(key(domain));
    state.hops[key(domain)] = 0; // the URL's host is the same subject, not a step away
    // Remove "not applicable" rows that the derived domain will cover.
    state.runs = state.runs.filter((r) => !(r.state === 'not_applicable' && r.source.accepts.includes('domain')));
    schedule(domain, 'host of the URL');
  }
  if (pending === 0) finish();
  changed();

  return { state, abort: () => ctrl.abort(), follow, estimate: (e) => estimate(e) };
}

function correlate(state, nextId) {
  const g = state.shared['gleif.record'];
  const w = state.shared['wikidata.item'];
  // Runs again after the user follows a pivot, so a cross-check that already exists is not added twice.
  const add = (f) => {
    if (state.findings.some((x) => x.crossCheck && x.title === f.title)) return;
    state.findings.push({ ...nextId(), sourceId: 'sherlock', source: { id: 'sherlock', name: 'Cross-check' }, ...f });
  };

  if (g && w) {
    if (w.lei && w.lei === g.lei) {
      add({ title: `Wikidata ${w.qid} and GLEIF ${g.lei} describe the same entity`, detail: 'Both carry the same LEI, a strong identifier.', confidence: 'confirmed', crossCheck: true });
    } else if (w.lei && g.lei && w.lei !== g.lei) {
      add({ title: `Wikidata lists LEI ${w.lei}, but the GLEIF name match is ${g.lei}`, detail: 'The name match may be a different legal entity (e.g. a group holding vs. operating company).', confidence: 'conflict', crossCheck: true });
    }
    if (w.countryIso && g.country) {
      if (w.countryIso === g.country) {
        add({ title: `Country ${g.country} agrees across GLEIF and Wikidata`, confidence: 'corroborated', crossCheck: true });
      } else {
        add({ title: `Country differs: GLEIF says ${g.country}, Wikidata says ${w.countryIso}`, detail: 'Registered office and headquarters can legitimately differ. Check both records.', confidence: 'conflict', crossCheck: true });
      }
    }
  }
  if (state.root.type === 'domain' && w?.websites?.length && !w.websites.includes(state.root.value)) {
    add({ title: `${w.label}'s official website on Wikidata is ${w.websites[0]}, not ${state.root.value}`, confidence: 'conflict', crossCheck: true });
  }
}
