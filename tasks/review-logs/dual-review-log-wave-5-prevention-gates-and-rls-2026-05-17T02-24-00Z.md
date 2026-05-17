# Dual Review Log — wave-5-prevention-gates-and-rls

**Files reviewed:** branch `claude/wave-5-prevention-gates-and-rls` vs `main` (~410 Tier 1 callsite migrations + 6 prevention gates)
**Iterations run:** 3/3
**Timestamp:** 2026-05-17T02:24:00Z
**Commit at finish:** baa892f99e5822564764c6c6f783c310190efc95

---

## Iteration 1

Codex reviewed the full branch diff vs `main`. One finding raised.

[ACCEPT] P1 — server/services/agentScheduleService.ts:327 — Keep startup schedule sweeps out of org-scoped DB
  Reason: confirmed real bug. `agentScheduleService.initialize()` is called from `server/index.ts:662` at boot, outside any `withOrgTx` ALS context. The new `getOrgScopedDb()` calls at lines 327 and 377 would throw `failure('missing_org_context')` and break server startup. The startup sweep is intentionally cross-tenant (rehydrates pg-boss schedules across all orgs). Per DEVELOPMENT_GUIDELINES.md §2, the right access pattern for cross-org system work is `withAdminConnection` + explicit `SET LOCAL ROLE admin_role`.
  Fix applied: replaced the two cross-tenant `getOrgScopedDb()` SELECTs with `withAdminConnection({source, reason}, async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); return tx.select()... })`. For the per-row call to `registerOptimiserSchedule(subaccountId, organisationId)` (which uses `getOrgScopedDb` internally), wrapped each call in a per-org `withOrgTx` using the `db.transaction` + `set_config` + `withOrgTx` pattern from `server/jobs/lib/definePruneJob.ts`. Imports added: `sql` from drizzle-orm, `db`, `withAdminConnection`, `withOrgTx`.

## Iteration 2

Codex re-reviewed with iter-1 fix in place. Two findings raised, both in `subaccountIeeBrowserSettingsService.ts`.

[ACCEPT] P1 — server/services/subaccountIeeBrowserSettingsService.ts:57 — Restore subaccount GUC before dual-GUC table access
  Reason: confirmed real RLS regression. `subaccount_iee_browser_settings` carries a FORCE-RLS dual-GUC policy keyed on BOTH `app.organisation_id` AND `app.subaccount_id` (migration 0347). The `authenticate` middleware sets only `app.organisation_id`, never `app.subaccount_id` (verified: `setOrgAndSubaccountGUC` is the only setter, and `auth.ts` does not call it). The wave-5 migration replaced `db.transaction() + setOrgAndSubaccountGUC(...)` with `getOrgScopedDb()` directly, so every read/write to this table now fails-closed under FORCE RLS. Pattern violated the precedent already established by `operatorTaskProfileService.ts` and `subaccountOperatorSettingsService.ts` (both use `getOrgScopedDb(...).transaction(async (tx) => { await setOrgAndSubaccountGUC(tx, orgId, subaccountId); ... })`).

[ACCEPT] P2 — server/services/subaccountIeeBrowserSettingsService.ts:256 — Keep rollout approval and audit insert atomic
  Reason: confirmed real atomicity regression. The `setRolloutApproval` doc comment explicitly states "Audit row inserted IN THE SAME TRANSACTION." The original code opened its own `db.transaction(...)`, so update + audit-insert rolled back together on failure. The wave-5 rewrite shares the request-wide tx via `getOrgScopedDb()`, and `asyncHandler` catches errors and writes a response — which triggers `res.once('finish')` in `auth.ts`, settling the wrapping Promise without error and committing the request tx. An audit-insert failure would silently leave `rolloutApproved` changed without the required audit row.
  Fix applied (both findings): wrapped all three service methods (`getSettings`, `updateSettings`, `setRolloutApproval`) in `getOrgScopedDb(...).transaction(async (tx) => { await setOrgAndSubaccountGUC(tx, orgId, subaccountId); ... })`. The nested SAVEPOINT restores both the dual-GUC scoping AND the atomic boundary (a SAVEPOINT rollback propagates regardless of asyncHandler swallowing the error). Imports added: `setOrgAndSubaccountGUC` from `../lib/orgScoping.js`.

