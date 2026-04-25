# Development Brief: AI Visibility & Category Ownership

**Date:** 2026-04-25
**Status:** Draft — for direction sign-off before tech spec
**Supersedes (in framing, not in code):** [`docs/geo-seo-dev-brief.md`](./geo-seo-dev-brief.md), [`docs/geo-seo-spec.md`](./geo-seo-spec.md) (Phase 1 GEO-SEO audit)
**Classification:** Major — new domain primitives, two-engine architecture, new product surface
**Decision sought:** approval of approach + the four core primitives + two-engine split, before any technical spec is written.

---

## Table of Contents

- [1. Why this brief exists](#1-why-this-brief-exists)
- [2. Strategic reframe](#2-strategic-reframe)
- [3. The product, in one sentence](#3-the-product-in-one-sentence)
- [4. The four core primitives](#4-the-four-core-primitives)
- [5. Two-engine architecture](#5-two-engine-architecture)
- [6. How we solve each identified gap](#6-how-we-solve-each-identified-gap)
- [7. Outputs that sell](#7-outputs-that-sell)
- [8. Productisation tiers](#8-productisation-tiers)
- [9. Phasing](#9-phasing)
- [10. Non-goals](#10-non-goals)
- [11. What stays from existing GEO-SEO Phase 1](#11-what-stays-from-existing-geo-seo-phase-1)
- [12. Open questions for the tech spec](#12-open-questions-for-the-tech-spec)

---

## 1. Why this brief exists

We already shipped Phase 1 of GEO-SEO: an audit cluster of eight skills (`audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_brand_authority`, `geo_platform_optimizer`, `geo_llmstxt`, `geo_compare`) that scores a site's *readiness* to be cited by AI engines. That work is sound and stays. But two pieces of input — a transcript laying out the macro shift to agent-driven discovery, plus a hard critical pass on our current direction — converged on the same conclusion:

**We are still building an SEO tool. We should be building an AI recommendation positioning system.**

The difference is not technical. It's where the product points. Today's audit measures *inputs* (does the page have schema? are crawlers allowed? is content extractable?). It does not measure the *outcome* the client actually pays for: *when an AI agent gets asked the question my customer asks, do I show up?*

Until that outcome is a first-class entity in the system, every dimension score we produce is a proxy for a thing we're not actually measuring. Clients can't be sold on proxies for long. Competitors who measure the outcome directly will eat the category — which, per the transcript, has a window measured in months, not years.

This brief sets the direction before we lock the tech spec. It does not specify schemas, action contracts, or service interfaces — those come next, in a dedicated tech spec, only after this approach is approved.

---

## 2. Strategic reframe

The transcript reduces to six durable claims, and the critical-pass feedback sharpens them into a product shape. Both are captured below in compressed form so the rest of the brief can reference them by name.

### 2.1 Six first principles (from the transcript)

| # | Principle | Implication |
|---|---|---|
| **P1** | The reader changed: an agent now visits before any human does | Design for a parser, not for a viewer |
| **P2** | Agents reward **extractability** over persuasion | Plain answers to *what / who / cost / how* beat clever copy |
| **P3** | Trust is **corroborated** across the web, not asserted on the site | Mentions, reviews, citations, third-party data — agents check the consensus |
| **P4** | Agents **transact**, not just discover | Inventory, pricing, scheduling, checkout must be agent-callable |
| **P5** | **Freshness** is a trust signal in itself | Stale = unreliable, regardless of content quality |
| **P6** | Category recommendations **compound** | Once an agent learns "for X, recommend Y", that recommendation reinforces itself — early-mover window is months |

### 2.2 The four sharpenings (from critical-pass feedback)

The principles describe the world. The sharpenings describe how the *current product* misses it:

1. **Input vs outcome.** Today we score readiness. We do not measure whether the brand is actually cited by AI engines for the queries that matter. That is the only metric clients buy.
2. **Missing layer: agent compatibility.** Extractability ≠ usability. Two equally-extractable sites lose to whichever one the agent can also *transact against*. Today this layer doesn't exist as a domain object — it's buried inside schema checks.
3. **Missing layer: category ownership.** Per P6, the prize is being one of the three answers when someone asks for a category. Today nothing in the system models "category", "owned query", or "share of AI voice" over time.
4. **Missing layer: agent decision simulation.** Agents don't grade dimensions in isolation; they gather candidates, extract attributes, compare, and shortlist. We currently audit each candidate independently and never reproduce the comparison step that determines who actually wins.

The rest of this brief is structured to fix exactly these four sharpenings while keeping the existing readiness-audit work as a supporting input.

---

## 3. The product, in one sentence

> **Synthetos AI Visibility** is the system that tells a business *which AI-driven queries it currently wins, which it loses, who is winning instead, and exactly what to change to reverse that* — and then watches the leaderboard week over week as those changes ship.

Every architectural decision in this brief is a consequence of that sentence. If a feature doesn't help us prove or move that leaderboard, it doesn't belong in v1.

---

## 4. The four core primitives

The system is built around four domain entities. Skills, agents, scores, and dashboards are all derived from these — not the other way around. This is the most important decision in the brief: **the system models the buyer's question, not the auditor's checklist.**

### 4.1 `Query`

A specific natural-language prompt that a buyer would put to an AI agent. Owned by a subaccount, tagged to a `Category`, with attributes that constrain it (price ceiling, geography, vertical, persona).

- **Why it's first-class:** every other primitive only has meaning relative to a query. "Visibility" without a query is meaningless.
- **Examples:** *"best marketing agency for SaaS under $5k/mo"*, *"top osteopath in Bondi for sports injuries"*, *"AI-friendly accounting software for ecommerce stores"*.
- **Lifecycle:** seeded by the agency from intake; expanded automatically by suggesting query variants; pruned by relevance + traffic estimates.

### 4.2 `AgentOutcome`

The observed result when a `Query` is run against a real AI engine (ChatGPT, Perplexity, Gemini, Google AI Overviews, Bing Copilot). This is the entity the entire product hinges on.

- **What it captures:** engine, query, run timestamp, cited brands and the rank of each, attributes the engine attributed to each cited brand (price, niche, location, USPs), competitors present in the response, the answer text itself, and a confidence/freshness stamp.
- **Why it's first-class:** this is the **outcome layer** the critical pass said we were missing. Every score, every alert, every dashboard chart is downstream of this object.
- **Lifecycle:** generated by scheduled probes (weekly default), and on-demand for sales demos. Persisted indefinitely so we can trend "share of AI voice" over time per category.

### 4.3 `ExtractabilityProfile`

What an agent *can* read off the brand's site. This is the home for all the readiness signals the existing GEO-SEO Phase 1 audit already produces.

- **What it captures:** structured-data coverage, the four-questions clarity check (*what / who / cost / how*), passage extractability, llms.txt, content depth, page-level freshness, E-E-A-T signals.
- **Why it stays a separate primitive (and doesn't merge into AgentOutcome):** the outcome tells you whether you won; the extractability profile tells you why. Keeping them separate lets us correlate ("brands that lose this category share these extractability gaps") and lets us recommend specific fixes when an outcome regresses.

### 4.4 `AgentCompatibilityProfile`

What an agent *can do* with the brand once it has read the site. This is the **new domain object** the critical pass identified as missing.

- **What it captures:** API/feed availability for products, pricing, inventory, booking; presence of `Offer` schema with valid `availability` + `priceCurrency` + `priceValidUntil`; webhook/MCP/Universal Commerce Protocol readiness; `/.well-known/` discovery; CAPTCHA and bot-blocking on transactional flows; sitemap and product-feed health.
- **Why it's separate from extractability:** *readability* and *usability* are independent failure modes. A site can be perfectly readable and entirely un-transactable. Agents pick the transactable one. We need to score and surface that gap on its own.

### 4.5 Supporting entity: `Category`

Not a primitive in its own right — a clustering construct over `Query`s. A `Category` is *the segment a brand wants to own* (e.g. "performance marketing for SaaS in the $1k–$10k range"). It is the unit at which the product reports **share of AI voice** over time, which is the headline retention metric.

### 4.6 How they relate

```
Category ──► owns many ──► Query
                              │
                              ▼ (probed against engines)
                         AgentOutcome  ◄── derives ─── share-of-voice trend
                              │
                              ▼ (correlated with)
              ExtractabilityProfile + AgentCompatibilityProfile
                              │
                              ▼
                  Recommended fixes (ranked by outcome impact)
```

The arrow that matters: **fixes are ranked by their predicted effect on `AgentOutcome`, not by their score impact on a static dimension.** This is what turns the audit into a positioning system.

---

## 5. Two-engine architecture

The system is split into two engines that run on different cadences, against different inputs, and produce different outputs. This split is the single biggest simplification in the design — today, measurement and optimisation are blended inside one audit skill, which is why the product feels like an SEO tool.

### 5.1 Measurement Engine

**Responsibility:** prove the outcome. Tell the truth about where the brand currently stands in AI responses.

**Inputs:** `Category`, `Query` set, brand identifiers (name, domain, aliases), competitor list.

**Behaviour:**
1. Run each query against each enabled engine (ChatGPT, Perplexity, Gemini, AIO, Bing Copilot) — live, not cached.
2. Capture the response text, parse cited brands and their attributed properties, normalise brand names against the brand + competitor list.
3. Persist one `AgentOutcome` per (engine × query × run).
4. Roll up per-`Category` metrics: share of AI voice (cited / total runs), average rank when cited, attribute alignment (does the engine describe us the way we want to be described?), competitor presence rate.
5. Trend the rollups over time. Alert on rank drops or share-of-voice regressions.

**Outputs:** the leaderboard. The retainer's reason to exist.

### 5.2 Optimisation Engine

**Responsibility:** explain *why* the outcome is what it is, and produce concrete, ready-to-deploy fixes.

**Inputs:** the brand's site URLs, the existing GEO-SEO Phase 1 audit cluster, the latest `AgentOutcome` set from the Measurement Engine.

**Behaviour:**
1. Run the existing readiness audits (`audit_geo`, `geo_citability`, `geo_schema`, etc.) to produce `ExtractabilityProfile`.
2. Run the new transactability audit to produce `AgentCompatibilityProfile`.
3. Run the cross-surface freshness and trust-graph audits (see §6).
4. Correlate findings with outcomes from the Measurement Engine — the queries we lose, the competitors that beat us, the attributes the engines extract from them but not from us.
5. Produce ranked fixes. Each fix carries: the gap, the hypothesised outcome impact, the effort, and (where applicable) the deployable artefact (JSON-LD block, llms.txt, rewritten clarity block, NAP correction list).

**Outputs:** the fix list. The reason a one-shot project converts to a retainer.

### 5.3 Why the split matters operationally

| Engine | Cadence | Cost driver | Lives or dies on |
|---|---|---|---|
| Measurement | Continuous (weekly default, on-demand for sales) | Engine API costs × queries × engines | Accuracy of brand recognition + parse fidelity |
| Optimisation | Episodic (full re-audit monthly, partial on changes) | Page fetch + LLM analysis | Quality of recommendations + deployable artefacts |

Blending them — as the current Phase 1 system effectively does — means we pay measurement-cadence costs for optimisation-style outputs, and we make optimisation findings carry the burden of "selling" outcomes they can't actually prove. The split lets each engine optimise for its own job.

### 5.4 The contract between engines

The Measurement Engine never edits the site. The Optimisation Engine never decides whether a fix worked — it predicts; the Measurement Engine confirms on the next run. This closed loop is what makes the system a flywheel rather than a stack of audits.

---

## 6. How we solve each identified gap

Each row below maps a feedback gap to the approach that closes it. Approach-level only — implementation lives in the tech spec.

### 6.1 Gap: input-focused, not outcome-focused
**Solution:** Make `AgentOutcome` a first-class persisted entity (§4.2). Build the Measurement Engine (§5.1) around producing it. Surface "share of AI voice" per `Category` as the headline metric on the dashboard, above any dimension score. Every score now reports relative to whether the brand actually wins or loses queries — composite scores become correlative, not predictive.

### 6.2 Gap: missing the agent-interaction / transactability layer
**Solution:** Introduce `AgentCompatibilityProfile` (§4.4) as a new domain object with its own audit module — not buried inside schema checks. The audit explicitly tests whether an agent can: (a) read pricing/availability without scraping; (b) book or buy via a documented endpoint; (c) discover the brand via `/.well-known/`, MCP, or Universal Commerce Protocol. This module is part of the Optimisation Engine and feeds a discrete "Compatibility Score" that the dashboard reports independently of readiness.

### 6.3 Gap: no category ownership tracking
**Solution:** Add `Category` as a clustering construct over `Query`s (§4.5). The Measurement Engine rolls outcomes up per category and tracks share-of-voice over time. The retainer dashboard's primary chart is "you owned 12% of category X four weeks ago, you own 23% now" — that's the product the agency sells. Category creation flows are part of subaccount onboarding so every retained client is positioned around 1–3 categories from day one.

### 6.4 Gap: no simulation of the agent's decision process
**Solution:** Build a Comparison Simulation step inside the Optimisation Engine. For each lost query, take the actual top-cited competitor's `AgentOutcome` (engine-attributed properties) and the brand's own `ExtractabilityProfile` and produce a side-by-side: *the engine described competitor X as "specialises in Y, prices at Z, located in W". You expose none of those attributes clearly. Here is the rewritten block that does.* This is the most commercially valuable artefact in the system — it converts an abstract score gap into a concrete, defensible loss explanation.

### 6.5 Gap: freshness treated as page metadata, not a cross-surface trust signal
**Solution:** Promote freshness from a sub-check into a cross-surface signal that spans: site (page-level `dateModified`, copyright year, in-body stat ages, blog cadence), reviews (recency on G2/Capterra/Trustpilot/GMB by vertical), mentions (most recent third-party citation), social/forum activity (last Reddit/Quora/HN reference), and offers (last update on pricing/inventory). One Freshness Score, computed across all five surfaces, surfaced as its own dimension in the Optimisation Engine and as a trust input in the brand's overall positioning.

### 6.6 Gap: no trust graph model
**Solution:** Replace the current single-axis "brand authority" check with a per-vertical Trust Graph. The graph defines, per industry, which sources actually move the needle for AI engines: SaaS → G2/Capterra/HN/Reddit; local services → GMB/Yelp/local press; agencies → Clutch/LinkedIn; retail → Trustpilot/Reddit. The audit measures presence + recency + sentiment per source, weighted by that vertical's profile. This replaces a single mention-count number with a defensible, vertical-specific "consensus picture" the agency can show a client.

### 6.7 Gap: outputs too abstract to sell
**Solution:** Every output the system produces ends in either (a) a number that compares the brand to a named competitor on a real query, or (b) a deployable artefact the client can paste. No more pure score reports. See §7 for the specific output formats that drive sales.

### 6.8 Gap: agent probe sits as an "add-on" rather than the entry point
**Solution:** Reverse the audit flow. The default first run of the system on any new subaccount is: (1) run the Measurement Engine against a starter query set; (2) show the leaderboard; (3) *then* run the Optimisation Engine to explain. The free lead-gen audit (§8) is the Measurement Engine on a small query set. The full audit is Measurement → Optimisation. Optimisation is never sold standalone — it's always tethered to the outcomes that justify it.

### 6.9 Scoring model rewrite
**Solution:** Move from dimension-weighted readiness to outcome-weighted positioning. New default weighting:

| Component | Weight | Source |
|---|---|---|
| Actual AI Visibility (share of voice across categories) | 50% | Measurement Engine |
| Extractability + Compatibility (combined) | 30% | Optimisation Engine |
| Authority + Freshness (cross-surface trust graph) | 20% | Optimisation Engine |

Per-org overrides remain possible (already a Phase 2 concept in the existing spec), but the default makes the lead metric the one that maps to revenue.

---

## 7. Outputs that sell

The system must produce specific artefacts that move sales conversations. Approach-level only — formats and contracts are tech-spec territory.

### 7.1 The Visibility Report Card (lead-gen)

A one-page output run on demand against any URL the agency types in. Lists 3 starter queries (auto-suggested per vertical), the brand's citation rate across the five engines, the named competitor that won most often, and the single biggest gap the Optimisation Engine spotted. **The competitor name is what creates the sales conversation** — same hook the transcript uses. This output is the unpaid demo that turns into the paid audit.

### 7.2 The Visibility Audit (one-shot, paid)

A full Measurement + Optimisation run on the brand's chosen `Category` (10–20 queries, all enabled engines, 2–3 named competitors). Output bundle includes:
- **Leaderboard:** share of voice per query, per engine, vs. the named competitors.
- **Loss explanations:** for each lost query, the comparison-simulation block (§6.4).
- **Deployable artefacts:** ready-to-paste JSON-LD blocks, a generated `llms.txt`, the rewritten "what we sell / who it's for / cost / how it works" clarity block, NAP correction list, transactability checklist.
- **Predicted impact ladder:** fixes ranked by predicted share-of-voice gain, not by dimension-score gain.

### 7.3 The Visibility Retainer (monthly recurring)

The flywheel. Weekly Measurement Engine runs + monthly partial Optimisation re-audit + monthly category trend report. The retainer dashboard's headline is *"share of AI voice in [Category] over the last 12 weeks"* — which only works if the system has been running long enough to produce trend, which is exactly why the retainer pricing reflects time-on-platform.

### 7.4 Internal output: the agency cohort view

Cross-subaccount roll-up (already partially built via existing `query_subaccount_cohort` + reporting agent skills) showing: which clients are losing AI visibility right now, which have the biggest predicted upside, which have just had a regression. This is the agency principal's daily view. It also drives upsell conversations from one-shot to retainer.

---

## 8. Productisation tiers

Three tiers, mapped directly to the outputs in §7. Pricing illustrative — final pricing is a commercial decision, not in scope for this brief.

| Tier | Output | Audience | Purpose |
|---|---|---|---|
| **Free Visibility Report Card** | §7.1 — 1 page, 3 queries, 1 named competitor | Any URL the agency points at | Lead generation. Creates the urgency hook. |
| **AI Visibility Audit (one-shot)** | §7.2 — full bundle on 1 chosen category | New subaccounts, "prove value" engagements | Project fee. Justifies the retainer pitch. |
| **AI Visibility Retainer (monthly)** | §7.3 — weekly probes, monthly trend report, alerting | Existing subaccounts wanting category ownership | Recurring revenue. The actual product. |

The free tier sits on `/visibility-check` (or similar) on the marketing surface. The audit and retainer live inside the existing subaccount surface and ride existing billing primitives.

---

## 9. Phasing

Four phases. Each ends in a usable, sellable output — no phase is purely internal plumbing.

| Phase | Scope | Sellable output at end |
|---|---|---|
| **Phase A — Measurement core** | `Query`, `AgentOutcome`, `Category` entities. Multi-engine probe runner. Brand-name normalisation. First leaderboard view. | Free Visibility Report Card, demo-ready. Internal cohort view. |
| **Phase B — Optimisation rewrite** | `AgentCompatibilityProfile` audit module. Cross-surface freshness module. Per-vertical trust graph. Comparison simulation. | Paid one-shot AI Visibility Audit with deployable artefacts. |
| **Phase C — Retainer surface** | Scheduled probes, trend storage, alerting, retainer dashboard. Re-audit-on-change triggers. | AI Visibility Retainer goes live. |
| **Phase D — Self-improvement loop** | Feed outcome regressions back into recommendation ranking (which fixes actually moved the needle?). Industry-specific query expansion suggestions. | The flywheel becomes auto-tuning — recommendation quality improves with every retainer client's data. |

Phases A and B are the minimum viable product. Phase C is what makes the business model recurring. Phase D is the long-term moat.

---

## 10. Non-goals

Explicitly out of scope for v1, to keep the build honest:

- **Generic SEO replacement.** Traditional SEO checks stay in `audit_seo`; we are not rebuilding them. The Optimisation Engine consumes those findings, doesn't replace them.
- **Content generation at scale.** The system produces ready-to-paste artefacts for specific gaps it identifies (schema, llms.txt, clarity blocks). It is not a blog-post or content-marketing engine.
- **Direct site-editing.** No CMS write-back in v1. We deliver artefacts; the agency or client deploys them. Closing that loop is a Phase D+ consideration.
- **Custom engine adapters per client.** The five supported engines (ChatGPT, Perplexity, Gemini, AIO, Bing Copilot) are fixed in v1. Adding more engines is a Phase D consideration if the market shifts.
- **Real-time alerting on individual outcome changes.** Trends and threshold alerts only — we don't ping on every weekly probe variance, only on statistically meaningful regressions.
- **Public benchmarking / industry leaderboards.** Tempting as a marketing surface, but introduces data-privacy and competitive-positioning issues that are out of scope here.

---

## 11. What stays from existing GEO-SEO Phase 1

The Phase 1 cluster is not deprecated — it becomes the input layer to the Optimisation Engine. Specifically:

| Existing artefact | Role in new architecture |
|---|---|
| `audit_seo` | Unchanged. Feeds Extractability Profile. |
| `audit_geo` | Refactored to be the orchestrator inside the Optimisation Engine; loses its standalone "score the site" framing. |
| `geo_citability`, `geo_schema`, `geo_crawlers`, `geo_llmstxt`, `geo_platform_optimizer` | All retained as sub-checks feeding `ExtractabilityProfile`. No re-implementation. |
| `geo_brand_authority` | Extended into the per-vertical Trust Graph (§6.6), not replaced. |
| `geo_compare` | Becomes the data source for the Comparison Simulation (§6.4) — keeps its competitive-fetch role, gains a structured-output contract that the simulation step consumes. |
| `geo_audit_scores` table | Retained for Optimisation Engine score history. New tables added for `Query`, `AgentOutcome`, `Category`. |
| System-managed GEO-SEO agent | Retained, but now wraps both engines and reports on outcome metrics first, dimension scores second. |

Net effect: **no Phase 1 work is thrown away**, but its framing changes from "the product" to "one half of the product".

---

## 12. Open questions for the tech spec

These are the decisions the tech spec must close. Calling them out now so they don't ambush the spec phase.

1. **Engine probing reliability.** Some engines have rate limits and ToS that constrain automated probing. Which engines do we probe directly via API, which via headless browser, which via partner integrations? Does this need a per-engine adapter abstraction from day one?
2. **Brand-name normalisation.** When ChatGPT says "Acme Marketing" and the brand is "Acme Marketing Group LLC", how do we score that as a citation? Need a confidence-scored normalisation strategy with override per subaccount.
3. **Query-set seeding.** How are starter queries generated for a new subaccount? Vertical templates? LLM expansion from a single intake question? Hand-curated by the agency? Probably all three with a clear precedence — but the spec needs to pick.
4. **Probe cost ceilings.** Weekly × N engines × N queries × N subaccounts gets expensive fast. What's the per-subaccount budget, and how does the existing `runCostBreaker` apply?
5. **Trust-graph vertical taxonomy.** Where does the per-vertical source list live? A static config in the codebase? A seedable table the agency can edit per-tenant? Initial taxonomy design is a real piece of work.
6. **Comparison simulation hallucination risk.** The simulation step is LLM-driven and produces deployable artefacts. What's the validation/HITL gate before those artefacts go to a client?
7. **Cross-engine attribution merging.** If ChatGPT cites the brand and Perplexity doesn't, do we report two separate outcomes or a merged "share of voice"? The data model says "separate", the dashboard probably wants "merged" — pick the canonical form.
8. **Category definition UX.** A category is the unit of retainer success. How does the agency define and refine one without a heavyweight setup wizard? Probably the highest-leverage UX question in the entire build.

---

## Decision sought

Sign-off on:

1. The **shift from input-focused to outcome-focused** as the framing for the next build.
2. The **four core primitives** (`Query`, `AgentOutcome`, `ExtractabilityProfile`, `AgentCompatibilityProfile`) as the system's domain model.
3. The **two-engine split** (Measurement / Optimisation) as the architecture.
4. The **three productisation tiers** (Free / Audit / Retainer) as the commercial shape.
5. The **phasing order** (A → B → C → D) and the principle that every phase ends in a sellable output.

Once those are confirmed, the next artefact is a tech spec that answers §12 and produces schemas, action contracts, service interfaces, and a chunked implementation plan. Until then, no code changes.






