---
name: Config Create Agent
description: Create a new org-level agent with name, prompt, model settings, and default skills.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- name: string (required) — Display name for the new agent
- description: string (optional) — Short description of the agent's purpose
- masterPrompt: string (required) — System prompt defining the agent's role and responsibilities
- modelProvider: string (optional) — LLM provider, default 'anthropic'
- modelId: string (optional) — Model identifier, default 'claude-sonnet-4-6'
- responseMode: enum (optional) — One of: balanced, focused, creative
- outputSize: enum (optional) — One of: concise, standard, detailed
- defaultSkillSlugs: string array (optional) — Skill slugs to attach by default
- icon: string (optional) — Icon identifier for the agent

## Instructions

Creates a new org-level agent. The masterPrompt should be specific to the agent's role and responsibilities — avoid generic prompts.

### Self-Modification Guard

Reject the request if the caller attempts to create an agent whose slug would match the Configuration Assistant. This prevents accidental duplication of the config agent.

### Decision Rules

1. **Confirm before creating**: Always confirm the agent name and purpose with the user before executing the create action.
2. **Prompt quality**: The masterPrompt must clearly define the agent's role, constraints, and expected behaviour. Push back on vague prompts.
3. **Minimal skills**: Only attach default skills that the agent genuinely needs. Prefer a lean skill set.
4. **Model selection**: Use the default model unless the user has a specific reason to override it.
