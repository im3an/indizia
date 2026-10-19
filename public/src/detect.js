// Local, deterministic entity detection. Runs on every keystroke; no network.

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_CHARS = /^[0-9a-f:.]+$/i;

/** IPv6 check delegated to the URL parser, which implements RFC 4291 text forms including "::". */
function isIPv6(value) {
  if (!IPV6_CHARS.test(value) || (value.match(/:/g) || []).length < 2) return false;
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}
const DOMAIN = /^(?=.{4,253}$)((?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;
const LEI = /^[A-Z0-9]{18}\d{2}$/;
const ASN = /^AS\s?\d{1,10}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE = /^\+?[\d\s()./-]{7,}$/;
const COORDS = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/;
const DOI = /^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;
const HASH = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;
const BTC = /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
const EVM = /^0x[a-fA-F0-9]{40}$/;
const USERNAME = /^(?:@|user:)([\w.-]{2,40})$/i;
const QUESTION = /^(how|what|which|where|why|who|wie|was|welche|wo|warum|wer)\b.*\s/i;
// Yes/no openers count only when the sentence names a target ("IS Holdings GmbH" stays an organisation).
const YESNO = /^(is|are|does|did|ist|sind|hat|gibt)\s.*\s/i;
// Something searchable inside a sentence: a domain, IP, LEI, DOI, ASN or a quoted name.
const TARGET_HINT = /(?:^|[\s("'])(?:(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}|(?:\d{1,3}\.){3}\d{1,3}|[A-Z0-9]{18}\d{2}|10\.\d{4,9}\/\S+|AS\d{2,10})(?=$|[\s),.;:?!"'])|"[^"]{3,80}"|\borg:/i;

const PREFIXES = {
  domain: 'domain', ip: 'ip', asn: 'asn', as: 'asn', org: 'organisation', company: 'organisation',
  lei: 'lei', url: 'url', email: 'email', phone: 'phone', user: 'username', geo: 'coordinates',
  hash: 'hash', doi: 'doi', how: 'question', tool: 'question', brief: 'objective', agent: 'objective', investigate: 'objective',
};

/** ISO 17442 check: mod 97 over the 20 characters with letters mapped A=10..Z=35 must equal 1. */
export function isValidLei(value) {
  if (!LEI.test(value)) return false;
  const digits = value.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Classify raw input into a typed entity.
 * @returns {{type:string, value:string, display:string, note?:string, valid?:boolean} | null}
 */
export function detect(raw) {
  let input = (raw || '').trim();
  if (!input) return null;

  const pre = /^([a-z]+):\s*(.+)$/i.exec(input);
  if (pre && PREFIXES[pre[1].toLowerCase()] && !/^https?$/i.test(pre[1])) {
    const type = PREFIXES[pre[1].toLowerCase()];
    const value = pre[2].trim();
    if (type === 'asn') return { type, value: 'AS' + value.replace(/^AS\s?/i, ''), display: 'ASN' };
    if (type === 'username') return { type, value: value.replace(/^@/, ''), display: 'Username' };
    return { type, value, display: DISPLAY[type] || type };
  }

  if (/^https?:\/\//i.test(input)) {
    const host = hostOf(input);
    if (host) return { type: 'url', value: input, host, display: 'URL' };
  }
  if (YESNO.test(input) && TARGET_HINT.test(input)) return { type: 'objective', value: input, display: 'Investigation brief' };
  if (QUESTION.test(input)) {
    // A question that names something Indizia can search ("who runs example.com?") becomes an
    // investigation brief; a method question ("how do I geolocate a photo") goes to the tool library.
    if (TARGET_HINT.test(input) && !/^(how|wie)\b/i.test(input)) return { type: 'objective', value: input, display: 'Investigation brief' };
    return { type: 'question', value: input, display: 'Question' };
  }
  if (EMAIL.test(input)) return { type: 'email', value: input.toLowerCase(), display: 'Email' };
  const user = USERNAME.exec(input);
  if (user) return { type: 'username', value: user[1], display: 'Username' };
  if (IPV4.test(input)) return { type: 'ip', value: input, display: 'IPv4 address' };
  if (isIPv6(input)) return { type: 'ip', value: input.toLowerCase(), display: 'IPv6 address' };
  if (ASN.test(input)) return { type: 'asn', value: 'AS' + input.replace(/^AS\s?/i, ''), display: 'ASN' };
  if (LEI.test(input.toUpperCase()) && /\d{2}$/.test(input)) {
    const v = input.toUpperCase();
    return { type: 'lei', value: v, display: 'LEI', valid: isValidLei(v) };
  }
  const coords = COORDS.exec(input);
  if (coords && Math.abs(+coords[1]) <= 90 && Math.abs(+coords[2]) <= 180) {
    return { type: 'coordinates', value: `${+coords[1]}, ${+coords[2]}`, display: 'Coordinates' };
  }
  const doi = DOI.exec(input);
  if (doi) return { type: 'doi', value: doi[1], display: 'DOI' };
  if (EVM.test(input)) return { type: 'crypto', value: input, chain: 'EVM', display: 'EVM address' };
  if (BTC.test(input)) return { type: 'crypto', value: input, chain: 'Bitcoin', display: 'Bitcoin address' };
  if (HASH.test(input)) {
    const algo = { 32: 'MD5', 40: 'SHA-1', 64: 'SHA-256' }[input.length];
    return { type: 'hash', value: input.toLowerCase(), display: `${algo} hash` };
  }
  if (PHONE.test(input) && input.replace(/\D/g, '').length >= 7) {
    return { type: 'phone', value: input, display: 'Phone number' };
  }
  const bare = input.replace(/\.$/, '');
  if (DOMAIN.test(bare) && !/\s/.test(bare)) {
    return { type: 'domain', value: bare.toLowerCase().replace(/^www\./, ''), display: 'Domain' };
  }
  return { type: 'organisation', value: input.replace(/^["']|["']$/g, ''), display: 'Organisation or name' };
}

export const DISPLAY = {
  domain: 'Domain', url: 'URL', ip: 'IP address', asn: 'ASN', lei: 'LEI', organisation: 'Organisation',
  email: 'Email', phone: 'Phone number', username: 'Username', coordinates: 'Coordinates',
  hash: 'File hash', doi: 'DOI', crypto: 'Crypto address', question: 'Question', file: 'File', objective: 'Investigation brief',
};

/** Input types that have native sources. */
export const NATIVE_TYPES = new Set(['domain', 'url', 'ip', 'asn', 'lei', 'organisation', 'email', 'phone', 'username', 'coordinates', 'hash', 'doi', 'crypto', 'question', 'file', 'objective']);

/** Types handled with deliberate restraint; the text is shown on the results page. */
export const RESTRICTED = {
  email: 'Only the mail domain is checked. Indizia does not link an address to a person or to accounts.',
  phone: 'Only numbering-plan metadata, computed on your device. No reverse lookup of private numbers.',
  username: 'Presence signals only. The same username on two sites does not prove the same person. Sensitive site categories (adult, dating, health, politics) are never checked.',
};

/** Short description of what runs for each type, shown under the search box. */
export const LENS_HINT = {
  domain: 'RDAP · DNS · subdomains · passive DNS · certificates · fingerprint · scans · reputation · archive · Wikidata',
  url: 'Archive history + the host’s domain lens',
  ip: 'RDAP · routing · reverse DNS · passive DNS · Shodan InternetDB · scans · reputation',
  asn: 'RDAP · RIPEstat routing',
  lei: 'GLEIF record, parents and subsidiaries · Wikidata',
  organisation: 'GLEIF · Wikidata · Wikipedia · ROR · EU procurement · ICIJ · news',
  email: 'Mail-domain checks only',
  phone: 'Numbering-plan metadata, on your device',
  username: '600 sites (WhatsMyName) · GitHub · Bluesky',
  coordinates: 'Reverse geocoding · map',
  hash: 'CIRCL hashlookup (known-file database)',
  doi: 'Crossref · OpenAlex',
  crypto: 'Public blockchain data, no identity attribution',
  question: 'Tool library: 1,098 OSINT tools',
  objective: 'Plans searches for everything named, runs them within limits, writes a cited brief',
  file: 'Analysed on your device: metadata, hashes, links',
};
