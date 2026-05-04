---
name: Scan Workflow Escalations
description: Queries escalation rates per workflow over the last 14 days. Returns one row per workflow where the escalation rate exceeds the warning threshold.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ workflow_id: string, run_count: number, escalation_count: number, escalation_pct: number, common_step_id: string }>` where:

- `workflow_id` — UUID of the workflow (agent process).
- `run_count` — Total runs in the 14-day window.
- `escalation_count` — Number of runs that ended with a human escalation.
- `escalation_pct` — Ratio of escalation_count to run_count (0..1, 4 decimal places).
- `common_step_id` — The modal `flow_step_outputs.stepId` of escalating runs — the step most frequently associated with escalations.

Returns an empty array when no workflows exceed the escalation threshold in the window.

## Instructions

This skill is read-only. It queries `agent_runs` and `review_items` over a 14-day window, grouped by workflow/process. The `common_step_id` value populates the `step=` query parameter of the `playbook.escalation_rate` action hint. Findings are evaluated using the `optimiser.playbook.escalation_rate` evaluator (>30% = warn, >60% = critical).

No side effects. Read-replica safe.
