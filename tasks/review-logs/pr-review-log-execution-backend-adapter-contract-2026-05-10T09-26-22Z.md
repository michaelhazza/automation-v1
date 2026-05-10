# PR Review Log — execution-backend-adapter-contract (Round 1)

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**HEAD commit at review:** `cb421d95`
**Reviewed at:** 2026-05-10T09:26:22Z
**Reviewer:** pr-reviewer (independent pass, dispatched from feature-coordinator §8.3)

**Verdict:** CHANGES_REQUESTED (0 blocking, 4 strong, 2 non-blocking)

## Contents

1. Files reviewed
2. Top-level summary
3. Blocking issues
4. Strong recommendations
5. Non-blocking improvements
6. Caller-supplied focus list confirmation

## 1. Files reviewed

- `migrations/0313_execution_backend_columns.sql` + `.down.sql`
- `server/db/schema/agentRuns.ts`, `server/db/schema/organisations.ts`
- `server/services/agentExecutionTypes.ts` (NEW)
- `server/services/agentExecutionLoop.ts` (NEW)
- `server/services/executionBackends/{types,options,registry,_ieeShared,_apiHeadlessShared,apiBackend,headlessBackend,claudeCodeBackend,ieeBrowserBackend,ieeDevBackend}.ts` (NEW)
- `server/services/executionBackends/__tests__/{contractPure,registryPure}.test.ts` (NEW)
- `server/services/agentExecutionService.ts` (cutover)
- `server/services/agentRunFinalizationService.ts` (orchestrator + alias removal)
- `server/services/queueService.ts` (cron rename + unschedule shim)
- `server/jobs/ieeRunCompletedHandler.ts`
- `server/index.ts` (boot registration)
- `server/services/__tests__/agentRunFinalizationServicePure.test.ts` (F2 case removed)
- `architecture.md`, `DEVELOPMENT_GUIDELINES.md`, `docs/openclaw-strategic-analysis.md`

## 2. Top-level summary

The refactor is structurally clean. Contract types, registry validation, capability gating, mismatch invariants, cycle-prevention discipline, EBAC-ADV-1 dispatch UPDATE org-scoping, cron rename + unschedule shim, alias removal, and architecture.md update are all in good shape. Per-adapter mismatch tests cover all five real adapter implementations. Behaviour parity for V1 looks intact.

Four issues warrant attention. None block the build for the default `pg-boss` deployment, but each represents a regression from the just-added §8.32 rule, a coverage gap created in the same branch that asserts the coverage claim, an env-coupling regression, or a defence-in-depth deficit on a path the operator just hardened with EBAC-ADV-1.

## 3. Blocking issues

None. The refactor preserves behaviour, EBAC-ADV-1 dispatch fix is correctly applied, RLS posture is unchanged, the cron rename + unschedule shim is well-designed, and the registry validation is comprehensive. Verdict is `CHANGES_REQUESTED` because the operator-promised coverage rule (§8.32, added this branch) is itself not satisfied — see Strong #1.

## 4. Strong recommendations

### Strong #1 — §8.32 cycle-prevention assertion does not cover every file in the chain

**Where:** `server/services/executionBackends/__tests__/contractPure.test.ts:201-265`

