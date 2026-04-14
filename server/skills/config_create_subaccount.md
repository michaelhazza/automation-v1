---
name: Config Create Subaccount
description: Create a new subaccount (client workspace) with name and slug.
isActive: true
visibility: none
---

## Parameters

- name: string (required) — Display name for the subaccount
- slug: string (optional) — URL-safe identifier, auto-derived from name if not provided

## Instructions

Creates a new subaccount (client workspace). The slug is auto-derived from the name if not provided (lowercased, hyphenated). Each subaccount represents a client workspace where agents can be linked and configured.

### Decision Rules

1. **Verify uniqueness**: Check that the name is not already in use before creating. Report conflicts to the user rather than silently failing.
2. **Slug format**: If providing a custom slug, it must be lowercase and hyphenated (e.g., "acme-corp"). The auto-derived slug handles this automatically.
3. **Confirm before creating**: Always confirm the subaccount name with the user before executing.
4. **Next steps**: After creating, suggest linking agents to the new subaccount using config_link_agent.
