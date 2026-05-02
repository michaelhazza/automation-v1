---
name: Scan Inactive Workflows
description: Finds sub-account agents with scheduled runs enabled that have missed 2 or more expected heartbeats. Used by the optimiser to detect workflows that have silently stopped running.
isActive: true
visibility: none
---

## Parameters

- subaccount_id: string (required) — UUID of the sub-account to scan.

## Output

Returns an array of `InactiveWorkflowRow`:
- `subaccount_agent_id` — UUID of the subaccount_agents link row.
- `agent_id` — UUID of the agent.
- `agent_name` — display name of the agent.
- `expected_cadence` — human-readable description of the expected run cadence.
- `last_run_at` — ISO-8601 timestamp of the last agent run, or null if never run.

Returns `[]` when all scheduled agents are running on time.

## Rules

- Only includes subaccount_agents rows with scheduleEnabled=true and a non-null scheduleCron.
- Expected cadence uses computeNextHeartbeatAt to derive expected run times.
- Returns raw data only. Missed-heartbeat threshold evaluation is done by the evaluator.
