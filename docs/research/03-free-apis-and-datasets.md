# D — Free API & Open Dataset Report

Snapshot date: **2026-10-17**. Legend: ✅ verified on the official page today · ◐ official docs/secondary, re-verify · ⚠ conflicting · ⛔ excluded.

"Free" is split into five kinds, and the product must never blur them:

| Kind | Meaning | Example |
|---|---|---|
| **Open data** | Downloadable, licence allows reuse | GLEIF (CC0), abgeordnetenwatch (CC0), GDELT, ICIJ Offshore Leaks (ODbL) |
| **Keyless free API** | Callable with no account, usually with fair-use limits | Wayback CDX, RIPEstat, Shodan InternetDB, TED search, OpenAlex (basic) |
| **Free-key API** | Free account or key, hard quota | Companies House, YouTube Data API, GitHub (auth), abuse.ch, Global Fishing Watch |
| **Freemium / credit** | A small free allowance inside a paid product. Can disappear or need a card | Censys, urlscan.io, Brave Search, Cert Spotter, Etherscan |
| **Free manual tool** | A website people use by hand. No automation allowed or offered | Handelsregister.de, Google Lens, TinEye web, Yandex Images |

---

## 1. Verified free APIs and datasets (best candidates for native integration)

| Source | Category | Kind | Key? | Verified limits / terms | Commercial use | Notes | Status |
|---|---|---|---|---|---|---|---|
| [Wayback CDX API](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server) | Archives | Keyless | No | Supports filter, collapse, pagination and resumeKey. Default server max is 150,000 rows per query. No public rate limit is documented | Not stated | The backbone of "what did this page say before". Throttle politely | ✅ |
| [RIPEstat Data API](https://stat.ripe.net/docs/data_api) | IP/ASN/BGP | Keyless | No | "No limit" on request count, but at most 8 concurrent requests per IP. Register a `sourceapp` above 1,000 requests a day | RIPE Terms apply | Excellent free infrastructure source | ✅ |
| [IPinfo Lite](https://ipinfo.io/lite) | IP | Free-key API + dataset | Token for API | Unlimited requests. ASN, AS name, AS domain, country, continent. Updated daily | **Allowed**, with attribution | CC BY-SA 4.0. The only verified unlimited, commercial-OK IP→ASN/country source | ✅ |
| [Shodan InternetDB](https://internetdb.shodan.io/) | Exposure | Keyless | No | Ports, CPEs, vulns, hostnames, tags. Refreshed weekly | **Non-commercial only**. Monetised use needs an enterprise licence | Passive only. Never adds active scanning | ✅ |
| [Cert Spotter / SSLMate CT Search API](https://sslmate.com/ct_search_api/) | CT logs | Freemium | Optional | $0 plan: 100 single-hostname and 10 full-domain queries per hour. Unauthenticated use is limited to personal/evaluation use | Account needed for production | Stable alternative to crt.sh | ✅ |
| [Companies House API](https://developer.company-information.service.gov.uk/developer-guidelines) | Companies (UK) | Free-key | Yes | 600 requests per 5 minutes. Persistent over-use can lead to a ban | Allowed (UK OGL data) ◐ | Officers, filings, PSC. Contains personal data, so apply minimisation | ✅ |
| [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) | Companies (global) | Keyless ◐ | No ◐ | Page states free search. Data licensed **CC0** | Yes (CC0) | Parent and child relationships give a free corporate graph | ✅ licence / ◐ API limits |
| [OpenAlex](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication) | Academic | Keyless + free key | Optional | 10 req/s without a key, 30 req/s with a free key. Cost-based daily budget ($1/day for a free key, 10× the keyless budget). 429 when exceeded | CC0 data ◐ | Budget model introduced 2025–26. Cache aggressively | ✅ |
| [Semantic Scholar API](https://www.semanticscholar.org/product/api) | Academic | Keyless + key | Optional | Shared pool of 1,000 req/s across all unauthenticated users. Introductory key limit 1 req/s | API licence agreement | ✅ |
| [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | Academic | Keyless | No | Free. Back off on 429. A "polite pool" with mailto is documented elsewhere ◐ | Metadata openly shared | ✅ free / ◐ limits |
| [GitHub REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) | Code | Keyless + token | Optional | 60 requests/hour unauthenticated (per IP). 5,000/hour with a token. Search has stricter limits | GitHub ToS | Strong case for users bringing their own token | ✅ |
| [YouTube Data API v3](https://developers.google.com/youtube/v3/getting-started) | Social / video | Free-key | Yes | 10,000 units/day, plus a separate default of 100 `search.list` calls/day | Google API ToS | Public video metadata only | ✅ |
| [TED API](https://docs.ted.europa.eu/api/latest/index.html) | EU procurement | Keyless | **No** for search | Anonymous access to published notices | EU reuse policy ◐ | Who won which public contract, in all EU states | ✅ |
| [abgeordnetenwatch API](https://www.abgeordnetenwatch.de/api) | DE politics | Keyless | No | 30 requests/min per IP. Bulk downloads preferred 22:00–06:00 | **CC0** | Members of parliament, votes, side jobs, questions | ✅ |
| [GDELT](https://www.gdeltproject.org/about.html) | News events | Open data | No | Free with no restriction on academic, commercial or government use. **Must cite and link GDELT** | Yes | Global news graph back to 1979 | ✅ |
| [ICIJ Offshore Leaks DB](https://offshoreleaks.icij.org/pages/database) | Offshore entities | Open data + API | No | ODbL database, CC BY-SA 3.0 contents. REST schema and **Reconciliation API** | Yes, with share-alike and attribution | Must carry ICIJ's caveat that appearing in the data does not imply wrongdoing | ✅ |
| [abuse.ch](https://abuse.ch/blog/community-first/) (URLhaus, MalwareBazaar, ThreatFox) | Threat intel | Free-key | **Yes, mandatory since 2025-06-30** | Auth-Key in header. Free sign-in through an existing GitHub/Google/X/LinkedIn account | Check ToU ◐ | IOCs, malware, phishing URLs | ✅ |
| [urlscan.io](https://urlscan.io/pricing/) | Web recon | Freemium | Yes | Free plan per day: 5,000 public scans, 1,000 unlisted, 50 private, 1,000 searches, 10,000 result fetches | Not stated on pricing page ⚠ | A public scan publishes the URL. Default users to search, not scan | ✅ |
| [AbuseIPDB](https://www.abuseipdb.com/pricing) | IP reputation | Freemium | Yes | 1,000 IP checks and reports per day combined. 100 block checks | ⚠ check ToU | ✅ |
| [GreyNoise Community](https://docs.greynoise.io/docs/using-the-greynoise-community-api) | IP noise | Keyless / free | Optional | About 10 lookups/day unauthenticated. 50/week for business-email accounts | ⚠ | Shows whether an IP is mass-scanning the internet. Too small for a shared backend, so use BYOK or Mode 3 | ✅ |
| [VirusTotal Public API](https://docs.virustotal.com/reference/public-vs-premium-api) | Threat intel | Free-key | Yes | 4 requests/min, 500/day | **Must not be used in commercial products or services** | BYOK only. A non-commercial project may still need permission | ✅ |
| [MaxMind GeoLite](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/) | IP geo | Free-key dataset | Account | 30 downloads/day, 1,000 web lookups/day per service. EULA requires deleting old DBs within 30 days. **Must not be used to identify an address or household** | EULA | IPinfo Lite is simpler for country/ASN | ✅ |
| [Censys](https://docs.censys.com/docs/platform-credits-free-starter) | Internet scan | Freemium | Account | 100 credits/month. Free tier is **web only, no API**, one result page | — | Mode 3 (launch) only | ✅ (docs via search) |
| [Etherscan](https://docs.etherscan.io/resources/rate-limits) | Blockchain | Free-key | Yes | 3 calls/s, 100,000/day, selected chains only | Not stated ⚠ | BYOK | ✅ |
| [mempool.space REST](https://mempool.space/docs/api/rest) | Bitcoin | Keyless | No | Rate-limited, with bans for repeat violators. Self-hostable (open source) | — | Esplora (MIT) is a self-host alternative | ✅ |
| [adsb.lol API](https://www.adsb.lol/docs/open-data/api/) | Aviation | Keyless ◐ | No ◐ | "Available to everyone". **ODbL 1.0** | Yes (share-alike) | Open alternative to ADS-B Exchange | ✅ |
| [Global Fishing Watch APIs](https://globalfishingwatch.org/our-apis/) | Maritime | Free-key | Yes (application) | Vessel identity, events, AIS presence, SAR detections. Attribution required | ⚠ check ToU | ✅ |
| [OpenSky Network](https://opensky-network.org) | Aviation | Keyless + account | Optional | 400 credits/day anonymous (official docs mirror). About 4,000/day registered (secondary) | **Non-commercial/research** ◐ | OAuth2 since 2026 reported ◐ | ◐ |
| [Wikimedia APIs](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) | Knowledge | Keyless | No | **Descriptive User-Agent required.** From browsers, send an `Api-User-Agent` header. Generic agents get 403 | CC BY-SA content | ✅ |
| [Wikidata Query Service](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/query_limits) | Knowledge graph | Keyless | No | Hard timeouts. The page notes the service "much less responsive" as of 2026-05 | CC0 data | Prefer the entity API and dumps for heavy use | ✅ |
| [Nominatim (OSMF)](https://operations.osmfoundation.org/policies/nominatim/) | Geocoding | Keyless | No | **≤ 1 req/s for the whole application**, combined across all users. No autocomplete, no systematic or grid queries, no bulk. Must cache. Policy explicitly addresses LLM-generated code and no-code platforms | ODbL data | Self-host or use Photon (Apache-2.0) for real traffic | ✅ |
| [Overpass API (public)](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) | OSM queries | Keyless | No | About 10,000 requests/day and 1 GB/day per user. 180 s default timeout. **Must not be the backend for an app with a wide audience** | ODbL | Fine for user-initiated, user-IP queries. Not for a central relay | ✅ |
| [libphonenumber](https://github.com/google/libphonenumber) | Phone | Library | — | Runs locally. Parse, validate, region, number type, original carrier for some regions | Apache-2.0 | Local processing, so no third party sees the number | ✅ |

## 2. Free open-source engines that can run inside or beside the product

| Project | Licence (GitHub API) | Last push | Stars | Use |
|---|---|---|---|---|
| [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) data | CC BY-SA 4.0 (README) | 2026-10-15 | 2.9k | Username-presence dataset for 700+ sites. The best *data* source for a username checker |
| [Maigret](https://github.com/soxoj/maigret) | MIT | 2026-10-14 | 39.2k | Checks about 5,900 sites, recursive, reports |
| [Sherlock](https://github.com/sherlock-project/sherlock) | MIT | 2026-10-17 | 94.3k | Checks 400+ sites. Note the name clash with this project |
| [SpiderFoot](https://github.com/smicallef/spiderfoot) | MIT | 2026-04-13 | 23.6k | 200+ modules, correlation rules |
| [Flowsint](https://github.com/reconurge/flowsint) | Apache-2.0 | 2026-10-03 | 9.8k | Graph-first OSINT, "early development" |
| [followthemoney](https://github.com/alephdata/followthemoney) | MIT | 2026-02-28 | 0.3k | **Entity data model** used by Aleph, OpenSanctions and OpenAleph. Strong candidate for the normalised findings schema |
| [OpenSanctions](https://github.com/opensanctions/opensanctions) (code) | MIT (code) / CC BY-NC (data) | 2026-10-16 | 0.8k | Crawlers for sanctions and PEP lists |
| [OpenAleph](https://github.com/openaleph/openaleph) | MIT | 2026-10-11 | 0.1k | Community fork after OCCRP ended open-source Aleph maintenance (Dec 2025) |
| [Datashare](https://github.com/ICIJ/datashare) | AGPL-3.0 | 2026-10-16 | 0.8k | Local document search and NER, ICIJ |
| [SearXNG](https://github.com/searxng/searxng) | AGPL-3.0 | 2026-10-17 | 38.5k | Self-hostable metasearch. See the ToS caveat in the discovery document |
| [subfinder](https://github.com/projectdiscovery/subfinder) | MIT | 2026-10-14 | 14.6k | Passive subdomain aggregation |
| [theHarvester](https://github.com/laramies/theHarvester) | GPL-2.0 | 2026-10-17 | 18.0k | Passive domain/email/host gathering |
| [bbot](https://github.com/blacklanternsecurity/bbot) | AGPL-3.0 | 2026-10-17 | 10.7k | Recursive recon. Contains **active** modules, so scope control is required |
| [PhoneInfoga](https://github.com/sundowndev/phoneinfoga) | GPL-3.0 | 2026-08-25 | 18.2k | Phone footprinting via dorks and number metadata |
| [ExifTool](https://github.com/exiftool/exiftool) | GPL-3.0 / Artistic | 2026-05-27 | 5.2k | The reference metadata extractor |
| [imagehash](https://github.com/JohannesBuchner/imagehash) | BSD-2 | 2026-10-12 | 3.9k | Perceptual hashing |
| [ThreatExchange (PDQ/TMK)](https://github.com/facebook/ThreatExchange) | see repo ⚠ | 2026-10-16 | 1.4k | Robust image and video hashing |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense | 2026-10-10 | 198.7k | Local media acquisition. Platform ToS apply |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | 2026-10-12 | 54.4k | Local transcription |
| [Nominatim](https://github.com/osm-search/Nominatim) / [Photon](https://github.com/komoot/photon) | GPL-3.0 / Apache-2.0 | 2026-10 | — | Self-host geocoding |
| [Esplora](https://github.com/Blockstream/esplora) | MIT | 2026-10-07 | 1.3k | Self-host block explorer |
| [IntelOwl](https://github.com/intelowlproject/IntelOwl) · [MISP](https://github.com/MISP/MISP) · [OpenCTI](https://github.com/OpenCTI-Platform/OpenCTI) | AGPL / AGPL / mixed | 2026-10 | — | Threat-intel enrichment and sharing |
| [bellingcat auto-archiver](https://github.com/bellingcat/auto-archiver) | MIT | 2026-09-10 | 1.1k | Evidence preservation |
| [InVID-WeVerify plugin](https://github.com/AFP-Medialab/verification-plugin) | MIT | 2026-10-15 | — | Keyframes, reverse-search launchers, forensics |
| [WebLLM](https://github.com/mlc-ai/web-llm) | Apache-2.0 | — | — | In-browser LLM inference (WebGPU), JSON mode |

**Stale or archived (do not depend on):** twint (archived 2023), snscrape (last push 2023-11), Maryam (archived), holehe (last push 2024-09, and excluded for ethical reasons anyway).

## 3. "Free" services that are **not** free, or no longer free, for this use case

| Service | Reality (verified 2026-10-17) | Consequence |
|---|---|---|
| Google Custom Search JSON API | **Closed to new customers. Existing customers must migrate by 2027-01-01.** 100 queries/day were free ✅ | No free programmatic Google search. Mode 3 links only |
| Bing Search APIs | **Retired 2025-08-11**, including Bing Custom Search ✅ (Microsoft lifecycle notice) | Gone |
| Brave Search API | Monthly free credit (about $5), but **a credit card is required**. Storing results needs a plan with storage rights ✅ | Not strict €0. Optional BYOK |
| Mojeek API | Pay-as-you-go from £2 per 1,000 requests. One-off free credit, card required ✅ | Not free |
| X (Twitter) API | Pay-per-use. Posts read about $0.005 per resource (official docs per search) ◐ | Not free. Mode 3 only |
| Reddit Data API | Free for eligible non-commercial use at about 100 QPM per OAuth client. New-app approval reportedly manual (secondary) ⚠ | BYOK/approval or Mode 3 |
| HIBP | Breach catalogue and Pwned Passwords are free. **Searching an email is paid.** Domain search only for verified, owned domains ✅ | Show breach *catalogue* context only. Link to HIBP for a user's own email |
| OpenCorporates API | Paid tiers from £2,250/yr. Free for qualifying public-benefit users (journalists, NGOs, academics) by application ◐ | Apply for public-benefit access. Otherwise GLEIF plus national registries |
| Maltego | Community Edition is free with caps (figures conflict between sources ⚠). Professional costs thousands per year | Not a dependency |
| OSINT Industries | Credit packs, roughly £19–99/month (secondary) ◐ | Competitor, not a source |
| Censys | 100 credits/month, web only, no API on Free ✅ | Mode 3 |
| TinEye API | Paid. Web search is free and manual ◐ | Mode 3 |
| Google Gemini API free tier | Unpaid-tier data may be used for improvement and seen by human reviewers. **For EEA/CH/UK, apps offered to users may only use Paid Services** ✅ | Cannot be the free LLM of an EU-facing public product |
| Cloudflare Workers AI | 10,000 Neurons/day free. Hard fail beyond ✅ | Usable as a small, optional, shared fallback |
| OpenSanctions data | CC BY-NC 4.0. Commercial use needs a licence. API has free credits on sign-up ✅/◐ | Fine for a non-commercial €0 project with attribution |
| Handelsregister.de | Free to use manually. **No API.** Terms cap retrievals at 60/hour, and automated mass querying is flagged as potentially criminal (secondary sources) ⚠ | Mode 3 deep links only |
| Vercel Hobby hosting | **Non-commercial personal use only.** Donations allowed ✅ | Fine for a non-commercial project, risky otherwise |
| GitHub Pages | 1 GB site, about 100 GB/month soft bandwidth. Not for commercial SaaS ✅ | Fine for a static, non-commercial front end |
| Cloudflare Workers Free | 100,000 requests/day, **10 ms CPU** per request, 50 subrequests ✅ | Enough for a thin relay. Not for heavy tools |

## 4. Open datasets worth mirroring locally (lawfully, with licence)

| Dataset | Licence | Why mirror |
|---|---|---|
| GLEIF Golden Copy | CC0 | Offline company and parent lookup, no quota |
| IPinfo Lite DB | CC BY-SA 4.0 | Offline IP→ASN/country, fully client-side possible |
| WhatsMyName `wmn-data.json` | CC BY-SA 4.0 | Username-check definitions |
| OSINT Framework `arf.json` | MIT | Seed for the tool registry, already has pricing/opsec/input/output metadata |
| ICIJ Offshore Leaks | ODbL / CC BY-SA | Entity reconciliation |
| OpenSanctions (non-commercial) | CC BY-NC 4.0 | Sanctions and PEP screening. **PEP data is personal data.** See legal section |
| Wikidata subsets | CC0 | Public-figure and organisation identity anchor |
| OSM extracts (Geofabrik) | ODbL | Self-hosted geocoding and POIs instead of the public Nominatim |
| abgeordnetenwatch | CC0 | German political actors |
| GDELT | Free, cite | News event graph |
| Public sanctions lists (EU FSF, OFAC SDN, UN, UK) | Official, mostly free ◐ | Primary source behind OpenSanctions |
