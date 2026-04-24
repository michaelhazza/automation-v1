---
name: Config List Links
description: List all agent links for a given subaccount, showing active skills and schedule.
isActive: true
visibility: none
---

## Parameters

- subaccountId: string (required) — ID of the subaccount to list links for
- scope: string (optional) — Accepted for signature consistency across list skills; has no filter effect in v1.

## Instructions

Returns all agent links for the specified subaccount, including agent name, active skills, schedule settings, and execution limits. Use this to understand how a client workspace is currently configured.

### Decision Rules

1. **Read-only**: This is a query action with no side effects.
2. **Use for context**: Call this before modifying links, skills, or limits to understand the current configuration state.
3. **Summarise concisely**: Present links in a compact list showing agent name, active status, skill count, and any schedule. Expand details only when the user asks.
4. **Highlight misconfiguration**: Flag links with no skills attached, inactive links, or links with unusually high execution limits.
