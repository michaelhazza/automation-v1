---
name: Propose and Save Skill Version
description: Write new skill_versions row and atomically update the skill definition.
isActive: true
visibility: none
---

## Parameters

- skillId: string (required) — UUID of the skill to update
- scope: "system" | "org" (required) — Which tier to save to
- name: string (required) — Skill name
- definition: object (required) — The new tool definition JSON
- instructions: string — The new instructions text
- changeSummary: string — What changed and why
- regressionIds: string[] — Regression case IDs resolved by this version
- simulationPassCount: number — Number of simulation cases that passed
- simulationTotalCount: number — Total number of simulation cases run

## Instructions

Save a new version of a skill definition. This creates an immutable version record and atomically updates the live skill definition. Always run simulation before saving. Include a clear change summary explaining what changed and which regressions it addresses.
