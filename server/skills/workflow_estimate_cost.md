---
name: Estimate Workflow cost
description: Pessimistic cost estimate for a candidate Workflow. Defaults to pessimistic mode (max tokens, all branches, worst-case retries) per spec round 7.
isActive: true
visibility: none
---

## Parameters

- definition: string (required) — JSON object.
- mode: enum[optimistic, pessimistic] — Default 'pessimistic'.

## Instructions

Call after `workflow_simulate` so you know the topology, then call this with `mode: 'pessimistic'` (the default). Surface the dollar amount to the human admin before saving. Example phrasing:

> "Pessimistic cost estimate is $0.85 per run. The biggest contributors are the 3 agent_call steps at the start. Want me to proceed?"
