# PR Review Log — Hermes Audit Tier 1

Branch: claude/hermes-audit-tier-1-qzqlD
Timestamp: 2026-04-21T00:00:00Z

Files reviewed: server/lib/runCostBreaker.ts, server/services/llmRouter.ts, server/services/agentExecutionService.ts, server/services/agentRunFinalizationService.ts, server/services/agentExecutionServicePure.ts, server/services/workspaceMemoryService.ts, server/services/workspaceMemoryServicePure.ts, server/services/outcomeLearningService.ts, server/services/memoryEntryQualityServicePure.ts, server/services/memoryEntryQualityService.ts, server/routes/llmUsage.ts, shared/types/runCost.ts, client/src/components/run-cost/RunCostPanel.tsx, client/src/components/run-cost/RunCostPanelPure.ts, client/src/components/run-cost/__tests__/RunCostPanel.test.ts, client/src/components/SessionLogCardList.tsx, client/src/components/runs/RunTraceView.tsx, client/src/pages/AdminAgentEditPage.tsx, server/routes/__tests__/llmUsage.test.ts, server/services/__tests__/llmRouterCostBreaker.test.ts, server/services/__tests__/workspaceMemoryServicePure.test.ts, server/services/__tests__/workspaceMemoryService.test.ts, server/services/__tests__/agentExecutionServicePure.runResultStatus.test.ts, server/services/__tests__/memoryEntryQualityServicePure.test.ts, server/services/__tests__/hermesTier1Integration.test.ts, architecture.md

---

## Blocking Issues

### B1 — Phase C: successLedgerRowId null on idempotency-key retry causes spurious costBreaker.infra_failure log

**Files:** server/services/llmRouter.ts line 1030; server/lib/runCostBreaker.ts lines 221-228

The ledger upsert uses `.onConflictDoUpdate({ target: [llmRequests.idempotencyKey], set: { ... }, where: sql\`${llmRequests.status} != 'success'\` })`. When a successful row already exists for that idempotency key (i.e., an identical successful retry), the `where status != 'success'` guard prevents the UPDATE, and `.returning()` returns an empty array. Consequently `successLedgerRowId = null` at line 1030. The breaker then throws `breaker_no_ledger_link`, which the catch block at line 1081 classifies as an infra failure and logs `costBreaker.infra_failure`.

The LLM response is returned normally — so this is fail-open and not a correctness failure. However:

- `costBreaker.infra_failure` is at error level (line 1089). In production, this log fires on every idempotency-key retry of a successful call, flooding the error log and triggering false alerts.
- The breaker is effectively skipped for idempotency retries — but the row was already counted in the budget on the first insert, so the budget enforcement is still correct.
- The distinction between "breaker correctly skipping a duplicate" and "breaker infrastructure failure" is lost.

**Fix:**
```ts
// If the upsert produced no returned row, it hit the `where status != 'success'` guard —
// the row already exists as a success (idempotency replay). The cost was already counted
// on the first insert; skip the breaker for this replay.
if (!successLedgerRowId) {
  console.debug('[llmRouter] costBreaker.skip_idempotency_replay', { correlationId: idempotencyKey });
} else {
  // normal path — call breaker
}
```

**Blocking because:** (a) error-level log on a routine event is misleading in production; (b) misclassifies a correct no-op as an infrastructure failure.

---

### B2 — Phase B: workspaceMemoryService.test.ts does not actually call extractRunInsights; the override chain is untested

**Files:** server/services/__tests__/workspaceMemoryService.test.ts, lines 90-98, 150-178, 180-209

The spec §9.2 requires: "Calls extractRunInsights with a real-DB fixture and asserts the written workspace_memory_entries row honours overrides.isUnverified / overrides.provenanceConfidence when supplied."

