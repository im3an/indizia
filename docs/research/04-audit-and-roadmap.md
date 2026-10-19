# Indizia — Audit, technology selection and build roadmap

*2026-10-18. Baseline: v0.3.0 (web + desktop), 68 automated tests passing. Status markers: ✅ built and tested here · 🟡 built, verified only partly (reason given) · ⬜ not built (reason given).*

## 1. Architecture as found

| Layer | What it is | State |
|---|---|---|
| Front end | `public/`: no build step, ES modules, ~9k lines. `main.js` (1,490 lines) owns search box, results, ledger, drawer, settings, export | Works. `main.js` is a monolith; new workspaces go in their own modules |
| Engine | `engine.js`: plans sources by input type, runs them in parallel, ledger states, pivot rules with depth and budget, cross-checks | Works, tested |
| Sources | 38 adapters in `src/sources/`, each a manifest (licence, terms, CORS, accepted inputs) plus `run(ctx)` | Works. No per-source reliability grade; confidence is the only quality axis |
| Entity resolution | `resolve.js`: merges aliases, inferred links with weights and reasons, discounts shared infrastructure | Works, tested |
| Cases | `workspace/`: IndexedDB, evidence with SHA-256, notes, tasks, saved searches, re-runs with diff, audit trail, report | Works. Document collections and watches added since (§5) |
| API | `server/api.mjs` (relay allowlist, username checks, fingerprint with SSRF guard, icons), `app.mjs` handler, `toolbox.mjs` (Docker) | Works, tested |
| Hosts | Cloudflare Worker, Node/Docker (hardened compose), Electron desktop over `sherlock://` | Works, tested |
| Files | `sources/files.js`: one file at a time; PDF (pdf.js), images (exifr), DOCX/XLSX/PPTX core properties, text links | Works for single files. No OCR, no full text, no collections, CSV/XLSX contents not read |
| Map | `ui/map.js`: Leaflet markers on OSM tiles | Minimal: no clustering, layers, import/export, measuring, imagery |

## 2. Weaknesses found

1. **Documents are not a workspace.** A file is analysed once and forgotten: no collection per case, no full-text index, no OCR for scans, no entity extraction beyond links/emails, no comparison between versions.
2. **The map shows points, nothing more.** No clustering, no satellite or historical imagery, no import/export, no measuring, no nearby-feature lookup, no way to bring your own coordinates.
3. **One quality axis.** "Confirmed / plausible / lead" mixes how reliable a source is with how well a claim is supported. Intelligence practice (Admiralty/NATO 6×6) keeps them apart.
4. **Findings cannot be searched.** Only three radio filters; no text, source, date or confidence query.
5. **No vulnerability context.** The fingerprint finds `nginx 1.18.0` but says nothing about known CVEs or actively exploited ones.
6. **The LLM roles in 01 §B.8 were never built.** No summaries, no planning from a natural-language objective.
7. **CSP blocks WebAssembly** (`script-src 'self'` without `'wasm-unsafe-eval'`), which rules out OCR and other WASM tools in the browser.
8. **No media forensics beyond EXIF:** no perceptual hashes, no file-signature check for media, no video frames.
9. `main.js` is large; new features must not grow it further.

