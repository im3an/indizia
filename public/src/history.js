// Digital time machine: what a public homepage looked like at different dates, and what changed between them.
// Pure functions, no DOM (archived HTML is untrusted and never rendered): runs in the browser and under node:test.
//
// Privacy: contact details are summarised the way an imprint publishes them. Role addresses (info@, kontakt@ …)
// are shown in full; personal-looking addresses and all phone numbers are masked, and person names are never
// extracted. Organisation names come only from text carrying a legal form ("… GmbH", "… Ltd").

import { registrableDomain } from './hosting.js';

/* ---------------- Choosing captures ---------------- */

/** "20190405123000" → "2019-04-05". */
export const tsToDate = (ts) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

/**
 * Turn CDX rows [timestamp, original, digest] (one per month) into content versions: consecutive months with
 * the same digest are one version.
 */
export function versionsFromCdx(rows) {
  const out = [];
  for (const [ts, original, digest] of rows) {
    const last = out.at(-1);
    if (last && last.digest === digest) {
      last.lastTs = ts;
      continue;
    }
    out.push({ ts, lastTs: ts, original, digest });
  }
  return out;
}

/** At most `max` versions: the first, the last, and the rest spread evenly over time. */
export function pickVersions(versions, max = 4) {
  if (versions.length <= max) return versions;
  const t = (v) => Date.parse(tsToDate(v.ts));
  const t0 = t(versions[0]);
  const t1 = t(versions.at(-1));
  const picked = new Set([0, versions.length - 1]);
  for (let i = 1; picked.size < max && i < max - 1; i++) {
    const target = t0 + ((t1 - t0) * i) / (max - 1);
    let best = -1;
    for (let j = 1; j < versions.length - 1; j++) {
      if (picked.has(j)) continue;
      if (best < 0 || Math.abs(t(versions[j]) - target) < Math.abs(t(versions[best]) - target)) best = j;
    }
    if (best > 0) picked.add(best);
  }
  return [...picked].sort((a, b) => a - b).map((i) => versions[i]);
}

