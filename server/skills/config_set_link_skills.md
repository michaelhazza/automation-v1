---
name: Config Set Link Skills
description: Set the skill slugs on a subaccount agent link.
isActive: true
visibility: none
---

## Parameters

- linkId: string (required) — ID of the subaccount agent link
- subaccountId: string (required) — ID of the subaccount (for scoping)
- skillSlugs: string array (required) — Full list of skill slugs to assign

## Instructions

Sets the active skills for an agent in a specific subaccount. This replaces the entire skill list — it is not additive. Any skills not included in the array will be removed.

### Decision Rules

1. **Discover before assigning**: Use config_list_system_skills and config_list_org_skills to discover available skills before setting them. Do not guess at slug names.
2. **Minimal skill set**: Prefer the smallest set of skills needed for the agent's role in this subaccount. More skills increase token usage and can confuse the agent.
3. **Full replacement**: Always confirm the complete list with the user, since this operation replaces rather than appends.
4. **Validate slugs**: Ensure every slug in the array corresponds to an existing, active skill. Invalid slugs will cause errors.