Kept on purpose (from 01 §I.2, the user's standing privacy decisions): no person dossiers, no face search, no breach or credential data, no email/phone → account linking, no port or vulnerability *scanning*. The master prompt's people/email lenses stay restricted (presence and metadata only, purpose prompt), and person names are not extracted into the graph.

## 3. Technology selection

| Need | Candidates checked | Chosen | Licence · status · why |
|---|---|---|---|
| OCR | tesseract.js 7.0.0, PaddleOCR (Python), cloud OCR | **tesseract.js 7 + tesseract.js-core, tessdata_fast eng+deu, self-hosted** | Apache-2.0, maintained (Dec 2025). Runs in a Web Worker in the browser (no upload). Needs `'wasm-unsafe-eval'` |
| Full-text search | MiniSearch 7.2.0, Lunr (unmaintained), FlexSearch, SQLite FTS | **MiniSearch** | MIT, Sep 2025, 30 kB, fuzzy + prefix + field boosts, serialisable index |
| Semantic search | Ollama `nomic-embed-text`, transformers.js, hosted embeddings | **Ollama (local) when present** | Runs on the user's machine; lexical search is the fallback. No hosted embeddings (privacy, €0) |
| Text diff | jsdiff 9.0.0, diff-match-patch | **jsdiff** | BSD-3-Clause, Apr 2026, word and line diffs |
| Entity extraction | spaCy/NER (Python), compromise (English only), rules | **Rules with validation** (LEI checksum, IBAN mod-97, VAT, register numbers, legal-form organisations, dates in EN/DE formats, money, domains, IPs, coordinates) | Deterministic, multilingual enough for DE/EN, testable. Person NER deliberately omitted (policy) |
| Map clustering | Leaflet.markercluster 1.5.3, supercluster | **Leaflet.markercluster** | MIT, stable (no change needed since 2021), drop-in for Leaflet 1.9 |
| Imagery | Esri World Imagery, Sentinel Hub, EOX Sentinel-2 cloudless | **EOX Sentinel-2 cloudless 2016–2025** | Yearly cloud-free composites; 2016 CC BY 4.0, later years CC BY-NC-SA 4.0 (Indizia is non-commercial). Honest dating: a yearly composite, not a capture date. Esri needs an account/terms review |
| Terrain | OpenTopoMap | **OpenTopoMap** | CC-BY-SA, CORS, light-use policy |
| Nearby features | Overpass API | **Overpass** (POST form, CORS ✓) | ODbL data, public instance policy (≤10k queries/day) |
| CVEs for detected software | NVD API 2.0 (CORS ✓), CIRCL vulnerability-lookup (500 on test), OSV (packages, not products) | **NVD API 2.0 by CPE + CISA KEV (via relay)** | Public domain (US gov). NVD: 5 req/30 s without key |
| LLM | WebLLM (in-browser), Ollama (local), Anthropic API (BYOK), hosted free tiers | **Ollama via the local API, or the user's own Anthropic key** | 01 §B.8: no hosted free tiers. Ollama keeps data local. WebLLM stays a later option (hundreds of MB per user) |
| Heavy recon | SpiderFoot, Amass, ProjectDiscovery | **subfinder, dnsx, httpx in Docker** (done in v0.3.0) | Amass v5 needs a separate engine process and returned nothing in tests; SpiderFoot is a whole server app — used as a reference for correlation ideas |
| Timelines | Timesketch | **Export format** (done) | Server product; Indizia exports its JSONL |
| Disk forensics | Autopsy / Sleuth Kit | **Not integrated** | Java desktop suite for disk images; out of scope for a public-source tool |

## 4. Build order (highest value first)

| # | Work | Status |
|---|---|---|
| 1 | **Document intelligence workspace** per case: multi-file intake (PDF, DOCX, XLSX, PPTX, ODT, CSV, TXT, HTML, XML, JSON, EML, images), OCR, full-text search with highlights, entity extraction, duplicates and near-duplicates, version comparison, dated-sentence timeline, review status and tags, export | ✅ |
| 2 | **AI investigation agent**: objective → entities → plan → parallel runs within a budget → cited brief; citation validator drops uncited sentences; deterministic mode without an LLM | ✅ local model; 🟡 Anthropic BYOK |
| 3 | **Geospatial workspace**: clustering, imagery by year, terrain, nearby OSM features, measuring, GeoJSON/CSV import and export, accuracy rings | ✅ (Overpass 🟡, see §5) |
| 4 | **Media forensics**: perceptual hash (dHash + aHash), signature check, video keyframes with hashes and OCR, subtitle files | ✅ |
| 5 | **Source reliability** (A–F) separate from claim confidence, shown on findings, evidence and reports | ✅ |
| 6 | **Findings query language**: `source:`, `conf:`, `grade:`, `after:`/`before:`, `"phrases"`, `-exclude`, `OR` | ✅ |
| 7 | **Vulnerability context** for fingerprinted software (NVD + CISA KEV) | ✅ (CVE path tested on recorded NVD data) |
| 8 | **Watches**: scheduled re-runs of saved searches with change alerts (web while open; desktop also with the window closed, native notification) | ✅ |
| 9 | Visual workflow editor, WebLLM | ⬜ next phase |

## 5. Outcome (2026-10-18)

Automated tests: 113 passing (`npm test`), from 68 at the start. Every item below was also exercised in the browser against real sources unless noted.

**Document workspace (✅).** Verified with real files: two contract versions, a CSV, an email, a PDF, a canvas-rendered scan (OCR 94 %), a WebM video (keyframes OCR'd at 93–96 %), an SRT file and a resized JPEG copy. Search with typos, phrases, exclusions, OR, field filters and date ranges returned the expected pages; compare found both planted contradictions (signing date, fee) and the added party; duplicates found the resized copy (2/64 bits); the meaning index (Ollama `nomic-embed-text`) ranked the invoice first for "how much money is owed" without shared words. Bugs found and fixed while testing: tesseract.js cannot read an `ImageBitmap`; pdf.js 6 has no `doc.destroy()`; compound tokens (domains) were not searchable by their parts; the CSP blocked `blob:` video; quoted phrases were ANDed in the agent's document query. Limits: parsing of Office/HTML/XML runs on the main thread (inert DOM, size caps), PDF and OCR run in workers; legacy `.doc`/`.xls` (OLE) are identified, not read; embedded subtitle tracks in videos are not read; person names are not extracted by design.

**Investigation briefs (✅ / 🟡).** Verified end to end with Qwen3-8B (Q4) on Ollama: 2 planned searches, 3 leads followed (subsidiary domains), 44 evidence items, 7 cited statements kept and 1 dropped by the citation check in 18 s. Rules-only mode verified. The citation validator, target grounding and prompt fencing are unit-tested. 🟡 The Anthropic BYOK path is built to the documented Messages API but **not verified** here (no key in this environment).

**Map (✅, Overpass 🟡).** Verified: Sentinel-2 2018 with 2019 overlaid and the opacity slider, CSV import (German headers, a bad row skipped and reported), measuring (Brandenburg Gate → Reichstag 275 m), case map combining searches, IP estimates as circles and document coordinates. 🟡 All three public Overpass instances failed during the browser test (timeout, 500 without CORS headers, 504); the ledger shows each attempt. The parsing path is tested on a recorded Overpass response.

**Vulnerability context (✅).** Live: nginx.org reports nginx/1.31.3 and NVD lists no CVEs for it, which is what the source reports. The path with CVEs and KEV marking is tested on a recorded NVD response for nginx 1.18.0 (6 CVEs, CVE-2023-44487 in KEV).

**Watches (✅).** A saved search gets a Watch control (off, daily, weekly) stored on the investigation record (`inv.watch`: interval, last check, retry time, findings carried forward). The due-date, cooldown and diff logic is pure and unit-tested (`test/watch.test.js`, 8 tests: intervals, catch-up after missed days, retry after a run with no answers, closed cases and restricted lenses skipped, rate-limit cooldowns, and no false "gone" when a source fails, is rate-limited or sits out). Verified in the browser preview against live sources: a due `example.com` watch ran on its own, recorded "28 new" in the audit trail and in *Changes since you last looked*, held one cross-check that lost a source, and put OTX passive DNS (HTTP 429) on a six-hour cooldown; a saved email search showed *Not watchable* and was never run. Verified in the desktop app (`INDIZIA_SMOKE` with `INDIZIA_SMOKE_WATCH=1`): with the main window closed the hidden watcher ran a due `example.org` watch and a native notification was shown, in two consecutive runs. Limits: watches run only while Indizia (a tab, or the desktop app) runs; there is no server-side scheduler, by design, since cases never leave the browser. In the first desktop run (the app's first notification ever) the main window reopened right after the notification, probably macOS activating the app for its notification permission; the check had already completed, and the two later runs did not show this. The Windows/Linux tray path is built but was not run here (tested on macOS only).

**Source reliability, findings filter (✅).** Every source has a grade and a reason (tested); the filter was checked in the browser on a live result set.

### Not built in this round (⬜)

- **Visual workflow editor**: workflows remain the three fixed recipes in `workspace/actions.js`. (Scheduled watches, listed here before, are now built; see Watches above.)
- **Authentication, multi-user case isolation, encryption at rest**: Indizia is local-first and single-user by design (cases in the browser's IndexedDB, desktop has no listening port); a shared server deployment would need these first.
- **In-browser LLM (WebLLM)**: hundreds of MB per user; the local Ollama bridge and BYOK cover the need for now.
- **Public-records connectors** beyond those present (GLEIF, TED, ICIJ, Wikidata, ROR): national company registers mostly lack free APIs or forbid automated access (see 02-source-catalog); court decisions vary by country. Prepared launch pads remain the honest option.

## 6. Launch preparation (2026-10-19, v0.4.0)

Automated tests: 118 passing.

- **Name (✅).** Renamed from SherLock to **Indizia** (German *Indizien*, English *indicia*), ending the clash with sherlock-project. Storage ids (IndexedDB `sherlock`, `sherlock.*` localStorage keys, export format `sherlock-case/1`, the desktop `sherlock://` scheme) keep the old prefix on purpose so saved cases survive; the desktop app keeps using an existing `SherLock` profile folder.
- **Legal (✅).** AGPL-3.0-or-later (© Imran Moujtahid), Impressum per § 5 DDG, a GDPR controller/rights paragraph and the Cloudflare hosting note on `/about.html`. Operator: private person, non-commercial. Not a legal review.
- **Shared rate limits (✅).** The Worker passes Cloudflare rate-limit bindings (`[[ratelimits]]` in `wrangler.toml`) to `handleApi`; the per-instance limiter stays as the first line and the only one on Node/Docker. A failing binding fails open. Tested with fake limiters.
- **Overpass (✅).** One shared, hedged lookup (`nearbyPlaces` in `sources/geo.js`) for the source and the map: overpass-api.de, then private.coffee after 4 s, then Photon (komoot) after 8 s or as soon as everything running has failed; the first answer wins and the rest are cancelled. maps.mail.ru was dropped (coordinates would go to VK). Verified live: with Overpass at capacity, Photon returned 27 named places at the Brandenburg Gate in 8.3 s.
- **Anthropic BYOK (✅ request shape / 🟡 live).** Fixed a request that could never succeed: `temperature: 0` is rejected by `claude-haiku-5-5`; `max_tokens` raised to 16 000 because thinking is always on; refusals and cut-off answers are now errors. CORS and headers verified against the live API with an invalid key (preflight allowed, 401). A real brief with a real key is still unverified.
- **Desktop release (✅ local / 🟡 CI).** macOS builds are ad-hoc signed (hardened runtime off, since nothing is notarised); the packaged arm64 app passed the smoke test. The release workflow now builds into a draft, attests build provenance, adds `SHA256SUMS.txt` and then publishes. Windows remains unsigned; the free SignPath Foundation programme for open-source projects is the next step.
