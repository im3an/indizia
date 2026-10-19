# Indizia — Product Discovery Research

Research pack for an open, €0, source-transparent OSINT research engine. No code and no technology stack are prescribed here. Everything below is product, sources, feasibility, law and roadmap.

Research date: **2026-10-17**. Access conditions change often (three major search APIs closed or became paid during 2025). Treat every quota as a snapshot.

| File | Contents | Deliverables covered |
|---|---|---|
| [01-product-discovery.md](01-product-discovery.md) | Vision, concept, single-box UX, the LLM's role, existing products, €0 assessment, feature matrix, roadmap, legal and abuse requirements, final recommendation | A, B, E, F, G, H, I, J |
| [02-source-catalog.md](02-source-catalog.md) | OSINT taxonomy (30 categories), about 230 tools and sources with access mode, cost, licence and phase, open-source repositories, the overlap map, and commercial products with free alternatives | C, prompt-2 items 1–7 |
| [03-free-apis-and-datasets.md](03-free-apis-and-datasets.md) | The free APIs and open datasets checked against official pages, with quotas and restrictions, plus services that are not free despite their reputation | D |

## Evidence legend (used in every table)

| Mark | Meaning |
|---|---|
| ✅ | Checked against the provider's own page or repository on 2026-10-17 |
| ◐ | Taken from official documentation known before this session or from reputable secondary sources. Not re-fetched today, so re-verify before integrating |
| ⚠ | Sources conflict, or the claim could not be verified |
| ⛔ | Deliberately excluded or restricted. The reason is given |

Every section separates **verified fact**, **documented by the provider**, **inference** (marked *Inference:*), and **unrealistic** (marked *Not feasible at €0:*).

## How the research was done

- Primary pages were fetched for APIs, quotas and terms: provider docs, pricing pages, terms of use, GitHub API metadata, and German statutes on gesetze-im-internet.de.
- Repository facts (stars, licence, last push) come from the GitHub REST API, queried on 2026-10-17.
- Secondary sources are used only where no primary page was reachable, and they are labelled as secondary.
- Nothing here is legal advice. Section I of the discovery document lists the questions a German IT/data-protection lawyer has to answer before launch.
