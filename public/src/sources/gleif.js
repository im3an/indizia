// GLEIF: the global Legal Entity Identifier index. Data is CC0. Keyless API with CORS.

const API = 'https://api.gleif.org/api/v1';

const EXCEPTION_REASONS = {
  NO_KNOWN_PERSON: 'no known legal-entity parent (e.g. owned by individuals or the state)',
  NATURAL_PERSONS: 'controlled by natural persons',
  NON_CONSOLIDATING: 'parent does not consolidate',
  NON_PUBLIC: 'parent not disclosed',
  BINDING_LEGAL_COMMITMENTS: 'disclosure prevented by legal commitments',
  LEGAL_OBSTACLES: 'disclosure prevented by legal obstacles',
  DISCLOSURE_DETRIMENTAL: 'disclosure would be detrimental',
  DETRIMENT_NOT_EXCLUDED: 'detriment not excluded',
  CONSENT_NOT_OBTAINED: 'consent not obtained',
};

function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(gmbh|ag|se|kg|ug|mbh|co|inc|ltd|llc|plc|sa|sas|bv|nv|e\.?v\.?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function describe(record) {
  const e = record.attributes.entity;
  const reg = record.attributes.registration;
  return {
    lei: record.id,
    name: e.legalName?.name,
    city: e.legalAddress?.city,
    country: e.legalAddress?.country,
    registeredAs: e.registeredAs,
    status: e.status,
    regStatus: reg?.status,
    created: e.creationDate,
    jurisdiction: e.jurisdiction,
  };
}

async function parent(ctx, lei, kind) {
  try {
    const { data, evidence } = await ctx.fetch(`${API}/lei-records/${lei}/${kind}-parent`, { notFoundIsEmpty: true });
    return { record: describe(data.data), evidence };
  } catch (err) {
    if (err.state !== 'empty') throw err;
  }
  try {
    const { data, evidence } = await ctx.fetch(`${API}/lei-records/${lei}/${kind}-parent-reporting-exception`, { notFoundIsEmpty: true });
    const reason = data.data?.attributes?.reason;
    return { exception: EXCEPTION_REASONS[reason] || reason, evidence };
  } catch {
    return null;
  }
}

async function runLei(ctx, lei) {
  const { data, evidence } = await ctx.fetch(`${API}/lei-records/${lei}`, { notFoundIsEmpty: true });
  const r = describe(data.data);
  ctx.share('gleif.record', r);

  ctx.fact('Organisation', { label: 'Legal name', value: r.name, evidence });
  ctx.fact('Organisation', { label: 'LEI', value: r.lei, evidence, mono: true });
  ctx.fact('Organisation', { label: 'Registered office', value: [r.city, r.country].filter(Boolean).join(', '), evidence });
  if (r.registeredAs) ctx.fact('Organisation', { label: 'Register number', value: r.registeredAs, evidence, mono: true });
  if (r.created) ctx.fact('Organisation', { label: 'Founded', value: r.created.slice(0, 10), evidence, date: r.created });
  ctx.fact('Organisation', { label: 'LEI status', value: `${r.status?.toLowerCase()} · ${r.regStatus?.toLowerCase()}`, evidence });

  ctx.finding({
    title: `${r.name} · LEI ${r.lei}`,
    detail: [r.registeredAs && `Registered as ${r.registeredAs}`, r.city && `${r.city}, ${r.country}`, r.regStatus === 'LAPSED' && 'LEI has lapsed (not renewed)']
      .filter(Boolean)
      .join(' · '),
    confidence: 'confirmed',
    evidence,
    date: r.created,
  });

  const [direct, ultimate] = await Promise.all([parent(ctx, lei, 'direct'), parent(ctx, lei, 'ultimate')]);
  for (const [label, p] of [['Direct parent', direct], ['Ultimate parent', ultimate]]) {
    if (!p) continue;
    if (p.record) {
      ctx.fact('Organisation', { label, value: `${p.record.name} (${p.record.country})`, evidence: p.evidence });
      ctx.relate({ type: 'lei', value: r.lei, label: r.name }, { type: 'lei', value: p.record.lei, label: p.record.name }, label.toLowerCase());
      // Walk up the ownership chain one parent at a time; the engine's depth limit and budget decide how far.
      if (label === 'Direct parent' && ctx.entity.type === 'lei') ctx.pivot({ type: 'lei', value: p.record.lei, label: p.record.name }, 'direct parent', { again: true });
      ctx.finding({
        title: `${label}: ${p.record.name}`,
        detail: `Reported to GLEIF by the entity itself (Level 2 relationship data). Parent LEI ${p.record.lei}.`,
        confidence: 'confirmed',
        evidence: p.evidence,
        pivots: [{ type: 'lei', value: p.record.lei }],
        relation: { from: r.lei, to: p.record.lei, kind: label.toLowerCase() },
      });
    } else if (p.exception && label === 'Direct parent') {
      ctx.fact('Organisation', { label: 'Parent', value: `Not reported: ${p.exception}`, evidence: p.evidence, muted: true });
    }
  }

  try {
    const { data: kids, evidence: kidsEv } = await ctx.fetch(`${API}/lei-records/${lei}/direct-children?page%5Bsize%5D=20`);
    const total = kids.meta?.pagination?.total || 0;
    if (total) {
      const children = (kids.data || []).map(describe);
      ctx.fact('Organisation', { label: 'Subsidiaries (GLEIF)', value: `${total} direct`, evidence: kidsEv });
      ctx.finding({
        title: `${total} direct subsidiaries reported to GLEIF`,
        detail: 'Children that name this entity as their direct accounting-consolidation parent.',
        confidence: 'confirmed',
        evidence: kidsEv,
        links: children.map((c) => ({ href: `https://search.gleif.org/#/record/${c.lei}`, label: c.name, meta: [c.city, c.country].filter(Boolean).join(', '), q: c.lei })),
      });
      for (const c of children.slice(0, 15)) ctx.relate({ type: 'lei', value: r.lei, label: r.name }, { type: 'lei', value: c.lei, label: c.name }, 'subsidiary');
    }
  } catch {
    /* children are optional context */
  }
}

async function runSearch(ctx, query) {
  const url = `${API}/lei-records?filter%5Bfulltext%5D=${encodeURIComponent(query)}&page%5Bsize%5D=6`;
  const { data, evidence } = await ctx.fetch(url);
  const records = (data.data || []).map(describe);
  if (!records.length) return;
  const q = normName(query);
  const exact = records.filter((r) => normName(r.name) === q);
  ctx.share('gleif.candidates', records);

  for (const r of records.slice(0, 5)) {
    const isExact = exact.includes(r);
    ctx.finding({
      title: `${r.name}`,
      detail: [`LEI ${r.lei}`, r.registeredAs, [r.city, r.country].filter(Boolean).join(', '), r.status !== 'ACTIVE' && r.status?.toLowerCase()]
        .filter(Boolean)
        .join(' · '),
      confidence: isExact ? 'corroborated' : 'plausible',
      confidenceNote: isExact ? 'Exact legal-name match (ignoring legal form)' : 'Text match only; may be a different entity',
      evidence,
      pivots: [{ type: 'lei', value: r.lei }],
    });
  }
  if (exact.length === 1) {
    const r = exact[0];
    ctx.fact('Organisation', { label: 'Best name match', value: `${r.name}`, evidence, confidence: 'corroborated' });
    ctx.fact('Organisation', { label: 'LEI', value: r.lei, evidence, mono: true });
    if (r.registeredAs) ctx.fact('Organisation', { label: 'Register number', value: r.registeredAs, evidence, mono: true });
    ctx.fact('Organisation', { label: 'Registered office', value: [r.city, r.country].filter(Boolean).join(', '), evidence });
    ctx.share('gleif.record', r);
  } else {
    ctx.note(`${records.length} candidates; none is an unambiguous exact match`);
  }
}

export default {
  id: 'gleif',
  name: 'GLEIF',
  provider: 'Global Legal Entity Identifier Foundation',
  homepage: 'https://www.gleif.org/en/lei-data/gleif-api',
  terms: 'https://www.gleif.org/en/meta/lei-data-terms-of-use',
  licence: 'CC0',
  category: 'Companies',
  accepts: ['lei', 'organisation'],
  cors: true,

  async run(ctx) {
    const { type, value } = ctx.entity;
    if (type === 'lei') return runLei(ctx, value);
    return runSearch(ctx, value);
  },
};
