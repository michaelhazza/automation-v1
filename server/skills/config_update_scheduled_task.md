---
name: Config Update Scheduled Task
description: Update a scheduled task's description, schedule, agent assignment, or limits.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- taskId: string (required) — ID of the scheduled task to update
- subaccountId: string (required) — ID of the subaccount owning the task
- title: string (optional) — Updated title
- description: string (optional) — Updated description
- brief: string (optional) — Updated agent brief
- priority: enum (optional) — One of: low, normal, high, urgent
- assignedAgentId: string (optional) — Updated agent assignment
- rrule: string (optional) — Updated iCal RRULE recurrence pattern
- timezone: string (optional) — Updated IANA timezone identifier
- scheduleTime: string (optional) — Updated time of day in HH:MM format
- isActive: boolean (optional) — Updated active status

## Instructions

Updates fields on an existing scheduled task. Config history is recorded before the update for auditability.

### Decision Rules

1. **Partial updates only**: Only include fields that need to change. Omitted fields retain their current values.
2. **Verify task exists**: Confirm the task ID and subaccount ID are valid before applying changes.
3. **Schedule changes**: When changing schedule (rrule, timezone, scheduleTime), confirm the new recurrence pattern with the user.
4. **Agent reassignment**: When changing the assigned agent, review and update the brief to match the new agent's capabilities.
