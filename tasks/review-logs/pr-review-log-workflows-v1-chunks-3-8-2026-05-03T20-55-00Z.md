# PR Review Log — workflows-v1 Chunks 3-8 Implementation

**Branch:** `claude/workflows-brainstorm-LSdMm`
**Build slug:** `workflows-v1`
**Commits reviewed:** `b71dfb16` (Chunks 3-8 implementation) + `04fafa27` (stall-notify handler)
**Reviewed:** 2026-05-03T20:55:00Z
**Reviewer:** pr-reviewer (independent, read-only)

**Verdict:** CHANGES_REQUESTED (1 blocking, 5 strong, 4 non-blocking)

## Files reviewed

- `server/services/workflowStepGateService.ts`, `workflowStepGateServicePure.ts`
- `server/services/workflowStepReviewService.ts`
- `server/services/workflowApproverPoolService.ts`, `workflowApproverPoolServicePure.ts`
- `server/services/workflowApprovalPoolPure.ts`
- `server/services/workflowGateRefreshPoolService.ts`
- `server/services/workflowConfidenceService.ts`, `workflowConfidenceServicePure.ts`, `workflowConfidenceCopyMap.ts`
- `server/services/workflowSeenPayloadServicePure.ts`
- `server/services/workflowRunPauseStopService.ts`, `workflowRunPauseStopServicePure.ts`
- `server/services/workflowRunCostLedgerService.ts`
- `server/services/workflowGateStallNotifyService.ts`, `workflowGateStallNotifyServicePure.ts`
- `server/services/workflowScheduleDispatchService.ts`
- `server/services/agentExecutionEventTaskSequencePure.ts`, `agentExecutionEventService.ts`
- `server/services/workflowEngineService.ts` (extensions only)
- `server/services/workflowRunService.ts` (extensions only)
- `server/jobs/workflowGateStallNotifyJob.ts`
- `server/routes/workflowRuns.ts`, `workflowGates.ts`
- `server/db/schema/workflowStepGates.ts`, `workflowRuns.ts`, `agentExecutionEvents.ts`, `tasks.ts`
- `shared/types/workflowStepGate.ts`, `workflowApproverGroup.ts`, `agentExecutionLog.ts`
- `shared/stateMachineGuards.ts` and its test file
- `migrations/0270_workflows_v1_additive_schema.sql`

## Blocking

### B1. `requireApproval` opens gates with NULL `seen_payload` and `seen_confidence` (spec §6.3 violation)

**File:** `server/services/workflowStepReviewService.ts` lines 86-101.

`requireApproval` calls `openGate(...)` with only `{ workflowRunId, stepId, gateKind, isCriticalSynthesised, organisationId, requesterUserId }` — no `stepDefinition`, no `templateVersionId`, no `subaccountId`. Inside `openGate` (`workflowStepGateService.ts` lines 108-166), `seenPayload`/`seenConfidence` computation is gated on `if (input.stepDefinition)`. Result: every gate opened via supervised mode and isCritical synthesis has `seen_payload IS NULL` and `seen_confidence IS NULL`.

**Spec §6.3:** "Insert workflow_step_gates row at gate-open with `seen_payload`, `seen_confidence`, `approver_pool_snapshot`, `is_critical_synthesised`. This snapshot is **immutable** … the audit trail must reflect what the human authorised, not what later ran."

**Fix.** Forward `stepDefinition`, `templateVersionId`, `subaccountId` through `requireApproval` (already in the engine's call-site scope at `workflowEngineService.ts:1141-1183`) into `openGate`.

## Strong

### S1. Two `userInPool` functions with opposite semantics on null/empty pool

**Files:** `workflowApprovalPoolPure.ts` (returns `true` on null/empty — open allow) vs `workflowApproverPoolServicePure.ts` (returns `false` on null/empty — closed deny).

`workflowApprovalPoolPure` is now dead code in production — only its own test file references it. Filename differs by one letter from the new strict-closed version.

**Fix.** Delete `workflowApprovalPoolPure.ts` and its test file (or rename for unambiguous distinction).

### S2. Manual try/catch in `POST /api/workflow-runs/:runId/resume` route

**File:** `server/routes/workflowRuns.ts` lines 297-315.

Inner `try { … } catch (err) { … res.status(400).json(…); return; }` re-shapes the error from `asyncHandler`'s canonical `{ error: { code, message }, correlationId }` into `{ error: 'extension_required', reason, cap }`. Violates "no manual try/catch in routes".

**Fix.** Use `FORWARDED_ERROR_FIELDS` in `asyncHandler.ts` to forward `cap` and `reason`; let the thrown error flow through.

### S3. `resolveGate` writes terminal gate state without `assertValidTransition` (§8.18)

**File:** `server/services/workflowStepGateService.ts` lines 229-272.

The new `workflow_step_gate` machine in `stateMachineGuards.ts` is dead-code today — adoption here makes it live. The CAS predicate enforces correctness, but observability requires either the assertion or a `guarded: false` log line.

**Fix.** Call `assertValidTransition({ kind: 'workflow_step_gate', from: 'open', to: 'resolved' })` before each UPDATE. Same in `resolveOpenGatesForRun`.

### S4. `workflow_step_gate` machine and `paused` state lack tests

**File:** `shared/__tests__/stateMachineGuardsPure.test.ts`.

New code in `stateMachineGuards.ts` lines 41-53, 74-75, 90-91 is currently untested.

**Add tests:**

> Given `assertValidTransition({ kind: 'workflow_step_gate', from: 'open', to: 'resolved' })`,
> When the function is called,
> Then it returns void without throwing.

> Given `assertValidTransition({ kind: 'workflow_step_gate', from: 'resolved', to: 'open' })`,
> When the function is called,
> Then it throws `InvalidTransitionError`.

> Given `assertValidTransition({ kind: 'workflow_run', from: 'running', to: 'paused' })`,
> When the function is called,
> Then it returns void.

> Given `assertValidTransition({ kind: 'workflow_run', from: 'paused', to: 'running' })`,
> When the function is called,
> Then it returns void.

### S5. `sendGateStallNotification` queries `users` without `organisationId` filter (§9 checklist)

**File:** `server/services/workflowGateStallNotifyService.ts` lines 138-142.

RLS handles cross-tenant safety, but per `DEVELOPMENT_GUIDELINES.md §1`, always filter by `organisationId` in application code. `params.organisationId` is already in scope.

**Fix.** Add `eq(users.organisationId, params.organisationId)` to WHERE.

## Non-blocking

- **N1.** `taskId` URL param on refresh-pool route is cosmetic-only (V2 will validate). Document V2 plan in tasks/todo.md.
- **N2.** `pauseRun` skips `assertValidTransition` with explanatory comment — paused is non-terminal so §8.18 doesn't strictly apply. Consistency-only.
- **N3.** Cost-ledger and engine cap-check queries lack explicit `organisationId` filter. Pre-existing engine pattern; address in future convention sweep.
- **N4.** `refreshPool` reads `workflowTemplateVersions` without joining to `workflowTemplates` for soft-delete. Likely intentional for in-flight gates; add a one-line comment.

## Lint / typecheck

Author must run `npm run lint && npm run typecheck` before marking done. CI runs the full suite as a pre-merge gate.
