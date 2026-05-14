---
name: Scan Agent Budget
description: Queries current-month cost vs budget for each agent in the sub-account. Returns one row per agent that has a budget cap set and has spent anything this month.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ agent_id: string, agent_name: string, this_month_spend_usd: number, budget_limit_usd: number, percent_used: number }>` where:

- `agent_id` — UUID of the agent.
- `agent_name` — Display name of the agent.
- `this_month_spend_usd` — Total spend this month in USD.
- `budget_limit_usd` — The configured monthly budget cap in USD.
- `percent_used` — Ratio of spend to budget (0..N, 4 decimal places). Values > 1.0 mean the budget is exceeded.

Returns an empty array when no agents have a budget cap or no spend this month.

## Instructions

This skill is read-only. It queries `cost_aggregates` (entity_type=agent, period_type=monthly) joined to `subaccount_agents` and `agents`. Only agents with `max_cost_per_run_cents > 0` are returned. Findings are evaluated by the orchestrator using the `optimiser.agent.over_budget` evaluator (>90% used = warn, >100% used = critical).

No side effects. Read-replica safe.
