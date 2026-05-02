---
name: Scan Agent Budget
description: Queries cost_aggregates for a sub-account's agents and returns per-agent this-month / last-month / budget rows. Used by the optimiser to detect agents spending more than 1.3x their configured monthly budget for two consecutive months.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — UUID of the sub-account to scan.
- organisationId: string (required) — UUID of the organisation owning the sub-account.

## Output

Returns an array of `AgentBudgetRow`:
- `agent_id` — UUID of the agent.
- `this_month` — integer cents spent in the current month.
- `last_month` — integer cents spent in the prior month.
- `budget` — integer cents configured as the monthly budget (0 if unset).
- `top_cost_driver` — skill slug or feature tag that drove the most cost this month, or `"unknown"`.

Returns `[]` when no budget rows exist for the sub-account.

## Evaluator

Output is processed by the `agentBudget` evaluator (`server/services/optimiser/recommendations/agentBudget.ts`).

## Rules

- Query window: current month + prior month only (no full-table scan).
- Returns raw data only. Trigger evaluation is done by the evaluator module, not this skill.
- Budget of 0 means no budget configured — the evaluator skips budget-check for that agent.
