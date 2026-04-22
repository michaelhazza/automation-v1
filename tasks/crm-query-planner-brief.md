# CRM Query Planner — Development Brief

> **Status:** Brief, not a spec. Handoff target: `architect`.
> **Branch:** `claude/gohighlevel-mcp-integration-9SRII`
> **Supersedes:** the single-skill `crm.live_query` shape recommended earlier on this branch (see KNOWLEDGE.md 2026-04-22 correction).
> **Depends on:** `shared/types/briefResultContract.ts` + `docs/brief-result-contract.md` (already on main).
> **Runs in parallel with:** universal Brief surface work on `claude/research-questioning-feature-ddKLi` (now merged to main as the Brief + COO + conversations foundation).
> **Date:** 2026-04-22

---

## Contents

1. Executive summary
2. What's already decided elsewhere — do not re-litigate
3. The gap this brief fills
4. Core architecture — planner + executors
5. Planner responsibilities + QueryPlan contract
6. Execution paths — canonical, live, hybrid
7. Result contract alignment (Brief contract)
8. Cost, safety, governance
9. V1 scope cut
10. Out of scope / deferred
11. Open decisions for architect
12. Success criteria
13. Handoff notes

---

## 1. Executive summary

Automation OS should absorb the category of natural-language CRM exploration, but the absorption mechanism is a **query planner layer**, not a single free-text skill. The planner sits between Brief-level intent ("show me VIP contacts inactive 30 days") and execution, classifying every question as `canonical | live | hybrid | unsupported` and routing to the appropriate executor.

The planner is the durable, reusable primitive. Any individual executor — including the live-GHL-query path that triggered this work — is subordinate to it.

**Durable principles carried from the reviewer's upgrades:**

- **Discovery can be free-text; execution stays structured.** Users and agents can ask free-text CRM questions. The system plans and routes those questions deterministically. Any follow-up mutations remain existing typed, review-gated, auditable actions.
- **The user never chooses the data source.** The planner decides canonical vs live vs hybrid. The user just asks a question. "Query planner" is an internal concept, never a UI label.
- **Planner owns data-query routing; Orchestrator owns capability routing.** These are two layers, not one. The Orchestrator classifies *what kind of capability* a Brief needs (Path A/B/C/D — see `architecture.md` §Orchestrator Capability-Aware Routing). The Planner classifies *how to execute a CRM data query* once the Orchestrator has routed to it (canonical / live / hybrid / unsupported). Every surface that reads CRM data goes through the Planner — chat never calls provider skills directly.
- **Deterministic-first, LLM-last.** The pipeline tries free paths (pattern match → plan cache) before paying for intent parsing. LLM use is the fallback, not the default. See §4.
- **The system is designed so high-frequency live queries become candidates for canonical promotion.** Plan-cache hits, live-executor usage frequency, and hybrid-unsupported signals all feed a future Query Memory Layer that identifies which live queries deserve canonicalisation. This is the compounding loop — the planner gets cheaper, faster, and more accurate over time as popular queries migrate from live to canonical. §11.12 settles v1 posture.

**One planner, many surfaces.** The planner is UI-agnostic. It ships callable from the Brief chat thread (the universal surface being built on the other branch), from agents, and from a stopgap "Ask CRM" panel if that ships first. The result contract (`BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` from `shared/types/briefResultContract.ts`) guarantees every surface renders the same artefacts.

---

## 2. What's already decided elsewhere — do not re-litigate

The universal Brief surface work on the other branch landed a foundation this brief builds on. `architect` should treat the following as fixed inputs, not open questions:

| Decision | Where it lives | Impact on this brief |
|---|---|---|
| **"Brief" is the unified entity** for any inbound user intent (replaces "Issue"). Brief chat is the conversation surface. | `tasks/research-questioning-design-notes.md`, PR #170 | The planner emits into Brief chat threads. It does not own a separate UI entity. |
| **COO is the user-facing persona** for the Orchestrator. | Same as above | Planner output is attributed to the COO in chat, not to "the planner". |
| **Three-scope routing: subaccount / org / system.** Brief carries `organisationId` (always) + `subaccountId` (nullable). | `tasks` schema; scope-routing decision in the research-questioning notes | The planner inherits the Brief's scope. A subaccount-scoped Brief can only query that subaccount's connected CRM. |
| **Seven conversation scopes for v1:** agent, brief, task/sub-task, recurring task, playbook run, approval card, agent run execution log. | Research-questioning notes | Planner results are rendered inside a Brief chat (or elsewhere via the same contract); the planner itself is not a chat scope. |
| **Brief result contract is committed.** `BriefStructuredResult`, `BriefApprovalCard`, `BriefErrorResult`, `BriefCostPreview`. | `shared/types/briefResultContract.ts` + `docs/brief-result-contract.md` | The planner emits these types. It does not invent its own envelope. |
| **Trichotomy: canonical hot-path, live long-tail, structured writes.** | Reviewer's upgraded brief, accepted 2026-04-22 | Architectural principle for the planner. Writes are never free-text — they route through existing `crm.*` skills with review gates. |

