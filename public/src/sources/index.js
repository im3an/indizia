// Source registry. Order matters only for display in the coverage ledger.
import dns from './dns.js';
import rdap from './rdap.js';
import ripestat from './ripestat.js';
import { crtsh, certspotter } from './certs.js';
import { waybackAvailability, waybackCdx, waybackHistory } from './wayback.js';
import gleif from './gleif.js';
import wikidata from './wikidata.js';
import { whatsMyName, github, bluesky } from './username.js';
import { phone, mailDomain } from './local.js';
import { nominatim, ipGeo, overpassNearby } from './geo.js';
import { crossref, openalexWork, ror } from './scholarly.js';
import { hashlookup, mempool, blockscout } from './chain.js';
import { wikipedia, hackerNews, ted, icij, gdelt, internetdb } from './related.js';
import { fileAnalysis } from './files.js';
import { subdomains, passiveDns, reverseDns, fingerprint, urlscan, reputation } from './infra.js';
import { toolbox } from './toolbox.js';
import { vulnerabilities } from './vulns.js';
import { toolLibrary } from '../tools.js';
import { reliabilityOf } from './reliability.js';

export const SOURCES = [
  rdap, dns, subdomains, toolbox, passiveDns, fingerprint, vulnerabilities, urlscan, reputation, ripestat, reverseDns, ipGeo, internetdb, crtsh, certspotter, waybackAvailability, waybackCdx, waybackHistory,
  gleif, wikidata, wikipedia, ror, ted, icij, gdelt, hackerNews,
  whatsMyName, github, bluesky, mailDomain, phone, nominatim, overpassNearby,
  crossref, openalexWork, hashlookup, mempool, blockscout, fileAnalysis, toolLibrary,
];

// Every source carries its reliability grade (sources/reliability.js), separate from claim confidence.
for (const s of SOURCES) Object.assign(s, reliabilityOf(s.id));
