# PR Review Log: memory-tiered-consolidation

**Reviewed:** 2026-05-18T05:30:00Z
**Branch:** memory-tiered-consolidation
**Reviewer:** pr-reviewer (read-only, independent)

Blocking: 7 / Should-fix: 9 / Consider: 7
**Verdict:** CHANGES_REQUESTED (7 blocking, 9 should-fix)

**Files reviewed:**
- migrations/0370, 0371, 0372 + .down counterparts
- shared/types/memoryConsolidation.ts
- server/config/featureFlags.ts, server/config/memoryConsolidationConfig.ts
- server/services/memoryConsolidationPromotionDispatcher.ts
- server/services/workspaceMemoryService/reinforcementBatch.ts
- server/services/workspaceMemoryService/decayPure.ts
- server/services/workspaceMemoryService/hybridRetrieval.ts (delta)
- server/services/memoryBlockSynthesisService.ts (evaluatePromotion delta)
- server/services/memoryReviewQueueService.ts (approve/reject promote_to_procedural)
- server/routes/memoryReviewQueue.ts (delta)
- server/jobs/memoryConsolidationPromotionJob.ts
- server/jobs/memoryDecayJob.ts
- server/db/schema/workspaceMemoryEntryTierTransitions.ts
- server/db/schema/workspaceMemories.ts (delta), server/config/rlsProtectedTables.ts (delta)
- server/services/queueService/maintenanceJobs/pgBossRegistrations.ts (delta)
- scripts/audit/audit-memory-consolidation.ts + tests
- client/src/pages/MemoryReviewQueuePage.tsx (delta)
- 3 unit test files (vitest)

## Blocking

[🔴 B-1] server/jobs/memoryConsolidationPromotionJob.ts:37-44
Cross-tenant enumeration runs on the default `db` pool with FORCE RLS enabled and no `app.organisation_id` set. RLS returns zero rows silently, so `tenants` is always empty and the job is a permanent no-op.
Why: `workspace_memory_entries` policy from migration 0245 fails closed when the GUC is absent. `memoryDecayJob.ts` already solved this by wrapping in `withAdminConnection` + `SET LOCAL ROLE admin_role`. Fix: mirror that exactly — wrap the enumeration in `withAdminConnection({source: 'jobs.memoryConsolidationPromotionJob', reason: 'Cross-org tenant enumeration'}, async (tx) => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); /* enumerate */ })` and keep the per-tenant `withOrgTx` loop unchanged.

[🔴 B-2] scripts/audit/audit-memory-consolidation.ts:553-557
Audit checks 1, 2, 4, 5 run cross-tenant aggregates against the bare `db` without admin-role elevation or org GUC. RLS silently returns empty result sets, so every check passes with zero findings — the audit ships green by construction.
Why: Only Check 6 elevates via `db.transaction` + `SET LOCAL ROLE admin_role`. Checks 1/2/4/5 do not. Fix: either iterate per-tenant (enumerate via admin role, then `withOrgTx` per org for each check, per spec §13 intent), or wrap each cross-tenant check in the same `transaction` + `SET LOCAL ROLE admin_role` pattern as Check 6 and document the cross-tenant carve-out inline.

[🔴 B-3] server/services/memoryReviewQueueService.ts:271-322, server/routes/memoryReviewQueue.ts:62-68
`approvePromoteToProcedural` accepts a body-supplied `subaccountId` and writes it into `workspace_memory_entry_tier_transitions` without verifying it matches the queue row's actual `subaccount_id`. A user with `SUBACCOUNTS_EDIT` on org X who supplies a different subaccount within the same org promotes the entry (only `id` + `tier` guard the UPDATE) and corrupts the audit row's subaccount.
Why: The locked SELECT reads the row but doesn't compare its `subaccount_id` to the route-supplied value, and the downstream UPDATE doesn't filter by subaccount. Fix: read `subaccount_id` from the locked queue row, ignore the body-supplied value, and use the row's subaccount_id for both `runCanonicalPromotion` and the audit insert. The route should also stop requiring `subaccountId` in the body for this item type.

