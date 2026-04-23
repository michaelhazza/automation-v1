---
name: Config List Subaccounts
description: List all subaccounts with name, slug, and status.
isActive: true
visibility: none
---

## Parameters

- scope: string (optional) — Accepted for signature consistency across list skills; has no filter effect in v1.

## Instructions

Returns all subaccounts (client workspaces) in the organisation. Use this to resolve user references to clients by fuzzy name matching.

### Decision Rules

1. **Read-only**: This is a query action with no side effects.
2. **Fuzzy matching**: If a user says "Acme", look for subaccounts containing that term in the name or slug. Present the closest match and confirm before using its ID in other operations.
3. **Summarise concisely**: Present subaccounts in a compact list format with name, slug, and status.
4. **Use for context**: Call this before config_link_agent or config_create_scheduled_task to verify the target subaccount exists and confirm with the user.