The current test inserts memory entries directly via `insertMemoryEntry(opts)` (lines 116-141), bypassing `extractRunInsights` entirely. Lines 96-98 acknowledge this explicitly: "To keep the test self-contained, we stub at a lower level — we insert memory entries directly." This means the `overrides?.isUnverified ?? defaultIsUnverified` chain at workspaceMemoryService.ts:838 and `overrides?.provenanceConfidence ?? defaultProvenance` at line 833 are never executed by this test.

Example failing scenario not caught: workspaceMemoryService.ts:838 inadvertently changes to `isUnverified: overrides?.isUnverified ?? true` (hardcoded default) — the test passes, retrieval pipelines silently drop human-curated lessons.

**Fix:** Replace the direct insert with a call to `workspaceMemoryService.extractRunInsights` using a mocked `routeCall`. Call `extractRunInsights` with a `runSummary` of ≥ 100 chars (so the short-summary guard passes), stub the LLM call to return a fixed JSON response, and assert the written row's `isUnverified` and `provenanceConfidence` match the supplied overrides.

**Blocking because:** The spec §9.2 integration gate for §6.7.1 correctness is not exercised.

---

## Strong Recommendations

### S1 — Phase B: errorMessage: null on normal-path terminal extraction for failed runs — §6.8 guard weaker than spec implies

**File:** server/services/agentExecutionService.ts, lines 1350-1368

When `finalStatus` is `'failed'`, `'loop_detected'`, etc. but the loop still produces a non-empty `loopResult.summary`, the extraction runs with `errorMessage: null` (line 1360). The §6.8 short-summary guard then falls back entirely to the `hasMeaningfulSummary >= 100` check. A failed run with a 50-character summary but no thrown exception gets its memory extraction skipped — even if `agent_runs.errorMessage` was set before the loop terminated.

Pre-existing; documented as known limitation per spec §11.4 deferred items. Not blocking for Tier 1.

**Recommendation:** Thread `errorMessage` from `preFinalizeMetadata` (already in scope at line 1156-1157) into the extraction call when `derivedRunResultStatus === 'failed'`. Capture as §6.8 follow-up.

---

### S2 — Phase C: breaker not called on failureInsertedRows path — forward-looking note

**File:** server/services/llmRouter.ts, lines 800-899

Failed provider calls write a ledger row with `costWithMarginCents: 0`. The breaker skip is correct for zero-cost rows. This is a forward-looking note: if `partial`-cost-on-failure is ever introduced, the breaker would need wiring on that path too.

**Recommendation:** Add a comment near line 800: "Phase C breaker is not called on the failure path — failure rows record costWithMarginCents=0 and do not contribute to per-run spend."

---

### S3 — Phase B: completed_with_uncertainty not in finalStatus type narrowing

**File:** server/services/agentExecutionService.ts, line 1145

```ts
let finalStatus = (loopResult.finalStatus ?? 'completed') as 'completed' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded';
```

The `as` cast excludes `'completed_with_uncertainty'`. Runtime behavior is correct, but the type is lying — a future refactor trusting this type could add a switch case that never fires.

**Recommendation:** Widen to:
```ts
let finalStatus = (loopResult.finalStatus ?? 'completed') as
  'completed' | 'completed_with_uncertainty' | 'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded';
```

---

### S4 — Phase B: agentRunFinalizationService.ts WHERE clause edge case

**File:** server/services/agentRunFinalizationService.ts, lines 255-260

The `isNull(agentRuns.completedAt)` guard in the write-once WHERE clause means: if a race condition sets `completedAt` before `runResultStatus`, the update is silently skipped. The `isNull(agentRuns.runResultStatus)` guard alone is sufficient for the write-once invariant.

**Recommendation:** Document this edge case in a comment. No immediate code change required; worth a follow-up ticket.

---

### S5 — Phase A test: process.exit(0) in workspaceMemoryService.test.ts would kill a suite runner

**File:** server/services/__tests__/workspaceMemoryService.test.ts, lines 43-75

`process.exit(0)` at lines 43-44, 72-76, 84-87 would kill a Jest/vitest parent runner process. Other test files in this build use `console.log + process.exitCode = 0` fall-through pattern.