## Iteration 3

Codex re-reviewed with iter-2 fix in place. Three findings raised — all the same bug class as iter 2 (dual-GUC table access without subaccount GUC after wave-5 migration). Inspection of the broader diff revealed three additional files with the same regression that Codex did not directly flag.

[ACCEPT] P1 — server/services/operatorChainResumeService.ts:38-43 — Restore subaccount GUC before reading operator_runs
  Reason: confirmed. `operator_runs` (migration 0335) is dual-GUC RLS'd. Old code used `db.transaction() + setOrgAndSubaccountGUC`; new code calls `getOrgScopedDb()` directly. Affects `composeResumePayload` and `executeFreshProfileRestart`. Three other methods in this file (`readAgentRunForTask`, `resetChainFailureCount`, `accumulateBudgetExtension`) touch `agent_runs` (single-GUC) and remain correct as-is.
  Fix applied: wrapped the two affected methods in `getOrgScopedDb(...).transaction(async (tx) => { await setOrgAndSubaccountGUC(tx, orgId, subaccountId); ... })`. Import added: `setOrgAndSubaccountGUC`.

[ACCEPT] P2 — server/services/sandbox/browserWarmPool.ts:111-123 — Preserve dual-GUC scoping for warm-session queries
  Reason: confirmed. `browser_warm_sessions` (migration 0349) is dual-GUC RLS'd. Old code in `_terminateAndWriteCostRow` and `checkout` used `db.transaction() + setOrgAndSubaccountGUC`; new code calls `getOrgScopedDb()` directly. Notice that `_organisationId`/`_subaccountId` parameters had been silently underscored as unused — a code smell confirming the GUC plumbing was dropped without anyone noticing the resulting RLS gap.
  Fix applied: re-unused the underscored parameters, wrapped both functions in the canonical SAVEPOINT pattern. Import added: `setOrgAndSubaccountGUC`.

[ACCEPT] P2 — server/services/sandbox/ieeBrowserProfileManager.ts:53-68 — Preserve subaccount GUC for browser profiles
  Reason: confirmed. `iee_browser_session_profiles` (migration 0346) is dual-GUC RLS'd. Old code in `resolve`, `mount`, `unmount`, `recoverCorruption` used `db.transaction() + setOrgAndSubaccountGUC`; new code calls `getOrgScopedDb()` directly. `unmount` had a `_ctx` parameter that was being ignored — another sign of dropped GUC plumbing.
  Fix applied: wrapped all four affected methods in the canonical SAVEPOINT pattern. Re-named `_ctx` to `ctx` in `unmount` so the dual GUC can be set from the caller-provided org/subaccount IDs. `recoverCorruption` uses `profile.organisationId` / `profile.subaccountId` (the ProfileRow already carries both). Import added: `setOrgAndSubaccountGUC`.

[ACCEPT — proactively, not directly flagged by Codex] P1 — server/services/executionBackends/_ieeShared.ts:163-166 — Same dual-GUC regression on `ieeDispatchBrowser`
  Reason: same bug class as the three Codex findings in this iteration. `ieeDispatchBrowser` reads `subaccount_iee_browser_settings` (dual-GUC) without setting the subaccount GUC. Fixing only the Codex-flagged subset would leave the same regression live in the dispatch path. Per CLAUDE.md §7, fix the root cause, not just the symptoms.
  Fix applied: wrapped the settings read in `getOrgScopedDb(...).transaction(async (tx) => { await setOrgAndSubaccountGUC(tx, organisationId, subaccountId); return tx.select()... })`. Import added: `setOrgAndSubaccountGUC`.

