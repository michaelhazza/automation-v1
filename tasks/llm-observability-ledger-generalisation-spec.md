# LLM Observability & Ledger Generalisation — Implementation Spec

**Date:** 2026-04-20
**Status:** Draft v1 — pending `spec-reviewer` pass
**Classification:** Significant (new admin UI, schema additions on a financial-audit table, cross-cutting adapter + router changes)
**Branch:** `bugfixes-april26`
**Author:** Main session (Claude Opus 4.7 1M)

---

## Framing statements (spec-context concurrence)

This spec is authored against `docs/spec-context.md` as of 2026-04-16. The following framing applies — any deviation is flagged inline:

- `pre_production: yes` — rollout is `commit_and_revert`, no staged percentage rollouts, no feature flags for new migrations.
- `testing_posture: static_gates_primary` + `runtime_tests: pure_function_only` — no vitest / jest / supertest / frontend unit / E2E tests proposed.
- `prefer_existing_primitives_over_new_ones: yes` — every new primitive this spec proposes carries a "why not reuse" paragraph.
- `breaking_changes_expected: yes` — adapter signatures and router contract may grow; no backward-compat shims.

Override: none. If reviewer flags a directional finding against these defaults, treat it as a framing check — this spec does not override them.

---

## Reading order for implementers

1. §1 Executive summary
2. §4 Existing primitives audit (what's being extended vs invented)
3. §5 Design decisions — the four fault lines, each with its rejected alternatives
4. §14 File inventory (single source of truth for what changes)
5. §15 Phase sequencing
6. §11 System P&L page (highest-visibility user-facing deliverable)
7. Deep dives §§6–13 as needed

---

## Table of contents

1. Executive summary & outcome
2. Problem statement — why the status quo fails
3. Goals & non-goals
4. Existing primitives audit (extension, not invention)
5. Design decisions — the four fault lines
   5.1 Attribution pattern (polymorphic `sourceId` vs FK-per-consumer)
   5.2 Taxonomy pattern (`taskType` enum vs `featureTag` freeform)
   5.3 `executionPhase` semantics for non-agent callers
   5.4 Router policy for system callers (routing + budget bypass)
6. Data model changes
   6.1 `llm_requests` schema additions
   6.2 `cost_aggregates` schema additions (`sourceType` dimension)
   6.3 Polymorphic attribution columns
   6.4 New statuses + parse-failure excerpt
7. Router changes
   7.1 `LLMCallContextSchema` additions
   7.2 System-caller policy (routing opt-out, budget opt-out)
   7.3 Idempotency-key scheme for new source types
8. Adapter changes
   8.1 `AbortController` plumbing through `ProviderCallParams`
   8.2 HTTP 499 detection + `client_disconnected` mapping
   8.3 Parse-failure excerpt capture
   8.4 Adapter parity across every registered provider (anthropic / openai / gemini / openrouter)
9. Direct-adapter caller sweep (methodology + remediation plan)
10. Skill-analyzer migration (the proof-of-concept consumer)
    10.1 `skillAnalyzerJob` classify call
    10.2 Haiku agent-suggestion call
    10.3 Sonnet cluster-recommendation call
11. System P&L page
    11.1 Route + permissions
    11.2 Service layer
    11.3 API endpoints
    11.4 Page components (KPIs, tabs, table, chart, top-calls)
    11.4.1 Controls implemented in P4 (auto-refresh, Refresh, Export CSV, View all, decorative footer links)
    11.5 Column contracts per tab
    11.6 Detail drawer (per-call)
12. Retention policy for `llm_requests`
13. Permissions & RLS
14. File inventory
15. Phase sequencing (dependency graph)
16. Testing posture
17. Deferred items
18. Rollout
19. Contracts (appendix)

---

## Conventions used in this spec

- **Contracts** are called out explicitly per §3 of `docs/spec-authoring-checklist.md`. Every data shape crossing a service boundary has a Contracts entry in §19.
- **Migration numbers** use the next free sequence from `migrations/` as of 2026-04-20 (latest is 0179 — this spec claims 0180, 0181, 0182, and 0183 across phases, see §15; a prior draft reserved 0184 for a pg-boss cron registration but that was cut because job registration is application code, not DDL).
- **Phase labels** are P1–P5 and map 1:1 to the sequencing graph in §15.
- **Reference UI** — the authoritative visual reference for §11 is `prototypes/system-costs-page.html` (committed to this branch), which includes all four tab views with worked dummy data.

---

*Section content begins below.*

---

## 1. Executive summary & outcome

### 1.1 What this spec delivers

Four coordinated changes to turn the existing `llm_requests` ledger from an agent-centric audit trail into a **universal, P&L-grade record of every LLM call the platform makes**, no matter which consumer initiated it:

1. **Generalise the ledger's attribution model** so non-agent consumers (skill analyzer, workspace-memory compile, belief extraction, future background jobs) plug in with zero new FK columns per consumer. Polymorphic `sourceId` + extended `sourceType` enum + freeform `featureTag` column. See §5.1, §5.2, §6.
2. **Harden the adapter layer** with an `AbortController`, explicit HTTP 499 detection, and a truncated parse-failure response excerpt. These close the three observability gaps that made the skill-analyzer incident that kicked off this spec impossible to diagnose from our own data. See §8.
3. **Migrate the skill analyzer** off direct `anthropicAdapter.call()` and onto `llmRouter.routeCall()` as the proof-of-concept consumer. After this lands, analyzer calls show up in `llm_requests`, `cost_aggregates`, the Usage page, and the new System P&L page — every future direct-adapter caller becomes a review gate, not the default. See §10.
4. **Ship a System P&L admin page** at `/system/llm-pnl` that surfaces platform-wide revenue, cost, gross profit, platform overhead, and net profit across four grouping axes (organisation / subaccount / source type / provider & model). First client-side surface for cross-org financials; UI anchor is `prototypes/system-costs-page.html`. See §11.

### 1.2 The outcome, stated as verifiable assertions

Per `CLAUDE.md §1` — rewriting goals as verifiable assertions:

- **A1 — No dark LLM calls.** `scripts/gates/verify-no-direct-adapter-calls.sh` fails CI when any non-test file outside `server/services/llmRouter.ts` and `server/services/providers/*.ts` imports any registered provider adapter directly (`anthropicAdapter`, `openaiAdapter`, `geminiAdapter`, `openrouterAdapter`, and any adapter added to `server/services/providers/registry.ts` in the future). The only exceptions in the final tree are test files and the router itself.
- **A2 — Analyzer spend is attributable.** After the analyzer migration lands, a SQL query against `llm_requests` filtered by `featureTag = 'skill-analyzer-classify'` returns rows whose `providerRequestId` matches what the Anthropic console shows for the same time window.
- **A3 — 499s are first-class.** A classify call that is aborted by our side produces a row with `status = 'aborted_by_caller'` (and the rarer provider-side `client_disconnected` is its own distinct status — see §6.4 for the exact mapping). Verified by manual check per §16.3 on P3 merge: kill a classify mid-flight and confirm the written row's status.
- **A4 — Parse failures are debuggable from our own data.** When the LLM returns unparseable JSON, the row carries a non-null `parseFailureRawExcerpt` capped at 2 KB. Verified by the pure-function test on the UTF-8 truncation helper (§14.8a) and the manual check per §16.3 on P3 merge.
- **A5 — System costs are visible.** A platform admin visiting `/system/llm-pnl` sees a dedicated "Platform overhead" row in every tab view, showing total system spend, no revenue attribution, and correctly subtracted from Gross profit to produce Net profit.
- **A6 — `cost_aggregates` supports the new dimension.** Querying aggregates by `entity_type = 'source_type'` returns per-source-type rollups for any given period, populated by the same `llm-aggregate-update` job that feeds existing dimensions.
- **A7 — Retention is bounded.** A nightly pg-boss job moves `llm_requests` rows older than N months into `llm_requests_archive`. N is configurable via `env.LLM_LEDGER_RETENTION_MONTHS` (default: 12). `cost_aggregates` rollups stay forever.

### 1.3 Why this is one spec, not several

Each of the four changes above is individually small. Taken separately, each one tempts the author to "just wire it in and skip the plumbing" — which is exactly how the analyzer ended up bypassing the router in the first place. The coordinated change is:

> Make the ledger generic enough that the next new consumer has **no architectural choice** but to route through it.

Splitting this into separate specs risks landing (1) without (2) and leaving parse failures still invisible, or landing (3) without (1) and adding `analyzerJobId` as an FK column (the debt outcome described in §5.1). The pieces co-constrain each other. One spec, phased rollout (§15).

---

## 2. Problem statement — why the status quo fails

### 2.1 The incident that produced this spec

On 2026-04-20 the skill-analyzer ran a 37-skill import against a marketing-heavy skill library. The UI showed "Classifying with AI..." at 60% for over 4 minutes with visible slowness. When the session tried to diagnose it:

- **No server-side log file existed** — `logger.ts` at [server/lib/logger.ts](server/lib/logger.ts) is JSON-to-stdout only. Logs went to whatever terminal ran `npm run dev` and were lost when that terminal closed.
- **No entries in `llm_requests`** — the analyzer bypasses `llmRouter` entirely and calls `anthropicAdapter.call()` directly at three sites in [server/jobs/skillAnalyzerJob.ts](server/jobs/skillAnalyzerJob.ts) (lines 768, 1321, 1459).
- **No entries in `cost_aggregates`** — derivative of the above.
- **The only source of truth was the Anthropic console**, which showed two `client_error: true, code: 499, "Client disconnected"` events at latencies of 15.5s and 73.8s with token outputs of 4819 and 1197 — mid-generation aborts, not timeouts.
- **Our side had no record** that those disconnects even happened, let alone why.

The incident exposed three dimensions of the same root cause: **direct-adapter calls are a dark code path**. Cost, attribution, latency, failure mode, token usage, provider request IDs — none of it exists for the analyzer.

### 2.2 Architectural root cause

The existing `llm_requests` table is *well-designed but consumer-specific*. Its attribution columns hard-code the three original consumers of the router (`agentRuns`, `executions`, `ieeRuns`) via typed FKs:

```ts
// server/db/schema/llmRequests.ts:29-35
runId:       uuid('run_id').references(() => agentRuns.id),
executionId: uuid('execution_id').references(() => executions.id),
ieeRunId:    uuid('iee_run_id').references(() => ieeRuns.id),
```

A fourth consumer (analyzer) has three structural options, and the rational one has not yet been taken:

1. Leave all three FKs null and lose SQL-level linkage back to the analyzer job. **Debt.**
2. Add a `analyzerJobId` column to the ledger. Every next consumer adds a column. **Debt that compounds.**
3. Migrate to a polymorphic `sourceId uuid + sourceType text` pattern alongside the existing typed FKs. **The correct move; this spec proposes it.**

The router itself (`llmRouter.routeCall`) is already substantially generic — its signature doesn't require agent-specific concepts. The narrow-widening work is in the ledger schema, not in the router signature. See §5.1 and §7 for details.

### 2.3 Three gaps that made the incident undebuggable

Each is a small but load-bearing gap in the current ledger contract:

| Gap | What broke | Fix location | Section |
|---|---|---|---|
| No HTTP 499 discrimination | `client_disconnected` collapses into `error` — can't tell "our side hung up mid-response" from "model returned an error" | `status` enum in `llm_requests` + mapping in adapter | §6.4, §8.2 |
| No raw-response excerpt on parse failures | When Sonnet returns unparseable JSON we log to stdout once then lose it | New `parseFailureRawExcerpt` nullable column (≤2 KB) | §6.4, §8.3 |
| No clean cancellation primitive in the adapter | `Promise.race` abandons the fetch, socket RSTs eventually — shows as an unexplained 499 on Anthropic's side | `AbortController` threaded through `ProviderCallParams` | §8.1 |

### 2.4 Product-level problem — zero cross-org financial visibility

Separate from the observability gap: today there is **no UI surface where a platform operator can see LLM spend across multiple organisations at once**. The endpoint `/api/admin/usage/overview` exists at [server/routes/llmUsage.ts:479](server/routes/llmUsage.ts) but has no client caller. There is no `SystemUsagePage`, no `/system/costs` route, no `/system/llm-pnl` route.

This matters more than "operator convenience" because:

- **Revenue attribution requires cross-org rollup.** You cannot see whether the platform is making money without aggregating `costWithMargin` across every org in one view.
- **System-level spend has no home today.** Rows with `sourceType='system'` already exist in the ledger (written today by `workspaceMemoryService`, `agentBriefingService`, `skillEmbeddingService`, `outcomeLearningService`, and `skillExecutor` — see `rg "sourceType.*'system'" server/`), but there is no admin surface that aggregates them. P3 adds `sourceType='analyzer'` as a sibling taxonomy so the analyzer's non-trivial spend stops being pooled into "system." Adding the System P&L page at the same time is what makes both taxonomies *useful* rather than just *stored*.

### 2.5 Why this is urgent (not just nice-to-have)

- The analyzer today writes nothing to `llm_requests`. Every analyzer run silently burns provider budget with no ledger row, no cost-aggregate row, no billing attribution. The longer this persists, the more drift accumulates between "what we paid providers" and "what the ledger says we paid providers."
- Other direct-adapter callers may exist and are un-audited. §9 covers the sweep — there is a non-zero probability that production-path code other than the analyzer is also dark. We don't know until we look.
- The `System P&L` page is the single most-requested platform-operator view. Until it exists, the CEO cannot answer "is this business making money this month?" from inside the product.

---

## 3. Goals & non-goals

### 3.1 In-scope goals

1. **Generalise `llm_requests` attribution** so any current or future consumer (agent run, process execution, IEE run, analyzer job, future background job, admin tool) produces ledger rows without a schema change per consumer.
2. **Close the three adapter-level observability gaps** (499 discrimination, parse-failure excerpt, AbortController) uniformly across every registered provider adapter (`anthropicAdapter`, `openaiAdapter`, `geminiAdapter`, `openrouterAdapter`) — see §8.4 for parity matrix.
3. **Migrate the skill-analyzer** to route through `llmRouter` end-to-end, retiring all four direct `anthropicAdapter.call()` sites in the analyzer subsystem — three in `server/jobs/skillAnalyzerJob.ts` (§10.1–§10.3) and one in `server/services/skillAnalyzerService.ts` (§10.4).
4. **Extend `cost_aggregates`** with a `sourceType` dimension so system-level spend can be rolled up and displayed separately from org-billable spend.
5. **Ship a System P&L admin page** at `/system/llm-pnl` with four grouping tabs (organisation / subaccount / source type / provider-model), four KPI cards (Revenue / Gross profit / Platform overhead / Net profit), a 30-day trend chart, and a top-calls-by-cost list (ranked by cost desc, includes platform-overhead rows). UI contract: `prototypes/system-costs-page.html`.
6. **Add a nightly retention job** that moves `llm_requests` rows older than `env.LLM_LEDGER_RETENTION_MONTHS` (default 12) into a `llm_requests_archive` table of identical shape, with lighter indexing.
7. **Enforce no-regression** via a new static gate `scripts/gates/verify-no-direct-adapter-calls.sh` that fails CI if any non-router, non-test file imports the adapters directly.
8. **Audit the codebase** for other direct-adapter callers (§9) and produce a remediation plan — not necessarily remediation itself within this spec.

### 3.2 Out of scope (explicitly non-goals)

These were considered and rejected for this spec — they are not deferred, they are **not in scope and should not be added**:

- **Replacing the router.** The router is fit for purpose; this spec extends its context shape, not its responsibilities.
- **Replacing `agentExecutionService`'s existing attribution path.** Agent runs already write to `llm_requests` via the router correctly. This spec's polymorphic pattern is *additive* — typed FKs (`runId`, `executionId`, `ieeRunId`) remain and continue to be the primary attribution mechanism for their consumers. New consumers use the polymorphic columns.
- **Per-call streaming of responses.** Anthropic non-streaming is fine for the analyzer's use case; streaming support is a separate spec.
- **A cost-forecasting or budget-prediction layer.** `docs/spec-context.md` convention_rejections explicitly excludes "predictive cost modelling or tool success scoring loops."
- **E2E tests against the P&L page.** `frontend_tests: none_for_now` per framing.
- **A database-backed application log table.** Option 2 from the earlier conversation (file transport for `logger.ts`) is a useful but separate concern; this spec does not require it. Once `llm_requests` captures every call, stdout-only `logger.ts` is acceptable for the residual non-LLM events.
- **A billing invoice workflow.** Revenue on the P&L page is `costWithMargin` from the ledger, not a billing artefact. Invoices are a downstream concern.
- **MCP tool call observability.** MCP tool calls that invoke an LLM do so through the same adapters and will inherit this observability; MCP tool calls that don't invoke an LLM (pure IO) are out of scope.

### 3.3 Non-goals that are genuinely deferred (see §17)

These are in the Deferred Items section with explicit phase pointers:

- Detail drawer rich-state interactions (tooltip, filter by request ID, "copy as support ticket")
- Auto-archival of matched `cost_aggregates` rows older than 24 months
- Provider-level cost reconciliation (comparing our cost to Anthropic invoice dumps)
- Anomaly alerting on System P&L metrics (e.g. "Platform overhead >15% of revenue for 3 consecutive days")

---

## 4. Existing primitives audit

Per §1 of `docs/spec-authoring-checklist.md`, every new primitive this spec introduces carries a "why not reuse" paragraph. This section walks through each candidate primitive and states the decision.

### 4.1 Tables

| Proposing | Status | Rationale |
|---|---|---|
| New LLM log table (`llm_logs` in the earlier rejected draft) | **REJECTED — reuse** `llm_requests` | The earlier draft of this spec (noted in conversation history) proposed `llm_logs`. Audit showed `llm_requests` already captures 100% of the columns the new table would carry, plus 30+ more. Building a parallel table was the wrong answer. Spec pivoted to extending `llm_requests`. |
| New attribution table (e.g. `llm_request_sources`) | **REJECTED — extend existing** | An attribution junction table would require an extra JOIN on every query. The polymorphic `sourceId` + `sourceType` pattern on `llm_requests` is a one-column change that serves the same purpose. See §5.1 rejected alternatives. |
| `llm_requests_archive` | **NEW PRIMITIVE** | No existing archival pattern for financial-audit rows. Why not reuse: `cost_aggregates` is a rollup, not an archive — it loses per-call detail. Why not defer: unbounded growth on `llm_requests` is operational debt that gets worse with time. Why new: keeps the same shape as the live table so queries work identically after joining, with lighter indexing to reduce write amplification. |

### 4.2 Services

| Proposing | Status | Rationale |
|---|---|---|
| `llmRouter.routeCall()` extensions | **EXTEND** | New fields on `LLMCallContextSchema`, two new system-caller policy branches. Router responsibility doesn't change. |
| `costAggregateService.upsertAggregates()` — `sourceType` dimension | **EXTEND** | Add one more entity type to the existing dimension enum. Same service, same job, same upsert key shape. |
| Adapter layer (every adapter in `server/services/providers/registry.ts` — `anthropicAdapter`, `openaiAdapter`, `geminiAdapter`, `openrouterAdapter`) | **EXTEND** | New `signal` param, new error mapping, new parse-failure capture. Adapter contract grows but stays adapter-shaped. Uniform across every registered provider per §8.4. |
| `systemPnlService` (new) | **NEW PRIMITIVE** | No existing service cross-aggregates across organisations. `llmUsageService` is org-scoped (every method filters by `organisationId`). Why not reuse: making `llmUsageService` dual-purpose (org-scoped and platform-scoped) blurs the scoping boundary the RLS guard relies on. A separate system service with its own principal-scoping check is clearer and safer. |
| `systemAdminLedgerService` or similar | **REJECTED — inline in `systemPnlService`** | One service is enough; no need to split. |

### 4.3 Routes

| Proposing | Status | Rationale |
|---|---|---|
| `/api/admin/usage/overview` existing route | **NO CHANGE — left in place** | Route already requires `requireSystemAdmin` and serves the existing subaccount-scoped Usage page. The P&L page's new grouping shapes are shaped differently enough (platform-admin cross-org, different cache profile, different response envelope) that a new router is cleaner than grafting onto the existing endpoint. See §11.3 and §14.4. |
| `/api/admin/llm-pnl/*` (new routes) | **NEW** | New aggregated endpoints for the 4-tab grouping, the 30-day trend, and the top-calls-by-cost list. Why not reuse: fits badly inside the existing overview endpoint (response shape mismatch, different cache profile). |
| `/api/admin/llm-calls/:id` (call detail) | **NEW** | No existing per-call detail endpoint. System-admin-only; read from `llm_requests` directly (no RLS bypass — admin is explicitly cross-tenant). |

### 4.4 Jobs

| Proposing | Status | Rationale |
|---|---|---|
| `llm-aggregate-update` existing job | **EXTEND** | Already upserts `cost_aggregates` per dimension. Add `sourceType` dimension to its upsert loop. |
| `llm-ledger-archive` (new pg-boss job) | **NEW** | Nightly cron-scheduled job to move rows. Why not reuse: existing `cleanOldAggregates()` handles aggregate purging only, not detail-row archival. Different lifecycle (archive not delete; different table). |
| `skill-analyzer` job post-migration | **EXTEND** | Existing pg-boss queue unchanged. Internal call sites swap `anthropicAdapter.call()` → `llmRouter.routeCall()`. |

### 4.5 Skills / middleware / actions

Not introducing any. This spec doesn't touch the skill system or the agent middleware stack.

### 4.6 Client-side components

| Proposing | Status | Rationale |
|---|---|---|
| `ColHeader` / `NameColHeader` pattern | **REUSE** | The Google-Sheets-style column header pattern already lives in [SystemSkillsPage.tsx](client/src/pages/SystemSkillsPage.tsx). `SystemPnlPage.tsx` reuses this component family. |
| `VisibilitySegmentedControl` pattern | **REUSE** (conceptually) | Not this exact component, but the same inline segmented-control styling. |
| `SystemPnlPage.tsx` (new page) | **NEW** | New route. Follows `SystemSkillsPage.tsx` as the closest-in-spirit system-admin page. |
| `SystemPnlKpiCard`, `SystemPnlTable`, `SystemPnlTrendChart` (new components) | **NEW — scoped to this page** | No generic reuse expected. Scoped folder `client/src/components/system-pnl/`. |
| Micro-sparkline pattern | **NEW — trivial** | Inline SVG, no library. Pattern shown in `prototypes/system-costs-page.html`. |

### 4.7 Static gates

| Proposing | Status | Rationale |
|---|---|---|
| `scripts/gates/verify-no-direct-adapter-calls.sh` | **NEW** | No existing gate enforces "don't import adapters directly." Necessary to prevent regression — without it, the next contributor will re-introduce the analyzer-shaped bypass pattern. Exempts `server/services/llmRouter.ts` and `server/services/providers/*.ts` and any `*.test.ts`. |

### 4.8 Accepted primitives used by this spec (from `docs/spec-context.md`)

- **`withBackoff`** — the analyzer already uses this; it stays in place inside the router call path.
- **`RLS_PROTECTED_TABLES` manifest** — extending `llm_requests_archive` requires adding to this manifest in the same migration that creates the table. See §13.
- **`verify-rls-coverage.sh` + `verify-rls-contract-compliance.sh`** — both gates continue to enforce coverage after the archive table lands.

---

## 5. Design decisions — the four fault lines

Each subsection below names a directional design decision, the decision taken, and the rejected alternatives (with reasons). These are the questions the `spec-reviewer` agent will pause for HITL on if they are implicit — pinning them here prevents that.

### 5.1 Attribution pattern — polymorphic `sourceId` vs FK-per-consumer

**Decision:** Introduce two new columns on `llm_requests`:

- `sourceId uuid` — polymorphic pointer. When populated, points to a row in whichever table `sourceType` names. No referential integrity constraint (FK would have to be to multiple tables).
- `sourceType` remains the existing `text` column, but is extended with additional values (see §5.2's adjacent decision).

Existing typed FKs (`runId`, `executionId`, `ieeRunId`) are **kept as-is**. They are the primary attribution mechanism for their respective consumers — the polymorphic pattern is *additive*, used only by new consumers who don't have a typed FK.

**Assertion that makes this unambiguous:** For any row in `llm_requests`, exactly one of the following holds:

- `sourceType = 'agent_run'` AND `runId IS NOT NULL` AND `sourceId IS NULL`
- `sourceType = 'process_execution'` AND `executionId IS NOT NULL` AND `sourceId IS NULL`
- `sourceType = 'iee'` AND `ieeRunId IS NOT NULL` AND `sourceId IS NULL`
- `sourceType IN ('system', 'analyzer', …future values…)` AND `sourceId IS NOT NULL` AND all three typed FKs NULL
- `sourceType = 'system'` AND `sourceId IS NULL` (legacy system rows without attribution; preserved for backward compat)

Enforced by a database `CHECK` constraint (see §6.1).

**Rejected alternatives:**

- **Column-per-consumer.** Adding `analyzerJobId` then `workspaceMemoryCompileJobId` then the next one. Schema grows linearly with consumer count. Every addition requires a migration and a backfill. **Rejected as compounding debt.**
- **Remove typed FKs, use only polymorphic.** Clean in theory; catastrophic to migrate. Existing queries, existing indexes, existing joins across `agent_runs ↔ llm_requests` would all break. The downside of keeping typed FKs (a bit of schema asymmetry) is much smaller than the cost of a deep rewrite. **Rejected on pragmatism.**
- **Junction table `llm_request_sources`.** Would require an extra JOIN on every ledger read. For a high-write table this is measurable. **Rejected on query-path cost.**

**Load-bearing mechanism:** the `CHECK` constraint in migration 0180. Without it, the invariant is prose; with it, the invariant is enforced.

### 5.2 Taxonomy pattern — `taskType` enum extension vs `featureTag` freeform

**Decision:** Keep `taskType` as a closed enum (it already has 10 values). **Do not extend it** for new consumers. Add a new column:

- `featureTag text NOT NULL DEFAULT 'unknown'` — freeform kebab-case identifier for the specific LLM use case. Examples: `skill-analyzer-classify`, `skill-analyzer-agent-match`, `skill-analyzer-cluster-recommend`, `workspace-memory-compile`, `belief-extraction`, `hyde-expansion`.

Router callers must set it; default `'unknown'` exists only to make the column `NOT NULL` without breaking existing code paths that might silently not yet set it. A static check at the router level logs a warning when a call arrives with `featureTag = 'unknown'` in non-test code.

**Why two separate columns (`taskType` + `featureTag`)?** They answer different questions:

- `taskType` answers "what class of work is this?" — used by model routing (`resolveLLM()` consumes it).
- `featureTag` answers "which feature is this?" — used by cost-attribution dashboards and the System P&L page.

A reader of the Usage page wants to see feature-level breakdowns ("how much did the analyzer cost this week?"). A router making model-selection decisions wants to see task-level classes (`general`, `qa_validation`, `memory_compile`). Conflating them into one column makes either one slightly worse at its job.

**Rejected alternatives:**

- **Extend `taskType` with `skill_classify` etc.** Closed enum = migration per feature = churn. Also conflates routing policy concepts with reporting concepts. **Rejected.**
- **Overload `agentName` as a feature tag.** `agentName` is only meaningful for agent runs; using it for non-agent callers would break its existing semantics for the Usage page's "by agent" breakdown. **Rejected.**
- **JSONB metadata column.** Too flexible; makes aggregation slow and reporting brittle. **Rejected.**

### 5.3 `executionPhase` semantics for non-agent callers

**Decision:** Make `executionPhase` nullable. The existing enum (`planning | execution | synthesis | iee_loop_step`) is agent-execution-shaped and doesn't describe "one-shot classifier call" or "background job inference." For non-agent callers:

- `executionPhase` is **NULL** when `sourceType ∈ {'system', 'analyzer', plus any future non-agent source}`.
- `executionPhase` remains **required (NOT NULL)** when `sourceType ∈ {'agent_run', 'process_execution', 'iee'}`.

Enforced by the same `CHECK` constraint as the attribution invariant (§5.1).

**Why not add a neutral `'batch'` or `'one_shot'` enum value?** Because that value carries no useful semantics — it means "not agent execution," which is exactly what `NULL` already conveys. Adding a dummy value pollutes every dashboard that groups by phase with a meaningless bucket. NULL-as-absent is the honest representation.

**Rejected alternatives:**

- **Add `'batch'` value.** Dashboard clutter for zero routing benefit. **Rejected.**
- **Reshape `executionPhase` into a more generic `callContext` column.** Breaks every existing query. **Rejected on migration cost.**

### 5.4 Router policy for system callers — routing resolution + budget

**Decision:** Introduce a new enum on `LLMCallContextSchema` — `systemCallerPolicy: 'respect_routing' | 'bypass_routing'` — defaulting to `'respect_routing'`. When set to `'bypass_routing'`:

- `resolveLLM()` is skipped; the caller's chosen `provider` and `model` are used verbatim. `capabilityTier`, `wasDowngraded`, `routingReason` remain populated for reporting (`routingReason = 'forced'`, `wasDowngraded = false`).
- `budgetService.checkAndReserve()` is still invoked unconditionally, but its return type is widened to `string | null` and it returns `null` (no reservation) for `sourceType ∈ {'system', 'analyzer'}`. Downstream code already tolerates `null` as "no reservation to release on error", because system calls have no billing line. See §7.2 for the exact branch and §19.10 for the updated contract.

**Why bypass routing at all?** The analyzer has legitimate reasons to pin `claude-sonnet-4-6` for classification (the prompt is tuned for that model's JSON parse reliability). Routing would downgrade it to Haiku based on policy, breaking the spec-correctness of the analyzer's output. For migrations, this is exactly the right escape hatch — opt-in, per-call, visible in the ledger.

**Why still go through the router (not skip entirely)?** Because the router is the only primitive that writes `llm_requests`. Bypass-routing still writes the row. Skip-router doesn't. That's the whole point of this spec.

**Rejected alternatives:**

- **Always route — no bypass.** Breaks analyzer correctness; analyzer Sonnet prompts are not Haiku-compatible without redesign. Also breaks any future caller that has a good reason to pin a model. **Rejected.**
- **Add a new `resolveLLM` strategy per caller.** Unbounded policy sprawl. **Rejected.**
- **Put the bypass inside the adapter.** Moves the decision to the wrong layer; the router is where routing policy belongs. **Rejected.**

### 5.5 Summary table

| Fault line | Decision | Mechanism | Trade-off accepted |
|---|---|---|---|
| Attribution pattern | Polymorphic `sourceId` + keep typed FKs | DB `CHECK` constraint | Schema asymmetry (acceptable) |
| Taxonomy pattern | New `featureTag` column, keep `taskType` enum | Static check at router call site | Two columns instead of one (intentional) |
| `executionPhase` for non-agents | Nullable, NULL for system/analyzer | Same `CHECK` constraint | Removes `NOT NULL` on that column |
| Router policy for system | `systemCallerPolicy` enum default `'respect_routing'` | New field on `LLMCallContextSchema` | Per-call opt-out (intentional) |

---

## 6. Data model changes

### 6.1 `llm_requests` schema additions (migration 0180)

Four new columns, one loosened constraint, three new `status` values, one extended `sourceType` value set, one new `CHECK` constraint.

**Migration file:** `migrations/0180_llm_requests_generalisation.sql`

**Column additions:**

```sql
ALTER TABLE llm_requests
  ADD COLUMN source_id uuid,                                -- polymorphic FK (no RI)
  ADD COLUMN feature_tag text NOT NULL DEFAULT 'unknown',   -- kebab-case feature identifier
  ADD COLUMN parse_failure_raw_excerpt text,                -- ≤2 KB truncated LLM response
  ADD COLUMN abort_reason text;                             -- 'caller_timeout' | 'caller_cancel' | NULL
```

**Constraint changes:**

```sql
ALTER TABLE llm_requests ALTER COLUMN execution_phase DROP NOT NULL;

-- Drop the `sourceType` column default so every insert path MUST specify
-- a source_type explicitly. The existing default `'agent_run'` would
-- silently satisfy a legacy NULL-runId insert and bypass the new
-- attribution CHECK — closing that gap is the entire point of this spec.
ALTER TABLE llm_requests ALTER COLUMN source_type DROP DEFAULT;
```

The schema file `server/db/schema/llmRequests.ts` is updated in the same migration to remove `.default('agent_run')` from the `sourceType` column declaration. Every router insert path already sets `sourceType` explicitly today (verified during P1 — the router always has a `ctx.sourceType`), so the default is unreachable in practice. Dropping it catches the next caller who forgets.

**Status enum extensions** (stored as free `text`; enforced by app-level enum in `llmRequests.ts`):

- Add `'client_disconnected'` — HTTP 499 equivalent, our side aborted/closed the socket.
- Add `'parse_failure'` — provider returned a structurally-OK response that failed our schema check after all retries exhausted.
- Add `'aborted_by_caller'` — `AbortController.abort()` fired from caller code (distinct from caller_timeout).

**sourceType enum extension** (app-level):

- Add `'analyzer'` — skill-analyzer calls after migration.
- Keep `'system'` as the generic non-attributed catch-all for future system consumers that don't have their own sourceType value yet.

**CHECK constraint — attribution invariant:**

Every clause below fully constrains every attribution column so the invariant prose in §5.1 is encoded exactly — no attribution column can appear where it doesn't belong.

```sql
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_attribution_ck CHECK (
  (source_type = 'agent_run'
     AND run_id          IS NOT NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL
     AND source_id       IS NULL)
  OR
  (source_type = 'process_execution'
     AND execution_id    IS NOT NULL
     AND run_id          IS NULL
     AND iee_run_id      IS NULL
     AND source_id       IS NULL)
  OR
  (source_type = 'iee'
     AND iee_run_id      IS NOT NULL
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND source_id       IS NULL)
  OR
  (source_type = 'analyzer'
     AND source_id       IS NOT NULL
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL)
  OR
  (source_type = 'system'
     AND run_id          IS NULL
     AND execution_id    IS NULL
     AND iee_run_id      IS NULL)
     -- source_id is optional for 'system' (may be NULL for truly unattributable
     -- platform work, or set to a job/service identifier when attribution exists)
);
```

**CHECK constraint — `executionPhase` nullability invariant:**

```sql
ALTER TABLE llm_requests ADD CONSTRAINT llm_requests_execution_phase_ck CHECK (
  (source_type IN ('agent_run', 'process_execution', 'iee') AND execution_phase IS NOT NULL)
  OR
  (source_type IN ('system', 'analyzer') AND execution_phase IS NULL)
);
```

**Index additions:**

```sql
CREATE INDEX llm_requests_source_id_idx          ON llm_requests (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX llm_requests_feature_tag_month_idx  ON llm_requests (feature_tag, billing_month);
CREATE INDEX llm_requests_status_idx             ON llm_requests (status) WHERE status <> 'success';
```

The partial index on `status` avoids the common case (success rows, ~99% of traffic) and speeds up debugging queries ("show me all 499s this week").

**Drizzle schema update** in [server/db/schema/llmRequests.ts](server/db/schema/llmRequests.ts):

- Add four columns.
- Extend `SOURCE_TYPES` array with `'analyzer'`.
- Extend `LLM_REQUEST_STATUSES` array with `'client_disconnected'`, `'parse_failure'`, `'aborted_by_caller'`.
- Change `executionPhase` type from `notNull()` to nullable.
- Add TypeScript types for `AbortReason`.

See §19 Contracts for the full updated TypeScript types.

### 6.2 `cost_aggregates` schema additions (migration 0181)

One new value in the `entity_type` text field. No structural change; the upsert key (`entity_type, entity_id, period_type, period_key`) remains unique and unchanged.

**Migration file:** `migrations/0181_cost_aggregates_source_type_dimension.sql`

```sql
-- No DDL required; entity_type is a text column. Documentation only.
COMMENT ON COLUMN cost_aggregates.entity_type IS
  'organisation | subaccount | run | agent | task_type | provider | platform | execution_phase | source_type | feature_tag';
```

**Service change:** [server/services/costAggregateService.ts](server/services/costAggregateService.ts) — `upsertAggregates()` adds two new dimension writes per ledger row:

- One row keyed by `entity_type='source_type', entity_id=<sourceType value>`.
- One row keyed by `entity_type='feature_tag', entity_id=<featureTag value>`.

Both follow the same daily/monthly/minute/hour period-type pattern as the existing dimensions. The `cleanOldAggregates()` job continues to purge minute/hour rows after 2h for these new dimensions too — no change required.

**Why no new column on `cost_aggregates`?** `entity_type` + `entity_id` is already polymorphic. Adding the new dimensions is a write-path change only; the table shape accommodates them natively.

### 6.3 Polymorphic attribution columns — worked example

For a skill-analyzer classify call post-migration:

```sql
INSERT INTO llm_requests (
  idempotency_key, organisation_id, source_type, source_id,
  feature_tag, provider, model, task_type, execution_phase,
  ...tokens, cost, status...
) VALUES (
  'idem-<hash>', <org-uuid>, 'analyzer', <skill_analyzer_jobs.id>,
  'skill-analyzer-classify', 'anthropic', 'claude-sonnet-4-6', 'general', NULL,
  ...
);
```

Query "show me all LLM spend on analyzer runs for org X":

```sql
SELECT SUM(cost_with_margin) FROM llm_requests
WHERE organisation_id = $1
  AND source_type = 'analyzer'
  AND billing_month = $2;
```

Query "link analyzer ledger rows back to their job":

```sql
SELECT r.*, j.source_type AS job_source_type, j.created_at AS job_created
FROM llm_requests r
LEFT JOIN skill_analyzer_jobs j ON r.source_id = j.id AND r.source_type = 'analyzer'
WHERE r.feature_tag LIKE 'skill-analyzer-%'
ORDER BY r.created_at DESC;
```

Note the JOIN has no referential integrity — if the analyzer job is deleted, ledger rows survive (financial audit requirement) and `j.source_type` comes back NULL. That is the intended behaviour.

### 6.4 New statuses + parse-failure excerpt — capture rules

**Status + `abort_reason` mapping (written by the adapter error mapper, recorded by the router):**

- `AbortController.abort('caller_timeout')` fires from caller code (timeout path) → `status = 'aborted_by_caller'`, `abort_reason = 'caller_timeout'`.
- `AbortController.abort('caller_cancel')` or bare `abort()` fires from caller code (user-cancel path) → `status = 'aborted_by_caller'`, `abort_reason = 'caller_cancel'`.
- `fetch` throws a network error and response was mid-body when the socket RST'd (no `AbortError`) → `status = 'client_disconnected'`, `abort_reason` NULL (we don't know which side initiated).
- The provider returns HTTP 499 (rare but possible via OpenRouter or some proxies) → `status = 'client_disconnected'`, `abort_reason = 'caller_timeout'` if the call was aborted by us with that reason, else NULL.

**`parse_failure`** is written by the caller (router or adapter callsite) when:

- The LLM returned a 200 OK with valid JSON at the HTTP layer.
- The caller's post-processing (e.g. `skillAnalyzerServicePure.parseClassificationResponseWithMerge`) couldn't parse the content into the expected schema.
- `withBackoff` retried up to `maxAttempts`, exhausted retries, and the final attempt still parse-failed.

For `parse_failure` rows, `parse_failure_raw_excerpt` is populated with the **last** attempted response's `content` field, truncated to 2 KB (UTF-8-safe truncation — break at the last complete code point, don't produce invalid UTF-8). If shorter than 2 KB, stored as-is.

**Rationale for 2 KB:** big enough to see the structural shape of the malformed response (~500 tokens ≈ 6-10 lines of broken JSON), small enough that even millions of parse failures in a quarter don't bloat storage to GBs. The excerpt is for debugging, not reconstruction.

**What about the full response?** Intentionally not stored. `responsePayloadHash` remains the immutable proof-of-content field. If someone needs the full body, the Anthropic console has it via the `providerRequestId`.

### 6.5 Idempotency key scheme for new source types

Existing `generateIdempotencyKey()` at [llmRouter.ts:77-97](server/services/llmRouter.ts#L77) composes from:

```
organisationId : (runId ?? executionId ?? 'system') : agentName ?? 'no-agent' : taskType : provider : model : messageHash
```

For new `sourceType = 'analyzer'` calls, the router must change this to:

```
organisationId : (runId ?? executionId ?? ieeRunId ?? sourceId ?? 'system') : agentName ?? featureTag ?? 'no-agent' : taskType : provider : model : messageHash
```

The substitution `featureTag ?? 'no-agent'` when `agentName` is null keeps idempotency deduplication meaningful for non-agent callers (two analyzer calls with the same message, same feature tag, same org should dedupe). Without `featureTag` in the key, all non-agent calls for an org would collide on `'no-agent'`.

### 6.6 Migration safety

Per `docs/spec-context.md` — `migration_safety_tests: defer_until_live_data_exists`. This migration does not require backfill:

- New columns are all nullable or have defaults.
- Existing rows in a pre-production dev DB already satisfy the new CHECK constraints by construction (the legacy `sourceType = 'system'` rows have null run/execution/iee IDs; agent_run rows have `runId` set; etc.), so the plain `ADD CONSTRAINT ... CHECK (...)` in §6.1 validates against existing rows immediately without risk of lockout. We do **not** use `NOT VALID` + deferred `VALIDATE CONSTRAINT` here — pre-production, immediate validation is the honest contract.
- If a legacy row turns out to violate the new CHECK at migration time, the migration fails cleanly and we fix the offending row (or the constraint) before retrying. Commit-and-revert covers this.

Pre-production means no staged rollout. Commit-and-revert is the rollback plan.

---

## 7. Router changes

**File:** [server/services/llmRouter.ts](server/services/llmRouter.ts)

### 7.1 `LLMCallContextSchema` additions

Extend the Zod schema at [llmRouter.ts:34-58](server/services/llmRouter.ts#L34):

```ts
const LLMCallContextSchema = z.object({
  // ...existing fields...

  // Polymorphic attribution for non-agent callers
  sourceId:             z.string().uuid().optional(),
  featureTag:           z.string().min(1).optional(),

  // System-caller policy (default is 'respect_routing')
  systemCallerPolicy:   z.enum(['respect_routing', 'bypass_routing']).default('respect_routing'),

  // Abort signal (not stored; only used for adapter plumbing)
  abortSignal:          z.instanceof(AbortSignal).optional(),
});
```

**Runtime validation logic** added to `routeCall()` after the existing IEE guards:

```ts
// Attribution invariant — matches the DB CHECK constraint
if (ctx.sourceType === 'analyzer') {
  if (!ctx.sourceId) {
    throw new RouterContractError('llmRouter: sourceId is required when sourceType="analyzer"');
  }
  if (ctx.runId || ctx.executionId || ctx.ieeRunId) {
    throw new RouterContractError('llmRouter: analyzer rows must not set agent/execution/iee FKs');
  }
}

// Feature tag hygiene
if (!ctx.featureTag) {
  logger.warn('llm_router_missing_feature_tag', {
    sourceType: ctx.sourceType,
    caller: new Error().stack?.split('\n')[3],
  });
}
```

### 7.2 System-caller policy (routing + budget)

Gate the existing model-resolution path on `systemCallerPolicy`:

```ts
if (ctx.systemCallerPolicy === 'bypass_routing') {
  effectiveProvider = ctx.provider ?? 'anthropic';
  effectiveModel = ctx.model ?? 'claude-sonnet-4-6';
  routingReason = 'forced';
  // Do NOT call resolveLLM() — caller has pinned model+provider.
} else {
  // Existing resolveLLM() path, unchanged.
}
```

**Budget bypass:** widen the return type of `budgetService.checkAndReserve()` (file: [server/services/budgetService.ts](server/services/budgetService.ts)) from `string` to `string | null` and add an early return:

```ts
async function checkAndReserve(ctx: LLMCallContext, conn?: TxOrDb): Promise<string | null> {
  // System-level work is unbudgeted; return null (no reservation).
  if (ctx.sourceType === 'system' || ctx.sourceType === 'analyzer') {
    return null;
  }
  // ...existing logic unchanged, returns a reservation id string...
}
```

Update `llmRouter.routeCall()`'s release path to tolerate `null`:

```ts
const reservationId = await budgetService.checkAndReserve(ctx, tx); // string | null
try {
  // ...perform call...
} catch (err) {
  if (reservationId !== null) {
    await budgetService.releaseReservation(reservationId, tx);
  }
  throw err;
}
```

See §19.10 for the updated contract.

**Implementation check required during build:** confirm that today's `checkAndReserve` has no existing caller relying on a non-null `string` return (it doesn't, because today every call path is budgeted). If a caller surfaces that DOES narrow, update it in P1 alongside this change.

### 7.3 Idempotency-key scheme

Update `generateIdempotencyKey()` at [llmRouter.ts:77-97](server/services/llmRouter.ts#L77) per §6.5. Order-sensitive change: the key format is new, so idempotency keys generated before and after this migration won't collide. Pre-production means no in-flight duplicate-detection concerns — but if they did exist, the right answer would be to include a schema version prefix (`v2:...`). We don't; the format just changes.

### 7.4 Margin multiplier for system + analyzer rows

`llmRouter.routeCall()` currently resolves `marginMultiplier` from the pricing service (typically `1.30` for billable work). For `sourceType ∈ {'system', 'analyzer'}` the row is not billable — there is no revenue to attach margin to. The router therefore overrides the resolved multiplier to `1.0` on that path:

```ts
const resolved = await pricingService.resolve(provider, model);
const marginMultiplier =
  ctx.sourceType === 'system' || ctx.sourceType === 'analyzer'
    ? 1.0
    : resolved.marginMultiplier;
```

With `marginMultiplier = 1.0`, `costWithMargin === costRaw` for those rows. The P&L page's "no revenue for system" assertion (§11.5) and the `SourceTypeRow.revenueCents: null` rendering in §19.5.2 both depend on this. If this branch is omitted, analyzer rows carry the default `1.30` multiplier and the P&L page reports phantom revenue for analyzer work.

### 7.5 What the router does NOT change

- No changes to `resolveLLM()` — pure model-selection logic stays the same for agent callers.
- No changes to `pricingService` — pricing is provider/model-keyed, not caller-keyed. The margin override in §7.4 is applied at the router level after pricing resolves, not inside `pricingService`.
- No changes to the Anthropic request-id capture path — already working, reused verbatim.
- No changes to fallback chain logic — provider fallback for analyzer calls works the same as for agent calls.

---

## 8. Adapter changes

**Files:** every adapter registered in `server/services/providers/registry.ts` — [server/services/providers/anthropicAdapter.ts](server/services/providers/anthropicAdapter.ts), [server/services/providers/openaiAdapter.ts](server/services/providers/openaiAdapter.ts), [server/services/providers/geminiAdapter.ts](server/services/providers/geminiAdapter.ts), [server/services/providers/openrouterAdapter.ts](server/services/providers/openrouterAdapter.ts).

All four adapters receive the same three changes (signal threading, 499 mapping, AbortError mapping) so A1's "universal observability" claim holds for every provider the registry exposes. §8.4 tracks adapter-by-adapter parity.

### 8.1 `AbortController` plumbing

**`ProviderCallParams` gains one field:**

```ts
export interface ProviderCallParams {
  // ...existing fields...
  signal?: AbortSignal;
}
```

**Adapter implementation (Anthropic):**

```ts
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify(body),
  signal: params.signal,   // NEW — threads the abort signal through
});
```

**Error mapping:** if `fetch` throws with `err.name === 'AbortError'`, the adapter reads the `AbortSignal.reason` to preserve the caller's intent (timeout vs manual cancel). This is the load-bearing mechanism that keeps `caller_timeout` and `caller_cancel` distinguishable — without it, every abort collapses to the same reason.

The caller uses `AbortController.abort(reason)` with one of the sentinel string values `'caller_timeout'` or `'caller_cancel'`. The adapter then maps:

```ts
if (err instanceof Error && err.name === 'AbortError') {
  // AbortSignal.reason carries whatever was passed to controller.abort(reason).
  // Convention: callers pass the string 'caller_timeout' or 'caller_cancel'.
  const reasonRaw = params.signal?.reason;
  const abortReason: 'caller_timeout' | 'caller_cancel' =
    reasonRaw === 'caller_timeout' ? 'caller_timeout' : 'caller_cancel';
  throw {
    statusCode: 499,
    code: 'CLIENT_DISCONNECTED',
    provider: 'anthropic',
    message: `Request aborted by caller (${abortReason})`,
    abortReason,
  };
}
```

The router catches this shape and records `status = 'aborted_by_caller'` with `abort_reason` set from `err.abortReason`.

**Caller convention (enforced by code review, not a runtime check):** callers that support timeout cancellation pass `abortController.abort('caller_timeout')` from their timeout handler, and pass `abortController.abort('caller_cancel')` (or a bare `abort()` which defaults to `caller_cancel`) from user-initiated cancellation paths. The analyzer migration in §10 wires the `caller_timeout` path exactly — it does not add a new UI-cancel hook. User-cancel (`caller_cancel`) remains a forward-looking abort-reason value in the CHECK constraint; wiring a UI/job-level cancel path into the analyzer's `AbortController` is deferred (§17).

**Router-side usage:** `routeCall()` passes `ctx.abortSignal` through to the adapter as `params.signal`. The analyzer migration (§10) creates an `AbortController` per classify call and wires it up.

### 8.2 HTTP 499 detection + `client_disconnected` mapping

HTTP 499 is rare in direct provider calls (Anthropic doesn't emit it), but can surface via OpenRouter or corporate proxies. Add the mapping defensively:

```ts
if (response.status === 499) {
  throw {
    statusCode: 499,
    code: 'CLIENT_DISCONNECTED',
    provider: 'anthropic',
    message: `Client disconnected: ${errorDetail}`,
  };
}
```

### 8.3 Parse-failure excerpt capture

This is **not an adapter change** — the adapter returns the raw content string. The parse-failure excerpt is captured at the caller site (router or caller of router). Specifically:

**Pattern for structured-output callers** (the analyzer, workspace-memory, future callers):

```ts
try {
  const response = await llmRouter.routeCall({ /* ... */ });
  const parsed = parseResponseWithSchema(response.content);
  if (parsed === null) {
    // Parse failure — record the excerpt
    throw new ParseFailureError({
      status: 'parse_failure',
      rawExcerpt: truncateUtf8Safe(response.content, 2048),
    });
  }
  return parsed;
} catch (err) {
  // The router writes the llm_requests row with parse_failure status
  // and rawExcerpt populated. Caller re-raises for control flow.
  throw err;
}
```

**Router-side change:** `routeCall()` catches `ParseFailureError` from a caller-supplied post-processor hook. Since the current router doesn't have such a hook, this spec adds one:

```ts
export interface RouterCallParams {
  // ...existing fields...
  /** If provided, runs after response is received. Throwing ParseFailureError
   *  causes the router to record status='parse_failure' + rawExcerpt and
   *  re-throw for caller control flow. */
  postProcess?: (content: string) => void;
}
```

For the analyzer, `postProcess` wraps `parseClassificationResponseWithMerge` and throws `ParseFailureError` with the truncated raw excerpt when the parse returns null.

**Why at the router, not the adapter?** The adapter doesn't know the caller's schema. The router doesn't either, but it owns the ledger write — so the right split is: caller supplies the post-processor; router owns the record.

### 8.4 Parity across adapters

All four registered adapters get identical updates in P1:

| Adapter | File | Signal threading | 499 mapping | AbortError + reason mapping |
|---|---|---|---|---|
| Anthropic | `server/services/providers/anthropicAdapter.ts` | Yes | Yes | Yes |
| OpenAI | `server/services/providers/openaiAdapter.ts` | Yes | Yes | Yes |
| Gemini | `server/services/providers/geminiAdapter.ts` | Yes | Yes | Yes |
| OpenRouter | `server/services/providers/openrouterAdapter.ts` | Yes | Yes | Yes |

The three changes are:

- `signal` param threading through `fetch` (§8.1)
- `AbortError → 499 CLIENT_DISCONNECTED` mapping that reads `AbortSignal.reason` to preserve `caller_timeout` vs `caller_cancel` (§8.1)
- HTTP 499 → CLIENT_DISCONNECTED mapping (§8.2)

The pattern is mechanical and identical across all four adapters. If any adapter lacks a discrete error-mapping seam today, P1 adds one so the shape (`{statusCode, code, provider, message, abortReason?}`) is consistent across the fleet. The router only has to understand one error shape.

All four adapters already produce `ProviderResponse` with the same shape (`content`, `tokensIn`, `tokensOut`, `stopReason`, `providerRequestId`) — no additions needed there.

**Why all four, not just the two analyzer-relevant ones:** A1 in §1.2 makes a universal-observability claim gated by `verify-no-direct-adapter-calls.sh`. If the gate and the adapter changes only cover two providers, a future caller of `geminiAdapter` or `openrouterAdapter` could silently bypass the ledger and A1 would hold false. Universal means universal — §1.1 sets this expectation, so P1 delivers it for every provider currently in the registry.

### 8.5 What the adapter layer does NOT change

- No changes to the fetch URL, headers, or request body shape — wire format is identical.
- No changes to cost math — `tokensIn/Out` capture stays as-is.
- No changes to prompt-caching behaviour — cache_control breakpoints on the Anthropic adapter stay verbatim.
- No new adapter added — this spec is additive to the four adapters already registered in `server/services/providers/registry.ts`.

---

## 9. Direct-adapter caller sweep

### 9.1 Methodology

Run targeted greps across every registered provider adapter — the four files in `server/services/providers/registry.ts` — to enumerate every file outside `server/services/llmRouter.ts` and `server/services/providers/*.ts` that calls an adapter directly:

```bash
# Direct adapter imports (all four providers)
grep -rnE "from.*providers/(anthropic|openai|gemini|openrouter)Adapter" server/ --include='*.ts' \
  | grep -v 'llmRouter.ts' | grep -v '/providers/' | grep -v '\.test\.ts'

# Explicit call sites (all four providers)
grep -rnE "(anthropicAdapter|openaiAdapter|geminiAdapter|openrouterAdapter)\.call" server/ --include='*.ts' \
  | grep -v 'llmRouter.ts' | grep -v '/providers/' | grep -v '\.test\.ts'
```

Each hit is a caller that bypasses the ledger. If `server/services/providers/registry.ts` gains a fifth adapter later, the grep patterns and the gate whitelist are updated together — see §9.4.

### 9.2 Known hits (at time of spec authoring)

Based on conversation-time reconnaissance:

| File | Lines | What it does | Action |
|---|---|---|---|
| `server/jobs/skillAnalyzerJob.ts` | 768, 1321, 1459 | Classify call, Haiku agent-match, Sonnet cluster-recommend | Migrate (§10.1, §10.2, §10.3) |
| `server/services/skillAnalyzerService.ts` | 2063 | Analyzer service-layer direct adapter call | Migrate (§10.4) |

All four analyzer subsystem sites are migrated in P3. A1 in §1.2 is verifiable only after this phase: the static gate at §9.4 removes every analyzer file from its whitelist once P3 lands.

Other potential callers need confirmation during Phase 2. Candidates to verify:

- `server/services/workspaceMemoryService.ts` — HyDE query expansion + context enrichment (already routes through the router per `llmRequests.taskType` values `hyde_expansion` + `context_enrichment`, but this needs confirmation).
- `server/services/beliefExtractionService.ts` or equivalent — agent-beliefs extraction (taskType `belief_extraction` exists, likely routed).

Any caller confirmed as bypassing during the Phase 2 audit is either migrated in the same phase (if small) or documented as Phase 5 cleanup in §15.

### 9.3 Remediation pattern

Every migrated caller follows the same shape:

**Before:**
```ts
const response = await anthropicAdapter.call({
  model: 'claude-sonnet-4-6',
  system: '...',
  messages: [...],
  maxTokens: 8192,
  temperature: 0.1,
});
```

**After:**
```ts
const response = await llmRouter.routeCall({
  system: '...',
  messages: [...],
  maxTokens: 8192,
  temperature: 0.1,
  context: {
    organisationId: job.organisationId,
    sourceType: 'analyzer',               // or 'system' for truly non-attributable
    sourceId: job.id,                     // polymorphic FK
    featureTag: 'skill-analyzer-classify',
    taskType: 'general',
    systemCallerPolicy: 'bypass_routing', // opt-out of auto-routing (analyzer pins Sonnet)
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    abortSignal: abortController.signal,
  },
});
```

The migration is mechanical. The only judgment calls per caller are:

1. `sourceType` — use `'analyzer'` for analyzer work, `'system'` for anything else non-attributable.
2. `featureTag` — kebab-case unique identifier.
3. `systemCallerPolicy` — `'bypass_routing'` if the caller has a specific model pinned; `'respect_routing'` (default) if the caller is OK with router-selected models.

### 9.4 Static gate — `verify-no-direct-adapter-calls.sh`

**File:** `scripts/gates/verify-no-direct-adapter-calls.sh` (new)

**Behaviour:**

- Greps the same patterns as §9.1 — covering every adapter registered in `server/services/providers/registry.ts` (today: `anthropic`, `openai`, `gemini`, `openrouter`).
- Exits non-zero if any hit is found outside the whitelist (`server/services/llmRouter.ts`, `server/services/providers/*.ts`, any `*.test.ts` or `*.test.tsx`).
- Registered in `scripts/run-all-gates.sh` so CI fails on regression.
- Whitelist lives at the top of the script as an explicit bash array — no config file, no env vars.
- Adapter list lives at the top of the script as a separate bash array. When a new provider adapter is added, the array is updated in the same commit — the gate auto-expands its grep patterns from the array.

Prevents the next contributor from re-introducing the pattern the whole spec is designed to eliminate, across every provider adapter the registry exposes.

---

## 10. Skill-analyzer migration

The analyzer is the proof-of-concept consumer. After this phase, every analyzer LLM call shows up in the ledger.

### 10.1 Classify call — `skillAnalyzerJob.ts:768`

Current state (3-way direct call wrapped in `withBackoff`):

```ts
const response = await anthropicAdapter.call({
  model: 'claude-sonnet-4-6',
  system, messages: [{ role: 'user', content: userMessage }],
  maxTokens: 8192, temperature: 0.1,
});
const parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
```

Target state:

```ts
const abortController = new AbortController();
// Pass 'caller_timeout' as the reason so the adapter can distinguish
// "analyzer-side timeout" from "user-initiated cancel" (see §8.1).
const timeoutId = setTimeout(
  () => abortController.abort('caller_timeout'),
  SKILL_CLASSIFY_TIMEOUT_MS,
);

try {
  const response = await llmRouter.routeCall({
    system,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 8192,
    temperature: 0.1,
    context: {
      organisationId: job.organisationId,
      sourceType: 'analyzer',
      sourceId: job.id,
      featureTag: 'skill-analyzer-classify',
      taskType: 'general',
      systemCallerPolicy: 'bypass_routing',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      abortSignal: abortController.signal,
    },
    postProcess: (content) => {
      const parsed = skillAnalyzerServicePure.parseClassificationResponseWithMerge(content);
      if (parsed === null) {
        throw new ParseFailureError({
          rawExcerpt: truncateUtf8Safe(content, 2048),
        });
      }
    },
  });
  return skillAnalyzerServicePure.parseClassificationResponseWithMerge(response.content);
} finally {
  clearTimeout(timeoutId);
}
```

Replace the existing `Promise.race([withBackoff(...), timeoutPromise])` pattern with the `AbortController` pattern — they do the same thing, but the latter actually kills the underlying fetch (see §2.3).

**`withBackoff` retention:** `routeCall` internally uses its own retry strategy via the router's fallback-chain logic. The analyzer's current `maxAttempts: 3` for parse failures specifically is handled by the `postProcess` hook re-throwing `ParseFailureError`, which the router's retry policy classifies as retryable (same classification the analyzer uses today — 429, 503, 529, PARSE_FAILURE).

### 10.2 Haiku agent-suggestion call — `skillAnalyzerJob.ts:1321`

Similar migration. Different `featureTag` (`skill-analyzer-agent-match`), different model (`claude-haiku-4-5-20251001`), same general shape.

### 10.3 Sonnet cluster-recommendation call — `skillAnalyzerJob.ts:1459`

Third migration. `featureTag: 'skill-analyzer-cluster-recommend'`. Same shape.

### 10.4 Service-layer call — `skillAnalyzerService.ts:2063`

Fourth migration. Same mechanical shape as §10.1–§10.3. Replace the direct `anthropicAdapter.call()` invocation at `server/services/skillAnalyzerService.ts:2063` with `llmRouter.routeCall()`.

- `sourceType: 'analyzer'`.
- `sourceId` — `skill_analyzer_jobs.id` of the enclosing analyzer job. Per the analyzer-row invariant in §6.3, `sourceType='analyzer'` means `llm_requests.source_id` joins cleanly to `skill_analyzer_jobs.id`; all four analyzer sites (three job-layer, one service-layer) must honour that invariant so the P&L page's drawer link-back to the job works deterministically. If the call site does not have a job id in scope today, thread one through from the job that invokes the service (every code path that reaches `skillAnalyzerService.ts:2063` is started by a `skillAnalyzerJob.ts` run, so the id is available upstream).
- `featureTag` — pick a stable kebab-case tag that distinguishes this site from the three job-layer sites (e.g. `skill-analyzer-service-<operation>`, where `<operation>` reflects the specific call the service is making; the exact tag is chosen at implementation time once the site's context is in hand).
- `systemCallerPolicy` — `'bypass_routing'` if the site pins a specific model today; otherwise `'respect_routing'`.
- Thread the existing `AbortController` / `AbortSignal` through to `llmRouter.routeCall()` per §8.1.

### 10.5 Verification

After the four migrations, run the analyzer end-to-end on a test import and verify:

1. `SELECT COUNT(*) FROM llm_requests WHERE feature_tag LIKE 'skill-analyzer-%' AND created_at > <before_test>` returns a non-zero count roughly equal to the number of candidates × number of LLM calls per candidate (summed across the three job-layer sites and the service-layer site from §10.4).
2. Cross-check `providerRequestId` values against the Anthropic console — every row's provider_request_id should match an entry in Anthropic's log (within a tolerance for the specific request).
3. `SELECT SUM(cost_with_margin) FROM llm_requests WHERE feature_tag LIKE 'skill-analyzer-%' AND billing_month = '2026-MM'` gives a non-zero total that appears in `cost_aggregates` rolled up under `entity_type = 'feature_tag'`.
4. Let a classify timeout via its existing `SKILL_CLASSIFY_TIMEOUT_MS` path and verify the resulting ledger row carries `status = 'aborted_by_caller'` and `abort_reason = 'caller_timeout'`.
5. Simulate a parse failure by temporarily breaking the schema validator and verify `parseFailureRawExcerpt` is populated ≤2 KB.

Verification is manual during Phase 3 rollout. `docs/spec-context.md` precludes automated runtime test suites for this kind of flow.

---

## 11. System P&L page

**Reference UI:** [prototypes/system-costs-page.html](prototypes/system-costs-page.html) — the committed high-fidelity mockup is the authoritative visual and interaction specification. Every production component in this section matches that mockup's structure, column order, status-row treatment, and interaction patterns.

### 11.1 Route + permissions

**Route:** `/system/llm-pnl` (client-side)
**API base:** `/api/admin/llm-pnl/*`

**Permissions:**
- Gated by `requireSystemAdmin` middleware at [server/routes/llmUsage.ts](server/routes/llmUsage.ts) pattern.
- Cross-org by design — this is the *one* admin surface that intentionally reads across every organisation.
- No new permission key (`system_usage_view`) introduced; reuses the existing `requireSystemAdmin` check from the system routes suite.

**Client-side route registration** in [client/src/App.tsx](client/src/App.tsx) — add under the existing `/system/*` route group. Lazy-loaded like every other system page per `architecture.md` client-side conventions.

### 11.2 Service layer

**File:** `server/services/systemPnlService.ts` (new)

Methods:

```ts
export const systemPnlService = {
  /** KPIs for a given period. */
  getPnlSummary(period: { from: Date; to: Date }): Promise<PnlSummary>,

  /** Grouping: by organisation. Returns up to N rows sorted by cost desc, plus a synthetic
   *  aggregated overhead row (sum of system + analyzer cost across all orgs). */
  getByOrganisation(period, limit?: number, filters?: OrgFilters): Promise<{ orgs: OrgRow[]; overhead: OverheadRow }>,

  /** Grouping: by subaccount. Flat list across all orgs. */
  getBySubaccount(period, limit?: number, filters?: SubacctFilters): Promise<SubacctRow[]>,

  /** Grouping: by sourceType. 5 rows (agent_run / process_execution / iee / system / analyzer). */
  getBySourceType(period): Promise<SourceTypeRow[]>,

  /** Grouping: by provider + model. */
  getByProviderModel(period): Promise<ProviderModelRow[]>,

  /** 30-day daily trend (revenue + cost + profit + system overhead). */
  getDailyTrend(days: number): Promise<DailyTrendRow[]>,

  /** Top N individual calls by cost in the period (ORDER BY cost_raw DESC). Includes
   *  non-billable rows (sourceType ∈ {'system','analyzer'}) whose revenue is null —
   *  the list is a platform-overhead debugging surface, not a revenue leaderboard. */
  getTopCalls(period, limit: number): Promise<TopCallRow[]>,

  /** Full detail for one llm_requests row. */
  getCallDetail(id: string): Promise<CallDetail>,
};
```

**Data source per method:** `cost_aggregates` only carries scalar `totalCost*`, `totalTokens*`, `requestCount`, `errorCount` keyed by `(entityType, entityId, periodType, periodKey)`. Several P&L methods need data the aggregate table does not carry — avg latency, provider+model composite keys, distinct-org counts per `sourceType`, and per-row sparklines. The split is therefore:

| Method | Primary source | Why |
|---|---|---|
| `getPnlSummary` | `cost_aggregates` (period + platform totals) | KPI numbers are scalar sums already denormalised |
| `getByOrganisation` | `cost_aggregates` for the scalar columns + per-org sparkline values read from 30 daily rows; `subaccountCount` JOINed from `subaccounts` table | Aggregate carries the money math; subaccount count is a cheap JOIN; sparkline is 30 daily aggregate reads per org |
| `getBySubaccount` | `cost_aggregates` (entity_type='subaccount') + `subaccounts` for org-name JOIN | Same pattern as org tab |
| `getBySourceType` | `cost_aggregates` (entity_type='source_type') **plus** `llm_requests` for distinct-org and subaccount counts | Aggregate doesn't carry distinct-org counts per source_type; cheap enough to aggregate live from `llm_requests` because source_type cardinality is tiny |
| `getByProviderModel` | `llm_requests` live — GROUP BY `(provider, model)` with AVG(providerLatencyMs) | Aggregate has no `provider+model` composite key nor any latency column. For the 30-day window this is a bounded scan (indexed by `provider, model, billingMonth`). If the query cost becomes load-bearing later, extend `cost_aggregates` with a `provider_model` entity_type + an `avg_latency_ms` column — deferred for now. |
| `getDailyTrend` | `cost_aggregates` (entity_type='platform', periodType='daily') | Platform daily totals are already denormalised |
| `getTopCalls` | `llm_requests` directly | Per-row granularity, `cost_aggregates` cannot answer. `ORDER BY cost_raw DESC` — see docstring above for why ranking is by cost, not revenue. |
| `getCallDetail` | `llm_requests` (+ `llm_requests_archive` UNION post-P5) directly | Per-row granularity |

**Caching:** no application-layer cache. `cost_aggregates` is pre-aggregated and sub-100ms under the composite index; the `llm_requests` live reads are bounded by indexed scans on `(organisation_id, billing_month)` / `(provider, model, billing_month)` and are sub-500ms at expected volumes. Revisit caching in a follow-up only if latency becomes visible.

**Principal context:** admin reads bypass RLS via the existing `withAdminConnection` primitive at [server/lib/adminDbConnection.ts](server/lib/adminDbConnection.ts). This is a deliberate cross-tenant read, authorised by `requireSystemAdmin`.

### 11.3 API endpoints

All routes live in `server/routes/systemPnl.ts` (new), mounted under `/api/admin/llm-pnl/*`.

**Response envelope:** every endpoint returns the `{data, meta}` wrapper defined in §19.9. The "Returns" column below names the TypeScript type of the `data` payload only — `meta` is uniform across every route (`period`, `generatedAt`, `ledgerRowsScanned`).

| Method | Path | `data` payload type | Purpose |
|---|---|---|---|
| GET | `/summary?month=YYYY-MM` | `PnlSummary` | 4 KPI cards data |
| GET | `/by-organisation?month=YYYY-MM&limit=N` | `{ orgs: OrgRow[]; overhead: OverheadRow }` | Tab 1 |
| GET | `/by-subaccount?month=YYYY-MM&limit=N` | `SubacctRow[]` | Tab 2 |
| GET | `/by-source-type?month=YYYY-MM` | `SourceTypeRow[]` | Tab 3 |
| GET | `/by-provider-model?month=YYYY-MM` | `ProviderModelRow[]` | Tab 4 |
| GET | `/trend?days=30` | `DailyTrendRow[]` | Chart |
| GET | `/top-calls?month=YYYY-MM&limit=10` | `TopCallRow[]` | "Top calls by cost" list (bottom-of-page) |
| GET | `/call/:id` | `CallDetail` | Detail drawer |

Every route: `requireSystemAdmin` → service method → JSON response. `asyncHandler` wraps each handler per architecture convention.

### 11.4 Page components

**File tree:**

```
client/src/pages/SystemPnlPage.tsx
client/src/components/system-pnl/
  PnlKpiCard.tsx
  PnlGroupingTabs.tsx
  PnlByOrganisationTable.tsx
  PnlBySubaccountTable.tsx
  PnlBySourceTypeTable.tsx
  PnlByProviderModelTable.tsx
  PnlTrendChart.tsx
  PnlTopCallsList.tsx
  PnlCallDetailDrawer.tsx
  PnlMarginPill.tsx
  PnlSparkline.tsx
  PnlColHeader.tsx                // reused patterns from SystemSkillsPage
```

Page layout matches the mockup:

1. Header with freshness indicator, month selector, Export CSV, Clear all
2. 4 KPI cards in a 4-col grid (`.kpi-grid`)
3. Grouping tabs (segmented control)
4. Active table view (one of four)
5. Trend chart
6. Top calls list

**Data fetching:** React Query (`useQuery`) per endpoint. Keys are `['systemPnl', tab, month]` / `['systemPnl', 'trend', days]` etc. `staleTime: 60_000` and `refetchInterval: 60_000` — the page auto-refetches every 60 seconds, matching the mockup's "updated every 60 seconds" footer claim verbatim.

**State management:**
- Active tab: local state (`useState`).
- Period: local state, defaults to current month.
- Filters per column: local state, cleared by the "Clear all" button.

No global store needed; this is a leaf page.

### 11.4.1 Controls implemented in P4

The mockup shows several controls the operator can interact with. Each is either specified here with a concrete P4 implementation, or explicitly marked **decorative** so no implementation work is required.

| Control | Mockup location | P4 behaviour |
|---|---|---|
| **Auto-refresh ("updated every 60 seconds")** | Footer copy on line 1141 of the mockup | **Real.** React Query uses `refetchInterval: 60_000` across all `/api/admin/llm-pnl/*` queries. Footer copy is accurate. |
| **Refresh button** | Top-right of page header (mockup line 137) | **Real.** Manual `queryClient.invalidateQueries(['systemPnl'])` — forces immediate refetch of all P&L queries. |
| **Export CSV button** | Top-right of page header (mockup line 156) | **Real, client-side only.** Clicking the button serialises the currently-visible tab's React Query cache to CSV and triggers a browser download. No new API endpoint. Implementation is a ~30-line client-side helper (`exportTabAsCsv(tab, rows)`); columns match the rendered table verbatim. Scope: the active tab's rows at the current filter/sort. |
| **View all (in "Top calls by cost" header)** | Mockup line 994 | **Real, as an anchor scroll + limit bump.** Clicking sets the client-side `topCallsLimit` state from 10 to 50 and smooth-scrolls to the top of the Top-calls section. No new page, no new route. "All" means "up to 50 in the current period," not "every row ever." |
| **Footer link — "Margin policies"** | Mockup line 1144 | **Decorative.** Rendered as a `<span>` styled like a link but with no `href` and no click handler. Real destination deferred — see §17. |
| **Footer link — "Retention"** | Mockup line 1145 | **Decorative.** Same treatment as "Margin policies." Real destination deferred — see §17. |
| **Footer link — "Billing rules"** | Mockup line 1146 | **Decorative.** Same treatment as "Margin policies." Real destination deferred — see §17. |

Rationale: the mockup makes visible commitments to the operator. Refresh, Export CSV, View all, and the 60s auto-refresh are cheap to honour with client-side-only work and the mockup would feel broken without them. Admin-only footer destinations (`Margin policies`, `Retention`, `Billing rules`) would balloon P4 scope into a multi-page admin suite — decorative-for-now is the cheapest honouring of the mockup's visual intent without committing P4 to pages that don't yet exist.

### 11.5 Column contracts per tab

See §19 Contracts for the full TypeScript types. Column order matches the mockup verbatim. Sort directions default to cost-descending. Filter UI on every column header follows the `ColHeader` dropdown pattern.

| Tab | Columns | Sort default |
|---|---|---|
| By Organisation | Organisation \| Subaccounts \| Requests \| Revenue \| Cost \| Profit \| Margin \| % of Revenue \| Trend | Cost desc |
| By Subaccount | Subaccount \| Organisation \| Requests \| Revenue \| Cost \| Profit \| Margin \| % of Revenue | Cost desc |
| By Source Type | Source Type \| Orgs \| Requests \| Revenue \| Cost \| Profit \| Margin \| % of Cost | Cost desc |
| By Provider / Model | Provider \| Model \| Requests \| Revenue \| Cost \| Profit \| Margin \| Avg Latency \| Share of Cost | Cost desc |

**Overhead row treatment (applied wherever an overhead row renders):**
- Revenue: em-dash
- Profit: negative cost, displayed in muted slate-500 with a minus sign
- Margin: "overhead" badge instead of percentage
- Pulled out visually with a subtle indigo background

**Which tabs render overhead rows** (matches `prototypes/system-costs-page.html`):

| Tab | Overhead treatment |
|---|---|
| By Organisation | One synthetic aggregated overhead row (labelled `Overhead · Platform background work`) that sums `system` + `analyzer` cost across every org. The By Subaccount tab slices by a different dimension; see below. |
| By Subaccount | No overhead row. Subaccount grouping has no natural home for platform-wide overhead (overhead has no subaccount), so the tab renders only subaccount rows. Aggregate overhead is visible via the Platform overhead KPI card and the `By Source Type` and `By Organisation` tabs. |
| By Source Type | Two overhead rows — `system` and `analyzer` — rendered as separate rows per §19.5.2. |
| By Provider / Model | No overhead row. Platform overhead crosses provider/model lines; splitting it by provider would add noise without observability win. Aggregate overhead is visible elsewhere. |

On `By Source Type`, both `system` and `analyzer` render as overhead rows per the treatment above. The schema-level split between `system` and `analyzer` (added in §6.1) is preserved here so operators can see analyzer spend at a glance instead of hiding it behind a single "System" line.

**Totals row at the bottom of each table:**
- Rev/Cost/Profit: summed across all visible rows including every overhead row rendered on that tab
- Margin: computed as net margin (profit/revenue) or noted as "net" if including overhead rows

### 11.6 Detail drawer

**Opens on:** clicking any row in "Top calls by cost."

**Fields shown:**
- Provider request ID (copyable)
- Idempotency key
- Full error message + code (if non-success)
- Token breakdown (input, output, cached prompt tokens)
- Latency breakdown (router overhead + provider latency)
- Fallback chain (JSON-decoded from the column)
- Retry attempt number
- `parseFailureRawExcerpt` rendered in a monospace block if non-null
- Links back to: originating run (if `runId` is non-null — agent-run rows only), job (if `sourceId` is non-null — analyzer rows only today), organisation (if `organisationId` is non-null), subaccount (if `subaccountId` is non-null). Overhead rows (`sourceType ∈ {'system','analyzer'}`) render the organisation and subaccount link rows only when non-null, per the §19.6 nullability contract.
- "Copy as support ticket" button — formats provider_request_id + model + error into a block suitable for pasting into an Anthropic support ticket

**Scope note:** rich-state interactions on the drawer (filter-by-request-ID inline, keyboard nav) are **deferred** — see §17. Base drawer ships with Phase 4.

### 11.7 What the page does NOT do (scope discipline)

- Not a billing dashboard — no invoice generation, no payment reconciliation.
- Not a forecasting tool — no "projected monthly cost" figures.
- Not a per-user drill-down — user-level cost views live on the existing Usage page.
- Not an anomaly alert surface — "Platform overhead >15% of revenue for 3 days" alerting is deferred (§17).
- Not a replacement for the existing Usage page — that page remains the subaccount-scoped view for org admins. The P&L page is platform-admin-only.

---

## 12. Retention policy for `llm_requests`

### 12.1 Problem

`llm_requests` grows unbounded by design — it's a financial audit ledger. At steady-state with live clients, conservative estimate is 50,000–200,000 rows per month per paying org. With 10 paying orgs, that's ~2M rows/month, ~24M rows/year. Each row is ~1 KB (mostly hashes + numeric), so ~24 GB/year. Manageable but not trivial, and the indexes on this table multiply storage.

**The purpose of retention is NOT cost reduction.** It is:
- Faster queries on the hot path (last 90 days is what dashboards actually read).
- Cleaner index rebuilds (smaller indexes rebuild faster on migration).
- Operational safety: a single runaway analyzer run can't DoS the ledger.

### 12.2 Decision

**Keep full detail rows in `llm_requests` for `env.LLM_LEDGER_RETENTION_MONTHS` months (default 12).** After that, move rows to `llm_requests_archive` (same shape, subset of indexes).

**`cost_aggregates` rollups are kept forever.** Daily rollups are tiny (one row per org per day per dimension — thousands of rows total, not millions) and power the long-term financial reports.

### 12.3 `llm_requests_archive` (migration 0183)

Shape: identical to `llm_requests` at migration time. Drizzle schema: share a common type shape, two Drizzle tables.

Indexes: only the ones needed for occasional lookup by support/compliance:

- `idempotency_key` — for proof-of-billing queries.
- `provider_request_id` — for Anthropic support tickets.
- `organisation_id, billing_month` — for "show me all calls for this org in 2026" support flows.

**Not copied to archive:** partial indexes on `status`, `execution_phase`, `execution_id`, `feature_tag`. These are dashboard-hot; archived data doesn't need them.

### 12.4 `llm-ledger-archive` job (new pg-boss job)

**Files:**
- `server/jobs/llmLedgerArchiveJob.ts` (new) — the job orchestration + DB transaction loop (impure).
- `server/jobs/llmLedgerArchiveJobPure.ts` (new) — pure helpers extracted out of the job for testability. Exports `computeArchiveCutoff(retentionMonths, now)`.

**Schedule:** nightly at 03:00 UTC (pg-boss cron).

**Pure helper (`llmLedgerArchiveJobPure.ts`):**

```ts
/**
 * Cutoff for archive-eligibility: rows strictly older than `retentionMonths`
 * calendar months before `now` are moved to the archive table.
 *
 * `now` is injected for test determinism; the caller passes `new Date()` at
 * runtime. Uses `setMonth(getMonth() - n)` rather than day arithmetic so the
 * cutoff tracks month boundaries rather than a naive 30-day window.
 */
export function computeArchiveCutoff(retentionMonths: number, now: Date): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);
  return cutoff;
}
```

The corresponding test at `server/jobs/__tests__/ledgerArchivePure.test.ts` (§14.8a) exercises this helper directly — no DB, no mocks.

**Shape (`llmLedgerArchiveJob.ts`):**

```ts
export async function archiveOldLedgerRows(): Promise<ArchiveResult> {
  const cutoff = computeArchiveCutoff(env.LLM_LEDGER_RETENTION_MONTHS, new Date());

  // Move rows in 10k-row chunks to bound transaction size.
  // Postgres does NOT support `DELETE ... ORDER BY ... LIMIT` directly, so we
  // pick ids with a separate SELECT first (cheap because `created_at` is indexed),
  // then copy + delete those specific ids. Using `FOR UPDATE SKIP LOCKED`
  // keeps the job safe under concurrent runs (though the nightly cadence
  // makes concurrency very unlikely).
  let totalMoved = 0;
  for (;;) {
    const moved = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        WITH doomed AS (
          SELECT id
          FROM llm_requests
          WHERE created_at < ${cutoff}
          ORDER BY created_at
          LIMIT 10000
          FOR UPDATE SKIP LOCKED
        ),
        inserted AS (
          INSERT INTO llm_requests_archive
          SELECT * FROM llm_requests
          WHERE id IN (SELECT id FROM doomed)
          RETURNING id
        )
        DELETE FROM llm_requests
        WHERE id IN (SELECT id FROM inserted)
        RETURNING 1;
      `);
      return result.rowCount ?? 0;
    });
    totalMoved += moved;
    if (moved < 10000) break;
  }
  return { totalMoved, cutoff };
}
```

**Safety:**

- CTE with `DELETE ... RETURNING` + `INSERT` in a single transaction means a row is either in `llm_requests` OR in `llm_requests_archive`, never both, never neither.
- `ORDER BY created_at LIMIT 10000` bounds each transaction to ~10 MB.
- Job is idempotent — re-running it on the same day does nothing if the first run cleared the cutoff.

**Verification:**

- `getCallDetail(id)` reads from both tables (UNION ALL) transparently so detail drawer works for archived rows.
- `getTopCalls()` reads only `llm_requests` (the last 30 days are never archived).

### 12.5 Environment + config

**New env var:** `LLM_LEDGER_RETENTION_MONTHS` (default: `12`). Declared in [server/lib/env.ts](server/lib/env.ts).

No admin-facing config UI — this is an infrastructure tunable, not a business decision.

### 12.6 Deferred from retention (see §17)

- **`llm_requests_archive` further tiering** (e.g. "after 36 months, move to cold storage or dump to S3"). Not needed until data volume justifies it.
- **Per-org retention overrides.** If a client demands 5-year audit retention by contract, that's a commercial conversation handled outside this spec.

---

## 13. Permissions & RLS

### 13.1 `llm_requests` — existing RLS state

`llm_requests` is already listed in [server/config/rlsProtectedTables.ts](server/config/rlsProtectedTables.ts) as an org-scoped table with RLS enabled. The new columns added in this spec (`source_id`, `feature_tag`, `parse_failure_raw_excerpt`, `abort_reason`) do not change the RLS policy — the `organisation_id` column remains the scoping axis, and all new columns are dependent on that column for access.

**No RLS migration required** for the column additions. Verify after migration 0180 lands that `verify-rls-coverage.sh` still passes.

### 13.2 `llm_requests_archive` — new table RLS requirement

Per §4 of the spec-authoring checklist: every new tenant-scoped table must have (1) RLS policy, (2) manifest entry, (3) route guard, (4) principal-scoped context.

**Application to `llm_requests_archive`:**

1. **RLS policy:** identical to `llm_requests` — rows readable only when `organisation_id = current_setting('app.organisation_id')::uuid` OR when the caller is admin-connection-scoped (admin reads bypass).
2. **Manifest entry:** add `llm_requests_archive` to `server/config/rlsProtectedTables.ts` in the same migration (0183) that creates the table. `verify-rls-coverage.sh` enforces this.
3. **Route guard:** no HTTP route reads the archive directly. `getCallDetail()` reads via `systemPnlService` which runs under `requireSystemAdmin` + `withAdminConnection`. If an org-scoped route needs archived data later, that requires a separate spec.
4. **Principal-scoped context:** admin reads use `withAdminConnection`. No agent-execution path reads the archive.

### 13.3 System P&L page — admin-scoped reads

**Deliberate cross-tenant read:** the System P&L page is the one UI that reads across all organisations by design. It is gated by:

- `requireSystemAdmin` middleware on every `/api/admin/llm-pnl/*` route.
- `withAdminConnection` for the actual DB queries (bypasses RLS).
- No other route or UI exposes this data.

**Why not a new permission key?** `requireSystemAdmin` already exists and is sufficient. Introducing `system_pnl_view` would be redundant — there is no sub-role of "system admin who can see skills but not costs" that we want to express today.

### 13.4 `cost_aggregates` — already covered

`cost_aggregates` is already in the RLS manifest. The new `entity_type = 'source_type' | 'feature_tag'` values don't change its row shape, just add writes. No migration to RLS policy.

### 13.5 System-level rows and RLS

Ledger rows with `sourceType = 'system'` or `'analyzer'` still have `organisation_id` set (the organisation that initiated the analyzer run). These rows ARE subject to RLS like every other row.

The exception is system rows with no attributable org — e.g. a periodic platform-wide maintenance job that spans orgs. Today, no such caller exists. If one is added, we either assign it a synthetic "platform" org UUID OR add an `organisation_id` nullable column + RLS policy extension. Out of scope for this spec.

---

## 14. File inventory

Single source of truth. Every file this spec adds or modifies appears here. Cross-reference against prose: any file referenced in §§1–13 must be in this table. Per §2 of the spec-authoring checklist.

### 14.1 Migrations (new)

| # | File | Phase | What |
|---|---|---|---|
| 0180 | `migrations/0180_llm_requests_generalisation.sql` | P1 | Add `source_id`, `feature_tag`, `parse_failure_raw_excerpt`, `abort_reason` columns; drop `execution_phase` NOT NULL; add CHECK constraints; add 3 indexes |
| 0181 | `migrations/0181_cost_aggregates_source_type_dimension.sql` | P1 | Documentation-only (comment update); no DDL |
| 0182 | `migrations/0182_llm_requests_new_status_values.sql` | P1 | None at DB level (text column); reserved sequence number for rollback isolation |
| 0183 | `migrations/0183_llm_requests_archive.sql` | P5 | Create `llm_requests_archive` table + indexes + RLS policy + manifest entry |

Note: pg-boss job registration is application code (wired in at startup via `queueService`), not DDL. There is no "migration 0184" — retention-job registration lands in the code-only portion of P5 alongside `llmLedgerArchiveJob.ts`.

**Phase mapping** — see §15. Sequence numbers reserved now to avoid collision if any are interleaved with other work.

### 14.2 Schema files

| File | Change |
|---|---|
| `server/db/schema/llmRequests.ts` | Add 4 columns (`source_id`, `feature_tag`, `parse_failure_raw_excerpt`, `abort_reason`); extend `SOURCE_TYPES` and `LLM_REQUEST_STATUSES` enums; drop `execution_phase` NOT NULL; add check constraints; type changes. **No `TASK_TYPES` change** — per §5.2 the existing closed enum stays as-is; feature identity lives on the new `feature_tag` column instead. |
| `server/db/schema/llmRequestsArchive.ts` (new) | Archive table, mirrors shape |
| `server/db/schema/index.ts` | Export new archive table |
| `server/db/schema/costAggregates.ts` | Update doc comment for `entity_type` enum |

### 14.3 Server services

| File | Change |
|---|---|
| `server/services/llmRouter.ts` | Extend `LLMCallContextSchema`, add `systemCallerPolicy` branch, add `postProcess` hook, update `generateIdempotencyKey()` |
| `server/services/providers/anthropicAdapter.ts` | Add `signal` param threading; 499 + AbortError mapping (with `AbortSignal.reason` preserved) |
| `server/services/providers/openaiAdapter.ts` | Same as anthropic |
| `server/services/providers/geminiAdapter.ts` | Same as anthropic |
| `server/services/providers/openrouterAdapter.ts` | Same as anthropic |
| `server/services/providers/types.ts` | Extend `ProviderCallParams` with `signal` |
| `server/services/budgetService.ts` | Branch for `sourceType ∈ {'system', 'analyzer'}` (verify existing, extend if absent) |
| `server/services/costAggregateService.ts` | Add `sourceType` + `featureTag` dimension writes in `upsertAggregates()` |
| `server/services/skillAnalyzerService.ts` | Replace direct `anthropicAdapter.call()` at :2063 with `llmRouter.routeCall()`; thread `AbortController`; sourceType `'analyzer'` + stable `featureTag` (§10.4) |
| `server/services/systemPnlService.ts` (new) | 8 methods per §11.2 |
| `server/services/systemPnlServicePure.ts` (new) | Pure functions for P&L math (revenue/cost/profit/margin derivation, totals row, % of revenue) — testable without DB |
| `shared/types/systemPnl.ts` (new) | Shared TypeScript types for `PnlSummary`, `OrgRow`, `SubacctRow`, `SourceTypeRow`, `ProviderModelRow`, `OverheadRow`, `DailyTrendRow`, `TopCallRow`, `CallDetail` — imported by both `systemPnlService.ts` and the client components. New directory `shared/types/` introduced by this spec. |

### 14.4 Server routes

| File | Change |
|---|---|
| `server/routes/systemPnl.ts` (new) | 8 endpoints per §11.3 |
| `server/index.ts` | Mount the new router under `/api/admin/llm-pnl` (this repo has no `server/routes/index.ts`; routes are mounted directly in the top-level `server/index.ts`) |
| `server/routes/llmUsage.ts` | No change (left in place for backward compat with subaccount-scoped Usage page) |

### 14.5 Server jobs

| File | Change |
|---|---|
| `server/jobs/skillAnalyzerJob.ts` | Replace 3 direct `anthropicAdapter.call()` sites (§10.1–§10.3) with `llmRouter.routeCall()`; wire `AbortController`. A 4th analyzer-subsystem site lives in `server/services/skillAnalyzerService.ts` — migrated per §14.3. |
| `server/jobs/llmLedgerArchiveJob.ts` (new) | Nightly archive job orchestration + DB transaction loop per §12.4 |
| `server/jobs/llmLedgerArchiveJobPure.ts` (new) | Pure helpers for the archive job — exports `computeArchiveCutoff(retentionMonths, now)` per §12.4 |
| `server/services/queueService.ts` and/or `server/index.ts` | Register the new archive job with pg-boss at startup. (This repo has no `server/jobs/index.ts`; queue registration happens through `queueService` primitives invoked from `server/index.ts` and the per-job files.) |

### 14.6 Server libs / config

| File | Change |
|---|---|
| `server/lib/env.ts` | Add `LLM_LEDGER_RETENTION_MONTHS` (default 12) |
| `server/lib/parseFailureError.ts` (new) | Typed error class for parse failures |
| `server/lib/utf8Truncate.ts` (new) | Safe UTF-8-boundary truncation utility for excerpt capture |
| `server/config/rlsProtectedTables.ts` | Add `llm_requests_archive` entry |

### 14.7 Client (new page + components)

| File | Change |
|---|---|
| `client/src/pages/SystemPnlPage.tsx` (new) | Route entry point, lazy-loaded |
| `client/src/components/system-pnl/PnlKpiCard.tsx` (new) | |
| `client/src/components/system-pnl/PnlGroupingTabs.tsx` (new) | |
| `client/src/components/system-pnl/PnlByOrganisationTable.tsx` (new) | |
| `client/src/components/system-pnl/PnlBySubaccountTable.tsx` (new) | |
| `client/src/components/system-pnl/PnlBySourceTypeTable.tsx` (new) | |
| `client/src/components/system-pnl/PnlByProviderModelTable.tsx` (new) | |
| `client/src/components/system-pnl/PnlTrendChart.tsx` (new) | |
| `client/src/components/system-pnl/PnlTopCallsList.tsx` (new) | |
| `client/src/components/system-pnl/PnlCallDetailDrawer.tsx` (new) | |
| `client/src/components/system-pnl/PnlMarginPill.tsx` (new) | |
| `client/src/components/system-pnl/PnlSparkline.tsx` (new) | |
| `client/src/components/system-pnl/PnlColHeader.tsx` (new) | |
| `client/src/App.tsx` | Register `/system/llm-pnl` route |

### 14.8 Scripts / gates

| File | Change |
|---|---|
| `scripts/gates/verify-no-direct-adapter-calls.sh` (new) | Static gate per §9.4 |
| `scripts/run-all-gates.sh` | Register the new gate |

### 14.8a Pure-function tests (new)

| File | Change |
|---|---|
| `server/services/__tests__/systemPnlServicePure.test.ts` (new) | Tests for P&L math — revenue/profit/margin derivation, totals row, % computations |
| `server/lib/__tests__/utf8Truncate.test.ts` (new) | Truncation at UTF-8 code point boundaries — no invalid multi-byte residue |
| `server/jobs/__tests__/ledgerArchivePure.test.ts` (new) | Tests `computeArchiveCutoff(retentionMonths, now)` from `server/jobs/llmLedgerArchiveJobPure.ts` — month-boundary arithmetic, injected `now` for determinism |

### 14.8b Working-session deliverables

| File | Change |
|---|---|
| `tasks/direct-adapter-audit-<YYYY-MM-DD>.md` (new, P2 deliverable) | Enumeration of every direct-adapter caller found by the sweep, with one-line remediation plan per caller |

### 14.9 Documentation updates (required in same commit per `CLAUDE.md §11`)

| File | Change |
|---|---|
| `architecture.md` | Update the "LLM router + ledger" section to document the polymorphic attribution model |
| `docs/capabilities.md` | Add System P&L to the Agency Capabilities section (vendor-neutral phrasing) |
| `CLAUDE.md` "Key files per domain" table | Add entries for System P&L and ledger-archive jobs |

---

## 15. Phase sequencing (dependency graph)

Each phase is a single PR. Phases land in order; no phase depends on a column/table/service created in a later phase.

### 15.1 P1 — Ledger + router + adapter plumbing

**Goal:** every future LLM call has a safe home to land in. Behavioural changes are scoped to the financial-attribution path for `sourceType ∈ {'system','analyzer'}` rows (see §7.4 — router overrides `marginMultiplier` to `1.0` at insert time so `costWithMargin == costRaw`). Every other attribution path is unchanged.

**Schema changes introduced:**
- `0180` — `llm_requests` column additions, CHECK constraints, indexes, nullable `execution_phase`
- `0181` — `cost_aggregates` comment-only migration
- `0182` — reserved for new status values doc-level update

**Services introduced:** none.

**Services modified:**
- `llmRouter.ts` — new context fields, `systemCallerPolicy`, `postProcess`, idempotency-key update
- `anthropicAdapter.ts`, `openaiAdapter.ts`, `geminiAdapter.ts`, `openrouterAdapter.ts` — `signal` + error mapping (uniform across all four registered adapters per §8.4)
- `budgetService.ts` — system/analyzer branch
- `costAggregateService.ts` — add `source_type` + `feature_tag` dimension writes

**Jobs introduced:** none.
**Jobs modified:** none.

**Columns referenced by code:** `source_id`, `feature_tag`, `parse_failure_raw_excerpt`, `abort_reason`. All created in this phase's migration 0180.

**Verification:** static gates pass (including new `verify-no-direct-adapter-calls.sh` — but skip that gate registration until P2).

### 15.2 P2 — Static gate + direct-adapter audit

**Goal:** enumerate + document every direct-adapter caller. Gate prevents regression.

**Schema changes introduced:** none.

**Services introduced:** none.

**Services modified:** none (audit-only, no code changes to consumers).

**Jobs introduced:** none.
**Jobs modified:** none.

**Scripts introduced:**
- `scripts/gates/verify-no-direct-adapter-calls.sh`

**Columns referenced by code:** none new.

**Verification:** gate runs green on P2 — the whitelist explicitly names both `server/jobs/skillAnalyzerJob.ts` and `server/services/skillAnalyzerService.ts` (the two known direct-adapter sites, per §9.2) so the gate passes with those two files exempted. P3 removes both from the whitelist (§15.3) — that is the moment the gate starts enforcing against the analyzer subsystem. P2 therefore lands as: green gate + explicit temporary whitelist of the two analyzer files + `tasks/direct-adapter-audit-<date>.md` listing every direct-adapter caller the sweep finds.

**Deliverable:** one markdown file in `tasks/` enumerating direct-adapter callers with a one-line remediation plan for each.

### 15.3 P3 — Skill-analyzer migration

**Goal:** analyzer routes through `llmRouter`; ledger rows appear for every classify / agent-match / cluster-recommend call.

**Schema changes introduced:** none (uses schema from P1).

**Services modified:**
- `skillAnalyzerService.ts` — 1 call site migrated (§10.4)

**Jobs modified:**
- `skillAnalyzerJob.ts` — 3 call sites migrated (§10.1–§10.3)

**Columns referenced by code:** `source_id`, `feature_tag`, `parse_failure_raw_excerpt`, `abort_reason`. All exist from P1.

**Static gate update:** remove both `skillAnalyzerJob.ts` and `skillAnalyzerService.ts` from whitelist in `verify-no-direct-adapter-calls.sh`. Gate now passes with no analyzer-subsystem file whitelisted.

**Verification:** A1 (from §1.2) verifiable here — gate passes, every analyzer call (job-layer and service-layer) is visible in `llm_requests`. Manual run of an analyzer import confirms A2, A3, A4.

### 15.4 P4 — System P&L page

**Goal:** platform admin can see cross-org P&L in the UI.

**Schema changes introduced:** none.

**Services introduced:**
- `systemPnlService.ts`

**Services modified:** none.

**Routes introduced:**
- `server/routes/systemPnl.ts` + mount at `/api/admin/llm-pnl/*`

**Jobs introduced:** none.

**Client introduced:**
- Full component tree per §14.7
- `/system/llm-pnl` route in `App.tsx`

**Columns referenced by code:** all from P1. New `cost_aggregates` dimensions (`source_type`, `feature_tag`) written since P1 have data by the time P4 ships.

**Data readiness:** `sourceType='system'` data already exists in the ledger today (see §2.4). Between P3 and P4, analyzer data starts accumulating in `cost_aggregates` under the new `sourceType='analyzer'` dimension. P4's page therefore has non-zero data across every tab on launch — including the split between `system` and `analyzer` in the `By Source Type` tab.

**Verification:** A5, A6 verifiable here.

### 15.5 P5 — Retention

**Goal:** bounded growth for `llm_requests`.

**Schema changes introduced:**
- `0183` — `llm_requests_archive` table + RLS policy + manifest entry

**Code-only changes (no migration):**
- Register the new `llm-ledger-archive` pg-boss job in the startup path (`server/index.ts` + `queueService`). Pg-boss cron registration is application code, not DDL.

**Services introduced:** none.

**Services modified:**
- `systemPnlService.getCallDetail()` — UNION ALL against archive table

**Jobs introduced:**
- `llm-ledger-archive` — nightly archive job

**Columns referenced by code:** all from P1.

**Verification:** A7 verifiable here. Manual test: temporarily set `LLM_LEDGER_RETENTION_MONTHS=0`, run job, verify rows move to archive; set back to 12.

### 15.6 Dependency graph check

| Phase | Depends on schema from | Depends on service from | Depends on code from |
|---|---|---|---|
| P1 | — | — | — |
| P2 | — | — | — |
| P3 | P1 | P1 (router changes) | P1 (adapter changes) |
| P4 | P1 (source_type dimension) | P1 (costAggregateService) | P3 (non-zero data) |
| P5 | P1 (detail columns) | P4 (getCallDetail to extend) | P1 (base schema) |

No backward dependencies. No phase lists a deliverable that's actually in a later phase. Phase-boundary claims self-consistent.

### 15.7 Phase landing cadence

- **P1** — 1 PR, 1 day of focused work.
- **P2** — 1 PR, half-day (audit + gate).
- **P3** — 1 PR, half-day (mechanical migration).
- **P4** — 1 PR, 2–3 days (new page + service + routes + ~12 components).
- **P5** — 1 PR, half-day (archive + job).

Total: ~1 week of focused work, 5 PRs.

**Merge order is strict.** P3 depends on P1; P4 is better with P3; P5 depends on P1. Skipping order creates regressions or hollow UI.

---

## 16. Testing posture

Per `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
api_contract_tests: none_for_now
e2e_tests_of_own_app: none_for_now
```

This spec conforms. No vitest/jest/supertest/playwright added.

### 16.1 Static gates (primary)

| Gate | What it enforces | Phase |
|---|---|---|
| `verify-no-direct-adapter-calls.sh` (new) | No file outside router + adapters imports any provider adapter registered in `providers/registry.ts` (today: `anthropicAdapter`, `openaiAdapter`, `geminiAdapter`, `openrouterAdapter`) | P2 |
| `verify-rls-coverage.sh` (existing) | `llm_requests_archive` is in the RLS manifest | P5 |
| `verify-rls-contract-compliance.sh` (existing) | No direct DB access bypassing principal context | All |
| `typecheck` (existing) | New TypeScript types from schema changes compile | P1 |
| `lint` (existing) | Unchanged | All |

### 16.2 Pure-function runtime tests

Limited to the `*ServicePure.ts` pattern already used in the repo. Candidates:

- `systemPnlServicePure.test.ts` (new) — test the P&L math: revenue/cost/profit/margin derivation, totals row computation, % of revenue computation. All computations are pure functions; refactor the math into `systemPnlServicePure.ts` so it's testable without a DB.
- `utf8Truncate.test.ts` (new) — verify truncation at UTF-8 code point boundaries. Critical because naive byte-level truncation can corrupt multi-byte sequences.
- `ledgerArchivePure.test.ts` (new) — cutoff calculation logic.

**No tests on:** the router (too integration-heavy), the adapters (HTTP mocking considered out of scope per framing), or the P&L page components (frontend_tests: none).

### 16.3 Manual verification checklist per phase

Per phase, these manual checks run before merging to main:

**P1:**
- Run migrations locally against a dev DB; verify CHECK constraints reject invalid attribution shapes.
- Confirm `llm_requests` queries still work for existing agent-run attribution.
- Import a skill-analyzer job (still unmigrated in P1); confirm no ledger rows are written (expected — analyzer still bypasses).

**P2:**
- Run `verify-no-direct-adapter-calls.sh`; confirm it finds the analyzer call sites.
- Audit doc in `tasks/direct-adapter-audit-<date>.md` lists the analyzer and any other callers.

**P3:**
- Import a skill-analyzer job; verify rows appear in `llm_requests` with correct `feature_tag`, `sourceType`, `sourceId`.
- Cross-check `providerRequestId` against Anthropic console for one row.
- Let a classify timeout via `SKILL_CLASSIFY_TIMEOUT_MS`; verify `status = 'aborted_by_caller'`, `abort_reason = 'caller_timeout'`.
- Temporarily break the parse schema; verify `parseFailureRawExcerpt` ≤2 KB and UTF-8-valid.
- Confirm `verify-no-direct-adapter-calls.sh` passes without analyzer in whitelist.

**P4:**
- Navigate to `/system/llm-pnl` as system admin; verify all 4 tabs render.
- Click each grouping tab; verify table content changes.
- Verify KPI totals match the sum of rows in each tab view.
- Click a top-call row; verify detail drawer opens with correct provider_request_id.
- Try to access `/system/llm-pnl` as non-admin; verify 403.

**P5:**
- Set `LLM_LEDGER_RETENTION_MONTHS=0`; run archive job; verify all rows move; query still works via UNION.
- Reset retention to 12; verify nothing further moves.

### 16.4 What we're explicitly NOT testing

- End-to-end P&L page flows (framing excludes E2E).
- Idempotency behaviour of the archive job under concurrent runs (framing: `migration_safety_tests: defer_until_live_data_exists`).
- Load tests on `cost_aggregates` upsert path (framing: `performance_baselines: defer_until_production`).

---

## 17. Deferred items

Per §7 of the spec-authoring checklist, every "deferred" / "later" / "future" reference in prose must have an entry here.

- **Detail drawer rich-state interactions.** P4 ships the base drawer (fields + copy buttons + close). Rich state — filter-by-request-ID inline, keyboard navigation, cross-reference search, embedded link to run/job with deep context — is deferred. Reason: scope discipline on P4, which is already the largest single PR.
- **Auto-archival of `cost_aggregates` rows older than 24 months.** Deferred. Reason: rollups are tiny (thousands of rows vs millions on the ledger); no operational need.
- **Per-org retention overrides in `llm_requests`.** Deferred. Reason: no commercial customer has requested >12-month retention; adding per-org config would require new config tables + UI, out of scope for the ledger-generalisation work.
- **Provider-level cost reconciliation (compare our `cost_raw` to Anthropic invoice exports).** Deferred. Reason: requires invoice-parsing infrastructure; the System P&L page gives us internal cost totals which is sufficient for this spec's goals.
- **Anomaly alerting on System P&L metrics** ("Platform overhead >15% of revenue for 3 consecutive days", "Org X's net margin dropped below 10%"). Deferred. Reason: alerting infrastructure is a separate concern; page-only surfacing in P4 is the right stop-point.
- **Shared `useLedgerQuery` hook on the client** for consistent data fetching across the P&L page. Deferred. Reason: P4 uses React Query with per-component keys; a shared hook is a refactor candidate once the page is stable, not a day-one requirement.
- **Cross-org cost trend tuning** (smoothing, seasonality overlays, year-over-year comparison). Deferred. Reason: the 30-day line chart in P4 is sufficient for CEO-level reporting; advanced chart work is a follow-up.
- **Direct-adapter caller audit of callers outside the analyzer subsystem.** P2 produces the audit document; P3 migrates the entire analyzer subsystem (both `server/jobs/skillAnalyzerJob.ts` and `server/services/skillAnalyzerService.ts`) as proof-of-concept. Callers outside the analyzer subsystem — e.g. workspace-memory, belief-extraction, and any other confirmed by P2 — are migrated in a follow-up spec. Reason: scope containment — this spec proves the pattern on one subsystem; the pattern, once proven, can be applied elsewhere without a new design.
- **Real destinations for the System P&L page footer links (`Margin policies`, `Retention`, `Billing rules`).** P4 renders these as decorative `<span>` elements per §11.4.1. Candidates for real destinations: an admin `Margin policies` page (org-by-org override tables), an admin `Retention` page exposing `env.LLM_LEDGER_RETENTION_MONTHS`, and an admin `Billing rules` page (invoice generation, per-client billing periods). Reason: each destination is its own admin page that does not yet exist; wiring real hrefs into P4 would balloon scope from a single admin surface into a multi-page suite.
- **User-initiated cancel wiring for analyzer LLM calls (`caller_cancel`).** §8.1's abort-reason mechanism supports both `caller_timeout` and `caller_cancel`, but this spec only wires the timeout path in §10.1. Threading a UI/job-level cancel into the analyzer's `AbortController` requires a new cancel-propagation hook (UI → pg-boss job cancel → analyzer worker → `AbortController.abort('caller_cancel')`) that does not exist today. Reason for deferral: the analyzer pg-boss job has no UI-cancel surface today; adding one is its own scope (cancellable long-running jobs) and out of this spec's ledger-generalisation work. The schema-level `abort_reason = 'caller_cancel'` value stays listed in the CHECK constraint so no future migration is needed when the wiring lands.
- **`cost_aggregates` `provider_model` entity_type + `avg_latency_ms` column.** P4's `getByProviderModel()` reads `llm_requests` live with GROUP BY `(provider, model)` + `AVG(provider_latency_ms)` because `cost_aggregates` has no `provider+model` composite key and no latency column (§11.2). Deferred. Reason: the 30-day window is a bounded indexed scan (sub-500ms) at expected volumes; extending `cost_aggregates` adds schema + aggregation-job work that is only worth paying for if query latency becomes load-bearing. Commit-and-revert posture per `docs/spec-context.md` — ship against live reads, promote to aggregate dimension later if and when latency data says so.

---

## 18. Rollout

### 18.1 Commit-and-revert posture

Per `docs/spec-context.md`: `rollout_model: commit_and_revert`. No staged rollout, no feature flags, no percentage-based traffic shifting.

Each phase ships as a single PR to `main`. If a phase breaks something, revert the PR and fix forward in the next PR. `pre_production: yes` means no live users to protect.

### 18.2 Rollback decision matrix

| Phase | Rollback cost | Rollback plan |
|---|---|---|
| P1 | Low | Revert migration via a 0180_rollback.sql; revert code PR |
| P2 | Zero | Revert gate registration; no code or schema change |
| P3 | Low | Revert the `skillAnalyzerJob.ts` PR; analyzer falls back to direct-adapter path; re-add analyzer to gate whitelist |
| P4 | Zero | Revert UI PR; no data or schema dependency to roll back |
| P5 | Medium | Revert archive job registration; `llm_requests_archive` table can stay (empty cost to retain) |

P5's rollback cost is medium because if the archive job has already run, rows are in the archive table. Rolling back the job doesn't move them back automatically — a separate data-repair step would be needed. Mitigation: verify P5 on a dev DB with synthetic data before merging.

### 18.3 Pre-launch checklist

Before merging P3 (the highest-impact phase):

- [ ] All P1 migrations applied to dev DB and basic shape verified
- [ ] `verify-no-direct-adapter-calls.sh` runs locally and exits correctly on both sides (red before P3, green after)
- [ ] Skill-analyzer import runs end-to-end on dev
- [ ] One ledger row manually inspected and matched against Anthropic console
- [ ] `pr-reviewer` has passed on the PR
- [ ] No TypeScript errors from schema type regen
- [ ] `npm run lint` clean
- [ ] `npm run build` clean

Before merging P4:

- [ ] Same as above for UI PR
- [ ] All 4 tabs render with real (analyzer-post-P3) data
- [ ] Permission gate verified (non-admin gets 403)
- [ ] No console errors on page load

### 18.4 Documentation-sync step (required per `CLAUDE.md §11`)

Every phase's PR includes the doc updates listed in §14.9. Specifically:

- P1: `architecture.md` LLM ledger section
- P3: `CLAUDE.md` key files table (add analyzer routing pointer)
- P4: `CLAUDE.md` key files table (add System P&L); `docs/capabilities.md` Agency Capabilities section
- P5: `CLAUDE.md` key files table (add ledger-archive job); `architecture.md` retention section

Not "in a follow-up PR" — in the same commit as the code change.

---

## 19. Contracts (appendix)

Every data shape crossing a service boundary, per §3 of the spec-authoring checklist. Each contract includes name, type, example, nullability/defaults, producer, and consumer.

### 19.1 `LLMCallContext` (extended)

**Type:** TypeScript / Zod, declared in `server/services/llmRouter.ts`.

**Example instance (analyzer classify call):**
```ts
{
  organisationId: "8b2e1a9c-3f54-4e0a-a111-b2d7e9f0a1b2",
  sourceType: "analyzer",
  sourceId: "c7d3f012-4a55-4f1a-c222-b8f0d1e3c4b5",
  featureTag: "skill-analyzer-classify",
  taskType: "general",
  executionPhase: null,
  systemCallerPolicy: "bypass_routing",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  abortSignal: <AbortSignal>,
}
```

**Nullability (matches the CHECK constraint in §6.1):**
- `sourceId`:
  - **Required** when `sourceType = 'analyzer'`.
  - **Optional** when `sourceType = 'system'` (may be NULL for truly unattributable platform work, or set to a job/service identifier when attribution exists).
  - **Must be NULL** when `sourceType ∈ {'agent_run', 'process_execution', 'iee'}` — those rows use the typed FKs instead.
- `featureTag`: strongly recommended, defaults to `'unknown'` with a warning log from the router.
- `executionPhase`: NULL for `analyzer` and `system`; required for `agent_run`, `process_execution`, `iee`.
- `abortSignal`: optional; absence is treated as "no caller-side cancellation support."

**Producer:** every caller of `llmRouter.routeCall()`.
**Consumer:** `llmRouter.ts` internal; not persisted directly (fields land on `llm_requests` row columns).

### 19.2 `llm_requests` row (post-migration 0180)

**Type:** Drizzle table row, declared in `server/db/schema/llmRequests.ts`.

**Example instance (analyzer classify success):**
```json
{
  "id": "row-uuid",
  "idempotencyKey": "8b2e1a9c-...:c7d3f012-...:skill-analyzer-classify:general:anthropic:claude-sonnet-4-6:<messagehash>",
  "organisationId": "8b2e1a9c-3f54-4e0a-a111-b2d7e9f0a1b2",
  "subaccountId": null,
  "sourceType": "analyzer",
  "sourceId": "c7d3f012-4a55-4f1a-c222-b8f0d1e3c4b5",
  "featureTag": "skill-analyzer-classify",
  "runId": null, "executionId": null, "ieeRunId": null,
  "taskType": "general",
  "executionPhase": null,
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "providerRequestId": "req_011CaEL8oXSaxjj9ZT1gC2Ai",
  "tokensIn": 7252, "tokensOut": 4819, "cachedPromptTokens": 0,
  "costRaw": "0.04181900",
  "costWithMargin": "0.04181900",
  "costWithMarginCents": 4,
  "marginMultiplier": "1.0000",
  "providerLatencyMs": 47200,
  "routerOverheadMs": 12,
  "status": "success",
  "attemptNumber": 1,
  "parseFailureRawExcerpt": null,
  "abortReason": null,
  "billingMonth": "2026-04",
  "billingDay": "2026-04-20",
  "createdAt": "2026-04-20T03:38:22.102Z"
}
```

**Example instance (analyzer classify aborted by caller):**
```json
{
  "sourceType": "analyzer",
  "sourceId": "c7d3f012-...",
  "featureTag": "skill-analyzer-classify",
  "tokensIn": 7252, "tokensOut": null,
  "costRaw": "0",
  "costWithMargin": "0",
  "status": "aborted_by_caller",
  "abortReason": "caller_cancel",
  "parseFailureRawExcerpt": null,
  "errorMessage": "Request aborted by caller (caller_cancel)"
}
```

Note: `status = 'aborted_by_caller'` here because our side fired `AbortController.abort()`. A `client_disconnected` row would result from a mid-body network RST where we did not initiate the abort — see §6.4 for the full mapping.

Note: analyzer rows use `marginMultiplier: "1.0000"` because system-level work doesn't add margin — cost equals revenue for these (which is to say, there is no revenue; the row just records cost). The router enforces this override at insert time per §7.4.

**Producer:** `llmRouter.routeCall()` is the only writer.
**Consumer:** `systemPnlService`, `llmUsageService`, `costAggregateService`.

### 19.3 `PnlSummary`

**Type:** TypeScript, declared in `server/services/systemPnlService.ts` and `shared/types/systemPnl.ts` (to share with the client).

**Example:**
```ts
{
  period: "2026-04",
  previousPeriod: "2026-03",
  revenue: { cents: 2720690, change: { pct: 11.8, direction: "up" } },
  grossProfit: { cents: 561413, margin: 20.6, change: { pct: 7.4, direction: "up" } },
  platformOverhead: { cents: 188742, pctOfRevenue: 6.9 },
  netProfit: { cents: 372671, margin: 13.7, change: { pp: 0.4, direction: "up" } },
}
```

**Nullability:** `previousPeriod` data may be null if there's no prior period. Change indicators are then `null`.

**Producer:** `systemPnlService.getPnlSummary()`.
**Consumer:** `PnlKpiCard.tsx`.

### 19.4 `OrgRow`

**Type:** TypeScript, shared.

**Example:**
```ts
{
  organisationId: "8b2e...",
  organisationName: "Summit Digital",
  slug: "summit-digital",
  marginTier: 1.40,
  subaccountCount: 14,
  requests: 291482,
  revenueCents: 759693,
  costCents: 542638,
  profitCents: 217055,
  marginPct: 28.6,
  pctOfRevenue: 27.9,
  trendSparkline: [0.8, 0.82, 0.85, ...30 values...],
}
```

**Nullability:** none — platform-admin view aggregates always return populated rows.

**Producer:** `systemPnlService.getByOrganisation()`. The method returns `{ orgs: OrgRow[]; overhead: OverheadRow }`: the per-org rows plus a single synthetic aggregated overhead row (see `OverheadRow` below). The client renders `overhead` as the bottom-of-table indigo row per `prototypes/system-costs-page.html` lines 534-560.

**Consumer:** `PnlByOrganisationTable.tsx`.

**`OverheadRow` contract (new, shared):**
```ts
{
  kind: "overhead";
  label: "Platform background work";
  description: string;            // e.g. "System + analyzer (see By Source Type for split)"
  requests: number;
  revenueCents: null;
  costCents: number;
  profitCents: number;            // = -costCents
  marginPct: null;
  pctOfRevenue: number;
}
```
Reused by every tab that renders an aggregated overhead row (today: `By Organisation` only). `By Source Type` uses a separate `SourceTypeRow` per §19.5.2 because the overhead there is split into two distinct rows.

### 19.5 Per-tab row contracts

Each tab's row type has its own explicit shape in `shared/types/systemPnl.ts`. The shape family is similar to `OrgRow` for the money columns, but the identity columns and the tab-specific columns differ per tab.

#### 19.5.1 `SubacctRow`

**Type:** TypeScript, declared in `shared/types/systemPnl.ts`.

**Example:**
```ts
{
  subaccountId: "a14f...",
  subaccountName: "Creative Ops",
  organisationId: "8b2e...",
  organisationName: "Summit Digital",
  marginTier: 1.40,
  requests: 48213,
  revenueCents: 121840,
  costCents: 87029,
  profitCents: 34811,
  marginPct: 28.6,
  pctOfRevenue: 4.5,
}
```

**Nullability:** none — subaccount rows always belong to a concrete subaccount + org.

**Producer:** `systemPnlService.getBySubaccount()`.
**Consumer:** `PnlBySubaccountTable.tsx`.

#### 19.5.2 `SourceTypeRow`

**Type:** TypeScript, declared in `shared/types/systemPnl.ts`.

Renders 5 rows on the `By Source Type` tab — one per distinct `sourceType` value: `agent_run`, `process_execution`, `iee`, `system`, `analyzer`. The schema-level split between `system` and `analyzer` (added in §6.1) is preserved in the UI so operators can see analyzer spend at a glance instead of hiding it behind a single "System" line.

**Shape:**
```ts
{
  sourceType: 'agent_run' | 'process_execution' | 'iee' | 'system' | 'analyzer';
  label: string;                   // display label (e.g. "Agent Run", "System Background")
  description: string;             // one-line description shown under the label
  orgsCount: number;               // distinct organisation count contributing to this row (for billable rows); 0 for overhead rows
  requests: number;
  revenueCents: number | null;     // null for sourceType ∈ {'system','analyzer'} (no revenue attribution)
  costCents: number;
  profitCents: number;             // = revenueCents - costCents for billable rows; = -costCents for overhead rows
  marginPct: number | null;        // null for overhead rows — rendered as "overhead" badge
  pctOfCost: number;               // percentage of this period's total platform cost
}
```

**Example — `system` row (platform overhead that is not analyzer work):**
```ts
{
  sourceType: "system",
  label: "System Background",
  description: "Memory compile · orchestration · miscellaneous system work",
  orgsCount: 0,
  requests: 187319,
  revenueCents: null,
  costCents: 164283,
  profitCents: -164283,
  marginPct: null,
  pctOfCost: 7.0,
}
```

**Example — `analyzer` row:**
```ts
{
  sourceType: "analyzer",
  label: "Skill Analyzer",
  description: "Classify · agent-match · cluster-recommend",
  orgsCount: 0,
  requests: 25718,
  revenueCents: null,
  costCents: 24459,
  profitCents: -24459,
  marginPct: null,
  pctOfCost: 1.0,
}
```

Both `system` and `analyzer` rows carry the same "overhead" treatment (null revenue, null margin, rendered as em-dashes by `PnlBySourceTypeTable.tsx`). The `system` row's description drops the word "Analyzers" — analyzer work is now its own row.

**Producer:** `systemPnlService.getBySourceType()`.
**Consumer:** `PnlBySourceTypeTable.tsx` renders em-dashes for null `revenueCents` and `marginPct` across both overhead rows.

#### 19.5.3 `ProviderModelRow`

**Type:** TypeScript, declared in `shared/types/systemPnl.ts`.

**Example:**
```ts
{
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  requests: 412918,
  revenueCents: 1843219,
  costCents: 1320442,
  profitCents: 522777,
  marginPct: 28.4,
  avgLatencyMs: 2847,            // AVG(provider_latency_ms) across the period's rows
  pctOfCost: 55.7,               // percentage of this period's total platform cost
}
```

**Nullability:** none — every row has a concrete provider+model pair.

**Producer:** `systemPnlService.getByProviderModel()`.
**Consumer:** `PnlByProviderModelTable.tsx`.

### 19.5a `DailyTrendRow`

**Type:** TypeScript, declared in `shared/types/systemPnl.ts`.

**Example:**
```ts
{
  day: "2026-04-20",           // ISO date (YYYY-MM-DD), one row per calendar day in the requested window
  revenueCents: 93814,
  costCents: 76121,
  overheadCents: 6254,         // sum of sourceType ∈ {'system','analyzer'} cost for this day
}
```

**Nullability:** all numeric fields default to 0 for days with no activity (not null). `day` is always present.

**Series meaning on the chart:**
- `revenueCents` and `costCents` are the two primary series (stacked area + line).
- **Net profit** on the chart is derived client-side as `revenueCents - costCents` and is NOT sent as a separate field (overhead is already included in `costCents`, so this subtraction produces net profit directly). Keeping profit off the wire prevents drift between contract and display math.
- `overheadCents` is rendered as a secondary line/area in muted indigo so operators can see platform overhead separately from the primary cost line. Including it as a field avoids a second round-trip for the chart.

**Ordering:** rows are returned in ascending `day` order; consumer does not need to sort.

**Producer:** `systemPnlService.getDailyTrend(days)`.
**Consumer:** `PnlTrendChart.tsx`.

### 19.6 `TopCallRow` + `CallDetail`

**Example `TopCallRow` (billable, agent run):**
```ts
{
  id: "row-uuid",
  createdAt: "2026-04-20T14:38:22.102Z",
  organisationName: "Summit Digital",
  subaccountName: "Creative Ops",
  marginTier: 1.40,
  sourceType: "agent_run",
  sourceLabel: "Agent Run",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  tokensIn: 12843,
  tokensOut: 6218,
  revenueCents: 26,               // $0.2553
  costCents: 18,
  profitCents: 8,
  status: "success",
}
```

**Example `TopCallRow` (non-billable, analyzer overhead):**
```ts
{
  id: "row-uuid-2",
  createdAt: "2026-04-20T14:36:09.102Z",
  organisationName: null,          // system/analyzer rows — rendered as "— system —" by the client
  subaccountName: null,
  marginTier: null,
  sourceType: "analyzer",
  sourceLabel: "Skill Analyzer Classify",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  tokensIn: 8895,
  tokensOut: 122,
  revenueCents: null,              // null for sourceType ∈ {'system','analyzer'} — renders as em-dash
  costCents: 4,
  profitCents: -4,                 // = -costCents when revenueCents is null
  status: "client_disconnected",
}
```

**Nullability:** `revenueCents` is `number | null` — null for rows where `sourceType ∈ {'system','analyzer'}` because those rows are platform overhead (no revenue attribution). `organisationName`, `subaccountName`, and `marginTier` are also nullable for overhead rows. Consumer (`PnlTopCallsList.tsx`) renders em-dashes for null fields.

**Example `CallDetail` (extends `TopCallRow`):**
```ts
{
  ...TopCallRow,
  idempotencyKey: "...",
  providerRequestId: "req_011CaEL8o...",
  organisationId: "8b2e...",      // null for overhead rows (system / analyzer)
  subaccountId: "a14f...",        // null for overhead rows and org-scoped work without a subaccount
  runId: "...",                   // if sourceType = 'agent_run'; null otherwise
  sourceId: null,                 // uuid for analyzer (= skill_analyzer_jobs.id per §6.3); null for other source types
  attemptNumber: 1,
  fallbackChain: null,            // parsed JSON or null
  errorMessage: null,
  parseFailureRawExcerpt: null,
  abortReason: null,
  cachedPromptTokens: 0,
  providerLatencyMs: 47200,
  routerOverheadMs: 12,
}
```

**Link-target nullability (load-bearing for the §11.6 drawer links):**
- `organisationId` / `subaccountId` — null when the corresponding `…Name` field is null (i.e. overhead rows where no org/subaccount applies). Drawer renders the link row only when both the name and the id are non-null.
- `runId` — non-null iff `sourceType = 'agent_run'`; the drawer's "Originating run" link renders only for agent rows.
- `sourceId` — non-null for `sourceType ∈ {'analyzer'}` (joins to `skill_analyzer_jobs.id`); `null` for other source types today. Drawer's "Originating job" link renders only when non-null.

**Producer:** `systemPnlService.getTopCalls()` / `.getCallDetail()`.
**Consumer:** `PnlTopCallsList.tsx` / `PnlCallDetailDrawer.tsx`.

### 19.7 `ParseFailureError`

**Type:** TypeScript class, declared in `server/lib/parseFailureError.ts` (new).

```ts
export class ParseFailureError extends Error {
  code = 'CLASSIFICATION_PARSE_FAILURE' as const;
  rawExcerpt: string;
  constructor(args: { rawExcerpt: string }) {
    super('LLM response failed post-processing schema check');
    this.rawExcerpt = args.rawExcerpt;
  }
}
```

**Producer:** caller-side post-processor (e.g. analyzer's `parseClassificationResponseWithMerge` wrapper).
**Consumer:** `llmRouter.routeCall()` catches, writes the `llm_requests` row with `status='parse_failure'` and `parseFailureRawExcerpt = err.rawExcerpt`, then re-throws for caller control flow.

### 19.8 `ArchiveResult`

**Type:** TypeScript, declared in `server/jobs/llmLedgerArchiveJob.ts`.

```ts
{
  totalMoved: 47213,
  cutoff: "2025-04-20T03:00:00.000Z",
}
```

**Producer:** `archiveOldLedgerRows()`.
**Consumer:** pg-boss job completion log; logged via `logger.info('llm_ledger_archive_complete', result)`.

### 19.9 HTTP API payloads

All endpoints in §11.3 return JSON with a wrapper:

```ts
{
  "data": <typed payload per endpoint>,
  "meta": {
    "period": "2026-04",
    "generatedAt": "2026-04-20T14:42:00.000Z",
    "ledgerRowsScanned": 1284029
  }
}
```

Error responses follow the existing app convention (`{ statusCode, message, errorCode }`).

### 19.10 `budgetService.checkAndReserve()` return type (widened)

**Type:** TypeScript, declared in `server/services/budgetService.ts`.

**Signature after this spec:**

```ts
async function checkAndReserve(
  ctx: LLMCallContext,
  conn?: TxOrDb
): Promise<string | null>
```

**Semantics:**

- Returns a reservation id (`string`) for caller paths that ARE budgeted — i.e. `sourceType ∈ {'agent_run', 'process_execution', 'iee'}`. Callers are expected to release the reservation on error or commit on success.
- Returns `null` for caller paths that are NOT budgeted — i.e. `sourceType ∈ {'system', 'analyzer'}`. The router treats `null` as "no reservation to release, no budget math to unwind."

**Producer:** `budgetService.checkAndReserve()`.
**Consumer:** `llmRouter.routeCall()` — the only caller of the budget service, branches on whether the returned id is null vs string for release semantics.

**Back-compat note:** the current signature returns `string` unconditionally (throws `BudgetExceededError` for failure). Widening to `string | null` is a non-breaking change for all existing typed callers because none of them narrow the return beyond `string`; `null` is only returned on a code path that does not exist today (system/analyzer).

---

## End of spec

*This document is v1 draft, pending `spec-reviewer` pass. Findings from the review will be applied per the spec-reviewer agent's classification (mechanical = auto-applied; directional = HITL checkpoint).*

