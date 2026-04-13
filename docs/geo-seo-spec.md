# GEO-SEO Integration — Technical Specification

**Date:** 2026-04-13
**Status:** Draft — pending review
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

GEO skills are **methodology skills** — pure prompt scaffolds that instruct the agent how to analyse a page, with no programmatic side effects. This matches the existing `audit_seo` pattern: the LLM reads the page (via `fetch_url` / `web_search`), applies the methodology, and returns structured findings. No custom TypeScript handler logic is needed beyond registering the action type.

The only non-methodology component is score storage: a `geo_audit_scores` table that persists composite and dimension scores per subaccount for historical tracking and trend analysis. A thin service (`geoAuditService.ts`) handles writes and queries.

### Scope boundaries

**In scope:**
- 8 skill `.md` files under `server/skills/`
- 8 action registry entries in `actionRegistry.ts` (methodology batch)
- 1 Drizzle schema table + migration `0110`
- 1 service file (`geoAuditService.ts`) + pure companion
- 1 system agent definition (seeded in `scripts/seed.ts` Phase 2)
- Route endpoints for GEO score history
- Updates to `architecture.md`, `capabilities.md`, `KNOWLEDGE.md`

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
| Methodology skill pattern | All 8 GEO skills are `isMethodology: true`, `idempotencyStrategy: 'read_only'` |
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

### Q3: Weight customisation — per-org or system-wide?

**Resolution: System-wide defaults in Phase 1. Per-org override column reserved in schema.**

The `geo_audit_scores` table includes a `weights_json` column that records the weights used for that specific audit (frozen at audit time). Phase 1 uses hardcoded defaults from `server/config/limits.ts`. Phase 2 adds an org-level settings column and UI to adjust weights.

### Q4: UI scope — dedicated GEO dashboard or extend existing?

**Resolution: Phase 1 has no dedicated UI beyond the existing run trace viewer and deliverable display.** The agent produces structured deliverables that render in the existing task/deliverable UI. Phase 2 adds a GEO tab to the subaccount agent detail page showing score history charts.

### Q5: PDF reports — needed for Phase 1?

**Resolution: No.** Task deliverables are sufficient. PDF generation deferred to Phase 3.

### Q6: llms.txt generation — read-only or generate?

**Resolution: Read-only analysis in Phase 1.** The `geo_llmstxt` skill checks whether an `llms.txt` file exists and evaluates its quality. It does not generate or host the file — that would require file-serving infrastructure outside the current platform scope. The skill recommends what the `llms.txt` should contain; the agency implements it on the client's site.

---

## 3. Skill Definitions

All 8 skills are methodology skills — `.md` files under `server/skills/`. Each follows the existing frontmatter + parameters + instructions pattern established by `audit_seo.md`.

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
- `target_pages: string` — Comma-separated URLs of key pages to analyse (default: homepage + up to 4 linked pages)
- `include_traditional_seo: boolean` — Also run traditional SEO checks via audit_seo (default: true)
- `competitor_urls: string` — Comma-separated competitor URLs for comparative context

**Instructions summary:**
1. Fetch the site's homepage and up to 4 key pages via `fetch_url`
2. Run each sub-dimension analysis (citability, crawlers, schema, platform optimisation, brand authority, llms.txt) — the agent calls each sub-skill or applies the methodology inline depending on context
3. Compute dimension scores (0–100 each) using the scoring framework below
4. Compute weighted composite GEO Score
5. If `include_traditional_seo` is true, also run `audit_seo` on the primary page
6. Produce a unified report combining GEO + traditional SEO findings
7. Persist the score via the structured output format (service layer picks this up)

**Scoring Framework (hardcoded Phase 1, tunable Phase 2):**

