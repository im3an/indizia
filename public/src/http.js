// Network layer: every request produces an evidence record (URL, status, time, size, SHA-256, excerpt).

export class SourceError extends Error {
  /** @param {'rate_limited'|'failed'|'empty'|'needs_relay'|'timeout'} state */
  constructor(state, message, evidence) {
    super(message);
    this.state = state;
    this.evidence = evidence;
  }
}

let health = null;

/** Probe the optional API (relay, username checks, favicons) once. A static deployment has none. */
export async function apiHealth() {
  if (health) return health;
  health = (async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const data = r.ok ? await r.json() : null;
      return data?.ok ? data : { ok: false };
    } catch {
      return { ok: false };
    }
  })();
  return health;
}

export async function hasRelay() {
  return (await apiHealth()).ok === true;
}

async function sha256Hex(buf) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function excerpt(text, max = 6000) {
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    return pretty.length > max ? pretty.slice(0, max) + '\n…' : pretty;
  } catch {
    return text.length > max ? text.slice(0, max) + '\n…' : text;
  }
}

/**
 * Fetch JSON from a source.
 * @param {string} url
 * @param {{relay?:boolean, timeout?:number, signal?:AbortSignal, headers?:Record<string,string>, notFoundIsEmpty?:boolean, text?:boolean}} opts
 * @returns {Promise<{data:any, evidence:object}>}
 */
export async function fetchJson(url, opts = {}) {
  const { relay = false, timeout = 15000, signal, headers = {}, notFoundIsEmpty = false, method = 'GET', body, form, text: asText = false } = opts;
  if (relay && !(await hasRelay())) {
    throw new SourceError('needs_relay', 'This source sends no CORS headers. It needs the relay, which this deployment does not have.');
  }
  const requestUrl = relay ? `/api/relay?url=${encodeURIComponent(url)}` : url;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeout);
  const startedAt = new Date();

  let res;
  try {
    res = await fetch(requestUrl, {
      method,
      // A form body keeps cross-origin POSTs "simple" (no CORS preflight).
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: form ? new URLSearchParams(form) : body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const timedOut = ctrl.signal.aborted;
    throw new SourceError(
      timedOut ? 'timeout' : 'failed',
      timedOut ? `No answer within ${Math.round(timeout / 1000)} s` : 'Network error or blocked by the browser (CORS)',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const buf = await res.arrayBuffer();
  const text = decodeBody(buf, res.headers.get('content-type'), asText);
  const evidence = {
    url,
    method,
    viaRelay: relay,
    status: res.status,
    retrievedAt: startedAt.toISOString(),
    ms: Date.now() - startedAt.getTime(),
    bytes: buf.byteLength,
    sha256: await sha256Hex(buf),
    excerpt: excerpt(text),
  };

  if (res.status === 429) throw new SourceError('rate_limited', 'The source is rate-limiting requests (HTTP 429)', evidence);
  if (res.status === 404 && notFoundIsEmpty) throw new SourceError('empty', 'The source has no record for this input', evidence);
  if (res.status === 504 && relay) throw new SourceError('timeout', 'The source did not answer in time (via relay)', evidence);
  if (!res.ok) throw new SourceError('failed', `The source answered HTTP ${res.status}`, evidence);
  if (asText) return { data: text, evidence };

  try {
    return { data: JSON.parse(text), evidence };
  } catch {
    throw new SourceError('failed', 'The source returned something other than JSON', evidence);
  }
}

/** UTF-8, unless a text response declares another charset (old archived pages are often ISO-8859-1). */
function decodeBody(buf, contentType, sniff) {
  let label = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (!label && sniff) label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(buf.slice(0, 4096)))?.[1];
  try {
    return new TextDecoder(label || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder().decode(buf);
  }
}

/** Cache small, slow-changing reference files (e.g. IANA bootstrap) for the browser session. */
export async function cachedJson(key, url, ttlMs = 6 * 3600 * 1000) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  } catch {
    /* storage unavailable */
  }
  const { data } = await fetchJson(url, { timeout: 12000 });
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota or private mode */
  }
  return data;
}
