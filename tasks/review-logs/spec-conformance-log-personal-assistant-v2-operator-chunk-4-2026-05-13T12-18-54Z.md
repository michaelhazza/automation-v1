# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Spec commit at check:** `fa3b17c3` (last spec mutation; plan locked at this commit)
**Branch:** `claude/personal-assistant-post-merge-audit`
**Base:** `72f2849316a1bfe56325471579c85d9afddca062` (merge-base with `main`)
**HEAD at check:** `40f26022` (`feat(pa-v2-chunk4-fix): wire new event types into payload validator + discriminated union`)
**Commit at finish:** `dcd2a18a` (this log)
**Scope:** Chunk 4 — Approval-owner routing + stall job + timeout-policy decision tree (per `tasks/builds/personal-assistant-v2-operator/plan.md` §Chunk 4)
**Spec sections in scope:** §4.3 (`actionService`, `workflowGateStallNotifyJob` rows), §4.6 (event-type registry rows for `cross_owner_substep.*` + `file.*`), §5.5 (`APPROVAL_ROW_V2`), §5.6 (`CROSS_OWNER_APPROVAL_TIMEOUT_POLICY`), §9.1 (idempotency rows for cross-owner action + stall job), §9.4 (terminal-event uniqueness predicate), §9.7 (cross-owner sub-step state machine)
**Changed-code set:** 9 files (8 named in invocation + the new pure test file)
**Run at:** 2026-05-13T12:18:54Z

---

## Summary

- Requirements extracted:     21
- PASS:                       21
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT — no gaps, proceed to `pr-reviewer`.

---

## Requirements extracted (full checklist)

| REQ | Category | Spec section | Requirement | Verdict |
|-----|----------|--------------|-------------|---------|
| #1 | export | §5.5 default rule | `actionServicePure.ts` exports `deriveApproverUserId({isCrossOwner, executorOwnerUserId})` returning executor owner id when cross-owner, null otherwise | PASS |
| #2 | export | §5.5 read paths | `actionServicePure.ts` exports `buildApproverReadPredicateDescription(userId)` | PASS |
| #3 | export | §5.6 + plan §Chunk 4 | `actionServicePure.ts` exports `TimeoutPolicyDecision` discriminated union type | PASS |
| #4 | export | §5.6 stall job behaviour | `actionServicePure.ts` exports `decideTimeoutPolicyAction(policy)` with correct event status + reason for each policy | PASS |
| #5 | schema | §4.1 migration 0346 / §5.5 | `actions.approver_user_id` column exists in Drizzle schema | PASS |
| #6 | behaviour | §5.5 | `ProposeActionInput.approverUserId?: string` field; `proposeAction` INSERT writes `approver_user_id` from input | PASS |
| #7 | behaviour | §5.5 read paths | `listPendingApprovalsForUser(userId, organisationId, subaccountId)` two-arm read: Arm 1 explicit `approver_user_id=userId`; Arm 2 `approver_user_id IS NULL` + V1 initiator predicate | PASS |
| #7a | validation | DG §1 + plan §Chunk 4 | `listPendingApprovalsForUser` filters by `organisationId` on both arms | PASS |
| #8 | behaviour | §5.6 stall job + §9.4 | `crossOwnerApprovalTimeoutSweep` fetches `delegation_outcomes` WHERE `substep_status='awaiting_cross_owner_approval' AND created_at < NOW()-24h AND terminal_at IS NULL`; joins to derive `initiatorUserId` | PASS |
| #9 | behaviour | §5.6 `fail_parent` | `fail_parent` branch: UPDATE `substep_status='failed', terminal_at=NOW()` WHERE `terminal_at IS NULL`; emit `cross_owner_substep.completed {status:'failed', reason:'cross_owner_approval_timeout'}` | PASS |
| #10 | behaviour | §5.6 `continue_without_substep` | `continue_without_substep` branch: UPDATE `substep_status='partial', terminal_at=NOW()`; emit `cross_owner_substep.completed {status:'partial', reason:'cross_owner_approval_timed_out_optional'}` | PASS |
| #11 | behaviour | §5.6 `ask_initiator` | `ask_initiator` branch: leave open (no terminal); emit `cross_owner_substep.awaiting_initiator_decision`; call `proposeAction({approverUserId: initiatorUserId})` for the typed decision request | PASS |
| #12 | behaviour | §9.4 + DG §8.33 | 0-rows-updated → no event emitted (suppression-is-success); all three branches gate event emission on `updated.length > 0` | PASS |
| #13 | contract | §4.6 | `AgentExecutionEventType` union extended with `cross_owner_substep.awaiting_initiator_decision` and `cross_owner_substep.completed` | PASS |
| #14 | contract | §4.6 payload shapes | `AgentExecutionEventPayload` discriminated union has flat inline object members for the four new types (file.created, file.modified, cross_owner_substep.*); intersection-typed members removed per Chunk 4 fix commit | PASS |
| #15 | contract | §4.6 criticality table | `AGENT_EXECUTION_EVENT_CRITICALITY` entries: `file.created:false`, `file.modified:false`, `cross_owner_substep.awaiting_initiator_decision:true`, `cross_owner_substep.completed:true` | PASS |
| #16 | contract | §4.3 stall job row | `AgentExecutionSourceService` union includes `'workflowGateStallNotifyJob'` | PASS |
| #17 | validation | §4.6 + DG §8.18 closure | `validateEventPayload` switch has cases for all four new event types with field-shape checks; exhaustiveness `_unused: never` default branch preserved | PASS |
| #18 | contract | runtime allowlist | `SOURCE_SERVICES` array in pure service includes `'workflowGateStallNotifyJob'` | PASS |
| #19 | test | plan §Chunk 4 acceptance | `actionServicePure.crossOwnerApprover.test.ts` covers `deriveApproverUserId` (4 cases), `decideTimeoutPolicyAction` (3 cases), and the idempotency-key invariant (1 case) — 8 tests total | PASS |
| #20 | test | §4.6 | `agentExecutionEventServicePure.test.ts` updated `expectedCritical` set to include the two cross_owner_substep critical types | PASS |
| #21 | invariant | plan §Chunk 4 acceptance + §9.1 row 5 | `proposeAction` idempotency-key invariant — `buildActionIdempotencyKey({runId, toolCallId, args})` signature unchanged; `approverUserId` not part of the key; pure test asserts identical keys regardless of approver context | PASS |