If any of these become contested during spec drafting, the planner is downstream — so the spec should defer to the other branch's decisions, not overturn them.

---

## 3. The gap this brief fills

Automation OS has three CRM data surfaces today:

- **Canonical ingestion** — polled GHL data in `canonical_contacts`, `canonical_opportunities`, etc. Strong for product-grade metrics, ClientPulse health, historical analysis. Covers ~5–7 entity types out of GHL's 70+.
- **Live-data pickers** (`crmLiveDataService`, 60s LRU) — bounded live reads for UI dropdowns. Picker-shaped, not general query.
- **Structured write skills** (`crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`) — review-gated, typed, idempotent.

**The missing surface** is free-text exploratory read over the long tail of CRM data that canonical doesn't cover: custom fields, form submissions, niche objects, specific pipeline metadata, long-tail tags, memberships, affiliations. Today, an ops person wanting to poke at that data has to leave the product — either pulling reports manually from GHL or installing external MCP tooling in a terminal.

That leakage is the gap. The planner closes it **without** forcing us to canonicalise every GHL resource type (which is a migration + adapter + poller tax per type), and **without** giving up the governance, cost control, and auditability that canonical reads + structured writes already provide.

The gap is not "we should stop canonicalising." Canonical remains the record of truth for everything ClientPulse and reporting depend on. The gap is that canonical is necessarily a subset, and the subset has a long tail of questions nobody's pre-modelled.

---

## 4. Core architecture — planner + executors

**Key principle (added 2026-04-22 after review feedback):** the planner is deterministic-first, LLM-last. Every query attempts cheap exact paths before paying for intent parsing. LLM use is the fallback, not the default.

```text
Brief chat intent (free text)
        │
        ▼
  ┌─ Stage 1 — Registry-backed intent matcher (deterministic)──┐
  │  Normalised intent → canonicalQueryRegistry.aliases lookup  │
  │  Hit → direct canonical handler, QueryPlan emitted free     │
  │  NOT a regex layer, NOT a mini-LLM — it IS the registry's   │
  │  alias index. No duplicate matching logic.                  │
  └─────────────────────────────────────────────────────────────┘
        │ miss
        ▼
  ┌─ Stage 2 — Plan cache (deterministic, free) ────────────────┐
  │  Normalised-intent hash → cached QueryPlan (60s TTL)        │
  │  → QueryPlan emitted without LLM                            │
  │  Performance-first in v1, but structurally aligned with the │
  │  future Query Memory Layer (§11.12) — same key shape, same  │
  │  payload shape, so promotion is a cache-read, not a rewrite │
  └─────────────────────────────────────────────────────────────┘
        │ miss
        ▼
  ┌─ Stage 3 — LLM planner (fallback) ──────────────────────────┐
  │  • Schema context injection (summarised, filtered, cached)  │
  │  • Intent parse via llmRouter.routeCall                     │
  │  • Emits draft QueryPlan + confidence                       │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌─ Stage 4 — Deterministic validator ─────────────────────────┐
  │  • Field / operator / limit / entity checks vs schema       │
  │  • Rejects hallucinated fields, unsafe plans                │
  │  • Writes to plan cache on success                          │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  Execution Layer
  ├── canonical executor   (canonicalQueryRegistry + canonicalDataService)
  ├── live executor        (ghlAdapter + per-location rate limiter, read-only)
  └── hybrid executor      (narrow subset in v1; full pattern later)
        │
        ▼
  Normaliser
  └── emits BriefStructuredResult / BriefApprovalCard / BriefErrorResult
        │
        ▼
  Brief chat thread renders the artefact
```

**Why the deterministic-first shape matters:**

- Every query hitting Stage 1 or Stage 2 pays zero LLM cost and returns in single-digit milliseconds.
- Repeated popular queries become free once the cache warms. Popular canonical-matched queries are always free.
- LLM budget is preserved for genuinely novel questions — the place where it earns its cost.
- Target is maximal deterministic coverage over time, measured by `planner.llm_skipped_rate` (see §11.9). Not a v1 acceptance threshold — a trend to optimise.

