---
name: Config Preview Plan
description: Emit a structured configuration plan for user review before executing mutations.
isActive: true
visibility: none
---

## Parameters

- summary: string (required) — High-level description of what the plan accomplishes.
- targetScope: object (required) — Contains type, subaccountIds, and subaccountNames.
- steps: array (required) — Each step has stepNumber, action, entityType, entityId, summary, parameters, dependsOn, and riskLevel.
- failFast: boolean (optional, default true) — Whether to stop execution on first failure.

## Instructions

Constructs and presents a configuration plan to the user for approval. Every mutation must appear as a plan step before execution. The plan is rendered as an interactive checklist in the UI.

Risk levels are deterministic:
- **high** — modifies prompts, deactivates agents, restores versions, deletes data sources.
- **medium** — changes schedule, limits, skills.
- **low** — creates entities, updates names/descriptions.

Wait for user approval before executing any steps.
