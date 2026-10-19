// "Related" sources: who mentions, links to, contracts with, or reports on the entity.

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const wikipedia = {
  id: 'wikipedia',
  name: 'Wikipedia',
  provider: 'Wikimedia Foundation',
  homepage: 'https://www.mediawiki.org/wiki/API:Main_page',
  terms: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
  licence: 'CC BY-SA 4.0 text',
  category: 'Knowledge',
  accepts: ['domain', 'organisation'],
  cors: true,

  async run(ctx) {
    const headers = { 'Api-User-Agent': 'Indizia/0.2 (non-commercial OSINT research)' };
    if (ctx.entity.type === 'domain') {
      const results = [];
      let evidence;
      for (const lang of ['en', 'de']) {
        const r = await ctx.fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=exturlusage&euquery=${encodeURIComponent(ctx.entity.value)}&eunamespace=0&eulimit=30&format=json&origin=*`, { headers });
        evidence ||= r.evidence;
        for (const u of r.data.query?.exturlusage || []) results.push({ lang, title: u.title, url: u.url });
      }
      const pages = [...new Map(results.map((r) => [`${r.lang}:${r.title}`, r])).values()];
      if (!pages.length) return ctx.note('No Wikipedia article links to this domain');
      ctx.finding({
        title: `${pages.length} Wikipedia articles link to ${ctx.entity.value}`,
        detail: 'Articles that cite or link the domain (English and German Wikipedia).',
        confidence: 'confirmed',
        evidence,
        links: pages.slice(0, 40).map((p) => ({ href: `https://${p.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, label: p.title, meta: p.lang })),
      });
      return;
    }
    const s = await ctx.fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(ctx.entity.value)}&srlimit=3&format=json&origin=*`, { headers });
    const top = s.data.query?.search?.[0];
    if (!top) return;
    const { data, evidence } = await ctx.fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top.title.replace(/ /g, '_'))}`, { headers });
    const exact = norm(data.title) === norm(ctx.entity.value);
    ctx.finding({
      title: `Wikipedia: ${data.title}`,
      detail: data.extract?.slice(0, 420) + (data.extract?.length > 420 ? '…' : ''),
      confidence: exact ? 'corroborated' : 'plausible',
      confidenceNote: exact ? 'Article title matches the query' : 'Top search result; may be a different subject',
      evidence,
      href: data.content_urls?.desktop?.page,
    });
    if (data.coordinates && exact) ctx.geo({ lat: data.coordinates.lat, lon: data.coordinates.lon, label: `${data.title} (Wikipedia)`, precision: 'exact', kind: 'organisation' });
  },
};

export const hackerNews = {
  id: 'hackernews',
  name: 'Hacker News',
  provider: 'Algolia HN Search API',
  homepage: 'https://hn.algolia.com/api',
  terms: 'https://www.ycombinator.com/legal/',
  licence: 'Public posts and comments',
  category: 'Communities',
  accepts: ['domain', 'organisation'],
  cors: true,

  async run(ctx) {
    const q = ctx.entity.type === 'domain' ? ctx.entity.value : `"${ctx.entity.value}"`;
    const { data, evidence } = await ctx.fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=12`);
    const hits = (data.hits || []).filter((h) => h.title);
    if (!hits.length) return ctx.note('No Hacker News stories mention it');
    ctx.finding({
      title: `${data.nbHits} Hacker News stories mention ${ctx.entity.value}`,
      detail: `Most relevant: “${hits[0].title}” (${hits[0].created_at?.slice(0, 10)}, ${hits[0].points} points).`,
      confidence: 'confirmed',
      evidence,
      links: hits.map((h) => ({ href: `https://news.ycombinator.com/item?id=${h.objectID}`, label: h.title, meta: `${h.created_at?.slice(0, 10)} · ${h.points} pts` })),
      date: hits[0].created_at,
    });
  },
};

