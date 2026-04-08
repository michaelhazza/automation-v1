---
name: Estimate playbook cost
description: Pessimistic cost estimate for a candidate playbook. Defaults to pessimistic mode (max tokens, all branches, worst-case retries) per spec round 7.
isActive: true
visibility: none
---

```json
{
  "name": "playbook_estimate_cost",
  "description": "Estimate the cost of a playbook run in cents. Defaults to mode='pessimistic' which assumes max-token output per LLM step and all conditional branches taken — this is what you should surface to the human admin so they don't get unpleasant surprises in production. Pass mode='optimistic' for a separate best-case comparison number.",
  "input_schema": {
    "type": "object",
    "properties": {
      "definition": { "type": "object" },
      "mode": {
        "type": "string",
        "enum": ["optimistic", "pessimistic"],
        "description": "Default 'pessimistic'."
      }
    },
    "required": ["definition"]
  }
}
```

## Instructions

Call after `playbook_simulate` so you know the topology, then call this with `mode: 'pessimistic'` (the default). Surface the dollar amount to the human admin before saving. Example phrasing:

> "Pessimistic cost estimate is $0.85 per run. The biggest contributors are the 3 agent_call steps at the start. Want me to proceed?"
