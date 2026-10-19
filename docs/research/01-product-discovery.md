# Indizia — Product Discovery Document

*Working title. See the naming decision in §J.4. Research snapshot: 2026-10-17. Companion files: [02 Source catalog](02-source-catalog.md), [03 Free APIs](03-free-apis-and-datasets.md).*

---

## Executive summary

**What it should be:** a single search box for the public internet's investigative layer. You type a domain, company, IP, username, coordinate, hash, DOI, image or plain question. Indizia detects what it is, runs every permitted free source it can, shows each finding with its evidence, and says plainly what it searched, what it couldn't search, and why. Beneath that box sits a living, machine-readable registry of the whole OSINT ecosystem, which also powers the search.

**Three research findings shape everything:**

1. **Free programmatic web search no longer exists.** Google's Custom Search JSON API is closed to new customers and ends on 2027-01-01. Bing's Search APIs were retired on 2025-08-11. Brave needs a card, and Mojeek is paid. A "free Google for OSINT" cannot be built by wrapping Google. The free native strength is **structured sources**: RDAP, DNS, certificate transparency, Wayback, RIPEstat, IPinfo Lite, GLEIF, Wikidata, OpenAlex, TED, GDELT, ICIJ, abuse.ch and national company registers. General web search becomes prepared **launch pads**.
2. **Many "free" sources are free only for non-commercial use, or only up to an app-wide quota.** VirusTotal, Shodan InternetDB, OpenSanctions, OpenSky and Vercel Hobby are non-commercial. Nominatim allows 1 request per second for the whole application. Overpass forbids acting as the backend for a wide audience. So the €0 model must be **non-commercial**, **cache-heavy**, and **user-executed** where it can: queries run from the user's browser, on the user's quota, under the user's keys.
3. **The defensible gap is honesty, not more data.** Directories (OSINT Framework, awesome-osint, Bellingcat) are static links. Frameworks (SpiderFoot, recon-ng, bbot, Flowsint) are self-hosted and technical. Commercial tools (Maltego, OSINT Industries, Aleph Pro) are paid black boxes. **No product combines one box, a live tool registry, evidence-first results, and an explicit coverage ledger.** That combination, plus built-in ethics, is the product.

**The MVP is not a people-search engine.** It starts with infrastructure, organisations, public records, archives and open knowledge, where value is high and legal risk is low. Person, username, email and phone inputs launch in a restricted, transparent form.

---

## A. Product vision

### A.1 Statement
> **Indizia is the open front door to public-source research: one box, every permitted public source, and a complete account of what was and wasn't searched.**

### A.2 Who it serves
| Segment | Job to be done | Typical inputs |
|---|---|---|
| Journalists and fact-checkers | Verify a claim, company, image or website fast, with citations | company, domain, image, URL, place |
| Researchers and students | Learn OSINT methods, find the right tool, reproduce a method | questions, tool names |
| Defensive security / CTI | Passive context on domains, IPs, IOCs | domain, IP, hash, URL |
| Fraud and consumer protection | Is this shop, investment firm or crypto address legit? | URL, company, wallet |
| NGOs and anti-corruption | Follow money: companies, procurement, lobbying, sanctions | company, LEI, person in a public role |
| Compliance (non-commercial or public interest) | Sanctions and registry checks | company, name in a public role |

**Not served, by design:** finding a private person's home, contact details or movements. Linking a person's accounts for harassment. Credential or breach searching.

### A.3 Problem
The free OSINT ecosystem is huge but fragmented. Thousands of tools, each with its own input format, quota, terms, failure modes and half-life. Users must know which tool exists, whether it still works, whether automation is allowed, how to combine results, and how to cite them. Most time is spent on routing and bookkeeping, not on thinking.

### A.4 Why it should exist
- **Routing is solvable.** A registry plus entity detection can pick the right sources automatically.
- **Bookkeeping is solvable.** Provenance, timestamps, a coverage ledger and an exportable report.
- **Honesty is missing.** No tool today tells you "these 9 sources were queried, 3 were rate-limited, 6 can only be opened manually, 2 are excluded for legal reasons".
- **Free and open** matters for journalists and NGOs, who are priced out of Maltego, OSINT Industries and Aleph Pro.

---

## B. Product concept

### B.1 The one-box principle (your Google-style direction)

The whole product is a single centred input. There is no menu wall, no dashboard and no chat window. Everything appears **under** the box, in place.

```
                              S H E R L O C K

        ┌──────────────────────────────────────────────────────────┐
        │  ⌕  bundesdruckerei.de                                   │
        └──────────────────────────────────────────────────────────┘
          ● Domain detected · also try: Company "Bundesdruckerei"
          ↵ Investigate      ⇥ Switch lens      /  Tools for domains
```

As the user types, **before** pressing Enter, a deterministic local detector classifies the input. It needs no network and no LLM, and works per keystroke in under 10 ms:

