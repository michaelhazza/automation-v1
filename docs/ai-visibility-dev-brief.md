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
  - [5.5 Measurement reliability — the existential layer](#55-measurement-reliability--the-existential-layer)
  - [5.6 Cost-aware measurement strategy](#56-cost-aware-measurement-strategy)
  - [5.7 The learning layer — what makes this a moat](#57-the-learning-layer--what-makes-this-a-moat)
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

> **Synthetos AI Visibility** is an agent-decision system: it shows a business *what AI agents currently believe about it, which buyer queries it wins or loses, who agents are choosing instead, and exactly what to change to flip those choices* — then watches the agent leaderboard week over week as the changes ship.

Every architectural decision in this brief is a consequence of that sentence. If a feature doesn't help us prove or move *what the agent believes and chooses*, it doesn't belong in v1.

**Language discipline.** Internally and externally, we describe the system in agent-decision terms, not audit terms. We don't ship "SEO audits"; we ship "agent decision reports". We don't say "your score went up"; we say "agents now describe you with the attributes that win this category". This sounds cosmetic — it isn't. Naming shapes what gets built. Once a section is called an "audit", an engineer ships a checklist; once it's called a "decision report", they ship a competitor comparison. Hold the line on this in UI, deliverables, marketing copy, and skill names.

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

**Category integrity rules** (must hold for share-of-voice to be a defensible metric):

- **Finite.** A Category contains 10–30 queries. Below 10 the metric is too noisy; above 30 the cost-per-trend-point gets prohibitive and definitions blur.
- **Versioned.** Every Category has a `version` field. Adding/removing/editing a query opens a new version. Trend lines render against a single version — when the query set changes materially, the chart resets and the prior version becomes a historical snapshot. This prevents the failure mode where the metric improves only because the queries were edited.
- **Explicitly scoped.** Each Category locks a fixed scope tuple — geography, price range, persona, vertical — at creation. Queries within a Category must match that scope or be rejected. This keeps "best marketing agency for SaaS under $5k" out of a "best marketing agency for enterprise" Category.
- **Stable for at least N weeks.** Default minimum hold time of 4 weeks before query-set edits are accepted. Forces clients to give a positioning effort time to register before the goalposts move.
- **No silent overlap.** A query may belong to multiple Categories only if explicitly tagged that way. Default is single-Category membership. Overlap is an opt-in modelling choice, not an accident.

These rules are enforced at the data layer, not at the UI. They turn category ownership from a sales-deck phrase into something measurable, defensible, and repeatable.

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

**Causal framing is mandatory, not optional.** Every recommendation must reference at least one specific lost query, the specific competitor that won it, and the specific attribute the engine extracted from the competitor that we failed to expose. A recommendation that says "improve pricing clarity" is rejected by the engine's own rules. A recommendation that says *"For query Q on engine E, competitor C was cited with `priceFrom: $2,000/mo`. We were not described with a price. Add this exact `Offer` block to /pricing"* is accepted. Best-practice checklists ("add schema", "improve freshness", "get more reviews") are not recommendations in this system — they are starting points the causal engine has to localise to a specific lost outcome before they ship to a client. This rule is what stops the Optimisation Engine from drifting back into "SEO audit 2.0".

**Outputs:** the fix list, every entry causally tied to a lost outcome. The reason a one-shot project converts to a retainer.

### 5.3 Why the split matters operationally

| Engine | Cadence | Cost driver | Lives or dies on |
|---|---|---|---|
| Measurement | Continuous (weekly default, on-demand for sales) | Engine API costs × queries × engines | Accuracy of brand recognition + parse fidelity |
| Optimisation | Episodic (full re-audit monthly, partial on changes) | Page fetch + LLM analysis | Quality of recommendations + deployable artefacts |

Blending them — as the current Phase 1 system effectively does — means we pay measurement-cadence costs for optimisation-style outputs, and we make optimisation findings carry the burden of "selling" outcomes they can't actually prove. The split lets each engine optimise for its own job.

### 5.4 The contract between engines

The Measurement Engine never edits the site. The Optimisation Engine never decides whether a fix worked — it predicts; the Measurement Engine confirms on the next run. This closed loop is what makes the system a flywheel rather than a stack of audits.

### 5.5 Measurement reliability — the existential layer

The entire product hinges on a noisy substrate. LLM outputs are non-deterministic, citations are inconsistent, formatting varies across engines, and engines hallucinate or omit brands. If we treat a single run as ground truth, every trend line we draw is a lie. The Measurement Engine has to be designed for this from day one, not retrofitted later.

**Three controls, each non-optional in v1:**

1. **N-run aggregation per outcome.** Every `Query × Engine` is run multiple times (default N=3 for paid tiers, N=1 for free tier with explicit "low confidence" flag). The persisted `AgentOutcome` is the aggregate — citation rate across runs, modal rank, attribute-set union — not any single response. Single-run mode is allowed but always carries a confidence stamp the dashboard surfaces.

2. **Confidence model per outcome.** Every `AgentOutcome` carries a confidence band:
   - **High** — explicit ranked list, brand cited with attributes, consistent across N runs
   - **Medium** — brand mentioned in prose, inconsistent placement across runs, partial attribute extraction
   - **Low** — inferred match (fuzzy normalisation), or sparse signal across runs
   - **No signal** — explicit state, not a failure. The brand was simply not cited. This is data, not an error. Distinguishing "not cited" from "probe failed" is critical for honest trends.
   Trend charts default to High+Medium only; Low and No-signal are surfaced explicitly when the user expands.

3. **Raw + parsed dual storage.** Every probe persists the raw engine response alongside the parsed outcome structure. This is what lets us re-parse historical data when we improve the parser, and what lets us audit a disputed citation by hand. **Parsers are versioned** — every `AgentOutcome` records the parser version that produced it, so we can re-derive parsed outcomes from raw responses without losing prior runs.

**Why this is in the brief, not deferred to the spec:** if the team builds the Measurement Engine without these three controls baked in, the data model is wrong and retrofitting them later means a migration. They shape the schema, not just the code.

### 5.6 Cost-aware measurement strategy

Measurement is the dominant cost line in this product. Naive scaling — every client × every engine × every query × every week — collapses unit economics fast. The strategy below caps cost without compromising the product's headline metric.

**Tiered probe budgets.** Each productisation tier (§8) has a fixed measurement budget that drives query count, run count, and engine selection:

| Tier | Queries | Runs per (Q × E) | Engines | Cadence |
|---|---|---|---|---|
| Free Report Card | 3 (auto-suggested) | 1 | 3 (rotated) | On demand only |
| One-shot Audit | 10–20 (client-selected) | 2–3 | All 5 | One-time |
| Retainer | 10–30 per Category, adaptive | 3 | All 5 | Weekly base, adaptive overlay |

**Adaptive probing on the retainer.** Not every query needs equal frequency. The probe scheduler ranks queries by:
- **Stability score** — queries whose outcomes haven't moved in M weeks de-escalate to monthly probes
- **Strategic weight** — client-flagged "must-win" queries probe more frequently
- **Recent regression** — a rank drop or share-of-voice dip auto-escalates the query to daily probes for a recovery window
This keeps the average client cost flat while concentrating spend on the queries where the signal is moving.

**Cross-tenant reuse where lawful.** Identical (`Query × Engine × N-run-window`) probes from different subaccounts can share a single underlying probe — the response is parsed N times against N different brand lists. This is a meaningful cost reducer for popular generic queries and respects each tenant's brand normalisation independently. Where vendor ToS forbids reuse, we fall back to per-tenant probes.

**Hard ceilings ride existing primitives.** Per-subaccount probe budgets plug into the existing `runCostBreaker` so a runaway probe schedule fails closed, not silently. No new cost-control infrastructure required.

### 5.7 The learning layer — what makes this a moat

The system gets smarter the more clients run through it. That's a slogan unless we design it. The Learning Layer is what turns "every fix is a hypothesis" into "every fix is ranked by historical effect across the portfolio."

**What it captures.** Every recommendation the Optimisation Engine produces is logged with: the gap it addressed, the deployable artefact (if any), the predicted outcome impact, the client's vertical, and the Category context. After the fix is marked deployed (or detected as deployed via re-audit), the next M weeks of `AgentOutcome` data are correlated against the recommendation to compute observed effect.

**What it changes downstream.** Recommendation ranking flips from theory to evidence:
- v1 ranking: theoretical impact × effort
- v2 ranking: historical observed lift × confidence × vertical match × effort
A new client gets recommendations ranked by what *actually moved outcomes* for similar businesses, not by what the LLM predicts will work.

**Privacy and data scope.** The Learning Layer holds **anonymised, aggregated correlations only** — the gap type, the vertical, the observed lift distribution. It never stores another client's brand, copy, or outcome detail in a form a tenant can read. Cross-tenant insights are statistical, not specific.

**Why it's in v1 even though the value compounds in Phase D.** The data structure has to be in place from the first probe, otherwise we lose the early correlation data permanently. The *scoring* of recommendations switches from theoretical to empirical only when N is large enough — that's a Phase D activation — but the *capture* starts on day one. Building it later means the moat starts compounding from day Y instead of day 1.

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

**This is the dominant output pattern, not a single feature.** Every recommendation in the Optimisation Engine flows through this comparison shape: lost query → winning competitor → missing attribute → exact fix. Generic best-practice items only ship to a client after the simulation localises them to at least one real lost query. If the simulation can't tie a finding to a specific outcome gap, the finding is downgraded to an "untriaged hypothesis" and excluded from the client deliverable. This guards against the failure mode where the system reverts to producing tidy SEO checklists with no causal evidence.

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

Every output the system produces is framed as *what agents currently believe and choose, and what to change about that* — not as a static audit score. Approach-level only — formats and contracts are tech-spec territory.

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
| **Phase A — Measurement core** | `Query`, `AgentOutcome`, `Category` (with integrity rules from §4.5) entities. Multi-engine probe runner. **N-run aggregation, confidence model, raw+parsed dual storage from day one (§5.5).** **Tiered probe budgets and `runCostBreaker` integration (§5.6).** **Learning Layer capture schema in place — fix-to-outcome correlation logged from the first probe (§5.7).** Brand-name normalisation. First leaderboard view. | Free Visibility Report Card, demo-ready. Internal cohort view. |
| **Phase B — Optimisation rewrite** | `AgentCompatibilityProfile` decision module. Cross-surface freshness module. Per-vertical trust graph. Comparison simulation as the dominant output pattern (§6.4). Causal-framing enforcement on every recommendation. | Paid one-shot AI Visibility Decision Report with deployable artefacts. |
| **Phase C — Retainer surface** | Scheduled probes with adaptive cadence (§5.6). Trend storage versioned by `Category.version`. Regression alerting. Retainer dashboard with share-of-AI-voice trend as the headline. | AI Visibility Retainer goes live. |
| **Phase D — Learning Layer activation** | Recommendation ranking flips from theoretical to empirical (§5.7) once N is large enough. Vertical-specific query expansion suggestions. Cross-tenant outcome correlations surface in recommendation explanations. | The flywheel becomes auto-tuning — recommendation quality improves with every retainer client's data. The moat is now compounding from data captured since Phase A. |

Phases A and B are the minimum viable product. Phase C is what makes the business model recurring. Phase D is when the moat starts paying — but the **data capture for Phase D begins in Phase A**, not Phase D. Building reliability, cost-tiering, and learning-capture later means migrations and lost data; they go in from day one.

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
9. **Aggregate vs. multi-record persistence for N-run probes.** §5.5 says the persisted `AgentOutcome` is the aggregate of N runs. The spec must decide whether each individual run is also stored as its own row (audit trail, re-aggregation if the parser improves) or only the aggregate plus the raw responses. Affects storage cost and re-derivation flexibility.
10. **Cross-tenant probe reuse policy.** §5.6 proposes sharing identical probes across tenants where ToS permits. The spec must enumerate which engines' terms allow this, and define the per-tenant brand-list re-parse contract so reused probes can't leak one tenant's brand into another's outcome record.
11. **Learning Layer activation threshold.** Phase D flips ranking from theoretical to empirical "once N is large enough" (§5.7). The spec must define the statistical bar — minimum sample size per (vertical × gap-type), confidence interval width — at which a recommendation may be ranked by historical lift instead of theoretical impact.
12. **Confidence-band defaults across tiers.** §5.5's confidence model has High / Medium / Low / No-signal bands. The free tier runs N=1, which means most outcomes will be Medium-or-below. The spec must decide what gets surfaced on the free Report Card so we don't either oversell weak signal or undersell to the point the demo doesn't land.

---

## Decision sought

Sign-off on:

1. The **shift from input-focused to outcome-focused** as the framing for the next build, and the language discipline to match (§3).
2. The **four core primitives** (`Query`, `AgentOutcome`, `ExtractabilityProfile`, `AgentCompatibilityProfile`) plus the `Category` integrity rules (§4.5) as the system's domain model.
3. The **two-engine split** (Measurement / Optimisation) as the architecture.
4. The **four hardening commitments that go in from day one** (§5.5–5.7 + §5.2/§6.4):
   - Measurement reliability — N-run aggregation, confidence model, raw+parsed dual storage, parser versioning
   - Cost-aware measurement — tiered probe budgets, adaptive cadence, `runCostBreaker` integration
   - Learning Layer — fix-to-outcome correlation captured from the first probe; activated in Phase D
   - Causal recommendation framing — every recommendation tied to a specific lost query × competitor × missing attribute, no exceptions
5. The **three productisation tiers** (Free / one-shot / Retainer) as the commercial shape, with tier budgets in §5.6.
6. The **phasing order** (A → B → C → D) and the principle that every phase ends in a sellable output — including the rule that reliability, cost, and learning-capture infrastructure all ship in Phase A, not later.

Once those are confirmed, the next artefact is a tech spec that answers §12 and produces schemas, action contracts, service interfaces, and a chunked implementation plan. Until then, no code changes.






