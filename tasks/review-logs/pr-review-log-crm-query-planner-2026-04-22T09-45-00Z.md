# PR Review — CRM Query Planner (P1–P3 on `claude/crm-query-planner-WR6PF`)
**Reviewed:** 2026-04-22T00:00:00Z
**Scope:** Files listed in the request brief — orchestration (`crmQueryPlannerService.ts`), stages 1–4 (`registryMatcherPure.ts`, `planCache*.ts`, `llmPlanner.ts`, `validatePlanPure.ts`), executors (`canonicalExecutor.ts`, `liveExecutor*.ts`, `hybridExecutor*.ts`), normaliser + approval cards, events, cost helper, schema context, route (`crmQueryPlanner.ts`), system-pnl planner metrics (`systemPnlService.ts`, `systemPnl.ts`, `SystemPnlPage.tsx`), GHL read helpers, shared types, action registry entry, `llmRequests.ts` `TASK_TYPES` extension.

---

## Blocking Issues (must fix before marking done)

### B1. `BudgetExceededError` catch in Stage 3 never fires — router throws a different shape
- **Files:** `server/services/crmQueryPlanner/crmQueryPlannerService.ts` lines 382–404; `server/services/llmRouter.ts` lines 585–676 (pre-call) and 1416–1440 (post-call `assertWithinRunBudgetFromLedger`); `server/lib/runCostBreaker.ts` lines 225–292.
- **What's wrong:** The service wraps `runLlmStage3(...)` in `try { ... } catch (err) { if (err instanceof BudgetExceededError) ... }`. But:
  - **Pre-call budget path** — `llmRouter` catches its own internal `BudgetExceededError`, writes a `budget_blocked` ledger row, then throws a **plain object literal** `{ statusCode: 402, code: 'BUDGET_EXCEEDED', message }` (router line 671). That object is not an `instanceof BudgetExceededError`; the planner's catch misses it entirely.
  - **Post-call cost-breaker path** — `assertWithinRunBudgetFromLedger` throws `FailureError` with `failureDetail === 'cost_limit_exceeded'` (`runCostBreaker.ts` line 283, re-thrown by the router at line 1440). Again, not a `BudgetExceededError`.
- **Result:** A per-run budget trip from `crmQueryPlanner` returns **HTTP 500** via `asyncHandler`, never the `BriefErrorResult { errorCode: 'cost_exceeded' }` the spec (§16.2) promises.
- **Fix:** Recognise both concrete shapes. Match on `(err instanceof BudgetExceededError) || (err && typeof err === 'object' && 'statusCode' in err && err.statusCode === 402) || (err instanceof FailureError && err.failure?.failureDetail === 'cost_limit_exceeded')`. Factor into `isBudgetExceeded(err)`. Add unit test with three mocked throw shapes.

### B2. `wasEscalated` not propagated to `llmRouter` — `getPlannerMetrics.escalationRate` silently always 0
- **Files:** `server/services/crmQueryPlanner/llmPlanner.ts` lines 195–250; `server/services/systemPnlService.ts` lines 680–720; `server/db/schema/llmRequests.ts` line 126.
- **What's wrong:** Escalation retry calls `singleLlmCall(...)` but the router context does not set `wasEscalated: true`. Ledger row stores `was_escalated = false` for both tier calls. `getPlannerMetrics` `COUNT(*) FILTER (WHERE was_escalated = TRUE)` is always 0.
- **Result:** Escalation-rate metric broken — operators can't see whether escalation is happening.
- **Fix:** In `llmPlanner.ts`, the escalation branch passes `wasEscalated: true` (and ideally `escalationReason`) on the router context. Unit test asserts the second router call's context carries `wasEscalated: true`.

### B3. Rate-limiter key mismatches `ghlAdapter` — planner does NOT share a bucket with ClientPulse polling
- **Files:** `server/services/crmQueryPlanner/executors/liveExecutor.ts` line 111; `server/adapters/ghlAdapter.ts` line 48; `server/routes/crmQueryPlanner.ts` line 58; `server/db/schema/subaccounts.ts` (no `locationId` column).
- **What's wrong:** Route reads `(subaccount as any).locationId` but `subaccounts` has no such column — so `context.subaccountLocationId` is always `subaccountId` (internal UUID). `liveExecutor` calls `getProviderRateLimiter('ghl').acquire(context.subaccountLocationId ?? context.subaccountId)` — also internal UUID. `ghlAdapter` keys on `config.locationId` (real GHL location). Two different keys → two independent buckets → no fair-queueing.
- **Result:** Spec §13.5, §16.3, and success-criterion #8 false in the shipped code.
- **Fix:** `liveExecutor.ts` already calls `resolveGhlContext(...)` returning `ghlCtx.locationId`. Acquire the token AFTER `resolveGhlContext` succeeds, keyed on `ghlCtx.locationId`. Drop or rename `ExecutorContext.subaccountLocationId`; remove the `as any` cast.

### B4. `crmQueryPlannerService.test.ts` — stale P1.2 assertion contradicts P2 wiring
- **File:** `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts` lines 101–106.
- **What's wrong:** Test `'unrecognised intent → unsupported_query artefact (Stage 3 stub)'` expects `unsupported_query`. P2 calls real `runLlmStage3`; no DB/provider creds in unit-test env → throws. Service maps thrown Stage 3 error to `ambiguous_intent`.
- **Result:** CI fails when this test runs.
- **Fix:** Inject a Stage 3 seam (`RunQueryDeps.runLlmStage3?: typeof runLlmStage3`) for test stubbing. Similar seams for validator/executors/cache so §20.2's "with mocked registry/cache/llmRouter/executors" holds.