[🔴 B-4] server/services/memoryConsolidationPromotionDispatcher.ts:185-216, 300-312
The guarded UPDATEs on `workspace_memory_entries` (auto-promotion + canonical helper) filter only by `id` and `consolidation_tier` — no explicit `organisationId` / `subaccountId`. DEVELOPMENT_GUIDELINES.md §1 + §8.35 both require these as defence-in-depth on state-changing UPDATEs even when RLS is in play.
Why: RLS is the silent backup; the rule is layered defence. Detection gate `verify-org-scoped-writes.sh` doesn't include `workspaceMemoryEntries` so CI won't trip, but the convention applies. Fix: add `eq(workspaceMemoryEntries.organisationId, orgId)` and `eq(workspaceMemoryEntries.subaccountId, subaccountId)` to both `where()` clauses.

[🔴 B-5] server/services/memoryReviewQueueService.ts:311-344
When `runCanonicalPromotion` returns `applied === false` (race loss), the function logs a warning and still marks the queue item `approved`, returning 200. The queue item now reports approved with no underlying tier change; operator UI shows success, the entry's tier is unchanged.
Why: Spec §14.6 calls for 409 on race loss; the implementation conflates "queue resolution succeeded" with "promotion applied". Fix: when `applied === false`, throw `{ statusCode: 409, message: 'Entry tier changed since proposal; queue item left pending for re-evaluation', errorCode: 'invalid_state_transition' }` to roll the tx back; the next cron sweep re-evaluates.

[🔴 B-6] server/services/memoryReviewQueueService.ts:334-341
The `UPDATE memory_review_queue SET status = 'approved' …` filters by `id` and `status` but not `organisationId`. RLS catches it; §8.35 + §1 require the explicit org filter on state-changing UPDATEs.
Why: Same convention as the dispatcher UPDATE. Fix: add `eq(memoryReviewQueue.organisationId, orgId)` to the where clause.

[🔴 B-7] server/services/workspaceMemoryService/hybridRetrieval.ts:447
`recordAccess(r.id, organisationId ?? orgId ?? '', subaccountId)` falls back to empty string when both are absent. Empty-string-keyed entries pollute the buffer's `${orgId}:${subaccountId}` namespace and the flush UPDATE's `organisation_id = ''` predicate will fail the UUID cast at runtime.
Why: Callers that hit this path (admin tooling, config assistant — the existing zero-result early-return already guards `runId != null && organisationId != null` because LAEL needs them) shouldn't be tracked at all. Fix: `if (organisationId || orgId) { for (const r of results) recordAccess(r.id, (organisationId ?? orgId)!, subaccountId); }` — skip access tracking when no org context.

## Should-fix (deferred unless folded into B-fix builder run)

S-1: dispatcher .limit(1000) silently caps candidates. Add log + audit signal.
S-2: reinforcementBatch flushAll fires unbounded parallel transactions. Serialise.
S-3: reinforcementBatch lastFlush map grows monotonically. Sweep stale keys.
S-4: reinforcementBatch uses console.* instead of structured logger. Convert.
S-5: raw SQL FOR UPDATE in memoryReviewQueueService. Use Drizzle .for('update').
S-6: dispatcher candidate-loop has no Vitest coverage. Extract decideCandidateAction pure helper + test.
S-7: cross-subaccount validation test missing for approvePromoteToProcedural.
S-8: toRows<T> duplicated 5 places. Extract to server/lib/dbResults.ts.
S-9: shared/types RetrievalProfile drift guard. Add compile-time bridge in queryIntent.ts.

## Consider

C-1: split evaluation_errors into db_errors / unexpected_errors / cooldown_errors.
C-2: shorten dispatcher getOrgScopedDb label.
C-3: rename pruneOldestHalf to pruneOldestHalfByInsertionOrder.
C-4: add 'promote_to_procedural' to itemType cast in route.
C-5: extract PROMOTE_TO_PROCEDURAL_COOLDOWN_MS const.
C-6: migration 0372 RLS policy missing IS NOT NULL guard.
C-7: audit script todo.md routing — add repeat-run concatenation test.