| Typed | Detected as | Instant hint under the box |
|---|---|---|
| `example.de` | Domain | "Domain · 23 sources ready · 6 launch pads" |
| `185.12.64.1` / `AS3320` | IP / ASN | "Hosted by …" (from a local IPinfo Lite copy, no request) |
| `+49 30 …` | Phone | Country, number type and validity, all computed locally |
| `jane@firma.de` | Email | "Domain firma.de accepts mail · identity lookup not offered (why?)" |
| `529900T8BM49AURSDO55` | LEI | Checksum valid |
| `52.52, 13.40` | Coordinates | Mini-map preview |
| `bc1q…` / `0x…` | Crypto address | Chain detected |
| `10.1038/…` | DOI | |
| `@handle` / `user:handle` | Username | Restricted lens notice |
| `44d88612…` | File hash | MD5/SHA type |
| `"Deutsche Bahn"` | Organisation (or a person in a public role, when ambiguous) | Disambiguation chips |
| `how do I geolocate a photo` | Question | Methodology + tools |
| *(drop an image or file)* | File | Processed locally: EXIF, hash, keyframes |

**Prefix grammar for power users:** `domain:` `ip:` `org:` `user:` `email:` `phone:` `geo:` `hash:` `doi:` `tool:` `how:` `site:` plus `!` bangs for launch pads (`!lens`, `!wayback`, `!handelsregister`). The same box does three things: **investigate** an entity, **find a tool**, **learn a method**.

### B.2 The results page (still one column, still the box on top)

```
┌ ⌕ bundesdruckerei.de ───────────────────────────────── [Graph] [Report] ┐
│ COVERAGE  ✓ 17 queried · ◷ 2 rate-limited · ↗ 6 launch pads · ⛔ 1 excluded ▸│
├──────────────────────────────────────────────────────────────────────────┤
│ ANSWER CARDS (structured, each with source chips)                        │
│ ┌ Registration ──────────┐ ┌ Infrastructure ────────┐ ┌ Organisation ──┐ │
│ │ Registrar · created …  │ │ AS… · Hoster · DE      │ │ Bundesdruckerei│ │
│ │ RDAP ✓ 14:02           │ │ RIPEstat ✓ IPinfo ✓    │ │ GmbH · LEI …   │ │
│ └────────────────────────┘ └────────────────────────┘ │ GLEIF ✓ Wikid.✓│ │
│                                                       └────────────────┘ │
│ FINDINGS (stream, newest resolves in place)                              │
│  ● 412 certificates since 2014 · 38 unique subdomains   crt.sh ✓  [pin]  │
│  ● First archived 1998-12-02 · 2,931 captures           Wayback ✓ [pin]  │
│  ● Mentioned in 3 EU procurement awards                 TED ✓     [pin]  │
│  ◐ Possibly same org as "Bundesdruckerei Gruppe" (LEI parent)  plausible │
│                                                                          │
│ OPEN MANUALLY (prepared, never claimed as searched)                      │
│  ↗ Handelsregister  ↗ Unternehmensregister  ↗ Google (site:, filetype:)  │
│  ↗ urlscan search   ↗ Censys   ↗ North Data                              │
│                                                                          │
│ NEXT STEPS  → Check subdomain certificates for look-alikes               │
│             → Pivot to parent company (LEI)  → Compare 2015 vs today     │
│                                                                          │
│ TOOLS FOR THIS  (registry) subfinder · amass(passive) · dnstwist · …     │
└──────────────────────────────────────────────────────────────────────────┘
          Evidence panel slides in from the right when a finding is clicked:
          raw response excerpt · URL · retrieved-at · source licence · hash
```

**Card grammar.** Every visible claim carries:
- **Source chip:** name, ✓/◷/✗ status, time retrieved
- **Confidence label:** *Confirmed* (an authoritative source states it) · *Corroborated* (2+ independent sources) · *Plausible* (inferred link) · *Conflicting* · *Unverified lead*
- **Pin** into a case, or **Open evidence**

**The coverage strip** expands into the full ledger. One line per source, with one of seven states:
`queried ✓ · no results ∅ · rate-limited ◷ · failed ✗ · needs your key 🔑 · launch-only ↗ · excluded ⛔ (reason)`.
**Indizia never claims a source was searched when it wasn't.** This is a product invariant, not just a UI detail.

### B.3 Views (reached from the results page, not from menus)
| View | What | When |
|---|---|---|
| **Results** (default) | Box, coverage, answers, findings, launch pads, next steps | Always |
| **Graph** | Entities and supported relationships. Edge = cited finding. Dashed = plausible | 2+ entities pinned |
| **Timeline** | Dated findings (registrations, certificates, captures, filings, news) | Any dated data |
| **Case** | Pinned findings, notes, hypotheses, saved queries | When the user pins |
| **Report** | Citation-backed export (Markdown/PDF/JSON/FtM) with uncertainty labels and a coverage appendix | On demand |
| **Library** | The registry: thousands of tools, faceted | `tool:` prefix or "Tools for this" |

### B.4 Investigation workflow (the engine behind the box)
1. **Detect** input type(s) locally. If ambiguous, show chips. The optional LLM only helps with free text.
2. **Plan:** select manifests from the registry that accept this input type, with a policy filter (lens restrictions, legal flags) and a health filter (source status).
3. **Run:** fire permitted native queries in parallel, from the user's browser where possible (see §F). Stream results.
4. **Record:** store each raw response's essentials, URL, timestamp and content hash in the session evidence ledger.
5. **Normalise:** map results to a common entity/claim model (borrow the followthemoney schema).
6. **Deduplicate:** merge identical entities on strong identifiers (LEI, QID, domain, ASN, DOI). Weak matches become *plausible* links and are never merged silently.
7. **Relate:** create edges only from explicit source statements ("LEI A is parent of B").
8. **Flag:** contradictions (two sources disagree on a date or owner), staleness, and single-source claims.
9. **Suggest:** next steps from the registry graph (input→output pivots) plus rules.
10. **Report:** export with citations and the coverage ledger.