[ACCEPT — proactively, not directly flagged by Codex] P1 — server/services/operatorChainSchedulerService.ts:40-83 — Same dual-GUC regression on slot accounting
  Reason: same bug class. `tryAcquireSlotAndDispatch` reads `subaccount_operator_settings` (dual-GUC, migration 0337) and `operator_runs` (dual-GUC) without setting subaccount GUC. Also, the wave-5 rewrite moved the `pg_advisory_xact_lock` from a short-lived dedicated tx to the request-wide tx — which is wrong scope semantics (holds the slot lock for the entire HTTP request rather than just the slot-accounting window).
  Fix applied: wrapped both methods in the canonical SAVEPOINT pattern. The SAVEPOINT also restores correct advisory-lock scope. Import added: `setOrgAndSubaccountGUC`.

[ACCEPT — proactively, not directly flagged by Codex] P2 — server/services/operatorSessionService.ts:637-653 — Same dual-GUC regression on `getRunProgress`
  Reason: same bug class. `getRunProgress` reads `operator_runs` (dual-GUC) without setting subaccount GUC. The `orgId` parameter had also been silently ignored after the wave-5 rewrite.
  Fix applied: wrapped the read in the canonical SAVEPOINT pattern. Restored use of `orgId`. Import added: `setOrgAndSubaccountGUC`.

## Changes Made

- `server/services/agentScheduleService.ts` — `registerAllActiveSchedules` and `registerAllOptimiserSchedules` migrated from `getOrgScopedDb()` to `withAdminConnection` + `SET LOCAL ROLE admin_role` for boot-time cross-tenant sweeps; per-row `registerOptimiserSchedule` calls wrapped in per-org `withOrgTx`.
- `server/services/subaccountIeeBrowserSettingsService.ts` — `getSettings`, `updateSettings`, `setRolloutApproval` wrapped in `getOrgScopedDb(...).transaction()` + `setOrgAndSubaccountGUC` to restore dual-GUC RLS scoping and atomicity of rollout-approval audit insert.
- `server/services/operatorChainResumeService.ts` — `composeResumePayload`, `executeFreshProfileRestart` wrapped in canonical dual-GUC SAVEPOINT pattern.
- `server/services/sandbox/browserWarmPool.ts` — `_terminateAndWriteCostRow`, `checkout` wrapped in canonical dual-GUC SAVEPOINT pattern; reactivated `organisationId`/`subaccountId` params.
- `server/services/sandbox/ieeBrowserProfileManager.ts` — `resolve`, `mount`, `unmount`, `recoverCorruption` wrapped in canonical dual-GUC SAVEPOINT pattern.
- `server/services/executionBackends/_ieeShared.ts` — `ieeDispatchBrowser` settings read wrapped in dual-GUC SAVEPOINT pattern.
- `server/services/operatorChainSchedulerService.ts` — `tryAcquireSlotAndDispatch`, `releaseSlotAndEnqueueNext` wrapped in dual-GUC SAVEPOINT pattern; restores correct `pg_advisory_xact_lock` scope.
- `server/services/operatorSessionService.ts` — `getRunProgress` wrapped in dual-GUC SAVEPOINT pattern; restored use of `orgId` param.

Lint: 0 errors (881 pre-existing warnings unchanged).
Typecheck: clean (both `tsconfig.json` and `server/tsconfig.json`).
P2 gate verification: skipped — CI-only per CLAUDE.md § *Test gates are CI-only*. The changes affect access-path shape only (replacing `getOrgScopedDb()` with `getOrgScopedDb(...).transaction(...)` + GUC setter), not the gate-relevant call-site count.

## Rejected Recommendations

None. All Codex findings across the three iterations were accepted as real bugs introduced by the wave-5 migration, and applied with the canonical pattern already established in the codebase (`operatorTaskProfileService.ts`).

---

**Verdict:** APPROVED (3 iterations, 9 fixes applied — 6 directly Codex-flagged P1/P2 findings plus 3 same-class regressions proactively fixed to address the root cause). All accepted Codex findings have been resolved in-branch. The wave-5 migration's RLS-tier conversion correctly enforced "no direct `db` in services", but it dropped the dual-GUC plumbing on six dual-GUC tables — Codex caught four; broader inspection of the diff against the dual-GUC table set (`operator_runs`, `operator_task_profiles`, `subaccount_operator_settings`, `subaccount_iee_browser_settings`, `iee_browser_session_profiles`, `browser_warm_sessions`) surfaced the remaining three. No further unresolved findings at loop exit.
