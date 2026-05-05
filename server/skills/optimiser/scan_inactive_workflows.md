---
name: Scan Inactive Workflows
description: Finds scheduled sub-account agents whose most recent run is older than 1.5x their expected cadence. Flags agents that appear to have stopped running on schedule.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns `Array<{ subaccount_agent_id: string, agent_id: string, agent_name: string, expected_cadence: string, last_run_at: string | null }>` where:

- `subaccount_agent_id` — UUID of the `subaccount_agents` row.
- `agent_id` — UUID of the agent.
- `agent_name` — Display name of the agent.
- `expected_cadence` — Human-readable cadence description derived from `scheduleCron` (e.g. "daily", "every 4 hours").
- `last_run_at` — ISO-8601 timestamp of the most recent completed run, or null if the agent has never run.

Returns an empty array when all scheduled agents are running within their expected cadence.

## Instructions

This skill is read-only. It queries `subaccount_agents` (where `scheduleEnabled = true AND scheduleCron IS NOT NULL`) joined to `agent_runs` to find the most recent run. The 1.5x cadence threshold is computed via `scheduleCalendarServicePure`. Findings are evaluated using the `optimiser.inactive.workflow` evaluator.

No side effects. Read-replica safe.