### B.5 Tool library (information architecture for thousands of tools)
- **Primary facet = input type** (what you have). **Secondary = objective** (what you want). **Third = access mode** (Native / Execution / Launch / Local).
- Filters: free/freemium/paid · open-source · API · key needed · local/hosted · licence · maintenance (last push) · health (works now) · skill level · privacy flags · jurisdiction · languages.
- **Tool card:** what it does in one line, input→output, access mode, cost, limits, ToS link, licence, last verified date, health sparkline, alternatives, guides, ethical notes, "Run in Indizia" (if integrated) or "Open" (launch).
- **Default sort = "works now and free"**, so dead tools sink automatically.
- Seed: OSINT Framework `arf.json` (MIT) plus this catalog. Then grow through community pull requests.

### B.6 Source manifests (the core asset)
Every source is a declarative manifest, not code. This is a product concept; the format is deliberately left open here.

| Field | Example |
|---|---|
| id, name, homepage, category | `ripestat`, RIPEstat, … |
| accepts → returns | `ip, asn, prefix` → `asn, prefix, country, abuse_contact` |
| mode | native / execution / launch / local |
| auth | none / free key / user key (BYOK) |
| quota | "8 concurrent per IP; register >1,000/day" |
| terms_url, licence, commercial_ok | … |
| legal_flags | personal_data, art9_risk, art10_risk, scraping_prohibited, active_probe |
| lens_policy | allowed lenses and required purpose gate |
| retention | cache TTL, store-raw yes/no |
| health_check | canary query + expected shape |
| attribution | text/link required |
| last_verified | 2026-10-17, by whom |

Benefits: community contributions without code, an automated health monitor, a public "status page of OSINT", and reproducible investigations ("this report used manifests v123").

### B.7 How this differs from a chatbot
| Chatbot | Indizia |
|---|---|
| Generates an answer | Retrieves findings, and every sentence cites one |
| Hides which sources were used | Coverage ledger lists every source and its state |
| Conversational turns | One box plus direct manipulation (pin, pivot, filter) |
| Unclear confidence | Explicit confidence labels per claim |
| Can hallucinate entities | The LLM can't create findings (see §B.8) |

### B.8 The lightweight LLM: what it may and may not do

You asked for a small LLM tuned so the product feels premium. Research supports this, but only in narrow, verifiable roles. **The premium feel mostly comes from speed, typography and honesty, not from generated prose.**

**Roles (in priority order):**
| # | Role | Input → output | Why a small model is enough |
|---|---|---|---|
| 1 | **Lens router** for free text | "who's behind the shop fakeshop-xyz.de" → `{entity: domain, value: fakeshop-xyz.de, intent: fraud_check}` | Classification into a fixed JSON schema |
| 2 | **Query composer** for launch pads | entity + intent → Google/Bing dork strings, Wayback filters | Templated, short output |
| 3 | **Evidence summariser** | pinned findings (with IDs) → 3–6 sentences, each ending with `[F12]` citations | Constrained, extractive |
| 4 | **Next-step explainer** | rule-generated suggestions → one-line rationale | Short |
| 5 | **Method answers** | "how do I…" → answer grounded only in registry/methodology pages, with links | Retrieval-grounded |

**Hard guardrails (product requirements):**
- The model **never** produces a finding, entity, relationship or confidence label. Those come only from sources and rules.
- **Citation validator:** every generated sentence must cite at least one finding ID that exists in the case. Sentences without one are dropped before display. Numbers and dates in generated text must string-match the cited finding.
- No LLM output for restricted lenses (person/username/email/phone) in the MVP.
- Generated text is always marked as **Summary (generated from N findings)**, with a toggle to hide it.

**Where it runs (the €0 constraint, verified):**
| Option | Cost | Privacy | Verdict |
|---|---|---|---|
| **In-browser** (WebGPU, e.g. WebLLM, Apache-2.0, JSON mode) with a 0.5–1.5B model | €0. One-time model download per user (hundreds of MB) | Queries never leave the device | **Recommended primary.** Graceful fallback to no-LLM if WebGPU is missing |
| Cloudflare Workers AI free | 10,000 Neurons/day, hard fail beyond | Third-party processing | Small shared fallback only |
| Google Gemini free tier | €0 | Unpaid-tier data may be used for improvement and seen by human reviewers. **EEA/CH/UK apps for users must use Paid Services** | **Not usable** for an EU-facing product |
| Other free hosted tiers | Change often | Third-party processing of investigative queries | Avoid as a dependency |

**"Optimised for my use case"** means:
1. **A grammar/JSON-schema-constrained output**, so the model can't ramble.
2. **A tiny task-specific fine-tune** (e.g. LoRA) on a synthetic dataset generated *from the registry*: thousands of "messy query → structured lens plan" pairs. Small models excel at narrow classification after this.
3. **An evaluation set before launch:** routing accuracy (target ≥ 95% on the test set), zero uncited sentences (enforced by the validator), and latency budget (first token under 500 ms on a mid-range laptop after warm-up). *Inference:* achievable for routing; summarisation quality needs testing.
4. **Deterministic first:** regex/checksum/libphonenumber/IP parsing handle 80–90% of inputs instantly *(inference)*. The model is the fallback for free text, not the front door.

