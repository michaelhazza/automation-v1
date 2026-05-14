---
name: Validate Skill Definition
description: Validate a proposed skill definition against Anthropic tool-definition schema and Zod rules.
isActive: true
visibility: basic
---

## Parameters

- definition: object (required) — The proposed tool definition JSON
- handlerKey: string (required) — The handler key that must exist in SKILL_HANDLERS

## Instructions

Validate a proposed skill definition before saving. Checks that the definition conforms to the Anthropic tool schema (name, description, input_schema) and that the handler key is registered. Returns validation errors if any.
