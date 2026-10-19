// Username presence checks using WhatsMyName definitions (CC BY-SA 4.0, © Micah Hoffman).
// The server builds every URL itself from the bundled definitions, so this endpoint cannot be used as an open proxy.

export const USERNAME_RE = /^[\w.-]{2,40}$/;
const MAX_BODY = 300_000;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; Indizia/0.4; OSINT research; +https://github.com/im3an/indizia)';

export function siteId(site) {
  return site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function profileUrl(site, username) {
  const account = site.strip_bad_char ? username.split(site.strip_bad_char).join('') : username;
  return {
    check: site.uri_check.replaceAll('{account}', encodeURIComponent(account)),
    pretty: (site.uri_pretty || site.uri_check).replaceAll('{account}', encodeURIComponent(account)),
  };
}

/**
 * Apply the WhatsMyName rule: found = expected code + expected string; missing = missing code or string.
 * @returns {'found'|'missing'|'unknown'}
 */
export function evaluate(site, status, body) {
  const hasE = site.e_string ? body.includes(site.e_string) : true;
  const hasM = site.m_string ? body.includes(site.m_string) : true;
  if (status === site.e_code && hasE) return 'found';
  if (status === site.m_code && hasM) return 'missing';
  return 'unknown';
}

async function readCapped(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}

export async function checkSite(site, username) {
  const { check, pretty } = profileUrl(site, username);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(check, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...(site.headers || {}) },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const body = await readCapped(res);
    return { id: siteId(site), name: site.name, cat: site.cat, url: pretty, status: evaluate(site, res.status, body), http: res.status, ms: Date.now() - started };
  } catch {
    return { id: siteId(site), name: site.name, cat: site.cat, url: pretty, status: 'unknown', http: 0, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