**What the planner is NOT:** a new MCP server, a new transport layer, a new persistence tier. It's a typed, testable service in `server/services/` alongside other capability services.

**What the planner IS:** the first-class abstraction for answering any CRM read question. Every new executor plugs in underneath it. Every new surface (Brief chat, agent tool call, stopgap Ask CRM panel) calls it.

**Why the layer matters:** without it, every surface and every new CRM provider duplicates the canonical-vs-live decision. With it, pattern matching, intent parsing, validation, schema injection, classification, cost control, and result normalisation all live in one place.

---

## 5. Planner responsibilities + QueryPlan contract

### 5.1 Responsibilities

The planner must:

1. **Try deterministic paths first.** Pattern matcher + plan cache precede any LLM call (see §4 pipeline). Most repeat-and-popular queries never reach Stage 3.
2. **Parse intent when needed** via `llmRouter.routeCall` (never a direct provider call). LLM tier is configurable — see §5.3.
3. **Inject schema context** automatically at Stage 3. Agents and users should not need to call a separate `crm.schema_describe` helper. The planner pulls the subaccount's connected-provider schema (entities, fields, pipelines, stages, tags) at plan time, summarised and filtered per §11.11. A schema-describe helper may still exist as an agent-diagnostic tool, but it's not a required pre-step.
4. **Emit a structured QueryPlan** with explicit classification.
5. **Validate deterministically** after LLM output. Field names, operators, limits, and entity types are checked against the subaccount's schema. Hallucinated fields are caught here, not at execution time.
6. **Reject unsafe or unsupported plans** cleanly, with constructive error responses.
7. **Attach a cost preview** where possible (planner estimate, cached-similar-query, or static heuristic).
8. **Write validated plans to the plan cache** on success so the next normalised-equivalent query skips Stage 3 entirely.

### 5.2 Illustrative QueryPlan shape

Architect refines the exact shape. This is directional:

```ts
type QuerySource = 'canonical' | 'live' | 'hybrid' | 'unsupported';

type QueryIntentClass =
  | 'list_entities'
  | 'count_entities'
  | 'aggregate'
  | 'lookup'
  | 'trend_request'
  | 'segment_request'
  | 'unsupported';

type QueryPlan = {
  source: QuerySource;
  intentClass: QueryIntentClass;
  primaryEntity: string;              // 'contacts' | 'opportunities' | ...
  relatedEntities?: string[];
  filters: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit: number;
  projection?: string[];
  aggregation?: {
    type: 'count' | 'sum' | 'avg' | 'group_by';
    field?: string;
    groupBy?: string[];
  };
  dateContext?: {
    kind: 'relative' | 'absolute';
    from?: string;
    to?: string;
  };
  canonicalCandidateKey?: string | null;   // maps to a known canonical query if one exists
  confidence: number;
  clarificationNeeded: boolean;
  clarificationPrompt?: string | null;
  costPreview: BriefCostPreview;            // from shared/types/briefResultContract.ts
};
```

### 5.3 LLM tier — configurable, Haiku-default, router-mediated

The fallback LLM is **not hardcoded** inside the planner. Every Stage 3 call goes through `llmRouter.routeCall` with a task-class tag (`task: 'crm_query_planner'`). The router already handles model selection per task, provider fallback, cost tracking, and in-flight registry — the planner inherits all of that for free.

**Recommended default:** Haiku-tier. The work is parse-and-shape (extract entities, filters, operators from free text) — not multi-step reasoning. Haiku is fast, cheap, and accurate enough for most queries, and we want to drive LLM cost down aggressively given Stages 1 and 2 already absorb the bulk of traffic over time.

**When to escalate to Sonnet (or higher):** when the query carries genuine reasoning complexity. Architect settles the escalation rules in §11.6; strong candidates:

- Stage 3 parse returns `confidence < threshold` → retry once at the next tier up
- Query hits the hybrid path (`source: 'hybrid'`) — more complex plan surface, better served by stronger reasoning
- Schema is unusually large after filtering (heuristic per subaccount) — more context stress
- User has enabled a "Power mode" flag for that Brief (org-admin control)

**Where the config lives:** system-settings default + per-org override in `operational_config`. System default: `{ planner_fallback_tier: 'haiku', planner_escalation_tier: 'sonnet' }`. Orgs on higher-value plans, or specific subaccounts with complex custom-field schemas, can raise the default. No code changes required to re-tier; the router resolves model per call.

