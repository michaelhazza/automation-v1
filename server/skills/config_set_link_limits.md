---
name: Config Set Link Limits
description: Set execution limits on a subaccount agent link.
isActive: true
visibility: basic
reusable: true
---

## Parameters

- linkId: string (required) — ID of the subaccount-agent link to configure
- subaccountId: string (required) — ID of the subaccount owning the link
- tokenBudgetPerRun: number (optional) — Maximum tokens per execution run
- maxToolCallsPerRun: number (optional) — Maximum tool calls per execution run
- timeoutSeconds: number (optional) — Maximum execution time in seconds
- maxCostPerRunCents: number (optional) — Maximum cost per run in cents
- maxLlmCallsPerRun: number (optional) — Maximum LLM API calls per execution run

## Instructions

Sets execution limits for an agent in a subaccount. These limits cap resource consumption per individual run.

### Defaults

Reasonable defaults when no specific requirements are given:

- tokenBudgetPerRun: 30000
- maxToolCallsPerRun: 20
- timeoutSeconds: 300

### Decision Rules

1. **Only change limits when needed**: Use defaults unless the user has specific requirements. Higher limits increase cost per run.
2. **Warn on high limits**: If the user requests limits significantly above defaults (e.g., tokenBudgetPerRun > 100000), confirm they understand the cost implications.
3. **Verify link exists**: Confirm the link ID and subaccount ID are valid before applying limits.
4. **Partial updates**: Only include fields that need to change. Omitted fields retain their current values.