export const ted = {
  id: 'ted',
  name: 'TED (EU procurement)',
  provider: 'Publications Office of the EU',
  homepage: 'https://docs.ted.europa.eu/api/latest/index.html',
  terms: 'https://ted.europa.eu/en/legal-notice',
  licence: 'EU public procurement notices, free reuse',
  category: 'Public records',
  accepts: ['organisation'],
  cors: false,

  async run(ctx) {
    const name = ctx.entity.value.replace(/"/g, '');
    const body = {
      query: `organisation-name-buyer ~ "${name}" OR winner-name ~ "${name}"`,
      fields: ['publication-number', 'notice-title', 'publication-date', 'organisation-name-buyer', 'winner-name', 'notice-type', 'total-value'],
      limit: 10,
      scope: 'ALL',
    };
    const { data, evidence } = await ctx.fetch('https://api.ted.europa.eu/v3/notices/search', { method: 'POST', body, relay: true, timeout: 20000 });
    const notices = data.notices || [];
    if (!notices.length) return ctx.note('No EU procurement notices name it as buyer or winner');
    const pick = (v) => (v && typeof v === 'object' ? v.eng || v.deu || Object.values(v)[0] : v);
    const first = (v) => (Array.isArray(pick(v)) ? pick(v)[0] : pick(v));
    const asBuyer = notices.filter((n) => norm(first(n['organisation-name-buyer'])).includes(norm(name))).length;
    ctx.fact('Public records', { label: 'EU procurement', value: `${data.totalNoticeCount >= 999 ? '999+' : data.totalNoticeCount} notices`, evidence, href: `https://ted.europa.eu/en/search/result?FT=${encodeURIComponent(name)}` });
    ctx.finding({
      title: `${data.totalNoticeCount >= 999 ? '999+' : data.totalNoticeCount} EU procurement notices name “${name}” as buyer or winner`,
      detail: `In the latest ${notices.length}: ${asBuyer} as buyer, ${notices.length - asBuyer} as winner or other party. Name matching can include similarly named bodies.`,
      confidence: 'plausible',
      confidenceNote: 'Matched by organisation name',
      evidence,
      links: notices.map((n) => ({
        href: `https://ted.europa.eu/en/notice/-/detail/${n['publication-number']}`,
        label: (pick(n['notice-title']) || n['publication-number']).toString().split(' – ').slice(-1)[0],
        meta: `${n['publication-date']?.slice(0, 10)}${n['total-value'] ? ` · €${Number(n['total-value']).toLocaleString()}` : ''}`,
      })),
      date: notices[0]?.['publication-date']?.slice(0, 10),
    });
  },
};

export const icij = {
  id: 'icij',
  name: 'ICIJ Offshore Leaks',
  provider: 'International Consortium of Investigative Journalists',
  homepage: 'https://offshoreleaks.icij.org/docs/reconciliation',
  terms: 'https://offshoreleaks.icij.org/pages/about',
  licence: 'ODbL / CC BY-SA. Appearing in the data does not imply wrongdoing',
  category: 'Leaks',
  accepts: ['organisation'],
  cors: true,

  async run(ctx) {
    const { data, evidence } = await ctx.fetch('https://offshoreleaks.icij.org/api/v1/reconcile', {
      method: 'POST',
      form: { queries: JSON.stringify({ q0: { query: ctx.entity.value, limit: 8 } }) },
    });
    const close = (data.q0?.result || []).filter((r) => r.match || r.score >= 60);
    if (!close.length) return ctx.note('No close matches in the Offshore Leaks database');
    ctx.finding({
      title: `${close.length} close name matches in the ICIJ Offshore Leaks database`,
      detail: 'Name matches only. ICIJ: there are legitimate uses for offshore entities, and appearing in the data does not imply wrongdoing.',
      confidence: 'lead',
      confidenceNote: 'Fuzzy name match against leaked records',
      evidence,
      links: close.map((r) => ({ href: `https://offshoreleaks.icij.org/nodes/${r.id}`, label: r.name, meta: `${r.types?.[0]?.name || ''} · score ${Math.round(r.score)}` })),
    });
  },
};

export const gdelt = {
  id: 'gdelt',
  name: 'GDELT news',
  provider: 'The GDELT Project',
  homepage: 'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/',
  terms: 'https://www.gdeltproject.org/about.html#termsofuse',
  licence: 'Free, citation required. One request per 5 seconds',
  category: 'News',
  accepts: ['organisation'],
  cors: false,

  async run(ctx) {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${ctx.entity.value}"`)}&mode=artlist&maxrecords=15&format=json&sort=datedesc`;
    const { data, evidence } = await ctx.fetch(url, { relay: true, timeout: 20000 });
    const arts = data.articles || [];
    if (!arts.length) return ctx.note('No news articles in the last three months');
    const date = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
    ctx.finding({
      title: `${arts.length} recent news articles mention “${ctx.entity.value}”`,
      detail: `Sources from ${new Set(arts.map((a) => a.sourcecountry).filter(Boolean)).size} countries. Latest: ${arts[0].domain}, ${date(arts[0].seendate)}.`,
      confidence: 'confirmed',
      evidence,
      links: arts.map((a) => ({ href: a.url, label: a.title, meta: `${a.domain} · ${date(a.seendate)}` })),
      date: date(arts[0].seendate),
    });
  },
};

export const internetdb = {
  id: 'internetdb',
  name: 'Shodan InternetDB',
  provider: 'Shodan',
  homepage: 'https://internetdb.shodan.io/',
  terms: 'https://internetdb.shodan.io/',
  licence: 'Free for non-commercial use. Weekly passive scan data',
  category: 'IP & network',
  accepts: ['ip'],
  cors: true,

  async run(ctx) {
    const { data, evidence } = await ctx.fetch(`https://internetdb.shodan.io/${encodeURIComponent(ctx.entity.value)}`, { notFoundIsEmpty: true });
    if (data.ports?.length) ctx.fact('Network', { label: 'Open ports', value: data.ports.join(', '), evidence, mono: true });
    if (data.hostnames?.length) ctx.fact('Network', { label: 'Hostnames seen', value: data.hostnames.slice(0, 5).join(', '), evidence, mono: true });
    if (data.vulns?.length) ctx.fact('Network', { label: 'Known CVEs', value: `${data.vulns.length}`, evidence });
    ctx.finding({
      title: `${data.ports?.length || 0} open ports seen by Shodan${data.vulns?.length ? ` · ${data.vulns.length} CVEs matched by software version` : ''}`,
      detail: `${data.tags?.length ? `Tags: ${data.tags.join(', ')}. ` : ''}Passive data from Shodan's weekly scans; Indizia does not scan anything itself.`,
      confidence: 'confirmed',
      evidence,
      list: [...(data.hostnames || []), ...(data.vulns || [])].slice(0, 60),
      listLabel: `${data.hostnames?.length || 0} hostnames · ${data.vulns?.length || 0} CVEs`,
      pivots: (data.hostnames || []).slice(0, 2).map((h) => ({ type: 'domain', value: h.split('.').slice(-2).join('.') })),
    });
  },
};
