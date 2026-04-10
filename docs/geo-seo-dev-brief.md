# Development Brief: GEO-SEO Integration

**Date:** 2026-04-10
**Status:** Brief — not yet ready for build
**Source reference:** [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) (MIT licensed)
**Classification:** Significant (multiple domains, new skill cluster, new agent template)

---

## 1. Problem

AI search engines (ChatGPT, Perplexity, Gemini, Google AI Overviews, Bing Copilot) are replacing traditional search as the primary discovery channel. Sites optimised only for Google organic rankings are losing visibility. Agency clients need to know how their sites perform in AI-generated responses — and what to fix.

This is a new, high-value service vertical for agencies using the platform. No competitor in the agency automation space currently offers automated GEO auditing at the subaccount level.

## 2. What We're Building

A native GEO (Generative Engine Optimisation) capability within Automation OS — a cluster of system skills and a system-managed agent that audits websites for AI search visibility alongside traditional SEO.

**Not building:** A port of the geo-seo-claude Python codebase. We're extracting the methodology and scoring framework, then implementing it natively within our existing skill executor pipeline, action registry, and agent system.

## 3. Why Native vs. External Tool

| Concern | External (geo-seo-claude) | Native build |
|---------|--------------------------|--------------|
| Multi-tenancy | None — single-user CLI | Org/subaccount scoped, RLS protected |
| Scheduling | Manual invocation | Heartbeat-driven recurring audits |
| Cost controls | None | runCostBreaker, per-subaccount budgets |
| HITL governance | None | Review gates before recommendations reach clients |
| Historical tracking | None — stateless | Stored per-subaccount, trend analysis over time |
| Portfolio insights | One site at a time | Cross-subaccount analysis, cohort reporting |
| Client delivery | Copy-paste files | Task deliverables, client portal ready |
| Existing SEO | Separate tool | Unified with `audit_seo` — one agent covers both |
| Runtime | Python 3.8 + Playwright | TypeScript — no foreign runtime |

## 4. Core Features

### 4.1 GEO Audit Skill Cluster

New system skills to add under `server/skills/`:

| Skill | Purpose |
|-------|---------|
| `audit_geo` | Composite GEO audit — orchestrates sub-skills, produces 0-100 GEO Score |
| `geo_citability` | Analyses content extraction quality for AI citation (optimal 134-167 word passages, clear claims, quotable structure) |
| `geo_crawlers` | Checks robots.txt and HTTP headers for 14+ AI crawlers (GPTBot, ClaudeBot, PerplexityBot, GoogleOther, Bytespider, etc.) |
| `geo_schema` | Evaluates JSON-LD structured data coverage — Organisation, Article, FAQ, HowTo, Product schemas that AI engines consume |
| `geo_platform_optimizer` | Platform-specific readiness scores and recommendations for each AI search engine |
| `geo_brand_authority` | Brand mention tracking, entity signals (Wikipedia, Wikidata, Knowledge Panel), citation density vs backlinks |
| `geo_llmstxt` | Analyses or generates `llms.txt` — the emerging standard for AI-readable site summaries |
| `geo_compare` | Competitive GEO analysis — benchmark client against 2-3 competitors |

### 4.2 GEO Scoring Framework

Six-dimension composite score (weights from geo-seo-claude methodology, tunable per-org):

| Dimension | Default Weight | What It Measures |
|-----------|---------------|-----------------|
| AI Citability | 25% | Can AI engines extract and cite clean content passages? |
| Brand Authority | 20% | Entity recognition, brand mentions, knowledge graph presence |
| Content Quality / E-E-A-T | 20% | Experience, expertise, authoritativeness, trustworthiness signals |
| Technical Infrastructure | 15% | Core Web Vitals, crawlability, mobile readiness, page speed |
| Structured Data | 10% | JSON-LD schema coverage and correctness |
| Platform-Specific | 10% | Per-engine optimisation (Google AIO, ChatGPT, Perplexity, Gemini, Bing Copilot) |

### 4.3 System-Managed GEO-SEO Agent

A new system agent template that combines:
- Existing `audit_seo` skill (traditional SEO)
- New GEO skill cluster (AI search visibility)
- `fetch_url` and `web_search` for data gathering
- Unified report combining both traditional and GEO scores

Deployable per-subaccount with standard override set (custom instructions, scheduling, budget caps, skill selection).

### 4.4 Recurring Audits

Leverage existing heartbeat/scheduling infrastructure:
- Configurable audit frequency per subaccount (weekly/monthly)
- Historical GEO scores stored for trend tracking
- Automated alerts when scores drop below threshold

### 4.5 Portfolio-Level Insights

Leverage existing reporting agent capabilities:
- Cross-subaccount GEO score dashboard
- Cohort analysis (which clients are AI-visible, which aren't)
- Agency-wide GEO readiness summary

### 4.6 Client Deliverables

Each audit produces:
- GEO Score breakdown (composite + per-dimension)
- Priority-ranked recommendations
- Platform-specific readiness checklist
- 30-day improvement roadmap
- Competitive benchmark (if `geo_compare` run)

Delivered as task deliverables through existing pipeline — no separate PDF generation needed initially.

## 5. What Already Exists That We Build On

| Existing Component | How It's Used |
|-------------------|---------------|
| `audit_seo` skill | Foundation — GEO audit extends, not replaces |
| `fetch_url` skill | Data gathering for page analysis |
| `web_search` skill | Brand mention and competitor research |
| Skill executor pipeline | processInput → gate → execute → processOutput |
| Action registry | Register new GEO action types with Zod schemas |
| System agent system | Deploy GEO-SEO agent template to subaccounts |
| pg-boss scheduling | Recurring audit heartbeats |
| Task/deliverable system | Store and deliver audit results |
| Reporting agent skills | `query_subaccount_cohort`, `compute_health_score` for portfolio rollup |
| HITL review gates | Agency reviews recommendations before client sees them |

## 6. What's New

- ~8 skill definition files (`server/skills/`)
- Action registry entries for each GEO action type
- `geoAuditService.ts` — service layer for score computation, storage, and history
- Schema additions — GEO audit results table (scores, dimension breakdowns, per-subaccount, timestamped)
- 1 system agent definition in `systemAgents` seed
- Skill visibility configuration for the new cluster

## 7. Open Questions (for tech spec phase)

1. **Score storage granularity** — store only composite + dimension scores, or full per-check results?
2. **Competitive data freshness** — cache competitor audits, and if so, for how long?
3. **Weight customisation** — per-org override of dimension weights, or system-wide only?
4. **UI scope** — dedicated GEO dashboard page, or extend existing SEO views?
5. **PDF reports** — needed for Phase 1, or task deliverables sufficient?
6. **llms.txt generation** — read-only analysis, or offer to generate and host the file?

## 8. Phasing (Suggested)

| Phase | Scope |
|-------|-------|
| Phase 1 | Core skill cluster (`audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`) + system agent + basic score storage |
| Phase 2 | Platform optimizer, brand authority, competitive comparison, portfolio insights |
| Phase 3 | Recurring scheduled audits, historical trends, alert thresholds, client-facing reports |

---

*This brief captures scope and intent. Detailed tech spec (schema design, action registry contracts, skill definitions, service interfaces) will be produced when ready to build.*
