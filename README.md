# Indizia

One search box for public-source research. Type a domain, company, IP, username, LEI, DOI, phone number, coordinates, crypto address or hash, or drop a PDF, photo or Office file. Indizia detects what it is, queries the sources that are allowed and free, and shows every finding with its evidence. The coverage ledger lists what was searched, what failed, and what was never queried.

Product research and rationale: [docs/research/](docs/research/README.md).

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:5173. Node 20 or newer. `npm install` also copies the browser libraries into `public/vendor/`.

```bash
npm test
```

## Deploy (free tier)

**Cloudflare Workers + static assets (recommended, €0):** one Worker serves the app and the API.

```bash
npx wrangler login
```

```bash
npm ci && npx wrangler deploy
```

With Cloudflare's Git integration, set the build command to `npm ci` and the deploy command to `npx wrangler deploy`. The Workers Free plan allows 100,000 requests a day. One username sweep uses about 25 of them; everything else costs one request or none, because most sources are called from the user's browser.

**Self-hosting with Docker** (read-only filesystem, no Linux capabilities, no privilege escalation, memory and process limits, published on 127.0.0.1 only; see `docker-compose.yml`):

```bash
docker compose up -d
```

Open http://127.0.0.1:8080. For a shared deployment, remove `INDIZIA_LOCAL` from the compose file to keep the stricter per-client rate limits, and put a reverse proxy in front.

## Desktop app

`desktop/` wraps the same app in an Electron window for macOS, Windows and Linux. Everything in the web version works unchanged, because the window loads the same `public/` files. On top of that:

- **No open port.** The window loads `sherlock://app/`, a private protocol served in-process by `server/app.mjs`. No local web server is listening, so other programs and websites cannot reach the API or the toolbox.
- **Local toolbox** (`server/toolbox.mjs`, needs Docker): on domain searches, ProjectDiscovery **subfinder** lists subdomains from about 50 public sources and **dnsx** checks which still resolve; **httpx** (off by default, it contacts the target) reads status, title and technologies of up to 60 live homepages. Each tool runs in a throwaway container: pinned image, `--rm`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, user `nobody`, memory, CPU and process limits, no host mounts. Inputs must be domains, and host lists are cut to the searched domain, so the toolbox is not a general scanner. Results appear as the **Deep subdomain scan** source in the ledger, graph and evidence drawer, with the exact `docker run` command in the evidence.
- **Isolated network engine** (Engine menu or Settings): relay, username checks, fingerprint and icons run in a locked-down container built from the app's own `server/` code (`docker/engine.Dockerfile`, no registry pull of Indizia itself), published on 127.0.0.1 only and removed on quit. While it starts, requests wait for it; if it cannot start, the built-in engine answers and Settings says why.
- **Single-user limits** (10× the shared rate limits), native menus, `⌥⇧S` / `Alt+Shift+S` from anywhere to focus the search box, native save dialogs for exports, external links in the default browser, no camera/microphone/location permissions, DevTools off in release builds.
- **Watches in the background**: when you close the window and saved searches are watched, a hidden window on the same origin (same cases) keeps checking them, and a native notification names the search and what changed; clicking it opens the case. On macOS the app stays in the Dock as usual; on Windows and Linux a tray icon shows how many searches are watched and offers Quit. Opening the window again hands the checks back to it. Web notifications stay blocked; alerts come from the main process (`/api/desktop/notify` exists only on the private protocol).
- **Clean up**: Engine → *Clean Up Containers and Images…* removes Indizia's containers and the toolbox and engine images, and nothing else. Quitting removes any running Indizia container.

Run it from source:

```bash
npm install
```

```bash
npm --prefix desktop install
```

```bash
npm run desktop
```

Build installers (written to `desktop/dist/`: `Indizia-mac-arm64.dmg`, `Indizia-mac-x64.dmg`, `Indizia-win-x64.exe`, `Indizia-linux-x86_64.AppImage`):

```bash
npm run desktop:dist
```

