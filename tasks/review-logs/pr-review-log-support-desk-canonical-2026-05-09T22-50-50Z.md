# PR Review Log — support-desk-canonical (round 4, post fix-loop round 2)

**Reviewed:** 2026-05-09T22:50:50Z
**Branch:** `claude/support-ticket-structure-xMcy8` @ `85c54a16` (post fix-loop round 2 commit `ec581e11`)
**Reviewer:** pr-reviewer (independent, read-only, fix-loop round 2 verification)
**Verdict:** APPROVED (0 blocking, 3 strong carry-over, 3 non-blocking)

---

## Round-3 Blocker Verification — both CLOSED

**B1 — Webhook agent-reply ingest polymorphic-FK fix.** ✅ Closed.
`server/services/webhookAdapterService.ts:888-926`. Symmetric author-FK resolution inside `withOrgTx` callback. For `authorType !== 'customer'`:
- Defensive extraction of `messageData.author.id` (line 892-893: `authorObj?.id ? String(authorObj.id) : null`).
- Missing external id → `INGEST_CONTRACT_VIOLATION` with `reason: 'missing_author_external_id'`, safe early-return.
- Unknown agent → `INGEST_CONTRACT_VIOLATION` with `reason: 'unknown_agent_external_id'`, safe early-return.
- Lookup pattern `(connectorConfigId, externalId)` matches polling Phase D at `connectorPollingService.ts:767`.

**B2 — Boot recovery RLS-aware admin tx.** ✅ Closed.
`server/lib/supportDispatchBootRecovery.ts:13-84`. Routed through `withAdminConnectionGuarded`:
- `allowRlsBypass: true` with inline justification (satisfies `verify-rls-protected-tables.sh` check 3).
- `SET LOCAL ROLE admin_role` is the first `tx.execute(...)` call.
- SELECT and per-row UPDATE both through the same boundary-wrapped `tx`.
- First-write-wins via `WHERE id = $1 AND status = 'dispatching'`.
- `boss.send` enqueue only when `result.length > 0`.

**B2 follow-up — no `withOrgTx` per row.** Acceptable. `withOrgTx` is `AsyncLocalStorage`-based; the loop body uses direct `tx.update` (no service helpers requiring `getOrgTxContext`), so the absence is harmless.

## NEW Findings This Round

None blocking.

## Strong Recommendations (carry-over from round 3)

**S1.** `decideOutcome` matcher does not exclude messages already back-linked. `supportDraftReconciliationPure.ts:85-91`. Two cross-run drafts with identical body could bind the same canonical message. Fix: thread `sourceDraftId` into matcher, predicate `msg.sourceDraftId == null`.

**S2.** Post-dispatch timestamp filter assumes monotonic clock alignment. `supportDraftReconciliationPure.ts:89`. Fix: tolerance window or document.

**S3 (new).** No targeted unit tests for B1 or B2 fix. Suggested:
- `webhookAdapterService.authorResolution.test.ts` — missing/unknown author external id paths emit `INGEST_CONTRACT_VIOLATION` and skip insert without throwing.
- `supportDispatchBootRecovery.test.ts` — two stranded drafts in two orgs both transition + enqueue inside a single `withAdminConnectionGuarded` invocation.

## Non-Blocking

**N1 (carry-over).** `lastReconciliationAt` inconsistent timestamping (worker:78-92).
**N2 (carry-over).** Stray `§934` reference in `supportDraftDispatchService.ts:79`.
**N3 (new).** Boot recovery enqueue inside admin tx — failed `boss.send` correctly rolls back the status flip; document in a brief comment.

---

**Verdict:** APPROVED

Round 2 fixes resolve both P1 blockers correctly. B1 mirrors the polling Phase D pattern with safe null handling. B2 routes the cross-tenant boot scan through the boundary-guarded admin tx. Strong S1 / S2 carry over from round 3 (not regressions); S3 flags missing test coverage as a follow-up. Round cap honoured: round 2 of 3.
