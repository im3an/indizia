// RDAP: structured registration data. Domains use the IANA bootstrap; IPs and ASNs go through rdap.org,
// which redirects to the responsible RIR (all CORS-enabled).

import { cachedJson } from '../http.js';

// ccTLD registries that run RDAP but are missing from the IANA bootstrap.
// cors:false means the browser cannot call them directly.
const EXTRA_DOMAIN_SERVERS = {
  de: { base: 'https://rdap.denic.de/', cors: false },
};

async function domainServer(tld) {
  if (EXTRA_DOMAIN_SERVERS[tld]) return EXTRA_DOMAIN_SERVERS[tld];
  const boot = await cachedJson('iana-rdap-dns', 'https://data.iana.org/rdap/dns.json');
  for (const [tlds, urls] of boot.services) {
    if (tlds.includes(tld)) {
      const base = urls.find((u) => u.startsWith('https://')) || urls[0];
      return { base: base.endsWith('/') ? base : base + '/', cors: true };
    }
  }
  return null;
}

function eventDate(obj, action) {
  return obj.events?.find((e) => e.eventAction === action)?.eventDate;
}

function vcardProp(entity, name) {
  return (entity?.vcardArray?.[1] || []).find((p) => p[0] === name)?.[3];
}

function vcardName(entity) {
  const fn = vcardProp(entity, 'fn');
  const org = vcardProp(entity, 'org');
  return (fn || org || '').toString().trim() || null;
}

/** Privacy rule: contacts of kind "individual" are people. Indizia never displays their names. */
function isPerson(entity) {
  return String(vcardProp(entity, 'kind') || '').toLowerCase() === 'individual' && !/-MNT$/i.test(entity?.handle || '');
}

/** The organisation behind a network object, never a natural person. */
function networkHolder(obj) {
  const all = [];
  const walk = (es, depth) => {
    for (const e of es || []) {
      all.push(e);
      if (depth < 2) walk(e.entities, depth + 1);
    }
  };
  walk(obj.entities, 0);
  const orgs = all.filter((e) => ['org', 'group'].includes(String(vcardProp(e, 'kind') || '').toLowerCase()) && !isPerson(e));
  const registrant = all.find((e) => e.roles?.includes('registrant') && !isPerson(e));
  const org = orgs.find((e) => e.roles?.includes('registrant')) || orgs[0];
  // Role objects are often named "<Org> NOC Contact"; keep the organisation part.
  if (org) return { name: vcardName(org)?.replace(/\s+(NOC\s+|abuse\s+)?contact$/i, ''), kind: 'organisation' };
  if (registrant && /-MNT$/i.test(registrant.handle || '')) return { name: registrant.handle, kind: 'maintainer' };
  if (registrant) return { name: vcardName(registrant), kind: 'organisation' };
  return null;
}

function entitiesWithRole(obj, role, depth = 0) {
  const out = [];
  for (const e of obj.entities || []) {
    if (e.roles?.includes(role)) out.push(e);
    if (depth < 2) out.push(...entitiesWithRole(e, role, depth + 1));
  }
  return out;
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : null;
}

export default {
  id: 'rdap',
  name: 'RDAP',
  provider: 'IANA bootstrap → registry RDAP servers',
  homepage: 'https://www.iana.org/domains/rdap',
  terms: 'https://about.rdap.org/',
  licence: 'Registry terms vary; personal data is usually redacted',
  category: 'Registration data',
  accepts: ['domain', 'ip', 'asn'],
  cors: 'mixed',

  async run(ctx) {
    const { type, value } = ctx.entity;
    if (type === 'domain') return runDomain(ctx, value);
    if (type === 'ip') return runNetwork(ctx, `https://rdap.org/ip/${encodeURIComponent(value)}`, 'ip');
    if (type === 'asn') return runNetwork(ctx, `https://rdap.org/autnum/${value.replace(/^AS/i, '')}`, 'asn');
  },
};

