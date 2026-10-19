# C — OSINT Source & Tool Catalog

Snapshot: **2026-10-17**. This catalog is the seed for the product's **tool registry**. Every entry becomes a machine-readable "source manifest" (see 01, §B.6).

**Integration modes**

| Code | Mode | Meaning |
|---|---|---|
| **N** | Native | The platform queries a permitted API or dataset and renders the results |
| **X** | Execution | An open-source tool runs in a sandboxed runner (hosted or the user's local companion) |
| **L** | Launch | The platform builds the query and opens the external tool. Nothing is claimed as searched |
| **P** | Local processing | The user's own files or data, processed in the browser or on the user's machine |

**Cost codes:** Free · Free-key · Freemium · Paid · NC (non-commercial only)
**Phase:** 1–4 (roadmap phases) · ⛔ excluded · R restricted (needs a purpose/role gate)
**Evidence:** ✅ verified today · ◐ re-verify · ⚠ conflicting

---

## Part 1 — Taxonomy (30 categories)

Grouped by the **input** a user types, because the product starts from one search box.

| Input type the box detects | Categories served |
|---|---|
| Domain / URL | Domain & DNS · Certificates · Subdomains / attack surface · Web recon · Archives · Threat intel · Scams & fraud |
| IP / CIDR / ASN | IP & network · Threat intel · Exposure data |
| Company / organisation / LEI | Corporate · Public records · Procurement · Sanctions · Lobbying · Leaks databases · News |
| Person name (public role) | Public-figure identity · Academic · Politics · Corporate officers (official registers only) · News. **Gated** |
| Username / handle | Username presence · Social media · Code platforms. **Gated, see legal** |
| Email | Technical validation · Domain context · Public mentions · Breach *catalogue*. **No identity resolution** |
| Phone | Numbering-plan metadata · Business directories. **No reverse lookup of private numbers** |
| Image / video / file | Visual OSINT · Media provenance · File and EXIF forensics · Documents |
| Coordinates / place | GEOINT · Maps · Satellite · Transport · Environment |
| Crypto address / tx | Blockchain explorers · Scam reports · Sanctions |
| Hash / IOC | Threat intel · Malware |
| DOI / ORCID / paper | Academic & scientific |
| Vessel (IMO/MMSI) / aircraft (ICAO hex/reg) | Maritime · Aviation |
| Free text question | Tool registry · Methodology library · Search operators (L) |

Cross-cutting categories: Search engines & operators · Archives · Knowledge graphs · News · Dark-web research · Frameworks · Directories & learning.

---

## Part 2 — Catalog by category

### 1. Search engines & operators
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Google / Google dorks | Web index | L | Free manual | No free API (CSE closed to new customers, ends 2027-01-01) ✅. Generate dork URLs | 1 |
| Bing | Web index | L | Free manual | API retired 2025-08-11 ✅ | 1 |
| DuckDuckGo | Web index | L | Free manual | No official full-web API ◐ | 1 |
| Brave Search | Independent index | L / N (BYOK) | Freemium, card | About $5/month credit ✅ | 4 |
| Mojeek | Independent index (UK) | L | Paid API | £2 per 1k ✅ | 1 (L) |
| Yandex | Web and image (RU) | L | Free manual | Jurisdictional caution | 1 |
| Startpage, Qwant, Ecosia | Privacy-front ends | L | Free manual | ◐ | 1 |
| Marginalia Search | Small-web index | L / N ◐ | Free ◐ | Has an API key system ◐ | 3 |
| SearXNG | Metasearch you host | X | Free (AGPL) ✅ | Scrapes engines that may forbid it. Offer **user-run/local only** | 4 |
| Common Crawl index | Crawl CDX | N | Free ✅ | ToU bans harvesting personal info separate from the crawled content | 3 |
| grep.app / Sourcegraph public | Code search | L | Free manual ◐ | | 1 |

### 2. Archives & historical research
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Wayback CDX API | Capture lists | N | Free ✅ | Keyless, resumeKey, 150k max | 1 |
| Wayback Availability API | Closest snapshot | N | Free ◐ | | 1 |
| Save Page Now | Create snapshot | N (BYOK) / L | Free account ◐ | Lets users preserve evidence | 2 |
| archive.today | Snapshots | L | Free manual | No API, CAPTCHA, so never automate | 1 |
| Memento Time Travel | Cross-archive lookup | N ◐ | Free ◐ | Aggregates many archives | 2 |
| Arquivo.pt | PT web archive with API | N ◐ | Free ◐ | | 3 |
| UK Web Archive, Library of Congress | National archives | L | Free | | 2 |
| bellingcat auto-archiver | Archive social and web URLs | X/P | MIT ✅ | Evidence preservation | 3 |

### 3. Domain, DNS & WHOIS/RDAP
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| RDAP via IANA bootstrap | Registration data (structured) | N | Free ◐ | ICANN ended the gTLD WHOIS requirement in favour of RDAP (2025) ◐. Personal data mostly redacted | 1 |
| DNS-over-HTTPS JSON (Cloudflare, Google) | A/AAAA/MX/TXT/NS/CAA/SOA | N | Free ◐ | Works from the browser. Passive | 1 |
| DENIC (.de) | .de domain status | L | Free | Holder data not public | 1 |
| SecurityTrails | Historical DNS | L | Freemium ⚠ | Quota unverified | 1 (L) |
| DNSDumpster | DNS map | L | Freemium ◐ | | 1 (L) |
| dnstwist | Look-alike domain permutations | X | Free OSS ◐ | Resolves permutations (light active DNS) | 2 |
| ViewDNS.info | Reverse IP / WHOIS history | L | Freemium ◐ | | 1 (L) |

### 4. Certificates & subdomain discovery (passive)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| crt.sh | CT log search | N | Free ◐ | No SLA, often slow. Cache, and fall back to Cert Spotter | 1 |
| Cert Spotter API | CT issuances | N | 100/h free ✅ | | 1 |
| certstream | Live CT stream | X | MIT ✅ | Monitoring feature (phase 3) | 3 |
| subfinder | Passive subdomains | X | MIT ✅ | Many sources need their own keys | 2 |
| theHarvester | Passive hosts/emails | X | GPL-2.0 ✅ | Email harvesting needs minimisation | 2 |
| OWASP Amass | Passive and **active** enumeration | X (passive mode only) | Apache-2.0 ◐ | Active brute-force is ⛔ without authorisation | 3 |
| bbot | Recursive recon | X (passive presets) | AGPL ✅ | Active modules ⛔ by default | 4 |

### 5. Web reconnaissance (passive)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| urlscan.io | Page snapshot, requests, tech | N (search) / BYOK (scan) | Free plan ✅ | Public scans become public | 1 |
| Mozilla HTTP Observatory | Header and security grade | N ◐ | Free ◐ | Performs a scan of the site, a mild active check. User-initiated only | 2 |
| SSL Labs API | TLS config | N ◐ | Free with registration ◐ | Terms limit volume | 3 |
| BuiltWith / Wappalyzer | Tech fingerprint | L | Freemium ◐ | | 1 (L) |
| Photon | Crawler | X | GPL-3.0 ✅ | Crawls the target, so honour robots.txt | 4 |
| robots.txt / sitemap.xml / security.txt / humans.txt | Self-published metadata | N | Free | Fetched like a normal visitor | 1 |

### 6. IP, ASN & network
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| RIPEstat | Prefixes, routing, geo, abuse contact | N | Free ✅ | 8 concurrent per IP | 1 |
| IPinfo Lite | ASN and country | N / P (DB) | Free, commercial OK ✅ | CC BY-SA 4.0 | 1 |
| RIR RDAP (ARIN, RIPE, APNIC, LACNIC, AFRINIC) | Allocation, org | N | Free ◐ | | 1 |
| Team Cymru IP→ASN | ASN mapping | N ◐ | Free ◐ | DNS/whois interface | 2 |
| PeeringDB | Networks, IXPs, facilities | N ◐ | Free ◐ | | 2 |
| bgp.tools / bgp.he.net | BGP views | L | Free manual ◐ | | 1 (L) |
| MaxMind GeoLite | Geo | P | Free-key ✅ | Not for locating households ✅ | 3 |
| DB-IP Lite / IP2Location LITE | Geo | P | CC BY / CC BY-SA ◐ | | 3 |
| Shodan InternetDB | Ports, CVEs (cached) | N | NC ✅ | | 1 |
| Shodan (full) / Censys / Netlas / ZoomEye / FOFA | Scan data | L | Freemium/paid ✅/◐ | Censys Free has no API ✅ | 1 (L) |
| GreyNoise Community | Is it a scanner? | N (BYOK) / L | Tiny free ✅ | | 2 |
| AbuseIPDB | Abuse reports | N (BYOK) | 1,000/day ✅ | | 2 |
| Spamhaus DNSBL | Blocklist status | N ◐ | Free for low-volume, non-commercial ◐ | | 3 |
| RIPE Atlas | Measurements | X ◐ | Credits ◐ | Active measurement is phase 4 | 4 |

### 7. Threat intelligence & cybersecurity (defensive)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| abuse.ch URLhaus / MalwareBazaar / ThreatFox | IOCs | N | Free-key (mandatory) ✅ | | 2 |
| VirusTotal | File/URL/domain verdicts | N (BYOK) / L | NC, 500/day ✅ | No commercial products | 2 |
| AlienVault/LevelBlue OTX | Pulses, IOCs | N (BYOK) ◐ | Free-key ◐ | | 3 |
| CISA KEV | Exploited CVEs | N ◐ | Free, public domain ◐ | | 2 |
| NVD API · OSV.dev · FIRST EPSS | Vulnerabilities | N ◐ | Free ◐ | | 3 |
| MITRE ATT&CK (STIX) | TTP knowledge base | P ◐ | Free ◐ | | 3 |
| PhishTank / OpenPhish community | Phishing URLs | N ◐ | Free ◐ | | 2 |
| Google Safe Browsing | URL verdicts | N ◐ | Free, non-commercial ◐ | | 3 |
| MISP · OpenCTI · IntelOwl | TI platforms | X | AGPL/mixed ✅ | Integration targets (export) | 4 |
| Hybrid Analysis / ANY.RUN community | Sandboxes | L | Freemium ◐ | | 2 (L) |

### 8. Username & account discovery (**gated**)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| WhatsMyName data | Check definitions for 700+ sites | X/P | CC BY-SA 4.0 ✅ | Best curated dataset | 2 (R) |
| Maigret | About 5,900 sites, recursive | X (local companion) | MIT ✅ | Recursive mode is ⛔ by default (it snowballs into profiling) | 4 (R) |
| Sherlock | 400+ sites | X (local) | MIT ✅ | | 4 (R) |
| social-analyzer | 1,000+ sites, scoring | X | AGPL ✅ | | 4 (R) |
| Blackbird | Username and email | ⚠ | — | Repo moved, unverified | — |
| Namechk / instantusername | Availability | L | Free manual ◐ | | 2 |

*Constraint (inference):* a central server sending hundreds of requests per query to third-party sites is bulk automated access that many of those sites' terms forbid. Browsers block most of these cross-origin checks (CORS), so the realistic modes are **L** (launch per site) and **X on the user's own machine** (local companion), with results labelled "presence signal, not identity".

### 9. Email (no identity resolution)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Syntax and MX/SPF/DMARC (DoH) | Technical validity of the domain | N | Free | "Domain accepts mail", which is not "person exists" | 1 |
| Disposable-domain lists (OSS) | Throwaway detection | P ◐ | Free ◐ | | 1 |
| HIBP breach catalogue | Which breaches exist, data classes | N | Free ✅ | Email lookup is paid. Link the user to HIBP for their own address | 2 |
| keys.openpgp.org | Published, verified PGP keys | N ◐ | Free ◐ | Consent-based publication | 3 |
| Hunter.io / Phonebook.cz | Email patterns by domain | L | Freemium ◐ | Personal data, so restricted | R |
| Epieos | Account-linked info | — | ⚠ | Pricing not verifiable | ⛔ (L only, R) |
| holehe | Account existence via password-reset/registration flows | — | GPL ✅ | ⛔ Misuses auth flows, ToS conflict | ⛔ |
| GHunt | Google account data | — | ✅ | ⛔ Needs authenticated session cookies | ⛔ |
| Gravatar hash lookup | Avatar and profile from email hash | — | ◐ | ⛔ MVP (de-anonymisation vector) | ⛔ |
| Breach-data search engines (credential dumps) | Leaked records | — | — | ⛔ Never | ⛔ |

### 10. Phone (metadata only)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| libphonenumber | Country, type, validity, carrier of origin (some regions) | P | Apache-2.0 ✅ | Fully local | 1 |
| ITU-T E.164 assignments / Bundesnetzagentur number plan | Numbering ranges | N/P ◐ | Free ◐ | | 2 |
| PhoneInfoga | Dorks and metadata | X | GPL ✅ | Scanners scrape search engines. Use L instead | ⛔/L |
| Business directories (Gelbe Seiten, Das Örtliche, OpenStreetMap `phone=`) | Published *business* numbers | L / N (OSM) | Free | OSM tag search is lawful and open | 2 |
| Carrier/HLR lookup APIs | Live network status | — | Paid | ⛔ (cost, privacy) | ⛔ |
| Telegram/WhatsApp phone→account checkers | Account linkage | — | — | ⛔ | ⛔ |

### 11. People & public identity (**public-role only**)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Wikidata / Wikipedia | Notable-person facts with sources | N | Free ✅ | Identity anchor for public figures | 1 |
| ORCID public API | Researcher profiles (self-published) | N ◐ | Free ◐ | | 2 |
| OpenAlex authors | Publications, affiliations | N | Free ✅ | | 2 |
| abgeordnetenwatch | DE parliamentarians | N | CC0 ✅ | | 2 |
| Bundestag DIP | Printed matter, plenary records | N ◐ | Free, public key ◐ | | 2 |
| Lobbyregister (Bundestag) · EU Transparency Register | Lobbyists, clients, spending | N/L ◐ | Free ◐ | | 2 |
| LittleSis | US power networks | N ◐ | CC BY-SA ◐ | | 3 |
| Companies House officers / GLEIF | Officer roles (official) | N | Free ✅ | Minimise: role, appointment, company. No home data | 2 |
| IntelTechniques tools | Prepared people-search forms | L | Free ✅ | | R |
| Commercial people-search (Pipl, Spokeo, etc.) | Aggregated private profiles | — | Paid | ⛔ Conflicts with GDPR stance | ⛔ |

### 12. Social media & communities
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Bluesky (AT Protocol) | Public profiles and posts, open firehose | N ◐ | Free ◐ | Most open major network | 2 |
| Mastodon / Fediverse | Public posts per instance | N ◐ | Free ◐ | Respect each instance's policy. Many opt out of indexing | 3 |
| Reddit | Posts, comments | N (BYOK) / L | NC free ⚠ | Approval process ⚠ | 3 |
| YouTube Data API | Video and channel metadata | N | Free-key ✅ | | 2 |
| Hacker News API | Stories and comments | N ◐ | Free ◐ | | 2 |
| Stack Exchange API | Q&A, users | N ◐ | Free (key raises quota) ◐ | | 3 |
| X / Twitter | Posts | L | Paid API ◐ | | 1 (L) |
| Meta Content Library · TikTok Research API | Research access | — | Vetted researchers ◐ | Out of scope for a public product | ⛔ |
| DSA Art. 40 researcher access | VLOP data for systemic-risk research | — | Vetted researchers ◐ | Later partnerships | 4 |
| Meta Ad Library · Google Ads Transparency · DSA ad repositories (Art. 39) | Political and commercial ads | L / N ◐ | Free ◐ | Overlooked and valuable | 3 |
| DSA Transparency Database | Platforms' moderation decisions | N ◐ | Free ◐ | | 4 |
| Telegram (tgstat, etc.) | Channels | L | Free manual ◐ | | 2 (L) |
| LinkedIn / Instagram / Facebook / TikTok | Profiles | L | — | Scraping prohibited by ToS. Instagram scrapers (Osintgram, toutatis) ⛔ | 1 (L) |
| snscrape / twint | Scrapers | — | Stale/archived ✅ | ⛔ | ⛔ |

### 13. Image & visual OSINT
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Google Lens · Bing Visual · Yandex · TinEye web | Reverse image search | L | Free manual | The user uploads to them; the platform only links ◐ | 1 |
| TinEye API | Reverse search | — | Paid ◐ | Phase 4 optional | 4 |
| EXIF in browser (exifr-type libs, ExifTool) | Camera, time, GPS of *the user's file* | P | Free | Warn the user before showing GPS | 1 |
| imagehash / PDQ | Perceptual hash, duplicates | P | BSD / see repo ✅ | | 2 |
| InVID-WeVerify plugin | Keyframes, forensics, launchers | L / P | MIT ✅ | | 2 |
| Forensically · FotoForensics | ELA, clone detection | L | Free ◐ | Upload goes to the third party, so warn the user | 2 |
| Openverse API · Wikimedia Commons | Openly licensed images | N ◐ | Free ◐ | Provenance of CC images | 3 |
| PimEyes · FaceCheck.ID · face search of any kind | Biometric identification | — | — | ⛔ GDPR Art. 9; Clearview fined €30.5M by the Dutch DPA (2024) ✅ | ⛔ |

### 14. Video & audio
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| yt-dlp | Media and metadata of a public URL | X (local) | Unlicense ✅ | Platform ToS, copyright | 4 |
| FFmpeg / ffprobe | Keyframes, metadata | P | LGPL/GPL ◐ | | 3 |
| whisper.cpp | Transcription | P | MIT ✅ | Heavy, so local/WebGPU only | 4 |
| Chromaprint / AcoustID | Audio fingerprint | N (BYOK) ◐ | Free, non-commercial ◐ | | 4 |
| Internet Archive TV News · GDELT TV | Broadcast search | L/N ◐ | Free ◐ | | 3 |

### 15. Geolocation, GEOINT & maps
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| OpenStreetMap tiles/data | Base map, POIs | N | ODbL | Tile usage policy applies ◐ | 1 |
| Nominatim (public) | Geocoding | N (user-initiated, cached) | Free ✅ | ≤ 1 req/s app-wide. No autocomplete | 1 |
| Photon / self-hosted Nominatim | Geocoding at scale | X | Apache/GPL ✅ | Needs a server, so phase 4 | 4 |
| Overpass API | Feature queries | N (user IP) | Free ✅ | Not as an app-wide backend | 2 |
| overpass-turbo | Query UI | L | Free ✅ | | 1 |
| Copernicus Data Space (Sentinel-1/2) | Satellite imagery | L / N ◐ | Free registration ◐ | | 3 |
| NASA Worldview / GIBS | Daily imagery | L / N ◐ | Free ◐ | | 3 |
| Mapillary · KartaView | Street-level imagery | N ◐ / L | Free token, CC BY-SA ◐ | Faces and plates are blurred ◐ | 3 |
| Google Earth / Street View | Imagery | L | Free manual | | 1 |
| GeoNames | Gazetteer | N ◐ | CC BY 4.0, free account ◐ | | 2 |
| OpenHistoricalMap · historical map collections | Historical maps | L ◐ | Free | | 3 |
| SunCalc · PeakVisor | Shadow and terrain checks | L | Free manual | Verification aids | 2 |
| Open-Meteo historical | Weather on a date | N ◐ | Free, non-commercial ◐ | "Was it raining?" verification | 3 |
| basemap.de / BKG geodata | German official maps | N/L ◐ | Open licence ◐ | | 3 |

### 16. Documents, PDFs & file forensics
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| PDF/Office metadata (in-browser parsers, ExifTool) | Author, software, dates | P | Free | User's own files | 1 |
| Tesseract OCR | Text from scans | P | Apache-2.0 ◐ | WASM possible | 3 |
| Apache Tika | Text and metadata, many formats | X | Apache-2.0 ◐ | | 4 |
| Datashare | Local corpus search and NER | X (user-run) | AGPL ✅ | Recommend it, don't rebuild it | 4 |
| OpenAleph | Investigative document and entity platform | X/L | MIT ✅ | | 4 |
| DocumentCloud | Public document hosting | L ◐ | Free for newsrooms ◐ | | 2 |
| `filetype:` dorks | Public documents | L | Free | | 1 |

### 17. Code, GitHub & developer footprint
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| GitHub REST | Users, repos, orgs, releases | N | 60/h, 5,000/h with token ✅ | No commit-email harvesting at scale | 2 |
| GitLab · Codeberg/Gitea APIs | Same | N ◐ | Free ◐ | | 3 |
| deps.dev | Dependency graphs, advisories | N ◐ | Free ◐ | | 3 |
| Software Heritage | Archived source code | N ◐ | Free, rate-limited ◐ | | 3 |
| npm · PyPI · crates.io · Maven Central registries | Packages, maintainers | N ◐ | Free ◐ | | 3 |
| Libraries.io | Cross-registry | N ◐ | Free key ◐ | | 4 |
| Secret scanners (trufflehog, gitleaks) on third-party repos | Leaked credentials | — | — | ⛔ §202c StGB risk | ⛔ |

### 18. Companies & corporate intelligence
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| **Handelsregister.de** (DE) | Register extracts | L | Free manual | No API. ≤ 60 retrievals/h; mass automation flagged as potentially criminal (secondary) ⚠ | 1 (L) |
| Unternehmensregister · Bundesanzeiger (DE) | Filings, annual accounts | L ◐ | Free manual ◐ | | 1 (L) |
| Transparenzregister (DE) | Beneficial owners | L, R | Legitimate interest only since CJEU C-37/20 (2022) ✅ | Reform pending under AMLD6 ◐ | R |
| Insolvenzbekanntmachungen (DE) | Insolvencies | L | Free | §2 InsBekV: after 2 weeks, consumer searches need court plus name/residence/case number ✅. Never mirror | 2 (L) |
| Marktstammdatenregister (DE) | Energy installations and operators | N ◐ | Open data ◐ | | 3 |
| North Data (DE) | Register-derived graph | L | Freemium ◐ | Competitor | 1 (L) |
| GLEIF | LEI and parent chains | N | CC0 ✅ | | 1 |
| Companies House (UK) | Companies, officers, PSC | N | Free-key ✅ | | 2 |
| France: Recherche d'entreprises API / SIRENE | Companies | N ◐ | Free ◐ | | 2 |
| Norway Brreg · Denmark CVR · Czech ARES · Estonia e-Business | National registers | N ◐ | Free / open ◐ | | 3 |
| EU BRIS (e-Justice portal) | Cross-EU register search | L ◐ | Free ◐ | | 2 |
| SEC EDGAR (US) | Filings | N ◐ | Free, declared User-Agent, about 10 req/s ◐ | | 2 |
| OpenCorporates | 200M+ companies | L / N (if public-benefit access granted) | Paid API, free public-benefit ◐ | | 2 |
| ICIJ Offshore Leaks | Offshore entities | N | ODbL ✅ | Carry the "no implication of wrongdoing" caveat | 2 |
| OpenAleph instances / OCCRP Aleph Pro | Leak and registry collections | L | Aleph Pro paid ◐ | OCCRP OSS maintenance ended Dec 2025 ◐ | 2 (L) |

### 19. Government, legal & public records
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| TED (EU procurement) | Notices, awards | N | Free, keyless ✅ | | 2 |
| GovData.de · data.europa.eu | Open data catalogues (CKAN) | N ◐ | Free ◐ | | 2 |
| EUR-Lex | EU law | L / N ◐ | Web service needs registration ◐ | | 3 |
| CURIA | CJEU case law | L | Free | | 2 |
| rechtsprechung-im-internet.de · Open Legal Data | German case law | L / N ◐ | Free ◐ | | 3 |
| gesetze-im-internet.de | Federal statutes (XML) | N ◐ | Free ◐ | | 3 |
| FragDenStaat | FOI requests and documents | N ◐ | Free ◐ | Overlooked and high-value | 2 |
| EU FSF · OFAC SDN · UN · UK sanctions lists | Sanctions | N/P ◐ | Free official ◐ | Art. 10 GDPR caution | 2 |
| OpenSanctions | Consolidated sanctions and PEPs | N/P | CC BY-NC ✅ | | 2 |
| CourtListener (US) | Case law, PACER mirror | N ◐ | Free token ◐ | | 3 |
| Federal Register (US) · regulations.gov | Rules, comments | N ◐ | Free ◐ | | 4 |
| EPO OPS · DPMAregister · EUIPO TMview | Patents, trademarks | N ◐ / L | Free (OPS fair-use quota) ◐ | Overlooked | 3 |
| BaFin company database and warnings · FCA warning list | Licensed/unlicensed firms | L/N ◐ | Free ◐ | Fraud checks | 2 |

### 20. Academic & scientific
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| OpenAlex | Works, authors, institutions | N | Free ✅ | | 2 |
| Crossref | DOI metadata | N | Free ✅ | | 2 |
| Semantic Scholar | Papers, citations | N | Free ✅ | | 3 |
| ORCID · DataCite · Zenodo | Researchers, datasets | N ◐ | Free ◐ | | 3 |
| arXiv · Europe PMC · PubMed E-utilities · CORE · DOAJ · BASE · dblp · Unpaywall | Literature | N ◐ | Free ◐ | Each has published etiquette | 3 |

### 21. Knowledge graphs & open databases
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Wikidata (entity API, SPARQL) | Structured facts, identifiers | N | CC0 ✅ | Use QIDs as cross-source identity keys | 1 |
| Wikipedia / MediaWiki | Summaries, references | N | CC BY-SA ✅ | User-Agent policy | 1 |
| DBpedia · YAGO | Derived KGs | N ◐ | Open ◐ | | 4 |
| GeoNames · OSM | Places | N | Open | | 2 |
| Europeana · Deutsche Digitale Bibliothek · Chronicling America | Cultural heritage | N ◐ | Free key ◐ | | 4 |

### 22. News & media
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| GDELT DOC/GEO | Global news mentions | N | Free, cite ✅ | | 2 |
| RSS/Atom autodiscovery | Publisher feeds | N | Free | | 2 |
| Google News · Bing News | News search | L | Free manual | | 1 |
| Media Cloud | News corpus | N ◐ | Free account ◐ | | 4 |
| Google Fact Check Tools API (ClaimReview) | Fact-checks | N ◐ | Free key ◐ | "Has this claim been checked?" | 3 |
| EUvsDisinfo database | Disinformation cases | L ◐ | Free | | 3 |

### 23. Cryptocurrency & blockchain
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| mempool.space / Esplora | BTC addresses, txs | N / X | Free, rate-limited ✅ | | 2 |
| Etherscan (+ multichain v2) | EVM data | N (BYOK) | 100k/day free ✅ | | 3 |
| Blockchair | Multichain | L / N ◐ | Freemium ◐ | | 3 |
| Chainabuse | Scam reports | L ◐ | Free ◐ | | 2 |
| OFAC SDN digital-currency addresses | Sanctioned addresses | P | Free ◐ | | 2 |
| Address clustering / identity attribution | Who owns a wallet | — | — | ⛔ Only show public labels from cited sources | ⛔ |

### 24. Aviation, maritime, transport & infrastructure
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| adsb.lol | ADS-B, open | N | ODbL ✅ | Respect privacy programmes (LADD/PIA) ◐ | 3 |
| OpenSky | ADS-B history | N (BYOK) | NC ◐ | | 3 |
| ADS-B Exchange · Flightradar24 · FlightAware | Flights | L | Commercial ◐ | | 1 (L) |
| FAA aircraft registry (download) | US tail numbers | P ◐ | Free ◐ | | 3 |
| Global Fishing Watch | Vessel identity and events | N (key) | Free ✅ | | 3 |
| MarineTraffic · VesselFinder | AIS | L | Freemium | | 1 (L) |
| Equasis | Ship safety, ownership | L ◐ | Free registration ◐ | | 2 (L) |
| Mobility Database (GTFS) | Transit feeds | N ◐ | Free ◐ | | 4 |
| OpenInfraMap (OSM) | Power, telecoms, pipelines | L | Free | | 2 |

### 25. Scams, fraud & consumer protection
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Verbraucherzentrale Fakeshop-Finder | Fake-shop check (DE) | L ◐ | Free | | 2 |
| Watchlist Internet (AT) | Scam warnings | L ◐ | Free | | 2 |
| BaFin warnings · FCA warning list · IOSCO I-SCAN | Unlicensed investment firms | L/N ◐ | Free | | 2 |
| ScamAdviser | Trust score | L ◐ | Freemium | | 2 |
| CT look-alike detection (our own) | New certs for look-alike names | N | Free | Built from Cert Spotter/crt.sh plus permutations | 3 |
| Chainabuse · urlscan · PhishTank · URLhaus | Reports | N/L | Free | | 2 |

### 26. Dark-web research (research and reporting only)
| Source | Gives | Mode | Cost | Notes | Phase |
|---|---|---|---|---|---|
| Ahmia (clearnet) | Search of Tor onion services, abuse-filtered | L ◐ | Free | | 3 (L) |
| Tor Metrics | Network statistics | N ◐ | Free | | 4 |
| ransomware.live | Public ransomware leak-site tracker | L ◐ | Free/freemium ◐ | Victim names, so handle carefully | 4 (L) |
| Direct onion crawling, marketplaces, leak downloads | — | — | — | ⛔ | ⛔ |

### 27. OSINT automation frameworks
SpiderFoot (MIT, 200+ modules) · recon-ng (GPL-3.0) · theHarvester · bbot · Flowsint (Apache-2.0, early) · Maltego CE (limited, proprietary) · IntelOwl · OpenCTI · MISP · Datashare · OpenAleph · followthemoney (data model). All ✅ via GitHub API except Maltego. **Use:** treat them as modules to reference, as schemas to borrow (followthemoney), or as export targets (MISP/STIX, FtM, Maltego CSV). Don't run them centrally in the €0 phase.

### 28. Directories & learning resources
| Resource | What it is | Reuse | Status |
|---|---|---|---|
| [OSINT Framework](https://osintframework.com) / [repo](https://github.com/lockfale/OSINT-Framework) | Tree of free tools. Per-tool `arf.json` metadata: status, pricing, input/output, opsec, registration/API flags. New detail panels and community rating. Legend: T local tool, D dork, R registration, M manual URL | **MIT**, so it can seed the registry with attribution ✅ | 12.3k★, pushed 2026-10-10 |
| [awesome-osint](https://github.com/jivoi/awesome-osint) | 60 categories of links | Licence file present, type unstated ⚠ | 30.3k★ |
| [Bellingcat Toolkit](https://bellingcat.gitbook.io/toolkit) | 12 categories, in-depth tool reviews, named maintainers | Licence unstated, so link, don't copy ⚠ | ✅ |
| [cipher387 osint_stuff_tool_collection](https://github.com/cipher387/osint_stuff_tool_collection) | 1,000+ tools | **No licence**, so links only | ✅ |
| [IntelTechniques tools](https://inteltechniques.com/tools/) | Search forms | Free to use, so link | ✅ |
| Berkeley Protocol (UN OHCHR/HRC Berkeley) | Standard for digital open-source investigations | Methodology reference ◐ | ◐ |
| GIJN resource center · Trace Labs · OSINT Dojo · Bellingcat guides | Training and method | Link | ◐ |
| [Champagne Wiki](https://champagne.pages.dev) / [repo](https://github.com/champagnewiki/champagne-wiki) (shared by you) | Human-curated general resource archive (MDX, Cloudflare Pages). Mostly entertainment, **piracy guides**, Windows activation. Does not cover OSINT | **No licence file** ⚠. Use only as **UX inspiration** for curation, category cards and dead-link reporting. Do not ingest: the piracy content creates liability for a German operator | ✅ |

### 29. Overlooked categories that add real value
| Category | Why it matters | Best free source | Phase |
|---|---|---|---|
| Political ads and DSA ad repositories | Who pays for persuasion | Meta Ad Library, Google Ads Transparency, DSA Art. 39 repositories ◐ | 3 |
| Lobbying | Influence mapping | Lobbyregister, EU Transparency Register | 2 |
| FOI documents | Primary government records | FragDenStaat, MuckRock (US) ◐ | 2 |
| Procurement | Money flows to companies | TED ✅ | 2 |
| Patents and trademarks | Corporate R&D, brand ownership | EPO OPS, TMview ◐ | 3 |
| Environmental/emissions registries | Facility-level data | EEA Industrial Emissions portal ◐ | 4 |
| Weather and sun on a date | Verifying images and claims | Open-Meteo, SunCalc | 3 |
| Content moderation transparency | Platform takedown data | DSA Transparency Database ◐ | 4 |
| Financial regulators' registers | Licensed vs fraudulent | BaFin, FCA, ESMA registers ◐ | 2 |
| Fact-check corpus | Has this already been debunked? | ClaimReview / Fact Check Tools API ◐ | 3 |

---

## Part 3 — Overlap & complement map

| Need | Overlapping tools | Recommended primary | Complement / fallback |
|---|---|---|---|
| Subdomains | crt.sh, Cert Spotter, subfinder, amass (passive), SecurityTrails, DNSDumpster | Cert Spotter + crt.sh (N) | subfinder via user keys (X, phase 2+) |
| Domain registration | RDAP, WHOIS sites, ViewDNS | RDAP (N) | L to history providers |
| Historical web | Wayback, archive.today, Memento, Common Crawl | Wayback CDX (N) | Memento (N), archive.today (L) |
| IP context | RIPEstat, IPinfo Lite, RDAP, InternetDB, GreyNoise, AbuseIPDB | RIPEstat + IPinfo Lite | InternetDB (exposure), BYOK reputation |
| Username presence | WhatsMyName, Maigret, Sherlock, social-analyzer | WhatsMyName data (definitions) | Maigret on local companion |
| Company identity | GLEIF, national registers, OpenCorporates, Wikidata | GLEIF + national open APIs | L to Handelsregister/North Data |
| Sanctions/PEP | OpenSanctions, official lists | Official lists (N/P) + OpenSanctions (NC) | |
| Reverse image | Google Lens, Bing, Yandex, TinEye | L to all four in one click | Local EXIF/hash (P) |
| Leaks & offshore | ICIJ, OpenAleph, Aleph Pro | ICIJ (N) | L to Aleph instances |
| Threat intel | VT, abuse.ch, OTX, urlscan | abuse.ch + urlscan (N) | VT/OTX BYOK |
| Academic | OpenAlex, Crossref, S2, ORCID | OpenAlex | Crossref for DOIs, ORCID for identity |
| Frameworks | SpiderFoot, recon-ng, bbot, Flowsint, Maltego | — (the product *is* the orchestration layer) | Export to FtM/STIX/Maltego CSV |

---

## Part 4 — Commercial tools vs free alternatives

| Commercial | What you pay for | Best free alternative(s) | Gap that remains |
|---|---|---|---|
| Maltego Pro/Enterprise | Graph UI plus paid transforms | Flowsint (Apache-2.0), SpiderFoot, the product's own graph | Paid data transforms |
| SpiderFoot HX (Intel 471) | Hosted, scheduled, team features | SpiderFoot OSS (MIT) | Hosting and scheduling |
| OSINT Industries / Epieos | Email/phone→account lookups | None that is ethical. **Deliberately not replicated** | — (intentional) |
| Shodan paid / Censys paid | Full scan data, history, API | InternetDB (NC), Censys Free web, user's own keys | Banners, history |
| SecurityTrails / DomainTools | Historical DNS/WHOIS | Wayback, CT logs, RDAP | Passive DNS history (no good free source) |
| OpenCorporates API | Normalised global companies | GLEIF + national open APIs + Wikidata | Coverage of non-open registries |
| Aleph Pro / Sayari / Orbis | Corporate graphs and leaks | ICIJ, OpenSanctions, OpenAleph, GLEIF | Proprietary datasets |
| TinEye API / Google Vision | Programmatic reverse image | Launch pads + local hashing | Automated web-scale image search |
| Hunchly | Capture and evidence logging | Built-in evidence ledger + Save Page Now + auto-archiver | Browser-capture fidelity |
| Flightradar24 / MarineTraffic | Live tracking | adsb.lol, OpenSky, Global Fishing Watch | AIS global coverage |
| Chainalysis / TRM | Wallet attribution | Public explorers + OFAC addresses | Attribution (intentionally out of scope) |
| Pipl / people-search | Private-person dossiers | — | **Out of scope by design** |
| Paid search APIs | Programmatic web search | L to engines, user-run SearXNG, Brave BYOK | No free automated web search exists in 2026 |
