---
name: Config Update Link
description: Update a subaccount agent link with any combination of override fields.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- linkId: string (required) — ID of the subaccount agent link
- subaccountId: string (required) — ID of the subaccount (for scoping)
- skillSlugs: string array (optional) — Skill slugs to assign
- customInstructions: string (optional) — Per-client instructions, max 10000 chars
- tokenBudgetPerRun: number (optional) — Max tokens per agent run
- maxToolCallsPerRun: number (optional) — Max tool calls per run
- timeoutSeconds: number (optional) — Run timeout in seconds
- maxCostPerRunCents: number (optional) — Max cost per run in cents
- maxLlmCallsPerRun: number (optional) — Max LLM API calls per run
- heartbeatEnabled: boolean (optional) — Enable heartbeat schedule
- heartbeatIntervalHours: number (optional) — Hours between heartbeats
- heartbeatOffsetMinutes: number (optional) — Minute offset for heartbeat timing
- scheduleCron: string (optional) — Cron expression for scheduled runs
- scheduleEnabled: boolean (optional) — Enable cron schedule
- isActive: boolean (optional) — Whether the link is active

## Instructions

Generic update for subaccount agent links. Use this when updating multiple unrelated fields simultaneously.

### Decision Rules

1. **Prefer specific tools**: For single-purpose updates, use the dedicated tools instead: config_set_link_skills, config_set_link_instructions, config_set_link_schedule, or config_set_link_limits.
2. **Batch updates**: Use this tool when the user wants to change several unrelated fields in one operation.
3. **Validate limits**: Ensure numeric limits (token budget, cost, timeout) are reasonable. Warn on unusually high or low values.
4. **Schedule conflicts**: If setting both heartbeat and cron fields, warn that both modes being active may cause unexpected behaviour.