§8.32 (`DEVELOPMENT_GUIDELINES.md:236-238`, added in this branch's commit `1898b1ef`) requires extending the assertion to cover every file in the chain. Current implementation only asserts on `types.ts` and `options.ts`. Cycle-relevant chain:

```
agentExecutionService.ts -> registry.ts -> {api,headless,claude-code,iee_browser,iee_dev}Backend.ts
                                           -> {_apiHeadlessShared.ts, _ieeShared.ts}
                                           -> agentExecutionLoop.ts
```

Today none of these import from `agentExecutionService.ts` (verified by grep). Future regression risk is what the assertion catches.

**Fix:** add a Vitest `it.each(...)` that walks all 8 files and asserts none contain a runtime (non-`import type`) import of `agentExecutionService.ts`.

### Strong #2 — F2 legacy-fallback test removed in `1d948ecc` with no replacement

**Where:** `server/services/__tests__/agentRunFinalizationServicePure.test.ts:14-19`

The deletion claims F2 is "exercised by the DB-touching orchestrator tests" — but `Glob **/agentRunDelegationFlow*` returns zero matches; `Grep finaliseAgentRunFromBackend` finds only this one file. Acceptance criterion §16 #14 has no automated coverage. A regression in `ieeRunCompletedHandler.ts:95` (`backendId = ieeRun.type === 'browser' ? ... : ...`) cannot be caught.

**Fix:** add a pure helper test for the `ieeRun.type === 'browser' ? 'iee_browser' : 'iee_dev'` derivation in `executionBackends/__tests__/registryPure.test.ts`. No DB needed.

### Strong #3 — Adapter registration gated on `JOB_QUEUE_BACKEND === 'pg-boss'`

**Where:** `server/index.ts:660-679`

All five adapter `register()` calls live inside `if (env.JOB_QUEUE_BACKEND === 'pg-boss')`. The env enum allows `'bullmq'`. With `JOB_QUEUE_BACKEND='bullmq'`, the registry is empty at HTTP-handler time and EVERY `executeRun` invocation throws `BackendNotRegistered` for ALL modes. Regression from pre-cutover (the if/else ladder had no queue-backend dependency).

**Fix:** move adapter registration out of the pg-boss gate into an unconditional block. Three of five adapters have no pg-boss dependency at all; the two IEE adapters need pg-boss only at event-handler time, not register time.

### Strong #4 — `finalise()` UPDATE writes lack `organisationId` predicates

**Where:** `server/services/executionBackends/_ieeShared.ts:307-310, 382-405, 418-421`

Three `tx.update(...)` writes inside `ieeFinalise()` filter only by `id`. `DEVELOPMENT_GUIDELINES §1` requires `organisationId` predicate on every write by ID. The orchestrator opens plain `db.transaction(...)` not `withOrgTx(...)`, so `app.organisation_id` is unset and RLS provides zero defence-in-depth.

Pre-existing behaviour lifted from legacy `finaliseAgentRunFromIeeRun`. The same operator just shipped EBAC-ADV-1 against the analogous dispatch UPDATE — closing this is consistent.

**Fix:** thread `organisationId` from `parentRun.organisationId` and `ieeRun.organisationId` into the three `.where(...)` clauses. Pure defence-in-depth.

## 5. Non-blocking improvements

**NB #1 — `BackendTerminalState.agentRunId` typed `string` but populated nullable.** `_ieeShared.ts:242` writes `agentRunId: row.agentRunId ?? ''`. Cleaner: change contract field to `string | null`, drop the coercion.

**NB #2 — Spec drift on `claudeCodeBackend.backendTaskId`.** Plan said `null`; impl surfaces `ccResult.sessionId`. Drift documented in inline comment, observability rationale is good. Note in `progress.md`; consider spec amendment.

## 6. Caller-supplied focus list confirmation

1. Surgical-changes — clean. Every file traces to spec sections.
2. RLS / org-scoping — EBAC-ADV-1 fix correct; Strong #4 flags the `finalise()` gap.
3. Migration safety — fully additive, reversible, no RLS change. Safe.
4. Cron rename + unschedule shim — correctly idempotent.
5. Adapter ownership of writes — spec §13.1.1 sequence honoured verbatim.
6. Registry V1 invariant — OpenClaw IDs rejected at boot. Confirmed.
7. Type-safety + neutral file — clean, no `services/` imports in the neutral file.
8. Cycle prevention — runtime check passes; assertion under-scoped (Strong #1).
9. Code quality — DRY well-served, naming/error typing/logging consistent.
10. Test coverage — contract surface + registry covered. Gaps: Strong #1 (assertion), Strong #2 (F2).

**Verdict:** CHANGES_REQUESTED (0 blocking, 4 strong, 2 non-blocking)