| Dimension | Default Weight | Skill | What It Measures |
|-----------|---------------|-------|-----------------|
| AI Citability | 25% | `geo_citability` | Can AI engines extract and cite clean content passages? |
| Brand Authority | 20% | `geo_brand_authority` | Entity recognition, brand mentions, knowledge graph presence |
| Content Quality / E-E-A-T | 20% | (inline in `audit_geo`) | Experience, expertise, authoritativeness, trustworthiness signals |
| Technical Infrastructure | 15% | `geo_crawlers` | AI crawler access, Core Web Vitals indicators, crawlability |
| Structured Data | 10% | `geo_schema` | JSON-LD schema coverage and correctness |
| Platform-Specific | 10% | `geo_platform_optimizer` | Per-engine optimisation readiness |

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
```

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

**Score: 0–100.** Deductions:
- Major AI crawler blocked (GPTBot, ClaudeBot, PerplexityBot, GoogleOther): -15 each
- Minor AI crawler blocked: -5 each
- No sitemap: -10
- Stale sitemap (>30 days): -5
- X-Robots-Tag noindex on key pages: -20

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

**Dimension score:** Average of per-platform scores.

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

**If file does not exist — recommend creation:**
- Score: 0 (file missing)
- Generate recommended `llms.txt` content based on site analysis
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
| **Composite** | **[score]** | **[score]** | **[score]** | **[score]** |

## Competitive Gaps

[Where the primary site falls behind competitors — specific, actionable]

## Competitive Advantages

[Where the primary site leads — leverage and protect these]

## Priority Actions

[Top 5 actions to close the most impactful gaps]
```

---

## 4. Action Registry Entries

All 8 GEO skills are methodology skills — they join the existing batch in `server/config/actionRegistry.ts` (line ~1707). No individual `ActionDefinition` objects needed; they go in the `Object.fromEntries` array alongside `audit_seo`, `draft_content`, etc.

### Additions to methodology skills array

```typescript
// In server/config/actionRegistry.ts, inside the methodology skills batch:
['audit_geo', 'Comprehensive GEO audit — AI search visibility across 6 dimensions with composite score.', ['seo', 'geo']],
['geo_citability', 'Analyse content for AI citation readiness — passage structure, claim clarity, quotable formatting.', ['seo', 'geo']],
['geo_crawlers', 'Check robots.txt and HTTP headers for AI crawler access across 14+ crawlers.', ['seo', 'geo']],
['geo_schema', 'Evaluate JSON-LD structured data coverage and correctness for AI engine consumption.', ['seo', 'geo']],
['geo_platform_optimizer', 'Platform-specific readiness scores for Google AI Overviews, ChatGPT, Perplexity, Gemini, Bing Copilot.', ['seo', 'geo']],
['geo_brand_authority', 'Evaluate brand entity strength, knowledge graph presence, and citation density.', ['seo', 'geo']],
['geo_llmstxt', 'Analyse or recommend the site llms.txt file for AI discoverability.', ['seo', 'geo']],
['geo_compare', 'Benchmark GEO readiness against 2-3 competitors with gap analysis.', ['seo', 'geo']],
```

### Properties inherited from methodology batch

All entries automatically get:

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
1. The topic filter middleware routes GEO-related messages to these skills
2. They group alongside the existing `audit_seo` (topic: `['content']`) in the skill selector
3. A new `'geo'` topic is introduced — add to `server/config/topicRegistry.ts` with keywords: `geo`, `generative engine`, `ai search`, `ai visibility`, `citability`, `llms.txt`, `ai crawler`, `gptbot`, `perplexitybot`

### SKILL_HANDLERS registration

Since methodology skills use the default passthrough handler, no new entries are needed in `SKILL_HANDLERS` in `skillExecutor.ts`. The methodology fast-path in `proposeActionMiddleware` handles them.

**However**, the backfill script (`scripts/backfill-system-skills.ts`) parses `.md` files and validates `handlerKey = slug` against `SKILL_HANDLERS`. For methodology skills, there must be a handler entry. Check whether existing methodology skills (e.g. `audit_seo`) have explicit handlers or use a shared methodology handler. If explicit entries are needed, add 8 passthrough entries:

