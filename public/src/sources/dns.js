// DNS over HTTPS (Google Public DNS JSON API). Passive: the same lookup any browser makes.
import { massNameServer, massMailProvider, registrableDomain } from '../hosting.js';

const TYPES = { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5, SOA: 6, CAA: 257, DS: 43 };

async function resolve(ctx, name, type) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const { data, evidence } = await ctx.fetch(url, { timeout: 8000 });
  const answers = (data.Answer || []).filter((a) => a.type === TYPES[type]).map((a) => a.data.replace(/\.$/, ''));
  return { answers, evidence, nx: data.Status === 3, ad: data.AD === true };
}

export default {
  id: 'dns',
  name: 'DNS',
  provider: 'Google Public DNS (DoH)',
  homepage: 'https://developers.google.com/speed/public-dns/docs/doh/json',
  terms: 'https://developers.google.com/speed/public-dns/terms',
  licence: 'Live DNS answers',
  category: 'Domain & DNS',
  accepts: ['domain'],
  cors: true,

  async run(ctx) {
    const domain = ctx.entity.value;
    const none = () => ({ answers: [] });
    const [a, aaaa, mx, ns, txt, dmarc, caa, soa, ds, www] = await Promise.all([
      resolve(ctx, domain, 'A'),
      resolve(ctx, domain, 'AAAA'),
      resolve(ctx, domain, 'MX'),
      resolve(ctx, domain, 'NS'),
      resolve(ctx, domain, 'TXT'),
      resolve(ctx, `_dmarc.${domain}`, 'TXT').catch(none),
      resolve(ctx, domain, 'CAA').catch(none),
      resolve(ctx, domain, 'SOA').catch(none),
      resolve(ctx, registrableDomain(domain), 'DS').catch(none),
      resolve(ctx, `www.${domain}`, 'CNAME').catch(none),
    ]);

    if (a.nx) {
      ctx.finding({ title: 'Domain does not resolve (NXDOMAIN)', confidence: 'confirmed', evidence: a.evidence });
      return;
    }
    const ips = [...a.answers, ...aaaa.answers];
    if (ips.length) {
      ctx.fact('Infrastructure', { label: 'Resolves to', value: ips.join(', '), evidence: a.evidence, mono: true });
      ctx.finding({
        title: `Resolves to ${ips.slice(0, 3).join(', ')}${ips.length > 3 ? ` +${ips.length - 3}` : ''}`,
        confidence: 'confirmed',
        evidence: a.evidence,
        pivots: ips.slice(0, 3).map((ip) => ({ type: 'ip', value: ip })),
      });
      ctx.pivot({ type: 'ip', value: a.answers[0] || aaaa.answers[0] }, 'first A record');
      for (const ip of ips.slice(1, 6)) ctx.relate(ctx.entity, { type: 'ip', value: ip }, 'resolves to');
      ctx.share('dns.ips', ips);
    }
    if (ns.answers.length) {
      const hosts = ns.answers.map((h) => h.toLowerCase());
      ctx.fact('Infrastructure', { label: 'Name servers', value: hosts.join(', '), evidence: ns.evidence, mono: true });
      const provider = massNameServer(hosts[0]);
      const own = hosts.some((h) => registrableDomain(h) === registrableDomain(domain));
      ctx.fact('Infrastructure', { label: 'DNS operator', value: provider ? `${provider} (managed DNS)` : own ? 'Self-hosted (in-domain name servers)' : `Dedicated: ${registrableDomain(hosts[0])}`, evidence: ns.evidence });
      for (const h of hosts.slice(0, 4)) ctx.relate(ctx.entity, { type: 'domain', value: h }, 'name server');
      ctx.share('dns.ns', hosts);
    }
    if (mx.answers.length) {
      const hosts = mx.answers.map((m) => m.split(' ').pop().toLowerCase());
      ctx.fact('Infrastructure', { label: 'Mail (MX)', value: hosts.join(', '), evidence: mx.evidence, mono: true });
      const provider = massMailProvider(hosts[0]);
      if (provider) ctx.fact('Infrastructure', { label: 'Mail provider', value: provider, evidence: mx.evidence });
      for (const h of hosts.slice(0, 3)) ctx.relate(ctx.entity, { type: 'domain', value: h }, 'mail server');
      ctx.share('dns.mx', hosts);
    }
    if (soa.answers.length) {
      const [primary, rname, serial] = soa.answers[0].split(' ');
      ctx.fact('Infrastructure', { label: 'SOA', value: `${primary.replace(/\.$/, '')} · serial ${serial}`, evidence: soa.evidence, mono: true });
      // A date-shaped serial (YYYYMMDDnn) tells when the zone was last edited.
      if (/^20\d{6}\d{2}$/.test(serial || '')) ctx.fact('Infrastructure', { label: 'Zone last edited', value: `${serial.slice(0, 4)}-${serial.slice(4, 6)}-${serial.slice(6, 8)} (from SOA serial)`, evidence: soa.evidence, date: `${serial.slice(0, 4)}-${serial.slice(4, 6)}-${serial.slice(6, 8)}` });
      ctx.share('dns.soa', { primary, rname });
    }
    const dnssec = ds.answers.length > 0;
    ctx.fact('Infrastructure', { label: 'DNSSEC', value: dnssec ? `Signed (${ds.answers.length} DS record${ds.answers.length > 1 ? 's' : ''})${a.ad ? ', validated' : ''}` : 'Not signed', evidence: ds.evidence || a.evidence });
    if (caa.answers.length) {
      const cas = [...new Set(caa.answers.map((r) => /issue(?:wild)?\s+"?([^";\s]+)/i.exec(r)?.[1]).filter(Boolean))];
      ctx.fact('Infrastructure', { label: 'CAA (allowed CAs)', value: cas.join(', ') || caa.answers.join(' · '), evidence: caa.evidence, mono: true });
    }
    if (www.answers.length) {
      const target = www.answers[www.answers.length - 1].toLowerCase();
      ctx.fact('Infrastructure', { label: 'www CNAME', value: target, evidence: www.evidence, mono: true });
      ctx.relate({ type: 'domain', value: `www.${domain}` }, { type: 'domain', value: target }, 'CNAME');
      ctx.relate(ctx.entity, { type: 'domain', value: `www.${domain}` }, 'subdomain');
    }
    const spf = txt.answers.find((t) => /v=spf1/i.test(t));
    const includes = spf ? [...spf.matchAll(/include:([^\s"]+)/gi)].map((m) => m[1].toLowerCase()) : [];
    if (includes.length) {
      ctx.fact('Infrastructure', { label: 'SPF senders', value: includes.join(', '), evidence: txt.evidence, mono: true });
      ctx.share('dns.spf', includes);
    }
    const policy = dmarc.answers.map((t) => /p=(\w+)/i.exec(t)?.[1]).find(Boolean);
    if (spf || policy) {
      ctx.fact('Infrastructure', {
        label: 'Mail auth',
        value: [spf ? 'SPF present' : 'no SPF', policy ? `DMARC p=${policy}` : 'no DMARC'].join(' · '),
        evidence: policy ? dmarc.evidence : txt.evidence,
      });
    }
    const verifications = txt.answers
      .map((t) => /^"?([a-z0-9-]+)-(?:site-)?verification=/i.exec(t)?.[1])
      .filter(Boolean);
    if (verifications.length) {
      ctx.finding({
        title: `Domain-verification records for ${[...new Set(verifications)].join(', ')}`,
        detail: 'Published TXT records show which services the domain owner verified.',
        confidence: 'confirmed',
        evidence: txt.evidence,
      });
    }
  },
};
