// Website fingerprint: fetch one public homepage (like a browser visit, from the server, not the user),
// then derive technologies, security headers, analytics/tracking IDs and the site's own social links.
// SSRF guard: the host must be a domain name whose every A/AAAA record is a public address, re-checked on
// each redirect. Nothing is stored and the page body is never returned, only what is derived from it.
import { isPrivateIp } from '../public/src/hosting.js';

const MAX_BYTES = 600_000; // keeps the regex pass inside the Workers free-plan CPU budget
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;
const DOMAIN_RE = /^(?=.{4,253}$)((?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;

/** [name, category, test(ctx) → true | version string | falsy]. ctx: { h: headers(lowercase), c: cookie names, html } */
const SIGNATURES = [
  // Servers and edges
  ['nginx', 'Web server', (x) => ver(x.h.server, /nginx\/?([\d.]+)?/i)],
  ['Apache', 'Web server', (x) => ver(x.h.server, /apache\/?([\d.]+)?/i)],
  ['Microsoft IIS', 'Web server', (x) => ver(x.h.server, /microsoft-iis\/?([\d.]+)?/i)],
  ['LiteSpeed', 'Web server', (x) => /litespeed/i.test(x.h.server)],
  ['OpenResty', 'Web server', (x) => /openresty/i.test(x.h.server)],
  ['Caddy', 'Web server', (x) => /caddy/i.test(x.h.server)],
  ['Envoy', 'Web server', (x) => /envoy/i.test(x.h.server) || !!x.h['x-envoy-upstream-service-time']],
  ['Cloudflare', 'CDN', (x) => !!x.h['cf-ray'] || /cloudflare/i.test(x.h.server)],
  ['Amazon CloudFront', 'CDN', (x) => !!x.h['x-amz-cf-id'] || /cloudfront/i.test(x.h.via || '')],
  ['Fastly', 'CDN', (x) => /fastly/i.test(x.h['x-served-by'] || '') || !!x.h['x-fastly-request-id']],
  ['Akamai', 'CDN', (x) => /akamai/i.test(x.h.server || '') || !!x.h['x-akamai-transformed']],
  ['Varnish', 'Cache', (x) => /varnish/i.test(x.h.via || '') || !!x.h['x-varnish']],
  ['Vercel', 'Hosting', (x) => !!x.h['x-vercel-id']],
  ['Netlify', 'Hosting', (x) => !!x.h['x-nf-request-id'] || /netlify/i.test(x.h.server)],
  ['GitHub Pages', 'Hosting', (x) => !!x.h['x-github-request-id'] && /github/i.test(x.h.server)],
  ['Amazon S3', 'Hosting', (x) => /amazons3/i.test(x.h.server)],
  // Languages and frameworks
  ['PHP', 'Language', (x) => ver(x.h['x-powered-by'], /php\/?([\d.]+)?/i) || x.c.has('PHPSESSID')],
  ['ASP.NET', 'Framework', (x) => ver(x.h['x-aspnet-version'] || (/asp\.net/i.test(x.h['x-powered-by']) && 'asp.net'), /([\d.]+)/) || x.c.has('ASP.NET_SessionId')],
  ['Java', 'Language', (x) => x.c.has('JSESSIONID')],
  ['Express', 'Framework', (x) => /express/i.test(x.h['x-powered-by'])],
  ['Laravel', 'Framework', (x) => x.c.has('laravel_session') || x.c.has('XSRF-TOKEN') && /laravel/i.test(x.html.slice(0, 50000))],
  ['Django', 'Framework', (x) => x.c.has('csrftoken') && x.c.has('sessionid')],
  ['Ruby on Rails', 'Framework', (x) => [...x.c].some((c) => /_session$/.test(c)) && /csrf-param.*authenticity_token/i.test(x.html)],
  ['Next.js', 'Framework', (x) => /next\.js/i.test(x.h['x-powered-by']) || x.html.includes('__NEXT_DATA__') || x.html.includes('/_next/static/')],
  ['Nuxt', 'Framework', (x) => x.html.includes('__NUXT__') || x.html.includes('/_nuxt/')],
  ['Gatsby', 'Framework', (x) => x.html.includes('___gatsby')],
  ['Angular', 'JavaScript framework', (x) => ver(x.html, /ng-version="([\d.]+)"/)],
  ['React', 'JavaScript framework', (x) => /data-reactroot|react-dom(\.production)?(\.min)?\.js|__REACT_DEVTOOLS/i.test(x.html)],
  ['Vue.js', 'JavaScript framework', (x) => /\sdata-v-[0-9a-f]{6,}|vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js/i.test(x.html)],
  ['jQuery', 'JavaScript library', (x) => ver(x.html, /jquery[.-]?([\d.]+)?(\.min)?\.js/i)],
  ['Bootstrap', 'UI framework', (x) => ver(x.html, /bootstrap(?:@|[.-])?([\d.]+)?(\.bundle)?(\.min)?\.(?:css|js)/i)],
  // CMS, shops and site builders
  ['WordPress', 'CMS', (x) => ver(x.meta.generator, /wordpress\s?([\d.]+)?/i) || /\/wp-(content|includes)\//.test(x.html)],
  ['WooCommerce', 'E-commerce', (x) => /woocommerce/i.test(x.html)],
  ['Elementor', 'Page builder', (x) => /elementor/i.test(x.html)],
  ['Drupal', 'CMS', (x) => ver(x.meta.generator, /drupal\s?([\d.]+)?/i) || !!x.h['x-drupal-cache'] || /\/sites\/default\/files\//.test(x.html)],
  ['Joomla', 'CMS', (x) => ver(x.meta.generator, /joomla!?\s?([\d.]+)?/i)],
  ['TYPO3', 'CMS', (x) => ver(x.meta.generator, /typo3\s?(?:cms\s)?([\d.]+)?/i) || /typo3conf|typo3temp/.test(x.html)],
  ['Contao', 'CMS', (x) => /contao/i.test(x.meta.generator || '')],
  ['Ghost', 'CMS', (x) => ver(x.meta.generator, /ghost\s?([\d.]+)?/i)],
  ['Hugo', 'Static site generator', (x) => ver(x.meta.generator, /hugo\s?([\d.]+)?/i)],
  ['Adobe Experience Manager', 'CMS', (x) => /\/etc\.clientlibs\/|\/content\/dam\//.test(x.html)],
  ['Sitecore', 'CMS', (x) => x.c.has('SC_ANALYTICS_GLOBAL_COOKIE') || /\/-\/media\//.test(x.html)],
  ['Shopify', 'E-commerce', (x) => !!x.h['x-shopify-stage'] || x.html.includes('cdn.shopify.com')],
  ['Magento', 'E-commerce', (x) => /Mage\.Cookies|\/static\/version\d+\/frontend\//.test(x.html)],
  ['Shopware', 'E-commerce', (x) => /shopware/i.test(x.html.slice(0, 200000))],
  ['PrestaShop', 'E-commerce', (x) => /prestashop/i.test(x.meta.generator || '') || x.c.has('PrestaShop')],
  ['Wix', 'Site builder', (x) => !!x.h['x-wix-request-id'] || /static\.wixstatic\.com/.test(x.html)],
  ['Squarespace', 'Site builder', (x) => /squarespace/i.test(x.html.slice(0, 200000))],
  ['Webflow', 'Site builder', (x) => /webflow/i.test(x.meta.generator || '') || x.html.includes('data-wf-page')],
  // Consent, analytics, marketing, support
  ['Cookiebot', 'Consent', (x) => x.html.includes('consent.cookiebot.com')],
  ['Usercentrics', 'Consent', (x) => /usercentrics\.eu/.test(x.html)],
  ['OneTrust', 'Consent', (x) => /cdn\.cookielaw\.org|onetrust/i.test(x.html)],
  ['Borlabs Cookie', 'Consent', (x) => /borlabs-cookie/i.test(x.html)],
  ['Google Tag Manager', 'Tag manager', (x) => /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(x.html)],
  ['Google Analytics', 'Analytics', (x) => /google-analytics\.com|gtag\/js\?id=(G|UA)-|['"](UA-\d{4,10}-\d{1,4}|G-[A-Z0-9]{6,12})['"]/.test(x.html)],
  ['Matomo', 'Analytics', (x) => /matomo|piwik/i.test(x.html)],
  ['Plausible', 'Analytics', (x) => /plausible\.io\/js/.test(x.html)],
  ['etracker', 'Analytics', (x) => /etracker\.(com|de)/.test(x.html)],
  ['Hotjar', 'Analytics', (x) => /static\.hotjar\.com|hjid:/.test(x.html)],
  ['Microsoft Clarity', 'Analytics', (x) => /clarity\.ms\/tag/.test(x.html)],
  ['Yandex Metrica', 'Analytics', (x) => /mc\.yandex\.ru\/metrika/.test(x.html)],
  ['Meta Pixel', 'Advertising', (x) => /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(['"]init/.test(x.html)],
  ['LinkedIn Insight', 'Advertising', (x) => /snap\.licdn\.com|_linkedin_partner_id/.test(x.html)],
  ['TikTok Pixel', 'Advertising', (x) => /analytics\.tiktok\.com/.test(x.html)],
  ['Google AdSense', 'Advertising', (x) => /pagead2\.googlesyndication\.com|ca-pub-\d{10,}/.test(x.html)],
  ['HubSpot', 'Marketing', (x) => /js\.hs-scripts\.com|js\.hsforms\.net/.test(x.html)],
  ['Intercom', 'Support', (x) => /widget\.intercom\.io|intercomSettings/.test(x.html)],
  ['Zendesk', 'Support', (x) => /static\.zdassets\.com/.test(x.html)],
  ['Sentry', 'Monitoring', (x) => /browser\.sentry-cdn\.com|sentry\.io\/api/.test(x.html)],
  ['New Relic', 'Monitoring', (x) => /js-agent\.newrelic\.com|NREUM/.test(x.html)],
  ['Stripe', 'Payments', (x) => /js\.stripe\.com/.test(x.html)],
  ['PayPal', 'Payments', (x) => /paypal\.com\/sdk\/js|paypalobjects\.com/.test(x.html)],
  ['reCAPTCHA', 'Security', (x) => /google\.com\/recaptcha|recaptcha\/api\.js/.test(x.html)],
  ['hCaptcha', 'Security', (x) => /hcaptcha\.com\/1\/api\.js/.test(x.html)],
  ['Cloudflare Turnstile', 'Security', (x) => /challenges\.cloudflare\.com\/turnstile/.test(x.html)],
  ['Google Fonts', 'Fonts', (x) => /fonts\.googleapis\.com/.test(x.html)],
  ['Adobe Fonts', 'Fonts', (x) => /use\.typekit\.net/.test(x.html)],
  ['Font Awesome', 'Fonts', (x) => /font-?awesome/i.test(x.html)],
];

/** Tracking IDs. The same ID on two sites is a strong signal of a shared operator. */
const TRACKERS = [
  ['Google Analytics (UA)', /['"=\s](UA-\d{4,10})-\d{1,4}\b/g, (m) => m[1]],
  ['Google Analytics 4', /\b(G-[A-Z0-9]{8,12})\b/g, (m) => m[1]],
  ['Google Tag Manager', /\b(GTM-[A-Z0-9]{4,9})\b/g, (m) => m[1]],
  ['Google AdSense', /\b(ca-pub-\d{10,20})\b/g, (m) => m[1]],
  ['Meta Pixel', /fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g, (m) => m[1]],
  ['Hotjar', /hjid\s*:\s*(\d{5,10})/g, (m) => m[1]],
  ['HubSpot', /js\.hs-scripts\.com\/(\d{4,10})\.js/g, (m) => m[1]],
  ['Yandex Metrica', /ym\(\s*(\d{6,10})\s*,\s*['"]init/g, (m) => m[1]],
  ['Microsoft Clarity', /clarity\.ms\/tag\/([a-z0-9]{8,12})/g, (m) => m[1]],
  ['LinkedIn Insight', /_linkedin_partner_id\s*=\s*['"]?(\d{4,10})/g, (m) => m[1]],
];

/** The site's own links to its social presences (organisation accounts it publishes itself). */
const SOCIAL = [
  ['X / Twitter', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|hashtag|i\/)([A-Za-z0-9_]{1,15})(?=["'/?#])/g],
  ['LinkedIn', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company|school|showcase)\/([A-Za-z0-9_.-]{2,100})(?=["'/?#])/g],
  ['GitHub', /https?:\/\/github\.com\/(?!sponsors|features|about|login|orgs\/)([A-Za-z0-9-]{1,39})(?=["'/?#])/g],
  ['Facebook', /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|groups\/)([A-Za-z0-9.]{3,80})(?=["'/?#])/g],
  ['Instagram', /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|reel)([A-Za-z0-9_.]{2,30})(?=["'/?#])/g],
  ['YouTube', /https?:\/\/(?:www\.)?youtube\.com\/(@[A-Za-z0-9_.-]{2,60}|channel\/[A-Za-z0-9_-]{10,40}|c\/[A-Za-z0-9_-]{2,60}|user\/[A-Za-z0-9_-]{2,60})(?=["'/?#])/g],
  ['Xing', /https?:\/\/(?:www\.)?xing\.com\/(?:pages|companies)\/([A-Za-z0-9_-]{2,80})(?=["'/?#])/g],
];

function ver(text, re) {
  if (!text) return false;
  const m = re.exec(String(text));
  if (!m) return false;
  return m[1] && /\d/.test(m[1]) ? m[1] : true;
}

/** Resolve a host with DNS over HTTPS and require that every address is public. */
async function publicAddresses(host) {
  const out = [];
  for (const type of ['A', 'AAAA']) {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, { headers: { Accept: 'application/dns-json' } });
    const d = await r.json();
    for (const a of d.Answer || []) if (a.type === (type === 'A' ? 1 : 28)) out.push(a.data);
  }
  if (!out.length) throw new FingerprintError(404, 'The host does not resolve');
  if (out.some(isPrivateIp)) throw new FingerprintError(403, 'The host resolves to a non-public address');
  return out;
}

class FingerprintError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readCapped(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(Math.min(size, MAX_BYTES));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - o);
    buf.set(c.subarray(0, take), o);
    o += take;
    if (o >= buf.length) break;
  }
  return new TextDecoder().decode(buf);
}

function metaTags(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const name = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (name && content != null && !(name in meta)) meta[name] = content.slice(0, 300);
  }
  return meta;
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function analyse({ headers, cookies, html, host }) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
  const meta = metaTags(html);
  const ctx = { h, c: new Set(cookies), html, meta };
  const technologies = [];
  for (const [name, category, test] of SIGNATURES) {
    let r = false;
    try {
      r = test(ctx);
    } catch {
      /* a signature never breaks the run */
    }
    if (r) technologies.push({ name, category, ...(typeof r === 'string' ? { version: r } : {}) });
  }
  const trackers = [];
  for (const [type, re, pick] of TRACKERS) {
    for (const m of html.matchAll(re)) {
      const id = pick(m);
      if (id && !trackers.some((t) => t.id === id)) trackers.push({ type, id });
    }
  }
  const social = [];
  for (const [network, re] of SOCIAL) {
    for (const m of html.matchAll(re)) {
      const handle = m[2] ? `${m[1]}/${m[2]}` : m[1];
      const url = m[0];
      if (!social.some((s) => s.network === network && s.handle.toLowerCase() === handle.toLowerCase())) social.push({ network, handle, url });
    }
  }
  const linked = new Map();
  for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"'\s>]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]));
      const reg = u.hostname.toLowerCase().replace(/^www\./, '');
      if (reg && !reg.endsWith(host) && !host.endsWith(reg)) linked.set(reg, (linked.get(reg) || 0) + 1);
    } catch {
      /* not a URL */
    }
  }
  const title = decodeEntities(/<title[^>]*>([^<]{0,300})<\/title>/i.exec(html)?.[1]?.trim() || '');
  const security = {
    hsts: h['strict-transport-security'] || null,
    csp: h['content-security-policy'] ? 'present' : null,
    xFrameOptions: h['x-frame-options'] || null,
    xContentTypeOptions: h['x-content-type-options'] || null,
    referrerPolicy: h['referrer-policy'] || null,
    permissionsPolicy: h['permissions-policy'] ? 'present' : null,
  };
  return {
    title,
    description: meta.description || meta['og:description'] || null,
    generator: meta.generator || null,
    siteName: meta['og:site_name'] || null,
    technologies,
    trackers: trackers.slice(0, 30),
    social: social.slice(0, 20),
    linkedDomains: [...linked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([domain, count]) => ({ domain, count })),
    security,
    server: h.server || null,
  };
}

/** GET /api/fingerprint?host=example.com */
export async function fingerprint(url, userAgent) {
  const host = String(url.searchParams.get('host') || '').toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(host)) return { status: 400, body: { error: 'host must be a domain name' } };
  try {
    let target = new URL(`https://${host}/`);
    const redirects = [];
    let res;
    let addresses;
    const started = Date.now();
    for (let hop = 0; ; hop++) {
      if (!DOMAIN_RE.test(target.hostname) || (target.port && !['80', '443'].includes(target.port)) || !/^https?:$/.test(target.protocol)) {
        throw new FingerprintError(403, 'Redirect to a non-public or non-web target refused');
      }
      const addrs = await publicAddresses(target.hostname);
      addresses ||= addrs;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        res = await fetch(target, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en,de;q=0.8' } });
      } catch (err) {
        if (hop === 0 && target.protocol === 'https:') {
          // Some sites only answer on plain HTTP.
          target = new URL(`http://${host}/`);
          redirects.push({ from: `https://${host}/`, status: 0, note: 'HTTPS failed, tried HTTP' });
          continue;
        }
        throw new FingerprintError(502, err?.name === 'AbortError' ? 'The site did not answer in time' : 'The site could not be reached');
      } finally {
        clearTimeout(timer);
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop >= MAX_REDIRECTS) throw new FingerprintError(508, 'Too many redirects');
        const next = new URL(loc, target);
        redirects.push({ from: target.href, to: next.href, status: res.status });
        res.body?.cancel().catch(() => {});
        target = next;
        continue;
      }
      break;
    }
    const type = res.headers.get('content-type') || '';
    const html = /html|xml|text/i.test(type) ? await readCapped(res) : '';
    if (!html) res.body?.cancel().catch(() => {});
    const headers = {};
    res.headers.forEach((v, k) => {
      if (k !== 'set-cookie') headers[k] = v;
    });
    const rawCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') || '').split(/,(?=\s*[\w.-]+=)/);
    const cookies = rawCookies.map((c) => c.split('=')[0].trim()).filter(Boolean);
    const derived = analyse({ headers, cookies, html, host: target.hostname.replace(/^www\./, '') });
    return {
      status: 200,
      body: {
        host,
        finalUrl: target.href,
        httpStatus: res.status,
        ms: Date.now() - started,
        addresses,
        redirects,
        https: target.protocol === 'https:',
        bytes: html.length,
        headers: pickHeaders(headers),
        cookies: [...new Set(cookies)].slice(0, 30),
        ...derived,
      },
    };
  } catch (err) {
    if (err instanceof FingerprintError) return { status: err.status, body: { error: err.message } };
    return { status: 502, body: { error: 'Fingerprint failed' } };
  }
}

const KEEP_HEADERS = ['server', 'x-powered-by', 'via', 'content-type', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-generator', 'cf-ray', 'x-cache', 'x-served-by', 'age', 'last-modified', 'alt-svc'];
function pickHeaders(h) {
  const out = {};
  for (const k of KEEP_HEADERS) if (h[k]) out[k] = h[k].slice(0, k === 'content-security-policy' ? 600 : 200);
  return out;
}
