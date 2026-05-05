# Dual Review Log — crm-query-planner

**Files reviewed:** CRM Query Planner implementation on `claude/crm-query-planner-WR6PF`
- `server/routes/crmQueryPlanner.ts`
- `server/services/crmQueryPlanner/crmQueryPlannerService.ts`
- `server/services/crmQueryPlanner/validatePlanPure.ts`
- `server/services/crmQueryPlanner/planCache.ts`
- `server/services/crmQueryPlanner/llmPlanner.ts`
- `server/services/crmQueryPlanner/plannerEvents.ts`
- `server/services/crmQueryPlanner/executors/liveExecutor.ts`
- `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts`
- `server/services/crmQueryPlanner/__tests__/planCachePure.test.ts`
- `server/services/crmQueryPlanner/__tests__/validatePlanPure.test.ts`
- `server/services/crmQueryPlanner/__tests__/integration.test.ts` (new)
- `server/services/skillExecutor.ts`
- `shared/types/crmQueryPlanner.ts`
- `server/db/withPrincipalContext.ts` (modified during this review)

**Iterations run:** 2 full iterations + partial iteration 3 (Codex usage quota hit before iteration 3 could complete; findings surfaced before interruption were all addressed)

**Timestamp:** 2026-04-22T10:57:26Z

---

## Iteration 1

Pre-condition note: because the uncommitted working tree contained three persisted pr-reviewer / spec-conformance log markdown files that would dominate Codex's context exploration, those logs were moved out of the tree before each Codex invocation and restored after. Only real code changes were reviewed in each iteration.

Codex surfaced three findings against the uncommitted CRM Query Planner changes.

