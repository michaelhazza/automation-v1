# Codebase Audit Report — Track A2 (workflowEngine split, post-refactor)

| Field | Value |
|---|---|
| Audit framework version | 1.4 |
| Project | automation-v1 |
| Audited by | Claude Code (main session, inline audit-runner playbook, second track) |
| Date | 2026-05-14 |
| Branch | audit/track-workflow-engine |
| Starting commit SHA | 6f2f819a235f78dc0fca8575d015cc7945cf8bd5 |
| Final commit SHA | _(filled at finish)_ |
| Mode | Targeted — workflowEngine split surface (one of the four god-file splits stated in the original operator brief) |
| Layers run | Layer 2 Module I (RLS overlap) + Module J (idempotency / queues / job discipline) + Module K (three-tier agents — workflow hooks into agent runs), informed by Layer 1 Areas 9 (boundary violations) + 10 (god files) |
| Subagents invoked | None (audit-runner runs inline) |
| Linked review logs | _(filled when spec-conformance + pr-reviewer run)_ |
| Previous track in this session | `audit/track-rls-agent-exec` (Track A) — PR #308 |

---

## Reconnaissance Map

### Context block validation

Validated 2.5 hours earlier in Track A; no stack changes since. Skipping re-validation per framework §2 ("re-verify at the start of every audit run" — done within the same session, same starting commit family).

### Resolved in-scope paths

**Services (31 workflow + 9 automation/flow companions):**

- `workflowEngineService.ts` (4,073 LOC) — the focal point of the operator-stated split
- `workflowEngineServicePure.ts` (95 LOC) — Pure companion
- `workflowRunService.ts` (1,117 LOC)
- `workflowRunInsertHelper.ts`, `workflowRunResolverService.ts`
- `workflowRunPauseStopService.ts` + `…Pure.ts`
- `workflowRunCostLedgerService.ts`
- `workflowStudioService.ts` (612 LOC), `workflowStudioGithub.ts`
- `workflowStepGateService.ts` (517 LOC), `workflowStepReviewService.ts`
- `workflowTemplateService.ts` (489 LOC), `workflowPublishService.ts`, `workflowDraftService.ts`
- `workflowActionCallExecutor.ts` + `…Pure.ts`
- `workflowAgentRunHook.ts`
- `workflowApproverPoolService.ts` + `…Pure.ts`
- `workflowConfidenceService.ts` + `…Pure.ts` + `workflowConfidenceCopyMap.ts`
- `workflowGateRefreshPoolService.ts`, `workflowGateStallNotifyService.ts` + `…Pure.ts`
- `workflowScheduleDispatchService.ts`, `workflowSeenPayloadServicePure.ts`, `workflowValidatorPure.ts`
- `flowExecutorService.ts`, `automationService.ts`, `automationResolutionService.ts`
- `automationConnectionMappingService.ts`, `systemAutomationService.ts`
- `invokeAutomationStepService.ts` + `…Pure.ts`, `invokeAutomationStepPure.ts`
- `memoryOnboardingFlowService.ts`

**Routes:** `workflowRuns.ts`, `workflowDrafts.ts`, `workflowGates.ts`, `workflowStudio.ts`, `workflowTemplates.ts`, `automations.ts`, `automationConnectionMappings.ts`, `subaccountOnboardingFlow.ts`, `systemAutomations.ts`.

**Schema:** `workflow_runs`, `workflow_step_gates`, `workflow_drafts`, `workflow_templates` (+ `workflow_template_versions`, `system_workflow_templates`, `system_workflow_template_versions`, `workflow_step_runs`, `workflow_studio_sessions`, `workflow_run_event_sequences`), `flow_runs`, `flow_step_outputs`, `automation_engines` (formerly workflow_engines).

### Out-of-scope

- pg-boss workers / jobs themselves (Module J general) — Track B/C territory.
- Webhook adapters.
- Skills / actionRegistry editorial.
- Frontend workflow studio UI.

### Concurrent audits

Track A (PR #308) is in flight on `audit/track-rls-agent-exec`. This Track A2 audit operates on a non-overlapping file set; no anticipated collisions on merge.

### Critical-path coverage assessment

`gates + sparse unit`. Specific named tests:

- `__tests__/workflowValidatorPure.test.ts` (641 LOC)
- `__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` (563 LOC)
- `__tests__/workflowConfidenceServicePure.test.ts` (256 LOC)
- `__tests__/workflowRunPauseStopServicePure.test.ts` (148 LOC)
- `__tests__/workflowSeenPayloadServicePure.test.ts` (140 LOC)
- `__tests__/workflowPublishService.test.ts` (126 LOC)

Trust posture: downgrade `high` to `medium` for any fix whose path lacks named test coverage.

### Implicit external contracts (Rule 4)

- `workflow_runs.execution_log` persisted JSON shape.
- `workflow_runs.workflow_template_version_id` FK contract (pinned version).
- pg-boss job payloads (`workflow_run_gate_refresh`, `workflow_run_gate_stall_notify` etc.).
- `workflowApproverPool` selection algorithm (changes affect approver routing).
- `workflowConfidence` scoring output (affects HITL gating decisions).

### Protected files identified in scope (framework §4)

- `server/db/schema/workflow*.ts`, `flowRuns.ts`, `automationEngines.ts`.
- All `migrations/*.sql` touching workflow tables.
- `server/services/workflowEngineService.ts` (cited in §4 Three-Tier Agent System indirectly — workflowAgentRunHook bridges).
- `server/services/withBackoff` (canonical retry primitive) — referenced by workflowGateStallNotifyService.

---

## Pass 1 Findings

_(populated below as the run continues)_
