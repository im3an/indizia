// Indizia app handler (Web Fetch API in, Response out): static files from public/, the shared API, and
// the optional local-only parts (Docker toolbox, isolated engine). One handler serves three hosts:
// the Node server (server/node.mjs), the desktop app's private sherlock:// protocol (desktop/main.mjs),
// and, for the API part only, the Cloudflare Worker (worker/index.mjs calls handleApi directly).
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { handleApi } from './api.mjs';
import { SECURITY_HEADERS } from './headers.mjs';
import { handleToolbox, localGuard } from './toolbox.mjs';
import { handleAi } from './ai.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

/** Routes that run on the engine (they contact the internet); everything else stays in this process. */
const ENGINE_ROUTES = /^\/api\/(relay|username\/|fingerprint|icon)/;

function withHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function serveStatic(root, pathname) {
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  let file = join(root, rel);
  if (file !== root.replace(/[/\\]$/, '') && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return new Response('Forbidden', { status: 403 });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html'); // app shell for deep links
  }
  try {
    const body = await readFile(file);
    const ext = extname(file);
    const cache = ext === '.woff2' || file.includes(`${sep}vendor${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return new Response(body, { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/** Forward an API request to the engine container, keeping method, body and content type. */
async function forward(request, base) {
  const url = new URL(request.url);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const res = await fetch(new URL(url.pathname + url.search, base), {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('content-type') || 'application/json' },
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    return new Response(await res.arrayBuffer(), { status: res.status, headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': res.headers.get('cache-control') || 'no-store' } });
  } catch {
    return json({ error: 'engine unavailable' }, 502);
  }
}

/**
 * @param {object} o
 * @param {string} o.root           absolute path of public/ (ignored when apiOnly)
 * @param {boolean} [o.apiOnly]      serve the API only (engine container)
 * @param {boolean} [o.local]        single-user install: relaxed rate limits
 * @param {object|null} [o.toolbox]  enable the Docker toolbox: { trusted?: boolean } (trusted = private protocol, no TCP)
 * @param {object|null} [o.ai]       enable the local AI bridge (Ollama): { trusted?: boolean }
 * @param {object|null} [o.engine]   desktop engine controller: { upstream(): string|null, status(): object, ready?(ms), setMode?(m) }
 * @param {object|null} [o.desktop]  desktop app info for /api/health: { version, platform }
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler({ root, apiOnly = false, local = false, toolbox = null, ai = null, engine = null, desktop = null }) {
  const apiOpts = { rateScale: local ? 10 : 1 };
  return async function handle(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path.startsWith('/api/toolbox')) {
        if (!toolbox) return json({ error: 'not found' }, 404);
        return withHeaders(await handleToolbox(request, toolbox));
      }
      if (path.startsWith('/api/ai/')) {
        if (!ai) return json({ error: 'not found' }, 404);
        return withHeaders(await handleAi(request, ai));
      }
      if (path === '/api/engine') {
        if (!engine) return json({ error: 'not found' }, 404);
        if (request.method === 'POST' && engine.setMode) {
          const refused = toolbox?.trusted ? null : localGuard(request);
          if (refused) return withHeaders(refused);
          const { mode } = await request.json().catch(() => ({}));
          if (!['container', 'builtin'].includes(mode)) return json({ error: 'mode must be container or builtin' }, 400);
          await engine.setMode(mode);
        }
        return withHeaders(json(engine.status()));
      }
      if (path === '/api/health') {
        const base = await (await handleApi(request, apiOpts)).json();
        const upstream = engine?.upstream();
        if (upstream) {
          const remote = await forward(request, upstream);
          if (remote.ok) Object.assign(base, await remote.json());
        }
        return withHeaders(json({ ...base, engine: engine ? engine.status() : { mode: 'built-in' }, toolbox: !!toolbox, ai: !!ai, desktop }));
      }
      if (path.startsWith('/api/')) {
        if (engine && ENGINE_ROUTES.test(path)) {
          // While the chosen container is still starting, wait for it rather than sending the request from
          // the app. If it failed to start, the built-in engine answers and Settings shows why.
          if (['starting', 'building'].includes(engine.status().state)) await engine.ready?.(30_000);
          const upstream = engine.upstream();
          if (upstream) return withHeaders(await forward(request, upstream));
        }
        return withHeaders(await handleApi(request, apiOpts));
      }
      if (apiOnly) return withHeaders(new Response('Not found', { status: 404 }));
      if (request.method !== 'GET' && request.method !== 'HEAD') return withHeaders(new Response('Method not allowed', { status: 405 }));
      const res = await serveStatic(root, path);
      // Mark pages served inside the desktop app, so CSS can drop web-only parts (the download button) before first paint.
      if (desktop && res.headers.get('content-type')?.startsWith('text/html')) {
        const html = (await res.text()).replace(/<html([^>]*)>/i, `<html$1 data-desktop="${desktop.platform}">`);
        return withHeaders(new Response(html, { status: res.status, headers: res.headers }));
      }
      return withHeaders(res);
    } catch (err) {
      console.error(err);
      return withHeaders(new Response('Internal error', { status: 500 }));
    }
  };
}
