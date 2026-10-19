// Plain, storable copy of an investigation: what the workspace saves, what link analysis and reports read.
// No functions, no File objects, no full response bodies (only the evidence fingerprint and a short excerpt).

const EV_KEYS = ['url', 'method', 'status', 'retrievedAt', 'ms', 'bytes', 'sha256', 'viaRelay', 'local'];
const pickEv = (ev, excerpt = 0) => {
  if (!ev) return null;
  const out = {};
  for (const k of EV_KEYS) if (ev[k] !== undefined) out[k] = ev[k];
  if (excerpt && ev.excerpt) out.excerpt = String(ev.excerpt).slice(0, excerpt);
  return out;
};
const ent = (e) => (e ? { type: e.type, value: e.value, ...(e.label && e.label !== e.value ? { label: e.label } : {}) } : null);

/** Shared keys worth keeping: they feed link analysis and the audit report. */
const SHARED_KEEP = ['hosting', 'dns.ns', 'dns.mx', 'dns.ips', 'dns.spf', 'wikidata.item', 'rdap.nameservers', 'certs.hosts'];

export function toSnapshot(state) {
  const names = new Map(state.runs.map((r) => [r.source.id, r.source.name]));
  names.set('sherlock', 'Cross-check');
  names.set('user', 'You');
  const shared = {};
  for (const k of SHARED_KEEP) if (state.shared[k] !== undefined) shared[k] = state.shared[k];
  if (state.shared.fingerprint) {
    const f = state.shared.fingerprint;
    shared.fingerprint = { finalUrl: f.finalUrl, title: f.title, trackers: f.trackers, social: f.social, technologies: f.technologies };
  }
  if (state.shared['gleif.record']) {
    const g = state.shared['gleif.record'];
    shared['gleif.record'] = { lei: g.lei, name: g.name, country: g.country, city: g.city, registeredAs: g.registeredAs };
  }
  return {
    root: { type: state.root.type, value: state.root.value, ...(state.root.host ? { host: state.root.host } : {}) },
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    relations: state.relations.map((r) => ({
      from: ent(r.from),
      to: ent(r.to),
      label: r.label,
      source: names.get(r.sourceId) || r.sourceId || r.source,
      ...(r.evidence ? { evidence: pickEv(r.evidence) } : {}),
      ...(r.pivot ? { pivot: true } : {}),
      ...(r.hop ? { hop: r.hop } : {}),
    })),
    pivots: (state.pivots || []).map((p) => ({ entity: ent(p.entity), from: ent(p.from), reason: p.reason, source: p.source || undefined, hop: p.hop, status: p.status, held: p.held || undefined, manual: p.manual || undefined, cost: p.cost })),
    budget: state.budget ? { depth: state.budget.depth, budget: state.budget.budget, spent: state.budget.spent } : undefined,
    questions: (state.questions || []).map((q) => ({ id: q.id, kind: q.kind, text: q.text, why: q.why, entity: ent(q.entity), weak: q.weak || undefined, findingId: q.findingId })),
    findings: state.findings.map((f) => ({
      id: f.id,
      title: f.title,
      detail: f.detail || undefined,
      confidence: f.confidence,
      confidenceNote: f.confidenceNote || undefined,
      source: f.source?.name || f.source,
      sourceId: f.sourceId,
      via: f.via || undefined,
      date: f.date || undefined,
      href: f.href || undefined,
      crossCheck: f.crossCheck || undefined,
      entity: ent(f.entity),
      evidence: pickEv(f.evidence),
      events: f.events?.length ? f.events.slice(0, 40) : undefined,
      list: f.list?.length ? f.list.slice(0, 60) : undefined,
      listLabel: f.listLabel || undefined,
      pivots: f.pivots?.length ? f.pivots.map(ent) : undefined,
    })),
    facts: Object.fromEntries(
      Object.entries(state.facts).map(([g, list]) => [g, list.map((x) => ({ label: x.label, value: String(x.value), confidence: x.confidence, sources: x.sources.map((s) => s.name || s), date: x.date || undefined, href: x.href || undefined, evidence: pickEv(x.evidence) }))]),
    ),
    ledger: state.runs.map((r) => ({ source: r.source.name, sourceId: r.source.id, input: r.entity.value, inputType: r.entity.type, state: r.state, count: r.count, ms: r.ms, via: r.via || undefined, hop: r.hop || undefined, message: [r.message, ...r.notes].filter(Boolean).join(' · ') || undefined, requests: r.evidence.length })),
    launches: state.launches.map((l) => ({ name: l.name, href: l.href })),
    geo: state.geo.map(({ lat, lon, label, source, precision, kind }) => ({ lat, lon, label, source, precision: precision || 'exact', kind: kind || '' })),
    shared,
  };
}

/** A finding pinned as evidence keeps a longer excerpt, so the audit report can quote it. */
export function evidenceItem(f, root) {
  return {
    title: f.title,
    detail: f.detail || '',
    confidence: f.confidence,
    source: f.source?.name || f.source,
    provider: f.source?.provider || '',
    reliability: f.source?.reliability || null,
    query: root.value,
    queryType: root.type,
    entity: ent(f.entity),
    date: f.date || null,
    evidence: pickEv(f.evidence, 2000),
  };
}

/** Change log between two snapshots of the same query: findings that appeared or disappeared. */
export function diffSnapshots(before, after) {
  const sig = (f) => `${f.source}|${f.title}`;
  const a = new Set((before?.findings || []).map(sig));
  const b = new Set((after?.findings || []).map(sig));
  let added = (after?.findings || []).filter((f) => !a.has(sig(f)));
  let removed = (before?.findings || []).filter((f) => !b.has(sig(f)));
  // Same source and the same sentence with different numbers ("12 certificates" → "14 certificates") is a change, not two events.
  const shape = (f) => `${f.source}|${f.title.replace(/\d[\d,.]*/g, '#')}`;
  const grown = [];
  for (const f of added) {
    const old = removed.find((r) => shape(r) === shape(f));
    if (old) grown.push({ from: old, to: f });
  }
  added = added.filter((f) => !grown.some((g) => g.to === f));
  removed = removed.filter((f) => !grown.some((g) => g.from === f));
  const factSig = (s) => new Map(Object.entries(s?.facts || {}).flatMap(([g, l]) => l.map((x) => [`${g}|${x.label}`, x.value])));
  const fa = factSig(before);
  const fb = factSig(after);
  const changed = [];
  for (const [k, v] of fb) if (fa.has(k) && fa.get(k) !== v) changed.push({ key: k, from: fa.get(k), to: v });
  return { added, removed, grown, changed };
}
