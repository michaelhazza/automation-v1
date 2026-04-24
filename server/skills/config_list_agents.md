---
name: Config List Agents
description: List all org agents with current status, model, and default skills.
isActive: true
visibility: none
---

## Parameters

- scope: string (optional) — Delegation scope filter. Values: `children | descendants | subaccount`. Adaptive default: `children` if the calling agent has direct reports, `subaccount` otherwise. `children` returns only direct reports; `descendants` returns the full subtree; `subaccount` returns all agents in the subaccount regardless of hierarchy position.

## Instructions

Returns all org-level agents with their key properties: id, name, slug, status, modelId, defaultSkillSlugs, and description. Use this to understand the current agent landscape before making configuration changes.

### Decision Rules

1. **Read-only**: This is a query action with no side effects.
2. **Use for resolution**: When a user references an agent by name, use this skill to resolve the name to an agent ID before calling other config skills.
3. **Summarise concisely**: Present agents in a compact list format. Only expand details for specific agents the user asks about.
4. **Flag inactive agents**: If listing for configuration purposes, highlight any agents with inactive status so the user is aware.