/* ---------------- Reading one archived page ---------------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', copy: '©', eacute: 'é', egrave: 'è', ndash: '–', mdash: '—' };
export function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
}
const safeChar = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '');
const clean = (s) => decode(s).replace(/\s+/g, ' ').trim();

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? clean(m[1] ?? m[2] ?? m[3]) : null;
};
const meta = (html, key) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = (attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase();
    if (k === key) return attr(tag, 'content');
  }
  return null;
};

/** Tracking IDs (same patterns as server/fingerprint.mjs, so archived and live IDs line up in the graph). */
const TRACKERS = [
  ['Google Analytics (UA)', /['"=\s](UA-\d{4,10})-\d{1,4}\b/g],
  ['Google Analytics 4', /\b(G-[A-Z0-9]{8,12})\b/g],
  ['Google Tag Manager', /\b(GTM-[A-Z0-9]{4,9})\b/g],
  ['Google AdSense', /\b(ca-pub-\d{10,20})\b/g],
  ['Meta Pixel', /fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g],
  ['Hotjar', /hjid\s*:\s*(\d{5,10})/g],
];
/** Organisation social profiles (same value format as the live fingerprint: "Network:handle"). */
const SOCIAL = [
  ['X / Twitter', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|hashtag|i\/)([A-Za-z0-9_]{1,15})(?=["'/?#])/g],
  ['LinkedIn', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company|school|showcase)\/([A-Za-z0-9_.-]{2,100})(?=["'/?#])/g],
  ['GitHub', /https?:\/\/github\.com\/(?!sponsors|features|about|login|orgs\/)([A-Za-z0-9-]{1,39})(?=["'/?#])/g],
  ['Facebook', /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|groups\/)([A-Za-z0-9.]{3,80})(?=["'/?#])/g],
  ['Instagram', /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|reel)([A-Za-z0-9_.]{2,30})(?=["'/?#])/g],
  ['Xing', /https?:\/\/(?:www\.)?xing\.com\/(?:pages|companies)\/([A-Za-z0-9_-]{2,80})(?=["'/?#])/g],
];

const ROLE_LOCAL = /^(info|kontakt|contact|office|mail|post|support|service|hello|hallo|sales|vertrieb|presse|press|media|datenschutz|privacy|dsb|webmaster|admin|team|buchhaltung|accounting|jobs|karriere|career|careers|bewerbung|impressum|legal|abuse|noreply|no-reply|shop|order|orders|bestellung|kundenservice|customerservice|help|hilfe|marketing|redaktion|empfang|zentrale|security|investor|ir)$/i;
const FILE_EXT = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

/** info@firma.de stays readable; jane.doe@firma.de becomes j•••@firma.de. */
export function maskEmail(email) {
  const [local, domain] = email.split('@');
  return ROLE_LOCAL.test(local) ? email : `${local[0]}•••@${domain}`;
}
/** Keep the country/area prefix and the last two digits: enough to see that a number changed. */
export function maskPhone(digits) {
  const d = digits.replace(/[^\d+]/g, '');
  if (d.length < 7) return d;
  return `${d.slice(0, d.startsWith('+') ? 5 : 4)} ••• ${d.slice(-2)}`;
}

// "… Musterfirma GmbH", "Example Ltd." — names that carry a legal form. Person names are never extracted.
const LEGAL = '(?:GmbH & Co\\. KG|GmbH|AG|SE|KGaA|UG \\(haftungsbeschränkt\\)|e\\.\\s?V\\.|e\\.K\\.|OHG|KG|Ltd\\.?|Limited|LLC|Inc\\.?|PLC|S\\.A\\.|SAS|SARL|S\\.r\\.l\\.|B\\.V\\.|N\\.V\\.|AB|A/S|Oy)';
const ORG_RE = new RegExp(`((?:[A-ZÄÖÜ0-9][\\wÄÖÜäöüß&.'’-]*\\s){0,3}[A-ZÄÖÜ0-9][\\wÄÖÜäöüß&.'’-]*\\s${LEGAL})(?=[\\s,.;:)|<]|$)`, 'g');

/**
 * Extract comparable features from one archived HTML page.
 * @param {string} html raw capture (Wayback id_ mode, not rewritten)
 * @param {string} pageUrl the original URL of the capture
 */
export function extractPage(html, pageUrl) {
  html = String(html || '').slice(0, 2_000_000);
  let host = '';
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    /* keep empty */
  }
  const site = host ? registrableDomain(host) : '';
  const head = html.slice(0, 200_000);

  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || '').slice(0, 200) || null;
  const description = (meta(head, 'description') || meta(head, 'og:description') || '').slice(0, 300) || null;
  const siteName = meta(head, 'og:site_name');
  const generator = meta(head, 'generator');
  const themeColor = meta(head, 'theme-color');
  const lang = attr(/<html\b[^>]*>/i.exec(head)?.[0] || '', 'lang');

  let canonical = null;
  let favicon = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') || '').toLowerCase();
    const href = attr(m[0], 'href');
    if (!href) continue;
    if (rel === 'canonical' && !canonical) canonical = absolute(href, pageUrl);
    if (/\bicon\b/.test(rel) && !favicon) favicon = path(absolute(href, pageUrl));
  }
  // The logo: the first image whose file name, class, id or alt says "logo".
  let logo = null;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], 'src') || attr(m[0], 'data-src');
    if (src && /logo/i.test(`${src} ${attr(m[0], 'class') || ''} ${attr(m[0], 'id') || ''} ${attr(m[0], 'alt') || ''}`)) {
      logo = path(absolute(src, pageUrl));
      break;
    }
  }

  const emails = new Map();
  for (const m of decode(html).matchAll(/(?:mailto:)?([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,24})/g)) {
    const e = m[1].toLowerCase();
    if (FILE_EXT.test(e) || /^[0-9a-f]{16,}@/.test(e) || /(sentry|wixpress|example)\./.test(e)) continue;
    emails.set(e, maskEmail(e));
  }
  const phones = new Map();
  for (const m of html.matchAll(/href\s*=\s*["']tel:([^"']{5,40})["']/gi)) {
    const d = decode(m[1]).replace(/[^\d+]/g, '');
    if (d.length >= 7) phones.set(d, maskPhone(d));
  }

  const trackers = [];
  for (const [type, re] of TRACKERS) for (const m of html.matchAll(re)) if (!trackers.some((t) => t.id === m[1])) trackers.push({ type, id: m[1] });
  const social = [];
  for (const [network, re] of SOCIAL) {
    for (const m of html.matchAll(re)) {
      const handle = m[2] ? `${m[1]}/${m[2]}` : m[1];
      if (!social.some((s) => s.network === network && s.handle.toLowerCase() === handle.toLowerCase())) social.push({ network, handle });
    }
  }

  const linked = new Map();
  for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"'\s>]+)["']/gi)) {
    try {
      const h = new URL(decode(m[1])).hostname.toLowerCase().replace(/^www\./, '');
      const reg = registrableDomain(h);
      if (reg && reg !== site && !/(web\.archive\.org|archive\.org)$/.test(reg)) linked.set(reg, (linked.get(reg) || 0) + 1);
    } catch {
      /* not a URL */
    }
  }

  const text = visibleText(html);
  const copyright = /(?:©|&copy;|\(c\)|copyright)\s*([^<\n]{3,120})/i.exec(decode(html.replace(/<[^>]+>/g, ' ')))?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 120) || null;
  const orgs = new Set();
  // Only the copyright line and the footer: navigation words in the body would read as company names.
  for (const src of [copyright || '', text.slice(-4000)]) for (const m of src.matchAll(ORG_RE)) orgs.add(orgName(m[1]));
  const imprintMatch = /href\s*=\s*["']([^"']*(?:impressum|imprint|legal-notice|mentions-legales|colofon)[^"']*)["']/i.exec(html);
  const imprint = !!imprintMatch;
  const imprintUrl = imprintMatch ? absolute(imprintMatch[1], pageUrl) : null;

  return {
    host,
    title,
    description,
    siteName,
    generator,
    themeColor: themeColor ? themeColor.toLowerCase() : null,
    lang,
    canonical,
    favicon,
    logo,
    emails: [...emails.entries()].map(([value, shown]) => ({ value, shown })).slice(0, 20),
    phones: [...phones.entries()].map(([value, shown]) => ({ value, shown })).slice(0, 10),
    trackers: trackers.slice(0, 20),
    social: social.slice(0, 20),
    linked: [...linked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([d]) => d),
    copyright,
    orgs: [...orgs].filter((o) => o && o.length >= 6 && o.length <= 80 && /^[A-ZÄÖÜ0-9][\wÄÖÜäöüß&.'’-]+\s/.test(o)).slice(0, 8),
    imprint,
    imprintUrl,
    words: words(text),
    bytes: html.length,
  };
}

/** "© 2017 Muster Handels GmbH", "Deutschlands Die Muster AG" → the name after any year, © or article. */
function orgName(s) {
  const words = s
    .replace(/^.*?\b(?:Die|Der|Das|The|von|by|bei)\s+(?=[A-ZÄÖÜ0-9])/, '')
    .replace(/^(?:(?:©|Copyright|\d{4}(?:\s*[-–]\s*\d{4})?)\s+)+/i, '')
    .trim()
    .split(/\s+/);
  // Footers run navigation into the company name ("Impressum Datenschutz Muster GmbH"): drop leading menu words.
  while (words.length > 2 && words[0].split(/[-/]/).every((w) => NAV_WORD.test(w))) words.shift();
  return words.join(' ');
}
const NAV_WORD = /^(impressum|imprint|datenschutz\w*|haftungsausschluss|disclaimer|kontakt|contact|support|service|\w*portal|home|startseite|karriere|presse|press|news|login|shop|agb|cookies?|newsletter|sitemap|hilfe|help|faq|downloads?|men[uü]|suche|search|copyright|privacy|policy|terms|legal|notice|about|jobs|careers|blog|rechtliche[sn]?|hinweise?|barrierefreiheit|nutzungsbedingungen|deutsch|english|tochter\w*|partner|social|media|follow|folgen|uns|us|top|nach|oben|zurück)$/i;

function absolute(href, base) {
  try {
    return new URL(decode(href), base).href;
  } catch {
    return href;
  }
}
/** Archive-independent file path of an asset: "/img/logo.png". */
function path(u) {
  try {
    const x = new URL(u);
    return x.pathname.replace(/^\/web\/\d+[a-z_]*\/https?:\/\/[^/]+/, '') || '/';
  } catch {
    return u;
  }
}

function visibleText(html) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200_000);
}
function words(text) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].slice(0, 4000);
}

/* ---------------- Comparing two captures ---------------- */

/** Jaccard similarity of the two pages' word sets, 0..1. */
export function textSimilarity(a, b) {
  const A = new Set(a.words);
  const B = new Set(b.words);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const FIELDS = [
  ['title', 'Page title', 'branding'],
  ['siteName', 'Site name', 'branding'],
  ['logo', 'Logo file', 'branding'],
  ['favicon', 'Favicon', 'branding'],
  ['themeColor', 'Theme colour', 'branding'],
  ['description', 'Description', 'content'],
  ['generator', 'Website software', 'technology'],
  ['lang', 'Language', 'content'],
  ['canonical', 'Canonical address', 'identity'],
  ['copyright', 'Copyright line', 'identity'],
];
const SETS = [
  ['emails', 'Contact email', 'contact', (x) => x.value, (x) => x.shown],
  ['phones', 'Phone number', 'contact', (x) => x.value, (x) => x.shown],
  ['trackers', 'Tracking ID', 'technology', (x) => x.id, (x) => `${x.type} ${x.id}`],
  ['social', 'Social profile', 'identity', (x) => `${x.network}:${x.handle}`.toLowerCase(), (x) => `${x.network} ${x.handle}`],
  ['orgs', 'Organisation named', 'identity', (x) => x.toLowerCase(), (x) => x],
];

/**
 * What changed from capture a to capture b.
 * @returns {{ changes: {field,label,area,kind:'added'|'removed'|'changed',from?,to?}[], similarity:number }}
 */
export function diffPages(a, b) {
  const changes = [];
  for (const [f, label, area] of FIELDS) {
    const x = a[f] || null;
    const y = b[f] || null;
    if (x === y || (x && y && x.toLowerCase() === y.toLowerCase())) continue;
    const yearless = (v) => v.replace(/\d{4}(\s*[-–]\s*\d{4})?/g, '').replace(/[\s|·•,–-]+/g, ' ').trim().toLowerCase();
    if (f === 'copyright' && x && y && yearless(x) === yearless(y)) continue; // only the year moved on
    changes.push({ field: f, label, area, kind: !x ? 'added' : !y ? 'removed' : 'changed', from: x, to: y });
  }
  for (const [f, label, area, id, shown] of SETS) {
    const A = new Map((a[f] || []).map((x) => [id(x), shown(x)]));
    const B = new Map((b[f] || []).map((x) => [id(x), shown(x)]));
    for (const [k, v] of B) if (!A.has(k)) changes.push({ field: f, label, area, kind: 'added', to: v, key: k });
    for (const [k, v] of A) if (!B.has(k)) changes.push({ field: f, label, area, kind: 'removed', from: v, key: k });
  }
  if (a.imprint !== b.imprint) changes.push({ field: 'imprint', label: 'Imprint link', area: 'identity', kind: b.imprint ? 'added' : 'removed' });
  return { changes, similarity: textSimilarity(a, b) };
}

/** One readable line per change. */
export function describeChange(c) {
  const q = (s) => `“${String(s).length > 70 ? String(s).slice(0, 69) + '…' : s}”`;
  if (c.kind === 'added') return c.to ? `${c.label} added: ${q(c.to)}` : `${c.label} added`;
  if (c.kind === 'removed') return c.from ? `${c.label} removed: ${q(c.from)}` : `${c.label} removed`;
  return `${c.label}: ${q(c.from)} → ${q(c.to)}`;
}

/** Short summary of which areas changed, e.g. "title, contact email and logo changed". */
export function summariseChanges(changes) {
  const labels = [...new Set(changes.map((c) => c.label.toLowerCase()))];
  if (!labels.length) return 'no tracked detail changed';
  const list = labels.length > 3 ? [...labels.slice(0, 3), `${labels.length - 3} more`] : labels;
  return `${list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]} changed`;
}
