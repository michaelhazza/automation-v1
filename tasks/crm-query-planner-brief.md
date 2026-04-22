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

**Two durable principles carried from the reviewer's upgrade:**

- **Discovery can be free-text; execution stays structured.** Users and agents can ask free-text CRM questions. The system plans and routes those questions deterministically. Any follow-up mutations remain existing typed, review-gated, auditable actions.
- **The user never chooses the data source.** The planner decides canonical vs live vs hybrid. The user just asks a question. "Query planner" is an internal concept, never a UI label.

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

```text
Brief chat intent (free text)
        │
        ▼
  CRM Query Planner
  ├── intent parse (LLM, cheap tier)
  ├── schema context injection
  ├── deterministic validator
  └── classification → QueryPlan
        │
        ▼
  Execution Layer
  ├── canonical executor      (canonicalDataService + RLS-scoped reads)
  ├── live executor           (ghlAdapter + per-location rate limiter)
  └── hybrid executor         (designed-for, partial in v1)
        │
        ▼
  Normaliser
  └── emits BriefStructuredResult / BriefApprovalCard / BriefErrorResult
        │
        ▼
  Brief chat thread renders the artefact
```

**What the planner is NOT:** a new MCP server, a new transport layer, a new persistence tier. It's a typed, testable service that lives in `server/services/` alongside the other capability services.

**What the planner IS:** the first-class abstraction for answering any CRM read question. Every new executor plugs in underneath it. Every new surface (Brief chat, agent tool call, stopgap Ask CRM panel) calls it.

**Why the layer matters:** without it, every surface and every new CRM provider duplicates the canonical-vs-live decision. With it, intent parsing, validation, schema injection, classification, cost control, and result normalisation all live in one place.

---

## 5. Planner responsibilities + QueryPlan contract

### 5.1 Responsibilities

The planner must:

1. **Parse intent** from free text. Cheap-tier LLM (Haiku class) — this is parse-and-shape, not reasoning.
2. **Inject schema context** automatically. Agents and users should not need to call a separate `crm.schema_describe` helper. The planner pulls the subaccount's connected-provider schema (entities, fields, pipelines, stages, tags) at plan time. A schema-describe helper may still exist as an agent-diagnostic tool, but it's not a required pre-step.
3. **Emit a structured QueryPlan** with explicit classification.
4. **Validate deterministically** after LLM output. Field names, operators, limits, and entity types are checked against the subaccount's schema. Hallucinated fields are caught here, not at execution time.
5. **Reject unsafe or unsupported plans** cleanly, with constructive error responses.
6. **Attach a cost preview** where possible (planner estimate, cached-similar-query, or static heuristic).

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

### 5.3 Classification is explicit, not implicit

Every plan carries an explicit `source`. This makes the routing testable, observable, and refactor-safe. "Which path ran?" is a logged field, not a code-path inference.

---

## 6. Execution paths — canonical, live, hybrid

### 6.1 Canonical executor

Wraps `canonicalDataService` for the known set of canonical-first queries. Cheapest path — no LLM, no provider round-trip. Deterministic.

**Must ship in v1.** Reasons:

- Without it, every CRM question pays LLM + provider cost even when the answer lives in a local indexed table.
- ClientPulse's existing canonical queries (at-risk accounts, pipeline velocity, stale deal ratio, revenue trend) are *exactly* the questions users will ask in plain English. Routing those through the live path is cost-negative with no UX upside.

**Does not mean "canonical-only".** The planner prefers canonical when the question clearly matches existing canonical capabilities; it falls through to live otherwise.

**Initial canonical-first candidates (architect confirms):**

- inactive / stale contacts over N days
- at-risk / churn-banded accounts (routes to ClientPulse health rollups)
- pipeline velocity, stage ageing
- standard appointment / opportunity lists already synced
- basic counts per tag or pipeline stage
- revenue trend over date range

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

**V1 posture:** design the planner and executor contracts **for** hybrid, ship a narrow subset (or none) in v1, and return a structured error with refinement suggestions for unsupported hybrid cases.

Architect settles whether v1 supports any hybrid cases or defers entirely. The contract must reserve space for hybrid regardless — retrofitting is harder than stubbing.

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

- Planner layer + deterministic validator + `QueryPlan` contract
- Canonical executor covering the initial candidate set (see §6.1)
- Live executor for GHL, read-only, bounded result size, rate-limited
- Normaliser emitting `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult`
- Automatic schema-context injection
- Per-query cent ceiling
- Default result cap with truncation metadata
- One illustrative approval-card follow-up (e.g. "email these contacts" produces an approval card for `crm.send_email`) — proves the wiring end-to-end
- Cost preview attached to every plan
- Structured logging for classification, validation outcome, execution path, truncation, errors

**Does not ship in v1 (by design):**

- Fuzzy / semantic caching of plans or results — exact-match or close-normalised only
- Full hybrid execution — designed-for, but initial responses may be structured-error with refinement suggestions (architect decides final posture)
- Agent-facing `crm.schema_describe` diagnostic — can be deferred unless architect sees a reason to bundle
- Non-GHL live executors — HubSpot, Salesforce, Pipedrive plug in later via the same planner layer
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

### 11.1 Initial canonical-first candidate set

Which specific canonical queries ship in the v1 canonical executor? §6.1 lists candidates; architect confirms and prioritises. A query outside this set falls through to the live executor in v1.

### 11.2 Hybrid posture in v1

Three options:

- (a) Reject all hybrid with structured error + refinement suggestion
- (b) Support a narrow subset where canonical + one live filter is straightforward
- (c) Defer entirely — planner never emits `source: 'hybrid'` in v1

Recommendation: (a) or (b). The contract must reserve `'hybrid'` regardless.

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

### 11.6 Model tier for planner intent parse

Haiku-tier should be sufficient. Architect confirms. Fallback posture on parse failure: retry once at same tier, or escalate to Sonnet on failure? Recommendation: retry once, then structured `ambiguous_intent` error.

### 11.7 Caching posture

- Plan cache — cache `{ normalised_intent → QueryPlan }` on exact match, short TTL (recommend 60s, same as `crmLiveDataService` pickers)
- Result cache — optional, recommend deferring to post-v1 unless architect sees a high-hit-rate pattern

### 11.8 Approval-card follow-up scope

Does v1 emit approval cards for any downstream action, or is v1 read-only with approval-card emission deferred? Recommendation: ship one end-to-end approval-card example (likely `crm.send_email` targeting a result's contact IDs) to prove the wiring, defer the broader set.

### 11.9 Observability surface

What structured log events does the planner emit per invocation? Minimum set:

- `planner.parse_started` / `planner.parse_completed` (with model, token count, latency)
- `planner.validation_failed` (with rejected field/operator)
- `planner.classified` (with `source`, `intentClass`, `confidence`)
- `planner.executor_dispatched` (with executor name, predicted cost)
- `planner.result_emitted` (with artefact kind, row count, truncated flag, actual cost)
- `planner.error_emitted` (with error code)

### 11.10 Coordination checkpoint with the Brief-surface branch

Confirm no contract drift has happened on `shared/types/briefResultContract.ts` since 2026-04-22 merge. If it has, reconcile before spec finalisation.

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