### B.9 Premium feel: concrete design requirements
- **Speed as a feature.** Local detection per keystroke. First result painted in under 1 s for cached or fast sources. Skeleton rows that resolve *in place* (no layout jump). Each source row has its own timer.
- **One typeface family, strict scale.** Monochrome UI with one accent colour reserved for *Confirmed*. Status colours used only on status.
- **Keyboard-first.** `/` focuses the box, `↑↓` moves between findings, `p` pins, `o` opens evidence, `g` opens the graph, `⌘K` opens the command palette, `esc` returns.
- **No decoration.** No charts unless the data is a series. No gamification. No "AI sparkle" iconography.
- **Calm honesty.** Errors are first-class rows ("RIPEstat timed out after 8 s · retry"), never toasts that vanish.
- **Dark and light themes.** Responsive down to phones: on mobile the box stays on top, cards stack, and the graph becomes a list.
- **Microcopy** in German and English from day one, since the operator and first audience are German.
- **Inspiration taken from your references:** OSINT Framework's legend (T/D/R/M) and per-tool detail panels → registry badges. Champagne Wiki's human curation, category cards and dead-link reporting → library tone and "Report broken" on every card.

---

## E. Existing product analysis

| Product | Type | Strengths | Weaknesses / limits | Cost | Opportunity for Indizia |
|---|---|---|---|---|---|
| OSINT Framework | Directory (tree) | Huge, MIT, now has metadata (pricing, opsec, input/output) and ratings | Links only. No execution, no results, no health | Free | Use as registry seed. Add execution, health, results |
| awesome-osint | Directory (list) | 60 categories, 30k★ | Flat links, no metadata, link rot | Free | Same |
| Bellingcat Toolkit | Curated reviews | Expert reviews, maintainers, ethics | Manual, 12 categories, no execution | Free | Link to its reviews as "guides" |
| IntelTechniques tools | Search forms | Fast launch pads | Manual, US-centric | Free | Launch pads plus coverage tracking |
| SpiderFoot (OSS) / HX | Automation | 200+ modules, correlation | Self-host, technical UI, many modules need paid keys | OSS free / HX paid | Approachable one-box UX, honest coverage |
| recon-ng · theHarvester · bbot | CLI frameworks | Powerful, scriptable | CLI-only, active modules | Free | Phase-4 local companion |
| Flowsint | Graph OSINT (OSS) | Graph-first, ethics doc, Apache-2.0 | Early development, self-host | Free | Similar ethos. Possible collaboration or export target |
| Maltego | Graph workstation | Industry standard, transforms | CE capped. Pro costs thousands. Data paid | Freemium/paid | Free web alternative for the common 80% |
| OSINT Industries / Epieos | Email/phone → accounts | Fast selector lookups | Paid credits. Privacy-invasive by nature | Paid | **Do not compete here** (ethics differentiator) |
| Shodan / Censys | Internet scan engines | Deep data | Paid for API/history | Freemium | Use their free layers (InternetDB), launch for the rest |
| urlscan.io | URL sandbox | Generous free API | Single purpose | Freemium | Native source |
| OCCRP Aleph Pro / OpenAleph | Document and entity platform | Massive collections, FtM model | Aleph Pro paid. OpenAleph self-host | Paid / OSS | Adopt FtM. Launch to Aleph |
| OpenCorporates · North Data | Company data | Coverage, graphs | Paid API (OC), freemium (ND) | Paid/freemium | GLEIF plus national open APIs, launch for the rest |
| OpenSanctions | Sanctions/PEP | Excellent data, open code | NC licence for data | Free NC | Native (non-commercial) |
| Hunchly | Evidence capture | Auto-logs browsing | Paid desktop | Paid | Built-in evidence ledger (lightweight) |
| Datashare | Document search | Local, private, NER | Desktop, documents only | Free | Recommend for big document sets |
| Perplexity-style AI search | LLM answers | Fluent | Hidden sources, hallucination, no coverage view | Freemium | The anti-pattern Indizia positions against |

**Repeated user pain points** *(inference from tool landscape and docs)*: link rot and dead tools · not knowing which tools still work · copy-pasting the same selector into 20 sites · no record of what was checked · quotas hit mid-investigation · results without timestamps · tools that silently return nothing · paid walls discovered late.

**Recommended identity (combination):** a **federated search interface** on top of a **living tool registry**, with a **personal investigation workspace** (local-first). The knowledge graph is a *view* of the workspace, not a global database of people. That avoids building a central personal-data store.

---

## F. €0 feasibility assessment

### F.1 What €0 really means here
| Cost item | Can it be €0? | Notes |
|---|---|---|
| Software | Yes | OSS throughout |
| Data | Mostly | Open data plus free APIs. Many are **non-commercial** |
| Hosting a static front end | Yes | GitHub Pages / Cloudflare Pages, non-commercial |
| A thin request relay | Yes, within limits | Cloudflare Workers Free: 100k req/day, 10 ms CPU ✅ |
| Domain name | **No** (about €10–20/yr) | Use a free subdomain (`*.pages.dev`) to stay at strictly €0 |
| LLM | Yes (in-browser) | User's GPU. Optional |
| Legal review | **Not free** | Pro-bono clinics, digital-rights NGOs, university law clinics |
| Your time | The real cost | Registry curation and abuse handling are ongoing work |
| Impressum (§5 DDG) | €0, but a privacy cost | A service-able address is mandatory for a German operator. Consider a c/o service (not free) or an association (e.V.) |