```typescript
// In SKILL_HANDLERS, if explicit entries required for methodology skills:
audit_geo: methodologyPassthrough,
geo_citability: methodologyPassthrough,
geo_crawlers: methodologyPassthrough,
geo_schema: methodologyPassthrough,
geo_platform_optimizer: methodologyPassthrough,
geo_brand_authority: methodologyPassthrough,
geo_llmstxt: methodologyPassthrough,
geo_compare: methodologyPassthrough,
```

Where `methodologyPassthrough` is the existing pattern used by `audit_seo` and similar. Verify at implementation time.

---

## 5. Schema Design

### Migration `0110_geo_audit_scores.sql`

One new table: `geo_audit_scores`. Stores composite and per-dimension scores after each GEO audit run, enabling historical tracking and trend analysis.

### Drizzle schema

**File:** `server/db/schema/geoAuditScores.ts`

```typescript
import {
  pgTable, uuid, text, integer, real, jsonb,
  timestamp, index, uniqueIndex,
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
  crawlerAccessJson: jsonb('crawler_access_json').$type<{
    allowed: string[];   // crawler user-agents that can access
    blocked: string[];   // crawler user-agents blocked by robots.txt
  }>(),

  // ── Metadata ───────────────────────────────────────────────────────
  llmsTxtExists: boolean('llms_txt_exists'),
  schemaTypesFound: jsonb('schema_types_found').$type<string[]>(),  // e.g. ['Organization', 'Article', 'FAQPage']
  traditionalSeoScore: integer('traditional_seo_score'),  // from audit_seo if run alongside

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

  audited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX geo_audit_scores_org_idx ON geo_audit_scores (organisation_id);
CREATE INDEX geo_audit_scores_subaccount_idx ON geo_audit_scores (subaccount_id);
CREATE INDEX geo_audit_scores_site_url_idx ON geo_audit_scores (organisation_id, site_url);
CREATE INDEX geo_audit_scores_audited_at_idx ON geo_audit_scores (subaccount_id, audited_at);
CREATE INDEX geo_audit_scores_agent_run_idx ON geo_audit_scores (agent_run_id);
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
import { geoAuditScores } from '../db/schema/geoAuditScores.js';
import {
  computeCompositeScore,
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
    platformScores?: Record<string, number>;
    crawlerAccess?: { allowed: string[]; blocked: string[] };
    llmsTxtExists?: boolean;
    schemaTypesFound?: string[];
    traditionalSeoScore?: number;
  }): Promise<{ id: string; compositeScore: number }> {
    const weights = params.weights ?? DEFAULT_GEO_WEIGHTS;
    const compositeScore = computeCompositeScore(params.dimensions, weights);

    const [row] = await db.insert(geoAuditScores).values({
      organisationId: params.organisationId,
      subaccountId: params.subaccountId,
      siteUrl: params.siteUrl,
      agentRunId: params.agentRunId,
      compositeScore,
      citabilityScore: params.dimensions.citability,
      brandAuthorityScore: params.dimensions.brandAuthority,
      contentQualityScore: params.dimensions.contentQuality,
      technicalInfraScore: params.dimensions.technicalInfra,
      structuredDataScore: params.dimensions.structuredData,
      platformSpecificScore: params.dimensions.platformSpecific,
      weightsJson: weights,
      platformScoresJson: params.platformScores ?? null,
      crawlerAccessJson: params.crawlerAccess ?? null,
      llmsTxtExists: params.llmsTxtExists ?? null,
      schemaTypesFound: params.schemaTypesFound ?? null,
      traditionalSeoScore: params.traditionalSeoScore ?? null,
    }).returning({ id: geoAuditScores.id });

    return { id: row.id, compositeScore };
  },

  /** Get score history for a site within a subaccount. */
  async getScoreHistory(
    organisationId: string,
    subaccountId: string,
    siteUrl: string,
    limit = 20,
  ) {
    return db
      .select()
      .from(geoAuditScores)
      .where(and(
        eq(geoAuditScores.organisationId, organisationId),
        eq(geoAuditScores.subaccountId, subaccountId),
        eq(geoAuditScores.siteUrl, siteUrl),
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
    const [row] = await db
      .select()
      .from(geoAuditScores)
      .where(and(
        eq(geoAuditScores.organisationId, organisationId),
        eq(geoAuditScores.subaccountId, subaccountId),
        eq(geoAuditScores.siteUrl, siteUrl),
      ))
      .orderBy(desc(geoAuditScores.auditedAt))
      .limit(1);
    return row ?? null;
  },

  /** Get latest scores across all sites in a subaccount (portfolio view). */
  async getSubaccountScores(organisationId: string, subaccountId: string) {
    // Distinct on site_url, ordered by most recent audit
    return db.execute(sql`
      SELECT DISTINCT ON (site_url) *
      FROM geo_audit_scores
      WHERE organisation_id = ${organisationId}
        AND subaccount_id = ${subaccountId}
      ORDER BY site_url, audited_at DESC
    `);
  },

  /** Get latest scores across all subaccounts in an org (agency portfolio). */
  async getOrgScores(organisationId: string) {
    return db.execute(sql`
      SELECT DISTINCT ON (subaccount_id, site_url) *
      FROM geo_audit_scores
      WHERE organisation_id = ${organisationId}
      ORDER BY subaccount_id, site_url, audited_at DESC
    `);
  },
};
```

