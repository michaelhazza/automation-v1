# Dual Review Log — hermes-tier-1

**Files reviewed:**
- server/services/llmRouter.ts
- server/services/workspaceMemoryServicePure.ts
- server/services/workspaceMemoryService.ts
- server/services/__tests__/workspaceMemoryService.test.ts
- server/services/__tests__/workspaceMemoryServicePure.test.ts
- server/services/agentExecutionService.ts
- server/services/agentRunFinalizationService.ts
- server/services/memoryEntryQualityServicePure.ts
- server/services/outcomeLearningService.ts
- client/src/components/run-cost/RunCostPanel.tsx
- client/src/components/run-cost/RunCostPanelPure.ts
- client/src/components/SessionLogCardList.tsx
- server/services/__tests__/llmRouterCostBreaker.test.ts

**Iterations run:** 2/3
**Timestamp:** 2026-04-21T07:36:00Z

---

## Iteration 1

[ACCEPT] server/services/llmRouter.ts:1094 — `commitReservation` and `enqueueAggregateUpdate` skipped on breaker rethrow
  Reason: When `assertWithinRunBudgetFromLedger` throws `cost_limit_exceeded`, execution jumps past both `commitReservation` (line 1152) and `enqueueAggregateUpdate` (line 1155). The `budgetReservations` row stays `active` indefinitely (the reconciler eventually commits it, but the reconciler does NOT call `enqueueAggregateUpdate`). As a result, `cost_aggregates` never receives the over-budget call's row, so `totalCostCents` in `/api/runs/:runId/cost` and `RunCostPanel` permanently undercounts the triggering call's spend for any breaker-tripped run.

[REJECT] server/services/workspaceMemoryService.ts:810-816 — UPDATE dedup ops don't get outcome-driven promotion/scoring
  Reason: This is pre-existing behavior not introduced by Hermes Tier 1. Phase B adds outcome-driven scoring only to ADD ops per the spec; the spec is silent on UPDATE ops and explicitly scopes Phase B to new insertions. Changing the UPDATE path would be a behavior change beyond the spec and beyond what this PR owns. CLAUDE.md rule: "The issue is pre-existing and not introduced by this change."

[REJECT] client/src/components/run-cost/RunCostPanel.tsx:157-166 — Single fetch on terminal; no retry for stale `totalCostCents`
  Reason: The spec (§5.4) explicitly documents the intentional asymmetry between `totalCostCents` (from `cost_aggregates`) and `llmCallCount`/tokens (from `llm_requests_all`). The panel is only shown for terminal runs; for historical runs the aggregate has long settled. For just-finished runs this is a known eventual-consistency tradeoff per spec. Adding retry logic would add complexity not specified in the feature and has no equivalent pattern in the existing client codebase.

## Iteration 2

[REJECT] server/lib/runCostBreaker.ts:174-177 — `assertWithinRunBudgetFromLedger` doesn't count non-LLM spend
  Reason: Intentional design per spec §7.4.1 and the Phase C decision note. The spec explicitly states "the LLM caller reads from `llm_requests` directly" and "`assertWithinRunBudget()` remains scoped to Slack/Whisper." Slack and Whisper already call the existing `assertWithinRunBudget` (reads `cost_aggregates`) independently, so all cost surfaces have breaker coverage. Codex correctly identifies the gap in combined-cost semantics, but this is a documented, accepted tradeoff in the spec — not a bug.

[REJECT] server/services/agentExecutionService.ts:1480-1489 — `emitAgentRunUpdate(agent:run:failed)` fires even when DB write was a no-op
  Reason: The bare `await` calls after the terminal write (agentRunSnapshots insert at line 1278, subaccountAgents update at line 1313) pre-exist Phase B. Hermes Tier 1's `IS NULL` guard (Phase B) actually improved the situation by keeping the DB state correct when those awaits throw — before Phase B, the catch would overwrite to `failed`. The inconsistency between DB state (completed) and the WebSocket emit (failed) after a secondary-step throw is pre-existing structural behavior. Fixing it requires wrapping the emit in a check of whether the DB update was actually applied, which is a separate concern beyond the scope of this PR. CLAUDE.md rule: "The issue is pre-existing and not introduced by this change."

[REJECT] server/routes/llmUsage.ts:428-430 — Mixed data sources for `totalCostCents` vs ledger fields
  Reason: Same finding as iteration 1 P2 (cost panel retry). Intentional per spec §5.4: "totalCostCents and requestCount come from cost_aggregates so their semantics (which include failed-call cost) are preserved for existing consumers." Not a bug introduced by this change.

---

## Changes Made

- `server/services/llmRouter.ts` — Added fire-and-forget `commitReservation` + `enqueueAggregateUpdate` calls before rethrowing `cost_limit_exceeded` from the breaker catch block. Prevents over-budget runs from permanently undercounting their triggering call's cost in `cost_aggregates`. Both calls are best-effort (`.catch()` log-only) so failure there cannot mask the breaker trip.

## Rejected Recommendations

1. **UPDATE dedup ops missing outcome scoring (workspaceMemoryService.ts)** — Pre-existing behavior; Phase B scope is ADD ops only per spec. Not a Hermes Tier 1 bug.

2. **RunCostPanel single fetch / no retry (RunCostPanel.tsx)** — Intentional eventual-consistency tradeoff per spec §5.4. No equivalent retry pattern in the codebase. Adding retry would add complexity not in the spec.

3. **Non-LLM spend absent from ledger breaker (runCostBreaker.ts)** — Intentional architecture per spec §7.4.1. Slack/Whisper already have their own breaker calls on the `cost_aggregates` path. The two-breaker design is documented and pinned.

4. **`agent:run:failed` emit after skipped terminal write (agentExecutionService.ts)** — Pre-existing structural issue. Phase B actually improved DB correctness (row stays completed). The emit inconsistency is a separate concern from Hermes Tier 1. Filed for separate cleanup.

5. **Mixed data sources in /api/runs/:runId/cost (llmUsage.ts)** — Duplicate of finding 2; same rejection reasoning.

---

**Verdict:** `PR ready. All critical and important issues resolved.` One correctness bug fixed (P1: reservation + aggregate update skipped on breaker trip). All other Codex findings are either pre-existing behavior, intentional design decisions documented in the spec, or out-of-scope concerns for this PR.
