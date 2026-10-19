// Tool library: 1,000+ OSINT tools from the OSINT Framework (MIT), searchable on the device.

let cache = null;
export async function loadTools() {
  cache ||= fetch('/data/tools.json').then((r) => r.json()).then((d) => d.tools);
  return cache;
}

/** Which tool "input" phrases fit each Indizia input type. */
const INPUT_WORDS = {
  domain: ['domain', 'url', 'website'], url: ['url', 'website', 'domain'], ip: ['ip'], asn: ['asn', 'ip'],
  organisation: ['company', 'organization', 'organisation', 'business'], lei: ['company', 'lei'], email: ['email'],
  phone: ['phone'], username: ['username'], coordinates: ['coordinates', 'location', 'address', 'image'],
  hash: ['hash', 'file'], doi: ['doi', 'paper', 'research'], crypto: ['wallet', 'address', 'transaction', 'bitcoin', 'crypto'],
  file: ['file', 'image', 'document', 'pdf', 'video'],
};

/** Top-level OSINT Framework categories that fit each input type. */
const TYPE_CATEGORY = {
  domain: 'Domain Name', url: 'Domain Name', ip: 'IP & MAC Address', asn: 'IP & MAC Address', organisation: 'Business Records', lei: 'Business Records',
  email: 'Email Address', phone: 'Telephone Numbers', username: 'Username', coordinates: 'Geolocation Tools / Maps', file: 'Images / Videos / Docs',
  crypto: 'Blockchain & Cryptocurrency', hash: 'Malicious File Analysis', doi: 'Search Engines',
};

const STOP = new Set(['how', 'do', 'i', 'a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'with', 'can', 'what', 'which', 'is', 'my', 'find', 'tool', 'tools', 'wie', 'ich', 'ein', 'eine', 'der', 'die', 'das']);

const SYNONYMS = {
  geolocate: ['geolocation', 'location', 'geo', 'map'], geolocation: ['location', 'geo', 'map'], locate: ['location', 'geolocation'],
  photo: ['image', 'picture', 'photograph'], photos: ['image', 'picture'], picture: ['image', 'photo'], image: ['photo', 'picture'],
  video: ['youtube', 'footage'], company: ['business', 'corporate', 'organization'], person: ['people'], people: ['person'],
  ship: ['vessel', 'maritime', 'ais'], vessel: ['ship', 'maritime'], plane: ['aircraft', 'flight', 'aviation'], flight: ['aircraft', 'aviation'],
  subdomain: ['subdomains', 'dns'], website: ['domain', 'url'], reverse: ['reverse'], crypto: ['blockchain', 'bitcoin', 'wallet'],
  metadata: ['exif', 'meta'], exif: ['metadata'], archive: ['wayback', 'archived'], phone: ['telephone', 'number'],
};

function wordRe(w) {
  return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
}

export function searchTools(tools, query, { type, limit = 30 } = {}) {
  const words = query.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 1 && !STOP.has(w));
  // Each query word becomes a group: the word itself plus synonyms. A tool scores once per matched group.
  const groups = words.map((w) => [w, ...(SYNONYMS[w] || [])].map(wordRe));
  const inputWords = type ? INPUT_WORDS[type] || [] : [];
  const scored = [];
  for (const t of tools) {
    const cat = t.c.join(' ');
    const rest = `${t.d} ${t.b} ${t.i} ${t.o}`;
    let score = 0;
    let matched = 0;
    for (const g of groups) {
      let best = 0;
      for (const re of g) {
        if (re.test(t.n)) best = Math.max(best, 6);
        else if (re.test(cat)) best = Math.max(best, 4);
        else if (re.test(rest)) best = Math.max(best, 1.5);
      }
      if (best) matched++;
      score += best;
    }
    if (groups.length && matched < Math.ceil(groups.length / 2)) continue;
    if (groups.length > 1 && matched === groups.length) score += 4;
    if (inputWords.length && inputWords.some((w) => t.i.toLowerCase().includes(w))) score += groups.length ? 2 : 3;
    if (!groups.length && type && t.c[0] === TYPE_CATEGORY[type]) score += 5;
    if (t.p === 'free') score += 1;
    if (t.s === 'live') score += 0.5;
    if (t.op === 'passive') score += 0.5;
    if (score > (groups.length ? 3 : 2)) scored.push([score, t]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, t]) => t);
}

export const toolLibrary = {
  id: 'tool-library',
  name: 'Tool library',
  provider: 'OSINT Framework dataset (MIT), searched on your device',
  homepage: 'https://github.com/lockfale/OSINT-Framework',
  terms: 'https://github.com/lockfale/OSINT-Framework/blob/master/LICENSE',
  licence: 'MIT',
  category: 'Tools',
  accepts: ['question'],
  cors: true,
  local: true,

  async run(ctx) {
    const tools = await loadTools();
    const hits = searchTools(tools, ctx.entity.value.replace(/^(tool|how):\s*/i, ''), { limit: 40 });
    const evidence = ctx.local('tools.json', { query: ctx.entity.value, matches: hits.length, of: tools.length });
    if (!hits.length) return ctx.note(`No tool among ${tools.length} matches these words`);
    ctx.finding({
      title: `${hits.length} tools match “${ctx.entity.value}”`,
      detail: `Searched ${tools.length} tools from the OSINT Framework. Pricing, registration and OPSEC notes come from that dataset.`,
      confidence: 'confirmed',
      evidence,
      tools: hits,
    });
  },
};
