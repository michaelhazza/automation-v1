# PR Re-review Log: memory-tiered-consolidation (round 2)

**Reviewed:** 2026-05-18T07:15:00Z
**Branch:** memory-tiered-consolidation
**Reviewer:** pr-reviewer (read-only, independent)
**Scope:** Verification-only pass over the 7 Blocking findings from round 1.

Blocking: 0 / Should-fix: 0 / Consider: 0
**Verdict:** APPROVED

## Verification of round-1 Blocking findings

[ok] B-1 server/jobs/memoryConsolidationPromotionJob.ts:37-50 — Tenant enumeration now runs inside `withAdminConnection({source, reason}, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. The per-tenant `withOrgTx` loop is preserved below. Mirrors the `memoryDecayJob.ts` pattern exactly; RLS no longer fails closed on the cross-org enumeration.

[ok] B-2 scripts/audit/audit-memory-consolidation.ts:553-580 — Checks 1, 2, 4, 5 each now run inside `db.transaction(async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); return runCheckN(tx, ...); })`, matching Check 6's pattern. All cross-tenant aggregate reads are elevated; audit can no longer ship green-by-construction.

[ok] B-3 server/services/memoryReviewQueueService.ts:271-345, server/routes/memoryReviewQueue.ts:52-79 — Service signature is `(queueItemId, approverUserId, orgId)` — no `subaccountId` parameter. SELECT FOR UPDATE returns `subaccount_id` from the locked row; `runCanonicalPromotion` receives `row.subaccount_id`. Route destructures `{ acceptSide, itemType }` only — no body-supplied `subaccountId`. Cross-subaccount audit-row corruption vector is closed.

[ok] B-4 server/services/memoryConsolidationPromotionDispatcher.ts:185-200, 302-316 — Both UPDATEs on `workspace_memory_entries` now include `eq(workspaceMemoryEntries.organisationId, orgId)` AND `eq(workspaceMemoryEntries.subaccountId, subaccountId)` alongside the id + tier guards. Defence-in-depth restored.

[ok] B-5 server/services/memoryReviewQueueService.ts:324-326 — When `runCanonicalPromotion` returns `applied === false`, throws `{ statusCode: 409, message: 'Entry tier changed since proposal; queue item left pending for re-evaluation', errorCode: 'invalid_state_transition' }`. Throw is inside `tx`, so the transaction rolls back — queue item stays pending. 409 contract from spec §14.6 honoured.

[ok] B-6 server/services/memoryReviewQueueService.ts:336-342 — UPDATE filter is `and(eq(memoryReviewQueue.id, queueItemId), eq(memoryReviewQueue.organisationId, orgId), eq(memoryReviewQueue.status, 'pending'))`. Explicit org filter restored.

[ok] B-7 server/services/workspaceMemoryService/hybridRetrieval.ts:446-450 — `if (organisationId || orgId) { for (const r of results) recordAccess(r.id, (organisationId ?? orgId)!, subaccountId); }`. Empty-string fallback eliminated; UUID-cast failure on flush is avoided.

## Round-1 carry-over checks

- spec-conformance (commit 1d4bbe62): `PromotionVerdict.reason` union at `shared/types/memoryConsolidation.ts:30-35` carries all five values (`below_threshold`, `already_top_tier`, `cooldown_active`, `invalid_source_tier`, `invalid_transition`); `MemoryConsolidationAuditResult` at line 62-67 carries `schemaVersion: 1`, `warmupDays`, `flagState: 'on' | 'off' | 'unknown'`. Audit script populates all three. Intact.
- adversarial-reviewer (commit c9914bfa): the round-1 transaction wrap composes cleanly with the new B-3/B-4/B-5/B-6 fixes — SELECT FOR UPDATE, the canonical promotion UPDATE + INSERT, and the queue UPDATE all share one `tx`. The 409 throw at line 325 is inside the same `tx`, so rollback unwinds any partial work. No regression introduced.

## Files NOT read

Only the files touched by the 7 B-fixes were re-read on this pass. No should-fix or consider items were re-evaluated (per caller instruction). Unread files cannot invalidate the verdict because the scope was explicitly "verify the 7 B-fixes are closed".

Blocking: 0 / Should-fix: 0 / Consider: 0
**Verdict:** APPROVED (all 7 round-1 blocking findings closed; prior spec-conformance and adversarial fixes intact)
