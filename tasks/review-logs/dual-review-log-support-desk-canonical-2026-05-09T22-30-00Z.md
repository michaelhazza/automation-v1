# Dual Review Log — support-desk-canonical

**Files reviewed:** branch `claude/support-ticket-structure-xMcy8` vs `main` (53 commits, ~170 code files; Codex prompt focused on the support-desk-canonical Phase 2 surface)
**Iterations run:** 3/3
**Timestamp:** 2026-05-09T22:30:00Z
**Caller:** feature-coordinator Phase 2 §8.5
**Branch HEAD at start:** `ca84a4c0`
**Commit at finish:** `c9bdec5c`

---

## Iteration 1

Codex output: `tasks/review-logs/_codex_dual_iter1_support-desk-canonical_2026-05-09T22-05-29Z.txt`

Findings raised: 4 (2 P1, 2 P2). All accepted — every one is a real correctness defect against either a DB CHECK constraint, the spec state machine, or the worker contract.

[ACCEPT] P1 server/services/supportDraftDispatchService.ts:445 — `sentMessageId` is set to `replyId` (Teamwork numeric provider id, e.g. `"12345"`) but the column is a UUID FK to `canonical_ticket_messages.id` and the `sent => sent_message_id IS NOT NULL` CHECK constraint requires a real UUID. Verified by reading migration 0311 (FK + CHECK) and `teamworkAdapter.addReply` (returns `String(thread.id)`). The webhook back-link routine in `webhookAdapterService.ts` correctly uses `canonicalTicketMessages.id` — that pattern is canonical.
  Reason: real bug; would fail at runtime for every successful reply send. Fix: park the draft in `needs_reconciliation`, record `providerResponseId` in the action_attempts ledger (already done), and let the back-link / reconciliation worker resolve `needs_reconciliation → sent` once the canonical message lands.

[ACCEPT] P1 server/services/connectorPollingService.ts:767 — Phase D inserts agent/bot messages without `authorSupportAgentId`, but migration 0310's polymorphic-FK CHECK requires `author_type IN ('agent','bot') AND author_contact_id IS NULL AND author_support_agent_id IS NOT NULL`. Every agent reply or internal note would abort the transaction.
  Reason: real bug; the adapter type already carries `authorExternalId`, and Phase B builds `agentExternalToId`. Fix: thread the map through Phase D, look up the canonical agent FK, skip the message with an `INGEST_CONTRACT_VIOLATION` warn if the mapping is missing.

[ACCEPT] P2 server/services/supportDraftDispatchService.ts:124 — `proposeReply` always inserts with `status: 'draft'`, but the review queue lists only `awaiting_review`/`needs_reconciliation`/stale `dispatching`. In assisted-mode inboxes the proposed reply never appears for human approval. Spec §934 makes it explicit: `draft` is the autonomous-mode pre-state, `awaiting_review` is the assisted-mode pre-state.
  Reason: real bug for assisted mode (the default per `docs/superpowers/specs/2026-05-09-support-desk-canonical-spec.md`). Fix: load `canonicalInboxes.agentConfig` in `proposeReply`, derive initial status from `mode` (autonomous → `draft`, otherwise → `awaiting_review`).

[ACCEPT] P2 server/services/supportDraftDispatchService.ts:615 — `manualResolveDraft('retry_reconciliation')` transitions to `dispatching` and enqueues the reconciliation worker, but the worker hard-checks `draft.status === 'needs_reconciliation'` and exits otherwise. Spec §1014 says "resets the reconciliation budget and re-enqueues the draft for the §8.4 worker" — the right state is `needs_reconciliation`.
  Reason: real bug; retry leaves the draft stuck in `dispatching` until boot recovery. Fix: keep status `needs_reconciliation`, reset only `reconciliationAttemptCount`, do not touch `dispatchingStartedAt` (back-link timestamp match depends on it). Also updated the pure-helper docstring.

Side fix bundled with iter-1 P1 #1: the existing-attempt short-circuit (line 378-387) had the same bug — used the provider id as a fake UUID. Same pattern applies (transition to `needs_reconciliation`, enqueue worker).

## Iteration 2

Codex output: `tasks/review-logs/_codex_dual_iter2_support-desk-canonical_2026-05-09T22-05-29Z.txt`

Findings raised: 1 (P2). Accepted — direct cascading consequence of iter-1 fix #1.

