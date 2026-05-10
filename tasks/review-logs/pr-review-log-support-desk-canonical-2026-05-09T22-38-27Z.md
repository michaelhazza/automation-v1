# PR Review Log — support-desk-canonical (round 3, post dual-reviewer)

**Reviewed:** 2026-05-09T22:38:27Z
**Branch:** `claude/support-ticket-structure-xMcy8` @ `6cc2542e`
**Reviewer:** pr-reviewer (independent, read-only, post-§8.5 re-review)
**Verdict:** CHANGES_REQUESTED (2 blocking, 2 strong, 2 non-blocking)

---

## NEW Blocking findings (introduced by gaps in dual-reviewer's coverage)

**B1 — Webhook agent-reply ingest fails polymorphic-FK CHECK (P1).** `server/services/webhookAdapterService.ts:888-905`. Dual-reviewer fixed `connectorPollingService.ts` Phase D for `authorSupportAgentId`, but missed the symmetric webhook ingest path. When `ticket.reply.created` (outbound) or `ticket.note.created` lands, handler computes `authorType = 'agent'` but inserts with NULL `authorSupportAgentId`. Migration 0310 CHECK requires non-null for `agent`/`bot` direction. Every webhook-delivered agent reply will FAIL at insert; transaction aborts; back-link routine never runs; draft stuck in `needs_reconciliation`.

Fix: extract `authorExternalId` from `messageData`, look up canonical agent via `(connectorConfigId, externalId)`, pass as `authorSupportAgentId`. If missing, emit `INGEST_CONTRACT_VIOLATION` and skip insert (mirror polling Phase D behavior).

**B2 — Boot recovery runs against FORCE-RLS without org session var (P1).** `server/lib/supportDispatchBootRecovery.ts:13, 24-33, 45-55`. Imports `db` directly. `canonical_ticket_drafts` has FORCE-enabled RLS; at boot no session var is set, so the policy fails closed → SELECT returns zero rows even when stranded `dispatching` drafts exist. The R5 mitigation is silently a no-op.

Fix: use `withAdminConnection` with `reason: 'cross-tenant boot scan for stranded dispatching drafts'`, `SET LOCAL ROLE admin_role` inside the callback. Per-row UPDATE either inside the same admin tx, or re-enter `withOrgTx(draft.organisationId)`.

---

## Strong Recommendations

**S1.** `decideOutcome` matcher does not exclude messages already back-linked to another draft. `supportDraftReconciliationPure.ts:85-91`. Two cross-run drafts with identical proposed body could bind to the same canonical message. Fix: thread `sourceDraftId` into matcher input, predicate on `msg.sourceDraftId == null`.

**S2.** Post-dispatch timestamp filter assumes monotonic clock alignment. `supportDraftReconciliationPure.ts:89` — `msg.createdAtExternal.getTime() >= dispatchedAt.getTime()`. Provider timestamps may lag by seconds. An outbound message 1ms before `dispatchingStartedAt` filtered out → sync-success drafts stuck in `needs_reconciliation`. Fix: tolerance window (e.g. `dispatchedAt - 5_000`) or document the assumption.

---

## Non-Blocking

**N1.** `lastReconciliationAt` set on `surface_manual` and `retry_after_ms` but not `resolve_sent` / `resolve_failed`. Inconsistent timestamping. `supportDraftReconciliationWorker.ts:78-92`.
**N2.** Stray `§934` reference in `supportDraftDispatchService.ts:79`.

---

**Verdict:** CHANGES_REQUESTED (2 blocking, 2 strong)

Two new P1 data-layer correctness defects in the same class dual-reviewer caught but one tier deeper. Fix-loop round 2 required.
