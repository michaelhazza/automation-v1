---
name: Simulate playbook run
description: Static analysis pass over a candidate definition. Returns parallelism profile, critical path length, irreversible step count, and topological order. No execution.
isActive: true
visibility: none
---

```json
{
  "name": "playbook_simulate",
  "description": "Run static analysis over a candidate playbook definition. Returns the topological order of steps, max parallelism (the largest concurrent step count any tick will see), critical path length (longest chain through the DAG), and counts of irreversible / reversible / human-review steps. Use this to describe the run shape to the human admin in plain English before saving.",
  "input_schema": {
    "type": "object",
    "properties": {
      "definition": {
        "type": "object",
        "description": "The candidate playbook definition object."
      }
    },
    "required": ["definition"]
  }
}
```

## Instructions

Call after `playbook_validate` returns `{ ok: true }`. Use the result to summarise the playbook for the human admin in plain English before they save:

> "Here's what I have: 6 steps, max parallelism 2, critical path 4 steps, 1 irreversible step at the end. Sound right?"

Sets accurate expectations about run cost, duration, and risk before commit.
