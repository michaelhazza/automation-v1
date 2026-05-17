# PR Review Log — wave-5-prevention-gates-and-rls (Round 3)

**Reviewer:** pr-reviewer
**Branch:** `claude/wave-5-prevention-gates-and-rls`
**Slug:** `wave-5-prevention-gates-and-rls`
**Scope:** 8 service files modified by dual-reviewer in commit `baa892f9`
**Timestamp:** 2026-05-17T03:15:00Z
**Reviewed against:** `origin/main`
**Commit at review:** `048237ab`

---

## Files Reviewed

- `server/services/agentScheduleService.ts` (boot path + per-org loop)
- `server/services/subaccountIeeBrowserSettingsService.ts` (3 methods)
- `server/services/operatorChainResumeService.ts` (composeResumePayload, executeFreshProfileRestart)
- `server/services/sandbox/browserWarmPool.ts` (_terminateAndWriteCostRow, checkout)
- `server/services/sandbox/ieeBrowserProfileManager.ts` (resolve, mount, unmount, recoverCorruption)
- `server/services/executionBackends/_ieeShared.ts` (ieeDispatchBrowser)
- `server/services/operatorChainSchedulerService.ts` (tryAcquireSlotAndDispatch, releaseSlotAndEnqueueNext)
- `server/services/operatorSessionService.ts` (getRunProgress only)

**Dual-GUC table coverage check:** all 6 dual-GUC tables (`operator_runs`, `operator_task_profiles`, `subaccount_operator_settings`, `subaccount_iee_browser_settings`, `iee_browser_session_profiles`, `browser_warm_sessions`) now have correct `getOrgScopedDb(...).transaction(...) + setOrgAndSubaccountGUC` plumbing across every changed-file access.

---

Blocking: 0 / Should-fix: 2 / Consider: 2
**Verdict:** APPROVED

---

## 🔴 Blocking

None. The dual-reviewer's 8 file edits correctly restore both:
1. Boot-time `withAdminConnection` + explicit `SET LOCAL ROLE admin_role` for cross-tenant sweeps in `agentScheduleService.initialize()`.
2. Dual-GUC SAVEPOINT plumbing on all 6 dual-GUC tables in all 8 files.

No fresh regressions introduced.

## 🟡 Should-fix

[🟡 R3-SF1] `agentScheduleService.ts:671` — pg-boss `pgboss.schedule(...)` is invoked INSIDE the per-org DB transaction. Cross-system atomicity concern, pre-existing but now explicit. Out-of-scope for this branch — route to tasks/todo.md.

[🟡 R3-SF2] No regression test was authored for the boot-path fix. Author a Vitest test mocking the DB tx and asserting `SET LOCAL ROLE admin_role` is issued first.

## 💭 Consider

[💭 R3-C1] `operatorChainSchedulerService.ts:104-111` — comment block justifies defensive dual-GUC on releaseSlotAndEnqueueNext. Worth recording in DEVELOPMENT_GUIDELINES.md §1 as guidance.

[💭 R3-C2] `ieeBrowserProfileManager.ts:193` (and similar) — UPDATE/SELECT where-clauses use only `eq(...id, profile.id)` with no defence-in-depth `organisationId`/`subaccountId` predicate. Pre-existing pattern; route to tasks/todo.md.

---

## What I verified concretely

1. Boot-path fix correctness — `registerAllActiveSchedules` and `registerAllOptimiserSchedules` both use `withAdminConnection({source, reason}, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`.
2. Per-org loop pattern — `registerAllOptimiserSchedules` lines 446–468 iterate the admin-enumeration result OUTSIDE the admin tx, then for each row opens a fresh `db.transaction(orgTx => { set_config + withOrgTx(...) })` matching `definePruneJob.ts`.
3. Dual-GUC plumbing on all 6 tables — every call to a dual-GUC table uses `getOrgScopedDb('source').transaction(async tx => { await setOrgAndSubaccountGUC(tx, orgId, subaccountId); ... })`.
4. Imports — all changed files have `setOrgAndSubaccountGUC` imported correctly; no unused imports.
5. TypeScript narrowing — `_ctx`/`_organisationId` re-activated where needed.
6. Atomicity restoration — `subaccountIeeBrowserSettingsService.setRolloutApproval:198` opens a SAVEPOINT around UPDATE + INSERT.

Blocking: 0 / Should-fix: 2 / Consider: 2
**Verdict:** APPROVED