**Explicit non-goal:** do not build a bespoke model-selection heuristic inside the planner. The router is already the model-selection system. Tag the call, resolve the tier from config, hand it to the router.

### 5.4 Classification is explicit, not implicit

Every plan carries an explicit `source`. This makes the routing testable, observable, and refactor-safe. "Which path ran?" is a logged field, not a code-path inference.

Plans also carry a `stageResolved` field indicating whether Stage 1, 2, or 3 produced them. This is the measurable signal for deterministic-coverage optimisation over time.

---

## 6. Execution paths — canonical, live, hybrid

### 6.1 Canonical executor + `canonicalQueryRegistry`

Wraps `canonicalDataService` for a first-class **registry** of canonical-first queries. Cheapest path — no LLM, no provider round-trip. Deterministic.

**Must ship in v1.** Reasons:

- Without it, every CRM question pays LLM + provider cost even when the answer lives in a local indexed table.
- ClientPulse's existing canonical queries (at-risk accounts, pipeline velocity, stale deal ratio, revenue trend) are *exactly* the questions users will ask in plain English. Routing those through the live path is cost-negative with no UX upside.

**`canonicalQueryRegistry` — first-class contract, not prose list:**

The registry is a typed map from a canonical intent key (string, stable, versioned) to a deterministic handler. The planner's Stage 1 pattern matcher resolves normalised intents to registry keys; Stage 3 LLM plans carry a `canonicalCandidateKey` field that the validator then verifies against the registry.

Illustrative shape:

```ts
type CanonicalQueryHandler = (args: {
  orgId: string;
  subaccountId: string;
  filters: QueryPlan['filters'];
  dateContext?: QueryPlan['dateContext'];
  limit: number;
}) => Promise<BriefStructuredResult>;

interface CanonicalQueryRegistryEntry {
  key: string;                                    // 'contacts.inactive_over_days'
  aliases: string[];                              // natural-language patterns
  primaryEntity: 'contacts' | 'opportunities' | ...;
  requiredScopeCapabilities: string[];            // e.g. ['canonical.contacts.read']
  handler: CanonicalQueryHandler;
}

const canonicalQueryRegistry: Record<string, CanonicalQueryRegistryEntry>;
```

**Initial v1 registry entries (architect confirms final set):**

| Key | Description |
|---|---|
| `contacts.inactive_over_days` | Contacts with no activity since N days ago |
| `accounts.at_risk_band` | ClientPulse health band rollup (green/yellow/red) |
| `opportunities.pipeline_velocity` | Stage velocity metrics over time window |
| `opportunities.stale_over_days` | Deals stuck in a stage beyond N days |
| `appointments.upcoming` | Standard appointment list (window-scoped) |
| `contacts.count_by_tag` | Tag-partitioned contact counts |
| `opportunities.count_by_stage` | Stage-partitioned opportunity counts |
| `revenue.trend_over_range` | Revenue aggregation over date range |

**Scoring / forced-canonical logic:**

- Exact pattern match → `canonicalForced: true`, go canonical without LLM
- LLM Stage 3 emits `canonicalCandidateKey` with confidence ≥ threshold → validator promotes to canonical
- Stage 3 emits `canonicalCandidateKey: null` → executor falls through to live

Architect settles threshold values in §11.2. Key property: a canonical match **preempts** LLM — it is never re-evaluated if Stage 1 hits.

**Why registry over prose list:** every entry is a testable contract. "Do we cover question X?" becomes a grep. Adding a new canonical query is a PR against the registry, not a negotiation about whether the planner's LLM prompt should mention it.

### 6.2 Live executor

Wraps `ghlAdapter` (and future CRM adapters) for the long tail. Invoked when:

- the question references entities or fields not covered canonically
- the question is time-sensitive enough that polling lag matters
- the canonical candidate for this question explicitly flags "always go live"

**Hard constraints:**

- **Read-only.** Structurally — the executor exposes no write primitives. Not a matter of linting; the adapter surface it imports from excludes mutation helpers.
- **Adapter-backed, not provider-prompt-backed.** The planner produces a CRM-shaped plan; the adapter translates into provider-specific reads. The LLM never constructs provider HTTP calls directly.
- **Per-location rate limiter.** Reuses `getProviderRateLimiter(providerKey)` so noisy exploration can't starve ClientPulse polling.
- **Bounded result size.** Default cap ~100 rows; pagination / "show more" is a follow-up Brief, not an implicit fetch-all.

