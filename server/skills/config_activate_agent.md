---
name: Config Activate Agent
description: Set an agent's status to active or inactive.
isActive: true
visibility: basic
---

## Parameters

- agentId: string (required) — ID of the agent to activate or deactivate
- status: enum (required) — One of: active, inactive

## Instructions

Activates or deactivates an org agent. Active agents can receive tasks and run on schedules; inactive agents are paused and will not execute.

### Self-Modification Guard

Reject the request if the agentId targets the Configuration Assistant. The config agent cannot deactivate itself.

### Decision Rules

1. **Deactivation is high-risk**: Always confirm with the user before deactivating an agent. Explain that scheduled runs and task assignments will stop.
2. **Check for active schedules**: Before deactivating, warn the user if the agent has active heartbeat or cron schedules in any subaccount.
3. **Activation is safe**: Activating an agent requires no special confirmation.
4. **Report the outcome**: After the status change, confirm the new state to the user.
