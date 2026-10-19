// Vulnerability context for software the website fingerprint saw with a version number: published CVEs from
// the NVD (by CPE) and whether CISA lists any of them as exploited in the wild (KEV catalogue). Passive: it
// reads public advisories and never touches the target. A version banner is a claim, and vendors backport
// fixes, so every match is a lead to verify, not proof that the site is vulnerable.

import { SourceError } from '../http.js';

/** Fingerprint technology name → NVD CPE vendor:product. Only products with stable, well-known CPE names. */
export const CPE = {
  nginx: 'f5:nginx',
  Apache: 'apache:http_server',
  'Microsoft IIS': 'microsoft:internet_information_services',
  LiteSpeed: 'litespeedtech:litespeed_web_server',
  PHP: 'php:php',
  WordPress: 'wordpress:wordpress',
  Drupal: 'drupal:drupal',
  Joomla: 'joomla:joomla\\!',
  TYPO3: 'typo3:typo3',
  Ghost: 'ghost:ghost',
  jQuery: 'jquery:jquery',
  Bootstrap: 'getbootstrap:bootstrap',
  'Next.js': 'vercel:next.js',
  Angular: 'angular:angular',
};
const MAX_PRODUCTS = 3; // NVD allows 5 requests per 30 s without a key
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
let kevCache = null;

/** Products worth looking up: known CPE mapping and a concrete version (x.y at least). */
export function lookups(technologies = []) {
  const out = [];
  for (const t of technologies) {
    const cpe = CPE[t.name];
    const v = String(t.version || '').trim();
    if (!cpe || !/^\d+\.\d+(\.\d+)*[a-z]?$/i.test(v)) continue;
    if (out.some((o) => o.cpe === cpe)) continue;
    out.push({ name: t.name, version: v, cpe, match: `cpe:2.3:a:${cpe}:${v}` });
  }
  return out.slice(0, MAX_PRODUCTS);
}

/** NVD 2.0 response → compact CVE list, most severe first. */
export function summarise(nvd, kevIds = new Set()) {
  return (nvd?.vulnerabilities || [])
    .map(({ cve }) => {
      const m = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || cve.metrics?.cvssMetricV40?.[0];
      const v2 = cve.metrics?.cvssMetricV2?.[0];
      return {
        id: cve.id,
        published: String(cve.published || '').slice(0, 10),
        score: m?.cvssData?.baseScore ?? v2?.cvssData?.baseScore ?? null,
        severity: m?.cvssData?.baseSeverity || v2?.baseSeverity || null,
        kev: kevIds.has(cve.id),
        text: (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '',
      };
    })
    .sort((a, b) => Number(b.kev) - Number(a.kev) || (b.score ?? -1) - (a.score ?? -1));
}

export const vulnerabilities = {
  id: 'nvd',
  name: 'Known vulnerabilities (NVD + CISA KEV)',
  provider: 'NIST National Vulnerability Database · CISA Known Exploited Vulnerabilities',
  homepage: 'https://nvd.nist.gov/developers/vulnerabilities',
  terms: 'https://nvd.nist.gov/developers/terms-of-use',
  licence: 'US government works (public domain); NVD: 5 requests per 30 s without a key',
  category: 'Security',
  accepts: ['domain'],
  cors: 'mixed',

  async run(ctx) {
    ctx.progress('Waiting for the website fingerprint');
    const shared = await ctx.waitFor('fingerprint');
    ctx.progress('');
    const tech = shared.fingerprint?.technologies || [];
    const todo = lookups(tech);
    if (!shared.fingerprint) throw new SourceError('skipped', 'No website fingerprint to build on (it did not run or did not answer)');
    if (!todo.length) return ctx.note(tech.length ? 'No software with a version number Indizia can map to CVE data' : 'The fingerprint found no software');

    let kev = new Set();
    try {
      if (!kevCache) {
        const { data, evidence } = await ctx.fetch(KEV_URL, { relay: true, timeout: 30000 });
        kevCache = { ids: new Set((data.vulnerabilities || []).map((v) => v.cveID)), evidence, version: data.catalogVersion, count: data.count };
      }
      kev = kevCache.ids;
    } catch {
      ctx.note('CISA KEV catalogue unavailable; exploitation status not checked');
    }

    for (const [i, p] of todo.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 6500)); // stay under the NVD rate limit
      ctx.progress(`NVD: ${p.name} ${p.version}`);
      const { data, evidence } = await ctx.fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=${encodeURIComponent(p.match)}&resultsPerPage=200`, { timeout: 30000 });
      const list = summarise(data, kev);
      if (!list.length) {
        ctx.fact('Security', { label: `${p.name} ${p.version}`, value: 'No CVEs listed for this version in NVD', evidence });
        continue;
      }
      const exploited = list.filter((c) => c.kev);
      const critical = list.filter((c) => (c.score ?? 0) >= 9).length;
      ctx.fact('Security', { label: `${p.name} ${p.version}`, value: `${data.totalResults} CVEs${exploited.length ? ` · ${exploited.length} known exploited` : ''}`, evidence });
      ctx.finding({
        title: `${p.name} ${p.version}: ${data.totalResults} published CVE${data.totalResults === 1 ? '' : 's'}${exploited.length ? `, ${exploited.length} exploited in the wild (CISA KEV)` : ''}`,
        detail: `${critical ? `${critical} rated critical (CVSS ≥ 9). ` : ''}The version comes from the site's own banner or markup. Vendors and distributions often backport fixes without changing it, so this is context for an authorised check, not a finding that the site is vulnerable.`,
        confidence: exploited.length ? 'plausible' : 'lead',
        confidenceNote: 'Version banner matched to NVD configurations; not tested',
        evidence,
        date: list.map((c) => c.published).sort()[0],
        list: list.slice(0, 40).map((c) => `${c.id}${c.kev ? ' [KEV]' : ''}  ${c.score ?? '—'} ${c.severity || ''}  ${c.published}  ${c.text.slice(0, 140)}`),
        listLabel: list.length > 40 ? `40 most severe of ${list.length}` : `${list.length} CVEs, exploited and most severe first`,
        links: list.slice(0, 8).map((c) => ({ href: `https://nvd.nist.gov/vuln/detail/${c.id}`, label: c.id, meta: c.kev ? 'KEV' : String(c.score ?? '') })),
        events: list.slice(0, 20).map((c) => ({ date: c.published, title: `${c.id} published (${p.name})` })),
      });
    }
    ctx.progress('');
  },
};
