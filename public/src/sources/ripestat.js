// RIPEstat Data API: routing and allocation data for any IP or ASN (global, not only the RIPE region).

import { classifyHosting, isSharedKind } from '../hosting.js';

const BASE = 'https://stat.ripe.net/data';
const APP = 'sourceapp=indizia';

export default {
  id: 'ripestat',
  name: 'RIPEstat',
  provider: 'RIPE NCC',
  homepage: 'https://stat.ripe.net/docs/data_api',
  terms: 'https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions/',
  licence: 'RIPEstat terms; at most 8 concurrent requests per IP',
  category: 'IP & network',
  accepts: ['ip', 'asn'],
  cors: true,

  async run(ctx) {
    const { type, value } = ctx.entity;
    if (type === 'ip') return runIp(ctx, value);
    return runAsn(ctx, value);
  },
};

async function asOverview(ctx, asn) {
  const { data, evidence } = await ctx.fetch(`${BASE}/as-overview/data.json?resource=${asn}&${APP}`);
  return { holder: data.data?.holder, announced: data.data?.announced, evidence };
}

async function runIp(ctx, ip) {
  const { data, evidence } = await ctx.fetch(`${BASE}/network-info/data.json?resource=${encodeURIComponent(ip)}&${APP}`);
  const prefix = data.data?.prefix;
  const asns = data.data?.asns || [];
  if (!prefix && !asns.length) {
    ctx.note('Not announced in the global routing table');
    return;
  }
  ctx.fact('Network', { label: 'Routed prefix', value: prefix || 'not routed', evidence, mono: true });
  if (!asns.length) return;

  const asn = `AS${asns[0]}`;
  const overview = await asOverview(ctx, asn);
  ctx.fact('Network', { label: 'Origin AS', value: `${asn}${overview.holder ? ` · ${overview.holder}` : ''}`, evidence: overview.evidence, mono: true });
  ctx.share('ripestat.holder', overview.holder);
  const hosting = classifyHosting(overview.holder);
  if (hosting) {
    ctx.fact('Network', { label: 'Hosting', value: `${hosting.provider} · ${hosting.kind}${isSharedKind(hosting.kind) ? ' (shared by many customers)' : ''}`, evidence: overview.evidence });
    ctx.share('hosting', hosting);
  }
  ctx.relate(ctx.entity, { type: 'asn', value: asn, label: `${asn}${overview.holder ? ` · ${overview.holder}` : ''}` }, 'announced by');
  if (ctx.entity.type === 'ip') ctx.pivot({ type: 'asn', value: asn, label: `${asn}${overview.holder ? ` · ${overview.holder}` : ''}` }, 'announced by');
  ctx.finding({
    title: `${prefix} is announced by ${asn}${overview.holder ? ` (${overview.holder})` : ''}`,
    detail: asns.length > 1 ? `Multiple origin ASNs: ${asns.map((a) => 'AS' + a).join(', ')}.` : undefined,
    confidence: 'confirmed',
    evidence,
    pivots: [{ type: 'asn', value: asn }],
  });
}

async function runAsn(ctx, asn) {
  const overview = await asOverview(ctx, asn);
  if (!overview.holder) {
    ctx.note('RIPEstat knows no holder for this ASN');
    return;
  }
  ctx.fact('Network', { label: 'Holder', value: overview.holder, evidence: overview.evidence });
  const hosting = classifyHosting(overview.holder);
  if (hosting) ctx.fact('Network', { label: 'Provider type', value: `${hosting.provider} · ${hosting.kind}`, evidence: overview.evidence });
  const { data, evidence } = await ctx.fetch(`${BASE}/announced-prefixes/data.json?resource=${asn}&${APP}`);
  const prefixes = (data.data?.prefixes || []).map((p) => p.prefix);
  const v4 = prefixes.filter((p) => p.includes('.')).length;
  ctx.fact('Network', { label: 'Announced prefixes', value: `${v4} IPv4 · ${prefixes.length - v4} IPv6`, evidence });
  ctx.finding({
    title: `${asn} (${overview.holder}) announces ${prefixes.length} prefixes`,
    confidence: 'confirmed',
    evidence,
    list: prefixes.slice(0, 40),
    listLabel: prefixes.length > 40 ? `First 40 of ${prefixes.length}` : `${prefixes.length} prefixes`,
  });
}
