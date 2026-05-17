# PR Review — wave-5-prevention-gates-and-rls (R1)

**Files reviewed:** branch state across `server/services/**` (~200 files using `getOrgScopedDb` or `withAdminConnection`), `scripts/.gate-baselines/{duplicate-blocks,with-org-tx-or-scoped-db,universal-skill-sync,skill-registry-alignment}.txt`, `scripts/verify-{duplicate-blocks,with-org-tx-or-scoped-db,skill-registry-alignment}.sh`, `scripts/lib/with-org-tx-analyser.mjs`, `scripts/run-all-gates.sh`, `knip.json`, `server/config/universalSkills.ts`, `scripts/snapshots/action-registry.snapshot.json`, `server/lib/orgScopedDb.ts`, `server/lib/adminDbConnection.ts`, `server/middleware/auth.ts`, `server/lib/createWorker.ts`, sample service files (`agentExecutionService.ts`, `agentExecutionService/runLifecycle/*.ts`, `agentExecutionEventService.ts`, `actionService.ts`, `authService.ts`, `organisationService.ts`, `ghlOAuthStateStore.ts`, `ghlAgencyOauthService.ts`, `githubWebhookService.ts`, `stripeAgentWebhookService.ts`, `eaDrafts/eaDraftService.ts`, `voiceProfile/voiceProfileService.ts`, `workflowEngine/queueLifecycle/tick.ts`, `agentBeliefService.ts`), spec/plan/progress/tier-categorisation docs.
**Timestamp:** 2026-05-17T00:00:00Z
**Verdict prelude — count summary:** Blocking: 0 / Should-fix: 6 / Consider: 5
**Verdict:** CHANGES_REQUESTED

---

## Summary

The branch implements a large, mostly-careful service-tier RLS migration (~410 callsites moved to `getOrgScopedDb()`, ~90 to `withAdminConnection`) plus 6 prevention-gate verifications. The migration pattern itself is consistently correct (no removal of `eq(table.organisationId, ...)` predicates where they were present; clean `db` import removal; correct mixed Tier 1/Tier 2 partitioning per file). However the implementation overstates its own completeness in two important ways: (1) the gate's **numeric baseline (2153) is unchanged** despite ~410 callsites being migrated — the floor was never ratcheted down, so the gate's defence-in-depth claim is now slack by ~400 violations; (2) the **knip ignore-list** silences ~134 client/server files including non-trivial candidate dead code that should be triage candidates not silenced.

## 🔴 Blocking — must be fixed before merge

None.

## 🟡 Should-fix

[🟡 SF1] `scripts/guard-baselines.json:25` — the `with-org-tx-or-scoped-db` numeric baseline is still `2153`, identical to the pre-Wave-5 floor. After ~410 Tier 1 callsites were migrated, the current count is well below 2153. Ratchet down to current actual count.

[🟡 SF2] `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` — the per-file baseline still references migrated callsites (e.g. `agentExecutionService.ts:111:db.update() in 'executeRun'` is now `getOrgScopedDb('agentExecutionService.executeRun')`) and references to deleted files (workflowEngineService.ts). Prune.

[🟡 SF3] `knip.json:50-152` — ignore list enumerates ~134 files covering substantial product surface. Spec §7 says remaining flags are "candidate unused-file flags requiring follow-up triage"; silencing them is not triage. Route to `tasks/todo.md` for review.

[🟡 SF4] `server/services/authService.ts:285` and `server/services/organisationService.ts:26,38,48,69,236,246,250,256,262,268` — Tier 2 in tier-categorisation; not migrated. authService:285 has no annotation either. Either migrate to `withAdminConnection` or annotate.

[🟡 SF5] `server/services/workflowEngine/queueLifecycle/tick.ts:37,46,266,322` and `watchdog.ts` — tier-categorisation.md lists as Tier 1 but progress.md says "tracked exceptions". Reconcile: add DEFERRED:WF3/WF4 annotation to the rows in tier-categorisation.md.

[🟡 SF6] `scripts/verify-skill-registry-alignment.sh` — new gate has no fixture test. Author a Vitest test extracting pure logic to `scripts/lib/skill-registry-alignment-pure.mjs`.

## 💭 Consider

[💭 C1] Source string naming variation across `getOrgScopedDb(...)` calls. Future cleanup.

[💭 C2] `server/lib/orgScopedDb.ts:19` and `server/lib/adminDbConnection.ts:22-24` file-header comments claim "explicitly logs every invocation to `audit_events`" but implementation logs to stderr only. Rewrite.

[💭 C3] `agentRuns.where(eq(agentRuns.id, run.id))` calls lack `eq(agentRuns.organisationId, orgId)` predicate. Functionally bounded by RLS; pre-existing convention.

[💭 C4] `ghlAgencyOauthService.ts:291` and `githubWebhookService.ts:49-58` use a custom pattern (open `db.transaction`, manually SET set_config, then withOrgTx). A third entrypoint exists in practice. Future spec should name it.

[💭 C5] `progress.md:99-103` reports approximate counts ("~410", "~90", "116+"). Spec §9.10 requires concrete counts. Replace during finalisation.
