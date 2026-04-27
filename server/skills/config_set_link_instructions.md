---
name: Config Set Link Instructions
description: Set custom instructions on a subaccount agent link (per-client context and directives).
isActive: true
visibility: basic
---

## Parameters

- linkId: string (required) — ID of the subaccount agent link
- subaccountId: string (required) — ID of the subaccount (for scoping)
- customInstructions: string (required) — Per-client custom instructions, max 10000 chars

## Instructions

Sets per-client custom instructions for an agent link. This replaces the entire instructions field.

### What Good Custom Instructions Include

- **Client business context**: Industry, company size, key products/services.
- **Location and timezone**: Where the client operates, relevant local context.
- **Brand voice**: Tone, formality level, language preferences.
- **Communication preferences**: Preferred channels, response style, escalation paths.
- **Success criteria**: What good outcomes look like for this specific client.
- **Constraints**: Topics to avoid, competitors not to mention, compliance requirements.

### Decision Rules

1. **Full replacement**: This overwrites the entire instructions field. Confirm the complete text with the user.
2. **Differentiation focus**: Custom instructions should differentiate behaviour across clients without duplicating agents. If the instructions are generic, they belong in the agent's masterPrompt instead.
3. **Length check**: Warn if instructions exceed 5000 chars — shorter, focused instructions tend to perform better.
4. **No sensitive data**: Do not include API keys, passwords, or PII in custom instructions.
