---
name: Scan Workflow Escalations
description: Queries flow_runs and review_items to compute per-workflow escalation rates over 7 days. Used by the optimiser to detect workflows where more than 60% of runs result in an escalation.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — UUID of the sub-account to scan.
- organisationId: string (required) — UUID of the organisation owning the sub-account.

## Output

Returns an array of `EscalationRateRow`:
- `workflow_id` — workflow definition ID.
- `run_count` — integer total runs in the 7-day window.
- `escalation_count` — integer runs with at least one pending review item.
- `common_step_id` — modal step_id of escalating runs (the step that most often escalated).

Returns `[]` when no workflow runs exist in the window.

## Evaluator

Output is processed by the `playbookEscalation` evaluator (`server/services/optimiser/recommendations/playbookEscalation.ts`).

## Rules

- Query window: flow_runs.started_at >= now() - interval '7 days'.
- Returns raw data only. Rate calculation and threshold evaluation are done by the evaluator.