The app is about 110 MB to download; Indizia's own code is 5 MB of it, the rest is the Chromium runtime. Builds are not code-signed with a paid certificate: macOS builds are ad-hoc signed (first launch via System Settings → Privacy & Security → Open Anyway), and every release carries SHA-256 checksums and a GitHub build-provenance attestation.

**Download button.** The web app's header links to `/download.html`, which picks the right file for the visitor's system from `public/data/desktop.json`. Installers are too large for Workers assets (25 MB per file), so they are published as GitHub release assets: push a tag such as `v0.4.0` and `.github/workflows/desktop.yml` builds all platforms into a draft release, attests them, adds `SHA256SUMS.txt` and publishes it. Then set `"repo": "owner/name"` in `public/data/desktop.json`; until then the page shows build instructions instead of a dead link. The button is hidden inside the desktop app.

**Toolbox and local AI without the desktop app** (local development only; refuses to start unless bound to 127.0.0.1, and every toolbox or AI request must pass a loopback Host, same-origin and custom-header check). `INDIZIA_TOOLBOX=1` also enables the AI bridge; `INDIZIA_AI=1` enables only the bridge; `OLLAMA_HOST` points it at another Ollama address:

```bash
npm run dev:toolbox
```

**Static only (strict €0, no server):** serve `public/` from any static host (GitHub Pages, Cloudflare Pages). Relay sources (crt.sh, Wayback CDX, DENIC, CIRCL, GDELT, TED) then show **Needs relay** in the ledger, and username checks are unavailable. Everything else works.

Before a public launch, fill in the imprint in `public/about.html` (§ 5 DDG) and have the legal points in [docs/research/01-product-discovery.md §I](docs/research/01-product-discovery.md) reviewed.

## What it searches

| Input | Sources | Where it runs |
|---|---|---|
| Domain / URL | RDAP, DNS (DoH: A/AAAA/MX/NS/TXT, CAA, SOA, DNSSEC, `www` CNAME, SPF, DNS and mail operator), subdomains (HackerTarget), historical DNS (AlienVault OTX, free key optional), crt.sh → Cert Spotter (validity, wildcards, latest issuance), website fingerprint (technologies, security headers, tracking IDs, the site's own social profiles), urlscan.io scan history, reputation (OTX pulses, Cloudflare 1.1.1.2 malware filter), Wayback CDX → availability API, Wayback time machine (up to 4 homepage captures compared for title, branding, contacts, tracking IDs and named organisations; imprint history; archived operator pages), Wikidata, Wikipedia, Hacker News | browser; relay for crt.sh / CDX / archived pages / .de RDAP / urlscan; one server-side homepage request for the fingerprint |
| IP / ASN | RDAP (via rdap.org), RIPEstat routing, geolocation and hosting type (CDN, cloud, hosting), reverse DNS, domains seen on the address (OTX passive DNS, urlscan.io), Shodan InternetDB, reputation (OTX) | browser, relay for urlscan |
| Organisation / LEI | GLEIF (records, parents, subsidiaries), Wikidata (incl. parent/owner/subsidiary relations, people excluded), Wikipedia, ROR, TED (EU procurement), ICIJ Offshore Leaks, GDELT news, Hacker News | browser, relay for TED / GDELT |
| Username | WhatsMyName (602 sites; adult, dating, health and political sites excluded), GitHub, Bluesky. Behind a purpose prompt | server API + browser |
| Email | Mail-domain type (consumer, throwaway, organisation) → domain lens. No identity lookup | browser, on device |
| Phone | Numbering-plan metadata (libphonenumber). No reverse lookup | on device |
| Coordinates | OpenStreetMap Nominatim (≤ 1 request/s) + map | browser |
| DOI | Crossref, OpenAlex | browser |
| Hash | CIRCL hashlookup (known-software database) | relay |
| Domain (desktop) | Local toolbox: subfinder (≈50 passive sources), dnsx (live names), httpx (opt-in, live homepages) | Docker on your computer |
| Crypto address | mempool.space (BTC), Blockscout (ETH). No attribution | browser |
| File | PDF (pdf.js): metadata, XMP, links, JavaScript/attachments flags · images (exifr): EXIF, GPS → map · DOCX/XLSX/PPTX: author, company, revisions, macros, hyperlinks · SHA-256/SHA-1 | on device, never uploaded |
| Question / `tool:` | Tool library: 1,098 tools from the OSINT Framework | on device |

Cross-checks after every run: a shared LEI across Wikidata and GLEIF gives **Confirmed**, agreeing countries give **Corroborated**, disagreements are **Conflicting**, and file dates that run backwards are flagged.

Also new in the search table: **Nearby features** (coordinates → named OpenStreetMap places within 150 m via Overpass, with two fallback instances because the main one is often overloaded) and **Known vulnerabilities** (domain → software versions from the website fingerprint → NVD CVEs by CPE, marked when CISA lists them as exploited; passive, no scanning, a version banner is treated as a lead).

## Source reliability and confidence

Two separate ratings. The **confidence label** (Confirmed, Corroborated, Plausible, Unverified lead, Conflicting) rates each claim. The **reliability grade A–F** (after the NATO/Admiralty scale) rates the source in general: A for authoritative registries, CT logs, archives and Indizia's own observations; B for platform APIs, passive DNS, OpenStreetMap; C for commercial indexes, crowd-edited knowledge bases and geolocation databases; D for user posts and username heuristics; F where it cannot be judged (a file's own metadata). Grades and reasons live in one file (`public/src/sources/reliability.js`), appear next to every source name, in the evidence drawer, the About table, reports and briefs.

