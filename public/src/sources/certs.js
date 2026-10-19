// Certificate Transparency. crt.sh is the primary source (no CORS, so it needs the relay and is often overloaded).
// SSLMate Cert Spotter is the CORS-enabled fallback (free tier: 100 single-host queries/hour).

function summarise(ctx, sourceLabel, certs, evidence) {
  const names = new Set();
  let earliest = null;
  let latest = null;
  let validNow = 0;
  let wildcards = 0;
  let nextExpiry = null;
  const now = new Date().toISOString();
  const issuers = new Map();
  for (const c of certs) {
    if (c.notBefore && (!latest || c.notBefore > latest.notBefore)) latest = c;
    if (c.notAfter && c.notAfter > now && (!c.notBefore || c.notBefore <= now)) {
      validNow++;
      if (!nextExpiry || c.notAfter < nextExpiry) nextExpiry = c.notAfter;
    }
    if (c.names.some((n) => n.startsWith('*.'))) wildcards++;
    for (const n of c.names) {
      const clean = n.toLowerCase().replace(/^\*\./, '');
      if (clean.endsWith(ctx.entity.value)) names.add(clean);
    }
    if (c.notBefore && (!earliest || c.notBefore < earliest)) earliest = c.notBefore;
    if (c.issuer) issuers.set(c.issuer, (issuers.get(c.issuer) || 0) + 1);
  }
  if (!certs.length) {
    ctx.note('No certificates found in the CT logs');
    return;
  }
  const hosts = [...names].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b));
  const topIssuers = [...issuers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  ctx.fact('Certificates', { label: 'Certificates', value: `${certs.length}${sourceLabel === 'current' ? ' current' : ''}`, evidence });
  ctx.fact('Certificates', { label: 'Unique hostnames', value: String(hosts.length), evidence });
  if (earliest) ctx.fact('Certificates', { label: 'Earliest seen', value: earliest.slice(0, 10), evidence, date: earliest });
  if (topIssuers.length) ctx.fact('Certificates', { label: 'Main issuers', value: topIssuers.join(' · '), evidence });
  if (latest?.notBefore) ctx.fact('Certificates', { label: 'Latest issued', value: `${latest.notBefore.slice(0, 10)}${latest.issuer ? ` · ${latest.issuer}` : ''}${latest.notAfter ? ` · valid to ${latest.notAfter.slice(0, 10)}` : ''}`, evidence });
  if (validNow) ctx.fact('Certificates', { label: 'Valid now', value: `${validNow}${nextExpiry ? ` · next expiry ${nextExpiry.slice(0, 10)}` : ''}`, evidence });
  if (wildcards) ctx.fact('Certificates', { label: 'Wildcard certificates', value: String(wildcards), evidence });
  ctx.share('certs.hosts', hosts);

  for (const h of hosts.filter((x) => x !== ctx.entity.value).slice(0, 14)) ctx.relate(ctx.entity, { type: 'domain', value: h }, 'certificate name');
  ctx.finding({
    title: `${certs.length} ${sourceLabel === 'current' ? 'current ' : ''}certificates · ${hosts.length} unique hostnames`,
    detail: earliest ? `Earliest certificate in this result: ${earliest.slice(0, 10)}.` : undefined,
    confidence: 'confirmed',
    evidence,
    list: hosts.slice(0, 60),
    listLabel: hosts.length > 60 ? `First 60 of ${hosts.length} hostnames` : `${hosts.length} hostnames`,
    date: earliest,
    events: earliest ? [{ date: earliest, title: `First certificate in CT logs for ${ctx.entity.value}` }] : undefined,
  });
}

export const crtsh = {
  id: 'crtsh',
  name: 'crt.sh',
  provider: 'Sectigo (community CT search)',
  homepage: 'https://crt.sh',
  terms: 'https://crt.sh',
  licence: 'Public CT log data; no SLA',
  category: 'Certificates',
  accepts: ['domain'],
  cors: false,

  async run(ctx) {
    const url = `https://crt.sh/?q=${encodeURIComponent('%.' + ctx.entity.value)}&output=json`;
    const { data, evidence } = await ctx.fetch(url, { relay: true, timeout: 30000 });
    const seen = new Set();
    const certs = [];
    for (const row of data) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      certs.push({ names: String(row.name_value || '').split('\n'), notBefore: row.not_before, notAfter: row.not_after, issuer: /O=([^,]+)/.exec(row.issuer_name || '')?.[1] });
    }
    summarise(ctx, 'all', certs, evidence);
  },
};

export const certspotter = {
  id: 'certspotter',
  name: 'Cert Spotter',
  provider: 'SSLMate',
  homepage: 'https://sslmate.com/ct_search_api/',
  terms: 'https://sslmate.com/terms',
  licence: 'Free tier: 100 single-host queries per hour, unauthenticated use for evaluation',
  category: 'Certificates',
  accepts: ['domain'],
  cors: true,
  fallbackFor: 'crtsh',

  async run(ctx) {
    const url = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(ctx.entity.value)}&include_subdomains=true&expand=dns_names&expand=issuer`;
    const { data, evidence } = await ctx.fetch(url, { timeout: 20000 });
    const certs = data.map((c) => ({ names: c.dns_names || [], notBefore: c.not_before, notAfter: c.not_after, issuer: c.issuer?.friendly_name || /O=([^,]+)/.exec(c.issuer?.name || '')?.[1] }));
    summarise(ctx, 'current', certs, evidence);
  },
};
