---
name: Config Link Agent
description: Link an org agent to a subaccount, creating the subaccount-agent relationship.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- agentId: string (required) — ID of the org agent to link
- subaccountId: string (required) — ID of the target subaccount
- isActive: boolean (optional) — Whether the link is active, default true

## Instructions

Creates a link between an org agent and a subaccount. Once linked, the agent becomes available to operate in that subaccount's context.

### Decision Rules

1. **Verify both entities exist**: Confirm the agent and subaccount exist before attempting to link.
2. **Duplicate detection**: If the link already exists, report it to the user rather than failing silently or creating a duplicate.
3. **Default active**: Links are created active by default. Only set isActive to false if the user explicitly wants a paused link.
4. **Next steps**: After linking, suggest configuring skills, custom instructions, and schedules for the new link using the dedicated tools (config_set_link_skills, config_set_link_instructions, config_set_link_schedule).