### F.2 Architecture principles that make €0 possible (product-level, not a stack)
1. **User-executed by default.** Requests go from the user's browser to the source when the source permits cross-origin calls. Quotas are then per user, not app-wide, and the operator never sees the query. *Inference:* many APIs lack CORS headers, so per-source testing is needed.
2. **A thin relay only where needed.** Stateless, no logging of query content, strict allowlist of manifests. Not usable for sources whose policies forbid app-wide backends (public Nominatim, public Overpass).
3. **BYOK (bring your own key).** Users paste their own free keys (GitHub, YouTube, abuse.ch, VirusTotal, Etherscan…), stored only in their browser. Quotas scale with users, and each user accepts each provider's terms.
4. **Local-first workspace.** Cases live in the browser (exportable files). No accounts needed in the MVP, so no personal-data store server-side.
5. **Ship datasets, not queries.** Bundle compact open datasets (IPinfo Lite, GLEIF subset, sanctions lists, WhatsMyName definitions, registry) as static files on the CDN. Lookups happen locally at zero marginal cost.
6. **Cache with TTL and attribution.** Share caching of *non-personal* infrastructure data only (certificates, RDAP of organisations, ASNs).
7. **Launch pads are the safety net.** When every native source fails, the product still delivers prepared one-click searches across 20+ engines and registers.

### F.3 Three scenarios

**Scenario 1: Strict €0 MVP** (no server, no paid anything, `*.pages.dev`)
- Static site + registry + local detectors + bundled datasets
- Native sources callable from the browser (keyless and CORS-friendly, to be tested per source): Wayback, RDAP, DoH, crt.sh / Cert Spotter, RIPEstat, Shodan InternetDB, Wikidata/Wikipedia, OpenAlex, Crossref, GLEIF, TED, abgeordnetenwatch, GDELT, mempool.space
- Local: EXIF, file hashing, perceptual hash, phone metadata, IP→ASN, sanctions screening against bundled lists
- Launch pads for everything else
- Local-first cases, Markdown/JSON report export
- In-browser LLM optional
- **Delivers:** a genuinely useful domain/IP/company/archive/knowledge investigator plus the best OSINT tool library available.

**Scenario 2: Expanded €0 platform** (free tiers + BYOK + local companion)
- Adds a stateless free-tier relay for useful non-CORS keyless APIs
- BYOK sources: GitHub, YouTube, abuse.ch, VirusTotal, OTX, AbuseIPDB, Etherscan, Companies House, Global Fishing Watch, OpenSky, urlscan
- A **local companion** (optional download) runs CLI tools on the user's machine: Maigret/WhatsMyName checks, subfinder, theHarvester (passive), ExifTool, yt-dlp, whisper.cpp
- Registry health monitor through scheduled free CI runs (e.g. GitHub Actions on a public repo) ◐
- Community manifest contributions through pull requests

**Scenario 3: Future optional expansion** (never a dependency)
- Paid web-search API (Brave/Mojeek) behind a donation-funded budget
- Self-hosted geocoder (Photon) and SearXNG instance
- Own crawl/index of public documents, Common Crawl derived
- TinEye API, licensed company data, OpenCorporates (public-benefit access)
- Team workspaces with end-to-end encrypted sync
- Researcher-access partnerships (DSA Art. 40)

### F.4 Hidden costs and breakage risks
| Risk | Evidence | Mitigation |
|---|---|---|
| Free APIs disappear | Bing (2025), Google CSE (2027), Aleph OSS (2025) ✅ | Manifests with health checks. Launch fallback per category |
| Quota models change | OpenAlex moved to cost budgets. abuse.ch made keys mandatory ✅ | Per-manifest quota fields, BYOK |
| App-wide limits | Nominatim 1 req/s for the whole app. Overpass not as a backend ✅ | User-IP execution, caching, self-host later |
| Non-commercial clauses | VT, InternetDB, OpenSanctions, OpenSky, Vercel Hobby ✅ | Keep the project non-commercial (donations OK) or obtain licences |
| CORS | *Inference*: many APIs lack it | Relay (Scenario 2) or launch |
| Abuse handling | Inevitable for any OSINT tool | Policy, rate limits, reporting channel, restricted lenses |
| Key leakage | BYOK in the browser | Keys only in local storage. Never sent to the relay unless the user opts in. Explain risks |
| Maintainer burnout | Registries rot | Automated health, community stewardship, "last verified" visible |

### F.5 Not feasible at €0
- Automated **web-wide** search (Google/Bing-class) and automated **reverse image search** at scale
- Passive DNS **history** at depth, full scan banners and history
- Real-time global AIS/ADS-B with full coverage
- Hosting heavy tools centrally for many users (transcription, crawling, full username sweeps)
- Comprehensive non-open company registries (many EU states charge)

---

## G. Feature matrix

