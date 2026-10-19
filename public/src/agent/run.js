// Investigation agent, orchestration: objective → targets → plan → parallel searches within limits →
// follow-up leads → case documents → numbered evidence → rules brief (+ validated model brief).
// Every step is logged with a timestamp. Stop works at any point and keeps what was found so far.

import { detect } from '../detect.js';
import { startInvestigation } from '../engine.js';
import { scanTargets, makePlan, validateProposals, numberEvidence, rulesBrief, briefPrompt, parseModelJson, validateBrief, keywords, AUTO_TYPES } from './plan.js';
import { chat } from './llm.js';
import { listDocs } from '../docs/store.js';
import { searchDocs } from '../docs/search.js';

export const DEFAULT_LIMITS = { searches: 6, minutes: 4, follow: true };
const PARALLEL = 2;

/** One engine run that can be stopped from outside; resolves with the final (or partial) state. */
function search(entity, { timeoutMs, signal }) {
  return new Promise((resolve) => {
    let done = false;
    let handle = null;
    const finish = (partial) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (partial) handle?.abort();
      resolve(partial ? { ...handle.state, finishedAt: new Date().toISOString(), partial: true } : handle.state);
    };
    const onAbort = () => finish(true);
    const timer = setTimeout(() => finish(true), timeoutMs);
    signal?.addEventListener('abort', onAbort);
    handle = startInvestigation(entity, (st) => st.finishedAt && setTimeout(() => finish(false), 0));
    if (handle.state.finishedAt) finish(false);
  });
}

