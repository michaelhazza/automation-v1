# Spec Conformance Log

**Spec:** `docs/workflows-dev-spec.md`
**Plan:** `tasks/builds/workflows-v1/plan.md`
**Spec commit at check:** `04fafa27`
**Branch:** `claude/workflows-brainstorm-LSdMm`
**Base:** `048eb812` (merge-base with main)
**Scope:** Chunks 3, 4, 5, 6, 7, 8 (spec §§3.1, 3.3, 5.1–5.4, 6.1–6.5, 7, 8.1, 11.4.1)
**Run at:** 2026-05-03T20:29:16Z

## Contents

- Summary
- Scope decision
- Requirements extracted
- Mechanical fixes applied
- Directional gaps routed
- Files modified by this run
- Next step

## Summary

- Requirements extracted:     38
- PASS:                       36
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (2 directional gaps — see deferred items)

## Scope decision

`tasks/builds/workflows-v1/progress.md` does not exist. Chunks-in-scope derived from commit messages: `b71dfb16` ("implement Chunks 3-8") + `04fafa27` ("add workflowGateStallNotifyJob handler"). Chunks 1, 2 verified by prior pr-reviewer (`pr-review-log-workflows-v1-2026-05-03T00-00-00Z.md`); Chunks 9–16 not yet implemented. Per-chunk plan-to-spec mapping taken from the plan's "Spec coverage map".

## Requirements extracted

### Chunk 3 — Per-task event log (§8.1, §3.1, Decision 11)

| REQ | Spec | Verdict | Evidence |
|---|---|---|---|
| 3.1 | Plan | PASS | `server/services/agentExecutionEventTaskSequencePure.ts` |
| 3.2 | Plan | PASS | `agentExecutionEventService.ts:213-330` (taskId/eventOrigin/eventSubsequence) |
| 3.3 | Plan | PASS | `agentExecutionEventService.ts:680` (`streamEventsByTask`) |
| 3.4 | Plan | PASS | `agentExecutionEventService.ts:788` (`appendEventBundle`) |
| 3.5 | §3.1 | PASS | `agentExecutionEvents.ts:55-58` |
| 3.6 | §3.1 | PASS | `tasks.ts:64` (`nextEventSeq`) |
| 3.7 | Round-2 | PASS | `agentExecutionEvents.ts:59` (`eventSchemaVersion`) |
| 3.8 | §8.1 | PASS | `agentExecutionEventService.ts:280` (FOR UPDATE in transaction) |
| 3.9 | Plan | PASS | `agentExecutionEventServicePure.ts:65` (per-task `buildEventId`) |
| 3.10 | Plan | PASS | `shared/types/agentExecutionLog.ts:314` |

### Chunk 4 — Gate primitive + state machine (§3.3, §5.1.1, §11.4.1)

| REQ | Spec | Verdict | Evidence |
|---|---|---|---|
| 4.1 | Plan | PASS | `server/services/workflowStepGateService.ts` |
| 4.2 | Plan | PASS | `server/services/workflowStepGateServicePure.ts` |
| 4.3 | §3.3 | PASS | `server/db/schema/workflowStepGates.ts` |
| 4.4 | Round-2 | PASS | `shared/stateMachineGuards.ts:29` (`workflow_step_gate` machine) |
| 4.5 | Plan | PASS | `shared/types/workflowStepGate.ts` |
| 4.6 | §5.1.1 | PASS | `workflowRunService.decideApproval` extended |
| 4.7 | §11.4.1 | PASS | `workflowRunService.submitStepInput` extended |
| 4.8 | Round-1 | PASS | `resolveOpenGatesForRun` + `failRun`/`cancelRun` wiring |
| 4.9 | §5.1 single-gate | PASS | `workflowEngineService.ts:1141-1176` (`getOpenGate` pre-check) |

### Chunk 5 — Approval routing + isCritical (§5.1, §5.1.2, §5.2, §5.4)

| REQ | Spec | Verdict | Evidence |
|---|---|---|---|
| 5.1 | Plan | PASS | `server/services/workflowApproverPoolService.ts` |
| 5.2 | Plan | PASS | `server/services/workflowApproverPoolServicePure.ts` |
| 5.3 | §5.1.2 | PASS | `workflowGates.ts:27` (`POST /api/tasks/:taskId/gates/:gateId/refresh-pool`) |
| 5.4 | Plan | PASS | `server/services/workflowGateRefreshPoolService.ts` |
| 5.5 | §5.2 | PASS | `workflowEngineService.ts:1141-1176` (isCritical synthesis) |
| 5.6 | §18.1 #1 | PASS | `workflowRuns.ts:254` (`assertCallerInApproverPool`) |
| 5.7 | §5.1 | PASS | `workflowApproverPoolService.ts:58-82` (`task_requester` resolver) |

### Chunk 6 — Confidence + audit (§6.1–§6.5)