## Query language

The findings filter and the document search share one syntax (`public/src/query.js`):

| Syntax | Meaning |
|---|---|
| `acme invoice` | both words (documents: typos tolerated) |
| `"supply agreement"` | exact phrase |
| `-draft` / `-"old version"` | must not appear |
| `invoice OR rechnung` | either |
| `after:2020-01 before:2021-12-31` | date range |
| findings: `source:rdap conf:confirmed grade:ab type:ip entity:acme` | field filters (`-field:` excludes) |
| documents: `type:pdf status:relevant tag:key entity:DE814236234 page:3 ocr:yes` | field filters |

## Document workspace

Each case has a **Documents** tab: drop in a batch of files and Indizia reads, OCRs and indexes them in the browser. Nothing is uploaded; the original file is kept as a Blob next to its SHA-256 and everything derived from it, and every step (added, extracted, OCR, re-extracted after verifying the hash, tagged, embedded) is in the document's processing history.

- **Formats:** PDF (per page, scanned pages are OCR'd), DOCX (body, headers, footers, footnotes, comments, and text deleted in tracked changes), XLSX (every sheet as a table, hidden sheets flagged), PPTX (slides and speaker notes), ODT/ODS/ODP, CSV/TSV, TXT/MD, HTML (parsed inertly: no scripts, no requests), XML, JSON, EML (headers, hop count, quoted-printable/base64 parts, attachments), SRT/VTT subtitles, images (EXIF, OCR), and videos the browser can decode (keyframes, OCR on each frame). The real file type comes from its signature; a disguised executable is flagged.
- **OCR:** tesseract.js 7 in a Web Worker with self-hosted English and German models (`public/vendor/tesseract`, 18 MB, loaded only when needed). OCR text is marked with its confidence.
- **Entities:** organisations by legal form (GmbH, AG & Co. KG, Ltd., S.A., B.V. …, headings and reference numbers trimmed), domains, URLs, emails, IPs, LEIs (checksum), IBANs (mod 97, shown masked), VAT IDs, register numbers (HRB …), CVE IDs, DOIs, hashes, crypto addresses, coordinates and amounts, each with page references. Person names are not extracted. Entities that Indizia can search have an **investigate** button.
- **Dated statements:** every date in English or German form, normalised, with its sentence and page; exportable as a Timesketch timeline.
- **Search:** MiniSearch full-text index per page (fuzzy, prefix, compound tokens such as domains split and whole), the query language above, highlighted excerpts and a **Matched:** line that says why each page came up. With a local embedding model (Ollama `nomic-embed-text`) the box **By meaning** ranks pages by meaning as well (reciprocal rank fusion); new documents join that index automatically.
- **Compare:** two documents side by side: property differences, **possible contradictions** (statements worded the same with a different date or number), entities only in one, in both, and a token-level text diff that keeps dates and amounts whole.
- **Duplicates:** exact (SHA-256), near-duplicate text (SimHash) and visually similar images and video frames (dHash, survives resizing and recompression).
- **Review:** status (not reviewed, relevant, follow up, not relevant), tags, notes, a category with the words that decided it, a relevance meter that counts identifiers this case's own searches also found, **Pin to evidence**, and a review report (Markdown or print/PDF) with page references and the contradictions found between relevant documents.

## Investigation briefs (agent)

Type a question that names something searchable (`who runs bundesdruckerei.de and is 193.28.64.55 theirs?`) or start with `brief:`. Indizia reads the objective, plans searches for every domain, IP, LEI, DOI, quoted or legal-form organisation it names, runs them in parallel within limits you set (number of searches, minutes, follow leads), follows up to three leads from the results, searches the active case's documents, numbers the evidence (F1… findings, D1… document pages) and writes a brief.

- **Rules brief, always:** what the sources show, what is in the case documents, conflicts, leads that need checking, what could not be checked (sources that failed, partial runs) and open questions. Every line cites evidence.
- **Model summary, optional:** a local model through Ollama (desktop app or `INDIZIA_AI=1`; the bridge prefers small instruction models and skips 1–2-bit quantisations) or your own Anthropic API key (Settings; only the numbered evidence is sent). Each statement is labelled *observed*, *source claim*, *inference* or *hypothesis*. A **citation check** drops any statement without citations, with citations that do not exist, or with a number or date that is not in the evidence it cites; dropped statements are listed, not shown as part of the brief.
- **Guardrails:** a model never adds findings, entities or links. Targets a model suggests are re-checked: they must be a searchable type and appear in the objective. Usernames, emails and phone numbers are never searched automatically or sent to a model; they open as separate searches with their purpose check. Retrieved text is fenced as untrusted data in the prompt, and model output is only ever displayed, never executed.
- Stop works at any point and keeps what was found. Export the brief as Markdown or save it, with all its searches, to the active case.

## Map

Every point from a search (and, on a case's **Map** tab, every point from its saved searches, photo GPS and coordinates written in its documents) on one map: OpenStreetMap, OpenTopoMap terrain, or **Sentinel-2 cloudless** yearly composites 2016–2025 (EOX, 10 m) with a second year overlaid by an opacity slider for change detection. The imagery is a cloud-free yearly composite, not a capture of a given day. Exact points are clustered pins; approximate ones (IP geolocation at city level) are drawn as uncertainty circles, never as pins. Popups give source, accuracy, coordinates, **What's nearby** (named OSM features within 200 m) and **Investigate**. Measure distances, import GeoJSON or CSV (lat/lon columns in English or German, DMS coordinates), export everything as GeoJSON or CSV with its uncertainty radius.

## Pivots and open questions

After the first round, Indizia follows a few safe links on its own: domain → server → network, organisation → LEI → direct parent → its parent, URL or email → domain (`PIVOT_RULES` in `public/src/engine.js`). It goes at most two steps from the search and starts at most 30 extra source runs; both limits can be changed in Settings. A pivot outside those limits, or of a kind Indizia never follows on its own (such as an organisation named on an archived homepage), is held. Held pivots, leads in findings, conflicts and inferred links become **open questions** (`public/src/questions.js`), each with a button to run it here, start a new search, show why two entities are connected, or compare the evidence. Restricted lenses (username, email, phone) always open as a separate search with their own purpose prompt.

In the graph, every link opens **why connected**: the request behind it (URL, status, time, SHA-256), the stated links that support an inferred one, what could make the signal misleading, and how Indizia reached the entity, step by step.

## Time machine

For a domain, the Wayback time machine source reads up to four archived captures of the homepage, spread from the first to the latest version, and compares them: page title, site name, logo and favicon files, theme colour, website software, canonical address, copyright line, contact emails and phone numbers, tracking IDs, social profiles and organisation names. Each comparison is a dated finding on the timeline, with links to both captures. It also compares the first and last archived version of the imprint linked from the homepage, and lists archived imprint, contact and about pages. A date picker opens the capture closest to any day. Archived tracking IDs and profiles feed link analysis, and new contact domains and organisations become open questions. Archived HTML is read as text and never rendered. Role addresses are shown in full; personal-looking addresses and phone numbers are masked. One domain costs up to 8 relay requests.

## Interface

- **Prompt-style box** with live type detection, a file button, paste and drag-and-drop, and typeahead (history, prefixes, organisation names from Wikidata and GLEIF, which can be turned off).
- **Answer cards** per topic, **findings** ranked by confidence, **source chips** with favicons and hover cards, **evidence drawer** (request URL, status, time, size, SHA-256, raw excerpt, copyable citation).
- **Graph** (knowledge graph, `public/src/resolve.js`): duplicate mentions are merged into one entity with aliases (same name after removing legal forms, or a shared LEI). Solid lines are links a source stated; dashed lines are links Indizia inferred from shared attributes (tracking IDs, social profiles, certificates, redirects, dedicated name/mail servers, addresses, SPF senders, name ↔ domain matches), each with a confidence score and its reasons. CDN, cloud and mass-market DNS/mail infrastructure is discounted or ignored. Click a line for why it exists, click a node for aliases and connections, shift-click two nodes to explain the paths between them, double-click to investigate. A confidence slider and a "possible duplicates" list (similar, not merged) sit above the graph. People never take part in inference.
- **Timeline** of dated facts (registration, certificates, DNS history, scans, archive captures, publications). **Map** of every point found. **Tools** tab with the relevant part of the tool library.
- **Coverage ledger**, **next steps**, and **launch pads** (prepared searches on sites Indizia does not query).
- **Cases** (investigation workspace, IndexedDB in this browser only): cases grouped in folders; the active case collects pinned evidence (with request, retrieval time, SHA-256 and an excerpt), saved searches (auto-saved while the case is active) and leads from Next steps. Each case has Overview, Evidence (tags, analyst notes), a cross-search Graph that links separate leads, Timeline (findings and the audit trail), Notes and bookmarks, Tasks / leads / open questions, Searches (re-run one or all and see what changed; workflows such as *Domain infrastructure sweep*, *Company due diligence*, *IP triage*) and Report.
- **Watches** (`workspace/watch.js`, `workspace/scheduler.js`): any saved search except username, email and phone (restricted lenses never run unattended) can be watched daily or weekly. While Indizia is open, due watches are re-run one at a time, at most one every two minutes, in one tab only (Web Lock); a missed interval (app closed for days) is caught up once. A source that rate-limits is left out of watch runs for six hours, and a finding only counts as *gone* when its source answered: findings from sources that failed, were rate-limited or sat out are carried forward and compared on the next check, so outages do not raise false alarms. A run where no source answered (offline) is retried after an hour. Every check is written to the case's audit trail; changes also go to **Changes since you last looked** (Overview and Searches, with a count on the tab) until marked as seen. In the desktop app checks continue with the window closed, with a native notification (see Desktop app).
- **Export**: investigation as PDF (print), Markdown, JSON or a Timesketch timeline (JSONL with `message`, `datetime`, `timestamp_desc`); case as an audit-ready report (scope and method, coverage gaps, evidence with citations, stated and inferred links with reasons and weights, timeline, notes, tasks, full audit trail, SHA-256 integrity line) in Markdown, print/PDF or a JSON bundle. **Settings**: optional GitHub token and AlienVault OTX key, typeahead and icon toggles.
- Keyboard: `/` search · `j`/`k` move · `o` evidence · `p` pin · `g` graph · `m` map · `Esc` close.

## Privacy by design

- Most queries go from the browser straight to the source. The relay is allowlisted (`server/api.mjs`), stateless, and does not log queries. Worker observability is off.
- Files are analysed locally. pdf.js runs with `isEvalSupported: false`, and document JavaScript is detected, never executed.
- RDAP contacts of kind *individual* and Wikidata owners who are humans are never shown.
- History and settings live in `localStorage`, cases in IndexedDB, all in this browser only. There are no accounts, cookies or analytics.
- The website fingerprint is the only request that reaches a target: one homepage GET from the Indizia server (not the user's browser), refused for hosts that resolve to private addresses. Link inference never involves people, and accounts found by username search stay presence signals. Fonts and libraries are self-hosted, and favicons are fetched server-side.
- The desktop app serves itself over a private protocol (no listening port), runs toolbox containers unprivileged and read-only, and removes them when they finish.
- Security headers: a strict CSP (`script-src 'self'`), no referrer, no framing (`server/headers.mjs`, `public/_headers`).

## Layout

```
public/            app (no build step): index.html, about.html, styles/, src/, data/tools.json, fonts/, vendor/ (generated)
  src/sources/     one adapter per source, each declaring its licence, terms, CORS needs and accepted inputs
  src/ui/          icons, graph, map, typeahead
server/api.mjs     shared API: relay, username checks, favicons, website fingerprint (Web Fetch API, runs on Node and Workers)
server/fingerprint.mjs  one homepage fetch with an SSRF guard (public addresses only, re-checked per redirect); returns derived data, never the page
public/src/resolve.js   entity resolution and link analysis (pure, tested)
public/src/workspace/   cases: storage, case page, save/re-run/workflows, watches (watch.js pure, scheduler.js), audit report
public/watcher.html     desktop only: hidden page that runs watches while the main window is closed
public/src/docs/        document workspace: extract (formats, OCR, media), entities, compare, search, semantic, store, view
public/src/agent/       investigation briefs: plan/validate (pure), llm providers, run, view
public/src/geo/         geospatial helpers (distances, formats, GeoJSON/CSV); ui/map.js is the map workspace
public/src/query.js     the shared query language; findquery.js applies it to findings
server/ai.mjs      local AI bridge to Ollama (desktop and INDIZIA_AI=1 only)
server/app.mjs     one request handler (Web Fetch API) for the Node server and the desktop protocol: static files, API, toolbox, engine proxy
server/toolbox.mjs Docker toolbox: pinned tools, input checks, hardened `docker run`, output parsers
server/docker.mjs  Docker CLI wrapper (no shell, timeouts, labelled containers)
server/node.mjs    Node server for development, Docker and the desktop engine container
desktop/           Electron app (main.mjs, engine.mjs) and electron-builder config
docker/            engine.Dockerfile for the desktop's isolated engine
docker-compose.yml hardened self-hosting
worker/index.mjs   Cloudflare Worker entry
scripts/           vendor copy (postinstall) and dataset rebuild (npm run data)
test/              node:test suites + fixtures
```

## Licence

Indizia is © 2026 Imran Moujtahid, licensed under the GNU Affero General Public License v3.0 or later (see [LICENSE](LICENSE)). If you run a modified version as a network service, you must offer its users the corresponding source code (AGPL § 13). Bundled data and libraries keep their own licences, listed below.

## Licences of bundled data

WhatsMyName site definitions: CC BY-SA 4.0 (© Micah Hoffman). OSINT Framework tool list: MIT. Libraries: tesseract.js and its models (Apache-2.0), MiniSearch (MIT), jsdiff (BSD-3-Clause), Leaflet.markercluster (MIT). Map data and tiles: OpenStreetMap (ODbL), OpenTopoMap (CC-BY-SA), Sentinel-2 cloudless by EOX (2016: CC BY 4.0; later years: CC BY-NC-SA 4.0, non-commercial use). See `/about.html` for the full source and licence table.
