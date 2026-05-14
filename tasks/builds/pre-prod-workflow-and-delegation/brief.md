# Pre-Production Workflow Engine + Delegation — Dev Brief

**Slug:** `pre-prod-workflow-and-delegation`
**Branch:** `pre-prod-workflow-and-delegation`
**Class:** Major (architect first — the dispatch design call is non-trivial)
**Migration range reserved:** none expected (the relevant Drizzle column already exists; reserve `0254` if a migration becomes necessary)
**Sister branches (do not edit their files):** `pre-prod-tenancy`, `pre-prod-boundary-and-brief-api`

---

## Goal

Close two correctness gaps in the workflow engine state machine and one observability gap in delegation telemetry. All three have been validated by independent reviewers (Codex iter 2 + iter 3, spec-conformance) and are blocking observability/correctness for production.

## Why

Two of the three items are silent failure modes that will not surface in smoke tests:

1. **A review-gated `invoke_automation` step approves successfully but the webhook never fires.** Operator approves; system reports "completed"; no external side-effect. Discoverable only by checking the receiving system.
2. **Concurrent edits during a run can lose data.** A late-completing internal dispatch overwrites a step that was invalidated mid-flight; the rerun's successful result is downgraded to `completed_with_errors` silently.
3. **`agent_runs.handoff_source_run_id` is never written.** The delegation graph cannot render handoff edges; spec invariant INV-1.4 is structurally broken; operator debugging of handoff chains relies on `parentRunId` which conflates spawn and handoff.

## Scope (in)

### Phase 1 — Architect pass on review-gated dispatch design (mandatory before coding)

**Codex iter 2 #4** — Review-gated `invoke_automation` steps never dispatch after approval.

- File map: `server/services/workflowEngineService.ts:1547` routes through `WorkflowStepReviewService.requireApproval`. `server/services/workflowRunService.ts decideApproval` calls `completeStepRun` with `stepRun.outputJson ?? {}`. The webhook is never dispatched.
- Two viable shapes (architect to confirm):
  - **(a) Dedicated post-approval resume path** — re-enter `invokeAutomationStep()` and dispatch the webhook on approval.
  - **(b) Step-type-aware approval handling** — `decideApproval` dispatches the approved step rather than completing it. Uniform across `action_call`, `agent_call`, `prompt`, `invoke_automation` (all gated by review).
- Recommendation in deferred entry: (b). Confirm at architect time.
- Audit-trail decision: should approval create a new `flow_step_run` row, or mutate the existing one? Architect to call.

### Phase 2 — Step-type-aware decideApproval dispatch

Implement the architected shape from Phase 1. Files: `workflowEngineService.ts`, `workflowRunService.ts`, `invokeAutomationStepService.ts`. Touch only what's required for the dispatch contract — do not refactor adjacent step types unless the architect's design demands it.

Add: targeted integration test asserting `receiver.callCount === 1` AND DB-side single-`flow_step_run`-per-approval (mirror the pattern in `workflowEngineApprovalResumeDispatch.integration.test.ts`).

### Phase 3 — Inline-dispatch invalidation re-check

**Codex iter 3 #7** — Inline-dispatch step handlers (`action_call`, `agent_call`, `prompt`, `invoke_automation`) do not re-check `status === 'invalidated'` after awaiting external I/O. Public `completeStepRun` / `completeStepRunFromReview` already do; the `*Internal` helpers do not.

Approach: wrap every `*Internal` call that follows an `await` on external I/O with a re-read + invalidation-check guard. Or route all callers through the public entries.

Add: targeted test for the invalidation race — start a step, simulate a mid-run edit that flips status to `invalidated`, complete the awaited dispatch, assert the late completion is discarded.

### Phase 4 — Delegation handoff pointer (WB-1)

`agent_runs.handoff_source_run_id` is never written. Column already exists in Drizzle (`server/db/schema/agentRuns.ts:211`).

Files:
- `shared/types/agentExecution.ts` (or wherever `AgentRunRequest` is defined) — add `handoffSourceRunId?: string`.
- `server/services/agentExecutionService.ts` (~lines 395–412) — propagate into the `agent_runs` INSERT in `executeRun`.
- `server/services/agentScheduleService.ts:127` — extend the `agent-handoff-run` worker payload; current code routes `sourceRunId → parentRunId` only.
- `server/services/agentRunHandoffService.ts` — pass through.

Architectural decision (architect to confirm): does `parentRunId` ALSO get set on handoff runs (backward-compat dual-write) or null'd?

Current chain consumers reading `parentRunId` for handoff chains:
- `server/services/agentExecutionService.ts:1226-1232` (trace-session logic)
- `server/services/agentActivityService.getRunChain`

**Recommendation:** dual-write initially (set both `parentRunId` AND `handoffSourceRunId` on handoff runs); phase out `parentRunId` for handoffs in a follow-up sprint after consumers migrate to `handoffSourceRunId`. Satisfies INV-1.4 without breaking existing chain readers.

Add: targeted test asserting handoff-created `agent_runs` rows carry `handoffSourceRunId === parentRunId`. Update / extend `delegationGraphServicePure` test if any inline pure helpers shift.

## Scope (out)

- Anything under `migrations/*.sql` for tenancy hardening — owned by `pre-prod-tenancy`.
- Server bootstrap, middleware, auth, rate-limiter, brief API, frontend — owned by `pre-prod-boundary-and-brief-api`.
- Phasing out `parentRunId` for handoffs — follow-up sprint.
- Run-debugger view / observability surface — Phase 2 of `pre-launch-hardening` per `tasks/todo.md` line 1103.
- Splitting `agent_runs` into `agent_runs_core` / `_context` / `_delegation` — flagged "not now, but soon"; `tasks/todo.md` line 358.

## Acceptance criteria

- Approving an `invoke_automation` step that was review-gated produces exactly one webhook dispatch (HTTP-asserted via `fakeWebhookReceiver` + DB-asserted via single `flow_step_run` row in `completed` state).
- Concurrent edit invalidating a step during dispatch causes the late completion to be discarded; a targeted test asserts this.
- Every handoff-created `agent_runs` row carries `handoffSourceRunId === parent runId`. `parentRunId` dual-write preserved.
- Delegation graph endpoint renders handoff edges in addition to spawn edges (asserted via response shape).
- `npx tsc --noEmit -p server/tsconfig.json` clean.
- Targeted integration tests for both new dispatch paths green.

## References

- Source backlog: `tasks/todo.md` lines 692–694 (Codex iter 2 #4 + iter 3 #7), lines 664 (WB-1).
- Dual-review log: `tasks/review-logs/dual-review-log-riley-observations-2026-04-24T08-00-00Z.md`.
- Spec-conformance log: `tasks/review-logs/spec-conformance-log-paperclip-hierarchy-2026-04-23T23-05-56Z.md`.
- Hierarchical delegation spec: `docs/hierarchical-delegation-dev-spec.md` §5.3 + §7.2 + §10.6 (INV-1.4).
- Approval-resume integration harness pattern: `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`.
- Delegation graph consumer: `server/services/delegationGraphServicePure.ts:72`.

## Pipeline

1. Author full dev spec from this brief — Phase 1 design call should land in the spec, not as a verbal architect output.
2. `architect` agent — **mandatory before any code**. Architect resolves:
   - (a) vs (b) for review-gated dispatch.
   - new `flow_step_run` row vs mutate-existing for approval audit trail.
   - `parentRunId` dual-write vs null for handoff runs.
3. Implement chunked.
4. `spec-conformance` against the spec (and against `docs/hierarchical-delegation-dev-spec.md` for the WB-1 piece).
5. `pr-reviewer`.
