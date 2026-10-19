// Node server for local development, Docker and the desktop engine container. Serves /public with security
// headers and mounts the shared API (relay, username checks, favicons, fingerprint).
//   PORT, HOST              where to listen (default 127.0.0.1:5173)
//   INDIZIA_API_ONLY=1     API only, no static files (the desktop engine container)
//   INDIZIA_LOCAL=1        single-user install: higher rate limits
//   INDIZIA_TOOLBOX=1      enable the Docker toolbox (localhost only; needs the Docker CLI on this machine)
//   INDIZIA_AI=1           enable the local AI bridge to Ollama (localhost only; implied by INDIZIA_TOOLBOX=1)
//   OLLAMA_HOST             Ollama address (default http://127.0.0.1:11434)
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHandler } from './app.mjs';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const flag = (name) => process.env[name] === '1';

const localOnly = flag('INDIZIA_TOOLBOX') || flag('INDIZIA_AI');
if (localOnly && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  console.error('INDIZIA_TOOLBOX=1 and INDIZIA_AI=1 reach Docker or Ollama on this machine and are only allowed with HOST=127.0.0.1.');
  process.exit(1);
}

const handle = createHandler({
  root: ROOT,
  apiOnly: flag('INDIZIA_API_ONLY'),
  local: flag('INDIZIA_LOCAL') || flag('INDIZIA_TOOLBOX'),
  toolbox: flag('INDIZIA_TOOLBOX') ? { trusted: false } : null,
  ai: localOnly ? { trusted: false } : null,
});

function toRequest(req) {
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress || 'local');
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? 'half' : undefined });
}

createServer(async (req, res) => {
  let response;
  try {
    response = await handle(toRequest(req));
  } catch {
    response = new Response('Bad request', { status: 400 });
  }
  const headers = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(response.status, headers);
  res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
}).listen(PORT, HOST, () => console.log(`Indizia on http://${HOST}:${PORT}${flag('INDIZIA_TOOLBOX') ? ' · toolbox on' : ''}${localOnly ? ' · local AI bridge on' : ''}${flag('INDIZIA_API_ONLY') ? ' · API only' : ''}`));