Scale: Value/Feasibility H/M/L · Cost: €0 / €0-BYOK / € · Risk: legal/abuse H/M/L

| Feature | Value | Feasibility | Cost | Risk | Priority |
|---|---|---|---|---|---|
| One box + local entity detection | H | H | €0 | L | **MVP** |
| Coverage ledger (7 states) | H | H | €0 | L | **MVP** |
| Source-backed finding cards + evidence panel | H | H | €0 | L | **MVP** |
| Tool registry/library (faceted, seeded) | H | H | €0 | L | **MVP** |
| Launch pads (prepared external searches) | H | H | €0 | L | **MVP** |
| Domain/IP/ASN/cert/archive natives | H | H | €0 | L | **MVP** |
| Organisation lens (GLEIF, Wikidata, TED, sanctions lists) | H | M | €0 | M | **MVP** |
| Local file analysis (EXIF, hash, pHash) | M | H | €0 | L–M (GPS) | **MVP** |
| Phone metadata (local) | L–M | H | €0 | L | **MVP** |
| Email technical validation (domain only) | M | H | €0 | L | **MVP** |
| Local-first cases + report export | H | H | €0 | L | **MVP** |
| Confidence labels | H | H | €0 | L | **MVP** |
| In-browser LLM router (optional) | M | M | €0 | L | P2 |
| Citation-validated summaries | M | M | €0 | M | P3 |
| Source health monitor + public status page | H | M | €0 | L | P2 |
| BYOK integrations | M | H | €0-BYOK | L–M | P2 |
| Companies (national open APIs, Companies House) | H | M | €0-BYOK | M | P2 |
| Academic lens | M | H | €0 | L | P2 |
| News lens (GDELT, RSS) | M | H | €0 | L | P2 |
| Timeline view | M | H | €0 | L | P2 |
| Entity graph view | H | M | €0 | M | P3 |
| Contradiction detection | H | M | €0 | L | P3 |
| Cross-source entity resolution (strong IDs) | H | M | €0 | M | P3 |
| Saved, repeatable workflows/playbooks | H | M | €0 | L | P3 |
| Methodology library | M | H | €0 | L | P2 |
| Username lens (restricted, presence only) | M | L–M | €0 | **H** | P3–P4 (R) |
| Local companion for CLI tools | M | M | €0 | M | P4 |
| Community manifest contributions | H | M | €0 | M | P4 |
| Monitoring/alerts (CT look-alikes, page changes) | M | M | €0-relay | M | P4 |
| Person-name lens beyond public roles | — | — | — | **H** | ⛔ |
| Face recognition / biometric matching | — | — | — | **H** | ⛔ |
| Email/phone → account linking | — | — | — | **H** | ⛔ |
| Breach/credential search | — | — | — | **H** | ⛔ |
| Active scanning / brute-force enumeration | — | — | — | **H** | ⛔ (unless user-authorised scope, P4+) |
| Real-time tracking of individuals | — | — | — | **H** | ⛔ |

---

## H. Roadmap

*Your phases, reordered: a Phase 0 is added, because the legal and registry groundwork drives everything else.*

### Phase 0 — Groundwork (decisions, not features)
- Decide: non-commercial status, operator form (individual vs e.V.), name, languages.
- Legal review of the restricted-lens policy (see §I).
- Registry schema v0 + import of OSINT Framework (MIT) + this catalog.
- Per-source CORS and terms test for the 20 candidate native sources.
- **Done when:** the policy document, manifest schema and test results exist and the lawyer's open questions are answered.

### Phase 1 — Foundation: "The honest box"
- **User value:** instant, cited answers for domains, IPs, organisations and archives, plus the best searchable OSINT library.
- **Capabilities:** one box, local detection, coverage ledger, about 15 native sources, about 60 launch pads, library with facets and health badges, finding cards, evidence panel, local cases, Markdown/JSON export, EN/DE.
- **Dependencies:** Phase 0 results. Static hosting.
- **Risks:** CORS limits shrink the native set → mitigate with launch pads and a relay in P2.
- **Done when:** 20 scripted test investigations each finish in under 10 s with zero "claimed but not queried" sources (automated check), the library has ≥ 1,000 tools with verified status, and the site is usable on a phone.

### Phase 2 — Unified research
- **User value:** multi-category investigations that persist, with timelines and companies.
- **Capabilities:** organisation and public-records lenses (GLEIF, national registers, Companies House, TED, sanctions, ICIJ, abgeordnetenwatch, Lobbyregister), academic and news lenses, BYOK, relay, timeline, methodology library, health monitor and status page, optional in-browser router LLM, report PDF.
- **Risks:** personal data in registers → minimisation rules per manifest.
- **Done when:** a journalist can go from a shop URL → operator company → register → sanctions/procurement → report in one session, with all claims cited.

### Phase 3 — Intelligence and relationships
- **User value:** see how things connect, and where sources disagree.
- **Capabilities:** entity resolution on strong IDs, graph view, contradiction detection, confidence calculus, saved playbooks ("Fake-shop check", "Domain due diligence", "Image provenance"), citation-validated summaries, CT look-alike checks, restricted username lens (presence signals, purpose gate).
- **Risks:** over-confident linking → never merge on weak signals; show the reasoning chain.
- **Done when:** on a labelled test set, false "Confirmed" merges are 0, and every graph edge opens its evidence.