const stripMarks = (html) => String(html).replace(/<\/?mark>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * @param {{ objective: string, caseId?: string|null, provider: { id: string, model?: string }, limits?: object, onChange: (state) => void }} o
 */
export function startAgent({ objective, caseId = null, provider, limits = DEFAULT_LIMITS, onChange }) {
  const ctrl = new AbortController();
  const L = { ...DEFAULT_LIMITS, ...limits };
  const state = { objective, caseId, provider, limits: L, startedAt: new Date().toISOString(), finishedAt: null, phase: 'planning', targets: [], tasks: [], log: [], runs: [], evidence: [], brief: null, modelBrief: null, stopped: false };
  const deadline = Date.now() + L.minutes * 60_000;
  const changed = () => onChange?.(state);
  const log = (text, kind = 'step') => {
    state.log.push({ at: new Date().toISOString(), kind, text });
    changed();
  };

  async function runTask(task) {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    changed();
    const entity = detect(task.query);
    const st = await search(entity, { timeoutMs: Math.max(10_000, Math.min(120_000, deadline - Date.now())), signal: ctrl.signal });
    const answered = (st.runs || []).filter((r) => ['done', 'empty'].includes(r.state)).length;
    task.status = st.partial ? 'partial' : 'done';
    task.summary = `${st.findings.length} findings · ${answered} sources answered${st.partial ? ' · stopped early' : ''}`;
    state.runs.push({ query: task.query, task: task.id, state: st });
    log(`${task.query}: ${task.summary}`, 'result');
  }

  async function runQueue(tasks) {
    const queue = tasks.filter((t) => t.status === 'queued');
    const workers = Array.from({ length: PARALLEL }, async () => {
      while (queue.length && !ctrl.signal.aborted && Date.now() < deadline) {
        const t = queue.shift();
        log(`Searching ${t.query}`);
        await runTask(t);
      }
    });
    await Promise.all(workers);
    for (const t of queue) {
      t.status = 'skipped';
      t.summary = ctrl.signal.aborted ? 'stopped' : 'time limit reached';
    }
  }

  const promise = (async () => {
    try {
      log('Reading the objective');
      state.targets = scanTargets(objective);
      if (provider.id !== 'rules') {
        try {
          const r = await chat(provider, [
            { role: 'system', content: 'Extract the things to research from an investigation objective. Only list domains, IP addresses, organisations, LEIs or DOIs that are written in the objective itself. Answer JSON only: {"targets":[{"query":"…","why":"…"}]}' },
            { role: 'user', content: objective },
          ], { json: true, signal: ctrl.signal });
          const { targets, rejected } = validateProposals(parseModelJson(r.content)?.targets, state.targets, objective);
          if (targets.length) log(`${r.model} also read ${targets.map((t) => t.query).join(', ')} in the objective`);
          if (rejected.length) log(`Ignored ${rejected.length} model suggestion(s): ${rejected.map((x) => `${x.query || '?'} (${x.reason})`).join('; ')}`, 'warn');
          state.targets.push(...targets);
        } catch (err) {
          log(`The model did not help with planning (${err.message}); continuing with rules`, 'warn');
        }
      }
      state.tasks = makePlan(state.targets, { maxSearches: L.searches });
      if (!state.tasks.length) {
        log('The objective names nothing Indizia can search. Name a domain, IP, company (in quotes), LEI or DOI.', 'warn');
      } else {
        log(`Plan: ${state.tasks.filter((t) => !t.restricted).length} search(es)${state.tasks.some((t) => t.restricted) ? `, ${state.tasks.filter((t) => t.restricted).length} restricted lens(es) waiting for you` : ''}`);
      }
      state.phase = 'searching';
      await runQueue(state.tasks);

      // Follow-up: open questions that point at searchable entities, within the remaining budget.
      const budget = L.searches - state.tasks.filter((t) => !t.restricted).length;
      if (L.follow && budget > 0 && !ctrl.signal.aborted && Date.now() < deadline) {
        const planned = new Set(state.tasks.map((t) => `${t.type}:${String(t.value).toLowerCase()}`));
        const leads = [];
        for (const r of state.runs) {
          for (const q of r.state.questions || []) {
            const e = q.entity;
            if (!e?.value || !AUTO_TYPES.has(e.type)) continue;
            const k = `${e.type}:${String(e.value).toLowerCase()}`;
            if (planned.has(k)) continue;
            planned.add(k);
            leads.push({ id: `T${state.tasks.length + leads.length + 1}`, query: e.type === 'organisation' ? `org:${e.value}` : e.value, type: e.type, value: e.value, why: `Lead from ${r.query}: ${q.text || q.title || 'open question'}`, status: 'queued', restricted: false, followUp: true });
          }
        }
        const pick = leads.slice(0, Math.min(3, budget));
        if (pick.length) {
          log(`Following ${pick.length} lead(s): ${pick.map((t) => t.query).join(', ')}`);
          state.tasks.push(...pick);
          await runQueue(pick);
        }
      }

      let docHits = [];
      if (caseId) {
        const docs = await listDocs(caseId);
        if (docs.length) {
          // One search per target (exact phrase), plus the objective's keywords; best page per hit, merged.
          const queries = [...state.targets.filter((t) => !t.restricted).map((t) => `"${t.value}"`)];
          const kw = keywords(objective, state.targets);
          if (kw.length) queries.push(kw.join(' OR '));
          const merged = new Map();
          for (const q of queries) {
            const { results } = await searchDocs(caseId, docs, q, { limit: 6 });
            for (const r of results) if (!merged.has(r.id)) merged.set(r.id, { ...r, text: stripMarks(r.snippet), matched: q });
          }
          docHits = [...merged.values()].slice(0, 8);
          log(`Case documents: ${docHits.length} relevant page(s) in ${docs.length} document(s)`);
        }
      }

      state.phase = 'writing';
      state.evidence = numberEvidence(state.runs, docHits);
      state.brief = rulesBrief(objective, state.evidence, state.runs);
      log(`Evidence: ${state.evidence.length} numbered item(s)`);
      if (provider.id !== 'rules' && state.evidence.length && !ctrl.signal.aborted) {
        log(`Writing the brief with ${provider.model || provider.id}`);
        try {
          const r = await chat(provider, briefPrompt(objective, state.evidence), { json: true, signal: ctrl.signal });
          const parsed = parseModelJson(r.content);
          if (!parsed) throw new Error('the model did not answer in the requested format');
          state.modelBrief = { ...validateBrief(parsed, state.evidence), model: r.model, ms: r.ms };
          log(`Brief: ${state.modelBrief.answer.length} statement(s) kept, ${state.modelBrief.dropped.length} dropped by the citation check (${(r.ms / 1000).toFixed(1)} s)`, state.modelBrief.dropped.length ? 'warn' : 'step');
        } catch (err) {
          log(`No model brief: ${err.message}. The rules brief below stands on its own.`, 'warn');
        }
      }
    } catch (err) {
      log(`Stopped by an error: ${err?.message || err}`, 'error');
      console.error(err);
    } finally {
      if (!state.brief) {
        state.evidence = numberEvidence(state.runs, []);
        state.brief = rulesBrief(objective, state.evidence, state.runs);
      }
      state.stopped = ctrl.signal.aborted;
      state.phase = 'done';
      state.finishedAt = new Date().toISOString();
      log(state.stopped ? 'Stopped by you; the brief covers what was found so far' : 'Done');
    }
    return state;
  })();

  return { state, promise, stop: () => ctrl.abort() };
}

/** Markdown export of a finished brief, with the evidence list and the activity log. */
export function briefMarkdown(st) {
  const L = [];
  L.push(`# Investigation brief`, '', `**Objective:** ${st.objective}`, '', `${st.startedAt} → ${st.finishedAt || 'running'} · ${st.runs.length} search(es) · ${st.evidence.length} evidence item(s) · limits: ${st.limits.searches} searches, ${st.limits.minutes} min${st.stopped ? ' · stopped early' : ''}`, '');
  const cite = (c) => c.map((x) => `[${x}]`).join('');
  if (st.modelBrief?.answer?.length) {
    L.push(`## Summary (generated by ${st.modelBrief.model} from the evidence; every statement passed the citation check)`, '');
    for (const a of st.modelBrief.answer) L.push(`- *${a.kind}* — ${a.text} ${cite(a.cites)}`);
    if (st.modelBrief.dropped.length) L.push('', `${st.modelBrief.dropped.length} generated statement(s) were dropped: ${st.modelBrief.dropped.map((d) => `“${d.text}” (${d.reason})`).join('; ')}`);
    L.push('');
  }
  for (const s of st.brief?.sections || []) {
    L.push(`## ${s.title}`, '');
    for (const i of s.items) L.push(`- ${i.text} ${cite(i.cites)}`);
    L.push('');
  }
  const gaps = [...(st.brief?.gaps || []), ...(st.modelBrief?.gaps || [])];
  if (gaps.length) L.push('## Not established / not checked', '', ...gaps.map((g) => `- ${g}`), '');
  const next = [...(st.brief?.questions || []), ...(st.modelBrief?.next || [])];
  if (next.length) L.push('## Open questions and next steps', '', ...next.map((g) => `- ${g}`), '');
  L.push('## Evidence', '');
  for (const e of st.evidence) L.push(`- **[${e.id}]** ${e.source} · ${e.confidence}${e.reliability ? ` · source grade ${e.reliability}` : ''} — ${e.title}${e.detail ? ` — ${e.detail.slice(0, 300)}` : ''}${e.url ? ` — ${e.url}` : ''}${e.retrievedAt ? ` (retrieved ${e.retrievedAt})` : ''}${e.sha256 ? ` sha256 ${e.sha256.slice(0, 16)}…` : ''}`);
  L.push('', '## Activity', '');
  for (const l of st.log) L.push(`- ${l.at} ${l.text}`);
  return L.join('\n');
}
