// Domain & infrastructure intelligence beyond RDAP/DNS/CT: subdomains, historical DNS, reverse DNS,
// website fingerprint (technologies, tracking IDs), public scan history and threat reputation.
// Everything here is passive: Indizia reads what public services already observed. The only request that
// touches the target is the fingerprint, a single homepage GET made by the Indizia server, like a visit.

import { SourceError, hasRelay } from '../http.js';
import { getSetting } from '../settings.js';
import { registrableDomain } from '../hosting.js';

const OTX = 'https://otx.alienvault.com/api/v1/indicators';
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const otxHeaders = () => (getSetting('otxKey') ? { 'X-OTX-API-KEY': getSetting('otxKey') } : {});
const otxKind = (e) => (e.type === 'domain' ? 'domain' : e.value.includes(':') ? 'IPv6' : 'IPv4');

/** Run independent sub-requests; only fail the source when every part failed. */
async function settle(parts) {
  const res = await Promise.allSettled(parts);
  if (res.every((r) => r.status === 'rejected')) throw res[0].reason;
  return res.map((r) => (r.status === 'fulfilled' ? r.value : null));
}

export const subdomains = {
  id: 'hackertarget',
  name: 'HackerTarget host search',
  provider: 'HackerTarget.com',
  homepage: 'https://hackertarget.com/find-dns-host-records/',
  terms: 'https://hackertarget.com/terms/',
  licence: 'Free tier: 50 queries per day per IP address',
  category: 'Domain & DNS',
  accepts: ['domain'],
  cors: true,

  async run(ctx) {
    const domain = ctx.entity.value;
    const { data, evidence } = await ctx.fetch(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`, { text: true, timeout: 15000 });
    const text = String(data).trim();
    if (/api count exceeded|increase quota/i.test(text)) throw new SourceError('rate_limited', 'Daily free quota used up (50 per IP)', evidence);
    if (!text || /^error|no records found/i.test(text)) return ctx.note('No subdomains in the HackerTarget index');
    const rows = text.split('\n').map((l) => l.trim().split(',')).filter(([h, ip]) => h && ip && h.toLowerCase().endsWith(domain));
    if (!rows.length) return ctx.note('No subdomains in the HackerTarget index');
    const byIp = new Map();
    for (const [h, ip] of rows) byIp.set(ip, [...(byIp.get(ip) || []), h.toLowerCase()]);
    const hosts = [...new Set(rows.map(([h]) => h.toLowerCase()))];
    ctx.fact('Subdomains', { label: 'Live hostnames', value: String(hosts.length), evidence });
    ctx.fact('Subdomains', { label: 'Distinct addresses', value: String(byIp.size), evidence });
    const shared = [...byIp.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (shared && shared[1].length > 1) ctx.fact('Subdomains', { label: 'Busiest address', value: `${shared[0]} · ${shared[1].length} hostnames`, evidence, mono: true });
    for (const [h, ip] of rows.slice(0, 18)) {
      if (h.toLowerCase() !== domain) ctx.relate(ctx.entity, { type: 'domain', value: h.toLowerCase() }, 'subdomain');
      ctx.relate({ type: 'domain', value: h.toLowerCase() }, { type: 'ip', value: ip }, 'resolves to');
    }
    ctx.share('hackertarget.hosts', rows);
    ctx.finding({
      title: `${hosts.length} subdomains resolve to ${byIp.size} distinct addresses`,
      detail: 'Hostnames from HackerTarget’s passive DNS index with their current A record. Grouped addresses usually mean shared hosting.',
      confidence: 'confirmed',
      evidence,
      list: rows.slice(0, 80).map(([h, ip]) => `${h}  →  ${ip}`),
      listLabel: rows.length > 80 ? `First 80 of ${rows.length} records` : `${rows.length} records`,
      pivots: [...byIp.keys()].slice(0, 3).map((ip) => ({ type: 'ip', value: ip })),
    });
  },
};

export const passiveDns = {
  id: 'otx-pdns',
  name: 'Passive DNS (OTX)',
  provider: 'AlienVault OTX (LevelBlue)',
  homepage: 'https://otx.alienvault.com/api',
  terms: 'https://otx.alienvault.com/',
  licence: 'Free; a free API key lifts the anonymous limit',
  category: 'Domain & DNS',
  accepts: ['domain', 'ip'],
  cors: true,

  async run(ctx) {
    const e = ctx.entity;
    let res;
    try {
      res = await ctx.fetch(`${OTX}/${otxKind(e)}/${encodeURIComponent(e.value)}/passive_dns`, { headers: otxHeaders(), timeout: 20000 });
    } catch (err) {
      if (err.state === 'rate_limited' && !getSetting('otxKey')) err.message = 'Anonymous access is limited. Add a free OTX key in Settings';
      throw err;
    }
    const { data, evidence } = res;
    const recs = (data.passive_dns || []).filter((r) => r.address && r.hostname);
    if (!recs.length) return ctx.note('No passive DNS records');

    if (e.type === 'domain') {
      const byAddr = new Map();
      for (const r of recs.filter((x) => ['A', 'AAAA', 'CNAME'].includes(x.record_type))) {
        const k = r.address;
        const cur = byAddr.get(k) || { addr: k, type: r.record_type, first: r.first, last: r.last, asn: r.asn, hosts: new Set() };
        if (r.first < cur.first) cur.first = r.first;
        if (r.last > cur.last) cur.last = r.last;
        cur.hosts.add(r.hostname);
        byAddr.set(k, cur);
      }
      const list = [...byAddr.values()].sort((a, b) => (a.first < b.first ? -1 : 1));
      const earliest = list[0]?.first;
      ctx.fact('DNS history', { label: 'Addresses seen', value: String(list.filter((x) => x.type !== 'CNAME').length), evidence });
      if (earliest) ctx.fact('DNS history', { label: 'Earliest record', value: day(earliest), evidence, date: earliest });
      const asns = [...new Set(list.map((x) => x.asn).filter(Boolean))];
      if (asns.length) ctx.fact('DNS history', { label: 'Networks over time', value: asns.slice(0, 5).join(' · '), evidence });
      for (const x of list.filter((r) => r.type !== 'CNAME').slice(-12)) ctx.relate(e, { type: 'ip', value: x.addr }, 'historically resolved to');
      ctx.finding({
        title: `${recs.length} historical DNS records · ${list.length} addresses since ${day(earliest)}`,
        detail: 'When each address was first and last observed answering for this domain or its subdomains. Use it to spot hosting moves and old infrastructure.',
        confidence: 'confirmed',
        evidence,
        date: earliest,
        list: list.slice(0, 80).map((x) => `${x.addr}  ${day(x.first)} → ${day(x.last)}${x.asn ? `  ${x.asn}` : ''}`),
        listLabel: `${Math.min(list.length, 80)} addresses, oldest first`,
        pivots: list.slice(-3).filter((x) => x.type !== 'CNAME').map((x) => ({ type: 'ip', value: x.addr })),
        events: list.slice(0, 40).map((x) => ({ date: x.first, title: `${x.addr} first seen for ${[...x.hosts][0]}` })),
      });
      return;
    }

    // IP: which domains have pointed here (co-hosting / related infrastructure).
    const domains = new Map();
    for (const r of recs) {
      const reg = registrableDomain(r.hostname);
      const cur = domains.get(reg) || { reg, first: r.first, last: r.last, hosts: new Set() };
      if (r.first < cur.first) cur.first = r.first;
      if (r.last > cur.last) cur.last = r.last;
      cur.hosts.add(r.hostname);
      domains.set(reg, cur);
    }
    const list = [...domains.values()].sort((a, b) => (a.last > b.last ? -1 : 1));
    ctx.fact('DNS history', { label: 'Domains seen on this IP', value: `${list.length}${data.count > recs.length ? '+' : ''}`, evidence });
    for (const d of list.slice(0, 12)) ctx.relate(e, { type: 'domain', value: d.reg }, 'hosted (passive DNS)');
    ctx.finding({
      title: `${list.length}${data.count > recs.length ? '+' : ''} domains have pointed to ${e.value}`,
      detail: list.length > 200 ? 'Hundreds of domains: this looks like shared hosting or a CDN edge, so co-hosting proves little.' : 'Co-hosted domains can share an operator, especially on a dedicated network. Treat each as a lead until something else links them.',
      confidence: list.length > 200 ? 'lead' : 'plausible',
      confidenceNote: 'Observed DNS answers; sharing an address does not prove a shared owner',
      evidence,
      list: list.slice(0, 80).map((d) => `${d.reg}  ${day(d.first)} → ${day(d.last)}`),
      listLabel: `${Math.min(list.length, 80)} domains, most recent first`,
      pivots: list.slice(0, 3).map((d) => ({ type: 'domain', value: d.reg })),
    });
  },
};

export const reverseDns = {
  id: 'ptr',
  name: 'Reverse DNS',
  provider: 'RIPE NCC (RIPEstat)',
  homepage: 'https://stat.ripe.net/docs/data_api#reverse-dns-ip',
  terms: 'https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/',
  licence: 'RIPEstat terms',
  category: 'IP & network',
  accepts: ['ip'],
  cors: true,

  async run(ctx) {
    const { data, evidence } = await ctx.fetch(`https://stat.ripe.net/data/reverse-dns-ip/data.json?resource=${encodeURIComponent(ctx.entity.value)}&sourceapp=indizia`);
    const names = (data.data?.result || []).map((n) => String(n).replace(/\.$/, '').toLowerCase()).filter(Boolean);
    if (!names.length) return ctx.note('No PTR record');
    ctx.fact('Network', { label: 'Reverse DNS (PTR)', value: `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4} more` : ''}`, evidence, mono: true });
    for (const n of names.slice(0, 3)) ctx.relate(ctx.entity, { type: 'domain', value: n }, 'reverse DNS');
    ctx.finding({
      title: names.length > 2 ? `${names.length} reverse DNS names, e.g. ${names.slice(0, 2).join(', ')}` : `PTR: ${names.join(', ')}`,
      detail: 'The reverse DNS name is set by whoever controls the address block, often the hosting provider.',
      confidence: 'confirmed',
      evidence,
      list: names.length > 2 ? names.slice(0, 80) : undefined,
      listLabel: `${names.length} names`,
      pivots: [...new Set(names.map(registrableDomain))].slice(0, 2).map((d) => ({ type: 'domain', value: d })),
    });
  },
};

export const fingerprint = {
  id: 'fingerprint',
  name: 'Website fingerprint',
  provider: 'Indizia server (one homepage request)',
  homepage: 'https://github.com/',
  terms: 'https://github.com/',
  licence: 'Derived from the public homepage; the page itself is not stored',
  category: 'Web',
  accepts: ['domain'],
  cors: true,

  async run(ctx) {
    if (!(await hasRelay())) throw new SourceError('needs_relay', 'Needs the Indizia server, which this static deployment does not have.');
    const domain = ctx.entity.value;
    let res;
    try {
      res = await ctx.fetch(`/api/fingerprint?host=${encodeURIComponent(domain)}`, { timeout: 30000 });
    } catch (err) {
      const msg = /"error"\s*:\s*"([^"]+)"/.exec(err.evidence?.excerpt || '')?.[1];
      if (msg && err.state === 'failed') throw new SourceError(/resolve/i.test(msg) ? 'empty' : 'failed', msg, err.evidence);
      throw err;
    }
    const { data: d, evidence } = res;
    ctx.share('fingerprint', d);
    const g = 'Website';
    ctx.fact(g, { label: 'Final URL', value: d.finalUrl, evidence, mono: true, href: d.finalUrl });
    ctx.fact(g, { label: 'HTTP status', value: `${d.httpStatus}${d.https ? ' · HTTPS' : ' · plain HTTP'}`, evidence });
    if (d.title) ctx.fact(g, { label: 'Title', value: d.title, evidence });
    if (d.server) ctx.fact(g, { label: 'Server header', value: d.server, evidence, mono: true });
    if (d.technologies?.length) ctx.fact(g, { label: 'Technologies', value: d.technologies.slice(0, 8).map((t) => t.name + (t.version ? ` ${t.version}` : '')).join(' · '), evidence });

    const finalHost = (() => {
      try {
        return new URL(d.finalUrl).hostname.replace(/^www\./, '');
      } catch {
        return domain;
      }
    })();
    if (registrableDomain(finalHost) !== registrableDomain(domain)) {
      ctx.relate(ctx.entity, { type: 'domain', value: finalHost }, 'redirects to');
      ctx.finding({
        title: `${domain} redirects to ${finalHost}`,
        detail: d.redirects.map((r) => `${r.status || ''} ${r.from} → ${r.to || ''}`.trim()).join(' · '),
        confidence: 'confirmed',
        evidence,
        pivots: [{ type: 'domain', value: registrableDomain(finalHost) }],
      });
    }

    if (d.technologies?.length) {
      const cats = new Map();
      for (const t of d.technologies) cats.set(t.category, [...(cats.get(t.category) || []), t.name + (t.version ? ` ${t.version}` : '')]);
      ctx.finding({
        title: `${d.technologies.length} technologies detected on the homepage`,
        detail: [...cats.entries()].slice(0, 6).map(([c, n]) => `${c}: ${n.join(', ')}`).join(' · '),
        confidence: 'confirmed',
        confidenceNote: 'Matched against response headers, cookies and page markup',
        evidence,
        list: [...cats.entries()].flatMap(([c, n]) => n.map((x) => `${x} — ${c}`)),
        listLabel: `${d.technologies.length} technologies`,
      });
    }

    const sec = d.security || {};
    const checks = [['HSTS', sec.hsts], ['CSP', sec.csp], ['X-Frame-Options', sec.xFrameOptions], ['X-Content-Type-Options', sec.xContentTypeOptions], ['Referrer-Policy', sec.referrerPolicy], ['Permissions-Policy', sec.permissionsPolicy]];
    const have = checks.filter(([, v]) => v).length;
    ctx.fact(g, { label: 'Security headers', value: `${have} of ${checks.length}`, evidence });
    ctx.finding({
      title: `Security headers: ${have} of ${checks.length} present${d.https ? '' : ' · served without HTTPS'}`,
      detail: checks.map(([n, v]) => `${n} ${v ? '✓' : '✗'}`).join(' · '),
      confidence: 'confirmed',
      evidence,
    });

    for (const t of d.trackers || []) ctx.relate(ctx.entity, { type: 'tracker', value: t.id, label: `${t.type} ${t.id}` }, 'uses tracking ID');
    if (d.trackers?.length) {
      ctx.fact(g, { label: 'Tracking IDs', value: d.trackers.map((t) => t.id).join(', '), evidence, mono: true });
      ctx.finding({
        title: `${d.trackers.length} analytics / advertising IDs embedded`,
        detail: 'The same tracking ID on another website is a strong sign of a shared operator. Use the reverse lookups to find other sites with it.',
        confidence: 'confirmed',
        evidence,
        links: d.trackers.flatMap((t) => [
          { href: `https://publicwww.com/websites/${encodeURIComponent(`"${t.id}"`)}/`, label: `${t.id} on PublicWWW`, meta: t.type },
          { href: `https://builtwith.com/relationships/tag/${encodeURIComponent(t.id)}`, label: `${t.id} on BuiltWith`, meta: 'relationships' },
        ]),
      });
    }

    for (const s of d.social || []) ctx.relate(ctx.entity, { type: 'account', value: `${s.network}:${s.handle}`, label: `${s.network} ${s.handle}` }, 'links to profile');
    if (d.social?.length) {
      ctx.finding({
        title: `The site links to ${d.social.length} of its own social profiles`,
        detail: 'Profiles the site itself publishes. They are the organisation’s stated presences, not inferred matches.',
        confidence: 'confirmed',
        evidence,
        links: d.social.map((s) => ({ href: s.url, label: `${s.network} · ${s.handle}` })),
      });
    }
    if (d.linkedDomains?.length) {
      ctx.finding({
        title: `Homepage links to ${d.linkedDomains.length} other domains`,
        detail: `Most linked: ${d.linkedDomains.slice(0, 5).map((x) => x.domain).join(', ')}.`,
        confidence: 'confirmed',
        evidence,
        list: d.linkedDomains.map((x) => `${x.domain} (${x.count})`),
        listLabel: `${d.linkedDomains.length} linked domains`,
      });
    }
  },
};