### Phase 4 — Ecosystem
- **User value:** breadth, community, power-user execution.
- **Capabilities:** community manifests, local companion (CLI tools), monitoring, optional encrypted team sync, self-host option, more countries' registers, export to FtM/STIX/MISP/Maltego.
- **Done when:** external contributors land manifests weekly and the health monitor keeps the share of broken sources under 5% for a quarter.

**Reality check:**
- A *prototype* (box + 5 sources + library) takes weeks.
- A *useful MVP* (Phase 1) takes months for a small team.
- A *comprehensive global platform* is a multi-year community effort. Coverage grows through manifests, not heroics.

---

## I. Legal, privacy and abuse-prevention requirements

*Not legal advice. German/EU focus, with requirements phrased for product and engineering.*

### I.1 Legal landscape (what applies)
| Area | Key point | Source/status |
|---|---|---|
| GDPR Art. 6(1)(f) | Legitimate interest needs a documented purpose, necessity and balancing test. **Public availability alone is not enough** | EDPB draft Guidelines 03/2026 on web scraping (adopted for consultation 2026-07-07, comments until 2026-10-30) via secondary summaries ◐. EDPB Opinion 28/2024 |
| GDPR Art. 9 | Special categories (biometrics, health, politics, religion, sex life…) need an Art. 9(2) exception | Clearview: €30.5M Dutch DPA fine (2024) for scraped biometric DB ✅ |
| GDPR Art. 10 | Data on criminal convictions/offences, so sanctions/PEP/court data need care | ◐ |
| GDPR Art. 14 | Information duty when data isn't collected from the person. 14(5)(b) disproportionate-effort exemption → publish a public notice | ◐ |
| GDPR Art. 17/21 | Erasure and objection, so a removal process is required | ◐ |
| GDPR Art. 85 + German media privilege (state press laws, MStV) | Journalistic exemption covers journalistic processing, **not automatically a general tool provider** | Open question for counsel |
| §126a StGB | Disseminating personal data in a way suited and intended to expose someone to danger of crime is punishable: up to 2 years, or 3 if the data was not generally accessible | ✅ gesetze-im-internet.de |
| §202a–c StGB | Preparing data espionage, including distributing passwords/security codes or tools whose purpose is the offence | ✅ |
| §238 StGB | Stalking, including via data | ◐ |
| §§303a/b StGB | Data alteration and computer sabotage. Cited regarding mass automated registry queries | ◐ (secondary) |
| CJEU C-37/20 & C-601/20 (2022) | General public access to beneficial-owner registers is invalid. Access only with a legitimate interest | ✅ |
| InsBekV §2 | Insolvency publications: searches restricted after 2 weeks | ✅ |
| Database right (Directive 96/9/EC, §§87a ff. UrhG) | Extracting substantial parts of a protected DB is prohibited. Even unprotected DBs can be restricted by contract (CJEU *Ryanair*, 2015) | ◐ |
| TDM exception (§44b UrhG / DSM Art. 4) | Text and data mining allowed unless a machine-readable reservation exists | ◐ |
| DSA | Hosting obligations if users can store and share content (notice-and-action, statement of reasons, contact point) | ◐ |
| §5 DDG | Impressum duty for German service providers | ◐ |
| Source ToS | Govern automated access. Respect them | Per manifest |

### I.2 Product requirements (must)
1. **Lens policy.** Domain/IP/org/knowledge/archive lenses are open. Person (beyond public roles), username, email and phone lenses are restricted: presence/metadata only, no aggregation into personal dossiers, a purpose statement before first use, visible notices.
2. **No central personal-data store in the MVP.** Local-first cases. The relay is stateless with no query logging. Shared caches only for non-personal infrastructure data.
3. **No Art. 9 processing.** No face search. Image tools are provenance-only. A GPS-in-EXIF warning.
4. **No credentials, ever.** No breach-record search, secret scanning or session-based tools. Auth-flow abuse tools (holehe-type) are excluded.
5. **No home addresses or real-time location of individuals.** Geocoding is for places and organisations.
6. **Passive by default.** Active probes (scans, brute force) are excluded. Mild active checks (fetch robots.txt or headers like a normal visitor) are labelled.
7. **Provenance invariant.** Every finding carries source, URL, timestamp and hash. Never claim an unqueried source.
8. **Uncertainty labels** are mandatory on all cross-source links. No "Confirmed" from weak identifiers (name or username similarity).
9. **Respect source terms.** Each manifest records ToS, licence and commercial flags. Non-compliant sources are launch-only.
10. **Abuse prevention.** Rate limits per client on the relay, restricted-lens throttling, pattern detection (e.g. one person-name searched repeatedly across lenses), a published acceptable-use policy, a reporting channel.
11. **Correction and removal.** A public form. Removal of cached or derived data within defined deadlines. Dispute markers on contested findings in shared registry data.
12. **Transparency notice** (Art. 14-style) describing the sources, purposes and rights.
13. **Attribution** for licences (CC BY-SA, ODbL, GDELT, ICIJ, IPinfo).
14. **Security.** BYOK keys only client-side. A content-security policy. No third-party trackers.