---

## Mechanical fixes applied

None — every requirement passed on the first read.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None.

---

## Files modified by this run

None (read-only verification — all REQs passed without any edits).

---

## Notes on auxiliary checks (informational only — not part of the conformance verdict)

- `npm run lint` → 0 errors, 893 pre-existing warnings (unrelated to Chunk 4 files).
- `npm run typecheck` → fails on two pre-existing `@react-pdf/renderer` import errors in `server/services/reportRenderingService.ts` and `server/services/reportTemplates/MacroReport.tsx`. These files are out of Chunk 4 scope and the errors predate this chunk; the missing dev-dependency is a separate concern.
- Targeted pure tests (`actionServicePure.crossOwnerApprover.test.ts`, `workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts`) — 11 of 11 passing.
- `agentExecutionEventServicePure.test.ts` — 29 of 29 passing.

---

## Implementation observations (out-of-band, informational only — NOT conformance gaps)

These are observations a code reviewer (not a spec-conformance checker) might flag. They are surfaced here per CLAUDE.md §6 "Surface, don't smuggle" so they aren't lost, but they are NOT conformance gaps — every spec-named requirement is satisfied. Routing them to `pr-reviewer` for judgement.

1. **`ask_initiator` redundant UPDATE.** The `ask_initiator` branch issues an UPDATE setting `substep_status='awaiting_cross_owner_approval'` (the same value it already has) with predicate `terminal_at IS NULL`. The intent is clearly to use the same row-level write-time predicate as the other two branches for atomic "still open" confirmation before emitting the awaiting-decision event. It is correct behaviour but might read as a no-op UPDATE to a reviewer who hasn't read the spec. A short inline comment explaining the predicate-gate purpose would help — but the existing comment on line 229-230 covers it adequately.

2. **`proposeAction` idempotency key for the `ask_initiator` typed decision request.** The stall job uses `idempotencyKey = `cross_owner_ask_initiator:${row.id}:${cutoff.toISOString()}`` (workflowGateStallNotifyJob.ts:267). The `cutoff` value changes every run (it's `NOW() - 24h`), so re-running the sweep would produce a different key for the same row, potentially proposing duplicate actions. Mitigating factor: the spec §9.1 row 7 says the timeout job is idempotent on the `substep_status='awaiting_cross_owner_approval'` predicate, and the `ask_initiator` branch's UPDATE+returning predicate (`terminal_at IS NULL`) guards against re-running for already-resolved rows. So in practice the second sweep against the same row would still match (substep remains in awaiting state until the initiator decides), and the idempotency key would differ — meaning a second `actionService.proposeAction` call could create a second pending-approval row. The spec does not explicitly mandate that the proposed decision request must dedupe across multiple sweeps. Mentioning here so a reviewer can confirm whether a stable key (e.g. `cross_owner_ask_initiator:${row.id}`) is preferable. Conservative choice would be to drop the timestamp from the key.

3. **`actionService.proposeAction(...)` call from the stall job passes `agentId: null`.** This is permitted (per the `actions.agent_id` nullable migration noted in the doc-comment), but a reviewer may want to confirm the policy engine handles the null path correctly for the synthetic `cross_owner.ask_initiator_decision` action type. Spec does not name this action type or its policy resolution — it's an implementation choice within the spec's bounds (spec §5.6 says "creates an approval row via `actionService.proposeAction(..., { approver_user_id: initiator_user_id })`" — doesn't name a specific actionType slug).

These three items are NOT spec-conformance gaps. They are reviewer-facing observations preserved here for traceability per CLAUDE.md §6.

---

## Next step

**CONFORMANT** — no gaps, proceed to `pr-reviewer` on the Chunk 4 changed-code set (the 8 files listed in the invocation + the new `workflowGateStallNotifyJobPure.timeoutPolicyDecisionTree.test.ts` pure test file).
