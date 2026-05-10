# PR Review Log — execution-backend-adapter-contract (Round 2)

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**HEAD commit at review:** `91a8b09a` (fix-loop on top of round-1 base `cb421d95`)
**Reviewed at:** 2026-05-10T09:40:37Z
**Reviewer:** pr-reviewer (round 2 — Strong-finding closure verification)
**Round-1 log:** `tasks/review-logs/pr-review-log-execution-backend-adapter-contract-2026-05-10T09-26-22Z.md`

**Verdict:** APPROVED (0 blocking, 0 strong, 1 non-blocking)

## Closure status — round-1 Strong findings

### Strong #1 — §8.32 cycle-prevention coverage — CLOSED
`contractPure.test.ts:282-316` extends the assertion with an `it.each` over the 8-file chain (registry, _ieeShared, _apiHeadlessShared, all 5 backends). Regex tightened from `agentExecutionService[^'"]*` to `agentExecutionService\.(?:js|ts)` so it doesn't false-match `agentExecutionServicePure.js` (which `_ieeShared.ts:44` legitimately imports).

### Strong #2 — F2 derivation coverage — CLOSED
`agentRunFinalizationServicePure.ts` exports `deriveBackendIdFromIeeType(ieeType: 'browser' | 'dev'): 'iee_browser' | 'iee_dev'`. `ieeRunCompletedHandler.ts` consumes it. `registryPure.test.ts` adds two truth-table assertions. Acceptance §16 #14 has automated coverage without a DB.

### Strong #3 — Adapter registration unconditional — CLOSED
`server/index.ts:648-673` lifts the five `register()` calls out of the pg-boss gate into an unconditional try/catch. The IEE event handler stays in the pg-boss-gated block at 682-690. Boot-ordering invariant is documented inline.

### Strong #4 — finalise() org-id predicates — CLOSED
`_ieeShared.ts::ieeFinalise` — three writes now carry `organisationId` predicates:
- 307-313 (orphan eventEmittedAt stamp)
- 385-409 (parent agentRuns terminal UPDATE — uses `parentRun.organisationId as string` cast forced by the contract type `[key: string]: unknown`; safe because `agent_runs.organisation_id` is notNull)
- 421-428 (post-transition eventEmittedAt stamp)

Defence-in-depth posture now consistent with EBAC-ADV-1.

## Regressions / new issues introduced by the fixes

None observed. Lint clean (0 errors), typecheck clean, 45/45 targeted tests pass.

## Non-blocking observations

**NB #1 — cycle-chain coverage stops at the `executionBackends/` directory boundary.** The chain narrative mentions `agentExecutionLoop.ts` as part of the dispatch chain (reached via `_apiHeadlessShared.ts`), but the test scopes only to files under `server/services/executionBackends/`. Today `agentExecutionLoop.ts:117` has only `import type` from `agentExecutionService.ts` (safe). A future regression promoting that to a runtime import would not be caught by this assertion. Optional follow-up; non-blocking.

Round-1 NB items (NB#1 nullable agentRunId typing, NB#2 claudeCode backendTaskId spec drift) remain unaddressed — consistent with their non-blocking classification. Carry forward as backlog.

## Verdict

**Verdict:** APPROVED (0 blocking, 0 strong, 1 non-blocking)

Round-1's four Strong findings are all closed with the right shape of fix. No regressions introduced. One minor cycle-coverage gap on `agentExecutionLoop.ts` is non-blocking and can ride a follow-up.