**Recommendation:** Replace `process.exit(0)` skip-paths with `console.log(...); process.exitCode = 0` then let the process exit naturally at end-of-file.

---

### S6 — Phase B: half-life branch has no grace-period; behavioral divergence from linear

**File:** server/services/memoryEntryQualityServicePure.ts, lines 100-113

`0.5^(daysSinceAccess/halfLife)` applies immediately from T=0 (e.g., 0.9998 for a 30-day half-life after 1 hour). The linear fallback returns exactly 1.0 within `DECAY_WINDOW_DAYS`. This is a design choice, not a bug, but it is a behavioral discontinuity worth documenting.

**Recommendation:** Add a comment: "The exponential path has no 'within-window' grace period — decay starts immediately from the last access time."

---

### S7 — Missing tests: success+false trajectory for observation/decision/pattern/issue entry types

**File:** server/services/__tests__/workspaceMemoryServicePure.test.ts, lines 307-344

The `scoreForOutcome` suite tests `success+false: +0.00` only for `preference`. The spec §6.5 matrix has the same +0.00 for `observation`, `decision`, `pattern`, `issue` too. Missing cases:

- `scoreForOutcome(0.5, 'observation', { runResultStatus: 'success', trajectoryPassed: false })` → 0.50
- Same for `decision`, `pattern`, `issue`

**Recommendation:** Add 4 explicit test cases to pin these matrix cells.

---

## Non-Blocking Improvements

### N1 — RunCostPanel.test.ts: formatCost test name covers two branches
Line ~144: test named `'$0.01 ≤ cost < $1 → 4dp'` contains a second assertion `formatCost(4712)` that tests the `$1 ≤ cost < $1000 → 2dp` branch. Split into two clearly named tests.

### N2 — agentExecutionService.ts line ~1191: hasError comment is confusing
`/* hasError */ finalStatus !== 'completed'` — for non-completed statuses the switch ignores `hasError` entirely. Add a brief clarifying comment.

### N3 — RunCostPanel.tsx line 43: shimmer keyframe must be defined
`animate-[shimmer_1.4s_ease-in-out_infinite]` requires a `@keyframes shimmer` in global CSS or Tailwind config. Verify it exists (AgentRunHistoryPage.tsx already defines it per §5.6).

### N4 — llmRouterCostBreaker.test.ts: no summary line after pure section
Pure section (lines 58-76) has no `--- Summary ---` line before the integration guard. Add a total summary or at minimum a section separator.

### N5 — outcomeLearningService.ts: extract HUMAN_CURATED_OUTCOME / HUMAN_CURATED_OPTIONS constants
Inline object literals at lines 65-68 and 70-74 are described by comments. Extracting as named constants makes the call site self-documenting.

### N6 — workspaceMemoryServicePure.ts: redundant `if (raw === 'issue') return 'issue'` branch
The fallthrough `return 'issue'` on the next line already covers this. Drop the redundant branch.

---

## Summary of Key Findings

**Phase C (spec §4.3, §7):** The §7.3.1 fail-closed invariant is correctly implemented. The ordering invariant (ledger write → breaker check → inflight registry cleanup) is preserved. One blocking issue (B1): idempotency-replay case produces spurious error-level `costBreaker.infra_failure` log.

**Phase A (spec §4.1, §5):** The shared `RunCostResponse` type is correctly shaped. The pure-function extraction in RunCostPanelPure.ts is well-structured and the test matrix is complete. AdminAgentEditPage.tsx inline state map correctly retired.

**Phase B (spec §4.2, §6):** `computeRunResultStatus` correctly implements the §6.3 truth table. All three write-once terminal sites have the `AND run_result_status IS NULL` guard. One blocking issue (B2): `workspaceMemoryService.test.ts` does not call `extractRunInsights` — the overrides chain is untested.

**Verdict:** Two blocking issues must be fixed before merge: (B1) spurious error-level log on idempotency replay; (B2) integration test does not exercise the actual override chain.
