# Stub: State-machine guard coverage extension

**Trigger to activate:** When the next status-write boundary in `workflowEngineService` / `agentExecutionService` is touched OR when an intermediate-transition invariant violation slips past existing coverage.

**Scope (one paragraph).** Extend the centralised `assertValidTransition(from, to)` helper (currently at `shared/stateMachineGuards.ts` per PR #211 round 2) to the remaining 5-7 status-write sites and tighten the per-kind transition tables for intermediate non-terminal moves. Scope: `workflowEngineService` remaining status-write sites, `agentExecutionService` agentic-loop terminal write, `briefApprovalService.decideApproval`, `workflowRunService` run-level terminal aggregation, plus extension of the helper itself with intermediate-transition tables.

**Origin:** CHATGPT-PR211-F6 in legacy `tasks/todo.md`.
