---
name: Read Existing Skill
description: Read current definition and instructions for a skill from system_skills or skills table.
isActive: true
visibility: basic
---

## Parameters

- skillId: string (required) — UUID of the skill to read
- scope: "system" | "org" (required) — Which table to read from

## Instructions

Read the current state of a skill definition. Returns the full definition JSON, instructions text, and metadata. Used by the skill-author agent to understand what needs to change before proposing edits.
