# GEO-SEO Integration — Technical Specification

**Date:** 2026-04-13
**Status:** Final — ready for implementation
**Brief:** [`docs/geo-seo-dev-brief.md`](./geo-seo-dev-brief.md)
**Source reference:** [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) (MIT licensed)
**Classification:** Significant

---

## Table of Contents

- [1. Overview and Scope](#1-overview-and-scope)
- [2. Open Questions Resolution](#2-open-questions-resolution)
- [3. Skill Definitions](#3-skill-definitions)
- [4. Action Registry Entries](#4-action-registry-entries)
- [5. Schema Design](#5-schema-design)
- [6. Service Layer](#6-service-layer)
- [7. System Agent and Seed Script](#7-system-agent-and-seed-script)
- [8. Routes, Permissions, and UI](#8-routes-permissions-and-ui)
- [9. Phasing and Implementation Order](#9-phasing-and-implementation-order)
- [10. Verification Checklist](#10-verification-checklist)
- [11. Doc Updates Required](#11-doc-updates-required)

---

## 1. Overview and Scope

### What this spec covers

Native GEO (Generative Engine Optimisation) capabilities for Automation OS — a cluster of 8 system skills, a scoring service, a database table for historical score storage, and a system-managed agent that combines traditional SEO auditing with AI search visibility analysis.

### What GEO is

AI search engines (ChatGPT, Perplexity, Gemini, Google AI Overviews, Bing Copilot) generate answers by citing web pages. GEO measures how well a site is structured to be cited by these engines. It complements traditional SEO (which targets organic search rankings) with a new axis: AI citability.

### Design philosophy

The **7 sub-skills** (`geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`) are **pure read-only methodology skills** — prompt scaffolds with no programmatic side effects. They match the existing `audit_seo` pattern: the LLM reads the page (via `fetch_url` / `web_search`), applies the methodology, and returns structured findings. No custom TypeScript handler logic is needed beyond registering the action type.

**`audit_geo` is distinct**: it is the orchestrator that runs the audit AND triggers score persistence via a `processOutputStep` hook, making it a write-path action. It has its own `ActionDefinition` entry with `idempotencyStrategy: 'write'` and `isMethodology: false`. The 7 sub-skills remain in the methodology batch with `idempotencyStrategy: 'read_only'`.

The only non-methodology component is score storage: a `geo_audit_scores` table that persists composite and dimension scores per subaccount for historical tracking and trend analysis. A thin service (`geoAuditService.ts`) handles writes and queries.

### Scope boundaries

**In scope:**
- 8 skill `.md` files under `server/skills/`
- 8 action registry entries in `actionRegistry.ts` (1 standalone `audit_geo` + 7 in methodology batch)
- 1 Drizzle schema table + migration `0110`
- 1 service file (`geoAuditService.ts`) + pure companion
- 1 system agent definition (seeded in `scripts/seed.ts` Phase 2.5)
- Route endpoints for GEO score history
- Updates to `architecture.md`, `docs/capabilities.md`, `KNOWLEDGE.md`

**Out of scope (deferred to Phase 2+):**
- Dedicated GEO dashboard page (extends existing SEO views in Phase 2)
- PDF report generation
- Per-org weight customisation UI
- Recurring scheduled GEO audits (uses existing heartbeat infra — configuration only, no new scheduling code)
- Client-facing portal GEO views

### Existing infrastructure reused

| Component | How used |
|-----------|----------|
| `audit_seo` skill | GEO audit extends, not replaces — `audit_geo` calls it for traditional SEO context |
| `fetch_url` skill | Data gathering — robots.txt, page HTML, structured data |
| `web_search` skill | Brand mention research, competitor data |
| `scrape_url` / `scrape_structured` | Deep page analysis, structured data extraction |
| Methodology skill pattern | The 7 sub-skills are `isMethodology: true`, `idempotencyStrategy: 'read_only'`. `audit_geo` is `isMethodology: false`, `idempotencyStrategy: 'write'` — it triggers score persistence via `processOutputStep`. |
| Skill executor pipeline | Standard processInput → gate → execute → processOutput |
| System agent seeding | Phase 2 of `scripts/seed.ts` |
| pg-boss scheduling | Existing heartbeat infra for recurring audits (no new code) |
| Task/deliverable system | Audit results delivered as task deliverables |
| Workspace memory | GEO findings persisted for cross-run learning |

---

## 2. Open Questions Resolution

The dev brief listed 6 open questions. Resolutions below, informed by codebase patterns.

### Q1: Score storage granularity — composite + dimensions, or full per-check results?

**Resolution: Composite + dimension scores in DB; full per-check results in deliverable body.**

Rationale: The `geo_audit_scores` table stores the 6 dimension scores (0–100 each) and the weighted composite (0–100). Full per-check details (individual findings, recommendations) are attached as task deliverables via `add_deliverable` — this follows the existing pattern where `compute_health_score` writes a `healthSnapshots` row for the score but the detailed breakdown lives in the agent's output.

### Q2: Competitive data freshness — cache competitor audits?

**Resolution: No dedicated cache. Use workspace memory.**

Rationale: Competitor GEO data fetched during `geo_compare` runs is written to workspace memory via the standard `write_workspace` skill. The memory system already has quality scoring, decay (90-day TTL), and deduplication. Agents can retrieve prior competitor data from memory on subsequent runs via `search_agent_history`. No separate cache table needed.

**Workspace memory key format for competitor GEO data:** `geo:competitor:{canonicalised-domain}` — e.g. `geo:competitor:example.com`. Use the output of `canonicaliseSiteUrl()` with the `https://` prefix stripped as the key suffix. This format prevents fragmentation across runs that use different URL forms for the same competitor.

**Workspace memory key format for primary site GEO context:** `geo:site:{canonicalised-domain}` — e.g. `geo:site:example.com`. Use this key to cache findings about the primary site that should persist across audit runs (e.g. confirmed schema types, crawler allowlist status, llms.txt state). Agents can read this key at the start of a run to skip re-fetching stable signals, and update it after the audit completes with the latest findings. Distinguish from `geo:competitor:*` keys by the `site:` prefix.

**Write timing rule:** Both `geo:site:*` and `geo:competitor:*` workspace memory writes must happen only after the audit completes successfully and the `GEO_SCORE_PAYLOAD` block has been produced. Do not write partial memory during analysis — a failed or truncated run must not leave stale competitor or site data in memory that could mislead a subsequent run.

**Conditional overwrite rule:** Before writing to `geo:site:*` or `geo:competitor:*`, the agent should read the existing memory entry (if any). Only overwrite if:
- No existing entry exists, OR
- The new entry's `auditedAt` is more recent than the stored `lastUpdated`, OR
- The new composite score is higher confidence (more dimensions non-null) than the stored record

This prevents a degraded run (e.g. one where pages failed to fetch) from replacing a richer prior audit. The memory entry format must use this structure to support the comparison and future analytics:

```json
{
  "lastUpdated": "<ISO 8601 timestamp>",
  "compositeScore": 72,
  "nonNullDimensions": 5,
  "signals": {
    "schemaCount": 3,
    "schemaTypes": ["Organization", "Article"],
    "unknownSchemaTypes": ["SuperSchema"],
    "crawlerBlockedCount": 1,
    "crawlerAllowedCount": 8,
    "llmsTxtExists": false,
    "hasSpeedIssues": false,
    "hasMobileIssues": false,
    "traditionalSeoScore": 68,
    "lowConfidence": false
  }
}
```

`nonNullDimensions` (0–6) is the primary confidence signal for the overwrite decision — a run with 6 non-null dimensions always beats one with 4. `signals` are the lightweight intermediate facts that make score changes explainable without re-running the audit.

`unknownSchemaTypes` captures schema type strings found in the page's JSON-LD that are not in the standard list recognised by `geo_schema` — useful for spotting custom or hallucinated schema vocabulary without hard-failing the audit. Populated by comparing `schemaTypesFound` against the `KNOWN_SCHEMA_TYPES` list at write time. `lowConfidence: true` is set when `nonNullDimensions < GEO_MIN_DIMENSIONS_FOR_PERSIST` (see §8.3).

### Q3: Weight customisation — per-org or system-wide?

**Resolution: System-wide defaults in Phase 1. Per-org override deferred to Phase 2.**

The `geo_audit_scores` table includes a `weights_json` column that records the weights used for that specific audit (frozen at audit time — this is an audit record, not an override). Phase 1 uses hardcoded defaults from `server/config/limits.ts`. Phase 2 adds a dedicated org-level weight settings column to the `organisations` table plus UI to adjust weights. No override column is reserved in the Phase 1 schema.

### Q4: UI scope — dedicated GEO dashboard or extend existing?

**Resolution: Phase 1 has no dedicated UI beyond the existing run trace viewer and deliverable display.** The agent produces structured deliverables that render in the existing task/deliverable UI. Phase 2 adds a GEO tab to the subaccount agent detail page showing score history charts.

### Q5: PDF reports — needed for Phase 1?

**Resolution: No.** Task deliverables are sufficient. PDF generation deferred to Phase 3.

### Q6: llms.txt generation — read-only or generate?

**Resolution: Read-only analysis in Phase 1.** The `geo_llmstxt` skill checks whether an `llms.txt` file exists and evaluates its quality. It does not generate or host the file — that would require file-serving infrastructure outside the current platform scope. The skill recommends what the `llms.txt` should contain; the agency implements it on the client's site.

---

## 3. Skill Definitions

All 8 GEO skills are `.md` files under `server/skills/`. Each follows the existing frontmatter + parameters + instructions pattern established by `audit_seo.md`. Note: `audit_geo` is a write-path orchestrator (`isMethodology: false`); the 7 sub-skills are pure read-only methodology skills (`isMethodology: true`). See §4 for action registry details.

### 3.1 `audit_geo.md` — Composite GEO Audit (Orchestrator)

**File:** `server/skills/audit_geo.md`

```yaml
---
name: Audit GEO
description: Comprehensive Generative Engine Optimisation audit. Analyses a website for AI search visibility across 6 dimensions and produces a composite GEO Score (0-100).
isActive: true
visibility: basic
---
```

**Parameters:**
- `site_url: string (required)` — Root URL of the site to audit
- `target_pages: string` — Comma-separated URLs of key pages to analyse (default: homepage + up to 4 linked pages). Hard cap: **5 pages total** including the homepage. If more than 5 are supplied, silently use the first 4 from the list plus the homepage.
- `include_traditional_seo: boolean` — Also run traditional SEO checks via audit_seo (default: true)
- `competitor_urls: string` — Comma-separated competitor URLs for comparative context

> **`competitor_urls` handoff contract (audit_geo → geo_compare):** Before passing `competitor_urls` to `geo_compare`, the agent must: (1) trim whitespace from each URL, (2) deduplicate (case-insensitive), (3) cap at 3 competitors (take the first 3 after dedup if more are supplied). If fewer than 2 competitor URLs remain after processing, skip `geo_compare` entirely and note in the report that competitive analysis requires at least 2 competitor URLs. Do not call `geo_compare` with 0 or 1 competitor URLs.

**Instructions summary:**
1. Before fetching any pages, the platform injects the previous GEO Score into the run context (via a pre-run `getLatestScore()` query in the `processOutputStep` setup). The agent receives this as `previousScore` (number or null) in its context. If null, the trend is `new`. This is not a skill call — the agent reads the value from its injected context, it does not call the TypeScript service directly.
2. Fetch the site's homepage and up to 4 key pages via `fetch_url`. **Fetch resilience rule:** if any individual page fetch fails or returns no usable content after one retry, skip that page and continue the audit — do not block or abort the run. Note skipped pages in the report under "Data Gaps". A failed robots.txt fetch is noteworthy (note it in Critical Findings) but is not a blocker.
3. Run each sub-dimension analysis (citability, crawlers, schema, platform optimisation, brand authority, llms.txt) — the agent calls each sub-skill or applies the methodology inline depending on context
4. Compute dimension scores (0–100 each) using the scoring framework below
5. Compute weighted composite GEO Score; compute trend indicator using the previous score retrieved in step 1
6. If `include_traditional_seo` is true, also run `audit_seo` on the primary page
7. Produce a unified report combining GEO + traditional SEO findings (include trend indicator in Score header)
8. Persist the score via the structured output format (service layer picks this up via the `GEO_SCORE_PAYLOAD` block)

**Scoring Framework (hardcoded Phase 1, tunable Phase 2):**

| Dimension | Default Weight | Skill | What It Measures |
|-----------|---------------|-------|-----------------|
| AI Citability | 25% | `geo_citability` | Can AI engines extract and cite clean content passages? |
| Brand Authority | 20% | `geo_brand_authority` | Entity recognition, brand mentions, knowledge graph presence |
| Content Quality / E-E-A-T | 20% | (inline in `audit_geo`) | Experience, expertise, authoritativeness, trustworthiness signals |
| Technical Infrastructure | 15% | `geo_crawlers` | AI crawler access, Core Web Vitals indicators, crawlability |
| Structured Data | 10% | `geo_schema` | JSON-LD schema coverage and correctness |
| Platform-Specific | 10% | `geo_platform_optimizer` | Per-engine optimisation readiness |

> **Intentional overlap note:** Dimension scores are independent assessments — some signals (e.g. `speakable`, author attribution) intentionally appear in multiple dimensions because they satisfy distinct criteria in each. For example, a site with well-implemented `speakable` JSON-LD correctly scores credit in both Structured Data (schema correctness) and Platform-Specific (Google AI Overviews readiness) — these are genuinely different assessments. This rewards depth of compliance and is by design. Dimensions are not meant to be orthogonal.

**Output format:**

```
GEO AUDIT

Site: [url]
Audit Date: [ISO date]
GEO Score: [0-100] ([trend indicator if previous score exists])

## Score Breakdown

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| AI Citability | [0-100] | 25% | [value] |
| Brand Authority | [0-100] | 20% | [value] |
| Content Quality / E-E-A-T | [0-100] | 20% | [value] |
| Technical Infrastructure | [0-100] | 15% | [value] |
| Structured Data | [0-100] | 10% | [value] |
| Platform-Specific | [0-100] | 10% | [value] |

## Executive Summary

[3-5 sentences: overall AI search readiness, biggest gaps, top opportunities]

## Critical Findings

[Issues that actively prevent AI citation — blocked crawlers, missing structured data, etc.]

## Priority Recommendations

[Ranked by impact × effort, with specific implementation steps]

## Traditional SEO Summary

[If include_traditional_seo: condensed audit_seo findings]

## Platform Readiness

[Per-engine status: Google AI Overviews, ChatGPT, Perplexity, Gemini, Bing Copilot]

## 30-Day Improvement Roadmap

[Week-by-week action plan targeting the highest-impact GEO improvements]

<!-- GEO_SCORE_PAYLOAD_START -->
{
  "dimensions": {
    "citability": <0-100 or null>,
    "brandAuthority": <0-100 or null>,
    "contentQuality": <0-100 or null>,
    "technicalInfra": <0-100 or null>,
    "structuredData": <0-100 or null>,
    "platformSpecific": <0-100 or null>
  },
  "platformScores": {
    "googleAio": <0-100 or null>,
    "chatgpt": <0-100 or null>,
    "perplexity": <0-100 or null>,
    "gemini": <0-100 or null>,
    "bingCopilot": <0-100 or null>
  },
  "crawlerAccess": {
    "allowed": ["GPTBot", "ClaudeBot"],
    "blocked": ["PerplexityBot"],
    "unknown": ["FacebookExternalHit"]
  },
  "llmsTxtExists": <true|false|null>,
  "schemaTypesFound": ["Organization", "Article"],
  "traditionalSeoScore": <0-100 or null>
}
<!-- GEO_SCORE_PAYLOAD_END -->
```

> **Machine-readable payload contract:** The `GEO_SCORE_PAYLOAD_START` / `GEO_SCORE_PAYLOAD_END` block is mandatory and must appear verbatim at the end of every `audit_geo` output. Use exact START/END markers so the parser can reliably delimit the JSON regardless of LLM whitespace variance. The JSON between the markers must be valid (no trailing commas, no inline comments). `crawlerAccess` values must be User-Agent strings from the §3.3 table (e.g. `"FacebookExternalHit"` not `"FacebookBot"`). The payload uses a nested JSON structure (`dimensions.*`, `platformScores`, `crawlerAccess`) that the `processOutputStep` parser maps to the flat Drizzle schema columns in §5. See §8.3 for the full parser contract, field mapping, and validation rules. If the block is absent or malformed, the score is not persisted.

### 3.2 `geo_citability.md` — AI Citability Analysis

**File:** `server/skills/geo_citability.md`

```yaml
---
name: GEO Citability
description: Analyses content for AI citation readiness — passage structure, claim clarity, quotable formatting, and optimal extraction length.
isActive: true
visibility: basic
---
```

**Parameters:**
- `page_url: string` — URL of the page to analyse
- `page_content: string` — Raw page content if URL not accessible
- `target_topic: string` — Primary topic the page should be cited for

> **Constraint:** At least one of `page_url` or `page_content` must be supplied. If both are provided, `page_content` takes precedence (the agent analyses the supplied content directly and does not fetch the URL). If neither is supplied, return an error result rather than attempting to guess.

**Instructions summary:**

Analyse the page content for AI citability factors:

**Passage Structure (40% of dimension score):**
- Optimal citation passage length: 134–167 words (research from geo-seo-claude methodology)
- Clear topic sentences that summarise the paragraph's claim
- Self-contained paragraphs that make sense when extracted in isolation
- Logical flow that AI can follow without surrounding context

**Claim Clarity (30%):**
- Explicit factual claims (not hedged or ambiguous)
- Statistics, data points, and specific numbers
- Named entities, dates, and verifiable references
- Original research, surveys, or proprietary data

**Quotable Formatting (20%):**
- Bullet points and numbered lists for structured information
- Bold/strong key phrases that AI engines weight more heavily
- Definition-style formatting (term: explanation)
- FAQ sections with clear Q&A pairs

**Content Freshness (10%):**
- Publication date visible and recent
- Last-updated timestamp present
- References to current events, recent data
- No stale statistics or outdated claims

**Score: 0–100** based on weighted sub-factors above.

### 3.3 `geo_crawlers.md` — AI Crawler Access Check

**File:** `server/skills/geo_crawlers.md`

```yaml
---
name: GEO Crawlers
description: Checks robots.txt and HTTP headers for AI crawler access. Verifies that AI search engines can crawl and index the site.
isActive: true
visibility: basic
---
```

**Parameters:**
- `site_url: string (required)` — Root URL of the site to check

**Instructions summary:**

Fetch `{site_url}/robots.txt` via `fetch_url`. Check access for each AI crawler:

| Crawler | User-Agent | Engine |
|---------|-----------|--------|
| GPTBot | GPTBot | ChatGPT / OpenAI |
| ChatGPT-User | ChatGPT-User | ChatGPT browsing |
| ClaudeBot | ClaudeBot | Claude / Anthropic |
| PerplexityBot | PerplexityBot | Perplexity |
| GoogleOther | GoogleOther | Google AI / Gemini |
| Google-Extended | Google-Extended | Google AI training |
| Bytespider | Bytespider | TikTok / ByteDance |
| CCBot | CCBot | Common Crawl |
| Applebot-Extended | Applebot-Extended | Apple Intelligence |
| Amazonbot | Amazonbot | Alexa / Amazon |
| FacebookBot | FacebookExternalHit | Meta AI |
| anthropic-ai | anthropic-ai | Anthropic training |
| cohere-ai | cohere-ai | Cohere |
| Diffbot | Diffbot | Diffbot AI |

Also check:
- `X-Robots-Tag` HTTP headers on key pages (via HEAD request or `fetch_url`)
- `<meta name="robots">` in page HTML
- AI-specific noindex directives
- Sitemap availability and freshness (`/sitemap.xml`)

**robots.txt access states:**
- **allowed** — crawler is explicitly allowed or not mentioned (default-allow per robots.txt spec)
- **blocked** — crawler is explicitly disallowed via `Disallow` directive or matching `User-agent: *` rule
- **unknown** — robots.txt is missing (404/connection error), server returns a non-200 status, or the file is inaccessible; report as `unknown` — do not treat as blocked or allowed

When robots.txt is `unknown`, do not apply crawler-blocked deductions. Instead, deduct -10 as a "robots.txt inaccessible" penalty and note the ambiguity in the output.

**Score: 0–100.** Deductions:
- Major AI crawler blocked (GPTBot, ClaudeBot, PerplexityBot, GoogleOther): -15 each
- Minor AI crawler blocked: -5 each
- robots.txt inaccessible (unknown state): -10
- No sitemap: -10
- Stale sitemap (>30 days): -5
- X-Robots-Tag noindex on key pages: -20

**Page Speed Indicators** (assessed from HTTP response signals and HTML — no RUM data):
- Response time >3s (measured from `fetch_url` round-trip): -10
- No `<meta name="viewport">` (mobile readiness): -5
- No HTTPS (HTTP scheme): -15

These indicators are inferred signals only — the agent cannot run synthetic performance tests. They serve as lightweight proxies for the Technical Infrastructure dimension and are consistent with the source reference implementation's geo-technical skill scope.

### 3.4 `geo_schema.md` — Structured Data Coverage

**File:** `server/skills/geo_schema.md`

```yaml
---
name: GEO Schema
description: Evaluates JSON-LD structured data coverage and correctness for AI engine consumption.
isActive: true
visibility: basic
---
```

**Parameters:**
- `page_url: string (required)` — URL of the page to analyse
- `page_content: string` — Raw HTML if URL not accessible
- `page_type: enum[homepage, article, product, service, faq, local_business, other]` — Expected page type

> **Constraint:** At least one of `page_url` or `page_content` must be supplied. If both are provided, `page_content` takes precedence (the agent analyses the supplied HTML directly and does not fetch the URL). If neither is supplied, return an error result. (`page_url` is marked required above for the common case; `page_content` is the fallback when the URL is behind auth or otherwise inaccessible.)

**Instructions summary:**

Extract all `<script type="application/ld+json">` blocks from the page. Evaluate:

**Schema Presence (40%):**
- Organisation schema (homepage)
- Article / BlogPosting (content pages)
- Product (product pages)
- FAQPage (FAQ sections)
- HowTo (tutorial content)
- BreadcrumbList (navigation)
- WebSite + SearchAction (sitelinks search box)
- LocalBusiness (if applicable)

**Schema Correctness (30%):**
- Valid JSON-LD (parseable)
- Required properties present per schema.org spec
- No deprecated properties
- Consistent `@id` references across schemas
- `sameAs` links to social profiles / Wikipedia / Wikidata

**AI-Specific Signals (30%):**
- `speakable` property (Google AI voice-ready content)
- `author` with explicit `Person` or `Organization` type (E-E-A-T)
- `datePublished` and `dateModified` (freshness)
- `isPartOf` and `mainEntity` (content relationships)
- `citation` property (academic/research content)

**Score: 0–100.**

### 3.5 `geo_platform_optimizer.md` — Platform-Specific Readiness

**File:** `server/skills/geo_platform_optimizer.md`

```yaml
---
name: GEO Platform Optimizer
description: Evaluates readiness for each major AI search platform with platform-specific recommendations.
isActive: true
visibility: basic
---
```

**Parameters:**
- `site_url: string (required)` — URL of the site
- `page_url: string` — Specific page to evaluate (default: homepage)
- `target_keyword: string` — Primary query the site should appear for in AI answers

**Instructions summary:**

Evaluate the page against each AI platform's known preferences:

**Google AI Overviews:**
- Featured snippet readiness (concise answers to questions)
- People Also Ask (PAA) alignment
- `speakable` structured data
- Content within 40-60 word answer boxes
- Authority signals (backlink profile indicators via structured data)

**ChatGPT (via GPTBot):**
- robots.txt allows GPTBot
- Content extractability (clean HTML, not JS-rendered-only)
- Conversational tone suitability
- Citation-worthy passages (specific claims with evidence)

**Perplexity:**
- robots.txt allows PerplexityBot
- Source attribution signals (author bylines, publication dates)
- Factual density (claims per paragraph)
- Academic/research citation format

**Google Gemini:**
- GoogleOther / Google-Extended access
- Multi-modal content signals (images with descriptive alt text, video transcripts)
- Comprehensive topic coverage (topical authority)

**Bing Copilot:**
- Bing-compatible structured data
- OpenGraph and Twitter Card meta tags
- Microsoft Clarity / Bing Webmaster signals

**Output:** Per-platform readiness score (0–100) and specific recommendations.

**Dimension score:** Average of non-null per-platform scores. Platforms that cannot be assessed (e.g. Bing Copilot when no Bing-specific signals are present) should be scored `null` and excluded from the average rather than scored 0. A platform score is `null` only when the agent lacks sufficient signal to produce a meaningful score — not when the score is low.

### 3.6 `geo_brand_authority.md` — Brand Authority & Entity Signals

**File:** `server/skills/geo_brand_authority.md`

```yaml
---
name: GEO Brand Authority
description: Evaluates brand entity strength, knowledge graph presence, and citation density across the web.
isActive: true
visibility: basic
---
```

**Parameters:**
- `brand_name: string (required)` — Brand or organisation name
- `site_url: string (required)` — Brand's primary website
- `industry: string` — Industry vertical for contextual benchmarking

**Instructions summary:**

Use `web_search` to research:

**Entity Recognition (40%):**
- Search `"{brand_name}"` — does a Knowledge Panel appear? (check via web search result structure)
- Wikipedia presence (search `site:wikipedia.org "{brand_name}"`)
- Wikidata entity (check structured data `sameAs` links)
- Google Business Profile signals (if local business)

**Brand Mention Density (30%):**
- Search `"{brand_name}" -site:{site_url}` — count and quality of third-party mentions
- Industry publication mentions
- Review site presence (G2, Trustpilot, Capterra, etc.)
- Social media profile completeness

**Citation Signals (20%):**
- Are other sites citing this brand as a source?
- Press coverage and news mentions
- Backlink authority indicators from structured data
- `.edu` and `.gov` references

**Consistency (10%):**
- NAP (Name, Address, Phone) consistency across listings
- Brand name consistency across platforms
- Logo and visual identity consistency in search results

**Score: 0–100.**

### 3.7 `geo_llmstxt.md` — llms.txt Standard Analysis

**File:** `server/skills/geo_llmstxt.md`

```yaml
---
name: GEO llms.txt
description: Analyses the site's llms.txt file — the emerging standard for AI-readable site summaries.
isActive: true
visibility: basic
---
```

**Parameters:**
- `site_url: string (required)` — Root URL of the site

**Instructions summary:**

Fetch `{site_url}/llms.txt` via `fetch_url`.

**If file exists — evaluate quality:**
- Follows the llms.txt specification format (title, description, sections)
- Accurate representation of the site's purpose and content
- Key topics and expertise areas listed
- Contact and attribution information present
- Links to important pages and resources
- Reasonable length (not too sparse, not dumping entire site content)
- Score: 0–100 based on completeness and accuracy

**If file does not exist — recommend creation (read-only; the skill produces template text in its output — it does not create or host the file):**
- Score: 0 (file missing)
- Produce a recommended `llms.txt` template in the skill output for the agency to implement on the client's server
- Explain the standard and why it matters for AI discoverability
- Provide implementation instructions (create file at site root, plain text format)

**Output:** Score + detailed assessment or generation recommendation.

### 3.8 `geo_compare.md` — Competitive GEO Analysis

**File:** `server/skills/geo_compare.md`

```yaml
---
name: GEO Compare
description: Benchmarks a site's GEO readiness against 2-3 competitors. Identifies gaps and competitive advantages.
isActive: true
visibility: basic
---
```

**Parameters:**
- `site_url: string (required)` — Primary site to benchmark
- `competitor_urls: string (required)` — Comma-separated competitor URLs (2-3 recommended)
- `target_keyword: string` — Primary keyword/topic for comparison context

**Instructions summary:**

> **Token budget constraint:** Competitor analysis is limited to homepage-only fetches. Do NOT follow internal links or paginate into subpages for competitor sites. Fetch exactly one page per competitor (the root URL). Deep traversal of competitor sites would exhaust the run's token budget and degrade primary-site analysis quality.

For the primary site and each competitor, evaluate:
1. AI crawler access (robots.txt check for key crawlers)
2. Structured data coverage (JSON-LD presence and types)
3. Content citability (passage structure, claim density)
4. llms.txt presence
5. Brand authority signals (via `web_search`)

**Output format:**

```
GEO COMPETITIVE ANALYSIS

Primary: [site_url]
Competitors: [list]
Comparison Date: [ISO date]

## Scorecard

| Dimension | [Primary] | [Comp 1] | [Comp 2] | [Comp 3] |
|-----------|-----------|----------|----------|----------|
| AI Citability | [score] | [score] | [score] | [score] |
| Crawlers | [score] | [score] | [score] | [score] |
| Structured Data | [score] | [score] | [score] | [score] |
| Brand Authority | [score] | [score] | [score] | [score] |
| llms.txt | [Y/N] | [Y/N] | [Y/N] | [Y/N] |
| **Comparison Composite (reduced model)** | **[score]** | **[score]** | **[score]** | **[score]** |

> **Composite formula for `geo_compare`:** Weighted average of the 5 directly-assessed dimensions only — AI Citability (25%), Crawlers/Technical (20%), Structured Data (20%), Brand Authority (20%), llms.txt presence as boolean (15%, scored 100 if present, 0 if absent). Content Quality/E-E-A-T and Platform-Specific readiness are excluded from the `geo_compare` composite because they require deep per-platform analysis and full page content evaluation that `geo_compare` does not perform inline. The full 6-dimension composite (including those two dimensions) is computed only by `audit_geo` using the scoring framework in §3.1.

## Competitive Gaps

[Where the primary site falls behind competitors — specific, actionable]

## Competitive Advantages

[Where the primary site leads — leverage and protect these]

## Priority Actions

[Top 5 actions to close the most impactful gaps]
```

---

## 4. Action Registry Entries

`audit_geo` gets its own standalone `ActionDefinition` entry because it triggers score persistence (a write-path side effect). The 7 sub-skills join the existing methodology batch in `server/config/actionRegistry.ts` (line ~1707).

### `audit_geo` — standalone ActionDefinition

```typescript
// In server/config/actionRegistry.ts, BEFORE the methodology batch:
{
  slug: 'audit_geo',
  name: 'Audit GEO',
  description: 'Comprehensive GEO audit — AI search visibility across 6 dimensions with composite score. Persists dimension scores to geo_audit_scores via processOutputStep.',
  topics: ['seo', 'geo'],
  actionCategory: 'worker',
  isExternal: false,
  isMethodology: false,           // orchestrator with write side effect
  defaultGateLevel: 'auto',
  createsBoardTask: false,
  parameterSchema: z.object({}),
  retryPolicy: { maxRetries: 0, strategy: 'none' },
  idempotencyStrategy: 'write',   // persists scores — not read-only
  mcp: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
},
```

### Additions to methodology skills array (7 sub-skills)

```typescript
// In server/config/actionRegistry.ts, inside the methodology skills batch:
['geo_citability', 'Analyse content for AI citation readiness — passage structure, claim clarity, quotable formatting.', ['seo', 'geo']],
['geo_crawlers', 'Check robots.txt and HTTP headers for AI crawler access across 14+ crawlers.', ['seo', 'geo']],
['geo_schema', 'Evaluate JSON-LD structured data coverage and correctness for AI engine consumption.', ['seo', 'geo']],
['geo_platform_optimizer', 'Platform-specific readiness scores for Google AI Overviews, ChatGPT, Perplexity, Gemini, Bing Copilot.', ['seo', 'geo']],
['geo_brand_authority', 'Evaluate brand entity strength, knowledge graph presence, and citation density.', ['seo', 'geo']],
['geo_llmstxt', 'Analyse the site llms.txt file for AI discoverability. If absent, produce a recommended template for the agency to implement (read-only — does not create or host files).', ['seo', 'geo']],
['geo_compare', 'Benchmark GEO readiness against 2-3 competitors with gap analysis.', ['seo', 'geo']],
```

### Properties inherited from methodology batch (sub-skills only)

The 7 sub-skills automatically get:

| Property | Value | Rationale |
|----------|-------|-----------|
| `actionCategory` | `'worker'` | Pure prompt scaffold |
| `isExternal` | `false` | No external API calls (agent uses other skills for that) |
| `isMethodology` | `true` | Bypasses full action proposal; lightweight audit row |
| `defaultGateLevel` | `'auto'` | No human approval needed — analysis only |
| `createsBoardTask` | `false` | Agent creates tasks explicitly via `create_task` if needed |
| `parameterSchema` | `z.object({})` | Parameters defined in skill `.md`, not Zod |
| `retryPolicy` | `{ maxRetries: 0, strategy: 'none' }` | Methodology skills don't retry |
| `idempotencyStrategy` | `'read_only'` | No side effects |
| `mcp.annotations` | `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }` | Standard methodology annotations |

### Topic tags

All 8 skills use topics `['seo', 'geo']`. This ensures:
1. The topic filter middleware routes GEO-related messages to these skills (once `'geo'` is added to `topicRegistry.ts`)
2. They group alongside the existing `audit_seo` (topic: `['content']`) in the skill selector
3. A new `'geo'` topic is introduced — add to `server/config/topicRegistry.ts` with keywords: `geo`, `generative engine`, `ai search`, `ai visibility`, `citability`, `llms.txt`, `ai crawler`, `gptbot`, `perplexitybot`

Note: `'seo'` and `'content'` are action registry topic tags used for skill grouping metadata, but neither is in `topicRegistry.ts` (which is used for message-based routing). Action registry topics and `topicRegistry.ts` topics are separate namespaces. The `'seo'` tag on GEO skills is metadata only — only `'geo'` needs a `topicRegistry.ts` entry for message routing. `'seo'` can be added to topicRegistry later if SEO-specific message routing is needed.

### SKILL_HANDLERS registration

All 8 GEO skills **must** have explicit handler entries in `SKILL_HANDLERS` in `skillExecutor.ts`. The backfill script (`scripts/backfill-system-skills.ts`) validates `handlerKey = slug` against `SKILL_HANDLERS` at run time and will reject any skill whose slug is not registered. `audit_seo` has its own explicit handler; the shared passthrough for generic methodology skills is `generic_methodology`.

Add 8 entries pointing to `generic_methodology`:

```typescript
// In SKILL_HANDLERS (server/services/skillExecutor.ts):
// Note: audit_geo uses generic_methodology for the LLM execution path.
// The write-path side effect (score persistence) is handled by the separately-
// registered processOutputStep processor in §8.3. SKILL_HANDLERS governs how
// the skill is executed; processOutputStep is a post-execution hook. They are
// independent — audit_geo's isMethodology:false / idempotencyStrategy:'write'
// live in the ActionDefinition (§4), not in SKILL_HANDLERS.
audit_geo: SKILL_HANDLERS.generic_methodology,
geo_citability: SKILL_HANDLERS.generic_methodology,
geo_crawlers: SKILL_HANDLERS.generic_methodology,
geo_schema: SKILL_HANDLERS.generic_methodology,
geo_platform_optimizer: SKILL_HANDLERS.generic_methodology,
geo_brand_authority: SKILL_HANDLERS.generic_methodology,
geo_llmstxt: SKILL_HANDLERS.generic_methodology,
geo_compare: SKILL_HANDLERS.generic_methodology,
```

Also update `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts`:
- Append all 8 slugs to `CANONICAL_HANDLER_KEYS`
- Update the count assertion from `105` to `113`

---

## 5. Schema Design

### Migration `0110_geo_audit_scores.sql`

One new table: `geo_audit_scores`. Stores composite and per-dimension scores after each GEO audit run, enabling historical tracking and trend analysis.

### Drizzle schema

**File:** `server/db/schema/geoAuditScores.ts`

```typescript
import {
  pgTable, uuid, text, integer, boolean, jsonb,
  timestamp, index,
} from 'drizzle-orm/pg-core';

export const geoAuditScores = pgTable('geo_audit_scores', {
  id: uuid('id').defaultRandom().primaryKey(),

  // ── Scoping ────────────────────────────────────────────────────────
  organisationId: uuid('organisation_id').notNull(),
  subaccountId: uuid('subaccount_id').notNull(),

  // ── Audit identity ─────────────────────────────────────────────────
  siteUrl: text('site_url').notNull(),
  agentRunId: uuid('agent_run_id'),  // nullable — manual imports won't have a run

  // ── Composite score ────────────────────────────────────────────────
  compositeScore: integer('composite_score').notNull(),  // 0-100

  // ── Dimension scores (each 0-100) ─────────────────────────────────
  citabilityScore: integer('citability_score'),
  brandAuthorityScore: integer('brand_authority_score'),
  contentQualityScore: integer('content_quality_score'),
  technicalInfraScore: integer('technical_infra_score'),
  structuredDataScore: integer('structured_data_score'),
  platformSpecificScore: integer('platform_specific_score'),

  // ── Weights used for this audit (frozen at audit time) ─────────────
  weightsJson: jsonb('weights_json').$type<{
    citability: number;
    brandAuthority: number;
    contentQuality: number;
    technicalInfra: number;
    structuredData: number;
    platformSpecific: number;
  }>().notNull(),

  // ── Platform breakdown (optional, from geo_platform_optimizer) ─────
  platformScoresJson: jsonb('platform_scores_json').$type<{
    googleAio?: number;
    chatgpt?: number;
    perplexity?: number;
    gemini?: number;
    bingCopilot?: number;
  }>(),

  // ── Crawler access summary ─────────────────────────────────────────
  // Values are the User-Agent strings from §3.3 (e.g. 'GPTBot', 'ClaudeBot', 'FacebookExternalHit').
  // Use the User-Agent column value from the §3.3 table, not the human-readable crawler name.
  // Three states: allowed (explicitly permitted), blocked (explicitly denied),
  // unknown (not mentioned in robots.txt — access is ambiguous, default allow).
  // Preserving the unknown set gives diagnostic power: a crawler in unknown[] may
  // be denied by a catch-all rule or allowed by default — the agent should note which.
  crawlerAccessJson: jsonb('crawler_access_json').$type<{
    allowed: string[];    // explicitly permitted by robots.txt
    blocked: string[];    // explicitly blocked by robots.txt
    unknown?: string[];   // not mentioned — may be caught by wildcard rules
  }>(),

  // ── Metadata ───────────────────────────────────────────────────────
  llmsTxtExists: boolean('llms_txt_exists'),
  schemaTypesFound: jsonb('schema_types_found').$type<string[]>(),  // e.g. ['Organization', 'Article', 'FAQPage']
  traditionalSeoScore: integer('traditional_seo_score'),  // from audit_seo if run alongside

  // ── Versioning ─────────────────────────────────────────────────────
  // Records which scoring methodology was active at audit time.
  // Phase 1 value: 'v1'.
  //
  // BUMP when (scores from before and after the change are not comparable):
  //   - dimension weights change
  //   - scoring formula or redistribution logic changes
  //   - dimension definitions change (e.g. a new sub-factor added to citability)
  //   - the set of dimensions changes (add/remove a dimension)
  //
  // DO NOT BUMP for:
  //   - prompt wording changes only (same methodology, same expected scores)
  //   - bug fixes that correct clearly wrong scores (bump is discretionary)
  //   - infrastructure changes (parsing, storage, routes)
  //
  // When bumping: update DEFAULT_METHODOLOGY_VERSION in limits.ts, add a
  // migration comment noting what changed and why. Future trend charts should
  // annotate methodology boundaries so score drops/jumps are explainable.
  methodologyVersion: text('methodology_version').notNull().default('v1'),

  auditedAt: timestamp('audited_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('geo_audit_scores_org_idx').on(table.organisationId),
  subaccountIdx: index('geo_audit_scores_subaccount_idx').on(table.subaccountId),
  siteUrlIdx: index('geo_audit_scores_site_url_idx').on(table.organisationId, table.siteUrl),
  auditedAtIdx: index('geo_audit_scores_audited_at_idx').on(table.subaccountId, table.auditedAt),
  agentRunIdx: index('geo_audit_scores_agent_run_idx').on(table.agentRunId),
}));

export type GeoAuditScore = typeof geoAuditScores.$inferSelect;
export type NewGeoAuditScore = typeof geoAuditScores.$inferInsert;
```

### Migration SQL

```sql
-- 0110_geo_audit_scores.sql

CREATE TABLE IF NOT EXISTS geo_audit_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),

  site_url TEXT NOT NULL,
  agent_run_id UUID REFERENCES agent_runs(id),

  composite_score INTEGER NOT NULL CHECK (composite_score >= 0 AND composite_score <= 100),

  citability_score INTEGER CHECK (citability_score >= 0 AND citability_score <= 100),
  brand_authority_score INTEGER CHECK (brand_authority_score >= 0 AND brand_authority_score <= 100),
  content_quality_score INTEGER CHECK (content_quality_score >= 0 AND content_quality_score <= 100),
  technical_infra_score INTEGER CHECK (technical_infra_score >= 0 AND technical_infra_score <= 100),
  structured_data_score INTEGER CHECK (structured_data_score >= 0 AND structured_data_score <= 100),
  platform_specific_score INTEGER CHECK (platform_specific_score >= 0 AND platform_specific_score <= 100),

  weights_json JSONB NOT NULL,
  platform_scores_json JSONB,
  crawler_access_json JSONB,

  llms_txt_exists BOOLEAN,
  schema_types_found JSONB,
  traditional_seo_score INTEGER CHECK (traditional_seo_score >= 0 AND traditional_seo_score <= 100),

  methodology_version TEXT NOT NULL DEFAULT 'v1',

  audited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX geo_audit_scores_org_idx ON geo_audit_scores (organisation_id);
CREATE INDEX geo_audit_scores_subaccount_idx ON geo_audit_scores (subaccount_id);
CREATE INDEX geo_audit_scores_site_url_idx ON geo_audit_scores (organisation_id, site_url);
CREATE INDEX geo_audit_scores_audited_at_idx ON geo_audit_scores (subaccount_id, audited_at);
CREATE INDEX geo_audit_scores_agent_run_idx ON geo_audit_scores (agent_run_id);

-- Idempotency: prevent duplicate score rows from the same agent run.
-- Scoped to non-null agent_run_id only (manual imports without a run are excluded).
CREATE UNIQUE INDEX geo_audit_scores_run_dedup_idx
  ON geo_audit_scores (agent_run_id, site_url)
  WHERE agent_run_id IS NOT NULL;
```

### Down migration

```sql
-- 0110_geo_audit_scores.down.sql
DROP TABLE IF EXISTS geo_audit_scores;
```

### RLS consideration

`geo_audit_scores` is a tenant-owned table. It needs a row-level security policy keyed on `organisation_id`. Add to `server/config/rlsProtectedTables.ts` in the same commit as the migration. The CI gate `verify-rls-coverage.sh` enforces this.

```sql
-- Add to migration 0110:
ALTER TABLE geo_audit_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY geo_audit_scores_org_isolation ON geo_audit_scores
  USING (organisation_id::text = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
```

### Schema export

Add `geoAuditScores` to `server/db/schema/index.ts` exports.

---

## 6. Service Layer

### 6.1 `geoAuditService.ts` — Impure service

**File:** `server/services/geoAuditService.ts`

Thin service for score persistence and query. Follows the existing pattern of `reportService.ts` and `workspaceHealthService.ts`.

```typescript
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { geoAuditScores, type GeoAuditScore } from '../db/schema/geoAuditScores.js';
import {
  computeCompositeScore,
  canonicaliseSiteUrl,
  DEFAULT_GEO_WEIGHTS,
  type GeoScoreInput,
  type GeoWeights,
} from './geoAuditServicePure.js';

export const geoAuditService = {

  /** Persist a GEO audit score after an audit_geo run completes. */
  async saveScore(params: {
    organisationId: string;
    subaccountId: string;
    siteUrl: string;
    agentRunId?: string;
    dimensions: GeoScoreInput;
    weights?: GeoWeights;
    platformScores?: {
      googleAio?: number | null;
      chatgpt?: number | null;
      perplexity?: number | null;
      gemini?: number | null;
      bingCopilot?: number | null;
    };
    crawlerAccess?: { allowed: string[]; blocked: string[]; unknown?: string[] };
    llmsTxtExists?: boolean;
    schemaTypesFound?: string[];
    traditionalSeoScore?: number;
  }): Promise<{ id: string; compositeScore: number }> {
    const siteUrl = canonicaliseSiteUrl(params.siteUrl);  // normalise before storage
    const weights = params.weights ?? DEFAULT_GEO_WEIGHTS;

    // Defensive clamp: last line of defence against out-of-range values that
    // passed validation but may have regressed from a future code path. The DB
    // CHECK constraints would catch these at insert time, but clamping here gives
    // a cleaner error surface and prevents a DB error from failing the persist path.
    const clamp = (v: number | null | undefined): number | null =>
      v == null ? null : Math.max(0, Math.min(100, Math.round(v)));

    const dimensions = {
      citability: clamp(params.dimensions.citability),
      brandAuthority: clamp(params.dimensions.brandAuthority),
      contentQuality: clamp(params.dimensions.contentQuality),
      technicalInfra: clamp(params.dimensions.technicalInfra),
      structuredData: clamp(params.dimensions.structuredData),
      platformSpecific: clamp(params.dimensions.platformSpecific),
    };

    const compositeScore = computeCompositeScore(dimensions, weights);

    const [row] = await db.insert(geoAuditScores).values({
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      siteUrl,
      agentRunId: params.agentRunId,
      compositeScore,
      citabilityScore: dimensions.citability,
      brandAuthorityScore: dimensions.brandAuthority,
      contentQualityScore: dimensions.contentQuality,
      technicalInfraScore: dimensions.technicalInfra,
      structuredDataScore: dimensions.structuredData,
      platformSpecificScore: dimensions.platformSpecific,
      weightsJson: weights,
      platformScoresJson: params.platformScores ?? null,
      crawlerAccessJson: params.crawlerAccess ?? null,
      llmsTxtExists: params.llmsTxtExists ?? null,
      schemaTypesFound: params.schemaTypesFound ?? null,
      traditionalSeoScore: params.traditionalSeoScore ?? null,
    })
    // Idempotency: if the same (agent_run_id, site_url) has already been persisted
    // (e.g. processor retry or duplicate trigger), skip silently — do not throw.
    // Only applies when agent_run_id is non-null (enforced by the partial unique index).
    .onConflictDoNothing()
    .returning({ id: geoAuditScores.id });

    // row is undefined when the partial unique index fired (duplicate run).
    // Log a structured warning for ops observability — this gives accurate signal
    // (post-insert, not a racy pre-check) without blocking the caller.
    if (!row) {
      logger.warn('geo_dedup_hit', {
        agentRunId: params.agentRunId,
        siteUrl,
        compositeScore,
      });
      return { id: params.agentRunId ?? '', compositeScore };
    }
    return { id: row.id, compositeScore };
  },

  /** Get score history for a site within a subaccount. */
  async getScoreHistory(
    organisationId: string,
    subaccountId: string,
    siteUrl: string,
    limit = 20,
  ) {
    const canonicalUrl = canonicaliseSiteUrl(siteUrl);  // normalise before query
    return db
      .select()
      .from(geoAuditScores)
      .where(and(
        eq(geoAuditScores.organisationId, organisationId),
        eq(geoAuditScores.subaccountId, subaccountId),
        eq(geoAuditScores.siteUrl, canonicalUrl),
      ))
      .orderBy(desc(geoAuditScores.auditedAt))
      .limit(limit);
  },

  /** Get the latest score for a site (used for trend indicator). */
  async getLatestScore(
    organisationId: string,
    subaccountId: string,
    siteUrl: string,
  ) {
    const canonicalUrl = canonicaliseSiteUrl(siteUrl);  // normalise before query
    const [row] = await db
      .select()
      .from(geoAuditScores)
      .where(and(
        eq(geoAuditScores.organisationId, organisationId),
        eq(geoAuditScores.subaccountId, subaccountId),
        eq(geoAuditScores.siteUrl, canonicalUrl),
      ))
      .orderBy(desc(geoAuditScores.auditedAt))
      .limit(1);
    return row ?? null;
  },

  /** Get latest scores across all sites in a subaccount (portfolio view). */
  async getSubaccountScores(organisationId: string, subaccountId: string) {
    // Note: db.execute() returns a driver-specific result object, not a typed array.
    // The caller (route handler) must extract the rows via result.rows before serialising.
    // Distinct on site_url, ordered by most recent audit
    const result = await db.execute(sql`
      SELECT DISTINCT ON (site_url) *
      FROM geo_audit_scores
      WHERE organisation_id = ${organisationId}
        AND subaccount_id = ${subaccountId}
      ORDER BY site_url, audited_at DESC
    `);
    return result.rows as GeoAuditScore[];
  },

  /** Get latest scores across all subaccounts in an org (agency portfolio). */
  async getOrgScores(organisationId: string) {
    // Note: db.execute() returns a driver-specific result object, not a typed array.
    // Extract result.rows before serialising.
    const result = await db.execute(sql`
      SELECT DISTINCT ON (subaccount_id, site_url) *
      FROM geo_audit_scores
      WHERE organisation_id = ${organisationId}
      ORDER BY subaccount_id, site_url, audited_at DESC
    `);
    return result.rows as GeoAuditScore[];
  },
};
```

### 6.2 `geoAuditServicePure.ts` — Pure helper

**File:** `server/services/geoAuditServicePure.ts`

Pure, side-effect-free scoring logic. Testable with fixture data. Follows the `*Pure.ts` convention verified by `verify-pure-helper-convention.sh`.

```typescript
// No imports from db/, services/, or any module with side effects.

/**
 * Canonicalise a root-domain site URL before storage or query.
 *
 * GEO audits operate at the site level (not the page level). The `site_url`
 * parameter in audit_geo is always a root domain — path components are stripped
 * entirely. This prevents history fragmentation between 'https://example.com',
 * 'https://example.com/', 'http://example.com/some-path', etc.
 *
 * Rules applied (in order):
 *   1. Prepend `https://` if scheme is absent
 *   2. Enforce `https:` scheme (upgrade http)
 *   3. Lowercase the hostname
 *   4. Strip default ports (80, 443)
 *   5. Strip path, query string, and fragment — site-level only
 *
 * Examples:
 *   'http://Example.com/'            → 'https://example.com'
 *   'https://example.com:443/'       → 'https://example.com'
 *   'https://example.com/blog/post'  → 'https://example.com'  (path stripped)
 *   'example.com'                    → 'https://example.com'
 *
 * Phase 2 tradeoff note: stripping the path to root domain means all pages of a
 * site share a single score history. This is the correct model for site-level GEO
 * audits where `audit_geo` evaluates the whole site. If Phase 2 introduces
 * page-level GEO scoring (e.g. per-article citability tracking), a separate
 * `canonicalisePageUrl` helper should be introduced that preserves the path but
 * still normalises scheme, host, and trailing slash. Do not change this function —
 * the site-level contract is correct for Phase 1.
 */
export function canonicaliseSiteUrl(url: string): string {
  // Prepend scheme if missing so URL() can parse it
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    // Throw a typed error so callers (routes, processOutputStep) can handle
    // malformed inputs consistently. The error message is stable and catchable.
    throw new Error('INVALID_SITE_URL');
  }
  // Enforce https
  parsed.protocol = 'https:';
  // Lowercase host
  parsed.hostname = parsed.hostname.toLowerCase();
  // Strip default ports
  if (parsed.port === '443' || parsed.port === '80') {
    parsed.port = '';
  }
  // Strip path, search, and hash — GEO is site-level, not page-level
  return `https://${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
}

export interface GeoScoreInput {
  citability: number | null;          // 0-100
  brandAuthority: number | null;
  contentQuality: number | null;
  technicalInfra: number | null;
  structuredData: number | null;
  platformSpecific: number | null;
}

export interface GeoWeights {
  citability: number;          // 0-1, sum = 1.0
  brandAuthority: number;
  contentQuality: number;
  technicalInfra: number;
  structuredData: number;
  platformSpecific: number;
}

export const DEFAULT_GEO_WEIGHTS: GeoWeights = {
  citability: 0.25,
  brandAuthority: 0.20,
  contentQuality: 0.20,
  technicalInfra: 0.15,
  structuredData: 0.10,
  platformSpecific: 0.10,
};

/**
 * Compute weighted composite GEO score from dimension scores.
 * Null dimensions are excluded and their weight redistributed proportionally.
 */
export function computeCompositeScore(
  input: GeoScoreInput,
  weights: GeoWeights = DEFAULT_GEO_WEIGHTS,
): number {
  const dimensions: [keyof GeoScoreInput, number][] = [
    ['citability', weights.citability],
    ['brandAuthority', weights.brandAuthority],
    ['contentQuality', weights.contentQuality],
    ['technicalInfra', weights.technicalInfra],
    ['structuredData', weights.structuredData],
    ['platformSpecific', weights.platformSpecific],
  ];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of dimensions) {
    const score = input[key];
    if (score !== null && score !== undefined) {
      totalWeight += weight;
      weightedSum += score * weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}

/**
 * Assert that a GeoWeights object is valid.
 * Throws if any weight is negative or if the sum is outside [0.99, 1.01].
 * Call this in saveScore before using custom weights from Phase 2 overrides.
 * Not needed for DEFAULT_GEO_WEIGHTS (statically correct), but required for
 * any dynamically sourced weights to prevent silent composite miscalculation.
 */
export function assertWeightsValid(weights: GeoWeights): void {
  const keys: (keyof GeoWeights)[] = [
    'citability', 'brandAuthority', 'contentQuality',
    'technicalInfra', 'structuredData', 'platformSpecific',
  ];
  for (const key of keys) {
    if (weights[key] < 0) {
      throw new Error(`GEO weight '${key}' is negative: ${weights[key]}`);
    }
  }
  const sum = keys.reduce((acc, k) => acc + weights[k], 0);
  if (sum < 0.99 || sum > 1.01) {
    throw new Error(`GEO weights do not sum to 1.0 (got ${sum.toFixed(4)})`);
  }
}

/**
 * Compute trend indicator from current and previous composite scores.
 */
export function computeTrend(
  current: number,
  previous: number | null,
): 'improving' | 'declining' | 'stable' | 'new' {
  if (previous === null) return 'new';
  const delta = current - previous;
  if (delta >= 5) return 'improving';
  if (delta <= -5) return 'declining';
  return 'stable';
}
```

### 6.3 Unit tests

**File:** `server/services/__tests__/geoAuditServicePure.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeCompositeScore,
  computeTrend,
  canonicaliseSiteUrl,
  DEFAULT_GEO_WEIGHTS,
} from '../geoAuditServicePure.js';

describe('computeCompositeScore', () => {
  it('computes weighted average with all dimensions', () => {
    const input = {
      citability: 80, brandAuthority: 60, contentQuality: 70,
      technicalInfra: 90, structuredData: 50, platformSpecific: 40,
    };
    const result = computeCompositeScore(input);
    // 80*0.25 + 60*0.20 + 70*0.20 + 90*0.15 + 50*0.10 + 40*0.10
    // = 20 + 12 + 14 + 13.5 + 5 + 4 = 68.5 → 69
    expect(result).toBe(69);
  });

  it('redistributes weight when dimensions are null', () => {
    const input = {
      citability: 100, brandAuthority: null, contentQuality: null,
      technicalInfra: null, structuredData: null, platformSpecific: null,
    };
    // Only citability present → composite = 100
    expect(computeCompositeScore(input)).toBe(100);
  });

  it('returns 0 when all dimensions null', () => {
    const input = {
      citability: null, brandAuthority: null, contentQuality: null,
      technicalInfra: null, structuredData: null, platformSpecific: null,
    };
    expect(computeCompositeScore(input)).toBe(0);
  });
});

describe('computeTrend', () => {
  it('returns new when no previous', () => {
    expect(computeTrend(75, null)).toBe('new');
  });
  it('returns improving when delta >= 5', () => {
    expect(computeTrend(75, 70)).toBe('improving');
  });
  it('returns declining when delta <= -5', () => {
    expect(computeTrend(65, 70)).toBe('declining');
  });
  it('returns stable when delta is small', () => {
    expect(computeTrend(72, 70)).toBe('stable');
  });
});

describe('canonicaliseSiteUrl', () => {
  it('strips trailing slash from root', () => {
    expect(canonicaliseSiteUrl('https://example.com/')).toBe('https://example.com');
  });
  it('lowercases the host', () => {
    expect(canonicaliseSiteUrl('https://Example.COM')).toBe('https://example.com');
  });
  it('upgrades http to https', () => {
    expect(canonicaliseSiteUrl('http://example.com')).toBe('https://example.com');
  });
  it('strips default port 443', () => {
    expect(canonicaliseSiteUrl('https://example.com:443/')).toBe('https://example.com');
  });
  it('prepends https when scheme is absent', () => {
    expect(canonicaliseSiteUrl('example.com')).toBe('https://example.com');
  });
  it('strips path — site-level only', () => {
    expect(canonicaliseSiteUrl('https://example.com/blog/post?q=1#anchor')).toBe('https://example.com');
  });
  it('throws INVALID_SITE_URL for malformed input', () => {
    expect(() => canonicaliseSiteUrl('http://')).toThrow('INVALID_SITE_URL');
    expect(() => canonicaliseSiteUrl('not-a-url')).toThrow('INVALID_SITE_URL');
  });
});
```

### 6.4 Constants

Add to `server/config/limits.ts`:

```typescript
// ── GEO Audit ──────────────────────────────────────────────────────
export const DEFAULT_GEO_CITABILITY_WEIGHT = 0.25;
export const DEFAULT_GEO_BRAND_AUTHORITY_WEIGHT = 0.20;
export const DEFAULT_GEO_CONTENT_QUALITY_WEIGHT = 0.20;
export const DEFAULT_GEO_TECHNICAL_INFRA_WEIGHT = 0.15;
export const DEFAULT_GEO_STRUCTURED_DATA_WEIGHT = 0.10;
export const DEFAULT_GEO_PLATFORM_SPECIFIC_WEIGHT = 0.10;
export const GEO_SCORE_HISTORY_DEFAULT_LIMIT = 20;
export const GEO_OPTIMAL_CITATION_LENGTH_MIN = 134;  // words
export const GEO_OPTIMAL_CITATION_LENGTH_MAX = 167;  // words
export const GEO_MAX_TARGET_PAGES = 5;               // hard cap incl. homepage
export const GEO_PAYLOAD_MAX_BYTES = 8192;           // parser size guard
export const GEO_OUTPUT_SCAN_MAX_BYTES = 200_000;    // fallback regex scan limit
export const GEO_PROCESSOR_TIMEOUT_MS = 2000;        // processOutputStep timeout
export const GEO_MIN_DIMENSIONS_FOR_PERSIST = 3;     // below this: low-confidence flag
export const DEFAULT_METHODOLOGY_VERSION = 'v1';     // bump when scoring logic changes
```

---

## 7. System Agent and Seed Script

### 7.1 System agent definition

A new system agent — "GEO-SEO Agent" — that combines traditional SEO auditing with GEO analysis. Follows the same three-tier model: system agent → org agent (isSystemManaged) → subaccount agent (per-client link).

**System agent row:**

| Field | Value |
|-------|-------|
| `name` | GEO-SEO Agent |
| `slug` | `geo-seo-agent` |
| `description` | Audits websites for AI search engine visibility (GEO) alongside traditional SEO. Produces composite scores, per-dimension breakdowns, competitor benchmarks, and prioritised improvement roadmaps. |
| `icon` | `search` |
| `agentRole` | `specialist` |
| `agentTitle` | GEO-SEO Specialist |
| `parentSystemAgentId` | `null` (standalone specialist; can be linked to a parent agent manually if needed) |
| `masterPrompt` | See §7.2 below |
| `modelProvider` | `anthropic` |
| `modelId` | `claude-sonnet-4-6` |
| `temperature` | `0.4` (lower than default — audit work benefits from consistency) |
| `maxTokens` | `8192` (audits produce long structured output) |
| `defaultSystemSkillSlugs` | `['audit_geo', 'geo_citability', 'geo_crawlers', 'geo_schema', 'geo_platform_optimizer', 'geo_brand_authority', 'geo_llmstxt', 'geo_compare']` |
| `defaultOrgSkillSlugs` | `['audit_seo', 'fetch_url', 'web_search', 'scrape_url', 'scrape_structured', 'create_task', 'add_deliverable', 'write_workspace', 'search_agent_history']` |
| `allowModelOverride` | `true` |
| `defaultTokenBudget` | `50000` (GEO audits are token-heavy due to page analysis) |
| `defaultMaxToolCalls` | `30` (primary execution ceiling — limits total `fetch_url`, `web_search`, and sub-skill calls per run; prevents runaway multi-page + competitor + search token spend) |
| `heartbeatEnabled` | `false` (configured per-subaccount) |
| `executionMode` | `api` |
| `executionScope` | `subaccount` |
| `isPublished` | `true` |
| `status` | `active` |

### 7.2 Master prompt

**File:** `server/agents/geo-seo-agent/master-prompt.md`

The master prompt defines the agent's identity, methodology, and operational constraints. This is platform IP — hidden from org admins.

**Structure:**

```markdown
# GEO-SEO Agent

You are the GEO-SEO Agent for Automation OS. Your role is to audit websites
for both traditional search engine optimisation (SEO) and Generative Engine
Optimisation (GEO) — measuring how well a site is positioned to be cited by
AI search engines.

## Your Methodology

You evaluate websites across 6 GEO dimensions:

1. **AI Citability (25%)** — Can AI engines extract clean, quotable passages?
   Optimal citation length: 134-167 words. Look for self-contained paragraphs
   with clear topic sentences, specific claims, and verifiable data.

2. **Brand Authority (20%)** — Is the brand a recognised entity? Check for
   Knowledge Panel presence, Wikipedia/Wikidata entries, third-party mentions,
   and citation density across the web.

3. **Content Quality / E-E-A-T (20%)** — Experience, Expertise,
   Authoritativeness, Trustworthiness. Author bylines with credentials, first-hand
   experience signals, publication dates, editorial standards.

4. **Technical Infrastructure (15%)** — Can AI crawlers access the site? Check
   robots.txt for 14+ AI crawlers, sitemap freshness, page speed indicators,
   mobile readiness, and X-Robots-Tag headers.

5. **Structured Data (10%)** — JSON-LD coverage. Organisation, Article, FAQ,
   HowTo, Product schemas. Correctness, completeness, and AI-specific properties
   like `speakable` and `author` typing.

6. **Platform-Specific (10%)** — Readiness for Google AI Overviews, ChatGPT,
   Perplexity, Gemini, and Bing Copilot. Each platform has specific preferences.

## Workflow

1. **Fetch and analyse** — Use `fetch_url` to retrieve the site homepage,
   robots.txt, and key pages. Use `web_search` for brand authority research.
2. **Score each dimension** — Apply the methodology from each GEO skill.
   Be specific — cite exact content from the page to justify each score.
3. **Compute composite** — Weight dimensions per the scoring framework.
4. **Compare** — If competitor URLs provided, run `geo_compare`.
5. **Report** — Produce a structured audit deliverable via `add_deliverable`.
6. **Persist** — The system captures your dimension scores for trend tracking.

## Constraints

- Never fabricate findings. Only report issues verifiable from page content.
- Score from actual analysis, not estimates.
- Every recommendation must be specific and actionable.
- If a page cannot be fetched, note the limitation — do not guess at content.
- Respect robots.txt in your own crawling behaviour.
```

### 7.3 Seed script additions

Add to `scripts/seed.ts` **Phase 2.5** — the GEO-SEO Agent is the 18th system agent (after the 16 company agents + Playbook Author). Use a direct `systemAgents` upsert (matching the Playbook Author pattern from Phase 3), not the company agent parser (Phase 2 reads from `companies/automation-os/` which is a different structure).

```typescript
// Phase 2.5 — GEO-SEO Agent
console.log('[seed] Phase 2.5: GEO-SEO Agent');
const geoSeoPrompt = readFileSync(
  resolve(__dirname, '../server/agents/geo-seo-agent/master-prompt.md'),
  'utf-8'
);

await db.insert(systemAgents).values({
  name: 'GEO-SEO Agent',
  slug: 'geo-seo-agent',
  description: 'Audits websites for AI search engine visibility (GEO) alongside traditional SEO.',
  agentRole: 'specialist',
  agentTitle: 'GEO-SEO Specialist',
  parentSystemAgentId: null,  // standalone specialist — link to a parent manually if needed
  masterPrompt: geoSeoPrompt,
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  temperature: 0.4,
  maxTokens: 8192,
  defaultSystemSkillSlugs: [
    'audit_geo', 'geo_citability', 'geo_crawlers', 'geo_schema',
    'geo_platform_optimizer', 'geo_brand_authority', 'geo_llmstxt', 'geo_compare',
  ],
  defaultOrgSkillSlugs: [
    'audit_seo', 'fetch_url', 'web_search', 'scrape_url', 'scrape_structured',
    'create_task', 'add_deliverable', 'write_workspace', 'search_agent_history',
  ],
  allowModelOverride: true,
  defaultTokenBudget: 50000,
  defaultMaxToolCalls: 30,
  heartbeatEnabled: false,
  executionMode: 'api',
  executionScope: 'subaccount',
  isPublished: true,
  status: 'active',
}).onConflictDoUpdate({
  target: systemAgents.slug,
  set: {
    masterPrompt: geoSeoPrompt,
    defaultSystemSkillSlugs: sql`EXCLUDED.default_system_skill_slugs`,
    defaultOrgSkillSlugs: sql`EXCLUDED.default_org_skill_slugs`,
    updatedAt: sql`NOW()`,
  },
});
console.log('[seed] GEO-SEO Agent upserted');
```

### 7.4 Dev fixtures extension

In the dev fixtures step (Phase 1, Step 15 or a dedicated dev-data pass after Step 11), add the GEO-SEO agent to the Synthetos Workspace subaccount:
1. Create an `agents` row for the org with `isSystemManaged: true`, `systemAgentId` = geo-seo-agent's ID
2. Create a `subaccountAgents` link to the Synthetos Workspace subaccount
3. Set `skillSlugs` to the union of system + org skill slugs

---

## 8. Routes, Permissions, and UI

### 8.1 Routes

**File:** `server/routes/geoAudit.ts`

New route file for GEO score history endpoints. Follows standard conventions: `asyncHandler`, `authenticate`, org scoping via `req.orgId`.

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/subaccounts/:subaccountId/geo-scores` | GET | `requireSubaccountPermission(EXECUTIONS_VIEW)` | List GEO score history for a site within a subaccount |
| `/api/subaccounts/:subaccountId/geo-scores/latest` | GET | `requireSubaccountPermission(EXECUTIONS_VIEW)` | Get latest GEO score for a site |
| `/api/org/geo-scores` | GET | `requireOrgPermission(EXECUTIONS_VIEW)` | Portfolio view — latest scores across all subaccounts |

**Query parameters (list endpoint):**
- `site_url` (required) — URL to query scores for
- `limit` (optional, default 20) — Number of historical scores

> **Phase 2 note:** Date-range filtering (`from` / `to`) will be added when the GEO dashboard is built in Phase 2.

**Query parameters (portfolio endpoint):**

> **Phase 2 note:** Per-subaccount filtering (`subaccount_ids`) will be added in Phase 2 when the portfolio view is built.

```typescript
// server/routes/geoAudit.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireSubaccountPermission, requireOrgPermission } from '../middleware/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { geoAuditService } from '../services/geoAuditService.js';
import { canonicaliseSiteUrl } from '../services/geoAuditServicePure.js';
import { GEO_SCORE_HISTORY_DEFAULT_LIMIT } from '../config/limits.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../config/permissions.js';

const router = Router();

// Subaccount: score history for a specific site
router.get(
  '/api/subaccounts/:subaccountId/geo-scores',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { site_url, limit } = req.query;
    if (!site_url || typeof site_url !== 'string') {
      throw { statusCode: 400, message: 'site_url query parameter required' };
    }
    // canonicaliseSiteUrl throws on malformed URLs — catch and return 400
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicaliseSiteUrl(site_url);
    } catch {
      throw { statusCode: 400, message: 'site_url is not a valid URL' };
    }
    // Validate limit: must be a positive integer, capped at GEO_SCORE_HISTORY_DEFAULT_LIMIT
    let parsedLimit: number | undefined;
    if (limit !== undefined) {
      parsedLimit = parseInt(limit as string, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        throw { statusCode: 400, message: 'limit must be a positive integer' };
      }
      parsedLimit = Math.min(parsedLimit, GEO_SCORE_HISTORY_DEFAULT_LIMIT);
    }
    const scores = await geoAuditService.getScoreHistory(
      req.orgId!, req.params.subaccountId, canonicalUrl, parsedLimit,
    );
    res.json(scores);
  })
);

// Subaccount: latest score for a site
router.get(
  '/api/subaccounts/:subaccountId/geo-scores/latest',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { site_url } = req.query;
    if (!site_url || typeof site_url !== 'string') {
      throw { statusCode: 400, message: 'site_url query parameter required' };
    }
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicaliseSiteUrl(site_url);
    } catch {
      throw { statusCode: 400, message: 'site_url is not a valid URL' };
    }
    const score = await geoAuditService.getLatestScore(
      req.orgId!, req.params.subaccountId, canonicalUrl,
    );
    // Not-found contract: return 200 with null (not 404) — the absence of a score
    // is a normal state (site never audited), not an error. Clients must handle null.
    res.json(score ?? null);
  })
);

// Org: portfolio view — latest scores across all subaccounts
router.get(
  '/api/org/geo-scores',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const scores = await geoAuditService.getOrgScores(req.orgId!);
    res.json(scores);
  })
);

export default router;
```

**Mount in `server/index.ts`:**

```typescript
import geoAuditRoutes from './routes/geoAudit.js';
app.use(geoAuditRoutes);
```

### 8.2 Permissions

No new permission keys required in Phase 1. GEO score endpoints reuse existing `EXECUTIONS_VIEW` permissions at both org and subaccount levels — GEO audit results are a type of execution output, so viewing them falls under the same permission as viewing agent run results.

Phase 2 may introduce `org.geo_audit.view` and `subaccount.geo_audit.view` if a dedicated GEO dashboard is added with different access control requirements.

### 8.3 Score persistence integration

The GEO-SEO agent produces structured output that includes dimension scores. To persist these scores to the `geo_audit_scores` table, add a **post-run hook** that parses the agent's output for GEO score data.

**Option A (recommended): Processor hook on `audit_geo` action type.**

Register a `processOutputStep` hook for the `audit_geo` skill that extracts dimension scores from the agent's structured output and calls `geoAuditService.saveScore()`. This keeps persistence logic in the skill pipeline rather than requiring a separate service.

```typescript
// In skillExecutor.ts processor registration:
// IMPORTANT: This processor must be safe under duplicate execution — the DB write
// is idempotent via the partial unique index (§5). Do not add compensating logic
// to prevent re-entry; rely on the DB constraint.
registerProcessor('audit_geo', {
  processOutputStep: async (context, result) => {
    // 1. Extract GEO_SCORE_PAYLOAD block (see parser contract below)
    // 2. Validate payload structure (see validation rules below)
    // 3. Call geoAuditService.saveScore(...) — idempotent via ON CONFLICT DO NOTHING
    // 4. Non-blocking — failure to persist MUST NOT fail the skill output.
    //    On any parse or persistence error, emit a structured failure event:
    //    createEvent('geo_score_persistence_failed', {
    //      agentRunId: context.agentRunId,
    //      siteUrl: context.params?.site_url,
    //      reason: 'parse_failed' | 'validation_failed' | 'db_error',
    //      detail: error.message,
    //    })
    //    This event is visible in the run trace for ops/debugging without surfacing
    //    to the end-user as a skill failure.
  },
});
```

**Parser contract:**

The `processOutputStep` extracts the payload using START/END delimiters:

```typescript
// Single-attempt rule: the processor runs at most once per agentRunId.
// audit_geo has maxRetries: 0, so retries are already prevented at the action layer.
// If called multiple times (e.g. processor infrastructure bug), use the first
// valid payload and ignore subsequent invocations — do not accumulate events.

// Primary: delimited block (preferred — unambiguous, tolerant of LLM whitespace)
const allMatches = [...output.matchAll(
  /<!--\s*GEO_SCORE_PAYLOAD_START\s*-->([\s\S]*?)<!--\s*GEO_SCORE_PAYLOAD_END\s*-->/g
)];
// Multiple payload blocks = ambiguous output — reject entirely
if (allMatches.length > 1) {
  emit geo_score_persistence_failed(reason: 'multiple_payloads');
  return;
}
const match = allMatches[0] ?? null;

// Fallback: if delimiters are absent (LLM dropped them), scan for the last
// JSON block in the output that satisfies ALL of the following:
//   - contains a top-level "dimensions" key
//   - contains a top-level "platformScores" key (or explicit null)
// Both keys must be present — a block missing either is not a valid payload
// (could be partial JSON, a different JSON object, or a hallucinated block).
// If neither match succeeds, emit geo_score_persistence_failed(reason: 'parse_failed')
// and return without persisting. Loose matching is explicitly prohibited — silent
// data corruption is worse than no data.
```

**Output length guard (fallback path only):** Before running the fallback regex scan, check `output.length`. If it exceeds 200,000 characters, skip the fallback entirely — do not scan. Large outputs can cause catastrophic regex backtracking. The primary delimited match is unaffected (bounded by the delimiters themselves). If the primary match also fails on an oversized output, emit `parse_failed` and return.

**Payload size guard:** Before parsing, check `matchedBlock.length`. If it exceeds `GEO_PAYLOAD_MAX_BYTES` (add to `server/config/limits.ts`, recommended value: `8192`), emit `geo_score_persistence_failed(reason: 'payload_too_large')` and skip persistence. This prevents runaway token-stuffed outputs from causing JSON parse OOM.

If no match, emit `geo_score_persistence_failed(reason: 'parse_failed')` and skip persistence. The skill is not failed.

**processOutputStep timeout:** Wrap the entire processor body in a timeout (recommended: 2000ms). On timeout, emit `geo_score_persistence_failed(reason: 'db_error', detail: 'processor timeout')` and return — do not block the pipeline thread. The skill output is unaffected.

**Payload validation (run before calling saveScore):**

Before persisting, validate that the parsed JSON meets minimum requirements. Skip persistence (emit `geo_score_persistence_failed(reason: 'validation_failed')`) if any check fails:
- `payload.dimensions` must be a non-null object
- All 6 dimension keys must be present (values may be `null`, but the key must exist):
  ```typescript
  const REQUIRED_DIMENSION_KEYS = [
    'citability', 'brandAuthority', 'contentQuality',
    'technicalInfra', 'structuredData', 'platformSpecific',
  ] as const;
  ```
  Missing keys indicate the LLM truncated or reformatted the payload — reject rather than silently store an incomplete record.
- At least one dimension field must be a number (not all null) — a fully-null dimension set cannot produce a meaningful composite score
- Dimension values, if non-null, must be **`typeof score === 'number'`** (not string) AND integers in `[0, 100]`. String numerics (e.g. `"85"`) must be rejected — they pass range checks but indicate LLM format drift.
- `traditionalSeoScore`, if non-null, must be a number (not string) in `[0, 100]`
- If all `platformScores` values are null or absent, store `platformScoresJson` as `null` (do not store an all-null object). This keeps the `platformSpecificScore` dimension null and excluded from composite redistribution.

**`platformScores` validation (run before save):** For each platform field (`googleAio`, `chatgpt`, `perplexity`, `gemini`, `bingCopilot`), apply the same rules as dimension scores: `typeof score === 'number'` and value in `[0, 100]`. String numerics (e.g. `"72"`) must be rejected. Failing any check for a specific platform: store that field as `null` (do not fail the entire persist). If all platform fields are null after validation, store `platformScoresJson` as `null`.

**`schemaTypesFound` sanitisation (run before save):**
1. Check `Array.isArray(payload.schemaTypesFound)` — if not an array, store as `null`
2. Trim whitespace from each entry: `.map(s => s.trim())`
3. Cap each entry at 50 characters: `.map(s => s.slice(0, 50))`
4. Drop empty strings after trim
5. Deduplicate (case-insensitive): keep first occurrence of each lowercased value
6. Cap at 20 entries (take first 20 after dedup)
7. **Sort alphabetically**: `.sort((a, b) => a.localeCompare(b))` — deterministic output for DB diffs and memory cache comparisons

**`crawlerAccess` structure + whitelist filtering (run before save):**
1. Check that `payload.crawlerAccess` is a non-null object
2. For each of `allowed`, `blocked`, `unknown`: check `Array.isArray()` — if not an array, treat as empty array (do not fail persistence)
3. Filter each array against the canonical User-Agent list from §3.3 (export as `KNOWN_GEO_CRAWLERS` constant). Drop any string not in the list.
4. Result may have all-empty arrays — that is a valid (fully-unknown) crawl state and should be stored as-is.

**Low-confidence guard:** After validation, count `nonNullDimensions` (number of dimension fields that are non-null numbers). If `nonNullDimensions < 3`, the composite is mathematically valid but potentially misleading. Do not reject — persist the score, but emit an info event: `createEvent('geo_low_confidence_score', { agentRunId, siteUrl, nonNullDimensions })`. Set `lowConfidence: true` in the `signals` block written to workspace memory (see §2 Q2). This allows downstream dashboards to surface confidence warnings without silently discarding partial audits.

**Persistence success event:** After a successful `geoAuditService.saveScore()` call, emit: `createEvent('geo_persistence_success', { agentRunId, siteUrl, compositeScore, nonNullDimensions })`. This is the counterpart to `geo_score_persistence_failed` and enables aggregate success-rate monitoring. Without it, a silent drop in successful persists would be invisible in ops dashboards.

**`site_url` identity lock:** The processor must always use `context.params.site_url` as the canonical site URL — never trust any site_url-like field from the payload itself. The LLM may emit a competitor URL, a page URL, or a reformatted version. The run context is the authoritative source of which site was audited. Pass `context.params.site_url` directly to `geoAuditService.saveScore()` — do not extract it from the payload.

**Composite score authority:** The service always recomputes the composite from the parsed `dimensions` object via `computeCompositeScore`. Any composite score the LLM may have included in the payload is ignored — the service is the authoritative source. If the absolute difference between the LLM's stated composite (if present) and the service-computed composite exceeds 5 points, emit a non-blocking warning event: `createEvent('geo_composite_drift', { agentRunId, llmComposite, computedComposite, delta })`. This detects scoring logic bugs or prompt drift without failing the persist path.

**Event severity classification:**

| Event | Severity | Meaning |
|-------|----------|---------|
| `geo_score_persistence_failed` reason `parse_failed` | `warning` | Payload block missing or could not be extracted |
| `geo_score_persistence_failed` reason `validation_failed` | `warning` | Payload structure invalid — missing keys, wrong types |
| `geo_score_persistence_failed` reason `payload_too_large` | `warning` | Payload exceeded `GEO_PAYLOAD_MAX_BYTES` |
| `geo_score_persistence_failed` reason `multiple_payloads` | `warning` | LLM emitted more than one payload block — ambiguous |
| `geo_score_persistence_failed` reason `db_error` | `error` | DB write failed after valid parse — infrastructure issue |
| `geo_composite_drift` | `info` | LLM composite and service composite diverge by >5 points |
| `geo_dedup_hit` | `info` | Duplicate insert skipped by partial unique index |
| `geo_low_confidence_score` | `info` | Fewer than 3 dimensions non-null — score stored but marked low-confidence |
| `geo_persistence_success` | `info` | Score persisted successfully — used for success-rate aggregation |

Severity guides future alerting: `error` events should page oncall; `warning` events are aggregated for daily review; `info` events are trace-only. Track the `geo_persistence_success` / `geo_score_persistence_failed` ratio as a rolling success rate — a drop below 90% indicates systemic prompt or parser drift.

**Field mapping** (payload path → Drizzle camelCase):

| Payload path | DB column |
|---|---|
| `dimensions.citability` | `citabilityScore` |
| `dimensions.brandAuthority` | `brandAuthorityScore` |
| `dimensions.contentQuality` | `contentQualityScore` |
| `dimensions.technicalInfra` | `technicalInfraScore` |
| `dimensions.structuredData` | `structuredDataScore` |
| `dimensions.platformSpecific` | `platformSpecificScore` |
| `platformScores` (object) | `platformScoresJson` |
| `crawlerAccess` (object) | `crawlerAccessJson` |
| `llmsTxtExists` | `llmsTxtExists` |
| `schemaTypesFound` (array) | `schemaTypesFound` |
| `traditionalSeoScore` | `traditionalSeoScore` |

Missing or null dimension scores are stored as `NULL` in the DB and excluded from composite score weighting via the redistribution logic in `computeCompositeScore`.

**Option B: Parse from deliverable body.**

An alternative is a lightweight post-run job that scans deliverables for GEO score patterns. Deferred — Option A is cleaner and more reliable.

### 8.4 UI integration (Phase 1 — minimal)

No new pages or components in Phase 1. The GEO-SEO agent produces deliverables that render in the existing task board and run trace viewer. Users see:

1. **Run trace viewer** — Full audit output in the agent conversation
2. **Task deliverable** — Structured GEO audit report attached as deliverable
3. **Handoff card** — Next recommended action from `handoffJson`

Phase 2 adds:
- GEO Score trend chart on the subaccount agent detail page
- GEO column in the portfolio / activity page
- Dashboard widget showing aggregate GEO scores

---

## 9. Phasing and Implementation Order

### Phase 1 — Core skill cluster + agent + score storage

**Estimated file count:** ~20 new/modified files

| Step | Files | Depends on |
|------|-------|-----------|
| 1. Migration + schema | `migrations/0110_geo_audit_scores.sql`, `migrations/_down/0110_geo_audit_scores.down.sql`, `server/db/schema/geoAuditScores.ts`, `server/db/schema/index.ts`, `server/config/rlsProtectedTables.ts` | — |
| 2. Pure helper + constants | `server/services/geoAuditServicePure.ts`, `server/config/limits.ts` | — |
| 3. Unit tests | `server/services/__tests__/geoAuditServicePure.test.ts` | Step 2 |
| 4. Service layer | `server/services/geoAuditService.ts` | Steps 1, 2 |
| 5. Skill definitions (8 files) | `server/skills/audit_geo.md`, `geo_citability.md`, `geo_crawlers.md`, `geo_schema.md`, `geo_platform_optimizer.md`, `geo_brand_authority.md`, `geo_llmstxt.md`, `geo_compare.md` | — |
| 6. Action registry | `server/config/actionRegistry.ts` (add standalone `audit_geo` ActionDefinition + 7 sub-skill entries to methodology batch) | Step 5 |
| 7. Topic registry | `server/config/topicRegistry.ts` (add `geo` topic) | — |
| 8. SKILL_HANDLERS + equivalence test | `server/services/skillExecutor.ts` (add 8 `generic_methodology` entries), `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts` (update CANONICAL_HANDLER_KEYS + count 105→113) | Step 5 |
| 9. System skills backfill | `scripts/backfill-system-skills.ts` (run to upsert new skills to DB) | Steps 5, 8 |
| 10. Master prompt | `server/agents/geo-seo-agent/master-prompt.md` | — |
| 11. Seed script | `scripts/seed.ts` (Phase 2.5 for GEO-SEO agent) | Steps 9, 10 |
| 12. Routes | `server/routes/geoAudit.ts`, `server/index.ts` (mount) | Steps 2, 4 |
| 13. Score persistence hook | `server/services/skillExecutor.ts` (processor registration for `audit_geo`) | Steps 4, 8 |
| 14. Doc updates | `architecture.md`, `docs/capabilities.md`, `KNOWLEDGE.md` | All above |
| 15. Verification | Run all gates, tests, typecheck, lint | All above |

### Phase 2 — Portfolio UI and dashboard insights (deferred)

- Per-org weight customisation column on `organisations` table + settings UI
- GEO Score trend chart component on subaccount agent detail page
- Portfolio-level GEO dashboard widget
- GEO scores surfaced in Activity page
- Integration with `query_subaccount_cohort` for GEO-aware cohort analysis

### Phase 3 — Recurring audits, trends, alerts, client-facing (deferred)

- Heartbeat configuration UI presets for weekly/monthly GEO audits
- Alert thresholds on score drops (workspace health detector: `geoScoreDrop`)
- PDF report generation for client delivery
- Client portal GEO summary view
- Historical trend comparison charts

---

## 10. Verification Checklist

Run after every non-trivial change. All must pass before marking Phase 1 complete.

### Static gates

| Gate | Relevance |
|------|-----------|
| `npm run lint` | Any code change |
| `npm run typecheck` | Any TypeScript change |
| `npm test` | Logic change in service layer |
| `npm run db:generate` | Schema change — verify migration file |
| `verify-action-registry-zod.sh` | New action registry entries have Zod schemas |
| `verify-idempotency-strategy-declared.sh` | New entries declare idempotency strategy |
| `verify-pure-helper-convention.sh` | `geoAuditServicePure.ts` has no impure imports |
| `verify-rls-coverage.sh` | `geo_audit_scores` in `rlsProtectedTables.ts` has matching `CREATE POLICY` |
| `verify-no-db-in-routes.sh` | Routes don't import `db` directly |
| `verify-async-handler.sh` | Route handlers use `asyncHandler` |
| `verify-subaccount-resolution.sh` | `:subaccountId` routes call `resolveSubaccount` |
| `verify-org-scoped-writes.sh` | Service writes filter by `organisationId` |

### Runtime tests

| Test | What it proves |
|------|---------------|
| `geoAuditServicePure.test.ts` | Composite score computation correct, null handling, trend indicators |
| Manual: run `backfill-system-skills.ts` | All 8 skill files parse correctly, handler keys resolve |
| Manual: run `seed.ts` | GEO-SEO agent upserts without error |
| Manual: trigger `audit_geo` via agent chat | End-to-end skill execution, output format, score persistence |
| Manual: query `/api/subaccounts/:id/geo-scores` | Route returns persisted scores correctly |

### Functional validation

- [ ] Agent can fetch a real URL via `fetch_url` and analyse robots.txt
- [ ] Agent produces a structured GEO audit with all 6 dimension scores
- [ ] Scores are persisted to `geo_audit_scores` table
- [ ] Score history endpoint returns correct data
- [ ] Portfolio endpoint returns latest scores across subaccounts
- [ ] Agent produces a readable deliverable via `add_deliverable`
- [ ] `geo_compare` produces a meaningful competitive comparison
- [ ] Traditional SEO audit (`audit_seo`) integrates correctly when `include_traditional_seo: true`

### Pre-launch real-world scenarios (run before first production deployment)

Run `audit_geo` against each scenario. Validate the pass criteria before marking Phase 1 complete.

| Scenario | Site type | Pass criteria |
|----------|-----------|---------------|
| **Clean site** | Well-optimised site with JSON-LD, fast load, llms.txt | Score ≥ 65, all 6 dimensions non-null, score persisted, no persistence events other than `geo_persistence_success` |
| **Broken site** | Minimal schema, no llms.txt, slow response | Score ≤ 45, `schemaTypesFound` empty or minimal, `llmsTxtExists: false`, score persisted |
| **JS-heavy site** | SPA with client-rendered content | Fetch resilience rule fires for at least one page, "Data Gaps" section appears in output, partial audit completes without abort |
| **Blocked robots.txt** | Site that blocks major AI crawlers | `crawlerAccessJson.blocked` non-empty, major-crawler deductions reflected in `technicalInfraScore`, score persisted |
| **Messy SMB site** | Random small business site with inconsistent markup | No unhandled processor errors, `geo_persistence_success` emitted or `geo_low_confidence_score` if <3 dimensions, workspace memory written with correct key format |

Acceptance bar: zero `db_error` events, zero unhandled exceptions in the run trace, persistence success rate 100% across the 5 scenarios.

---

## 11. Doc Updates Required

These updates must land in the same commit as the code changes.

### `architecture.md`

1. **Skill System section** — Update skill count from 99 to 108 (note: architecture.md currently reads "99 built-in system skills" but the actual count is 100; the +8 GEO skills makes the true final count 108). Add GEO skills to the category table:

```
| GEO-SEO | `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare` |
```

2. **Migrations section** — Add entry for `0110 — geo_audit_scores — GEO audit dimension scores and composite scores`

3. **System agents** — Note the GEO-SEO Agent as the 18th system agent

### `docs/capabilities.md`

1. **SEO Management section** — Expand to cover GEO:

```markdown
### SEO & GEO Management

| | |
|---|---|
| **Outcome** | Clients receive comprehensive search visibility audits covering both traditional SEO and AI search engine optimisation (GEO) |
| **Trigger** | Recurring schedule, on-demand request, or competitive benchmark |
| **Deliverable** | Unified audit report with traditional SEO score, GEO Score (0-100 across 6 dimensions), platform-specific readiness, and 30-day improvement roadmap |

- On-page SEO auditing with per-issue recommendations
- GEO scoring across 6 dimensions: AI Citability, Brand Authority, E-E-A-T, Technical Infrastructure, Structured Data, Platform-Specific readiness
- AI crawler access verification (14+ crawlers: GPTBot, ClaudeBot, PerplexityBot, etc.)
- llms.txt standard analysis and recommendations
- Competitive GEO benchmarking against 2-3 competitors
- Historical score tracking with trend analysis
- Platform-specific readiness for Google AI Overviews, ChatGPT, Perplexity, Gemini, Bing Copilot
```

2. **Skills Reference** — Add 8 new skills to the Campaign & Marketing table:

| Skill | Description | Type | Gate |
|-------|-------------|------|------|
| `audit_geo` | Comprehensive GEO audit with composite score across 6 dimensions | LLM | — |
| `geo_citability` | Analyse content for AI citation readiness | LLM | — |
| `geo_crawlers` | Check robots.txt for AI crawler access | LLM | — |
| `geo_schema` | Evaluate JSON-LD structured data for AI consumption | LLM | — |
| `geo_platform_optimizer` | Platform-specific readiness scores | LLM | — |
| `geo_brand_authority` | Evaluate brand entity strength and citation density | LLM | — |
| `geo_llmstxt` | Analyse site llms.txt file | LLM | — |
| `geo_compare` | Competitive GEO benchmarking | LLM | — |

3. Update skill count from 100 to 108.

### `KNOWLEDGE.md`

Append entry:

```markdown
### 2026-04-13 Decision — GEO sub-skills are methodology skills; audit_geo is a write-path orchestrator

The 7 GEO sub-skills (`geo_citability`, `geo_crawlers`, `geo_schema`,
`geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`)
are methodology skills — pure prompt scaffolds with `isMethodology: true`,
`idempotencyStrategy: 'read_only'` in the action registry. They use the
methodology fast-path in proposeActionMiddleware (lightweight audit row, no full
action proposal).

`audit_geo` is distinct: `isMethodology: false`, `idempotencyStrategy: 'write'`
— it orchestrates the audit AND persists scores via a processOutputStep hook.
It has its own standalone ActionDefinition entry BEFORE the methodology batch.
File: `server/config/actionRegistry.ts` (standalone entry + methodology batch)
and `server/services/skillExecutor.ts` (processor registration for `audit_geo`).
```

---

*End of specification. Ready for spec-reviewer when this draft is finalised.*
