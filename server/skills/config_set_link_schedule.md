---
name: Config Set Link Schedule
description: Set the heartbeat or cron schedule on a subaccount agent link.
isActive: true
visibility: none
---

## Parameters

- linkId: string (required) — ID of the subaccount agent link
- subaccountId: string (required) — ID of the subaccount (for scoping)
- heartbeatEnabled: boolean (optional) — Enable or disable heartbeat mode
- heartbeatIntervalHours: number (optional) — Hours between heartbeat runs
- heartbeatOffsetMinutes: number (optional) — Minute offset within the interval
- scheduleCron: string (optional) — Cron expression for scheduled runs
- scheduleEnabled: boolean (optional) — Enable or disable cron schedule
- scheduleTimezone: string (optional) — IANA timezone (e.g. 'America/New_York')

## Instructions

Configures the schedule for an agent in a subaccount.

### Schedule Modes

- **Heartbeat**: Runs the agent at regular intervals (e.g. every 4 hours). Use heartbeatOffsetMinutes to stagger timing and avoid thundering herd across subaccounts.
- **Cron**: Runs on a specific cron schedule (e.g. "0 9 * * 1-5" for weekdays at 9am). More precise than heartbeat for calendar-aligned tasks.

### Decision Rules

1. **Default timezone**: If scheduleTimezone is not specified, default to the org's timezone. Always store as an IANA timezone identifier.
2. **Stagger schedules**: When configuring schedules for multiple subaccounts, vary heartbeatOffsetMinutes or cron minutes to distribute load.
3. **Validate cron**: Ensure the cron expression is valid before submitting. Common mistake: using 5-field (minute-level) vs 6-field (second-level) format.
4. **Avoid dual mode**: Setting both heartbeat and cron active simultaneously is usually a mistake. Confirm with the user if both are requested.
5. **Disabling**: To pause a schedule without deleting it, set heartbeatEnabled or scheduleEnabled to false.
