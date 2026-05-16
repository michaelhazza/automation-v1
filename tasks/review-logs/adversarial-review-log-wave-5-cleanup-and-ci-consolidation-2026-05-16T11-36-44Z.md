# Adversarial Review Log

**Build slug:** wave-5-cleanup-and-ci-consolidation
**Branch:** claude/wave-5-cleanup-and-ci-consolidation
**Timestamp:** 2026-05-16T11:36:44Z
**Reviewer:** adversarial-reviewer (Phase 1 advisory)
**Trigger:** Manual invocation + path-match (server/jobs/**, server/services/**, .github/workflows/**)

**Verdict:** NO_HOLES_FOUND

## Table of contents

1. Files reviewed
2. Threat-model checklist (RLS, Auth, Race, Injection, Resource, Cross-Tenant)
3. STRIDE sweep
4. Trust-boundary callout
5. Focus-area verdicts
6. Summary + disposition

## Files reviewed

- `.github/workflows/ci.yml`
- `.github/workflows/workspace-actor-coverage.yml` (deleted)
- `server/config/jobConfig.ts`
- `server/jobs/lib/definePruneJob.ts`
- `server/jobs/lib/__tests__/definePruneJob.test.ts`
- `server/jobs/webhookReplayNoncePruneJob.ts`
- `server/jobs/skillAnalyzerJob/stage5cSourceFork.ts`
- `server/jobs/skillAnalyzerJob/__tests__/stage5cSourceFork.filterByIndex.test.ts`
- `server/services/__tests__/assertInboxScope.test.ts`
- `server/services/__tests__/persistAndAnnounce.updateClaim.test.ts`
- `server/services/queueService/maintenanceJobs/clampMigrationConcurrency.ts`
- `server/services/queueService/maintenanceJobs/__tests__/clampMigrationConcurrency.test.ts`
- `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts`
- `server/db/schema/webhookReplayNonces.ts` (referenced)
- `server/services/supportInboxService.ts` (assertInboxScope implementation, referenced)
- `server/services/agentExecutionService/runLifecycle/persistRun.ts` (UPDATE-claim branch, referenced)

## Threat-model checklist

### 1. RLS / Tenant Isolation

No findings.

`definePruneJob` factory: enumerates orgs via `withAdminConnection` with `SET LOCAL ROLE admin_role` (correct admin-bypass for the cross-org enum step), then runs each org's DELETE inside `db.transaction` + `withOrgTx` with explicit `set_config('app.organisation_id', ${org.id}, true)`. RLS fires per org. The `WHERE organisation_id = ${org.id}::uuid` is defence-in-depth on top of RLS. The `webhookReplayNoncePruneJob` migration to this factory is strictly stronger than the previous single cross-org admin DELETE.

`assertInboxScope`: the test covers three paths (mismatch throws 403, match passes, org-tier null-subaccountId bypasses). The bypass is correct design: an org-admin principal is scoped to the whole org. No RLS gap.

`persistAndAnnounce` UPDATE-claim: `WHERE id = preCreatedRunId AND status = 'pending'` — pre-existing pattern, not changed by this diff. A `worth-confirming` observation (no explicit `organisationId` predicate) is noted in the Summary but is not introduced by this diff and is not an externally exploitable surface.

### 2. Auth & Permissions

No applicable risk in this diff. No new routes added. No permission-group changes. No webhook inbound handler changes. CI consolidation does not affect auth surfaces.

### 3. Race Conditions

No findings.

Batched-path `while(true)` loop in `definePruneJob.ts:98` is bounded by `batchDeleted < batchSize` exit condition and by the pg-boss `withTimeout` wrapper registered for each batched job in `pgBossRegistrations.ts`. `FOR UPDATE SKIP LOCKED` prevents two concurrent batch iterations from double-deleting the same rows. The `webhook_replay_nonces` prune uses the non-batched path (no `batchSize` set), so no `while(true)` applies.

`persistAndAnnounce` UPDATE-claim: the `WHERE status='pending'` guard makes the claim one-way — a concurrent transition away from pending causes an empty return, which the caller surfaces as a fail-loud error per spec §5.2.

### 4. Injection

No confirmed or likely holes. One worth-confirming observation.

`table` and `cutoffColumn` are validated against `/^[a-z][a-z0-9_]*$/` at factory construction time before being passed to `sql.raw()`. The `definePruneJob.test.ts` lines 70-102 confirm rejection of unsafe identifiers.

`extraWhere` (`definePruneJob.ts:50-61`): the validation regex `/^(AND|OR)\s/i` checks only the prefix — it does not validate the remainder of the string. Any value beginning with `AND ` or `OR ` reaches `sql.raw()`. Attack surface is limited because every current caller supplies a hardcoded module-level constant. The risk is an internal developer accidentally writing a malicious literal in a future job definition. Recommend a CI gate or documented review convention for new `extraWhere` values.

### 5. Resource Abuse

No findings.

`clampMigrationConcurrency`: `Math.max(1, Math.min(32, Math.floor(value)))` with `!Number.isFinite(value) || value <= 0` early-return guard. `Infinity` fails `Number.isFinite`. `-Infinity` fails both guards. `NaN` fails `Number.isFinite`. No bypass of the [1, 32] bound is possible. The env var `WORKSPACE_MIGRATION_CONCURRENCY` is operator-controlled, not user-controlled. All edge cases covered by the test file.

CI gate consolidation: The deleted `workspace-actor-coverage.yml` carried a single step: `npx tsx scripts/verify-workspace-actor-coverage.ts`. This command is confirmed present in `ci.yml` `unit_tests` job at line 55-56, under the step name "Verify workspace-actor coverage (Phase A gate)". The `unit_tests` job has the same `ready-to-merge` label gate condition as the deleted workflow. No coverage is lost.

### 6. Cross-Tenant Data Leakage

No findings.

Each org's DELETE in `definePruneJob` runs inside its own transaction with a per-org GUC and `withOrgTx`. Transaction isolation prevents org A's failure from affecting org B. Structured log fields include `orgId` — operator-internal audit log, not an external surface.

`stage5cSourceFork.ts` warning messages embed `forkCandidates: names` — these are display names of the same tenant's candidate skills within a single `skill_analyzer_jobs` row. No cross-tenant data reaches these fields.

## STRIDE sweep

**Spoofing:** No new routes or auth surfaces introduced. `assertInboxScope` confirms a 403 for sibling-subaccount callers. CI consolidation does not affect identity handling. No applicable risk in this diff.

**Tampering:** `definePruneJob` wraps every DELETE in per-org `withOrgTx` with RLS engaged. `persistAndAnnounce` UPDATE-claim is guarded by `status='pending'`. No applicable risk in this diff.

**Repudiation:** `definePruneJob` logs started/org_started/org_completed/completed at each phase. Optional `recordSecurityEvent` hook is available but not enabled for nonce pruning (correct — routine maintenance does not require security-audit trail). `persistAndAnnounce` event emission occurs downstream in the calling service, not in `persistRun.ts`. No new repudiation gap introduced by this diff.

**Information disclosure:** `stage5cSourceFork` fork warning messages embed skill display names scoped to the same tenant's job. `othersForIndex` fix prevents the old name-collapse bug without introducing new data exposure. No applicable risk in this diff.

**Denial of service:** Batched prune loop bounded by pg-boss timeout wrappers in `pgBossRegistrations.ts`. Nonce prune is non-batched. `clampMigrationConcurrency` hard-caps worker pool at 32 regardless of env var value. No applicable risk in this diff.

**Elevation of privilege:** `definePruneJob` uses admin connection only for org enumeration then scopes down to per-org `withOrgTx`. No privilege escalation path introduced. No applicable risk in this diff.

## Trust-boundary callout

**background job -> tenant data** (`definePruneJob` factory):
- Enforcement: `withAdminConnection` for org enumeration; `db.transaction` + `withOrgTx` + `set_config('app.organisation_id', ...)` for per-org DELETE. RLS fires under the org-scoped tx.
- Assessment: enforcement mechanism is present and correct. Migration of `webhookReplayNoncePruneJob` to this factory strengthens the previous boundary (single admin-bypass DELETE across all orgs is now per-org with RLS).

**CI pipeline integrity** (deleted `workspace-actor-coverage.yml`):
- Enforcement: the command `npx tsx scripts/verify-workspace-actor-coverage.ts` is absorbed into the `unit_tests` job in `ci.yml` (line 55-56) under the same `ready-to-merge` gate condition.
- Assessment: boundary enforcement is preserved.

## Focus-area verdicts

1. **Tenant-isolation in `assertInboxScope` and `persistAndAnnounce`:** Both clean. `assertInboxScope` correctly throws 403 before body validation for sibling-subaccount callers. The `persistAndAnnounce` UPDATE-claim path is guarded by `status='pending'`. Pre-existing `worth-confirming` observation on the missing `organisationId` predicate in the UPDATE WHERE clause is not introduced by this diff.
2. **Webhook replay protection — `webhookReplayNoncePruneJob` migration:** 10-minute window preserved verbatim (`retentionMillis: 10 * 60 * 1000`). Delete predicate semantics unchanged. Per-org migration adds stronger isolation. No nonce-window regression.
3. **Race conditions in `definePruneJob`:** Batched-path `while(true)` is bounded by timeouts. Non-batched nonce prune has no loop risk. `FOR UPDATE SKIP LOCKED` prevents concurrent double-deletes. No race holes found.
4. **`clampMigrationConcurrency` upper-bound bypass:** Not bypassable. `Math.min(32, ...)` clamps any finite positive value. `Infinity` is caught by `!Number.isFinite`. All edge cases test-covered.
5. **CI gate consolidation:** `verify-workspace-actor-coverage.ts` confirmed present in consolidated `ci.yml` at line 55-56. No gate coverage lost.
6. **`stage5cSourceFork` filter-by-index fix:** `othersForIndex(names, i)` uses index identity (`j !== i`), not value equality. Prevents the duplicate-name collapse bug. No information leakage between candidates. Test at `stage5cSourceFork.filterByIndex.test.ts` pins the `['A','A','B']` case.

## Summary

- Confirmed holes: 0
- Likely holes: 0
- Worth-confirming observations: 2
  - `extraWhere` in `definePruneJob`: partial-prefix regex allows arbitrary SQL suffix; mitigated by all callers being hardcoded module-level constants with no user-controlled path to this field.
  - Pre-existing: `persistAndAnnounce` UPDATE-claim WHERE clause has no `organisationId` predicate; not introduced by this diff, not externally exploitable.

## Disposition

Phase 1 advisory — non-blocking. Both `worth-confirming` observations routed to `tasks/todo.md` for backlog tracking (W5K-ADV-1 `extraWhere` regex tightening; W5K-ADV-2 `persistAndAnnounce` organisationId predicate — pre-existing, low priority).
