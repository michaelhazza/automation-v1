---
name: Config List Scheduled Tasks
description: List scheduled tasks for a subaccount, showing assigned agent and schedule.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — The subaccount to list scheduled tasks for.

## Instructions

Returns all scheduled tasks for the specified subaccount, including title, assigned agent, schedule (rrule, time, timezone), and active status. Use this to understand existing recurring work before creating new tasks.