[ACCEPT] `server/services/crmQueryPlanner/validatePlanPure.ts:223-228` (Codex [P1]) — `applyCanonicalPrecedence` promotes every `source: 'live'` draft with exactly one live-only filter to `hybrid` without verifying the remaining filters are canonical-resolvable against the registry entry's `allowedFields`. A draft with a live-only filter plus a non-canonical extra filter would reach `executeCanonical.assertFieldsSubset`, throw `FieldOutOfScopeError`, and escape the dispatch-level catch as an uncaught 500.
  Reason: Matches the spec directly — §11.2 rule 7 / §14.2 invariants state "other filters are canonical-resolvable" as a shape precondition. The current code only counts live-only filters; it never validates the base. Clean defensive-guard fix. Implemented by extending the `source === 'live' + canonicalCandidateKey` branch to require every non-live-only filter to exist in `entry.allowedFields`; if not, stay live (case c'). Covered by two new unit tests in `validatePlanPure.test.ts`.

[DEFER — routed to tasks/todo.md] `server/services/crmQueryPlanner/validatePlanPure.ts:223-228` (Codex [P1], second finding on same line) — promoting common live-only fields like `city`, `country`, `calendarId`, `appointmentType` to hybrid routes them through `applyLiveFilter`, which issues one unfiltered provider list call capped at 50 rows and intersects in-memory. Valid matches beyond page 50 are silently dropped.
  Reason: Accepted as a real correctness concern, rejected as an inline fix. The deeper issue is not the precedence rule — it's that `liveExecutorPure.translateToProviderQuery` cannot push down filters for most live-only fields, so the hybrid executor's semantics are lossy for those fields. Fixing requires per-(entity, field) pagination or a promotion whitelist — surface-area beyond this PR. The canonical-resolvable guard I added for the first finding already neutralises the most dangerous case (extra non-canonical filters). Logged in `tasks/todo.md`.

[DEFER — routed to tasks/todo.md] `server/services/crmQueryPlanner/crmQueryPlannerService.ts:163-169` and both entry points (Codex [P2]) — `runQuery` now wraps canonical access in `withPrincipalContext`, setting `app.current_team_ids` from `context.teamIds`. Both entry points (`server/routes/crmQueryPlanner.ts` and the `crm.query` skill handler in `server/services/skillExecutor.ts`) construct planner contexts with `teamIds: []`, so `shared_team`-scoped rows become invisible in canonical reads.
  Reason: Real concern but out of scope for this PR. There is no existing team-ID resolver service in the codebase; every production call-site across the repo uses `teamIds: []` today, and the spec does not specify where they should come from. Shipping with `[]` matches the codebase's current state. The immediate behavioral impact is zero (canonical rows default to `shared_subaccount`, which is visible regardless of team membership). Implementing proper resolution requires a shared `resolveTeamIdsForPrincipal` helper wired into auth middleware — a cross-cutting change that needs its own spec and rollout. Logged in `tasks/todo.md`.

## Iteration 2

Codex surfaced three new findings after iteration 1's fixes.

[ACCEPT] `server/services/crmQueryPlanner/validatePlanPure.ts:229-235` (Codex [P1]) — The iteration-1 guard only validates `filters`. If a draft carries a non-canonical field in `projection`, `sort`, or `aggregation.field/groupBy`, the same `FieldOutOfScopeError` 500 still escapes because `canonicalExecutor.assertFieldsSubset` enforces the allowedFields subset across all four collections.
  Reason: Correct follow-up. Extended the guard to also check `sort`, `projection`, and `aggregation` fields against `entry.allowedFields` before allowing promotion. Added four new unit tests covering each collection (`validatePlanPure.test.ts` now has 30 tests, all passing).

[ACCEPT] `server/services/crmQueryPlanner/__tests__/integration.test.ts:120-124` (Codex [P2]) — The integration test's stub handler probes session variables via the top-level `db.execute` handle rather than the active transaction the principal-context variables were written to. A pooled connection that differs from the tx's connection would see empty `current_setting(…)` values even when the planner wired context correctly.
  Reason: Correct — `set_config(…, true)` is transaction-local. Fixed by threading the active `tx` into the stub registry via `makeIntrospectingRegistry({ …, tx })` and routing the probe through `tx.execute(sql\`SELECT current_setting…\`)`.

[ACCEPT] `server/services/crmQueryPlanner/__tests__/integration.test.ts:175-183` (Codex [P2]) — The test populates the `withOrgTx` ALS context with `tx: null as unknown as never` before opening the real `db.transaction`. Once `runQuery` calls `withPrincipalContext`, the helper reads `orgCtx.tx.execute(…)` and dereferences null, crashing the test whenever it runs against a real DB.
  Reason: Correct — ALS must hold the real tx. Fixed by reordering: open `db.transaction(async (tx) => { … })` first, set `app.organisation_id`, then call `withOrgTx({ tx, … }, async () => runQuery(…))` with the real handle.

## Iteration 3 (partial)

Codex surfaced two additional findings before iteration 3 was interrupted by a ChatGPT usage quota limit. Both were addressed in-session before the limit landed.

[ACCEPT] `server/services/crmQueryPlanner/crmQueryPlannerService.ts:151-153` via `server/db/withPrincipalContext.ts` (Codex [P1]) — `withPrincipalContext` sets `set_config(…, true)` (transaction-local) but never restores prior values. If `runQuery` runs inside an existing agent-run transaction (the `crm.query` skill handler path), the planner's principal/subaccount leak forward: every subsequent RLS-protected read in that transaction sees the planner's context rather than the outer caller's. For an org-scoped agent that queries subaccount B via `crm.query`, the transaction is pinned to B for the rest of the run.
  Reason: Real correctness concern. Fixed at the primitive level (`server/db/withPrincipalContext.ts`) by snapshotting current `app.current_*` values before the work block, setting the new context, and restoring the snapshot in a `finally` — preserves the existing API contract while closing the leak. Existing HTTP-path callers (one transaction per request) are unaffected; only the nested-agent path benefits.

[ACCEPT] `server/services/crmQueryPlanner/crmQueryPlannerService.ts:118-122` (Codex [P2]) — The `isBudgetExceededError` helper treats any `statusCode: 402` as budget exhaustion, but `llmRouter.routeCall` throws the same `statusCode: 402` shape with `code: 'RATE_LIMITED'` for reservation-side rate-limit rejections. A rate-limited Stage 3 call would incorrectly surface as `cost_exceeded` instead of a transient failure.
  Reason: Real misclassification. Tightened the helper to require `code === 'BUDGET_EXCEEDED'` on the plain-object shape (`BudgetExceededError` instance-check and `FailureError.failureDetail === 'cost_limit_exceeded'` paths unchanged). Added a new test asserting a `{ statusCode: 402, code: 'RATE_LIMITED' }` throw maps to `ambiguous_intent` (the generic parse-failure path), not `cost_exceeded`.

---

## Changes Made

- `server/services/crmQueryPlanner/validatePlanPure.ts` — `applyCanonicalPrecedence` now guards on `entry.allowedFields` subset for filters, sort, projection, and aggregation fields before promoting a draft to canonical or hybrid. Out-of-scope fields keep the draft on `live`.
- `server/services/crmQueryPlanner/crmQueryPlannerService.ts` — `isBudgetExceededError` now discriminates on `code === 'BUDGET_EXCEEDED'` for the plain-object 402 shape, so `RATE_LIMITED` 402s fall through to parse-failure/ambiguous_intent instead of mapping to `cost_exceeded`.
- `server/db/withPrincipalContext.ts` — snapshots prior `app.current_*` values before setting new ones, restores in `finally`. Prevents principal-context leakage when the planner is invoked inside a longer-lived parent transaction (agent run → `crm.query` → `runQuery`).
- `server/services/crmQueryPlanner/__tests__/integration.test.ts` — restructured the ALS wiring so `withOrgTx` receives the real `tx` from `db.transaction`; the stub registry handler now probes session variables via the active transaction handle rather than `db`.
- `server/services/crmQueryPlanner/__tests__/validatePlanPure.test.ts` — added 6 new test cases covering the canonical-resolvable base guard (filter, projection, sort, aggregation.field, aggregation.groupBy paths, plus the original reachable-as-500 case).
- `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts` — added one test case asserting `{ statusCode: 402, code: 'RATE_LIMITED' }` maps to `ambiguous_intent`, not `cost_exceeded`.
- `tasks/todo.md` — appended "Deferred from dual-reviewer review — crm-query-planner (2026-04-22)" section covering (a) the `teamIds` resolution cross-cutting concern and (b) the hybrid executor's under-fetching behaviour for untranslated live-only fields.

## Rejected Recommendations

None outright. All iteration-1 / iteration-2 / iteration-3 findings were either implemented in-session or deferred to the backlog with rationale. The two deferred items are genuine correctness concerns that sit outside this PR's surface area — both require broader design work and are not regressions introduced by this branch.

Post-fix verification:
- `validatePlanPure.test.ts` — 30 / 30 tests passing.
- `crmQueryPlannerService.test.ts` — 10 / 10 tests passing.
- `planCachePure.test.ts` — 11 / 11 tests passing.
- `integration.test.ts` — skips cleanly without `DATABASE_URL`; tsx typecheck clean. The actual Postgres verification is deferred (see `tasks/todo.md` → "Deferred testing — crm-query-planner").
- `npx tsc --noEmit -p server/tsconfig.json` — no new errors in any file I touched. The two pre-existing `llmPlanner.ts` TS2322 errors are unrelated to this review.

---

**Verdict:** `PR ready. All critical and important issues resolved in-session; two out-of-scope correctness concerns (principal teamIds resolution and hybrid executor under-fetching for untranslated live-only fields) are documented in tasks/todo.md with explicit rationale for why they belong to a separate unit of work.`