### 6.2 `geoAuditServicePure.ts` — Pure helper

**File:** `server/services/geoAuditServicePure.ts`

Pure, side-effect-free scoring logic. Testable with fixture data. Follows the `*Pure.ts` convention verified by `verify-pure-helper-convention.sh`.

```typescript
// No imports from db/, services/, or any module with side effects.

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
| `icon` | `search` (or `globe` — match existing icon conventions) |
| `agentRole` | `specialist` |
| `agentTitle` | GEO-SEO Specialist |
| `parentSystemAgentId` | (set to the Content/SEO agent if one exists, else null) |
| `masterPrompt` | See §7.2 below |
| `modelProvider` | `anthropic` |
| `modelId` | `claude-sonnet-4-6` |
| `temperature` | `0.4` (lower than default — audit work benefits from consistency) |
| `maxTokens` | `8192` (audits produce long structured output) |
| `defaultSystemSkillSlugs` | `['audit_geo', 'geo_citability', 'geo_crawlers', 'geo_schema', 'geo_platform_optimizer', 'geo_brand_authority', 'geo_llmstxt', 'geo_compare']` |
| `defaultOrgSkillSlugs` | `['audit_seo', 'fetch_url', 'web_search', 'scrape_url', 'scrape_structured', 'create_task', 'add_deliverable', 'write_workspace']` |
| `allowModelOverride` | `true` |
| `defaultTokenBudget` | `50000` (GEO audits are token-heavy due to page analysis) |
| `defaultMaxToolCalls` | `30` |
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

Add to `scripts/seed.ts` **Phase 2** — the GEO-SEO Agent is the 18th system agent (after the 16 company agents + Playbook Author).

**Option A:** If the agent folder pattern is used (`server/agents/geo-seo-agent/`):
- Create `server/agents/geo-seo-agent/master-prompt.md` with the prompt above
- The seed script's Phase 2 parser picks it up automatically if it follows the `AGENTS.md` convention

**Option B:** If a direct upsert is simpler (follows the Playbook Author pattern from Phase 3):
- Add a Phase 2.5 or extend Phase 2 with a direct `systemAgents` upsert for the GEO-SEO agent
- Read `server/agents/geo-seo-agent/master-prompt.md` for the prompt content

**Recommended: Option B** — direct upsert in a new Phase 2.5, matching the Playbook Author pattern in Phase 3. The company agent parser (Phase 2) reads from `companies/automation-os/` which is a different structure. A direct upsert is cleaner and avoids coupling to the company parser format.

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
    'create_task', 'add_deliverable', 'write_workspace',
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

In Phase 5 (dev fixtures), add the GEO-SEO agent to the Synthetos Workspace subaccount:
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
- `from` / `to` (optional) — Date range filter

**Query parameters (portfolio endpoint):**
- `subaccount_ids` (optional) — Filter to specific subaccounts

```typescript
// server/routes/geoAudit.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireSubaccountPermission, requireOrgPermission } from '../middleware/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { geoAuditService } from '../services/geoAuditService.js';
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
    const scores = await geoAuditService.getScoreHistory(
      req.orgId!, req.params.subaccountId, site_url,
      limit ? parseInt(limit as string, 10) : undefined,
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
    const score = await geoAuditService.getLatestScore(
      req.orgId!, req.params.subaccountId, site_url,
    );
    res.json(score);
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
registerProcessor('audit_geo', {
  processOutputStep: async (context, result) => {
    // Parse dimension scores from the structured output
    // Call geoAuditService.saveScore(...)
    // Non-blocking — failure to persist doesn't fail the skill
  },
});
```

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
| 1. Migration + schema | `migrations/0110_geo_audit_scores.sql`, `server/db/schema/geoAuditScores.ts`, `server/db/schema/index.ts`, `server/config/rlsProtectedTables.ts` | — |
| 2. Pure helper + constants | `server/services/geoAuditServicePure.ts`, `server/config/limits.ts` | — |
| 3. Unit tests | `server/services/__tests__/geoAuditServicePure.test.ts` | Step 2 |
| 4. Service layer | `server/services/geoAuditService.ts` | Steps 1, 2 |
| 5. Skill definitions (8 files) | `server/skills/audit_geo.md`, `geo_citability.md`, `geo_crawlers.md`, `geo_schema.md`, `geo_platform_optimizer.md`, `geo_brand_authority.md`, `geo_llmstxt.md`, `geo_compare.md` | — |
| 6. Action registry | `server/config/actionRegistry.ts` (add 8 entries to methodology batch) | Step 5 |
| 7. Topic registry | `server/config/topicRegistry.ts` (add `geo` topic) | — |
| 8. SKILL_HANDLERS | `server/services/skillExecutor.ts` (verify methodology passthrough) | Step 5 |
| 9. System skills backfill | `scripts/backfill-system-skills.ts` (run to upsert new skills to DB) | Steps 5, 8 |
| 10. Master prompt | `server/agents/geo-seo-agent/master-prompt.md` | — |
| 11. Seed script | `scripts/seed.ts` (Phase 2.5 for GEO-SEO agent) | Step 10 |
| 12. Routes | `server/routes/geoAudit.ts`, `server/index.ts` (mount) | Step 4 |
| 13. Score persistence hook | `server/services/skillExecutor.ts` (processor registration for `audit_geo`) | Steps 4, 8 |
| 14. Doc updates | `architecture.md`, `capabilities.md`, `KNOWLEDGE.md` | All above |
| 15. Verification | Run all gates, tests, typecheck, lint | All above |

### Phase 2 — Platform optimizer, brand authority, competitive, portfolio insights (deferred)

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

---

## 11. Doc Updates Required

These updates must land in the same commit as the code changes.

### `architecture.md`

1. **Skill System section** — Update skill count from 99 to 107 (8 new GEO skills). Add GEO skills to the category table:

```
| GEO-SEO | `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare` |
```

2. **Migrations section** — Add entry for `0110 — geo_audit_scores — GEO audit dimension scores and composite scores`

3. **System agents** — Note the GEO-SEO Agent as the 18th system agent

### `capabilities.md`

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
### 2026-04-13 Decision — GEO skills are methodology skills, not handler-driven

All 8 GEO skills (`audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`,
`geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`)
are methodology skills — pure prompt scaffolds with `isMethodology: true` in
the action registry. They use the methodology fast-path in proposeActionMiddleware
(lightweight audit row, no full action proposal). Score persistence uses a
processOutputStep hook on `audit_geo`, not a custom handler. File:
`server/config/actionRegistry.ts` methodology batch and
`server/services/skillExecutor.ts` processor registration.
```

---

*End of specification. Ready for spec-reviewer when this draft is finalised.*
