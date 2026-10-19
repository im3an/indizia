// Open research questions. Every finding, held pivot, conflict and inferred link can raise the next
// question worth asking, phrased as a question and paired with the action that answers it.
// Pure functions, no DOM: runs in the browser and under node:test.
//
// Question kinds (what its button does):
//   follow   — run Indizia's sources on an entity inside this investigation
//   search   — start a separate investigation (restricted lenses keep their own purpose prompt)
//   path     — open the graph on two entities and explain why they may be connected
//   evidence — open the records behind a conflict

import { resolveGraph, band } from './resolve.js';
import { toSnapshot } from './snapshot.js';

const key = (e) => `${e.type}:${e.value}`;
const short = (s, n = 48) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const name = (e) => e.label && e.label !== e.value ? e.label : e.value;

/** How a question about an entity is phrased. */
const ASK = {
  ip: (e) => `Who operates the server at ${e.value}?`,
  asn: (e) => `Which network is ${short(name(e))}?`,
  lei: (e) => `What does the LEI register say about ${short(e.label || `LEI ${e.value}`)}?`,
  domain: (e) => `What is ${e.value}, and who runs it?`,
  url: (e) => `What is at ${short(e.value)}?`,
  organisation: (e) => `What do public records say about “${short(e.value)}”?`,
  doi: (e) => `What is publication ${e.value}?`,
  hash: (e) => `Is the file ${e.value.slice(0, 12)}… known software?`,
  coordinates: (e) => `What is at ${e.value}?`,
  username: (e) => `Where else is the username ${e.value} registered?`,
  crypto: (e) => `What does the public ledger show for ${short(e.value, 20)}?`,
};

/** Restricted lenses never run inside another investigation: they need their own purpose prompt. */
const SEPARATE = new Set(['username', 'email', 'phone']);

export const HELD_NOTE = {
  budget: 'Not followed: this investigation used its pivot budget.',
  depth: 'Not followed: further from your search than the step limit.',
  fanout: 'Not followed: Indizia follows at most three pivots from one entity.',
  policy: 'Indizia never follows this kind of link on its own.',
};

const STRENGTH = { conflict: 1, confirmed: 1, corroborated: 0.9, plausible: 0.5, lead: 0.35 };

/**
 * Build the open questions for an investigation.
 * @param {object} state live investigation state (engine.js)
 * @param {{ estimate?: (entity) => number, max?: number }} opts estimate: source runs a follow would cost
 */
