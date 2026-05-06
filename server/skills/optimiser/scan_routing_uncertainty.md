---
name: Scan Routing Uncertainty
description: Per agent, measures the distribution of fast-path routing confidence and second-look trigger rate over the last 7 days. Returns agents with high uncertainty signals that may indicate unclear agent scope or overlapping responsibilities.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ agent_id: string, low_confidence_pct: number, second_look_pct: number, total_decisions: number }>` where:

- `agent_id` — UUID of the agent.
- `low_confidence_pct` — Fraction of routing decisions where `decidedConfidence` was below the low threshold (0..1, 4 decimal places).
- `second_look_pct` — Fraction of routing decisions where `secondLookTriggered = true` (0..1, 4 decimal places).
- `total_decisions` — Count of `fast_path_decisions` rows for this agent in the 7-day window. Used by the `materialDelta` volume floor.

Returns an empty array when no agents exceed the routing uncertainty threshold.

## Instructions

This skill is read-only. It queries `fast_path_decisions` over a 7-day window, grouped by agent. Only agents with `total_decisions >= 10` are included to ensure statistical significance. Findings are evaluated using the `optimiser.agent.routing_uncertainty` evaluator.

No side effects. Read-replica safe.
