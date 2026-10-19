// Academic and research sources: Crossref, OpenAlex, ROR.

export const crossref = {
  id: 'crossref',
  name: 'Crossref',
  provider: 'Crossref',
  homepage: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
  terms: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-metadata-license-information/',
  licence: 'Bibliographic metadata, openly reusable',
  category: 'Academic',
  accepts: ['doi'],
  cors: true,

  async run(ctx) {
    const { data, evidence } = await ctx.fetch(`https://api.crossref.org/works/${encodeURIComponent(ctx.entity.value)}`, { notFoundIsEmpty: true });
    const w = data.message;
    const date = (w.issued?.['date-parts']?.[0] || []).join('-');
    const authors = (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
    ctx.fact('Publication', { label: 'Title', value: w.title?.[0] || '—', evidence });
    ctx.fact('Publication', { label: 'Published in', value: w['container-title']?.[0] || w.publisher, evidence });
    if (date) ctx.fact('Publication', { label: 'Issued', value: date, evidence, date });
    ctx.fact('Publication', { label: 'Publisher', value: w.publisher, evidence });
    ctx.fact('Publication', { label: 'Authors', value: `${authors.length}${authors.length ? ` · ${authors.slice(0, 3).join(', ')}${authors.length > 3 ? ' et al.' : ''}` : ''}`, evidence });
    if (w.funder?.length) ctx.fact('Publication', { label: 'Funders', value: w.funder.map((f) => f.name).slice(0, 4).join(' · '), evidence });
    ctx.finding({
      title: w.title?.[0] || ctx.entity.value,
      detail: [w['container-title']?.[0], date, `${w['is-referenced-by-count'] ?? 0} citations (Crossref)`, `${w['references-count'] ?? 0} references`].filter(Boolean).join(' · '),
      confidence: 'confirmed',
      evidence,
      href: `https://doi.org/${ctx.entity.value}`,
      date,
      pivots: (w.funder || []).slice(0, 2).map((f) => ({ type: 'organisation', value: f.name })),
    });
    for (const f of (w.funder || []).slice(0, 6)) ctx.relate(ctx.entity, { type: 'organisation', value: f.name }, 'funded by');
  },
};

export const openalexWork = {
  id: 'openalex',
  name: 'OpenAlex',
  provider: 'OurResearch',
  homepage: 'https://docs.openalex.org/',
  terms: 'https://openalex.org/terms',
  licence: 'CC0. Keyless requests share a small daily budget',
  category: 'Academic',
  accepts: ['doi'],
  cors: true,

  async run(ctx) {
    const { data: w, evidence } = await ctx.fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(ctx.entity.value)}?select=id,display_name,cited_by_count,open_access,primary_topic,authorships,publication_year`, { notFoundIsEmpty: true });
    const institutions = new Map();
    for (const a of w.authorships || []) for (const i of a.institutions || []) institutions.set(i.id, i);
    ctx.fact('Publication', { label: 'Cited by', value: `${w.cited_by_count} works (OpenAlex)`, evidence });
    ctx.fact('Publication', { label: 'Open access', value: w.open_access?.is_oa ? `yes · ${w.open_access.oa_status}` : 'no', evidence, href: w.open_access?.oa_url || undefined });
    if (w.primary_topic) ctx.fact('Publication', { label: 'Topic', value: w.primary_topic.display_name, evidence });
    const inst = [...institutions.values()];
    if (inst.length) {
      ctx.finding({
        title: `Authors affiliated with ${inst.length} institutions`,
        detail: inst.slice(0, 5).map((i) => `${i.display_name}${i.country_code ? ` (${i.country_code})` : ''}`).join(' · '),
        confidence: 'confirmed',
        evidence,
        href: w.id,
        pivots: inst.slice(0, 3).map((i) => ({ type: 'organisation', value: i.display_name })),
      });
      for (const i of inst.slice(0, 10)) ctx.relate(ctx.entity, { type: 'organisation', value: i.display_name }, 'author affiliation');
    }
  },
};

export const ror = {
  id: 'ror',
  name: 'ROR',
  provider: 'Research Organization Registry',
  homepage: 'https://ror.readme.io/',
  terms: 'https://ror.org/about/faqs/',
  licence: 'CC0',
  category: 'Academic',
  accepts: ['organisation'],
  cors: true,

  async run(ctx) {
    const { data, evidence } = await ctx.fetch(`https://api.ror.org/v2/organizations?query=${encodeURIComponent(ctx.entity.value)}`);
    const item = data.items?.[0];
    if (!item) return;
    const name = item.names?.find((n) => n.types?.includes('ror_display'))?.value || item.names?.[0]?.value;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöü]+/g, ' ').trim();
    const exact = item.names?.some((n) => norm(n.value) === norm(ctx.entity.value));
    const loc = item.locations?.[0]?.geonames_details;
    ctx.finding({
      title: `${name} · research organisation (ROR)`,
      detail: [item.types?.join(', '), item.established && `established ${item.established}`, loc && `${loc.name}, ${loc.country_name}`].filter(Boolean).join(' · '),
      confidence: exact ? 'corroborated' : 'plausible',
      confidenceNote: exact ? 'Exact name match' : 'Text match only',
      evidence,
      href: item.id,
    });
    if (exact && loc?.lat) ctx.geo({ lat: loc.lat, lon: loc.lng, label: `${name} (ROR)`, precision: 'city', kind: 'organisation' });
  },
};