async function runDomain(ctx, domain) {
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  const registrable = labels.slice(-2).join('.');
  const server = await domainServer(tld);
  if (!server) {
    ctx.note(`No RDAP service is published for .${tld}`);
    return;
  }
  const { data, evidence } = await ctx.fetch(`${server.base}domain/${encodeURIComponent(registrable)}`, {
    relay: !server.cors,
    notFoundIsEmpty: true,
    headers: server.cors ? { Accept: 'application/rdap+json' } : {},
  });

  if (!server.cors) ctx.note(`The .${tld} registry sends no CORS headers, so this ran through the relay`);
  const created = eventDate(data, 'registration');
  const changed = eventDate(data, 'last changed') || eventDate(data, 'last update of RDAP database');
  const expires = eventDate(data, 'expiration');
  const registrar = vcardName(entitiesWithRole(data, 'registrar')[0]);
  const registrantEntity = entitiesWithRole(data, 'registrant')[0];
  const registrant = registrantEntity && !isPerson(registrantEntity) ? vcardName(registrantEntity) : null;
  const ns = (data.nameservers || []).map((n) => (n.ldhName || '').toLowerCase()).filter(Boolean);

  if (created) ctx.fact('Registration', { label: 'Registered', value: fmtDate(created), evidence, date: created });
  if (changed) ctx.fact('Registration', { label: 'Last changed', value: fmtDate(changed), evidence, date: changed });
  if (expires) ctx.fact('Registration', { label: 'Expires', value: fmtDate(expires), evidence });
  if (registrar) ctx.fact('Registration', { label: 'Registrar', value: registrar, evidence });
  if (data.status?.length) ctx.fact('Registration', { label: 'Status', value: data.status.join(', '), evidence });
  ctx.fact('Registration', {
    label: 'Registrant',
    value: registrant || 'Not published (redacted or withheld by the registry)',
    evidence,
    muted: !registrant,
  });

  ctx.finding({
    title: created ? `Registered ${fmtDate(created)}${registrar ? ` via ${registrar}` : ''}` : `RDAP record found at the .${tld} registry`,
    detail: changed ? `Record last changed ${fmtDate(changed)}.` : undefined,
    confidence: 'confirmed',
    evidence,
    date: created,
  });
  if (ns.length) ctx.share('rdap.nameservers', ns);
  const terms = data.notices?.find((n) => /term|use/i.test(n.title || ''));
  if (terms) ctx.note(`Registry terms: ${(terms.description || []).join(' ').slice(0, 220)}`);
}

async function runNetwork(ctx, url, kind) {
  const { data, evidence } = await ctx.fetch(url, { notFoundIsEmpty: true, headers: { Accept: 'application/rdap+json' } });
  const holder = networkHolder(data);
  const org = holder?.kind === 'organisation' ? holder.name : null;
  const range = data.startAddress && data.endAddress ? `${data.startAddress} – ${data.endAddress}` : data.handle;
  const created = eventDate(data, 'registration');

  if (kind === 'ip') {
    ctx.fact('Network', { label: 'Allocation', value: range, evidence, mono: true });
    if (data.name) ctx.fact('Network', { label: 'Net name', value: data.name, evidence, mono: true });
  } else {
    ctx.fact('Network', { label: 'AS name', value: data.name || data.handle, evidence, mono: true });
  }
  if (org) ctx.fact('Network', { label: 'Holder (RDAP)', value: org, evidence });
  if (holder?.kind === 'maintainer') ctx.fact('Network', { label: 'Maintainer', value: holder.name, evidence, mono: true });
  if (data.country) ctx.fact('Network', { label: 'Registry country', value: data.country, evidence });
  ctx.share(`rdap.${kind}.org`, org);

  ctx.finding({
    title: kind === 'ip' ? `${data.name || 'Network'} (${range})${org ? ` held by ${org}` : ''}` : `${data.handle} ${data.name || ''}${org ? ` · ${org}` : ''}`,
    detail: [created && `Registered with the RIR on ${fmtDate(created)}.`, 'Personal contact names in the record are not shown.'].filter(Boolean).join(' '),
    confidence: 'confirmed',
    evidence,
    date: created,
  });
}
