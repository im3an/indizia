// Entity extraction from document text. Deterministic rules with validation (checksums, ranges), so every hit
// can be explained and tested. Multilingual where it matters for Indizia's users (English and German dates,
// legal forms across Europe). Person names are deliberately not extracted: documents may name private
// individuals, and Indizia does not build person profiles (docs/research/01 §I.2).

const MONTHS = {
  jan: 1, january: 1, januar: 1, jänner: 1, feb: 2, february: 2, februar: 2, mar: 3, march: 3, märz: 3, maerz: 3, apr: 4, april: 4,
  may: 5, mai: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, dez: 12, dezember: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const LEGAL_FORMS = [
  'GmbH & Co\\. KGaA', 'GmbH & Co\\. KG', 'gGmbH', 'GmbH', 'UG \\(haftungsbeschränkt\\)', 'AG & Co\\. KG', 'KGaA', 'AG', 'SE', 'KG', 'OHG', 'e\\.\\s?V\\.', 'eG',
  'Ltd\\.?', 'Limited', 'LLP', 'LLC', 'L\\.L\\.C\\.', 'Inc\\.?', 'Incorporated', 'Corp\\.?', 'Corporation', 'PLC', 'plc',
  'S\\.A\\.', 'SA', 'S\\.p\\.A\\.', 'S\\.r\\.l\\.', 'SAS', 'SARL', 'S\\.à r\\.l\\.', 'B\\.V\\.', 'BV', 'N\\.V\\.', 'NV', 'AB', 'ASA', 'A/S', 'Oy', 'Oyj', 'GesmbH', 'Sp\\. z o\\.o\\.', 's\\.r\\.o\\.',
];
// Up to six capitalised (or "&"/"und"/"and") words before a legal form, on one line.
const ORG_RE = new RegExp(`((?:[A-ZÄÖÜ0-9][\\w&.'’ÄÖÜäöüß-]*\\s(?:(?:&|und|and|of|für|de|der|des)\\s)?){1,6}(?:${LEGAL_FORMS.join('|')}))(?![\\wÄÖÜäöüß])`, 'g');

const LEGAL_SPLIT = new RegExp(`(?<=(?:${LEGAL_FORMS.join('|')}))(?!\\s*&\\s*Co\\.)(?=,?\\s+(?:and|und|&)?\\s*[A-ZÄÖÜ0-9])`);

const RULES = [
  ['email', /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24}\b/gi],
  ['url', /\bhttps?:\/\/[^\s<>"'()\]]{4,300}/gi],
  ['ipv4', /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g],
  ['ipv6', /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi],
  ['lei', /\b[0-9A-Z]{18}[0-9]{2}\b/g],
  ['iban', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g],
  ['vat', /\b(?:ATU\d{8}|BE0\d{9}|DE\d{9}|DK\d{8}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-Z0-9]{2}\d{9}|IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}|IT\d{11}|LU\d{8}|NL\d{9}B\d{2}|PL\d{10}|SE\d{12}|CHE-?\d{3}\.?\d{3}\.?\d{3}|GB\d{9})\b/g],
  ['register', /\b(?:HR[AB]|VR|GnR|PR)\s?\d{2,6}(?:\s?[A-Z]{1,2})?\b|\b(?:Company|Registered)\s(?:No\.?|number)\s?:?\s?[A-Z]{0,2}\d{6,8}\b/g],
  ['cve', /\bCVE-\d{4}-\d{4,7}\b/gi],
  ['doi', /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]{3,200}[A-Z0-9]/gi],
  ['sha256', /\b[a-f0-9]{64}\b/gi],
  ['sha1', /\b[a-f0-9]{40}\b/gi],
  ['md5', /\b[a-f0-9]{32}\b/gi],
  ['btc', /\b(?:bc1[ac-hj-np-z02-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g],
  ['eth', /\b0x[a-fA-F0-9]{40}\b/g],
  ['coordinates', /(-?\d{1,2}\.\d{3,8})\s*[,;]\s*(-?\d{1,3}\.\d{3,8})/g],
  ['money', /(?:€|EUR|USD|US\$|\$|£|GBP|CHF)\s?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?(?:\s?(?:Mio\.?|Mrd\.?|million|billion|bn|m|k))?|\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s?(?:€|EUR|USD|CHF|GBP)\b/g],
];

/** ISO 17442 / IBAN-style mod 97 check over letters mapped to numbers. */
export function mod97(s) {
  const digits = s.toUpperCase().replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r;
}
export const validLei = (s) => /^[0-9A-Z]{18}[0-9]{2}$/.test(s) && /[A-Z]/.test(s) && mod97(s) === 1;
export function validIban(raw) {
  const s = raw.replace(/\s+/g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  return mod97(s.slice(4) + s.slice(0, 4)) === 1;
}
/** Show an IBAN without its middle digits: account numbers are personal data in many documents. */
export const maskIban = (s) => {
  const c = s.replace(/\s+/g, '');
  return `${c.slice(0, 4)} •••• ${c.slice(-4)}`;
};

function pad(n) {
  return String(n).padStart(2, '0');
}
function iso(y, m, d) {
  y = Number(y);
  if (y < 100) y += y < 50 ? 2000 : 1900;
  m = Number(m);
  d = d === undefined ? null : Number(d);
  if (y < 1800 || y > 2100 || m < 1 || m > 12 || (d !== null && (d < 1 || d > 31))) return null;
  if (d !== null) {
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1) return null; // 31 February
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  return `${y}-${pad(m)}`;
}

const DATE_RULES = [
  // 2021-03-05, 2021/03/05
  [/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g, (m) => iso(m[1], m[2], m[3])],
  // 05.03.2021 (German), 5.3.21
  [/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g, (m) => iso(m[3], m[2], m[1])],
  // 5 March 2021, 5. März 2021, 5th of March 2021
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s(?:of\\s)?(${MONTH_RE})\\.?\\s(\\d{4})\\b`, 'gi'), (m) => iso(m[3], MONTHS[m[2].toLowerCase()], m[1])],
  // March 5, 2021
  [new RegExp(`\\b(${MONTH_RE})\\.?\\s(\\d{1,2})(?:st|nd|rd|th)?,?\\s(\\d{4})\\b`, 'gi'), (m) => iso(m[3], MONTHS[m[1].toLowerCase()], m[2])],
  // March 2021, März 2021
  [new RegExp(`\\b(${MONTH_RE})\\.?\\s(\\d{4})\\b`, 'gi'), (m) => iso(m[2], MONTHS[m[1].toLowerCase()])],
];

const ABBREV = /\b(?:Ltd|Inc|Co|Corp|Nr|No|St|Dr|Mr|Mrs|Ms|Prof|bzw|ca|vgl|Abs|Art|Str|e\.V|z\.B|u\.a|S\.A|B\.V|N\.V)$/i;
/** A sentence ends at a line break, or at . ! ? followed by space and a capital or digit (not after "Ltd." or "Nr."). */
function boundary(text, i) {
  const c = text[i];
  if (c === '\n') return true;
  if (c !== '.' && c !== '!' && c !== '?') return false;
  if (!/\s/.test(text[i + 1] || ' ')) return false;
  if (!/[A-ZÄÖÜ0-9"“„(]/.test(text[i + 2] || 'A')) return false;
  return !ABBREV.test(text.slice(Math.max(0, i - 6), i));
}

/** The sentence (or line) around a character offset, trimmed to `max` characters each way. */
export function sentenceAt(text, index, length = 0, max = 240) {
  let start = index;
  while (start > 0 && !boundary(text, start - 1) && index - start < max) start--;
  let end = index + length;
  while (end < text.length && !boundary(text, end) && end - index < max) end++;
  return text.slice(start, Math.min(text.length, end + 1)).replace(/\s+/g, ' ').trim();
}

/** Dated statements: every date found, normalised to ISO, with the sentence it appears in. */
export function extractDates(text) {
  const out = [];
  const taken = [];
  for (const [re, toIso] of DATE_RULES) {
    for (const m of text.matchAll(re)) {
      const at = m.index;
      if (taken.some(([a, b]) => at < b && at + m[0].length > a)) continue; // a longer form already matched here
      const date = toIso(m);
      if (!date) continue;
      taken.push([at, at + m[0].length]);
      out.push({ date, raw: m[0], index: at, context: sentenceAt(text, at, m[0].length) });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const ORG_STOP = new Set(['die', 'der', 'das', 'the', 'von', 'by', 'from', 'and', 'und', 'invoice', 'rechnung', 'contract', 'vertrag', 'between', 'zwischen', 're', 'betreff', 'subject', 'to', 'an', 'for', 'für', 'with', 'mit', 'dear', 'at', 'bei', 'of', 'client', 'customer', 'kunde', 'supplier', 'lieferant', 'agreement', 'vereinbarung', 'supply', 'order', 'bestellung', 'angebot', 'offer']);

function clean(type, v) {
  if (type === 'url') return v.replace(/[.,;:!?]+$/, '');
  if (type === 'email') return v.toLowerCase();
  if (type === 'iban') return v.replace(/\s+/g, '');
  if (type === 'org') {
    let words = v.replace(/\s+/g, ' ').trim().split(' ');
    // Reference numbers and headings in front of a name ("INVOICE 2021-117 Acme GmbH") are not part of it.
    // A reference number has 3+ digits or digits joined by - / . (names like "3M" stay).
    const lastNum = words.slice(0, -1).findLastIndex((w) => /^\d{3,}$/.test(w) || /\d[-/.]\d/.test(w));
    if (lastNum >= 0) words = words.slice(lastNum + 1);
    while (words.length > 1 && ORG_STOP.has(words[0].toLowerCase().replace(/[:,]$/, ''))) words = words.slice(1);
    return words.join(' ');
  }
  return v;
}

function valid(type, v, m) {
  if (type === 'lei') return validLei(v);
  if (type === 'iban') return validIban(v);
  if (type === 'ipv4') return !/^0\./.test(v) && v !== '0.0.0.0';
  if (type === 'coordinates') return Math.abs(Number(m[1])) <= 90 && Math.abs(Number(m[2])) <= 180;
  if (type === 'md5' || type === 'sha1' || type === 'sha256') return /[a-f]/i.test(v) && /\d/.test(v);
  if (type === 'org') return v.split(' ').length >= 2 && v.length <= 120 && !/^\d+(?!\p{L})/u.test(v); // "3M …" yes, "2021 …" no
  return true;
}

/**
 * @param {string} text
 * @returns {{ type: string, value: string, display: string, count: number, first: number, context: string }[]}
 */
export function extractEntities(text) {
  const found = new Map();
  const add = (type, value, display, index, len) => {
    const k = `${type}:${type === 'org' ? value.toLowerCase() : value}`;
    const cur = found.get(k);
    if (cur) cur.count++;
    else found.set(k, { type, value, display, count: 1, first: index, context: sentenceAt(text, index, len) });
  };
  const hashSpans = [];
  for (const [type, re] of RULES) {
    for (const m of text.matchAll(re)) {
      const v = clean(type, m[0]);
      if (!valid(type, v, m)) continue;
      // A SHA-1 inside a SHA-256 is not a second hash; an MD5 inside either is not a third.
      if (['sha256', 'sha1', 'md5'].includes(type)) {
        if (hashSpans.some(([a, b]) => m.index >= a && m.index < b)) continue;
        hashSpans.push([m.index, m.index + m[0].length]);
      }
      const display = type === 'iban' ? maskIban(v) : type === 'coordinates' ? `${Number(m[1])}, ${Number(m[2])}` : v;
      add(type, type === 'coordinates' ? display : v, display, m.index, m[0].length);
    }
  }
  for (const m of text.matchAll(ORG_RE)) {
    // "Acme Ltd. and Beta GmbH" matches as one run: split it after each inner legal form.
    let offset = 0;
    for (const part of m[1].split(LEGAL_SPLIT)) {
      const v = clean('org', part.replace(/^\s*(?:,|&|and|und)\s+/i, ''));
      if (valid('org', v)) add('org', v, v, m.index + offset, part.length);
      offset += part.length;
    }
  }
  // Domains named in URLs and email addresses.
  for (const e of [...found.values()]) {
    let host = null;
    if (e.type === 'url') {
      try {
        host = new URL(e.value).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        /* malformed */
      }
    } else if (e.type === 'email') host = e.value.split('@')[1];
    if (host && host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) add('domain', host, host, e.first, 0);
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.first - b.first);
}

export const ENTITY_LABEL = {
  org: 'Organisations', domain: 'Domains', url: 'Links', email: 'Email addresses', ipv4: 'IPv4 addresses', ipv6: 'IPv6 addresses',
  lei: 'LEIs', iban: 'IBANs (masked)', vat: 'VAT IDs', register: 'Register numbers', cve: 'CVE IDs', doi: 'DOIs',
  sha256: 'SHA-256', sha1: 'SHA-1', md5: 'MD5', btc: 'Bitcoin addresses', eth: 'Ethereum addresses', coordinates: 'Coordinates', money: 'Amounts',
};

/** Which entity types can start a Indizia search, and the query to use. */
export function entityQuery(e) {
  if (e.type === 'org') return `org:${e.value}`;
  if (['domain', 'ipv4', 'ipv6', 'lei', 'doi', 'sha256', 'sha1', 'md5', 'btc', 'eth', 'coordinates'].includes(e.type)) return e.value;
  if (e.type === 'url') return e.value;
  return null; // email, IBAN, VAT, register numbers, amounts: shown, not searched automatically
}
