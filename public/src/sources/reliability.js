// Source reliability, graded separately from how well a single claim is supported (the finding's
// confidence). Scale after the NATO/Admiralty system (AJP-2.1): A completely reliable … F cannot be judged.
// The grade says how far the *source* can be trusted in general for what Indizia uses it for; a weak claim
// from an A source stays weak, and a confirmed claim from a C source is still confirmed for that claim.

export const GRADES = {
  A: 'Completely reliable',
  B: 'Usually reliable',
  C: 'Fairly reliable',
  D: 'Not usually reliable',
  E: 'Unreliable',
  F: 'Reliability cannot be judged',
};

/** [grade, why]. Grades are Indizia's assessment, reviewable in one place. */
const BY_ID = {
  rdap: ['A', 'Authoritative registry record (the registry or RIR itself)'],
  dns: ['A', 'Live DNS answers, observed directly'],
  ripestat: ['A', 'Routing data from the RIPE NCC (primary record)'],
  ptr: ['A', 'Reverse DNS as published by the address holder'],
  gleif: ['A', 'Official LEI register; data validated by the issuing LOU'],
  crtsh: ['A', 'Certificate Transparency logs: append-only and cryptographically verifiable'],
  certspotter: ['A', 'Certificate Transparency logs: append-only and cryptographically verifiable'],
  'wayback-available': ['A', 'Archived captures: faithful copies of what the page showed at the time'],
  'wayback-cdx': ['A', 'Archived captures: faithful copies of what the page showed at the time'],
  'wayback-history': ['A', 'Archived captures: faithful copies; the comparison itself is automated'],
  fingerprint: ['A', 'Observed directly by Indizia (one homepage request)'],
  nvd: ['A', 'Authoritative public advisory databases (NIST NVD, CISA KEV); the match to a site is a lead'],
  crossref: ['A', 'DOI registration agency: metadata deposited by the publisher'],
  ted: ['A', 'Official Journal of the EU (procurement notices)'],
  mempool: ['A', 'Public blockchain: the primary record'],
  blockscout: ['A', 'Public blockchain: the primary record'],
  'otx-pdns': ['B', 'Passive DNS from sensors: real observations, but incomplete and sometimes stale'],
  urlscan: ['B', 'Third-party scans of the site, each with a timestamp'],
  internetdb: ['B', 'Shodan scan data: real observations, possibly weeks old'],
  ror: ['B', 'Curated registry of research organisations'],
  icij: ['B', 'Journalistic database built from leaked records; presence is not wrongdoing'],
  github: ['B', 'Platform API: says an account exists, not who runs it'],
  bluesky: ['B', 'Platform API: says an account exists, not who runs it'],
  nominatim: ['B', 'OpenStreetMap: volunteer-mapped, usually accurate for public places'],
  overpass: ['B', 'OpenStreetMap: volunteer-mapped, usually accurate for public places'],
  openalex: ['B', 'Open scholarly index, aggregated from publishers and repositories'],
  'phone-meta': ['B', 'Numbering-plan metadata maintained by Google (libphonenumber)'],
  'mail-domain': ['B', 'Curated lists of consumer and throwaway mail providers'],
  hashlookup: ['B', 'Known-software hash sets (NIST NSRL and others)'],
  hackertarget: ['C', 'Commercial passive index; coverage and freshness unknown'],
  toolbox: ['C', 'subfinder aggregates many third-party sources; dnsx and httpx results are direct observations'],
  reputation: ['C', 'Community threat pulses and a resolver block list; false positives happen'],
  'ripestat-geo': ['C', 'Commercial geolocation database: an estimate, often wrong for hosting and VPNs'],
  wikidata: ['C', 'Crowd-edited knowledge base; check the references it cites'],
  wikipedia: ['C', 'Crowd-edited encyclopedia; check the references it cites'],
  gdelt: ['C', 'Machine-processed news coverage; the articles themselves vary'],
  hackernews: ['D', 'User posts and comments'],
  whatsmyname: ['D', 'Presence heuristics on profile pages: false positives and negatives are common'],
  'file-local': ['F', 'The file itself: its embedded properties are claims anyone can edit'],
  'tool-library': ['F', 'A list of tools, not evidence'],
};

export function reliabilityOf(id) {
  const [grade, why] = BY_ID[id] || ['F', 'Not graded'];
  return { reliability: grade, reliabilityLabel: GRADES[grade], reliabilityWhy: why };
}

export const gradeBadge = (s) => (s?.reliability ? `${s.reliability} · ${GRADES[s.reliability]}` : '');