### 6.3 Hybrid executor

Some questions span both surfaces — e.g. "VIP contacts (live tag lookup) who haven't replied to emails in 30 days (canonical engagement history)."

**V1 posture (tightened per review feedback):** ship ONE narrow hybrid pattern in v1 — **canonical base + one live filter refinement**. This proves the wiring end-to-end and avoids "hybrid unsupported" becoming the common-case error that pushes users back to external tooling.

**The v1 pattern — `canonical_base_with_live_filter`:**

- Start from a canonical query (e.g. `contacts.inactive_over_days`)
- Apply one additional filter resolved via live provider call (e.g. `tag = 'VIP'` where tags aren't fully canonicalised)
- Merge in-memory and emit as a single result

**Explicit constraints in v1:**

- One live filter, not N — prevents unbounded join complexity
- Live filter must be a simple equality or set-membership test — no nested conditions
- Result size bounded by the canonical base's limit — live filter reduces, never expands

**Why these constraints exist:** hybrid execution is fundamentally a join across two data surfaces with different latency, rate-limit, and cost profiles. Unbounded hybrid (N live filters, nested conditions, result expansion) produces combinatorial work that is impossible to predict at plan time — a single query could fan out into hundreds of live calls. The v1 constraints keep hybrid predictable in cost, latency, and failure mode. Architect can relax constraints later as real traffic shows which patterns are worth the complexity; tightening after launch is far harder than loosening.

**Hybrid queries outside this pattern in v1** return a `BriefErrorResult` with `errorCode: 'unsupported_query'` and a `suggestions[]` array explaining how to reframe as canonical-only or live-only. The validator catches these before executor dispatch.

**The contract must reserve `source: 'hybrid'` as a first-class value regardless.** Future patterns (canonical + canonical join, live + canonical composition, multi-step aggregation) layer in as new hybrid sub-patterns without reshaping the envelope. Architect settles the v1 pattern list — the recommendation is exactly one, not "zero or more."

---

## 7. Result contract alignment (Brief contract)

**The planner does not define its own result types.** It emits into the Brief result contract already committed to main:

- `BriefStructuredResult` — normal data response (table + count + filters + suggestions + `source: 'canonical' | 'live' | 'hybrid'`).
- `BriefApprovalCard` — when a read query produces an obvious follow-up write ("email these 14 contacts"), the planner emits approval cards whose `actionSlug` points at an existing review-gated `crm.*` skill. The planner does not execute writes itself.
- `BriefErrorResult` — with `errorCode` from the contract's enum (`unsupported_query`, `ambiguous_intent`, `missing_permission`, `cost_exceeded`, `rate_limited`) and constructive `suggestions`.

**Why this matters:** every Brief chat surface (universal chat when it lands, stopgap Ask CRM panel if built first, agent-facing tool calls) already knows how to render these. No rendering work duplicates across surfaces. No contract negotiation between branches. The files are on main.

**Two planner-specific fields deserve call-out:**

- `filtersApplied[]` is **not optional**. Every interpreted filter surfaces as a chip so the user can see (and correct) how their intent was parsed. Silent filter application erodes trust — this was explicit in the contract doc.
- `suggestions[].intent` must be **re-parseable as a new Brief**. Phrase suggestions as full instructions ("Narrow to last 7 days and show VIP contacts"), not fragments ("last 7 days"). Clicking a suggestion fires a new Brief, not a refinement-only sub-call — which keeps the model simple.

### 7.1 Failure is part of iterative refinement, not a terminal state

`BriefErrorResult` is not the end of the conversation — it's a handoff back to the user with a constructive next step. Every error the planner emits should:

- Carry `suggestions[]` that are themselves valid follow-up Briefs (same re-parseable-as-a-new-Brief rule as `BriefStructuredResult`). An `unsupported_query` error for a multi-filter hybrid offers suggestions like "Show VIP contacts inactive 30d (canonical-only)" — a rephrasing the planner *can* execute.
- Be specific. `ambiguous_intent` names the axis of ambiguity ("activity" vs "engagement"); `missing_permission` names which permission; `cost_exceeded` names which ceiling and what a narrower query might cost.
- Preserve the user's original intent string so the chat surface can show "what I tried to do" next to "why it didn't work" next to "what to try instead."

**Architectural consequence:** a session of Brief chats is a refinement loop, not a question-answer transaction. Errors exist to tighten the next Brief, not to block the thread. The Brief-surface branch renders error artefacts so users treat them as "turns," not "failures."

---

## 8. Cost, safety, governance

Every governance primitive this feature needs already exists. The planner's job is to **route through them**, not reinvent them.

| Concern | Existing primitive | How the planner uses it |
|---|---|---|
| Per-run budget ceiling | `runCostBreaker` (Hermes Tier 1) | Every planner call routes through `llmRouter.routeCall`; breaker applies automatically |
| Per-query cost cap | New — small addition | Hard cent ceiling per planner invocation, distinct from per-run. Prevents one exploratory loop from eating a whole run's budget |
| Provider rate limiting | `getProviderRateLimiter(providerKey)` | Live executor acquires per-location before every call; canonical executor doesn't need it |
| RLS / scoping | Brief carries `organisationId` + `subaccountId`; existing `withPrincipalContext` pattern | Planner inherits Brief scope; every canonical read and adapter call runs under principal context |
| Audit | Existing run-trace + cost-ledger infrastructure | Each planner invocation is a normal agent-run event; `QueryPlan` persisted as part of the run's event log |
| Read-only guarantee | Structural — live executor imports no mutation helpers | Validator rejects any plan that implies a write; planner cannot emit an `actionSlug` that isn't in the read-only subset of `actionRegistry` |

**Read-only must be impossible to bypass through planner output.** Validator enforces: no plan surfaces a mutation `actionSlug`; executor layer imports no write-capable adapter methods. Two independent guards.

**Per-subaccount rate-limit budget on top of per-location rate limiter:** open question (see §11.5). Architect decides whether it ships v1 or only if real traffic signals abuse.

---

## 9. V1 scope cut

**Tight but architecturally correct.** The planner layer exists from day one; what's narrow is the set of executors and query classes it supports.

**Ships in v1:**

- 4-stage planner pipeline: Pattern Matcher → Plan Cache → LLM Planner → Validator
- `canonicalQueryRegistry` with the 8 proposed entries (§6.1), typed handler contract, alias-based pattern match
- Plan cache (exact-match normalised intent, 60s TTL)
- LLM-tier resolution via `llmRouter.routeCall` with org-configurable default (Haiku) and escalation tier (Sonnet)
- Canonical executor wired to the registry
- Live executor for GHL, read-only, bounded result size, rate-limited
- Hybrid executor — one pattern only: `canonical_base_with_live_filter` (§6.3)
- Normaliser emitting `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult`
- Automatic schema-context injection with summarisation + per-query filtering + per-subaccount cache (§11.11)
- Per-query cent ceiling
- Default result cap with truncation metadata
- One illustrative approval-card follow-up (e.g. "email these contacts" produces an approval card for `crm.send_email`) — proves the wiring end-to-end
- Cost preview attached to every plan
- Structured logging for classification, validation outcome, execution path, truncation, errors — shaped to feed a future Query Memory Layer (§11.12)

**Does not ship in v1 (by design):**

- Fuzzy / semantic caching of plans or results — exact-match or close-normalised only
- Hybrid patterns beyond `canonical_base_with_live_filter` — other patterns return structured `unsupported_query` with refinement suggestions
- Agent-facing `crm.schema_describe` diagnostic — can be deferred unless architect sees a reason to bundle
- Non-GHL live executors — HubSpot, Salesforce, Pipedrive plug in later via the same planner layer
- Query Memory Layer surfacing (logging is captured v1; promotion dashboard is follow-on per §11.12)
- Export / saved-segment affordances from the result view — those are Brief-surface affordances, not planner affordances, and the other branch owns them
- External MCP exposure of the planner — not needed and not desired

**Classification:** Significant (new layer, crosses multiple services, introduces new typed contract, reuses but rewires governance primitives). `architect` pass required before spec. `spec-reviewer` pass required before implementation.

---

## 10. Out of scope / deferred

- **The universal Brief chat surface itself** — the other branch owns it.
- **Writes via free text** — all writes remain `crm.*` review-gated skills.
- **Replacing canonical ingestion** — canonical stays. The planner prefers it where applicable.
- **An internal MCP protocol hop** to call our own adapters — unnecessary ceremony; the planner calls `canonicalDataService` / `ghlAdapter` directly.
- **Provider-specific UX** — nothing in the planner teaches users GHL concepts as the primary abstraction. Everything is CRM-shaped.
- **Parity with the external Claude-Code + MCP setup** — we absorb the category by offering something better-governed, not by cloning the UX.

---

## 11. Open decisions for architect

These are the decisions the detailed spec must settle. Architect should explicitly close each before spec-drafting begins.

### 11.1 Initial `canonicalQueryRegistry` entries

§6.1 lists 8 proposed v1 entries with keys. Architect confirms the final set, scoring thresholds, and the exact handler signatures. Entries outside this set fall through to live in v1.

### 11.2 Hybrid v1 pattern confirmation

Brief commits to one narrow pattern: `canonical_base_with_live_filter` (§6.3). Architect confirms this is the right first pattern and settles the scoring threshold above which Stage 3 promotes a plan to hybrid vs returning `unsupported_query`.

### 11.3 Schema-describe helper

Does `crm.schema_describe` ship as an agent-facing diagnostic tool, or is automatic schema injection at plan time sufficient? Argument for shipping: agents can self-correct after a hallucinated filter. Argument against: adds a round-trip most callers don't need.

### 11.4 Deterministic validator scope

What does the validator check beyond field-name existence and operator sanity? Candidates:

- Date-range sanity (no `before < after`)
- Projection field overlap with filter field constraints
- Entity-relation validity (e.g. `filter on opportunity stage` requires `primaryEntity = 'opportunities'`)
- Aggregation-field compatibility (`SUM` only on numeric fields)

Tighter validation = fewer bad plans reaching executors; too tight = rejects legitimate edge cases.

### 11.5 Per-subaccount rate-limit budget

Ships v1 or only when traffic signals abuse? Arguments both ways:

- Ship v1: defensive; one noisy Brief shouldn't starve ClientPulse
- Defer: `getProviderRateLimiter` already queues fairly; add budget only if observed traffic justifies

### 11.6 LLM tier escalation rules

§5.3 commits to router-mediated, configurable tiers with Haiku as the default. Architect settles:

- Confidence threshold below which a retry at the next tier fires (recommend `confidence < 0.6`)
- Whether hybrid plans auto-escalate (recommend yes)
- Schema-size heuristic that triggers escalation on unusually large filtered schemas
- Retry ceiling — single escalation per query, never a retry loop
- Final failure posture after tier exhaustion: structured `ambiguous_intent` error with refinement suggestions

### 11.7 Caching posture

- Plan cache — cache `{ normalised_intent → QueryPlan }` on exact match, short TTL (recommend 60s, same as `crmLiveDataService` pickers)
- Result cache — optional, recommend deferring to post-v1 unless architect sees a high-hit-rate pattern

### 11.8 Approval-card follow-up scope

Does v1 emit approval cards for any downstream action, or is v1 read-only with approval-card emission deferred? Recommendation: ship one end-to-end approval-card example (likely `crm.send_email` targeting a result's contact IDs) to prove the wiring, defer the broader set.

### 11.9 Observability surface

What structured log events does the planner emit per invocation? Minimum set:

- `planner.stage1_matched` / `planner.stage1_missed` (with normalised intent hash, matched registry key or null)
- `planner.stage2_cache_hit` / `planner.stage2_cache_miss` (with plan cache key)
- `planner.stage3_parse_started` / `planner.stage3_parse_completed` (with model tier, token count, latency, escalation flag)
- `planner.validation_failed` (with rejected field/operator)
- `planner.classified` (with `source`, `intentClass`, `confidence`, `stageResolved`)
- `planner.executor_dispatched` (with executor name, predicted cost)
- `planner.result_emitted` (with artefact kind, row count, truncated flag, actual cost)
- `planner.error_emitted` (with error code)

Derived metrics (computed from the above):

- `planner.llm_skipped_rate` — share of queries resolved before Stage 3. North-star for deterministic-coverage optimisation.
- `planner.canonical_hit_rate` — share of queries served by the canonical executor.
- `planner.hybrid_unsupported_rate` — share of Stage 3 plans classified as hybrid patterns outside the v1 supported set. Signals when additional hybrid patterns should be promoted.
- `planner.avg_query_cost_cents` — mean cost per query, segmented by `stageResolved`.

These metrics are also the input surface for the future Query Memory Layer (§11.12).

### 11.10 Coordination checkpoint with the Brief-surface branch

Confirm no contract drift has happened on `shared/types/briefResultContract.ts` since 2026-04-22 merge. If it has, reconcile before spec finalisation.

### 11.11 Schema injection strategy

Automatic schema injection at Stage 3 (§5.1) must defend against token bloat and noisy-schema hallucinations. Architect settles:

- **Summarisation shape** — entity-level summaries + top-N fields per entity (recommend frequency-weighted; static-ranked acceptable if usage data unavailable)
- **Per-query filtering** — only the entity/entities implied by the pattern-matcher's first pass get their full field lists injected. Other entities summarised to one line.
- **Caching** — schema summary per subaccount with TTL keyed off `canonical_subaccount_mutations` version. Stale schemas invalidate when a new canonicalised entity version lands.
- **Token budget** — hard ceiling on injected schema tokens per Stage 3 call (recommend 2k tokens, escalation bumps to 4k)
- **Schema source** — canonical dictionary first, live provider `schema_describe`-equivalent second when canonical doesn't cover the relevant entity (e.g. custom fields, niche objects)

### 11.12 Query memory layer posture

The planner's observability events (§11.9) deliberately carry the fields a future Query Memory Layer needs to consume: normalised intent, resolved plan, source, stageResolved, success rating. **Architect settles** whether v1 ships:

- (a) **Logging only** — events captured, no surfacing; memory layer is a follow-up feature (recommended)
- (b) **Logging + promotion candidate surface** — admin dashboard listing top live queries by frequency, flagged as "canonical promotion candidates"

Recommendation: (a). Reasons:

- The observability events are cheap to instrument and carry forward into (b) at no refactor cost.
- The surfacing work (dashboard, promotion workflow, scoring) is its own feature with its own brief and architect pass.
- Shipping (b) in v1 locks in UI shapes before we have traffic to validate them.
- The promotion loop — popular live queries become canonical candidates — is a strong compounding moat but needs real traffic data to design well.

The brief is shaped so the Query Memory Layer is a natural follow-on, not a retrofit. Architect should explicitly confirm the v1 event schema is Query-Memory-consumable before accepting (a).

---

## 12. Success criteria

A senior reviewer should answer yes to all of:

1. **Canonical-first works.** Questions that match canonical candidates route canonically, without LLM-plus-provider cost.
2. **Long-tail live works.** Questions outside the canonical set produce usable results via the live executor, with bounded cost and result size.
3. **Read-only is structurally enforced.** The validator and executor layer make write-via-free-text impossible, not just unlikely.
4. **The result contract is unchanged.** Every artefact emitted validates against `shared/types/briefResultContract.ts`.
5. **Scope is inherited, not bypassed.** Every planner call runs under the Brief's principal context; cross-subaccount reads are structurally impossible.
6. **Failure modes are constructive.** Ambiguous, unsupported, cost-exceeded, and rate-limited cases all return `BriefErrorResult` with a human-usable suggestion.
7. **Observability is complete.** Every planner invocation emits the classification, executor dispatch, and outcome events listed in §11.9.
8. **The v1 cut doesn't foreclose future shape.** Adding a new CRM adapter, supporting hybrid execution, or plugging the planner into a new surface does not require refactoring the layer — it's a new executor or a new caller.

If yes to all eight, the spec is ready for implementation.

---

## 13. Handoff notes

**For `architect`:**

- Use this brief as input; the reviewer's earlier 28-section version is the canonical source for the planner-layer reasoning if deeper context is needed (captured in the conversation thread on this branch).
- Settle §11's open decisions **before** spec drafting — they're the knobs that change the implementation surface area.
- The detailed spec is Significant-class. Run `spec-reviewer` on the draft before starting implementation.
- Spec should explicitly describe both the `QueryPlan` wire shape and the validator rules as testable contracts. Pure tests for both are cheap and pin the behaviour.
- Do not default back to a single `crm.live_query` skill, even as a "simpler v1," unless it preserves the planner layer and leaves room for canonical / hybrid executors without a rewrite. The planner layer IS the v1 architecture.

**For whoever implements after spec:**

- Reuse `llmRouter.routeCall` for intent parse. Do not call a provider adapter directly.
- Reuse `canonicalDataService` for the canonical executor; extend it if current surface is metrics-only (it is — see `canonicalDataService.ts` research audit).
- Reuse `ghlAdapter` read helpers for the live executor. Do not build a parallel adapter.
- Every executor result flows through the normaliser, which is the **only** place `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` instances get constructed. This keeps the contract enforceable in one place.

**For the Brief-surface branch:**

- The planner emits into your chat thread via the committed contract. No extra wiring needed from your side.
- If your surface needs a new artefact `kind`, coordinate with this branch via the contract file — do not create a parallel envelope.
- The stopgap "Ask CRM" panel mentioned in the reviewer's brief is **optional** — if your universal chat surface lands before the planner's v1 ships, the panel is not needed. Architect on this branch decides based on sequencing.

---

End of brief.
