// Platform-neutral API (Web Fetch Request/Response). Used by the Node server and the Cloudflare Worker.
// Stateless. Query content is never logged.
import wmn from './data/wmn-data.json' with { type: 'json' };
import { USERNAME_RE, checkSite, siteId } from './username.mjs';
import { fingerprint } from './fingerprint.mjs';

const USER_AGENT = 'Indizia/0.4 (non-commercial OSINT research; +https://github.com/im3an/indizia)';

/** Hosts the relay may contact: permitted sources that send no CORS headers. */
export const RELAY_ALLOWLIST = new Set(['crt.sh', 'web.archive.org', 'rdap.denic.de', 'hashlookup.circl.lu', 'api.gdeltproject.org', 'api.ted.europa.eu', 'urlscan.io', 'www.cisa.gov']);
/** Hosts whose search API needs a JSON POST. */
const RELAY_POST = new Set(['api.ted.europa.eu']);
const MAX_POST_BYTES = 16_000;
const RELAY_TIMEOUT_MS = 25_000;
const MAX_RELAY_BYTES = 8 * 1024 * 1024;
const MAX_BATCH = 25; // stays below the 50-subrequest limit of the Workers free plan

const SITES = wmn.sites;
const SITE_BY_ID = new Map(SITES.map((s) => [siteId(s), s]));

// Per-instance rate limiting, always on. On Cloudflare the Worker also passes platform limiters (wrangler.toml
// [[ratelimits]]), which share the count across all instances in a location.
const buckets = new Map();
function allowShared(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) {
    b.n = 0;
    b.reset = now + windowMs;
  }
  b.n++;
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return b.n <= limit;
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });

function clientKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
}

async function relay(request, url) {
  let target;
  try {
    target = new URL(url.searchParams.get('url'));
  } catch {
    return json({ error: 'invalid url' }, 400);
  }
  if (target.protocol !== 'https:' || !RELAY_ALLOWLIST.has(target.hostname)) return json({ error: 'host not on relay allowlist' }, 403);
  const isPost = request.method === 'POST';
  if (isPost && !RELAY_POST.has(target.hostname)) return json({ error: 'POST not allowed for this host' }, 405);
  let payload;
  if (isPost) {
    payload = await request.text();
    if (payload.length > MAX_POST_BYTES) return json({ error: 'request too large' }, 413);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RELAY_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: isPost ? 'POST' : 'GET',
      body: payload,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/rdap+json;q=0.9, */*;q=0.1', ...(isPost ? { 'Content-Type': 'application/json' } : {}) },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_RELAY_BYTES) return json({ error: 'upstream response too large' }, 502);
    return new Response(buf, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Indizia-Relay': '1' },
    });
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    return json({ error: timedOut ? 'upstream timeout' : 'upstream unreachable' }, timedOut ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}

async function usernameCheck(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON body' }, 400);
  }
  const username = String(body.username || '').trim();
  if (!USERNAME_RE.test(username)) return json({ error: 'invalid username' }, 400);
  const ids = Array.isArray(body.sites) ? body.sites.slice(0, MAX_BATCH) : [];
  const sites = ids.map((id) => SITE_BY_ID.get(id)).filter(Boolean);
  const results = await Promise.all(sites.map((s) => checkSite(s, username)));
  return json({ username, results });
}

const iconCache = new Map();
async function icon(url) {
  const host = (url.searchParams.get('host') || '').toLowerCase();
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || !host.includes('.')) return new Response(null, { status: 400 });
  const cached = iconCache.get(host);
  const headers = { 'Cache-Control': 'public, max-age=604800, immutable' };
  if (cached) return new Response(cached.buf, { headers: { ...headers, 'Content-Type': cached.type } });
  try {
    // DuckDuckGo's icon service: no tracking cookies, and the request comes from the server, not the user.
    const res = await fetch(`https://icons.duckduckgo.com/ip3/${host}.ico`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return new Response(null, { status: 404, headers });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 200_000) return new Response(null, { status: 404, headers });
    const type = res.headers.get('content-type') || 'image/x-icon';
    if (iconCache.size > 2000) iconCache.clear();
    iconCache.set(host, { buf, type });
    return new Response(buf, { headers: { ...headers, 'Content-Type': type } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** @returns {Promise<Response|null>} null when the path is not an API route. */
export async function handleApi(request, { rateScale = 1, limiters = {} } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  const key = clientKey(request);
  // A single-user install (desktop app, local server) can afford higher limits than a shared deployment.
  const allow = async (name, limit, windowMs) => {
    if (!allowShared(`${name}:${key}`, limit * rateScale, windowMs)) return false;
    // A platform limiter that errors fails open: the per-instance limit above still applies.
    const platform = limiters[name];
    return platform ? (await platform.limit({ key }).catch(() => ({ success: true }))).success : true;
  };

  if (url.pathname === '/api/health') {
    return json({ ok: true, relay: [...RELAY_ALLOWLIST], usernameSites: SITES.length, fingerprint: true });
  }
  if (url.pathname === '/api/relay' && (request.method === 'GET' || request.method === 'POST')) {
    if (!(await allow('relay', 120, 60_000))) return json({ error: 'rate limited' }, 429);
    return relay(request, url);
  }
  if (url.pathname === '/api/username/sites' && request.method === 'GET') {
    return json(
      { license: wmn.license, source: wmn.source, excludedCategories: wmn.excludedCategories, sites: SITES.map((s) => ({ id: siteId(s), name: s.name, cat: s.cat })) },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    );
  }
  if (url.pathname === '/api/username/check' && request.method === 'POST') {
    // About 25 batches make one full sweep, so this allows roughly three sweeps per minute per client.
    if (!(await allow('username', 75, 60_000))) return json({ error: 'rate limited' }, 429);
    return usernameCheck(request);
  }
  if (url.pathname === '/api/fingerprint' && request.method === 'GET') {
    // One homepage fetch per call; a domain investigation makes one call.
    if (!(await allow('fingerprint', 20, 60_000))) return json({ error: 'rate limited' }, 429);
    const { status, body } = await fingerprint(url, USER_AGENT);
    return json(body, status);
  }
  if (url.pathname === '/api/icon' && request.method === 'GET') {
    if (!(await allow('icon', 400, 60_000))) return new Response(null, { status: 429 });
    return icon(url);
  }
  return json({ error: 'not found' }, 404);
}