### I.3 Unresolved legal questions for counsel (before launch)
1. Is the operator a controller for queries executed client-side through its code? And for relay-executed queries?
2. Can a non-journalist operator rely on Art. 85 / media privilege for a tool used by journalists, or only on Art. 6(1)(f)?
3. Is bundling OpenSanctions/PEP data (Art. 10-adjacent) lawful for a public, non-commercial tool, and under what safeguards?
4. Do launch pads (deep links into Handelsregister/Unternehmensregister) raise any issue? *Inference:* low risk, since the user performs the query.
5. Does the restricted username lens (presence signals) pass the balancing test? What purpose gate suffices?
6. Is the platform a DSA hosting service if users can publish or share cases or reports?
7. Database-right exposure when mirroring open datasets with share-alike licences, and from caching third-party API responses.
8. The Impressum address solution for a private operator. Is an e.V. structure advisable?
9. Liability for user misuse (§126a/§238 StGB) and the needed acceptable-use terms.
10. Are EXIF/GPS displays of user-provided images compliant when images depict third parties?

---

## J. Final recommendation

### J.1 What Indizia should become
**The honest, open front door to public-source research.** One box, a living registry of the whole OSINT ecosystem, evidence-first results, and a complete ledger of what was and wasn't searched. It gives organisations, infrastructure, public records and open knowledge first-class depth, and handles individuals with deliberate restraint.

### J.2 MVP must include
- The one box with local detection for domain, URL, IP, ASN, organisation, LEI, coordinates, hash, DOI, crypto address, phone (metadata), email (domain validity), file
- About 15 native free sources: RDAP, DoH, crt.sh/Cert Spotter, Wayback, RIPEstat, IPinfo Lite (bundled), InternetDB, Wikidata/Wikipedia, GLEIF, TED, OpenAlex, GDELT, mempool.space, sanctions lists (bundled), abgeordnetenwatch
- About 60 launch pads (search engines with operators, reverse image ×4, Handelsregister, Unternehmensregister, North Data, Censys, urlscan, social platforms, maps/Street View)
- The coverage ledger and confidence labels
- The tool library (≥ 1,000 verified entries, faceted, health badges)
- Local cases plus Markdown/JSON export
- EN/DE, dark/light, mobile-ready, keyboard-first

### J.3 Exclude initially
Person-name dossiers · username sweeps · email/phone→account linking · face search · breach data · active scanning · real-time tracking · accounts and server-side storage · hosted LLMs · paid APIs.

### J.4 Decisions that need your input
| Decision | Options | My recommendation |
|---|---|---|
| **Name** | ✅ Decided 2026-10-19: renamed from "SherLock" to **Indizia** (German *Indizien*, English *indicia*; .de/.org/.app free on that date). The old name collided with sherlock-project, 94k★, a username-sweep tool, which is the opposite of the restricted stance) vs a new name | Rename before launch to avoid confusion and SEO conflict |
| **Commercial status** | Non-commercial (donations OK) vs commercial later | Non-commercial: it unlocks VT/InternetDB/OpenSanctions/OpenSky and free hosting |
| **Operator** | Private person vs e.V. | An e.V. or fiscal host once public (Impressum, liability) |
| **Strict €0** | `*.pages.dev`, no domain vs ~€15/yr domain | Start on `pages.dev`, buy a domain at launch |
| **Restricted lenses** | Ship P3 with a purpose gate vs never | P3 behind a purpose gate, after the legal review |

### J.5 What makes it stand out
1. **The coverage ledger.** It is honest about what was searched. Nobody else does this.
2. **The manifest registry as a public good.** A machine-readable "status page of OSINT" others can reuse.
3. **One box, zero chat.** Search-engine ergonomics with investigator-grade provenance.
4. **Privacy by architecture.** Queries run on the user's device. Cases are local. The LLM is on-device.
5. **Ethics as a feature.** It refuses the dossier use case openly and explains why, which is the trust signal journalists and NGOs need.
6. **German/EU depth.** Registers, procurement, lobbying, FOI and courts are poorly served by US-centric tools.

---

*Sources: see the linked official pages in [02](02-source-catalog.md) and [03](03-free-apis-and-datasets.md). Key primary sources fetched 2026-10-17 include: Google CSE overview; Brave/Mojeek API pages; OpenAlex rate limits; Nominatim policy; Overpass commons; RIPEstat; IPinfo Lite; Shodan InternetDB; Cert Spotter; Companies House guidelines; GLEIF open data; TED API docs; abgeordnetenwatch API; GDELT; ICIJ Offshore Leaks; abuse.ch; urlscan pricing; AbuseIPDB; GreyNoise; VirusTotal; MaxMind GeoLite; GitHub rate limits; YouTube API; Wikimedia UA policy; WDQS limits; Etherscan; mempool; adsb.lol; Global Fishing Watch; Gemini API terms; Cloudflare Workers and Workers AI limits; GitHub Pages limits; Vercel fair use; WebLLM; §126a, §202c StGB; §2 InsBekV; OSINT Framework, Bellingcat Toolkit, IntelTechniques, Champagne Wiki; GitHub API metadata for 45 repositories. Secondary (labelled ◐/⚠ where used): Microsoft Bing retirement coverage, Censys credits docs via search, X API pricing, Reddit API limits, Aleph/OpenAleph status, OpenCorporates pricing, Handelsregister limits, Transparenzregister reform, Clearview fine coverage, EDPB 2026 scraping guidelines summaries, OpenSky credits.*