### B5. Missing `integration.test.ts` — required RLS isolation test never landed
- **Spec:** §20.2. No file at `server/services/crmQueryPlanner/__tests__/integration.test.ts`.
- **Result:** Cross-tenant correctness unverified.
- **Fix:** Create `integration.test.ts` seeding two subaccounts, granting `crm.query` to both, running `runQuery` on subaccount-A's intent, asserting zero rows leak from subaccount-B. Use `rls.context-propagation.test.ts` harness pattern.

### B6. `crm.query` skill registered in `actionRegistry.ts` but no handler wired in `skillExecutor.ts`
- **Files:** `server/config/actionRegistry.ts` lines 2769–2798; `server/services/skillExecutor.ts` (no `'crm.query'` handler).
- **What's wrong:** Spec §18.2 promises agent-facing tool. ActionDefinition is metadata; dispatch runs through `skillExecutor.ts`'s handler map. Without a handler, agent invocation fails.
- **Result:** Success-criterion #1 ("planner is the single entry point for CRM reads") holds only for HTTP path; agents cannot yet read CRM data through the planner.
- **Fix:** Add a handler entry mapping `'crm.query'` to a function that imports `runQuery` lazily and translates skillExecutor context → `ExecutorContext`.

---

## Strong Recommendations (should fix)

### S1. Spec-invariant drift — "exactly one `stageResolved`-bearing event"
- Every success path emits both `planner.classified` AND `planner.result_emitted` with `stageResolved`. Spec §17.1 invariant broken OR spec needs to say "at least one". Decide and align.

### S2. `planCache.get` runs full validator with `as any` — type smell + wasted work
- Extract `rerunPrincipalRulesOnCachedPlan(plan, registry, callerCapabilities)` that runs only Rules 9–10. Drop the `as any`.

### S3. Hybrid executor's cap-pre-check is mis-named / mis-implemented
- `liveFilters.length > HYBRID_LIVE_CALL_CAP` — always 0 or 1, cap never trips. Implement per-row batched fan-out with true ceil(rowCount / batch_size) count, or simplify spec to match one-live-call model.

### S4. `llmPlannerPromptPure.buildPrompt` packs system+user into single message, unpacks later — awkward
- Return `{ system: string; userMessages: ProviderMessage[] }` directly.

### S5. Test runner in `crmQueryPlannerService.test.ts` uses JSON.stringify asserts + parallel promises — swallows async errors
- Sequentialize with `await` or adopt `plannerCostPure.test.ts` sync style.

### S6. `systemPnlService.getPlannerMetrics` has three fallbacks for drizzle result shape
- Standardise access pattern. Unit test the metric math with fixture rows.

### S7. `plannerEvents.emit` forwards every planner event as `skill.completed` — granularity lost
- Minor: fold intent hash + stageResolved into payload for debugging without log reads.

### S8. Missing test — Stage 2 cache hit re-validation with principal mismatch
- GWT: cached plan + caller B lacks required cap → emits `stage2_cache_miss { reason: 'principal_mismatch' }`.

### S9. Missing test — `cost_prediction_drift` warn-log fires when actual > 2× predicted
- GWT: 5 predicted, 15 actual → `logger.warn('cost_prediction_drift', {...})` + success artefact.

### S10. `resolveAmbientRunId` threads `runId` from `req.user`, but JWT payload doesn't carry it
- Documentation + explicit decision. Per-run cost-breaker and agent-log forwarding are only meaningful via the skill-executor path (B6).

---

## Non-Blocking Improvements

### N1. `ExecutorContext` duplicates `orgId` and `organisationId`
Pick one. Drop `orgId`; align handlers to `organisationId`.

### N2. `Promise.all` in `SystemPnlPage.tsx` couples planner-metrics failure to other cards
Use `Promise.allSettled` or per-endpoint try/catch.

### N3. Registry `aliases` shorter than spec §12.2 (3 vs 5)
Known (spec-open-1). Document on build ledger for §20.3 pressure test.

### N4. `NotImplementedError` class defined but never thrown anywhere in production code
Remove or document why it lingers.

### N5. Capability-gate unions all agents' skills — user's own permissions not checked
Document trade-off in route comment.

### N6. `mapOperatorForWire` lives in types file
Move to `shared/lib/` or helper file.

### N7. `liveExecutor.ts` default-case silently falls back to `listContacts`
Exhaustiveness `never` check.

### N8. `SCHEMA_CACHE_MAX` pruneExpired is TTL-only, not LRU
May exceed cap.

### N9. Hardcoded pricing map duplicates `llmPricing` table
TODO(spec-open-N) pointing at pricing table.

---

## Verdict

**BLOCKERS** — six issues (B1–B6). All six are correctness concerns affecting P3 success criteria; B1, B2, B3, B6 are behavioural gaps against the spec. B4, B5 are test-coverage gaps that mask them.

Strong recommendations S1–S10 and non-blocking improvements N1–N9 route to `tasks/todo.md` for a follow-up session.
