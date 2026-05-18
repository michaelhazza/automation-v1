# Spec Review Log — oss-pattern-lifts-bundle — Iteration 4

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Iteration:** 4 / 5
**Codex raw output:** `tasks/review-logs/_codex_oss-pattern-lifts-bundle_iter4_2026-05-18T12-41-08Z.txt`

## Major structural finding (F1 + F2 + F4 collapse)

Codex F1, F2, F4 collectively reveal a structural mismatch: the spec assumes the approval-resume path is queue-driven via `workflow-resume`, but in reality the `workflow-resume` queue is the LEGACY `flowRuns` path (handled via `resumeFlow` in `enqueueHelpers.ts`). The current workflow-engine HITL approval resume happens INLINE inside `reviewService.approveItem()` via `resumeActionCallAfterApproval`. The two are different code paths — `workflow-resume` queue is not the approval-resume mechanism for the workflow-engine path.

Three options to resolve:

- **Path A** — defer approval call-site migration to V2; ship V1 with OAuth-only migration.
- **Path B** — keep approval CREATE in dispatch.ts; move approval COMPLETE inside `reviewService.approveItem()` (inside its existing tx); `completeWaitpoint` does NOT enqueue a resume job for `kind: 'approval'` (the inline `resumeActionCallAfterApproval` already owns resume); the waitpoint is purely a token + expiry + idempotency layer.
- **Path C** — add a new pg-boss queue + handler that wraps `resumeActionCallAfterApproval` to make the approval resume async like OAuth.

**Decision:** Path B. Per Step 7 framing assumption "prefer existing primitives over new ones". Path C adds a new abstraction duplicating the existing inline primitive. Path A drops scope from the brief. Path B is the smallest change that keeps the brief's intent (migrate both call sites) while pointing at the existing approval resume primitive.

**Routing to tasks/todo.md:** The directional decision (Path B over Path C, no new pg-boss queue for approval resume) is logged as a deferred item — the human may decide to switch to Path C later if async approval resume becomes desirable.

## Findings (all mechanical after Path B decision)

**F1 §7.3 + §8.4 — workflow-resume queue is the wrong target for approval.** Mechanical (after Path B decision): change approval COMPLETE to invoke `completeWaitpoint` inside `reviewService.approveItem()`'s existing transaction; `completeWaitpoint` for `kind='approval'` does NOT pass `resumeQueue` to sendWithTx. The optional `resumeQueue` parameter on `createWaitpoint` becomes oauth-only (or any future kind that genuinely wants async resume). §7.3 / §8.4 / §5.2 rewritten accordingly.

**F2 §7.3 complete side — wrong file.** Mechanical: approval COMPLETE moves from `reviewItems.ts` to `reviewService.approveItem()` (in `server/services/reviewService.ts`).

**F3 §5.3 approval expiry doesn't match engine failure helper.** Mechanical. `failStepRunInternal` in `server/services/workflowEngine/stepLifecycle.ts` sets `status='failed', error=reason, completed_at=now(), version=sr.version+1, updated_at=now()`, then enqueues `enqueueTick(sr.runId)`. The expireWaitpoints approval branch must match this column set exactly AND enqueue a workflow tick. Done inline under admin role (with org predicates) since `failStepRunInternal` itself uses `getOrgScopedDb` and can't be called from the admin sweep.

**F4 §5.2/§15.1 — approval singleton claim removed under Path B.** Mechanical: approval has no enqueue, so no singleton concern. §5.2 / §15.1 / §15.2 cleaned up.

**F5 §4.1/§5.1/§7.3 — §4.1 still says bound_run_id required for all V1 use cases.** Mechanical residue from iter 3 (§3 was updated; §4.1 column note wasn't). Fix: update the §4.1 table row note to "Required for `oauth`; nullable for `approval`, `external_event`, and future system-level waits."

**F6 §13/§16 — validateCreateWaitpointParams description still says approval requires boundRunId.** Mechanical residue from iter 3. Fix: update §13 pure module description and §16 test description to "rejects oauth missing boundRunId; rejects approval missing approvedActionId or workflowStepRunId in resumePayload".

## Reclassified findings

F1, F2, F4 contain a directional kernel (Path B choice). That kernel is AUTO-DECIDED per Step 7 priority 3 (prefer existing primitives, prefer simplicity). The mechanical execution of the decision is applied; the directional choice is routed to `tasks/todo.md`.

## Counts

- Codex findings: 6
- Rubric findings: 0
- Mechanical accepted: 6 (after Path B reframing)
- Mechanical rejected: 0
- Directional resolved: 1 (the Path B choice; AUTO-DECIDED, logged to tasks/todo.md)
- AUTO-DECIDED: 1
- Reclassified → directional: 0 (decision was applied mechanically once made)
