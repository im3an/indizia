// Local toolbox (desktop app, or a local server with INDIZIA_TOOLBOX=1): ProjectDiscovery subfinder, dnsx
// and, if switched on, httpx, each in a throwaway Docker container on the user's machine. subfinder and dnsx
// only ask public sources and resolvers; httpx visits each live host's homepage once and is off by default.
// The source only exists where the API reports a toolbox, so the hosted web version never lists it.

import { SourceError, apiHealth } from '../http.js';
import { getSetting } from '../settings.js';

let available = false;
apiHealth().then((h) => (available = !!h.toolbox));

const LOCAL = { 'X-Indizia-Local': '1' };

/** Toolbox status (Docker, installed images). Not evidence, so it bypasses ctx.fetch. */
export async function toolboxStatus(refresh = false) {
  const r = await fetch(`/api/toolbox${refresh ? '?refresh=1' : ''}`, { cache: 'no-store', headers: LOCAL });
  if (!r.ok) throw new Error(`toolbox answered HTTP ${r.status}`);
  return r.json();
}

export async function installTool(id) {
  const r = await fetch('/api/toolbox/pull', { method: 'POST', headers: { ...LOCAL, 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: id }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

export async function cleanToolbox(images = false) {
  const r = await fetch('/api/toolbox/clean', { method: 'POST', headers: { ...LOCAL, 'Content-Type': 'application/json' }, body: JSON.stringify({ images }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

const errorOf = (err) => /"error"\s*:\s*"([^"]+)"/.exec(err.evidence?.excerpt || '')?.[1];

export const toolbox = {
  id: 'toolbox',
  name: 'Deep subdomain scan (local toolbox)',
  provider: 'ProjectDiscovery subfinder · dnsx · httpx, in Docker on this computer',
  homepage: 'https://github.com/projectdiscovery',
  terms: 'https://github.com/projectdiscovery/subfinder/blob/main/LICENSE.md',
  licence: 'MIT-licensed tools; results come from the public sources each tool queries',
  category: 'Domain & DNS',
  accepts: ['domain'],
  cors: true,
  desktopOnly: true,
  when: () => available && getSetting('toolbox') !== false,

  async run(ctx) {
    try {
      return await scan(ctx);
    } finally {
      ctx.progress('');
    }
  },
};

async function scan(ctx) {
  const domain = ctx.entity.value;
  let status;
  try {
    status = await toolboxStatus();
  } catch {
    throw new SourceError('failed', 'The local toolbox did not answer');
  }
  if (!status.docker.available) throw new SourceError('skipped', `${status.docker.reason}. Start Docker to run subfinder and dnsx.`);
  const probe = getSetting('toolboxProbe') === true;
  const wanted = ['subfinder', 'dnsx', ...(probe ? ['httpx'] : [])];
  for (const id of wanted) {
    const t = status.tools.find((x) => x.id === id);
    if (t && !t.installed) {
      ctx.progress(`Installing ${t.name} (about ${t.approxMB} MB download, first run only)`);
      await installTool(id).catch((e) => {
        throw new SourceError('failed', `Could not download ${t.image}: ${e.message}`);
      });
    }
  }

  const call = async (tool, payload, timeout) => {
    try {
      return await ctx.fetch(`/api/toolbox/run?tool=${tool}`, { method: 'POST', body: { tool, target: domain, ...payload }, headers: LOCAL, timeout });
    } catch (err) {
      const msg = errorOf(err);
      if (msg) err.message = `${tool}: ${msg}`;
      throw err;
    }
  };

  ctx.progress('subfinder: asking public sources');
  const { data: sf, evidence: sfEv } = await call('subfinder', {}, 200_000);
  const g = 'Local toolbox';
  if (!sf.results.length) return ctx.note('subfinder found no subdomains');
  const bySource = new Map();
  for (const r of sf.results) for (const s of r.sources) bySource.set(s, (bySource.get(s) || 0) + 1);
  ctx.fact(g, { label: 'Subdomains found', value: String(sf.results.length), evidence: sfEv });
  ctx.fact(g, { label: 'Sources that listed them', value: String(bySource.size), evidence: sfEv });
  const sfFinding = ctx.finding({
    title: `${sf.results.length} subdomains listed by ${bySource.size} public sources`,
    detail: `subfinder ${sf.image.split(':')[1]} ran in a container on this computer${sf.timedOut ? ' and hit its time limit, so the list may be incomplete' : ''}. Top sources: ${[...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `${s} (${n})`).join(', ')}.`,
    confidence: 'confirmed',
    confidenceNote: 'Names published by public sources. Many may no longer exist; dnsx checks which still resolve.',
    evidence: sfEv,
    list: sf.results.slice(0, 150).map((r) => `${r.host}  ·  ${r.sources.join(', ')}`),
    listLabel: sf.results.length > 150 ? `First 150 of ${sf.results.length} names` : `${sf.results.length} names`,
  });
  ctx.share('toolbox.subdomains', sf.results.map((r) => r.host));

  if (getSetting('toolboxResolve') === false) return;
  ctx.progress(`dnsx: resolving ${Math.min(sf.results.length, 1000)} names`);
  const { data: dx, evidence: dxEv } = await call('dnsx', { hosts: sf.results.map((r) => r.host) }, 150_000);
  const live = dx.results.filter((r) => r.a.length || r.aaaa.length || r.cname.length);
  const byIp = new Map();
  for (const r of live) for (const ip of [...r.a, ...r.aaaa]) byIp.set(ip, [...(byIp.get(ip) || []), r.host]);
  ctx.fact(g, { label: 'Names that resolve today', value: `${live.length} of ${sf.results.length}`, evidence: dxEv });
  ctx.fact(g, { label: 'Distinct addresses', value: String(byIp.size), evidence: dxEv });
  ctx.update(sfFinding, { detail: `${sfFinding.detail} ${live.length} of them resolve today.` });
  if (!live.length) return ctx.note('None of the discovered names resolve today');
  for (const r of live.slice(0, 30)) {
    if (r.host !== domain) ctx.relate(ctx.entity, { type: 'domain', value: r.host }, 'subdomain');
    for (const ip of r.a.slice(0, 2)) ctx.relate({ type: 'domain', value: r.host }, { type: 'ip', value: ip }, 'resolves to');
  }
  const busiest = [...byIp.entries()].sort((a, b) => b[1].length - a[1].length);
  ctx.finding({
    title: `${live.length} subdomains resolve to ${byIp.size} addresses`,
    detail: `Checked with dnsx ${dx.image.split(':')[1]} through public resolvers. ${sf.results.length - live.length} listed names no longer resolve.${busiest[0]?.[1].length > 1 ? ` Busiest address: ${busiest[0][0]} with ${busiest[0][1].length} names.` : ''}`,
    confidence: 'confirmed',
    evidence: dxEv,
    list: live.slice(0, 150).map((r) => `${r.host}  →  ${[...r.cname.map((c) => `CNAME ${c}`), ...r.a, ...r.aaaa].join(', ')}`),
    listLabel: live.length > 150 ? `First 150 of ${live.length} live names` : `${live.length} live names`,
    pivots: busiest.slice(0, 3).map(([ip]) => ({ type: 'ip', value: ip })),
  });

  if (!probe) return;
  const hosts = live.filter((r) => r.a.length || r.aaaa.length).map((r) => r.host).slice(0, 60);
  ctx.progress(`httpx: visiting ${hosts.length} homepages`);
  const { data: hx, evidence: hxEv } = await call('httpx', { hosts }, 260_000);
  if (!hx.results.length) return ctx.note('httpx: no host answered on HTTP or HTTPS');
  const tech = new Map();
  for (const r of hx.results) for (const t of r.tech) tech.set(t, (tech.get(t) || 0) + 1);
  ctx.fact(g, { label: 'Live web servers', value: String(hx.results.length), evidence: hxEv });
  ctx.finding({
    title: `${hx.results.length} live web servers on ${hosts.length} hosts`,
    detail: `httpx ${hx.image.split(':')[1]} requested each homepage once from this computer.${tech.size ? ` Most common technologies: ${[...tech.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${t} (${n})`).join(', ')}.` : ''}`,
    confidence: 'confirmed',
    confidenceNote: 'Direct observation from this computer',
    evidence: hxEv,
    list: hx.results.map((r) => `${r.status ?? '—'}  ${r.url}${r.title ? `  “${r.title}”` : ''}${r.webserver ? `  [${r.webserver}]` : ''}${r.tech.length ? `  ${r.tech.slice(0, 4).join(', ')}` : ''}`),
    listLabel: `${hx.results.length} answering hosts`,
  });
}
