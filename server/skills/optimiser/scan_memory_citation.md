---
name: Scan Memory Citation
description: Per agent, measures what fraction of injected memory entries had a low citation score (< 0.3) over the last 7 days. Returns agents where more than 50% of injected memories were low-quality — a signal that memory injection is wasting tokens.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ agent_id: string, low_citation_pct: number, total_injected: number, projected_token_savings: number }>` where:

- `agent_id` — UUID of the agent.
- `low_citation_pct` — Fraction of injected memories with `finalScore < 0.3` (0..1, 4 decimal places).
- `total_injected` — Total number of memory entries injected in the 7-day window.
- `projected_token_savings` — Estimated tokens that could be saved by not injecting low-quality entries.

Returns an empty array when no agents exceed the 50% low-citation threshold.

## Instructions

This skill is read-only. It queries `memory_citation_scores` over a 7-day window, grouped by agent. Only agents with `total_injected >= 10` are included to avoid flagging agents with too little data. Findings are evaluated using the `optimiser.memory.low_citation_waste` evaluator.

No side effects. Read-replica safe.
