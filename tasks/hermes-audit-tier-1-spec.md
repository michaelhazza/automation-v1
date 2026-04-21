# Hermes Audit — Tier 1 Spec

**Status:** Draft, ready for implementation
**Task classification:** Significant (multiple domains: UI, memory, cost enforcement)
**Target branch:** `claude/hermes-agent-patterns-2s4eH`
**Last main integration:** `028f665` (2026-04-21) — includes `SystemPnlPage.tsx`, which retires Tier 1 item #4 from the original Hermes audit recommendation.

## Contents

1. Summary
2. Motivation — what Hermes surfaced
3. In scope / Out of scope
4. File inventory
5. Phase A — Per-run cost panel
6. Phase B — Success-gated memory promotion
7. Phase C — LLM router cost-breaker wire-up
8. Contracts (types, schemas, API shapes)
9. Testing posture
10. Verification plan
11. Rollout, risks, deferred items
12. Appendix — audit references

---

## 1. Summary

Three surgical changes that unlock value already paid for by earlier investment. Each one closes a ghosted capability surfaced by the Hermes-audit reports. None of them introduce new schema, new tables, or new product surfaces — they wire existing data through to users, gate existing code paths on existing status signals, or call an existing primitive from one more caller.

- **Phase A — Per-run cost panel.** Expose `/api/runs/:runId/cost` (already built) on the two agent-run detail surfaces that currently don't read it: `AgentRunHistoryPage.tsx` (via `SessionLogCardList`) and `RunTraceViewerPage.tsx` (via `RunTraceView`). Ships a shared `RunCostPanel` component that renders total spend + LLM call count + `callSite` split. (`PlaybookRunDetailPage.tsx` was dropped from Phase A per §11.4 #10 — playbook-run cost aggregates across child agent-run IDs and needs a dedicated follow-up spec.)
- **Phase B — Success-gated memory promotion.** Thread `runResultStatus` into `workspaceMemoryService.extractRunInsights()` (alongside a reserved `trajectoryPassed: boolean | null` slot, always passed as `null` in Phase B — no verdict is persisted today, see §6.4 and §11.4 #6) so that successful runs produce higher-quality semantic entries (`pattern` / `decision`) and failed runs produce `issue` entries with different decay cadence. Pin the behaviour with pure tests.
- **Phase C — LLM router cost-breaker wire-up.** Call `assertWithinRunBudgetFromLedger()` (new in Phase C — see §4.3 and §8.3) from `llmRouter.routeCall()` immediately after each LLM cost is recorded. The breaker primitive already exists in `server/lib/runCostBreaker.ts` (T23) and is called by Slack and Whisper services via the existing `assertWithinRunBudget()` (which reads `cost_aggregates`); the new `assertWithinRunBudgetFromLedger()` sibling reads `llm_requests` directly to avoid rollup lag (see §7.4.1). `assertWithinRunBudget()` remains scoped to Slack/Whisper; the LLM path uses the ledger variant. Adding the LLM caller closes the dominant cost surface for runaway agent loops.

All three items share the same work-scope boundary (one backend service, one router helper, one shared React component, three page wire-ups). They reuse the codebase's existing pure-function + carved-out-integration testing patterns (`server/services/__tests__/`), with two explicit testing-posture deviations captured and justified in §9: `RunCostPanel.test.tsx` (first RTL surface) and `llmUsage.test.ts` (first route integration test). The three phases can be implemented and reviewed in a single session.

## 2. Motivation — what Hermes surfaced

The Hermes audit (Claude and ChatGPT reports, 2026-04-21) pointed at four patterns Hermes Agent gets right. Three of them turn out to be ghosted in our codebase — the infrastructure is built, the data is captured, but the value is not reaching the user:

1. **Transparent per-task cost.** Hermes's headline win is the user knowing what each task cost. The audit confirmed we capture every cost dimension in `llm_requests` and expose `/api/runs/:runId/cost`; the failure is UI-only. See `server/routes/llmUsage.ts:347`.
2. **On-success memory promotion.** Hermes claims to promote successful task outcomes to durable memory. The audit confirmed we call `extractRunInsights()` unconditionally on every completion regardless of outcome — with a generic `observation` entry, no `runResultStatus` branch, no distillation quality bump. See `server/services/agentExecutionService.ts:1305` and `workspaceMemoryService.ts:696`.
3. **Cost caps that actually cap.** Hermes exposes token/cost ceilings as first-class configuration. The audit confirmed we store `subaccountAgents.maxCostPerRunCents` and built the `runCostBreaker` primitive; but the primary cost-incurring surface (LLM calls) does not call the breaker — only Slack and Whisper services do. A runaway agentic loop today can blow past the configured cap.

The fourth audit item — a System-level P&L page — landed on main in commit `30fce22` ahead of this spec.

Tier 1 as defined here is the minimum work that makes the existing investment visible and enforceable. None of it requires new product surface, new schema, or new review cycles from reviewers outside engineering.

## 3. In scope / Out of scope

### In scope

- Read `/api/runs/:runId/cost` from `AgentRunHistoryPage.tsx` (via `SessionLogCardList`) and `RunTraceViewerPage.tsx` (via `RunTraceView`). (`PlaybookRunDetailPage.tsx` was dropped from Phase A per §11.4 #10.)
- Factor the existing `AdminAgentEditPage.tsx` cost rendering into a shared `client/src/components/run-cost/RunCostPanel.tsx`. Page-level consumers call the shared component.
- Extend the per-run cost API response to include `callSite` split (`app` vs `worker`) and LLM call count — this data already exists in `cost_aggregates` and `llm_requests`; we just surface it.
- Thread `runResultStatus` ('success' | 'partial' | 'failed'), a reserved `trajectoryPassed: boolean | null` slot (always `null` in Phase B — forward-compatible for a future verdict-persistence spec; see §6.4 and §11.4 #6), and the run's `errorMessage` into `extractRunInsights()` via a single `outcome` parameter.
- Branch extraction behaviour on those signals (detailed in Phase B below).
- Call `assertWithinRunBudget` from inside `llmRouter.routeCall` after the cost row is written, once per call.
- Handle the no-`runId` case gracefully (system / analyzer callers don't have a run context and must not be blocked by the breaker).
- Unit tests for pure extraction logic, integration tests for breaker enforcement, component tests for the cost panel.

### Out of scope — do not creep

- New product surfaces (no new pages, no new routes except read-only expansion of the existing cost endpoint).
- New database tables or columns.
- Changes to the ledger shape, the router contract, or the budget reservation mechanism.
- End-client-facing cost visibility (stays agency-internal — see audit non-goal).
- "Cheaper model was available" post-call hinting (Tier 3 item #9, explicitly deferred).
- Per-task / per-run cost visible on the **end client** portal (`PortalPage.tsx` stays untouched).
- Any change to `extractEntities()` or the briefing-update pg-boss job at `agentExecutionService.ts:1329`.
- Any change to `assertWithinRunBudget`'s own signature or threshold logic — we only add a caller.
- Any change to `SystemPnlPage.tsx` — that page is already live and not in scope here.

### Non-goals — durable

- This spec does not move us toward a personal-agent framing. No changes to UI copy or marketing surfaces. Every new surface is an operator-facing affordance for an agency managing multiple sub-accounts.
- This spec does not touch the Playbooks system, recurring-task detection, or reflection loops. Those are Tier 2 and require a separate spec.

---

## 4. File inventory

Locked at spec-draft time. If a phase needs a file not on this list, stop and update the spec before editing. "New" means the file does not exist today; "modify" means an existing file is edited; "delete" is not used in this spec.

**Exemption — generated review and log artifacts.** Files written under `tasks/` during the course of implementation (e.g. `tasks/pr-review-log-hermes-tier-1-<ISO-timestamp>.md`, `tasks/todo.md` updates, `tasks/lessons.md` appendages, `tasks/triage-*.md`) are exempt from the inventory lock. They are process artifacts, not source files. The lock governs code and schema changes only.

### 4.1 Phase A — Per-run cost panel

| Action | Path | Role |
|---|---|---|
| New | `client/src/components/run-cost/RunCostPanel.tsx` | Shared React component. Props: `runId: string`, `runIsTerminal: boolean`, `compact?: boolean` (see §5.3). Fetches `/api/runs/:runId/cost` only when `runIsTerminal === true`, else renders a static "Run in progress" placeholder. Renders total spend (USD), LLM call count, `callSite` split (app vs worker) when `compact=false`. Handles loading and error states inline — no toasts, no spinners-in-toasts. |
| New | `client/src/components/run-cost/RunCostPanel.test.tsx` | Component tests using React Testing Library. Covers loading, error, zero-cost, non-zero-cost, app-only, worker-only, mixed `callSite` cases, and the `runIsTerminal=false` placeholder path. |
| Modify | `client/src/components/SessionLogCardList.tsx` | `AgentRunHistoryPage.tsx` delegates its list rendering to this component; the per-run card is defined here, not on the page. Render `<RunCostPanel runId={run.id} runIsTerminal={isTerminalRunStatus(run.status)} compact />` inside each expanded run card. Replace any inline cost fetch if present. |
| Modify | `client/src/pages/AgentRunHistoryPage.tsx` | Page-level wrapper — ensure the `run.status` field reaches `SessionLogCardList` so `isTerminalRunStatus` can be computed per row. No direct panel rendering on this page; the panel lives inside the delegated list component. |
| Modify | `client/src/components/runs/RunTraceView.tsx` | `RunTraceViewerPage.tsx` delegates the actual header card to this component. Render `<RunCostPanel runId={runId} runIsTerminal={isTerminalRunStatus(run.status)} />` (non-compact) in the trace header strip. |
| Modify | `client/src/pages/RunTraceViewerPage.tsx` | Page-level wrapper — pass `run.status` down to `RunTraceView` so terminal-status resolution works. No direct panel rendering on this page; the panel lives inside the delegated header component. |
| Modify | `client/src/pages/AdminAgentEditPage.tsx` | Replace the inline cost fetch at `AdminAgentEditPage.tsx:1697-1702` with `<RunCostPanel runId={expandedId} runIsTerminal={isTerminalRunStatus(run.status)} compact />`. Remove the `runCosts` state map now that the component owns its fetch. |
| Modify | `server/routes/llmUsage.ts` | Extend the `/api/runs/:runId/cost` handler at line 347 to also return `llmCallCount: number`, `totalTokensIn: number`, `totalTokensOut: number`, and `callSiteBreakdown: { app: { costCents, requestCount }, worker: { costCents, requestCount } }`. Read from the **`llm_requests_all` view** (`migrations/0189_llm_requests_all_view.sql` — UNION of `llm_requests` + `llm_requests_archive`), not from `llm_requests` directly. Rationale: rows older than `LLM_LEDGER_RETENTION_MONTHS` (default 12) are moved to the archive by the nightly retention job (see `CLAUDE.md` "Modify LLM ledger retention" entry); a live-only read would zero-default `llmCallCount` / tokens / `callSiteBreakdown` for older runs while `cost_aggregates` still reports `totalCostCents`, contradicting §8.2's "always present" contract with misleading numbers. Using `llm_requests_all` preserves archive-safety the same way System P&L already does (`server/services/systemPnlService.ts`). No schema change. See §5.4 and §8.2 for the exact query and response shape. |
| Modify | `shared/types/runCost.ts` | New shared type `RunCostResponse` with fields: `entityId`, `totalCostCents`, `requestCount`, `llmCallCount`, `totalTokensIn`, `totalTokensOut`, `callSiteBreakdown`. Create the file if it doesn't exist; else add the type. See §8.1 for the full shape. |
| Modify | `server/routes/__tests__/llmUsage.test.ts` | Add tests for the extended response shape. Create the file if it doesn't exist. |

**Total: 1 new component, 1 new test file, 3 page modifications + 2 delegated-component modifications (`SessionLogCardList.tsx`, `RunTraceView.tsx` — the pages themselves delegate rendering to these), 1 route handler modification, 1 shared type addition, 1 route test. ~450 LoC. `PlaybookRunDetailPage.tsx` was dropped from Phase A per Finding 3.1 HITL resolution; playbook-run cost visibility is deferred to a follow-up spec (§11.4 #10).**

### 4.2 Phase B — Success-gated memory promotion

| Action | Path | Role |
|---|---|---|
| Modify | `server/services/agentExecutionService.ts` | (a) Compute and persist `runResultStatus` when writing the normal terminal-completion row (around line 1175 where `status: finalStatus` is written). Derivation is the §6.3 truth table exactly — delegated to `computeRunResultStatus` (new pure helper; see row below). In short: `completed` + no error + no uncertainty + non-empty summary → `'success'`; `completed_with_uncertainty`, or `completed` with any of (error, uncertainty, empty summary) → `'partial'`; `failed \| timeout \| loop_detected \| budget_exceeded \| cancelled` → `'failed'`; non-terminal statuses (`pending \| running \| delegated \| awaiting_clarification \| waiting_on_clarification`) → `null` (do not write). (b) **Also set `runResultStatus: 'failed'` on the outer catch-path terminal write at line 1400** — today that branch sets `status: 'failed'` when an exception propagates out of the loop but does not populate `runResultStatus`, leaving the field null for the exception-failure cohort. `finalStatus` at that point is always `'failed'`, so `computeRunResultStatus('failed', true, false, false)` resolves to `'failed'` — include that in the same `.update({ ... })`. Without this, §6.9 #1's "zero null rows for terminal statuses" does not hold for any run that fails via thrown exception rather than graceful loop termination. (c) Pass the computed `outcome: { runResultStatus, trajectoryPassed: null, errorMessage: string \| null }` into the `extractRunInsights` call at line 1307. `trajectoryPassed` is always `null` in Phase B per §6.4; `errorMessage` is the `agent_runs.errorMessage` the caller already has in scope at the completion site. |
| Modify | `server/services/workspaceMemoryService.ts` | Extend `extractRunInsights(...)` signature at line 696 to accept an `outcome: { runResultStatus: 'success' \| 'partial' \| 'failed'; trajectoryPassed: boolean \| null; errorMessage: string \| null }` parameter **and** a trailing `options?: { taskSlug?: string; overrides?: { isUnverified?: boolean; provenanceConfidence?: number } }` bag (see §6.4 and §8.3). `taskSlug` moves inside the `options` bag; `overrides` lets non-terminal-run callers (today: `outcomeLearningService`) preserve pre-Phase-B `isUnverified` / `provenanceConfidence` semantics without widening `RunOutcome`. Branch extraction behaviour per §6 Phase B below. Do NOT modify the `deduplicateEntries` or `classifyDomainTopic` helpers. |
| Modify | `server/services/outcomeLearningService.ts` | Second caller of `extractRunInsights` (line 50). Update its call site to pass `outcome: { runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null }` **plus** `options.overrides: { isUnverified: false, provenanceConfidence: 0.7 }`. Rationale: the call writes a human-authored lesson from a review edit. The human-curation signal is stronger than 'partial' — the lesson was reviewed and approved by an operator. Pass `runResultStatus='partial'` so the §6.5 matrix's scoring branches stay `+0.00` (no promotion / no demotion, matching today's neutral-scoring behaviour), but override `isUnverified=false` and `provenanceConfidence=0.7` at the call site to preserve today's "run-sourced, verified" semantics — today's path writes `isUnverified=false` because `runId` is present and the §6.7 default would regress human-curated lessons to `isUnverified=true` + `provenanceConfidence=0.5`, silently dropping them out of retrieval pipelines that filter on `isUnverified=false` (see `memoryBlockSynthesisService.ts:126`, `memoryEntryQualityService.ts:252`). The override lives in the `outcomeLearningService` caller, not in `extractRunInsights` — the service remains pure for the cohort it was designed for (agent-run-terminal writes). See §6.7.1 and §8.3 `overrides` contract. |
| Modify | `server/services/agentRunFinalizationService.ts` | Second `runResultStatus` write site — `finaliseAgentRunFromIeeRun(ieeRun)` at line 84. Around line 259 / 278 where `finalStatus: resolvedStatus` is set, compute and include `runResultStatus` from the same `computeRunResultStatus` helper (see row below) so the IEE-delegated terminal path writes the field atomically with the status transition. Without this, delegated (IEE) runs finish with `runResultStatus=null` and Phase B's §6.3.1 write-once invariant does not hold for that cohort. See §6.3.1. |
| New | `server/services/workspaceMemoryServicePure.ts` | Extract the quality-scoring + entry-type-selection logic from `extractRunInsights` into a pure module: `scoreForOutcome(baseScore, entryType, outcome)` and `selectPromotedEntryType(rawEntryType, outcome)`. Keeps impure DB + LLM calls in the service file; moves decision logic to a file that can be tested without mocks. |
| Extend | `server/services/__tests__/workspaceMemoryServicePure.test.ts` | File already exists today (covers recency-boost math from Memory & Briefings §4.2 S2). Phase B extends it with pinned tests covering the full decision matrix: (success × each entryType) × (pass/fail/null trajectory) × (failure × each entryType). ~30-40 new test cases on top of the existing recency-boost suite. Pure exports only — no `options.overrides` coverage (overrides are row-write concerns, not decision-logic concerns; see the new `workspaceMemoryService.test.ts` below). |
| New or extend | `server/services/__tests__/workspaceMemoryService.test.ts` | Impure integration test — one focused `options.overrides` case (see §9.2). Calls `extractRunInsights` with a real-DB fixture and asserts the written `workspace_memory_entries` row honours `overrides.isUnverified` / `overrides.provenanceConfidence` when supplied, falling back to §6.7 defaults when either field is omitted. ~2 test cases, zero mocks on the DB. |
| New or extend | `server/services/agentExecutionServicePure.ts` | Export `computeRunResultStatus(finalStatus, hasError, hadUncertainty, hasSummary)` per §6.3. If the pure file already exists, add the export; else create it. This is the pure helper Phase B branches on. |
| New or extend | `server/services/__tests__/agentExecutionServicePure.test.ts` | Pin the §6.3 truth table for `computeRunResultStatus`. Every `finalStatus` × (`hasError`, `hadUncertainty`, `hasSummary`) cell covered. Plus the two edge cases in §9.2. |
| Modify | `server/services/memoryEntryQualityServicePure.ts` | Branch decay in `computeDecayFactor` by `entryType`: `observation` uses 7-day half-life; `pattern` + `decision` use 30-day half-life; `issue` uses 14-day half-life; `preference` uses 30-day half-life. Add `entryType` to `DecayParams` so the existing per-row call site can pass it in. The pure decay math lives here, not in `memoryEntryDecayJob.ts` (the job only orchestrates per-subaccount sweeps and calls `applyDecay` from the impure service). Default (unknown entryType) keeps today's single rate. |
| Modify | `server/services/memoryEntryQualityService.ts` | `applyDecay(subaccountId)` reads each row's `entryType` and passes it into `computeDecayFactor`. No new query — `entryType` is already selected in the existing row fetch. |
| New | `server/services/__tests__/memoryEntryQualityServicePure.test.ts` (or extend if present) | Pure test for per-entryType decay math. For each entryType in the branch table, verify score decays to `base * 0.5` after one half-life. Pin the default-branch fallback. |

Note: `server/db/schema/workspaceMemories.ts` is intentionally NOT listed here — Phase B uses only existing columns. See §4.5 for the confirmed "explicitly not modified" list.

**Total: 5 service modifications (agentExecutionService, workspaceMemoryService, outcomeLearningService, agentRunFinalizationService, memoryEntryQualityService), 4 new or extended pure files (includes `memoryEntryQualityServicePure.ts` decay-rate branching — the decay math lives in the pure service, not in the job), 4 new or extended test files (three pure + one impure `workspaceMemoryService.test.ts` for the `options.overrides` path). ~525 LoC. No schema migration. `memoryEntryDecayJob.ts` is NOT modified — it only orchestrates the per-subaccount sweep; the decay math lives in the pure file.**

### 4.3 Phase C — LLM router cost-breaker wire-up

| Action | Path | Role |
|---|---|---|
| Modify | `server/services/llmRouter.ts` | After the cost row has been written to `llm_requests` inside `routeCall`, call `assertWithinRunBudgetFromLedger({ runId, insertedLedgerRowId, subaccountAgentId, organisationId, correlationId })` when `runId` is present (see §7.4.1 — direct-ledger read path). `insertedLedgerRowId` is captured from the ledger insert's `.returning({ id })` result; the helper fails closed if it's missing or not visible (§7.3.1 invariant). Skip the call when `runId` is null (system / analyzer callers have no run context). The call is dynamic-imported to match the pattern in `sendToSlackService.ts:94`. |
| Modify | `server/lib/runCostBreaker.ts` | (a) Existing exported signatures unchanged — `resolveRunCostCeiling`, `getRunCostCents`, `assertWithinRunBudget` keep their current shapes. Slack (`sendToSlackService.ts:94`) and Whisper (`transcribeAudioService.ts:72`) continue to call `assertWithinRunBudget`, which reads from `cost_aggregates`. (b) **Add a new pair of sibling exports** — `getRunCostCentsFromLedger(runId): Promise<number>` (reads `SUM(cost_with_margin_cents) FROM llm_requests WHERE run_id = $1 AND status IN ('success', 'partial')` directly) and `assertWithinRunBudgetFromLedger(ctx)` (identical to `assertWithinRunBudget` in shape and throw behaviour but internally calls `getRunCostCentsFromLedger` instead of `getRunCostCents`). Only the LLM caller uses the new helpers. Rationale pinned in §7.4.1 — `cost_aggregates` is updated asynchronously by `routerJobService.enqueueAggregateUpdate` (see `llmRouter.ts:897`), so a rollup read would give a stale snapshot and inflate the worst-case overshoot by up to the aggregation lag. The direct-ledger read eliminates that rollup-lag window; the residual concurrency overshoot (bounded by the inflight batch × per-call cost, not by one call's cost — see §7.4 and §11.4 #9) remains because there is no per-run serialization around the insert-and-check sequence. (c) Add a JSDoc line on both `assertWithinRunBudget` and `assertWithinRunBudgetFromLedger` naming their canonical callers — the existing helper lists Slack + Whisper; the new helper lists `llmRouter.routeCall`. |
| New | `server/services/__tests__/llmRouterCostBreaker.test.ts` | Integration test: (a) call exceeds cap → throws `FailureError` with `failure_reason='internal_error'` and `failure_detail='cost_limit_exceeded'`; (b) call within cap → succeeds; (c) call with `runId=null` → no breaker invocation; (d) when the breaker trips, the ledger row has the router's normal success/error `status` value — **not** `'budget_blocked'` — because the row was written before the throw and the post-write breaker check is decoupled from ledger-status assignment; (e) concurrency test per §9.3 asserts the bounded-but-not-one-call-max behaviour — after a concurrent burst settles, any subsequent serial call trips the breaker; no assertion pins a strict one-call overshoot bound (see §7.4 / §11.4 #9). |
| Modify | `server/services/llmRouter.ts` comment block | Document the post-cost-record ordering: write ledger row first, then assert budget. Also document the direct-ledger-read choice and the §7.4.1 rationale. |

**Total: 1 router modification, 1 breaker code+JSDoc change, 1 new integration test. ~200 LoC.**

### 4.4 Cross-cutting — documentation + KNOWLEDGE

| Action | Path | Role |
|---|---|---|
| Modify | `architecture.md` | (a) §184 row already references `runCostBreaker` for `maxCostPerRunCents`; extend to note `llmRouter.routeCall` as a caller. (b) §552 already lists `runCostBreaker` callers for Slack/Whisper; add LLM router. (c) §1407 run cost circuit breaker section — add LLM router to the caller table. |
| Modify | `KNOWLEDGE.md` | Append any gotchas encountered during implementation (per §3 of `CLAUDE.md`). |
| Modify | `CLAUDE.md` | Update the "Current focus" pointer at the top when the build lands. No changes during spec-draft. |

### 4.5 Files explicitly NOT modified

To prevent scope creep, these files are out of scope regardless of what the implementation uncovers:

- `client/src/pages/SystemPnlPage.tsx` and `client/src/pages/PortalPage.tsx` — cost surface is already shipped and end-client visibility stays out of scope.
- `server/services/agentRunHandoffService.ts` and `agentRunHandoffServicePure.ts` — the handoff reads `runResultStatus` but we only newly populate it upstream; no handoff logic changes.
- `server/services/memoryCitationDetector.ts` — Phase B writes the memory; citation scoring runs unchanged on what's written.
- `server/services/trajectoryService.ts` and `trajectoryServicePure.ts` — Phase B does NOT consume `TrajectoryDiff.pass`. The `trajectoryPassed: boolean | null` field on `RunOutcome` is a reserved forward-compatible slot; Phase B callers pass `null` unconditionally because no per-run verdict is persisted today (`trajectoryService` exposes only `loadTrajectory` + `compare`). Once a future spec lands verdict persistence (§11.4 #6), the callers switch from `null` to the persisted value and the §6.5 matrix rows keyed on `trajectoryPassed=true/false` activate automatically. Zero changes to trajectory evaluation logic in this spec.
- `migrations/` — no new migration files. Every field referenced in this spec already exists on its table.
- `server/db/schema/workspaceMemories.ts` — Phase B uses existing columns (`qualityScore`, `entryType`, `provenanceSourceType`, `qualityScoreUpdater`).
- `server/db/schema/agentRuns.ts` — Phase B writes to the existing `runResultStatus` column.
- `server/config/actionRegistry.ts` and `server/services/skillExecutor.ts` — no new skills, no new actions.

---

## 5. Phase A — Per-run cost panel

### 5.1 Goal

Every direct agent-run surface must display, without extra clicks, how much that run cost in LLM spend. Today the endpoint is built and only `AdminAgentEditPage.tsx` consumes it; two other agent-run surfaces silently ignore the data. (Playbook-run cost aggregates across child agent-run IDs and is deferred to a follow-up spec — see §11.4 #10.)

### 5.2 Behaviour

The panel shows three things, top to bottom:

1. **Total cost.** USD, formatted as follows:
   - cost ≥ $1: two decimal places, e.g. `$12.47`.
   - $0.01 ≤ cost < $1: four decimal places, e.g. `$0.4712`.
   - cost > 0 but < $0.01: two significant figures, e.g. `$0.00038`.
   - cost = 0: "— no LLM spend recorded".
   - cost ≥ $1000: thousands separators, no decimals, e.g. `$12,345`. (Rare for a single run, but a runaway could produce it — display must not overflow layout.)
2. **Call count + tokens.** "N LLM calls · Xk tokens in / Yk tokens out". Tokens formatted with `k`/`M` suffixes when ≥ 1,000 / ≥ 1,000,000 to keep the string compact. Call count always shown as a raw integer — even in `compact=true`.
3. **Call-site split.** A two-row breakdown when `compact=false`: `app` (main Node process) and `worker` (background pg-boss workers / IEE). Each row shows cost and count. Hidden entirely in `compact=true` — but call count and tokens (item 2) remain visible even in compact mode.

When the run has zero LLM calls, the panel still renders with the "no LLM spend recorded" state rather than hiding — the empty state is information too (confirms the run didn't silently drop cost rows).

### 5.2.1 Only render for terminal runs

The cost panel renders only when the run has reached a **terminal status**. The canonical helper is `isTerminalRunStatus(status)` whose semantics live in `shared/runStatus.ts` (listed in `docs/spec-context.md` as an accepted primitive — single source of truth for run-status semantics). **Import site differs by layer:** server-side code imports from `shared/runStatus.ts` directly; client-side code imports from `client/src/lib/runStatus.ts` (the runtime mirror that keeps the same exports in lock-step because the client tsconfig does not resolve `shared/...` imports at bundle time). The module exports the `TERMINAL_RUN_STATUSES` array for iteration plus the Set-backed `isTerminalRunStatus()` helper for hot-path checks. Each host page (client-side) computes `runIsTerminal` with a tiny call: `import { isTerminalRunStatus } from '@/lib/runStatus'; const runIsTerminal = isTerminalRunStatus(run.status)`. For non-terminal statuses, the panel renders a static "Run in progress — cost available after completion" placeholder and does not call the cost endpoint.

Reasoning:

- Cost is write-once-per-call and accumulates during a run. Mid-run polling would show monotonically increasing numbers that confuse the operator.
- No polling is simpler than polling. Every time a page-load reads the cost endpoint, it gets a stable snapshot.
- The three pages that host the panel (`AgentRunHistoryPage`, `RunTraceViewerPage`, `AdminAgentEditPage`) already know the run's status because they display it. Passing the status (or a `runIsTerminal: boolean`) as an additional prop avoids the panel fetching run metadata just to decide whether to render.

The component API is therefore:

```tsx
interface RunCostPanelProps {
  runId: string;
  runIsTerminal: boolean;  // caller asserts; panel does not re-fetch
  compact?: boolean;       // default false
}
```

### 5.3 Component contract

```tsx
interface RunCostPanelProps {
  runId: string;
  runIsTerminal: boolean;  // caller asserts; panel does not re-fetch run metadata
  compact?: boolean;       // default false; renders inline one-liner when true
}
```

`runIsTerminal` is load-bearing per §5.2.1 — when `false`, the panel renders the static "Run in progress — cost available after completion" placeholder and does not call `/api/runs/:runId/cost`. The caller passes it from the run row it already has in state (all three host pages display the run's `status` already).

The component owns its own fetch lifecycle when `runIsTerminal === true` — no parent is expected to thread the cost state through. This is what lets the existing `AdminAgentEditPage.tsx:1697-1702` inline fetch retire: the component replaces 6 lines of state management with a single JSX element.

### 5.4 API extension

`GET /api/runs/:runId/cost` today returns the row from `cost_aggregates` keyed as `(entityType='run', entityId=runId, periodType='run', periodKey=runId)`. Phase A extends the response with two computed fields that the UI needs and that the DB can return cheaply:

All four new fields share the same status filter — `status IN ('success', 'partial')` — so every row on the UI refers to the same set of requests. The read source is the **`llm_requests_all` view** (migration 0189), which transparently unions live + archive ledger rows; a direct-`llm_requests` read would under-report on runs older than `LLM_LEDGER_RETENTION_MONTHS` (default 12 months) after the nightly archive job moves their rows into `llm_requests_archive`:

- `llmCallCount`: `COUNT(*) FROM llm_requests_all WHERE run_id = $1 AND status IN ('success', 'partial')`.
- `callSiteBreakdown`: `SELECT call_site, SUM(cost_with_margin_cents) AS cost_cents, COUNT(*) AS request_count FROM llm_requests_all WHERE run_id = $1 AND status IN ('success', 'partial') GROUP BY call_site`.
- `totalTokensIn`: `SUM(tokens_in) FROM llm_requests_all WHERE run_id = $1 AND status IN ('success', 'partial')`. Null-coerced to 0.
- `totalTokensOut`: `SUM(tokens_out) FROM llm_requests_all WHERE run_id = $1 AND status IN ('success', 'partial')`. Null-coerced to 0.

The `cost_aggregates` row provides `totalCostCents` and `requestCount` unchanged for backwards compatibility — these continue to match existing `cost_aggregates` semantics, which **include** cost from failed requests that incurred charges before erroring. This is the one intentional asymmetry: `totalCostCents` may exceed the sum of cost in `callSiteBreakdown` when failed calls recorded partial cost.

The asymmetry is called out inline in the response's JSDoc so frontend consumers aren't surprised. The UI shows `totalCostCents` as the headline because it matches what the org actually paid; the call-site split is the "successful traffic" view.

No schema change; one extra indexed query on `llm_requests(run_id)` (the view's `UNION ALL` picks up the same index on the live table plus the archive table's matching index).

Failed requests (`status IN ('error', 'timeout', 'parse_failure', 'aborted_by_caller', 'rate_limited', 'provider_unavailable', 'budget_blocked')`) are excluded from `llmCallCount`, `callSiteBreakdown`, and token sums.

**Retry semantics.** Cost is written per LLM call, at the router's ledger-insert step, never retroactively aggregated. A retry creates a **new `agent_runs` row with a new `runId`** — the cost ledger for the old run is frozen at whatever was spent before the retry started, and the new run accumulates from zero. `GET /api/runs/:runId/cost` always returns the cost for exactly that `runId`, never a parent+children rollup. If a product surface ever needs "cost across a retry chain", it must derive that from the runs' relationship metadata (e.g. `triggerContext.parentRunId` if set); the cost endpoint itself stays single-run-scoped.

### 5.5 Layout placement

| Host surface | Rendering component (where the panel actually goes) | Placement | Mode |
|---|---|---|---|
| `AgentRunHistoryPage.tsx` | `SessionLogCardList.tsx` | Inside each expanded run card, below the status line | `compact` |
| `RunTraceViewerPage.tsx` | `RunTraceView.tsx` | In the trace header strip, alongside duration + model | non-compact |
| `AdminAgentEditPage.tsx` | page itself (existing inline fetch site) | Replaces the inline fetch at line 1699 (post main merge `ea0f6c5`); renders beside expanded run entries | `compact` |

No tooltip, no popover, no "learn more" link. The panel is static information, not an interactive surface.

### 5.6 Loading + error states

- Loading: skeleton placeholder matching the final layout, not a spinner. Uses the `bg-[linear-gradient(...)]` shimmer pattern already present in `AgentRunHistoryPage.tsx:1705`.
- Error: inline line "Cost data unavailable" in muted text. No toast, no retry button. A 404 or 500 on `/api/runs/:runId/cost` is rare; when it happens it's almost always a permission issue that will resolve on page reload. Don't surface it aggressively.
- Stale-while-revalidate: no revalidation. Cost is write-once-per-run after completion; there's no reason to refetch on window focus.

### 5.7 Permissions

Endpoint already verifies `run.organisationId === req.orgId` at `llmUsage.ts:354-357`. No new permission check; the component fetches with the same credentials as the host page. Sub-account-level scoping is handled by the `runId` being unguessable plus the org check.

### 5.8 Accessibility

- Numeric values rendered in a `<dl>` (description list) with `<dt>` label + `<dd>` value pairs so screen readers announce field names.
- The call-site split uses a `<table>` not a flex layout.
- All cost strings include the currency symbol (`$0.47`), not bare numbers.

### 5.9 Done criteria for Phase A

1. On `AgentRunHistoryPage.tsx` and `RunTraceViewerPage.tsx`, a completed run shows total cost + call count + (for non-compact) call-site split without any extra user action. (`PlaybookRunDetailPage.tsx` was dropped from Phase A per §11.4 #10.)
2. `AdminAgentEditPage.tsx` no longer has an inline cost fetch; the `runCosts` state map is gone.
3. `RunCostPanel.test.tsx` passes the full matrix of states (loading, error, zero, non-zero, app-only, worker-only, mixed).
4. The extended `/api/runs/:runId/cost` response shape is covered by `llmUsage.test.ts`.
5. `npm run lint` and `npm run typecheck` pass.
6. Manual verification: open a completed run on a dev org, confirm the numbers match the System P&L page's aggregate for that run.

---

## 6. Phase B — Success-gated memory promotion

### 6.1 Goal

Distil successful agent runs into higher-quality, longer-lived semantic memory (`pattern` / `decision`) and keep failures as shorter-lived `issue` entries that feed future failure-avoidance — without introducing a new extraction pipeline or a second LLM call. One LLM call per run, same as today; the branching is entirely in post-processing.

### 6.2 Latent bug surfaced during spec draft

`agent_runs.runResultStatus` is declared on the schema (`server/db/schema/agentRuns.ts:46`) with type `'success' | 'partial' | 'failed'`, is consumed by `agentRunHandoffServicePure.ts:63`, and has test fixtures in `agentRunHandoffServicePure.test.ts`. However, **it is never written** by `agentExecutionService.ts` — `grep "runResultStatus"` across the service file returns zero matches. This is a pre-existing latent bug; Phase B cannot branch on a field that is always `null`.

Phase B fixes this in-passing. The field gets populated at the same place `status: finalStatus` is already written (around line 1175), using the derivation rule in §6.3. This is not scope creep — the field was specified to be populated; Phase B just finally populates it.

### 6.2.1 Run state model — where it lives today

This spec does not introduce or redefine the run state machine; it signposts what already exists so Phase B's derivation rule (§6.3) is grounded.

Automation OS already has a two-axis run state model:

- **Execution status** — `agent_runs.status` (`server/db/schema/agentRuns.ts:90`). A 12-value enum covering the run's position in the execution lifecycle: `pending | running | delegated | completed | failed | timeout | cancelled | loop_detected | budget_exceeded | awaiting_clarification | waiting_on_clarification | completed_with_uncertainty`. Stable; governs the loop + scheduler.
- **Result status** — `agent_runs.runResultStatus` (`server/db/schema/agentRuns.ts:46`). A 3-value enum: `success | partial | failed`. Declared for several releases but never written; Phase B finally populates it.

Phase B does not alter or extend either enum. §6.3 is a pure mapping from the existing execution-status-at-terminal into the existing result-status enum. Transition tables, retry semantics, and replay semantics are governed by the pre-existing loop + scheduler and are out of scope for this spec.

### 6.3 `runResultStatus` derivation rule

Applied at run completion inside `agentExecutionService.ts::finishLoop` where `finalStatus` is computed:

| Input | Output |
|---|---|
| `finalStatus === 'completed'` AND `!errorMessage` AND `!hadUncertainty` AND `loopResult.summary` is non-empty | `'success'` |
| `finalStatus === 'completed'` AND (`hadUncertainty` OR `errorMessage` OR empty summary) | `'partial'` |
| `finalStatus === 'failed'` OR `'timeout'` OR `'loop_detected'` OR `'budget_exceeded'` OR `'cancelled'` | `'failed'` |
| `finalStatus IN ('pending', 'running', 'delegated', 'awaiting_clarification', 'waiting_on_clarification')` | leave `null` (run not terminal) |
| `finalStatus === 'completed_with_uncertainty'` | `'partial'` |

This derivation is a pure function `computeRunResultStatus(finalStatus, hasError, hadUncertainty, hasSummary): 'success' \| 'partial' \| 'failed' \| null` and lives in a new `agentExecutionServicePure.ts` or an appropriate existing pure file. The test suite pins the full truth table.

### 6.3.1 Write-once invariant

`runResultStatus` is **write-once for terminal runs**. Once a non-null value has been persisted for a given `agent_runs` row, no code path may overwrite it. Consumers (handoff service, memory extraction, analytics, the new Phase A cost panel once it surfaces the field) treat it as canonical; re-derivation after the fact would silently diverge from memory rows that were already written.

Implementation:

- The write happens exactly once per run, at one of three terminal-write sites (listed below). `runResultStatus` joins the same `.update({ ... })` as `status: finalStatus` so it is committed atomically with the terminal status.
- Any later code path that touches `agent_runs` for a completed run (e.g. backfill scripts, admin-tool corrections) must not `SET run_result_status = ...`. If such a path is ever needed, it requires a separate spec.
- **SQL-level guard at the write site.** Each of the three terminal `UPDATE agent_runs SET status = ..., run_result_status = ...` statements adds `AND run_result_status IS NULL` to its `WHERE` clause (alongside the existing `WHERE id = :runId`) and uses `.returning({ id: agentRuns.id })` to detect whether the update actually committed. Drizzle syntax: `.update(agentRuns).set({ status, runResultStatus, ... }).where(and(eq(agentRuns.id, runId), isNull(agentRuns.runResultStatus))).returning({ id: agentRuns.id })`. A second write on the same row becomes a zero-row UPDATE at the DB level — no exception, no race, no dependency on a service-boundary helper. After the UPDATE, each site inspects the returned array; if `updated.length === 0`, log `runResultStatus.write_skipped` at `warn` level with `{ runId, attemptedStatus }` and continue (the first writer's value is authoritative). Using `.returning()` rather than the driver's raw `rowCount` is deliberate — `.returning()` is the idiomatic Drizzle pattern in this codebase (e.g. `agentExecutionService.ts`, `agentRunFinalizationService.ts`, `agentBeliefService.ts`) and avoids the affected-row-count drift that some PG driver paths exhibit. This is the full enforcement — no trigger, no check constraint, no service-boundary wrapper function. The three write sites listed in §4.2 are all updated in the same commit:
  1. `agentExecutionService.ts::finishLoop` **normal terminal write** (around line 1175). Derived via `computeRunResultStatus` from the in-scope `finalStatus` / `hasError` / `hadUncertainty` / `hasSummary`.
  2. `agentExecutionService.ts` **outer catch-path terminal write** (around line 1400). When an exception propagates out of the loop, `status` is set to `'failed'` and `errorMessage` captures the exception. `runResultStatus` is set to `'failed'` in the same `.update({ ... })` — derived as `computeRunResultStatus('failed', true, false, false)` for consistency with the pure helper.
  3. `agentRunFinalizationService.ts::finaliseAgentRunFromIeeRun` (around lines 259 / 278). IEE-delegated terminal path; `runResultStatus` derived via the same `computeRunResultStatus` helper on the resolved IEE inputs.

The IEE finalizer writes `finalStatus: resolvedStatus` at two sites in `agentRunFinalizationService.ts` (around lines 259 and 278) — both flow through the same `computeRunResultStatus` helper so the IEE path produces identical derivations from identical inputs as the main path. The catch-path write in `agentExecutionService.ts` deterministically sets `runResultStatus='failed'` because `status` at that branch is always `'failed'`.

### 6.3.2 Legacy runs — pre-spec runs carry NULL runResultStatus

Every `agent_runs` row written before this spec ships has `runResultStatus = NULL`. We do not backfill. NULL is therefore the canonical "legacy or not yet terminal" marker, and every consumer that branches on `runResultStatus` must handle NULL explicitly:

- **Phase B memory extraction.** The new `outcome` parameter (§6.4) is required; callers must pass a non-null `runResultStatus`. The only caller is the terminal-write path in `agentExecutionService.ts`, which derives `runResultStatus` at that point. Historical runs never re-enter this path, so no NULL ever reaches `extractRunInsights`.
- **Phase A cost panel.** Cost rendering does not depend on `runResultStatus`; NULL is immaterial.
- **Handoff service** (pre-existing consumer at `agentRunHandoffService.ts:174`) already tolerates NULL (declared as `'success' | 'partial' | 'failed' | null`); no change needed.

Existing historical memory entries (written under the old "generic observation on every completion" logic) keep their existing `qualityScore`, `isUnverified=false`, and `qualityScoreUpdater='initial_score'` values. They co-exist with new Phase B entries. No backfill, no rolloutDate cutoff. Any future feature that wants to distinguish "legacy" entries can filter on `qualityScoreUpdater='initial_score'` plus a `createdAt` bound.

### 6.4 `extractRunInsights` extended signature

Current signature (`workspaceMemoryService.ts:696`):

```ts
async extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  taskSlug?: string,
): Promise<void>
```

New signature:

```ts
async extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  outcome: {
    runResultStatus: 'success' | 'partial' | 'failed';
    trajectoryPassed: boolean | null;
    errorMessage: string | null;
  },
  options?: {
    taskSlug?: string;
    overrides?: {
      isUnverified?: boolean;
      provenanceConfidence?: number;
    };
  },
): Promise<void>
```

`taskSlug` moves inside the `options` bag alongside `overrides`. Both are optional — omit the bag entirely and Phase B falls back to the §6.7 defaults. See §8.3 for the full `ExtractRunInsightsOptions` contract and §6.7.1 for the override semantics.

The `outcome` parameter is required — callers must supply it. There are two callers today:

1. `server/services/agentExecutionService.ts:1307` — the primary run-completion path. Passes the computed outcome from §6.3.
2. `server/services/outcomeLearningService.ts:50` — the human-review-edit lesson-capture path. Passes `{ runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null }` **plus** `options.overrides = { isUnverified: false, provenanceConfidence: 0.7 }` (see §4.2 and the `overrides` contract in §8.3). The `'partial'` outcome keeps §6.5 scoring neutral (`+0.00`, no promotion/demotion); the overrides preserve the "run-sourced, verified" semantics that today's path implicitly relies on (today writes `isUnverified=false` because `runId` is present). Without the overrides, Phase B's §6.7 default would flip human-curated lessons to `isUnverified=true` + `provenanceConfidence=0.5`, silently dropping them out of retrieval pipelines that filter on `isUnverified=false`. The override surface is call-site-only — `extractRunInsights` itself stays neutral with respect to caller semantics.

Both call sites are updated in the same commit as the signature change; breakage is contained.

`trajectoryPassed` is always `null` in Phase B. No trajectory-verdict persistence exists today (`trajectoryService` exposes only `loadTrajectory(runId)` and `compare(actual, expected)` — no per-run verdict is persisted and §4.5 pins `trajectoryService.ts` as not modified). Phase B callers therefore pass `null` unconditionally. The §6.5 matrix rows keyed on `trajectoryPassed === true`/`false` remain in the spec as forward-compatible stubs that activate automatically once a future spec lands a persisted verdict (see §11.4 deferred item #6).

`errorMessage` is passed through from the `agent_runs` row the caller already has in scope at the extraction site. It is the single source of truth for the §6.8 short-summary guard's `hasStructuredError` signal — the service does not re-read it. When the run has no error message (successful or partial runs), the caller passes `null`.

### 6.5 Decision matrix — entry type + quality score

The current extraction path asks the LLM to classify each insight as `observation | decision | preference | issue | pattern`. Phase B respects the LLM's classification but applies a post-processing rule that:

1. Promotes low-confidence `observation` entries to `pattern` or `decision` when the outcome signals high confidence.
2. Demotes any entry type to `issue` when the outcome is a failure.
3. Boosts `qualityScore` for successful outcomes, dampens for failures.

> **Note on `trajectoryPassed` in Phase B.** Per §6.4, Phase B callers pass `trajectoryPassed = null` unconditionally (no persisted verdict exists today). The `true` / `false` rows below are forward-compatible stubs that activate automatically once a future spec lands the trajectory-verdict persistence described in §11.4 item #6. Until then, only the rows where `trajectoryPassed === null` (and, at the service boundary, `partial` / `failed` rows whose result is independent of trajectory) are reachable from the actual callers. Pure-test coverage still exercises every row.

Full matrix:

| runResultStatus | trajectoryPassed | LLM-classified entryType | Final entryType | Quality score modifier (applied on top of baseline) |
|---|---|---|---|---|
| `success` | `true` | `observation` | `pattern` (promoted) | +0.20 |
| `success` | `true` | `decision` | `decision` (kept) | +0.20 |
| `success` | `true` | `pattern` | `pattern` (kept) | +0.20 |
| `success` | `true` | `preference` | `preference` (kept) | +0.15 |
| `success` | `true` | `issue` | `issue` (kept — successful run still had an issue worth recording) | +0.00 |
| `success` | `null` | `observation` | `pattern` (promoted) | +0.10 |
| `success` | `null` | `decision` | `decision` (kept) | +0.10 |
| `success` | `null` | any other | kept | +0.10 |
| `success` | `false` | `observation` | `observation` (kept — no promotion despite success, because trajectory says the run went off-track) | +0.00 |
| `success` | `false` | `decision` | `observation` (demoted — we trusted the LLM but trajectory says otherwise) | +0.00 |
| `success` | `false` | `pattern` | `observation` (demoted — same reason) | +0.00 |
| `success` | `false` | `preference` | `preference` (kept — user preference stands regardless of trajectory verdict; trajectory judges the path, not the user's stated preference) | +0.00 |
| `success` | `false` | `issue` | `issue` (kept — an issue surfaced during a trajectory-fail is still useful signal) | +0.00 |
| `partial` | any | any | kept, unchanged | +0.00 |
| `failed` | any | `observation` or `pattern` or `decision` | `issue` (force demoted — a failed run cannot produce a durable pattern) | −0.10 |
| `failed` | any | `issue` | `issue` (kept) | +0.00 (failures reinforce `issue` entries without penalty) |
| `failed` | any | `preference` | downgraded to `observation` (preserves the signal — a failed run may still reveal a valid preference — but doesn't elevate it to the durable `preference` tier) | −0.10 |

Quality score modifiers apply on top of the existing `scoreMemoryEntry(entry)` baseline. Final score clamped to `[0.0, 1.0]`.

`qualityScoreUpdater` is set to `'initial_score'` at insert time (same as non-Phase-B writes). The DB-level `workspace_memory_entries_quality_score_updater_check` CHECK constraint (`migrations/0150_pr_review_hardening.sql:21-24`) and the BEFORE UPDATE trigger (`migrations/0150_pr_review_hardening.sql:72-98`) pin the allowed updater set to `'initial_score' | 'system_decay_job' | 'system_utility_job'`; §3 / §4.5 forbid schema changes, so Phase B does not introduce a new `'outcome_bump'` updater value. Outcome-driven boosts are distinguished post-hoc via two existing signals that do not require a new DB column:

- `provenanceConfidence` (§6.7) is keyed by outcome — `0.9` / `0.7` / `0.5` / `0.3` across success+pass, plain success, partial, failed respectively.
- The new `memory.insights.outcome_applied` structured log event (§8.5) records `runResultStatus`, `trajectoryPassed`, and promotion counts per extraction call.

Auditors reconstruct "was a modifier applied to this row?" by joining `workspace_memory_entries.provenanceConfidence` (and optionally replaying the pure `scoreMemoryEntry` baseline) rather than by reading `qualityScoreUpdater`. The quality-score-modifier column above is titled "Quality score modifier (applied on top of baseline)" to make clear that the row's stored `qualityScore` includes the modifier even though `qualityScoreUpdater` stays `'initial_score'`.

### 6.6 Decay cadence per entry type

`memoryEntryQualityServicePure.ts::computeDecayFactor` today applies a single decay rate across all entries (the `DECAY_RATE` constant from `server/config/limits.ts`). `memoryEntryDecayJob.ts` only orchestrates the per-subaccount sweep (calling `applyDecay` / `pruneLowQuality` from `memoryEntryQualityService.ts`) and does not hold the math. Phase B branches the rate in the pure helper by `entryType`:

| entryType | Half-life (days) | Rationale |
|---|---|---|
| `observation` | 7 | Raw run signal; loses relevance quickly |
| `issue` | 14 | Useful until pattern crystallises or is resolved |
| `preference` | 30 | User-stated; stable |
| `pattern` | 30 | Distilled; long-term reusable |
| `decision` | 30 | Distilled; long-term reusable |

Implementation: `applyDecay` (in `memoryEntryQualityService.ts`) already iterates every row with `entryType` in scope; it passes `entryType` into `computeDecayFactor` (in `memoryEntryQualityServicePure.ts`), which branches the rate via a lookup table keyed on `entryType`. The existing decay formula stays intact; only the rate parameter branches. `memoryEntryDecayJob.ts` orchestrates the sweep and is not modified. A pure test pins the math for each entry type in `memoryEntryQualityServicePure.test.ts`.

### 6.7 Provenance and updater fields

Every row Phase B writes sets:

- `provenanceSourceType = 'agent_run'` (unchanged)
- `provenanceSourceId = runId` (unchanged)
- `provenanceConfidence`: `0.9` when `runResultStatus='success' && trajectoryPassed===true`; `0.7` for plain success; `0.5` for partial; `0.3` for failure. Replaces today's `null`.
- `isUnverified = runResultStatus !== 'success'` — semantically, a non-success outcome leaves memory entries in an "needs corroboration" state.
- `qualityScoreUpdater`: always `'initial_score'` at insert (matches pre-Phase-B behaviour and the existing CHECK constraint / BEFORE UPDATE trigger in `migrations/0150_pr_review_hardening.sql`). Outcome-driven boosts are surfaced through `provenanceConfidence` above (0.9 / 0.7 / 0.5 / 0.3 per outcome) and the new `memory.insights.outcome_applied` log event (§8.5); no new DB updater value is introduced. See §6.5 rationale.

No schema change required — all four columns already exist.

#### 6.7.1 Semantics change for `isUnverified` — compatibility assessment

Before Phase B, `isUnverified` was set at `workspaceMemoryService.ts:788` as `!runId`, i.e. `true` only for manual or drop-zone inserts that had no `runId`. Run-sourced entries were always `isUnverified = false` regardless of the run's outcome. Phase B changes this to `isUnverified = runResultStatus !== 'success'` for run-sourced entries, which flips a subset of new entries (partial + failed runs) to `true` — while pre-existing rows are untouched.

Compatibility check before merging Phase B:

1. **Grep every consumer of `isUnverified`** — `server/` and `client/` — and verify each handles `true` for run-sourced entries without surprise. Expected callers: retrieval pipelines (which may filter on it), admin panels (which may display it).
2. **Retrieval filters.** If any retrieval path has an implicit assumption "`isUnverified=true` means non-run-sourced, discount heavily", re-examine — Phase B makes partial-run entries `isUnverified=true` and those entries are still worth retrieving (they're neutral, not wrong).
3. **Display strings.** If any UI renders `isUnverified` as "user input" or similar, update the copy to reflect the new meaning: "not yet corroborated" regardless of source.
4. **Test fixtures.** Update any test fixture that hard-codes `isUnverified: false` for a run-sourced entry with a non-success outcome.

If the grep reveals a consumer that cannot safely absorb the new semantics, the remediation is to fix that consumer in the same commit — update its filter, adjust its display copy, or widen its expectations. Adding a new column is **not an option** for Phase B: §3 lists "no new columns" as out of scope, §4.5 lists `workspaceMemories.ts` as not modified, and §8.4 states "No migrations". If a blocker surfaces that cannot be fixed by updating the consumer, Phase B's `isUnverified` semantics change is deferred to a follow-up spec — not worked around with a new column.

**Caller-specific exception — human-curated content.** Callers that write human-authored content (e.g. `outcomeLearningService`, which captures lessons from operator-edited review approvals) override `isUnverified` and `provenanceConfidence` explicitly via the `options.overrides` bag on `extractRunInsights` (see §8.3). The §6.7 semantics change described above — "`isUnverified = runResultStatus !== 'success'`" for run-sourced entries — applies only to the terminal-run cohort `extractRunInsights` was designed for. The override is load-bearing: without it, today's path (which writes `isUnverified=false` because `runId` is present) would regress to `isUnverified=true` + `provenanceConfidence=0.5` after Phase B, silently dropping human-curated lessons out of retrieval pipelines that filter on `isUnverified=false` (`memoryBlockSynthesisService.ts:126`, `memoryEntryQualityService.ts:252`). The override is therefore not a convenience — it is the minimum patch that preserves today's retrieval behaviour for the human-curated cohort without widening `RunOutcome` or overloading `runResultStatus='success'` to mean "or human-reviewed content".

### 6.8 Short-summary guard on failed runs

The existing `if (!runSummary || runSummary.trim().length < 20) return;` guard at `workspaceMemoryService.ts:704` stays as-is. Phase B adds one further guard, using structured signals only — no string heuristics:

```ts
// Skip memory extraction when a failed run carries no meaningful signal.
// Rationale: "Request timed out." / "API error." style summaries on failed
// runs produce low-value `issue` entries that clog retrieval.
const hasStructuredError = Boolean(outcome.errorMessage && outcome.errorMessage.length > 0);
const hasMeaningfulSummary = runSummary.trim().length >= 100;
if (outcome.runResultStatus === 'failed' && !hasStructuredError && !hasMeaningfulSummary) {
  return;
}
```

Two independent structured signals, either of which is sufficient to keep the extraction running:

- `outcome.errorMessage` is set — the failure has a structured diagnostic; the `issue` entry has context. (Sourced from `agent_runs.errorMessage` at the caller; see §6.4.)
- `runSummary.trim().length >= 100` — the run produced enough narrative to distil regardless of structured diagnostics.

No language-dependent substring matching. If both signals are absent, the run did not yield useful learning and we skip rather than write a low-value `issue` that will dilute future retrieval.

### 6.8.1 Idempotency

Phase B does not introduce any new write paths — it modifies post-processing of entries that `extractRunInsights` already writes. The existing deduplication contract (`deduplicateEntries` in `workspaceMemoryService.ts`) is what prevents duplicates across retries, replays, and partial failures. Phase B preserves that contract:

- `selectPromotedEntryType` and `scoreForOutcome` are **pure** — rerunning them on the same inputs yields the same outputs. A retry that re-enters `extractRunInsights` with the same `(runId, summary, outcome)` produces the same candidate entry set.
- The dedup key used by `deduplicateEntries` is content-based, not outcome-based. A retry on a run whose outcome has been corrected (see §6.3.1 — this should not happen, but defensively) would hit the existing dedup path and update rather than insert.
- The `qualityScoreUpdater` field stays `'initial_score'` for Phase B writes (see §6.5 / §6.7 / §8.4 — no new updater value is introduced because §3 / §4.5 forbid a schema change and `migrations/0150`'s CHECK constraint + trigger block inserts / updates of unknown values). Downstream auditors reconcile outcome-boost application by joining `provenanceConfidence` and replaying the pure `scoreMemoryEntry` baseline.

Rule: Phase B must not introduce any new ADD-style write that bypasses `deduplicateEntries`. If a new write path ever becomes necessary, it needs its own spec and its own dedup key.

### 6.8.2 Partial runs are intentionally neutral

Every row in the §6.5 matrix where `runResultStatus='partial'` is "kept, unchanged" with a `+0.00` score modifier. This is deliberate and worth calling out because future readers may assume it's an oversight:

- **We do not promote on partial**, because the outcome is ambiguous — a run that ended `completed_with_uncertainty` might have the right answer or might not.
- **We do not demote on partial**, because the extraction is still useful signal — an uncertain agent can still surface a valid preference or issue.
- **Provenance confidence is set to 0.5** (§6.7), which is the "no strong signal either way" midpoint.
- **`isUnverified` is set to `true`** on partial entries (same as failed — any non-success triggers the flag), so downstream retrieval can filter them if needed.

Result: partial-run entries coexist with success and failure entries in the same tables, at the neutral midpoint, with their uncertainty visible on the row. Retrieval pipelines can bias for or against them by filtering on `provenanceConfidence` or `isUnverified`.

### 6.9 Done criteria for Phase B

1. `agent_runs.runResultStatus` is populated on every terminal run — verified by a query on a seeded dev DB returning zero null rows for terminal statuses.
2. A successful run with 3 LLM-classified insights produces 3 memory entries all with `qualityScore` ≥ 0.6 + appropriate `entryType` promotion.
3. A failed run produces only `issue` entries, with one exception: LLM-classified `preference` entries are demoted to `observation` rather than to `issue` (§6.5 matrix — preserves the signal without elevating to the durable `preference` tier). No `pattern` / `decision` leakage from a failed run.
4. A failed run with a summary under 100 chars AND `outcome.errorMessage` null/empty skips memory writes (per §6.8 — both structured signals absent). Runs with either signal present still extract.
5. `workspaceMemoryServicePure.test.ts` covers the full decision matrix (~30 cases) and all tests pass.
6. `memoryEntryQualityServicePure.test.ts` pins per-entryType decay (the decay math lives in that pure file — `memoryEntryDecayJob.ts` only orchestrates the sweep).
7. `npm run lint` and `npm run typecheck` pass.

---

## 7. Phase C — LLM router cost-breaker wire-up

### 7.1 Goal

A runaway agent loop cannot blow through the configured `maxCostPerRunCents` ceiling. Today it can — the breaker exists, but the LLM call path (the dominant cost surface) never invokes it. Slack and Whisper calls are correctly gated. LLM calls are not.

### 7.2 The existing primitive

`server/lib/runCostBreaker.ts` ships three exports — all unchanged by Phase C:

- `resolveRunCostCeiling(ctx)` — reads `subaccountAgents.maxCostPerRunCents` (with fallback to a system default of 100 cents).
- `getRunCostCents(runId)` — reads running spend from `cost_aggregates`.
- `assertWithinRunBudget(ctx)` — throws `FailureError('internal_error', 'cost_limit_exceeded', {...})` when spent > limit.

Callers today:

- `server/services/sendToSlackService.ts:94`
- `server/services/transcribeAudioService.ts:72`

Callers missing:

- `server/services/llmRouter.ts::routeCall` — the gap Phase C closes.

### 7.2.1 Breaker scope, persistence, reset — pinned

To prevent later ambiguity:

- **Scope: per-run.** The breaker aggregates cost for a single `agent_runs.id` and compares against `subaccountAgents.maxCostPerRunCents`. Not per-agent (an agent with 100 legitimate runs should not trip on run 101 because earlier runs accumulated spend). Not per-org (org-level caps are a separate mechanism via `orgBudgets.monthlyCostLimitCents` + `budgetService.checkAndReserve`).
- **Persistence: stateless helper, reads persisted ledger.** `runCostBreaker.ts` holds no in-memory state. Every `assertWithinRunBudget` call (Slack/Whisper) and `assertWithinRunBudgetFromLedger` call (LLM caller, per §7.3) reads fresh from `cost_aggregates` or `llm_requests_all` respectively. There is no breaker state to leak; the source of truth is the persisted cost ledger.
- **Reset: implicit, on new run.** A retry or replay produces a new `agent_runs` row with a new `runId`. The new run has zero accumulated cost in the ledger, so the breaker starts fresh. This is by design — a retry is a second attempt at the same work, not a continuation of the first attempt's spend. If a misconfigured task systematically retries and each retry hits the breaker, that is intended signal; the org-level `monthlyCostLimitCents` catches cumulative cost across retries.
- **Failure-loop protection is NOT the breaker's job.** Per-run breaker does one thing well: stop a single run from exceeding its ceiling. Cross-run spend monitoring is the org-level cap's responsibility.
- **Explicit cross-run delegation.** System safety against cross-run retry loops, scheduler-driven retry storms, and runaway task-creation cascades is delegated to (a) `orgBudgets.monthlyCostLimitCents` enforcement in `budgetService.checkAndReserve` and (b) scheduler-level limits: `agents.maxConcurrentRuns`, `concurrencyPolicy`, and `catchUpPolicy` / `catchUpCap`. Phase C is **single-run-scoped by design** and does not attempt to bound cross-run spend.

### 7.3 Where to insert the call

Inside `routeCall`, after the ledger row is successfully inserted (currently at line 778 of the post-call success path, post main merge `ea0f6c5` which landed the in-flight tracker) and before the provider response is returned to the caller. Three ledger-write paths exist in the router: the early-fail path (~line 463), the alternate/partial path (~line 935), and the post-call path (~line 778). Phase C wires the breaker only on the post-call path — the other two paths either represent a cap trip of a different kind or have no cost to check against.

Pseudocode at the insertion point:

```ts
// ── 12. Write ledger (existing) — captures inserted row id ────
const insertedRows = await db.insert(llmRequests).values({ ... })
  .returning({ id: llmRequests.id });
const insertedLedgerRowId = insertedRows[0]?.id ?? null;

// ── 12a. Phase C — runaway-loop ceiling ────────────────────────
const breakerRunId = ctx.runId ?? await resolveRunIdFromIee(ctx);
if (breakerRunId) {
  try {
    // Direct-ledger read path — see §7.4.1. The LLM caller reads cost from
    // `llm_requests` (not `cost_aggregates`) because `cost_aggregates` is
    // updated asynchronously by `routerJobService.enqueueAggregateUpdate`.
    // Slack / Whisper callers continue to call the unchanged
    // `assertWithinRunBudget`, which reads from `cost_aggregates`.
    //
    // `insertedLedgerRowId` is REQUIRED (see §7.3.1 ledger-visibility
    // invariant). The helper verifies the row is readable before running
    // the aggregate; a future refactor that moves or skips the ledger
    // write fails closed here rather than silently producing a stale
    // breaker read.
    const { assertWithinRunBudgetFromLedger } = await import('../lib/runCostBreaker.js');
    await assertWithinRunBudgetFromLedger({
      runId: breakerRunId,
      insertedLedgerRowId,
      subaccountAgentId: ctx.subaccountAgentId ?? null,
      organisationId: ctx.organisationId,
      correlationId: ctx.correlationId ?? idempotencyKey,
    });
    logger.debug('costBreaker.checked', {
      runId: breakerRunId,
      correlationId: ctx.correlationId ?? idempotencyKey,
    });
  } catch (err) {
    // Fail-open on breaker infrastructure errors. A `FailureError` with
    // detail='cost_limit_exceeded' is the intended trip and must propagate.
    // Any other error (DB read timeout, module import failure, unexpected
    // throw from the breaker internals) is an infrastructure failure — we
    // log and allow the LLM response to be returned. The cost row is
    // already written; cost attribution is intact either way.
    if (err instanceof FailureError && err.reason === 'internal_error'
        && err.detail === 'cost_limit_exceeded') {
      throw err;
    }
    logger.error('costBreaker.infra_failure', {
      runId: breakerRunId,
      correlationId: ctx.correlationId ?? idempotencyKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── 13. Return to caller (existing) ───────────────────────────
return providerResponse;
```

Dynamic import matches the existing pattern in `sendToSlackService.ts` — avoids a module-cycle hazard with the router.

**In-flight registry ordering (post main merge `ea0f6c5`).** The in-flight tracker merged into main from PR #161 wraps each attempt with `inflightRegistry.add()` before the provider call and `inflightRegistry.remove()` + `inflightRegistry.updateLedgerLink()` after the ledger insert. Phase C's breaker call sits **after** `inflightRegistry.updateLedgerLink()` so that by the time the breaker reads the cost ledger, the in-flight entry has been settled to a persisted row. Order at the insertion point: `insert(llmRequests)` → `inflightRegistry.updateLedgerLink()` → Phase C breaker check → `inflightRegistry.remove()` on cleanup path. If the breaker throws `cost_limit_exceeded`, the cleanup path still fires so no ghost in-flight rows persist; this is verified by test scenario #5 in §9.3.1. Verify current line numbers at implementation time — the registry hooks are new and other router refactors may shift insertion positions.

**Fail-open rationale.** The breaker is secondary protection — a belt-and-braces ceiling on top of per-call cost tracking. If the breaker itself fails (DB outage during the read, unexpected throw), we must not take down the LLM request path, which is the primary business function. The cost row is already written in step 12, so cost attribution is intact; losing one enforcement window is preferable to a system-wide outage caused by a breaker infrastructure bug. A `costBreaker.infra_failure` alert lets ops notice and fix without customer-visible impact.

**`costBreaker.checked` debug log.** One line per LLM call at `debug` level. This is the highest-volume breaker caller (LLM calls dwarf Slack + Whisper by volume), so the log is deliberately debug-only — never emitted at info or higher, never surfaced to customers. Its sole purpose is to let us grep for a specific run's check history when investigating a reported trip.

### 7.3.1 Ledger-visibility invariant — structurally enforced

The pseudocode above makes one thing a type-level contract rather than a comment: `assertWithinRunBudgetFromLedger` takes `insertedLedgerRowId: string | null` as a **required** parameter. The helper implements the following invariant:

```ts
export async function assertWithinRunBudgetFromLedger(
  ctx: RunCostBreakerFromLedgerContext,
): Promise<void> {
  // Fail-closed: if we got here without a ledger row id, either the
  // ledger write was skipped (contract violation) or a future refactor
  // re-ordered operations. Either way, refusing the call surfaces the
  // bug immediately rather than silently producing a stale breaker read.
  if (!ctx.insertedLedgerRowId) {
    throw new FailureError(
      failure('internal_error', 'breaker_no_ledger_link', {
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }

  // Visibility check: the row the caller just wrote must be readable by
  // this connection. If not, we have either (a) an uncommitted transaction
  // in the caller, or (b) a cross-connection replication-lag anomaly.
  // Both are contract violations; fail closed.
  const found = await db
    .select({ id: llmRequests.id })
    .from(llmRequests)
    .where(eq(llmRequests.id, ctx.insertedLedgerRowId))
    .limit(1);
  if (found.length === 0) {
    throw new FailureError(
      failure('internal_error', 'breaker_ledger_not_visible', {
        runId: ctx.runId,
        insertedLedgerRowId: ctx.insertedLedgerRowId,
        correlationId: ctx.correlationId,
      }),
    );
  }

  // Now safe to run the cost aggregate. The row we just wrote is
  // visible, therefore the SUM query will include it.
  const spent = await sumRunCostFromLedger(ctx.runId);
  const limit = await resolveRunCostCeiling(ctx);
  if (spent > limit) {
    throw new FailureError(
      failure('internal_error', 'cost_limit_exceeded', {
        spentCents: spent,
        limitCents: limit,
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }
}
```

What this buys:

1. **Ordering enforcement.** A future refactor that swaps the breaker call above the ledger insert fails at the visibility check (the row doesn't exist yet), not silently.
2. **Transaction-context enforcement.** If someone wraps the insert in a still-open transaction and runs the breaker on a different connection, the visibility check fails. This surfaces the contract violation at the earliest possible point.
3. **Typed coupling.** `insertedLedgerRowId` is typed `string | null`, not defaulted. TypeScript catches call sites that forget to pass it at compile time.

The existing `assertWithinRunBudget` (used by Slack and Whisper) is unchanged. It reads from `cost_aggregates` and does not need the ledger-visibility check because its aggregation is always post-commit and the Slack/Whisper flows are simple linear paths with no opportunity for ordering drift.

### 7.3.2 In-flight registry cleanup — existing sweep-based safety net

The merged in-flight tracker (post `ea0f6c5`) has **three** explicit `inflightRegistry.remove()` call sites in `llmRouter.ts` — one per terminal branch (success at `~line 1013`, retryable error at `~line 713`, terminal failure at `~line 845`). It does NOT use a single try/finally. A comment at `llmRouter.ts:525-527` documents the deliberate design: "An unhandled throw between `add()` and `remove()` (e.g. a DB error during the ledger upsert) leaves the entry alive until the deadline-based sweep". The registry's `llmInflightRegistry.ts` sweep loop is the safety net for orphaned entries.

Phase C's breaker call sits **between** the ledger insert and `inflightRegistry.remove()` on the success path. When the breaker throws `cost_limit_exceeded`, the in-flight entry is orphaned until the sweep runs. This is acceptable for Tier 1 because:

- The breaker throw is exceptional, not expected traffic; orphan rate is low.
- The sweep's safety net handles it within the sweep interval (see `llmInflightRegistry.ts` for the interval).
- Changing this would require refactoring the existing three-branch cleanup into a single try/finally wrapper, which is a materially larger change than Phase C's scope.

**Phase C's only cleanup obligation**: do not introduce a NEW throw path that orphans an entry outside the branches already covered by the sweep. The pseudocode in §7.3 satisfies this — the breaker's own throw falls into the same `catch` block that fires after a provider-call error, and the existing cleanup branches cover it. Verified by test scenario #7 in §9.3.1 (cleanup-on-throw).

Try/finally refactor of the in-flight registry wrapper is tracked as a deferred hardening item in §11.4 #11. Not Tier 1 scope.

### 7.4 Ordering invariant — ledger write first, breaker check second

The ledger row is written **before** the breaker runs. Reasons:

1. **Cost attribution integrity.** The money was already spent with the provider; we must record it regardless of whether the breaker trips.
2. **Race safety (bounded, not absolute).** A pre-write breaker check would use a stale snapshot — concurrent in-flight requests would pile onto the same "within-budget" reading and all fire. Post-write, subsequent **serial** requests see the accumulated spend and trip reliably. Under **concurrent** load on the same run, however, multiple calls may commit to `llm_requests` before any of them runs the breaker check, because there is no per-run serialization around the insert-and-check sequence; the collective overshoot is therefore bounded by the inflight batch's summed cost, not by one call's cost. The breaker still trips reliably for the next call that starts after the concurrent burst settles. This is acceptable for pre-production and tracked as §11.4 #9 for strengthening when live traffic makes it material.
3. **Consistency with existing callers.** `sendToSlackService.ts` and `transcribeAudioService.ts` already check post-cost-record. Matching that pattern prevents the breaker from having two behaviours.

A comment block at the insertion point documents this ordering so a future refactor doesn't invert it.

### 7.4.1 Data-source contract for the breaker read

The concurrency overshoot claim in §7.4 point 2 holds only if the breaker reads from a data source that has synchronously observed the row we just wrote. The existing `getRunCostCents` implementation (`runCostBreaker.ts:83`) reads from `cost_aggregates` — a rollup table. Two possibilities:

- **If `cost_aggregates` is updated synchronously inside the same DB transaction that inserts into `llm_requests`** (e.g. via a trigger or an in-line upsert), then the breaker sees this call's cost immediately and the worst-case overshoot is **one call's cost per concurrent batch** as claimed.
- **If `cost_aggregates` is updated asynchronously** (e.g. by a pg-boss aggregator or a trigger with `DEFERRED INITIALLY DEFERRED` semantics), then the breaker read can lag by the aggregation interval and the worst-case overshoot is **up to N concurrent in-flight calls' cost**, where N is the maximum inflight on that run.

**Regime at spec-draft time (confirmed — 2026-04-21).** `cost_aggregates` is updated **asynchronously**. The synchronous fallback in `llmRouter.ts` calls `costAggregateService.upsertAggregates` only when the pg-boss queue is unavailable; the primary path runs `routerJobService.enqueueAggregateUpdate(idempotencyKey)` at `llmRouter.ts:897`, which defers the rollup to a background job. There is no `llm_requests → cost_aggregates` trigger in the migrations. Consequently, a `cost_aggregates`-based breaker read would give a stale snapshot under concurrency, and the worst-case overshoot would be up to N concurrent in-flight calls' cost (not one call's cost).

**Phase C decision (pinned):** the LLM caller reads from `llm_requests` directly — `SUM(cost_with_margin_cents) FROM llm_requests WHERE run_id = $1 AND status IN ('success', 'partial')`. This eliminates the rollup-lag worst case (up to aggregation-interval cost) and makes the breaker see every committed ledger row at check time for the **serial** case. The Slack and Whisper callers stay on the `cost_aggregates` read — their per-call cost magnitudes dominate the aggregation lag's worth of LLM traffic, and their concurrency profiles are low enough that rollup staleness is immaterial.

Implementation surface (pinned): `runCostBreaker.ts` gains **two new sibling exports** — `getRunCostCentsFromLedger(runId)` and `assertWithinRunBudgetFromLedger(ctx)` — with signatures identical to the existing `getRunCostCents` / `assertWithinRunBudget` pair but backed by a direct `llm_requests` sum. The LLM caller (`llmRouter.routeCall`) calls `assertWithinRunBudgetFromLedger`; Slack and Whisper continue to call the unchanged `assertWithinRunBudget`. No `source` parameter on the existing helpers — adding two named siblings is clearer than branching on an enum argument and makes the two data-source contracts independently documentable. See §4.3 row on `runCostBreaker.ts` and §8.3 `runCostBreaker` exports list.

Document the chosen regime in a comment block on the breaker insertion site and in `KNOWLEDGE.md` so future reviewers don't re-derive the analysis. If the aggregation regime ever switches to synchronous (e.g. a future migration adds a trigger), the direct-ledger path can be retired in a follow-up.

**Residual concurrency window.** Even with the direct-`llm_requests` read, there is no per-run serialization around the insert-and-check sequence. Concurrent calls on the same run may each commit their ledger row before any of them runs the breaker `SELECT SUM(...)`, so the collective overshoot for a concurrent burst is bounded by the inflight batch size × per-call cost (not by one call's cost). Strengthening this to a true one-call-overshoot bound requires a per-run advisory lock wrapping the insert-and-check sequence (e.g. `pg_advisory_xact_lock(hashtext(runId))`) or moving the breaker assertion into the same transaction as the ledger write with a `SELECT ... FOR UPDATE` on an aggregate row. Both are out of scope for Phase C — the residual overshoot window is pre-production-acceptable (no live cost at stake, agent execution is largely sequential on a single run). Tracked as §11.4 #9. The same strengthening would apply to `sendToSlackService` and `transcribeAudioService` for consistency, though their concurrency profiles make it lower-priority.

### 7.5 When to skip the breaker

The breaker is skipped — not applied and not throwing — when `ctx.runId` is null. This covers:

- `sourceType === 'system'` callers (internal maintenance tasks that don't belong to any run).
- `sourceType === 'analyzer'` callers (skill analyzer rollups that operate on historical data).
- Any future system caller that legitimately has no run context.

The router's existing contract guards already enforce that `runId` is present for `sourceType === 'agent_run'` and that `ieeRunId` is present for `sourceType === 'iee'`. IEE runs are handled by mapping `ctx.ieeRunId` to the parent `runId` via the existing `iee_runs` lookup — see §7.6.

### 7.6 IEE run handling

IEE runs (`sourceType === 'iee'`) set `ieeRunId` but may or may not have `runId`. The breaker needs a `runId` to look up the per-run cost aggregate. Resolution rule:

- If `ctx.runId` is set, use it.
- Else if `ctx.ieeRunId` is set, resolve `agent_run_id` from `iee_runs` via a single indexed query.
- Else skip the breaker (should not happen per contract guards).

**Where the lookup lives.** The IEE → agent-run resolution is a local helper `resolveRunIdFromIee(ctx): Promise<string | null>` defined inline in `server/services/llmRouter.ts` alongside the Phase C breaker call (§7.3 pseudocode already references it). The helper runs a single `SELECT agent_run_id FROM iee_runs WHERE id = $1 LIMIT 1` against the existing index on `iee_runs.id` (primary key). This does not require modifying `iee_runs` schema, adding a new shared utility, or touching `runCostBreaker.ts` — it is a router-local read. The helper is kept inside `llmRouter.ts` rather than promoted to `runCostBreaker.ts` because (a) it is specific to the router's source-type routing, (b) the breaker stays agnostic about how its `runId` was derived, and (c) the router already owns `iee_runs` reads for other routing metadata.

The resolution query is memoised **per `routeCall` invocation context** — not per provider attempt. A single `routeCall` may fan out to multiple provider attempts (primary + fallback providers, retries inside the backoff loop); every attempt inside one `routeCall` uses the same resolved `runId`. The memoisation key is the `routeCall` invocation itself (via a local variable in the function scope), not a module-level cache; this prevents cross-invocation staleness if an `iee_runs` row is updated between calls.

### 7.7 Failure payload shape

When the breaker trips, it throws `FailureError` with:

```ts
{
  reason: 'internal_error',
  detail: 'cost_limit_exceeded',
  context: {
    spentCents: number,
    limitCents: number,
    runId: string,
    correlationId: string,
  }
}
```

This shape is already pinned by the breaker; Phase C does not change it. The caller (agent execution loop) already handles `FailureError` — a breaker trip causes the run to terminate with `finalStatus='budget_exceeded'`, which per §6.3 maps to `runResultStatus='failed'`, feeding Phase B's failure path.

### 7.8 Observability

The breaker emits `costBreaker.exceeded` structured logs (existing behaviour). Phase C adds two diagnostic log lines on the LLM caller side (not on the breaker itself): `costBreaker.checked` at `debug` level on every successful breaker check (§7.3 — intentionally debug-only because LLM call volume dwarfs Slack + Whisper), and `costBreaker.infra_failure` at `error` level when the breaker itself throws a non-`cost_limit_exceeded` error so infra failures are visible without taking down the LLM path (§7.3 fail-open rationale). The breaker trip shows up on the System P&L page's top-expensive-calls table as a run with a spike in spend immediately before termination — this is already supported by the existing dashboards.

### 7.9 Done criteria for Phase C

1. `llmRouter.routeCall` calls `assertWithinRunBudgetFromLedger` (the new direct-ledger sibling added in Phase C — see §4.3 and §8.3) after every successful ledger write where `runId` is resolvable. `assertWithinRunBudget` (the pre-existing `cost_aggregates`-backed helper) stays scoped to Slack and Whisper.
2. A test run with `maxCostPerRunCents=50` and a prompt that would exceed it trips the breaker within one extra call of the ceiling.
3. A system-level caller (no `runId`) is unaffected — no breaker, no error.
4. An IEE caller with only `ieeRunId` resolves to its parent `runId` and trips the breaker correctly.
5. After a concurrent burst of in-flight requests on the same run settles, any subsequent serial call trips the breaker. (The burst itself may collectively overshoot by up to the inflight batch size × per-call cost — see §7.4 "Race safety (bounded, not absolute)" and §11.4 #9. Phase C does not assert a strict one-call overshoot bound because no per-run serialization exists today.)
6. `llmRouterCostBreaker.test.ts` covers the four scenarios above.
7. `npm run lint`, `npm run typecheck`, and the focused router test file all pass.

### 7.10 What Phase C does NOT do

- Does not change `maxCostPerRunCents` defaults or add new UI for configuring them.
- Does not change the breaker's signature, threshold logic, or log format.
- Does not introduce per-call cost caps (only per-run). Per-call caps are a different ceiling and out of scope.
- Does not add pre-flight cost estimation. The breaker is post-facto; pre-flight is a Tier 3 concern.
- Does not gate `sourceType='analyzer'` or `sourceType='system'` calls. Those callers are trusted internal tooling with their own observability surfaces.

---

## 8. Contracts

This section is the single source of truth for every type, API shape, and DB field touched by the spec. If an implementer introduces a shape that doesn't appear here, stop and amend the spec.

### 8.1 Shared types

**`shared/types/runCost.ts`** (new file):

```ts
export interface CallSiteBreakdownEntry {
  costCents: number;
  requestCount: number;
}

export interface RunCostResponse {
  entityId: string;                   // runId
  totalCostCents: number;
  requestCount: number;               // from cost_aggregates (existing semantics)
  llmCallCount: number;               // NEW — count of successful + partial llm_requests
  totalTokensIn: number;              // NEW
  totalTokensOut: number;             // NEW
  callSiteBreakdown: {                // NEW
    app: CallSiteBreakdownEntry;
    worker: CallSiteBreakdownEntry;
  };
}
```

Existing consumers that only read `totalCostCents` / `requestCount` are not broken — the extension is additive.

### 8.2 API shape — `GET /api/runs/:runId/cost`

**Current response (Phase A-pre):**
```json
{ "entityId": "run-uuid", "totalCostCents": 47, "requestCount": 3 }
```
or, for zero-call runs:
```json
{ "entityId": "run-uuid", "totalCostCents": 0, "requestCount": 0 }
```

**Phase A response:**
```json
{
  "entityId": "run-uuid",
  "totalCostCents": 47,
  "requestCount": 3,
  "llmCallCount": 3,
  "totalTokensIn": 12450,
  "totalTokensOut": 1820,
  "callSiteBreakdown": {
    "app": { "costCents": 47, "requestCount": 3 },
    "worker": { "costCents": 0, "requestCount": 0 }
  }
}
```

Auth: `authenticate` middleware (existing). Org scoping: the existing check at `llmUsage.ts:354-357` verifying `run.organisationId === req.orgId`. No new permission; no new middleware.

**Read source.** The four new fields are computed against the `llm_requests_all` view (migration 0189 — UNION of `llm_requests` + `llm_requests_archive`) so runs older than `LLM_LEDGER_RETENTION_MONTHS` (default 12) still report correct `llmCallCount`, tokens, and `callSiteBreakdown` after the nightly archive job moves their rows into the archive table. `totalCostCents` / `requestCount` continue to be read from `cost_aggregates` unchanged. RLS: the view is declared `security_invoker = on`, so tenant isolation is enforced against the caller's role (the route's existing `run.organisationId === req.orgId` guard plus the underlying tables' RLS policies are both active).

**Backward-compat contract.** The four new response fields are **always present** in the server response — never elided. The server substitutes defaults when the underlying query returns zero rows:

- `llmCallCount: 0`
- `totalTokensIn: 0`
- `totalTokensOut: 0`
- `callSiteBreakdown: { app: { costCents: 0, requestCount: 0 }, worker: { costCents: 0, requestCount: 0 } }` — both `app` and `worker` keys always present regardless of whether either side has rows.

Client consumers that destructure only `{ totalCostCents, requestCount }` continue to work unchanged. Client consumers that read the new fields never see `undefined` for any of them; a cost endpoint that returned `{ entityId, totalCostCents: 0, requestCount: 0 }` before Phase A now returns all four new fields filled with the zero defaults above.

TypeScript consumers must use the `RunCostResponse` type from `shared/types/runCost.ts` (§8.1). The type marks all four new fields as **required** — if a mock response in a test omits them, the type checker fails at compile time, which prevents silent drift.

### 8.3 Service signatures

**`workspaceMemoryService.extractRunInsights`** — extended (Phase B):

```ts
interface RunOutcome {
  runResultStatus: 'success' | 'partial' | 'failed';
  /**
   * Always `null` in Phase B — see §6.4. No trajectory-verdict persistence
   * exists today, so callers pass `null` unconditionally. Shape kept as
   * `boolean | null` for forward compatibility with a future spec
   * (§11.4 #6) that persists the `trajectoryService.compare()` verdict.
   * Pure tests still exercise `true` / `false` rows.
   */
  trajectoryPassed: boolean | null;
  errorMessage: string | null;  // sourced from agent_runs.errorMessage by the caller; see §6.4 and §6.8
}

interface ExtractRunInsightsOptions {
  taskSlug?: string;
  /**
   * Per-caller overrides applied to every memory entry written by this
   * invocation. Used by callers whose "outcome" is not a true terminal-run
   * signal — e.g. `outcomeLearningService`, which writes human-curated
   * lessons from review edits (see §4.2, §6.4, §6.7.1). When a field is
   * present, it replaces the value that §6.7 would otherwise derive from
   * `outcome`; when omitted, the §6.7 default applies.
   *
   * Supported overrides:
   *   - `isUnverified`: bypass `runResultStatus !== 'success'` derivation.
   *   - `provenanceConfidence`: bypass the 0.9 / 0.7 / 0.5 / 0.3 matrix.
   *
   * Overrides do not affect `entryType` promotion/demotion (§6.5) or the
   * `qualityScore` modifier; use the outcome fields to influence those.
   * Overrides flow through the existing `deduplicateEntries` dedup path
   * unchanged (§6.8.1).
   */
  overrides?: {
    isUnverified?: boolean;
    provenanceConfidence?: number;
  };
}

async extractRunInsights(
  runId: string,
  agentId: string,
  organisationId: string,
  subaccountId: string,
  runSummary: string,
  outcome: RunOutcome,
  options?: ExtractRunInsightsOptions,
): Promise<void>
```

`taskSlug` moves inside the `options` bag alongside `overrides` so the tail argument has a single consistent shape. The two callers (§6.4) pass `options` accordingly — `agentExecutionService` passes `{ taskSlug }` when relevant; `outcomeLearningService` passes `{ overrides: { isUnverified: false, provenanceConfidence: 0.7 } }`.

**`workspaceMemoryServicePure` exports** (new file, Phase B) — decision-logic pure helpers:

```ts
export function selectPromotedEntryType(
  raw: EntryType,
  outcome: RunOutcome,
): EntryType | null;  // null means "drop this entry"

export function scoreForOutcome(
  baseScore: number,
  entryType: EntryType,
  outcome: RunOutcome,
): number;  // clamped to [0, 1]

export function computeProvenanceConfidence(outcome: RunOutcome): number;
```

**`memoryEntryQualityServicePure` exports** (extended in Phase B — see §4.2 and §6.6) — decay-rate pure helpers. `HALF_LIFE_DAYS` lives here, not in `workspaceMemoryServicePure`, because the decay math is owned by this module:

```ts
export const HALF_LIFE_DAYS: Record<EntryType, number> = {
  observation: 7,
  issue: 14,
  preference: 30,
  pattern: 30,
  decision: 30,
};

// Existing export, extended in Phase B to accept `entryType` and branch on it.
export function computeDecayFactor(params: DecayParams): number;
```

**`agentExecutionServicePure.computeRunResultStatus`** (new helper):

```ts
export function computeRunResultStatus(
  finalStatus: string,
  hasError: boolean,
  hadUncertainty: boolean,
  hasSummary: boolean,
): 'success' | 'partial' | 'failed' | null;
```

See §6.3 for the truth table.

**`llmRouter.routeCall`** — signature unchanged (Phase C). Only body gains the breaker call.

**`runCostBreaker` exports** — existing three exports unchanged (Phase C): `resolveRunCostCeiling`, `getRunCostCents` (reads `cost_aggregates`), `assertWithinRunBudget` (called by Slack + Whisper). Phase C **adds two new sibling exports** backed by a direct-`llm_requests` read path — see §4.3 and §7.4.1 for the rationale:

```ts
// Reads SUM(cost_with_margin_cents) FROM llm_requests WHERE run_id = $1
// AND status IN ('success', 'partial'). Used by the LLM router only;
// bypasses the asynchronous `cost_aggregates` rollup.
export function getRunCostCentsFromLedger(runId: string): Promise<number>;

// Throws FailureError('internal_error', 'cost_limit_exceeded', {...})
// when SUM(llm_requests) > ceiling. Signature and throw shape identical
// to `assertWithinRunBudget`; internally calls `getRunCostCentsFromLedger`.
export function assertWithinRunBudgetFromLedger(ctx: {
  runId: string;
  insertedLedgerRowId: string | null;  // §7.3.1 — required; helper fails closed on null or not-visible
  subaccountAgentId: string | null;
  organisationId: string;
  correlationId: string;
}): Promise<void>;
```

`llmRouter.routeCall` consumes `assertWithinRunBudgetFromLedger`; Slack + Whisper continue to consume the unchanged `assertWithinRunBudget`. JSDoc on each helper names its canonical callers.

### 8.4 DB field usage

No migrations. Every column referenced below exists today.

| Column | Table | Status before | Status after Phase B |
|---|---|---|---|
| `runResultStatus` | `agent_runs` | Declared, never written | Written on every terminal run |
| `qualityScore` | `workspace_memory_entries` | Written by `scoreMemoryEntry` | Written by `scoreMemoryEntry` + outcome modifier |
| `qualityScoreUpdater` | `workspace_memory_entries` | `'initial_score'` unconditionally | `'initial_score'` unconditionally (unchanged — CHECK constraint + BEFORE UPDATE trigger in `migrations/0150` forbid a new value without a schema change, which §3 / §4.5 forbid). Outcome-bump audit trail lives in `provenanceConfidence` + the `memory.insights.outcome_applied` log event (§8.5), not in this tag. |
| `provenanceConfidence` | `workspace_memory_entries` | `null` unconditionally | Set per §6.7 |
| `isUnverified` | `workspace_memory_entries` | `!runId` (always `false` for run-sourced) | `runResultStatus !== 'success'` |
| `entryType` | `workspace_memory_entries` | LLM classification, unchanged | LLM classification, then promoted/demoted per §6.5 |

### 8.5 Structured log events

Phase A: no new log events.

Phase B: one new log event per extraction call:
- `memory.insights.outcome_applied` with `{ runId, runResultStatus, trajectoryPassed, entriesWritten, entriesDropped, promotedCount }`. Emitted inside `extractRunInsights` after the write batch. Useful for post-hoc audit of the promotion rate on real traffic.

Phase C: two new diagnostic log lines emitted by the LLM router (not by the breaker):
- `costBreaker.checked` (`debug` level) with `{ runId, correlationId }` — emitted once per successful breaker check on an LLM call. Debug-only because LLM-call volume dwarfs Slack + Whisper; never surfaced above debug, never customer-visible.
- `costBreaker.infra_failure` (`error` level) with `{ runId, correlationId, error }` — emitted when the breaker check throws an error that is **not** `FailureError('internal_error', 'cost_limit_exceeded')`. Phase C fails open on infra errors (§7.3), so this log is the only signal that the breaker malfunctioned; ops relies on it to notice and fix without the customer-visible blast radius of taking down the LLM path.

The existing `costBreaker.exceeded` log in `runCostBreaker.ts` is unchanged.

### 8.6 Feature flags

None. All three phases are backwards-compatible at the API level:

- Phase A is additive on the response shape — existing consumers that destructure `{ totalCostCents, requestCount }` continue to work.
- Phase B changes an internal function signature only — both callers (`agentExecutionService.ts:1307` and `outcomeLearningService.ts:50`) are updated in the same commit as the signature change (see §4.2 and §6.4).
- Phase C adds a call to an existing primitive — no config switch; the breaker with a missing per-agent cap falls back to `SYSTEM_DEFAULT_MAX_COST_CENTS = 100` cents, same as today.

If we later decide a feature flag is warranted for Phase C (e.g. to soft-launch the LLM breaker on a subset of orgs), we add `organisationFeatureFlags.llmBreakerEnabled` in a follow-up commit. Not included in Phase C scope.

### 8.7 Error contracts

Phase A errors:
- 404 from `/api/runs/:runId/cost` when the run doesn't belong to the caller's org — existing behaviour.
- 500 on DB failure — existing behaviour. Component shows "Cost data unavailable" per §5.6.

Phase B errors:
- Memory extraction errors are already caught non-fatally at `agentExecutionService.ts:1314-1316`. Phase B does not change this.
- A malformed `outcome` parameter is a TypeScript error, caught at compile time.

Phase C errors:
- `FailureError({ reason: 'internal_error', detail: 'cost_limit_exceeded' })` propagates to the agent execution loop, which maps it to `finalStatus='budget_exceeded'`. This is existing behaviour for Slack/Whisper breaker trips.
- `RouterContractError` is unchanged; the new breaker call sits after contract validation.

---

## 9. Testing posture

Pattern match with the existing codebase: pure logic lives in `*Pure.ts` files and is covered by unit tests with zero mocks; impure wrappers get integration tests that hit a real DB (Postgres) and exercise the end-to-end path; React components get component tests with React Testing Library.

**Framing deviation (explicit acknowledgement).** This spec proposes two test surfaces that deviate from the current project testing posture recorded in `docs/spec-context.md` (`frontend_tests: none_for_now`, `api_contract_tests: none_for_now`). Both deviations are scoped, intentional, and justified:

1. **`RunCostPanel.test.tsx`** — a first React Testing Library surface for this project. `RunCostPanel` is a new shared component with five non-trivial rendering branches (loading, error, zero-cost, compact single-line, full table with mixed call-site split). Pinning that behaviour at the component boundary once is better ROI than re-deriving it visually on every downstream page (three pages consume this component). Scoped to this one file; introduces no precedent for other frontend work.
2. **`llmUsage.test.ts`** — a route integration test for the one extended endpoint. The response shape is the source of truth for four client consumers (three pages + the shared `RunCostResponse` TS type). The TS type already catches missing fields at compile time; this test pins the shape/semantics guarantees (zero-row defaulting, failed-call exclusion, cross-org 404). Scoped to this one file.

The third new test file, `llmRouterCostBreaker.test.ts`, is a real-DB integration test and matches the "small number of carved-out integration tests for genuinely hot-path concerns" envelope in the framing (cost-breaker enforcement is the primary runaway-spend gate). No deviation.

### 9.1 Phase A tests

**`client/src/components/run-cost/RunCostPanel.test.tsx`** (new) — component tests, RTL:

| Case | Setup | Assertion |
|---|---|---|
| Loading state | Mocked API pending | Shimmer skeleton renders; no numbers visible |
| Zero cost | API returns totalCostCents: 0 | "— no LLM spend recorded" renders |
| Non-zero cost, compact | API returns $0.47, 3 calls, compact prop | Single inline line; no table |
| Non-zero cost, full | API returns $0.47, 3 calls, app-only | Call-site table shows app row with $0.47, worker row with $0.00 |
| Mixed call-site | API returns 2 app + 1 worker | Both rows visible with correct split |
| Error state | API returns 500 | "Cost data unavailable" renders |
| 404 (run not in org) | API returns 404 | "Cost data unavailable" renders; no toast |
| `compact=false` on zero run | API returns all zeros | Empty-state copy renders, table still visible but shows all zeros |

**`server/routes/__tests__/llmUsage.test.ts`** (new or extended) — integration:

| Case | Assertion |
|---|---|
| Run with 0 LLM calls | Returns `{ totalCostCents: 0, requestCount: 0, llmCallCount: 0, callSiteBreakdown: { app: { costCents: 0, requestCount: 0 }, worker: {...} } }` |
| Run with 3 successful app calls | `llmCallCount=3`, `callSiteBreakdown.app.requestCount=3`, `.worker.requestCount=0` |
| Run with 2 success + 1 error | `llmCallCount=2` (errors excluded), `requestCount` from aggregates unchanged |
| Run with 2 app + 1 worker | Both sides populated correctly |
| Run in a different org | 404 with "Run not found" — existing behaviour |
| Token totals | `totalTokensIn` and `totalTokensOut` are sums across successful + partial rows only |

### 9.2 Phase B tests

**`server/services/__tests__/workspaceMemoryServicePure.test.ts`** (extend — the file already exists and covers recency-boost math) — pure unit tests (no `options.overrides` coverage here — the pure exports do not read or apply overrides; overrides are applied by the impure `workspaceMemoryService.ts` at the row-insert site):

- `selectPromotedEntryType`: 15 cases — 5 input entryTypes × 3 runResultStatus values, with trajectoryPassed pinned per case.
- `scoreForOutcome`: 20 cases — verify bump magnitudes and clamp behaviour at boundaries (0.0, 1.0).
- `computeProvenanceConfidence`: 4 cases — success+pass, success+null, partial, failed.
- Truth table for the full matrix in §6.5 — a parameterised test that runs every row of the matrix and verifies the final entryType + score + provenanceConfidence triple.

**`server/services/__tests__/workspaceMemoryService.test.ts`** (new or extend — impure integration test) — one focused `options.overrides` case:

- `options.overrides` path (Phase B §8.3 / §6.7.1): call `extractRunInsights(..., outcome={ runResultStatus: 'partial', trajectoryPassed: null, errorMessage: null }, options={ overrides: { isUnverified: false, provenanceConfidence: 0.7 } })` with a minimal real-DB fixture and assert the written `workspace_memory_entries` row has `isUnverified=false` + `provenanceConfidence=0.7` (overriding the §6.7 `'partial'` defaults of `isUnverified=true` / `provenanceConfidence=0.5`). One additional case covering only `overrides.isUnverified=false` (without `provenanceConfidence`) pins that `provenanceConfidence` falls back to the §6.7 default (0.5) when omitted. The `entryType` and `qualityScore` are not asserted here — those are covered by the pure tests above. This test is carved out as an impure integration specifically because `options.overrides` is a row-write concern, not a decision-logic concern.

Add the new impure test file to §4.2's inventory.

**`server/services/__tests__/agentExecutionServicePure.test.ts`** (new or extended) — pure unit tests:

- `computeRunResultStatus`: every row of the §6.3 table.
- Edge case: `finalStatus='completed'`, summary is empty string — expect `'partial'` (not `'success'`).
- Edge case: `finalStatus='completed'`, `hadUncertainty=true` — expect `'partial'`.

**`server/services/__tests__/memoryEntryQualityServicePure.test.ts`** (new or extended) — pure unit tests:

- Half-life-based decay formula: for each entryType in `HALF_LIFE_DAYS`, verify that after `T = halfLife` days, score has decayed to `base * 0.5`.
- Decay never produces negative scores.
- Decay from a 0.0 score returns 0.0 (no lower-bound bug).
- Default branch: an unknown or missing `entryType` falls back to today's single `DECAY_RATE` (existing behaviour preserved).

**Integration sanity check** (manual, not automated):

On a dev org, trigger a successful run with a 300-char summary and 3 obvious-insight paragraphs. Confirm:
- `agent_runs.runResultStatus = 'success'` after the run finishes.
- `workspace_memory_entries` rows for that run have `qualityScore ≥ 0.6`, `qualityScoreUpdater='initial_score'` (see Finding 2.2 resolution — Phase B does not write `'outcome_bump'`), `isUnverified=false`, `provenanceConfidence=0.7` (Phase B passes `trajectoryPassed=null`; `0.9` is reachable only after §11.4 #6 lands).
- A deliberately failing run produces only `issue` entries (plus, per §6.5, an `observation` where the LLM classified a `preference`), `isUnverified=true`, `provenanceConfidence=0.3`.

### 9.3 Phase C tests

**`server/services/__tests__/llmRouterCostBreaker.test.ts`** (new) — integration, real DB:

| Case | Setup | Assertion |
|---|---|---|
| Within-budget call | subaccountAgent with `maxCostPerRunCents=10000`, single small call | `routeCall` returns normally; ledger row present; no throw |
| Over-budget call | subaccountAgent with `maxCostPerRunCents=10`, call that costs 15 cents | `routeCall` throws `FailureError('internal_error', 'cost_limit_exceeded', {...})`; ledger row IS present (written before the throw) |
| System-level call (no runId) | `sourceType='system'`, `runId=undefined` | No breaker invocation; `routeCall` returns normally |
| Analyzer-level call (no runId) | `sourceType='analyzer'`, `sourceId` set, no runId | Same as above |
| IEE call, runId resolvable | `sourceType='iee'`, `ieeRunId` set, parent `runId` exists in `iee_runs` | Breaker resolves and applies |
| Concurrent overshoot (bounded) | 3 parallel calls on same run, each costs 40 cents, ceiling is 100 | After the three concurrent calls settle, any subsequent serial call on the same run trips the breaker. The three concurrent calls themselves may all succeed (collective spend ≤ ~120 cents) because there is no per-run serialization today — see §7.4 / §7.4.1 "Residual concurrency window" and §11.4 #9. Assertions: (a) a serial follow-up call throws `FailureError('internal_error', 'cost_limit_exceeded', ...)`; (b) collective spend does not grow unboundedly beyond the per-call magnitude × inflight batch size. No assertion pins a specific overshoot bound across the concurrent batch. |
| Missing `subaccountAgentId` | Call without per-agent link | Breaker falls back to `SYSTEM_DEFAULT_MAX_COST_CENTS` (100 cents) |
| Missing `insertedLedgerRowId` (invariant breach) | Call the breaker helper directly with `insertedLedgerRowId: null` | Throws `FailureError({ reason: 'internal_error', detail: 'breaker_no_ledger_link', ...})` synchronously; no aggregate query is run. Verifies §7.3.1 fails closed. |
| Ledger row not yet visible (ordering violation) | Pass an `insertedLedgerRowId` that doesn't exist in `llm_requests` (simulate the insert being rolled back between write and breaker) | Throws `FailureError({ reason: 'internal_error', detail: 'breaker_ledger_not_visible', ...})`. Verifies §7.3.1 visibility check catches the contract violation. |

Concurrency test uses real `await Promise.all([...])` against a seeded DB — not mocks. Phase C's actual concurrency guarantee is weaker than "one call overshoot max": without a per-run advisory lock (§11.4 #9), a concurrent batch on the same run can collectively overshoot by up to the inflight batch size × per-call cost before any of them runs the breaker check. The absolute guarantee is that any **serial** call starting after the concurrent burst settles sees the accumulated spend and trips the breaker. The test pins (a) the trip on the follow-up serial call, and (b) that collective spend does not drift unboundedly — not a specific cap on concurrent-batch overshoot.

### 9.3.1 Cross-phase interaction scenarios

Each phase's own tests cover its own surface. Cross-phase interactions — where two phases meet and could silently drift — are covered by a small integration matrix in `server/services/__tests__/hermesTier1Integration.test.ts` (new), seeded DB.

| # | Scenario | Phase combo | Expected behaviour |
|---|---|---|---|
| 1 | Breaker trips mid-run | C + B | Run terminates with `finalStatus='budget_exceeded'`; `runResultStatus='failed'` per §6.3 derivation; memory extraction writes only `issue` entries per §6.5 matrix; no `pattern`/`decision` entries created for this run. |
| 2 | Cost panel on a retried run | A (+ run lifecycle) | Old run's `GET /api/runs/:oldId/cost` returns frozen cost; new run's `GET /api/runs/:newId/cost` starts at zero and accumulates from zero (per retry semantics in §5.4). Old run's panel never retroactively updates. |
| 3 | Cost panel on a breaker-tripped run | A + C | Panel renders the full cost including the overshoot call (ledger row written before breaker throw). `totalCostCents` exceeds `subaccountAgents.maxCostPerRunCents` by at most one serial call's cost (bounded-race semantics per §7.4 #2). |
| 4 | Memory after a partial run with uncertainty | B (+ handoff) | `finalStatus='completed_with_uncertainty'` maps to `runResultStatus='partial'`. Memory entries get `isUnverified=true`, `provenanceConfidence=0.5`, `qualityScoreUpdater='initial_score'` (no bump applied — partial is neutral per §6.8.2). |
| 5 | In-flight registry clean-up on breaker throw | C (+ in-flight tracker, post `ea0f6c5`) | When the breaker throws post-ledger-write, `inflightRegistry.remove()` still fires on the cleanup path; no ghost in-flight rows persist. Cross-checks the ordering pinned in §7.3. |
| 6 | Legacy run renders cost correctly | A | A pre-existing `agent_runs` row with `runResultStatus=NULL` renders a normal cost panel; Phase A does not branch on `runResultStatus` so NULL is immaterial (§6.3.2). |
| 7 | Cleanup runs when breaker throws on success path | C (+ in-flight tracker) | A breaker trip on the success path still triggers an in-flight `remove()` via the existing per-branch cleanup (NOT a new try/finally wrapper — see §7.3.2). No ghost in-flight row persists beyond the sweep interval. Asserted by polling the in-flight registry after the trip and confirming the entry is gone. |

Scenario #1 (breaker-trip-mid-run) is the most important — it exercises all three phases in a single run and verifies they cooperate correctly. Run as part of the pre-merge gate.

### 9.4 Verification commands

Per CLAUDE.md "Verification Commands":

```bash
npm run lint            # required — all three phases
npm run typecheck       # required — all three phases
npm run test -- --testPathPattern='workspaceMemory|runCost|llmRouter|memoryEntryQuality|agentExecutionServicePure'  # focused run
npm run build           # required — Phase A is client-side
```

No `npm run db:generate` because no schema change.

### 9.5 Gate order during implementation

1. Ship Phase C first. Smallest surface, enforces a cost guarantee that protects the other two phases' test runs from runaway spend.
2. Ship Phase A second. Read-only UI; doesn't touch existing behaviour; immediately visible in dev.
3. Ship Phase B last. Largest semantic change; wants the cost panel from Phase A to be visible when observing test runs.

Each phase is self-contained — one commit per phase is acceptable, though one-PR-multiple-commits is fine too. Review each phase with `pr-reviewer` before moving to the next.

### 9.6 Independent-review gate

Before marking the work done and before any PR:

1. Run `pr-reviewer` against the full set of changes. Per CLAUDE.md: "For Standard, Significant, and Major tasks — invoke `pr-reviewer` before marking done."
2. Persist the review log verbatim to `tasks/pr-review-log-hermes-tier-1-<ISO-timestamp>.md` per CLAUDE.md §"Review logs must be persisted".
3. Address blocking findings before PR creation. Non-blocking findings can be triaged into the follow-up queue.
4. `dual-reviewer` is optional and local-dev-only. Do not auto-invoke. Only run if the user explicitly asks.

---

## 10. Verification plan

End-to-end sanity walk, performed on a dev org with real seed data before declaring the spec done:

1. **Phase C sanity.** Set a dev subaccountAgent's `maxCostPerRunCents=10`. Trigger an agent run that calls an LLM. Confirm the run terminates with `finalStatus='budget_exceeded'`, `runResultStatus='failed'` (once Phase B lands), and the last `llm_requests` row is recorded with the overshoot cost.
2. **Phase A sanity.** Open `AgentRunHistoryPage`, `RunTraceViewerPage`, and `AdminAgentEditPage` on the same run. All three render the `RunCostPanel` without console errors. Numbers are consistent across surfaces. (`PlaybookRunDetailPage` is out of Phase A per §11.4 #10.)
3. **Phase B sanity, happy path.** Trigger a successful multi-step run with a meaningful summary. Query `workspace_memory_entries` for that run. Confirm:
   - At least one row has `entryType='pattern'` or `'decision'`.
   - `qualityScore ≥ 0.6` on promoted rows.
   - `provenanceConfidence` is `0.7` (Phase B always passes `trajectoryPassed=null` per §6.4, so the `0.9` path is not reachable until §11.4 #6 lands).
   - `isUnverified=false`.
4. **Phase B sanity, failure path.** Cancel a running agent mid-loop. Confirm the run marks `runResultStatus='failed'`. Query memory — either zero new rows (short-summary guard) or rows limited to `issue` entries plus, where the LLM classified a `preference`, a demoted `observation` per §6.5. No `pattern` / `decision` rows from a failed run.
5. **Phase B sanity, partial path.** Trigger a run that ends with `completed_with_uncertainty` (ask_clarifying_question flow). Confirm `runResultStatus='partial'`, memory entries neither promoted nor force-demoted.
6. **Regression: Phase C does not break existing callers.** Run the Slack and Whisper integration tests; confirm they still pass (they test the same breaker from a different caller).
7. **Regression: Phase A does not break System P&L.** Open the existing `/system/llm-pnl` page and verify numbers unchanged.
8. **Regression: Phase B does not break handoff.** Open an agent run's handoff JSON. Confirm `runResultStatus` is populated and the handoff service renders the new field correctly.

---

## 11. Rollout, risks, deferred items

### 11.1 Rollout

Pre-production context (per `docs/spec-context.md`: `pre_production: yes`, `live_users: no`, `rollout_model: commit_and_revert`). No feature flag, no phased rollout, no staged deploy — the three phases land sequentially on the same branch, each gated by `pr-reviewer`, and merge to `main` in one PR once all three are green. There are no live users or live agencies to stage the rollout behind.

Reasoning:
- Phase A is read-only UI — the worst case is a cost panel renders incorrect numbers in dev. Visible, recoverable.
- Phase B affects new memory entries only — existing memory rows are not rewritten; the score bumps it writes are stored absolutes (not relative), so a revert stops creating promoted entries but leaves already-written ones valid.
- Phase C enforces a ceiling that was already configurable — the ceiling was aspirational before; Phase C makes it real. Because there are no live customer runs, there is no "expensive production run gets cut off mid-work" scenario to mitigate. Any dev agent with `maxCostPerRunCents` set at the system default (100 cents) is fine; it was never running against real traffic.

### 11.2 Pre-merge checklist

1. `npm run lint && npm run typecheck && npm run test` — all green.
2. Focused test run: `npm run test -- --testPathPattern='workspaceMemory|runCost|llmRouter|memoryEntryQuality|agentExecutionServicePure'` — all green.
3. Manual sanity walk per §10 on a dev org with seeded data — spot-check the three phases behave as specified.
4. Open `/system/llm-pnl` on the dev instance and confirm the page still renders without console errors (regression smoke).

### 11.3 Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase C trips a dev agent's run mid-loop at an unexpected cap | Low | Low (dev environment; no customer impact) | Dev agents run with known caps; if trip is unwanted during testing, raise the cap on the test subaccountAgent. No pre-merge cap audit needed because there are no live runs to audit |
| Phase B promotes low-quality insights because the LLM classified them optimistically | Low | Low (one spurious `pattern` entry decays in 30 days) | `memoryCitationDetector` will down-weight uncited entries; decay removes unused entries; no user-facing impact even in dev |
| Phase A shows cost that disagrees with System P&L | Low | Low (dev-only; confusing but recoverable) | Integration test in §9.1 verifies the extended endpoint matches `cost_aggregates` totals. Manual sanity step in §10 cross-checks against the P&L page |
| `runResultStatus` derivation puts too many runs in `'partial'` | Medium | Low | The truth table is pinned in tests; if dev-run observation surprises us we re-tune the rule in a follow-up. No blocker |
| Concurrent LLM calls on the same run collectively overshoot the ceiling | Low (agent execution is largely sequential on a single run) | Low (pre-production; no live cost at stake) | Current mechanism bounds overshoot by the inflight batch (batch size × per-call cost), not by one call's cost, because there is no per-run serialization around the insert-and-check sequence (§7.4 / §7.4.1). Any serial call following the burst trips the breaker reliably. Strengthening to a strict one-call bound is tracked as §11.4 #9 for when live traffic makes it material |
| Dynamic import of `runCostBreaker` in a hot path adds latency | Low | Negligible | Slack and Whisper services already use the same dynamic-import pattern; Node caches the module after first load |

### 11.4 Deferred items

Explicitly NOT part of this spec; captured here as pointers for follow-up specs:

1. **Cheaper-model post-call hints (Tier 3 #9 in the audit).** The ledger has the data; the UI surface is now ready (Phase A). Next spec decides whether to surface this in `RunCostPanel` or in a new P&L drawer.
2. **Pre-flight cost estimation.** A breaker is post-facto. A pre-flight cost estimate would be more polite — "this call would push you over your cap; here are options". Requires work on the prompt-sizing side and a new confirm-or-abort flow.
3. **Per-call cost caps (separate from per-run caps).** Today we only cap per-run. A per-call cap would prevent a single runaway prompt from blowing the per-run budget in one shot. Consider after Phase C lands and we see real breaker-trip data.
4. **End-client cost visibility.** Out of scope per non-goals. Phase A's `RunCostPanel` is agency-internal only.
5. **Ledger schema extension for prompt-caching cost attribution.** Separate forthcoming spec (cached-context infrastructure brief) will extend `llm_requests` with `cacheReadInputTokens`, `cacheCreationInputTokens`, `cacheCreationEphemeral5mInputTokens`, `cacheCreationEphemeral1hInputTokens`. When that lands, Phase A's `RunCostPanel` can surface cache hit rate with a small component change. Flagged here so that spec knows `RunCostPanel` is the natural display surface.
6. **Trajectory-driven success signal automation + verdict persistence.** Phase B defines the contract (`RunOutcome.trajectoryPassed: boolean | null`) but passes `null` unconditionally because no per-run verdict is persisted today (`trajectoryService` only exposes `loadTrajectory` + `compare`; there is no column or table storing the `TrajectoryDiff.pass` value). A future spec persists the `compare()` verdict for runs with a reference trajectory — e.g. a new `agent_runs.trajectoryPassed` column written at the same terminal-write site as `runResultStatus`, or a dedicated `trajectory_verdicts` row keyed on `runId`. At that point, Phase B's §6.5 rows keyed on `trajectoryPassed=true/false` become live automatically (callers switch from passing `null` to passing the persisted value). Expanding trajectory evaluation to fire automatically on every run (not just IEE and integration tests) is additional Tier 2+ work on top of verdict persistence.
7. **Scheduled reflection loop (Tier 2 of the audit).** Out of scope; needs its own spec. Will consume the cleaned-up `runResultStatus` signal landed by Phase B.
8. **Run-embedding for recurring-task detection (Tier 2 of the audit).** Out of scope; needs its own spec. Independent of Tier 1.
9. **Per-run cost-breaker serialization.** Phase C's breaker check runs post-ledger-write without a per-run lock around the insert-and-check sequence, so concurrent calls on the same run may collectively overshoot the ceiling by up to the inflight batch size × per-call cost. When live traffic makes this material (concurrent fan-out on a single run is rare today because agent execution is largely sequential), wrap the `INSERT INTO llm_requests` + `assertWithinRunBudget` sequence in `pg_advisory_xact_lock(hashtext(runId))`, or move the assertion into the same transaction as the ledger write with a `SELECT ... FOR UPDATE` on a per-run aggregate row. The same strengthening applies to `sendToSlackService` and `transcribeAudioService` for consistency, though their lower concurrency profiles make the priority lower.
10. **Playbook-run cost visibility.** A playbook run aggregates cost across its child step runs (those with non-null `agent_run_id` on `playbook_step_runs`). `PlaybookRunDetailPage.tsx` operates on a `playbook_runs` ID, not an `agent_runs` ID — passing that ID into the existing `/api/runs/:runId/cost` endpoint would 404 because the endpoint joins only on `agent_runs.id`; the playbook-run status enum (`awaiting_input`, `completed_with_errors`, `cancelled`) also does not match `isTerminalRunStatus` from `shared/runStatus.ts`. A follow-up spec decides between (a) a new `/api/playbook-runs/:runId/cost` endpoint that sums per-step agent-run costs from `llm_requests_all` joined via `playbook_step_runs.agentRunId`, or (b) a `RunCostPanel`-like component that iterates per-step and displays a per-step breakdown plus an aggregate total. Either way it is non-trivial and out of scope for Tier 1; Phase A ships cost visibility only for the three direct agent-run surfaces (`AgentRunHistoryPage`, `RunTraceViewerPage`, `AdminAgentEditPage`).
11. **In-flight registry try/finally cleanup refactor.** `llmRouter.ts` uses three explicit `inflightRegistry.remove()` call sites on the success / retryable-error / terminal-error branches, not a single try/finally wrapper. An unhandled throw between `add()` and the appropriate `remove()` orphans an entry until the sweep loop in `llmInflightRegistry.ts` cleans it up. This is documented as deliberate (`llmRouter.ts:525-527`) and acceptable for Tier 1 because (a) Phase C's breaker throw is rare, (b) the sweep safety net contains the blast radius, (c) refactoring the three branches into one try/finally changes a large block of merged-from-main code outside Phase C's scope. A future hardening spec wraps the add/remove pair in a single try/finally so cleanup is structurally guaranteed rather than sweep-dependent. Test scenario #7 in §9.3.1 pins the current behaviour so a refactor can assert no regression.
12. **Centralised NULL-safe run-result-status accessor.** Today only one consumer (`agentRunHandoffServicePure.ts:63`) reads `agent_runs.runResultStatus` and it already tolerates NULL in its type signature. If a second consumer ever appears and also needs to treat legacy NULL rows uniformly, extract a shared helper `getEffectiveRunResultStatus(run): 'success' | 'partial' | 'failed' | 'unknown'` (mapping NULL → `'unknown'`) and require all new callers to route through it. Not worth extracting proactively at one consumer; the overhead of the indirection exceeds the duplication cost at N=1.

### 11.5 Post-merge dev-environment observation

Post-merge, run the sanity walk in §10 on a seeded dev org. There is no "week-after" observation window because there are no live users to observe (per `docs/spec-context.md`: `pre_production: yes`). The capability checks are:

1. **Phase A.** The three host pages (`AgentRunHistoryPage`, `RunTraceViewerPage`, `AdminAgentEditPage`) render `RunCostPanel` without console errors; numbers are consistent across surfaces and match System P&L aggregate for the same dev run (§10 step 2). `PlaybookRunDetailPage` is out of Phase A per §11.4 #10.
2. **Phase B.** A seeded successful run writes `pattern` / `decision` entries with `qualityScore ≥ 0.6` and `isUnverified=false`; a failing run writes only `issue` entries — plus an `observation` when the LLM classified a `preference`, per §6.5 (§10 steps 3–5). No `pattern` / `decision` rows from a failure.
3. **Phase C.** A dev run with a deliberately tight `maxCostPerRunCents=10` trips the breaker and terminates with `finalStatus='budget_exceeded'` (§10 step 1).

No numerical targets. The measure of success is "each phase's capability is demonstrably present in dev". When live traffic eventually exists, a follow-up spec can add real-traffic observation metrics.

---

## 12. Appendix — audit references

### Source material

- `tasks/hermes-audit-tier-1-spec.md` (this file).
- Claude and ChatGPT audit reports delivered via chat on 2026-04-21. Not checked in; referenced here as the origin of the Tier 1 framing.
- The four Explore-agent audits run before this spec:
  - Memory + trajectory audit findings — `workspaceMemoryService.ts:696`, `agentExecutionService.ts:1305-1326`, `trajectoryService.ts`, `memoryCitationDetector.ts`.
  - Playbooks + recurring-task audit findings — `systemPlaybookTemplates`, `playbookTemplates`, `playbookTemplateVersions` tables, no recurring-task detection surfaced (out of Tier 1 scope).
  - LLM cost audit findings — `llmRequests` schema, `/api/admin/llm-pnl/*` routes, per-run cost endpoint at `llmUsage.ts:347`, org + subaccount usage routes, `orgBudgets.monthlyCostLimitCents`.
  - Orchestrator + skills audit findings — 152 skills, `orchestratorFromTaskJob.ts`, `docs/skill-gap-analysis-v2.md`, no capability packs, no scheduled reflection.

### Key references into existing code

- `server/services/workspaceMemoryService.ts:696` — `extractRunInsights` entry point.
- `server/services/agentExecutionService.ts:1175` — `runResultStatus` write site (new).
- `server/services/agentExecutionService.ts:1305-1326` — memory extraction trigger.
- `server/db/schema/agentRuns.ts:46` — `runResultStatus` column declaration.
- `server/lib/runCostBreaker.ts:111` — `assertWithinRunBudget` export.
- `server/services/llmRouter.ts:243` — `routeCall` entry point.
- `server/services/llmRouter.ts:777` — primary ledger insert site.
- `server/routes/llmUsage.ts:347` — `/api/runs/:runId/cost` handler.
- `client/src/pages/AdminAgentEditPage.tsx:1697-1702` — existing inline cost fetch (retires in Phase A).
- `client/src/pages/SystemPnlPage.tsx` — reference for styling + data presentation conventions.

### Doc references for further context

- `architecture.md` §184 — Hard ceilings + runCostBreaker caller table.
- `architecture.md` §1407 — Run cost circuit breaker deep reference.
- `CLAUDE.md` §"Key files per domain" — where to extend when adding a new LLM consumer, a new memory writer, or a new skill.
- `CLAUDE.md` §"Long Document Writing" — reason this spec was chunked.
- `docs/spec-authoring-checklist.md` — pre-author checklist. This spec completed it mentally during drafting.