[ACCEPT] P2 server/services/supportDraftReconciliationPure.ts (decideOutcome) — with successful dispatches now routed through `needs_reconciliation`, the existing matcher fires more often and its loose criteria become unsafe: it scans the last 20 messages without filtering by direction/visibility/timestamp and matches by substring (`bodyText.includes(proposedBody) || proposedBody.includes(msg.bodyText)`). A pre-existing customer message that quoted the agent's prior reply, or any older same-text message on the ticket, could bind the wrong `sent_message_id`.
  Reason: real bug introduced by my iter-1 fix; tightening the matcher is required to keep iter-1 fix safe. Fix: require message direction/visibility to align with draft `proposedVisibility`, require `createdAtExternal >= dispatchingStartedAt` when known, and require normalised exact body match (drop substring fallback). The substring path's prior test was relabelled to assert the new contract; added two new tests covering direction-mismatch and pre-dispatch-timestamp filters and one for the canonical post-dispatch happy path.

## Iteration 3

Codex output: `tasks/review-logs/_codex_dual_iter3_support-desk-canonical_2026-05-09T22-05-29Z.txt`

Findings raised: 1 (P2). Accepted — direct cascading consequence of iter-1 fix #1 on the webhook back-link path.

[ACCEPT] P2 server/services/webhookAdapterService.ts:921-937 + server/services/supportDraftReconciliationPure.ts (findBackLinkCandidate) — webhook back-link only considers drafts in `manually_marked_sent` or `sent` (with NULL sent_message_id). But iter-1 fix #1 parks synchronous-success drafts in `needs_reconciliation`. In webhook-first scenarios the canonical message lands first, the back-link is skipped, and resolution waits for the reconciliation worker's exponential-backoff retry (up to 1 hour).
  Reason: real bug introduced by my iter-1 fix; the back-link is the fastest path to terminal `sent` for synchronous-success dispatches. Fix: include `needs_reconciliation` in both the webhook query's `inArray` filter and `findBackLinkCandidate`'s `eligible` set. The pure-helper transition validator already permits `needs_reconciliation → sent` (line 37 of supportDraftDispatchServicePure.ts), so the `status: 'sent'` UPDATE in the webhook back-link is already valid. Updated the pre-existing test "does not match drafts with ineligible status" (which had asserted `needs_reconciliation` was ineligible) to reflect the new contract; added a new test covering the synchronous-success-park-state happy path.

---

## Changes Made

- `server/services/supportDraftDispatchService.ts` — (a) `proposeReply` loads inbox `agentConfig` and chooses initial draft status (`autonomous → 'draft'`, else `'awaiting_review'`); (b) successful provider sends + the existing-attempt short-circuit park drafts in `needs_reconciliation` and enqueue the reconciliation worker rather than fabricating a UUID for `sent_message_id`; (c) `manualResolveDraft('retry_reconciliation')` keeps status `needs_reconciliation`, resets only `reconciliationAttemptCount`, preserves `dispatchingStartedAt`.
- `server/services/connectorPollingService.ts` — Phase D resolves `authorSupportAgentId` from `agentExternalToId` for `agent`/`bot` messages; skips messages whose author cannot be resolved (with `INGEST_CONTRACT_VIOLATION` warn). Threaded `agentExternalToId` through both Phase D call sites (`runSupportIngestionCycle` and `pollSupportFullReconciliation`).
- `server/services/supportDraftReconciliationPure.ts` — (a) `decideOutcome` accepts `dispatchingStartedAt` and constrains matches to direction/visibility-aligned messages with normalised exact body match created at-or-after dispatch time (no substring); (b) `findBackLinkCandidate` adds `needs_reconciliation` to the eligible status set.
- `server/services/supportDraftDispatchServicePure.ts` — corrected the docstring for the `needs_reconciliation → dispatching` transition to reflect that `retry_reconciliation` no longer uses it (preserves status; only boot recovery still uses the transition).
- `server/services/webhookAdapterService.ts` — webhook back-link query includes `needs_reconciliation` in the eligibility set.
- `server/jobs/supportDraftReconciliationWorker.ts` — passes `dispatchingStartedAt` into `decideOutcome`.
- `server/services/__tests__/supportDraftReconciliation.test.ts` — relabelled the obsolete substring-match test to assert the new no-substring contract; added direction-mismatch, pre-dispatch-timestamp, post-dispatch happy-path, and `needs_reconciliation`-back-link tests; updated the "ineligible status" test to use `failed`/`rejected` instead of `needs_reconciliation`. All 22 tests pass.

## Rejected Recommendations

None this run. Every Codex finding across the three iterations was a real defect — two original P1s in iter 1 plus two P2s, then one cascading P2 in iter 2 (matcher) and one cascading P2 in iter 3 (back-link eligibility) directly produced by the iter-1 fix.

---

**Verdict:** APPROVED (3 iterations, 6 [ACCEPT], 0 [REJECT]; 2 P1 dispatch bugs fixed, 4 P2s — 2 spec-conformance + 2 cascading from the P1 fix — addressed)
