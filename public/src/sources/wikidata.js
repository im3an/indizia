// Wikidata: CC0 knowledge graph. Used as an identity anchor for organisations,
// with strong-identifier lookups (official website P856, LEI P1278).

const API = 'https://www.wikidata.org/w/api.php';
const HEADERS = { 'Api-User-Agent': 'Indizia-prototype/0.1 (non-commercial OSINT research prototype)' };
const LANGS = 'en|de';

function api(params) {
  const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
  return `${API}?${q}`;
}

function claimValues(item, prop) {
  return (item.claims?.[prop] || [])
    .filter((c) => c.rank !== 'deprecated')
    .map((c) => c.mainsnak?.datavalue?.value)
    .filter((v) => v !== undefined);
}

function label(item) {
  return item.labels?.en?.value || item.labels?.de?.value || item.id;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function year(time) {
  const m = /^[+-](\d{4})-(\d{2})-(\d{2})/.exec(time || '');
  return m ? (m[2] === '00' ? m[1] : `${m[1]}-${m[2]}-${m[3]}`.replace(/-00$/, '')) : null;
}

async function getItems(ctx, ids) {
  const { data, evidence } = await ctx.fetch(api({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims|sitelinks', languages: LANGS }), { headers: HEADERS });
  return { items: ids.map((id) => data.entities?.[id]).filter((i) => i && !i.missing), evidence };
}

async function searchStatements(ctx, expr) {
  const { data, evidence } = await ctx.fetch(api({ action: 'query', list: 'search', srsearch: expr, srlimit: '5' }), { headers: HEADERS });
  return { ids: (data.query?.search || []).map((s) => s.title), evidence };
}

/** Resolve country/HQ item labels and the ISO code of the country. */
const RELATIONS = { P749: 'parent organisation', P355: 'subsidiary', P127: 'owned by', P1830: 'owner of', P199: 'division' };

async function resolveRefs(ctx, item) {
  const country = claimValues(item, 'P17')[0]?.id;
  const hq = claimValues(item, 'P159')[0]?.id;
  const related = Object.keys(RELATIONS).flatMap((p) => claimValues(item, p).slice(0, 8).map((v) => ({ prop: p, id: v.id })));
  const ids = [...new Set([country, hq, ...related.map((r) => r.id)].filter(Boolean))].slice(0, 50);
  if (!ids.length) return { related: [] };
  const { items } = await getItems(ctx, ids);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const hqCoord = hq && byId[hq] ? claimValues(byId[hq], 'P625')[0] : null;
  return {
    country: country && byId[country] ? label(byId[country]) : null,
    countryIso: country && byId[country] ? claimValues(byId[country], 'P297')[0] : null,
    hq: hq && byId[hq] ? label(byId[hq]) : null,
    hqCoord,
    related: related
      .filter((r) => byId[r.id])
      .map((r) => {
        const it = byId[r.id];
        // People (instance of human, Q5) are not shown as owners: Indizia does not build person profiles.
        const isHuman = claimValues(it, 'P31').some((v) => v.id === 'Q5');
        return { rel: RELATIONS[r.prop], qid: r.id, name: label(it), lei: claimValues(it, 'P1278')[0], isHuman };
      })
      .filter((r) => !r.isHuman),
  };
}

async function report(ctx, item, evidence, confidence, why) {
  const refs = await resolveRefs(ctx, item);
  const websites = claimValues(item, 'P856');
  const lei = claimValues(item, 'P1278')[0];
  const inception = year(claimValues(item, 'P571')[0]?.time);
  const wiki = item.sitelinks?.enwiki?.title || item.sitelinks?.dewiki?.title;
  const wikiHref = item.sitelinks?.enwiki
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(item.sitelinks.enwiki.title)}`
    : item.sitelinks?.dewiki
      ? `https://de.wikipedia.org/wiki/${encodeURIComponent(item.sitelinks.dewiki.title)}`
      : null;
  const description = item.descriptions?.en?.value || item.descriptions?.de?.value;

  ctx.share('wikidata.item', { qid: item.id, label: label(item), countryIso: refs.countryIso, lei, websites: websites.map(hostOf).filter(Boolean) });

  ctx.fact('Organisation', { label: 'Wikidata', value: `${label(item)} (${item.id})`, evidence, href: `https://www.wikidata.org/wiki/${item.id}`, confidence });
  if (description) ctx.fact('Organisation', { label: 'Described as', value: description, evidence });
  if (inception) ctx.fact('Organisation', { label: 'Inception', value: inception, evidence, date: inception });
  if (refs.hq || refs.country) ctx.fact('Organisation', { label: 'Headquarters', value: [refs.hq, refs.country].filter(Boolean).join(', '), evidence });
  if (websites.length) ctx.fact('Organisation', { label: 'Official website', value: websites.map(hostOf).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '), evidence });
  if (wiki && wikiHref) ctx.fact('Organisation', { label: 'Wikipedia', value: wiki, evidence, href: wikiHref });

  ctx.finding({
    title: `${label(item)}${description ? ` · ${description}` : ''}`,
    detail: why,
    confidence,
    evidence,
    href: `https://www.wikidata.org/wiki/${item.id}`,
    date: inception,
    pivots: [
      ...websites.map((w) => ({ type: 'domain', value: hostOf(w) })).filter((p) => p.value).slice(0, 1),
      ...(lei ? [{ type: 'lei', value: lei }] : []),
    ],
  });
  if (lei && ctx.entity.type !== 'lei') ctx.pivot({ type: 'lei', value: lei }, 'LEI listed on Wikidata');

  const coord = claimValues(item, 'P625')[0] || refs.hqCoord;
  if (coord?.latitude != null) ctx.geo({ lat: coord.latitude, lon: coord.longitude, label: `${label(item)} · ${claimValues(item, 'P625')[0] ? 'location' : `HQ ${refs.hq || ''}`} (Wikidata)`, precision: claimValues(item, 'P625')[0] ? 'exact' : 'city', kind: 'organisation' });

  const self = { type: 'organisation', value: label(item), label: label(item) };
  if (ctx.entity.type === 'domain') ctx.relate(ctx.entity, self, 'official website of');
  if (lei) ctx.relate(self, { type: 'lei', value: lei }, 'LEI');
  if (refs.related.length) {
    for (const r of refs.related) ctx.relate(self, { type: 'organisation', value: r.name, label: r.name }, r.rel);
    ctx.finding({
      title: `${refs.related.length} corporate relations on Wikidata`,
      detail: refs.related.slice(0, 6).map((r) => `${r.rel}: ${r.name}`).join(' · '),
      confidence: 'confirmed',
      evidence,
      links: refs.related.map((r) => ({ href: `https://www.wikidata.org/wiki/${r.qid}`, label: r.name, meta: r.rel, q: r.lei || `org:${r.name}` })),
    });
  }
}

export default {
  id: 'wikidata',
  name: 'Wikidata',
  provider: 'Wikimedia Foundation',
  homepage: 'https://www.wikidata.org/wiki/Wikidata:Data_access',
  terms: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
  licence: 'CC0 (structured data)',
  category: 'Knowledge graph',
  accepts: ['organisation', 'domain', 'lei'],
  cors: true,

  async run(ctx) {
    const { type, value } = ctx.entity;

    if (type === 'domain') {
      const variants = [`https://www.${value}/`, `https://${value}/`, `http://www.${value}`, `http://${value}`, `https://www.${value}`, `https://${value}`];
      const { ids, evidence } = await searchStatements(ctx, `haswbstatement:${variants.map((v) => `P856=${v}`).join('|')}`);
      if (!ids.length) {
        ctx.note('No Wikidata item lists this domain as its official website');
        return;
      }
      const { items } = await getItems(ctx, ids.slice(0, 2));
      for (const item of items) await report(ctx, item, evidence, 'confirmed', 'Wikidata lists this domain as the official website (P856) of this item.');
      return;
    }

    if (type === 'lei') {
      const { ids, evidence } = await searchStatements(ctx, `haswbstatement:P1278=${value}`);
      if (!ids.length) {
        ctx.note('No Wikidata item carries this LEI');
        return;
      }
      const { items } = await getItems(ctx, ids.slice(0, 1));
      for (const item of items) await report(ctx, item, evidence, 'confirmed', 'Linked by the shared LEI (P1278), a strong identifier.');
      return;
    }

    const { data, evidence } = await ctx.fetch(api({ action: 'wbsearchentities', search: value, language: 'en', uselang: 'en', type: 'item', limit: '5' }), { headers: HEADERS });
    const hits = data.search || [];
    if (!hits.length) return;
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
    const exact = hits.filter((h) => norm(h.label) === norm(value) || (h.aliases || []).some((a) => norm(a) === norm(value)));
    const { items } = await getItems(ctx, hits.slice(0, 3).map((h) => h.id));
    const primary = items.find((item) => exact.some((h) => h.id === item.id)) || items[0];
    if (!primary) return;
    const isExact = exact.some((h) => h.id === primary.id);
    await report(ctx, primary, evidence, isExact ? 'corroborated' : 'plausible', isExact ? 'Exact label or alias match. Confirm it is the entity you mean.' : 'Top text match only.');
    for (const item of items.filter((i) => i !== primary)) {
      ctx.finding({
        title: `${label(item)}${item.descriptions?.en ? ` · ${item.descriptions.en.value}` : ''}`,
        detail: 'Another possible match.',
        confidence: 'lead',
        evidence,
        href: `https://www.wikidata.org/wiki/${item.id}`,
      });
    }
  },
};
