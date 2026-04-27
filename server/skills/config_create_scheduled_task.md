---
name: Config Create Scheduled Task
description: Create a recurring scheduled task with title, description, assigned agent, and schedule.
isActive: true
visibility: basic
---

## Parameters

- title: string (required) — Title of the scheduled task
- description: string (optional) — Human-readable description of the task purpose
- brief: string (optional) — Detailed context passed to the agent when the task fires
- priority: enum (optional) — One of: low, normal, high, urgent
- assignedAgentId: string (optional) — ID of the agent to execute the task
- subaccountId: string (required) — ID of the subaccount this task belongs to
- rrule: string (optional) — iCal RRULE defining the recurrence pattern
- timezone: string (optional) — IANA timezone identifier (e.g., "America/New_York")
- scheduleTime: string (optional) — Time of day to run in HH:MM format
- isActive: boolean (optional) — Whether the task is active, default true

## Instructions

Creates a scheduled task that runs on a recurring schedule. The task must be assigned to a subaccount.

### Decision Rules

1. **Brief is critical for agents**: If assigning to an agent, include a detailed brief so the agent has full context when the task fires. A vague brief leads to poor execution.
2. **Stagger schedule times**: Avoid scheduling multiple tasks at the same time to prevent thundering herd. Offset by at least 5 minutes between tasks.
3. **Use IANA timezones**: Always use IANA timezone identifiers (e.g., "Europe/London", not "GMT"). Reject abbreviations like "EST" or "PST" which are ambiguous.
4. **Confirm schedule**: Always confirm the recurrence pattern and time with the user before creating.
5. **Default active**: Tasks are created active by default. Only set isActive to false if the user explicitly wants a paused task.
