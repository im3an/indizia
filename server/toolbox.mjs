// Local toolbox: open-source recon tools that cannot run in a browser or on Workers, run on the user's own
// machine in throwaway Docker containers (desktop app, or `npm start` with INDIZIA_TOOLBOX=1).
// Images are pinned. Containers run as nobody, read-only, without capabilities, and are removed on exit.
// Only domain inputs are accepted, and tools that contact the target only accept that domain's own hosts.
import { docker, dockerInfo, HARDENING, imageId, imageSize, LABEL, pull, removeLabelled, resetDockerInfo } from './docker.mjs';

const DOMAIN_RE = /^(?=.{4,253}$)((?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;
const MAX_PARALLEL = 2;

const lines = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
function jsonLines(text) {
  const out = [];
  for (const l of lines(text)) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* partial line from a killed run */
    }
  }
  return out;
}

/**
 * Tool registry. `touchesTarget`: the tool sends requests to the target's own servers (everything else
 * only asks public data sources). `maxHosts`: how many hosts one run may take on stdin.
 */
export const TOOLS = {
  subfinder: {
    name: 'subfinder',
    vendor: 'ProjectDiscovery',
    image: 'projectdiscovery/subfinder:v2.17.0',
    homepage: 'https://github.com/projectdiscovery/subfinder',
    licence: 'MIT',
    summary: 'Passive subdomain discovery from about 50 public sources (certificate logs, archives, search engines, DNS datasets).',
    touchesTarget: false,
    approxMB: 20,
    timeoutMs: 180_000,
    args: ({ target }) => ['-d', target, '-silent', '-oJ', '-cs', '-duc', '-timeout', '20', '-max-time', '2'],
    parse(stdout, { target }) {
      const seen = new Map();
      for (const r of jsonLines(stdout)) {
        const host = String(r.host || '').toLowerCase().replace(/^\*\./, '');
        if (!DOMAIN_RE.test(host) || !(host === target || host.endsWith(`.${target}`))) continue;
        const cur = seen.get(host) || new Set();
        for (const s of r.sources || (r.source ? [r.source] : [])) cur.add(String(s));
        seen.set(host, cur);
      }
      return [...seen.entries()].map(([host, sources]) => ({ host, sources: [...sources].sort() })).sort((a, b) => a.host.localeCompare(b.host));
    },
  },
  dnsx: {
    name: 'dnsx',
    vendor: 'ProjectDiscovery',
    image: 'projectdiscovery/dnsx:v1.2.2',
    homepage: 'https://github.com/projectdiscovery/dnsx',
    licence: 'MIT',
    summary: 'Resolves discovered hostnames (A, AAAA, CNAME) through public resolvers, to separate live names from stale ones.',
    touchesTarget: false,
    approxMB: 25,
    timeoutMs: 120_000,
    maxHosts: 1000,
    args: () => ['-silent', '-json', '-a', '-aaaa', '-cname', '-duc', '-t', '20', '-retry', '2'],
    parse(stdout) {
      return jsonLines(stdout)
        .map((r) => ({ host: String(r.host || '').toLowerCase(), status: r.status_code || null, a: r.a || [], aaaa: r.aaaa || [], cname: r.cname || [] }))
        .filter((r) => DOMAIN_RE.test(r.host));
    },
  },
  httpx: {
    name: 'httpx',
    vendor: 'ProjectDiscovery',
    image: 'projectdiscovery/httpx:v1.12.0',
    homepage: 'https://github.com/projectdiscovery/httpx',
    licence: 'MIT',
    summary: 'Visits the homepage of each live host once (5 requests per second) and reads status, title, web server and technologies.',
    touchesTarget: true,
    approxMB: 275,
    timeoutMs: 240_000,
    maxHosts: 60,
    args: () => ['-silent', '-json', '-title', '-tech-detect', '-status-code', '-web-server', '-ip', '-cdn', '-duc', '-no-color', '-rl', '5', '-t', '5', '-timeout', '8', '-retries', '0'],
    parse(stdout) {
      return jsonLines(stdout).map((r) => ({
        url: r.url,
        host: String(r.input || r.host || '').toLowerCase(),
        status: r.status_code ?? null,
        title: r.title || '',
        webserver: r.webserver || '',
        tech: r.tech || [],
        ip: r.host_ip || (r.a || [])[0] || '',
        cdn: r.cdn_name || '',
        location: r.location || '',
      }));
    },
  },
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * For the TCP server only (the desktop app uses a private protocol nothing else can reach). Refuses
 * requests whose Host is not loopback (DNS rebinding), whose Origin is another site, or, for writes,
 * that lack the custom header a cross-site form or simple request cannot set.
 * @returns {Response|null} a refusal, or null when the request may proceed
 */
export function localGuard(request) {
  const url = new URL(request.url);
  if (!LOOPBACK.has(url.hostname)) return json({ error: 'the toolbox only answers on localhost' }, 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return json({ error: 'cross-origin request refused' }, 403);
  if (request.method !== 'GET' && request.headers.get('x-indizia-local') !== '1') return json({ error: 'missing X-Indizia-Local header' }, 403);
  return null;
}

let running = 0;
const waiting = [];
async function slot() {
  if (running < MAX_PARALLEL) {
    running++;
    return;
  }
  await new Promise((r) => waiting.push(r));
  running++;
}
function release() {
  running--;
  waiting.shift()?.();
}

/** Validate a run request. Returns { error } or { tool, target, hosts }. */
export function validateRun(body) {
  const tool = TOOLS[body?.tool] ? body.tool : null;
  if (!tool) return { error: `unknown tool; available: ${Object.keys(TOOLS).join(', ')}` };
  const target = String(body.target || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(target)) return { error: 'target must be a domain name' };
  const spec = TOOLS[tool];
  let hosts = [];
  if (spec.maxHosts) {
    hosts = [...new Set((Array.isArray(body.hosts) ? body.hosts : [target]).map((h) => String(h).trim().toLowerCase()))];
    // Tools that resolve or visit hosts stay inside the target domain: the toolbox is not a general scanner.
    hosts = hosts.filter((h) => DOMAIN_RE.test(h) && (h === target || h.endsWith(`.${target}`))).slice(0, spec.maxHosts);
    if (!hosts.length) return { error: 'no valid hosts inside the target domain' };
  }
  return { tool, target, hosts };
}

/** The exact `docker run` arguments for a run (also returned to the client as part of the evidence). */
export function runArgs(tool, { target }, name) {
  const spec = TOOLS[tool];
  return ['run', '--rm', '-i', '--name', name, ...HARDENING, '--label', `${LABEL}.tool=${tool}`, '--memory', '768m', '--cpus', '2', '--user', '65534:65534', '-e', 'HOME=/tmp', '--pull', 'never', spec.image, ...spec.args({ target })];
}

async function status() {
  const info = await dockerInfo();
  const tools = await Promise.all(
    Object.entries(TOOLS).map(async ([id, t]) => {
      const size = info.available ? await imageSize(t.image) : null;
      return { id, name: t.name, vendor: t.vendor, image: t.image, homepage: t.homepage, licence: t.licence, summary: t.summary, touchesTarget: t.touchesTarget, approxMB: t.approxMB, installed: size !== null, sizeMB: size ? Math.round(size / 1e6) : null };
    }),
  );
  return { docker: info, tools };
}

async function run(body) {
  const v = validateRun(body);
  if (v.error) return json({ error: v.error }, 400);
  const spec = TOOLS[v.tool];
  if (!(await dockerInfo()).available) return json({ error: 'Docker is not running' }, 503);
  const id = await imageId(spec.image);
  if (!id) return json({ error: `image ${spec.image} is not installed`, needsPull: true }, 409);

  await slot();
  const name = `indizia-${v.tool}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const args = runArgs(v.tool, v, name);
  const startedAt = new Date().toISOString();
  try {
    const r = await docker(args, { input: v.hosts.length ? `${v.hosts.join('\n')}\n` : undefined, timeoutMs: spec.timeoutMs, name });
    const results = spec.parse(r.stdout, v);
    if (r.code !== 0 && !results.length && !r.timedOut) return json({ error: `${spec.name} exited with code ${r.code}`, stderr: r.stderr.slice(-800) }, 502);
    return json({
      tool: v.tool,
      image: spec.image,
      imageId: id,
      command: ['docker', ...args],
      target: v.target,
      inputHosts: v.hosts.length,
      startedAt,
      ms: r.ms,
      exitCode: r.code,
      timedOut: r.timedOut,
      truncated: r.truncated,
      count: results.length,
      results,
    });
  } finally {
    release();
  }
}

/**
 * Toolbox routes. `opts.trusted` is true when requests can only come from Indizia itself (desktop
 * protocol); otherwise every request must pass localGuard().
 */
export async function handleToolbox(request, opts = {}) {
  if (!opts.trusted) {
    const refused = localGuard(request);
    if (refused) return refused;
  }
  const { pathname } = new URL(request.url);
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  if (pathname === '/api/toolbox' && request.method === 'GET') {
    if (new URL(request.url).searchParams.has('refresh')) resetDockerInfo();
    return json(await status());
  }
  if (pathname === '/api/toolbox/run' && request.method === 'POST') return run(body);
  if (pathname === '/api/toolbox/pull' && request.method === 'POST') {
    const spec = TOOLS[body.tool];
    if (!spec) return json({ error: 'unknown tool' }, 400);
    if (!(await dockerInfo()).available) return json({ error: 'Docker is not running' }, 503);
    const r = await pull(spec.image);
    return r.code === 0 ? json({ ok: true, image: spec.image, ms: r.ms }) : json({ error: 'pull failed', stderr: r.stderr.slice(-800) }, 502);
  }
  if (pathname === '/api/toolbox/clean' && request.method === 'POST') {
    if (!(await dockerInfo()).available) return json({ error: 'Docker is not running' }, 503);
    const containers = await removeLabelled();
    const images = [];
    if (body.images) {
      for (const t of Object.values(TOOLS)) {
        const r = await docker(['image', 'rm', t.image], { timeoutMs: 60_000 });
        if (r.code === 0) images.push(t.image);
      }
    }
    return json({ ok: true, containers, images });
  }
  return json({ error: 'not found' }, 404);
}