export function buildQuestions(state, { estimate = () => 1, max = 12 } = {}) {
  const out = new Map(); // dedupe key → question
  const rootKey = key(state.root);
  const seen = state.seen || new Set([rootKey]);
  const findingFor = (entity) => state.findings.find((f) => f.pivots?.some((p) => p.value && key(p) === key(entity)));
  const push = (q) => {
    const k = q.dedupe;
    const old = out.get(k);
    if (!old || old.score < q.score) out.set(k, { ...q, findingId: q.findingId || old?.findingId });
  };
  const entityQuestion = (entity, base) => {
    if (!entity?.value || key(entity) === rootKey) return null;
    const ask = ASK[entity.type];
    if (!ask) return null;
    const cost = SEPARATE.has(entity.type) ? 0 : estimate(entity);
    return { kind: SEPARATE.has(entity.type) || !cost ? 'search' : 'follow', text: ask(entity), entity, cost, dedupe: `e:${key(entity)}`, ...base };
  };

  // 1. Pivots the engine held back: the strongest leads, already vetted by a source.
  for (const p of state.pivots || []) {
    if (p.status !== 'held' || seen.has(p.k)) continue;
    const f = findingFor(p.entity);
    const q = entityQuestion(p.entity, {
      why: `${cap(p.reason)} of ${short(name(p.from), 40)}${p.source ? ` · ${p.source}` : ''}. ${HELD_NOTE[p.held] || ''}`.trim(),
      from: p.from,
      sourceId: p.sourceId,
      findingId: f?.id,
      held: p.held,
      weak: false,
      // A source proposed it explicitly, so it ranks with strong leads even when policy keeps it manual.
      score: p.held === 'policy' ? 72 - p.hop : 80 - p.hop * 2,
    });
    if (q) push(q);
  }

  // 2. Leads inside findings that nothing followed yet. Weak findings raise at most two questions.
  let weak = 0;
  const ranked = [...state.findings].sort((a, b) => (STRENGTH[b.confidence] ?? 0) - (STRENGTH[a.confidence] ?? 0));
  for (const f of ranked) {
    const s = STRENGTH[f.confidence] ?? 0.3;
    const isWeak = s < 0.6;
    const fresh = (f.pivots || []).filter((p) => p.value && !seen.has(key(p)) && key(p) !== rootKey && !out.has(`e:${key(p)}`));
    if (!fresh.length) continue;
    if (isWeak && weak >= 2) continue;
    if (isWeak) weak++;
    for (const p of fresh.slice(0, isWeak ? 1 : 3)) {
      const q = entityQuestion(p, {
        why: `From: ${short(f.title, 90)}${f.source?.name ? ` · ${f.source.name}` : ''}${isWeak ? '. A weak lead: the finding itself is unconfirmed.' : ''}`,
        from: f.entity,
        sourceId: f.sourceId,
        findingId: f.id,
        weak: isWeak,
        score: 40 + s * 30,
      });
      if (q) push(q);
    }
  }

  // 3. Conflicts: the most useful question is which source is right.
  for (const f of state.findings) {
    if (f.confidence !== 'conflict') continue;
    push({
      kind: 'evidence',
      text: `Which is right? ${short(f.title, 110)}`,
      why: f.detail || 'Sources disagree. Compare the records before relying on either.',
      findingId: f.id,
      dedupe: `c:${f.id}`,
      weak: false,
      score: 95,
    });
  }

  // 4. Inferred links: hypotheses that need a person to check them.
  if (state.finishedAt) {
    try {
      const model = resolveGraph([toSnapshot(state)]);
      const byId = new Map(model.nodes.map((n) => [n.id, n]));
      const inferred = model.edges.filter((e) => e.kind === 'inferred').sort((a, b) => b.confidence - a.confidence).slice(0, 4);
      for (const e of inferred) {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        // An LEI record and a name mention with the identical name are not a question worth asking.
        if (String(a.label).toLowerCase() === String(b.label).toLowerCase()) continue;
        const same = /same entity/.test(e.label);
        push({
          kind: 'path',
          text: same ? `Are ${short(a.label, 40)} and ${short(b.label, 40)} the same entity?` : `Do ${short(a.label, 40)} and ${short(b.label, 40)} share an operator?`,
          why: `${e.reasons[0]?.text || 'Shared attributes'} · ${Math.round(e.confidence * 100)}% (${band(e.confidence)}). See why they are connected.`,
          pair: [e.a, e.b],
          edgeId: e.id,
          dedupe: `p:${e.a}|${e.b}`,
          weak: e.confidence < 0.6,
          score: 45 + e.confidence * 30,
        });
      }
    } catch (err) {
      // Link analysis is a bonus here; the questions above stand on their own.
      console.warn('questions: link analysis failed', err);
    }
  }

  return [...out.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((q, i) => ({ id: `Q${i + 1}`, ...q }));
}

const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

/** One line for the budget summary. */
export function budgetSummary(state) {
  const p = state.pivots || [];
  const auto = p.filter((x) => x.status === 'followed' && !x.manual).length;
  const manual = p.filter((x) => x.manual).length;
  const held = p.filter((x) => x.status === 'held').length;
  const b = state.budget || { spent: 0, budget: 0, depth: 1 };
  return { auto, manual, held, spent: b.spent, budget: b.budget, depth: b.depth };
}