| REQ | Spec | Verdict | Evidence |
|---|---|---|---|
| 6.1 | Plan | PASS | `server/services/workflowConfidenceServicePure.ts` |
| 6.2 | Plan | PASS | `server/services/workflowConfidenceService.ts` |
| 6.3 | Plan | PASS | `server/services/workflowSeenPayloadServicePure.ts` |
| 6.4 | Plan | **DIRECTIONAL_GAP** | `server/services/workflowSeenPayloadService.ts` (impure wrapper) does not exist |
| 6.5 | Plan | PASS | `server/services/workflowConfidenceCopyMap.ts` |
| 6.6 | §6.4 | PASS | High confidence does not auto-approve (engine still opens gate) |
| 6.7 | §6.3 | PASS | `seen_payload`/`seen_confidence` written once at gate-open |

### Chunk 7 — Cost / wall-clock runaway (§3.1, §7)

| REQ | Spec | Verdict | Evidence |
|---|---|---|---|
| 7.1 | Plan | PASS | `server/services/workflowRunPauseStopServicePure.ts` |
| 7.2 | Plan | PASS | `server/services/workflowRunPauseStopService.ts` |
| 7.3 | Plan | PASS | `workflowRunCostLedgerService.ts` (atomic `sql\`${col}+${delta}\``) |
| 7.4 | §3.1 | PASS | `workflowRuns.ts:82` (`costAccumulatorCents`) |
| 7.5 | Round-2 | PASS | `workflowRuns.ts:83` (`degradationReason`) |
| 7.6 | §7.4 | PASS | `workflowEngineService.ts:955-1005` (DB-time `EXTRACT(EPOCH ...)`) |
| 7.7 | Round-2 | PASS | `workflowEngineService.ts:1012-1033` (pre-step cap) |
| 7.8 | Round-3 | PASS | DB-time SQL only; no `Date.now()` for elapsed |
| 7.9 | §7 routes | **DIRECTIONAL_GAP** | Implementation: `/api/workflow-runs/:runId/{pause,resume,stop}` vs spec `/api/tasks/:taskId/run/{pause,resume,stop}` |
| 7.10 | Round-2 | PASS | `shared/stateMachineGuards.ts:44` (`'paused'`) |

### Chunk 8 — Stall-and-notify + schedule pinning (§5.3, §3.1, §5.4)

| REQ | Spec | Verdict | Evidence |
|---|---|---|---|
| 8.1 | Plan | PASS | `server/jobs/workflowGateStallNotifyJob.ts` |
| 8.2 | Plan | PASS | `server/services/workflowGateStallNotifyService.ts` |
| 8.3 | Plan | PASS | `server/services/workflowGateStallNotifyServicePure.ts` |
| 8.4 | Plan | PASS | `server/services/workflowScheduleDispatchService.ts` |
| 8.5 | Plan | PASS | `server/index.ts:572-577` (queue worker registered) |
| 8.6 | §5.3 | PASS | `workflowStepGateService.ts:192,271,304` (schedule + cancel + cascade) |
| 8.7 | Round-1 | PASS | `workflowGateStallNotifyJob.ts:64-74` (resolved_at AND created_at guards) |
| 8.8 | §5.4 | PASS | `workflowScheduleDispatchService.ts:57-108` |

## Mechanical fixes applied

None. Both gaps are DIRECTIONAL — design decisions outside spec-conformance auto-fix scope.

**Note on lint baseline:** `eslint.config.js` updated to ignore the local `.worktrees/**` directory (operator-approved via the protected-config sentinel). Worktree was generating 3,809 ESLint parsing errors due to multiple `tsconfig.json` roots. Unrelated to workflows-v1; does not weaken any check.

## Directional gaps routed

- **REQ 6.4** — `workflowSeenPayloadService.ts` (impure wrapper) does not exist. Pure builder is consumed directly via `workflowStepGateServicePure.ts → buildSeenPayload()`. Plan named this file as an impure orchestrator that loads run context. Implementation may have inlined the orchestration. Whether this is a missing layer or intentional simplification needs human judgment.
- **REQ 7.9** — Pause / Resume / Stop routes diverge from spec contract. Spec §7 names `POST /api/tasks/:taskId/run/{pause,resume,stop}`; implementation lands them at `/api/workflow-runs/:runId/{pause,resume,stop}`. Implementation pattern matches existing approval route, but Chunk 11's task UI will consume these endpoints — divergence will surface as a wiring decision.

## Files modified by this run

- `eslint.config.js` (worktree ignore — operator-approved separately)
- `tasks/review-logs/spec-conformance-log-workflows-v1-chunks-3-8-2026-05-03T20-29-16Z.md` (this file)
- `tasks/todo.md` (deferred-items section appended)

## Next step

NON_CONFORMANT — 2 directional gaps to address before pr-reviewer finalises. See `tasks/todo.md § Deferred from spec-conformance review — workflows-v1 (2026-05-03)`. The main session must:

1. Decide whether `workflowSeenPayloadService.ts` (impure wrapper) needs to land or whether the inlined call chain is the intended design.
2. Decide whether pause/resume/stop route URLs should be migrated to `/api/tasks/:taskId/run/...` to match the spec, or whether the spec should be amended.

`pr-reviewer` may run on the current branch state in parallel — the two directional gaps are independent of code-quality concerns the reviewer surfaces.