export const urlscan = {
  id: 'urlscan',
  name: 'urlscan.io history',
  provider: 'urlscan GmbH',
  homepage: 'https://urlscan.io/docs/api/',
  terms: 'https://urlscan.io/terms/',
  licence: 'Public scans; free search API with rate limits',
  category: 'Web',
  accepts: ['domain', 'ip'],
  cors: false,

  async run(ctx) {
    const e = ctx.entity;
    const q = e.type === 'ip' ? `ip:"${e.value}"` : `domain:${e.value}`;
    const { data, evidence } = await ctx.fetch(`https://urlscan.io/api/v1/search/?q=${encodeURIComponent(q)}&size=100`, { relay: true, timeout: 20000 });
    const scans = (data.results || []).filter((r) => r.task?.time);
    if (!scans.length) return ctx.note('Nobody has published a urlscan.io scan of it');
    const times = scans.map((s) => s.task.time).sort();
    const first = times[0];
    const last = times[times.length - 1];
    const distinct = (f) => [...new Set(scans.map(f).filter(Boolean))];
    const g = 'Web history';
    ctx.fact(g, { label: 'Public scans', value: `${data.total >= 10000 ? '10,000+' : data.total}`, evidence, href: `https://urlscan.io/search/#${encodeURIComponent(q)}` });
    ctx.fact(g, { label: 'Scanned between', value: `${day(first)} – ${day(last)}`, evidence, date: first });

    if (e.type === 'domain') {
      const ips = distinct((s) => s.page?.ip);
      const asns = distinct((s) => s.page?.asn && `${s.page.asn}${s.page.asnname ? ' · ' + s.page.asnname.split(',')[0] : ''}`);
      const titles = distinct((s) => s.page?.title);
      const issuers = distinct((s) => s.page?.tlsIssuer);
      if (asns.length) ctx.fact(g, { label: 'Networks seen', value: asns.slice(0, 4).join(' · '), evidence });
      if (issuers.length) ctx.fact(g, { label: 'TLS issuers seen', value: issuers.slice(0, 3).join(' · '), evidence });
      const age = scans.find((s) => s.page?.apexDomainAgeDays)?.page.apexDomainAgeDays;
      if (age) ctx.fact(g, { label: 'Domain age (urlscan)', value: `${Math.round(age / 365.25 * 10) / 10} years`, evidence });
      for (const ip of ips.slice(0, 8)) ctx.relate(e, { type: 'ip', value: ip }, 'served from (urlscan)');
      ctx.finding({
        title: `${data.total >= 10000 ? '10,000+' : data.total} public scans since ${day(first)} · ${ips.length} addresses · ${titles.length} page titles`,
        detail: titles.length > 1 ? `Page titles changed over time, e.g. “${titles[titles.length - 1].slice(0, 80)}” → “${titles[0].slice(0, 80)}”.` : titles[0] ? `Page title: “${titles[0].slice(0, 120)}”.` : undefined,
        confidence: 'confirmed',
        evidence,
        date: first,
        links: scans.slice(0, 12).map((s) => ({ href: `https://urlscan.io/result/${s.task.uuid}/`, label: s.page?.url || s.task.url, meta: `${day(s.task.time)}${s.page?.ip ? ` · ${s.page.ip}` : ''}` })),
        pivots: ips.slice(0, 2).map((ip) => ({ type: 'ip', value: ip })),
        events: scans.slice(-20).map((s) => ({ date: s.task.time, title: `urlscan.io scan: ${s.page?.title?.slice(0, 60) || s.page?.url || s.task.url}` })),
      });
    } else {
      const domains = distinct((s) => s.page?.apexDomain || s.task?.apexDomain);
      for (const d of domains.slice(0, 10)) ctx.relate(e, { type: 'domain', value: d }, 'served (urlscan)');
      ctx.finding({
        title: `${domains.length} domains were served from ${e.value} in public scans`,
        confidence: domains.length > 30 ? 'lead' : 'plausible',
        confidenceNote: 'Observed in scans; a shared address does not prove a shared owner',
        evidence,
        date: first,
        list: domains.slice(0, 80),
        listLabel: `${Math.min(domains.length, 80)} domains`,
        pivots: domains.slice(0, 3).map((d) => ({ type: 'domain', value: d })),
      });
    }
    const flagged = scans.filter((s) => s.verdicts?.malicious || (s.task?.tags || []).some((t) => /phish|malware|malicious|scam|clickfix|c2/i.test(t)));
    if (flagged.length) {
      ctx.finding({
        title: `${flagged.length} of the latest ${scans.length} scans are tagged as phishing or malware`,
        detail: `Tags: ${[...new Set(flagged.flatMap((s) => s.task?.tags || []))].slice(0, 8).join(', ') || 'malicious verdict'}. Tags come from the scan submitters and urlscan’s classifiers.`,
        confidence: 'plausible',
        confidenceNote: 'Third-party verdicts; check the scans themselves',
        evidence,
        links: flagged.slice(0, 8).map((s) => ({ href: `https://urlscan.io/result/${s.task.uuid}/`, label: s.page?.url || s.task.url, meta: day(s.task.time) })),
      });
    }
  },
};

