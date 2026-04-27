---
name: Config Update Agent
description: Update an existing org agent's prompt, model, skills, or description.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- agentId: string (required) — ID of the agent to update
- name: string (optional) — New display name
- description: string (optional) — New description
- masterPrompt: string (optional) — New system prompt
- modelProvider: string (optional) — New LLM provider
- modelId: string (optional) — New model identifier
- responseMode: enum (optional) — One of: balanced, focused, creative
- outputSize: enum (optional) — One of: concise, standard, detailed
- defaultSkillSlugs: string array (optional) — New default skill slugs
- icon: string (optional) — New icon identifier

## Instructions

Updates fields on an existing org agent. Only include fields that need to change — omitted fields are left untouched. Config history is recorded before the update for audit purposes.

### Self-Modification Guard

Reject the request if the agentId matches the Configuration Assistant's own agent ID. The config agent cannot modify itself.

### Decision Rules

1. **Partial updates only**: Never overwrite fields the user did not ask to change.
2. **Prompt changes are high-risk**: When updating masterPrompt, confirm the change with the user and summarise the diff.
3. **Model changes**: Warn the user if switching to a different provider or a significantly different model tier.
4. **Skill changes**: When updating defaultSkillSlugs, this replaces the full list — confirm the complete set, not just additions.