export const reputation = {
  id: 'reputation',
  name: 'Threat reputation',
  provider: 'AlienVault OTX · Cloudflare 1.1.1.2',
  homepage: 'https://otx.alienvault.com/api',
  terms: 'https://www.cloudflare.com/application/terms/',
  licence: 'OTX community data; Cloudflare public resolver',
  category: 'Threat intel',
  accepts: ['domain', 'ip'],
  cors: true,

  async run(ctx) {
    const e = ctx.entity;
    const doh = (host) => ctx.fetch(`https://${host}/dns-query?name=${encodeURIComponent(e.value)}&type=A`, { headers: { Accept: 'application/dns-json' }, timeout: 8000 });
    const [otx, filtered] = await settle([
      ctx.fetch(`${OTX}/${otxKind(e)}/${encodeURIComponent(e.value)}/general`, { headers: otxHeaders(), timeout: 15000 }),
      e.type === 'domain' ? doh('security.cloudflare-dns.com') : Promise.resolve(null),
    ]);
    const g = 'Reputation';

    if (filtered) {
      const ans = (filtered.data.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
      const blocked = ans.includes('0.0.0.0') || (filtered.data.Comment || []).some((c) => /censored|blocked/i.test(c));
      ctx.fact(g, { label: 'Cloudflare malware filter', value: blocked ? 'Blocked' : ans.length ? 'Not blocked' : 'No answer', evidence: filtered.evidence });
      if (blocked) {
        ctx.finding({
          title: 'Blocked by Cloudflare’s malware and phishing filter (1.1.1.2)',
          detail: 'Cloudflare’s security resolver answers 0.0.0.0 for domains its threat intelligence classes as malware or phishing. The block is confirmed; the classification is Cloudflare’s.',
          confidence: 'confirmed',
          evidence: filtered.evidence,
        });
      }
    }

    if (otx) {
      const d = otx.data;
      const pulses = d.pulse_info?.pulses || [];
      const count = d.pulse_info?.count || 0;
      const allow = (d.validation || []).filter((v) => /whitelist|popular|allow/i.test(`${v.name} ${v.source}`));
      const fams = [...new Set([...(d.pulse_info?.related?.alienvault?.malware_families || []), ...(d.pulse_info?.related?.other?.malware_families || [])])];
      ctx.fact(g, { label: 'OTX threat pulses', value: String(count), evidence: otx.evidence, href: `https://otx.alienvault.com/indicator/${otxKind(e) === 'domain' ? 'domain' : 'ip'}/${e.value}` });
      if (allow.length) ctx.fact(g, { label: 'On allowlists', value: allow.map((v) => v.message || v.name).slice(0, 3).join(' · '), evidence: otx.evidence });
      if (fams.length) ctx.fact(g, { label: 'Malware families named', value: fams.slice(0, 6).join(', '), evidence: otx.evidence });
      if (count > 0) {
        const tags = [...new Set(pulses.flatMap((p) => p.tags || []))].slice(0, 10);
        ctx.finding({
          title: `Named in ${count} OTX community threat pulse${count === 1 ? '' : 's'}${allow.length ? ' (but allowlisted)' : ''}`,
          detail: allow.length
            ? 'The indicator is on popularity or allowlists, so pulses that mention it are usually noise (e.g. a well-known resolver or CDN in an IOC dump).'
            : `Pulses are community-submitted indicator lists.${tags.length ? ` Tags: ${tags.join(', ')}.` : ''}${fams.length ? ` Malware families: ${fams.slice(0, 4).join(', ')}.` : ''}`,
          confidence: allow.length ? 'lead' : 'plausible',
          confidenceNote: 'Community threat intelligence; verify against the pulse sources',
          evidence: otx.evidence,
          links: pulses.slice(0, 10).map((p) => ({ href: `https://otx.alienvault.com/pulse/${p.id}`, label: p.name, meta: day(p.created) })),
          date: pulses.map((p) => p.created).filter(Boolean).sort()[0],
        });
      } else if (!filtered || (filtered.data.Answer || []).every((a) => a.data !== '0.0.0.0')) {
        ctx.note('No threat-intelligence signal from OTX or Cloudflare');
      }
      if (e.type === 'ip' && d.asn) ctx.fact(g, { label: 'OTX network', value: d.asn, evidence: otx.evidence, mono: true });
    }
  },
};
