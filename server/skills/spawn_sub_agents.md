---
name: Spawn Sub-Agents
description: Split work into 2-3 parallel sub-tasks executed by agents simultaneously.
isActive: true
visibility: basic
---

```json
{
  "name": "spawn_sub_agents",
  "description": "Split work into 2-3 parallel sub-tasks executed by agents simultaneously. Each sub-task gets its own task card and runs in parallel.",
  "input_schema": {
    "type": "object",
    "properties": {
      "sub_tasks": {
        "type": "array",
        "description": "Array of 2-3 sub-tasks to execute in parallel",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "description": "Sub-task title" },
            "brief": { "type": "string", "description": "Detailed instructions for the sub-agent" },
            "assigned_agent_id": { "type": "string", "description": "Agent ID from your team roster" }
          },
          "required": ["title", "brief", "assigned_agent_id"]
        }
      }
    },
    "required": ["sub_tasks"]
  }
}
```

## Instructions

Use spawn_sub_agents when work involves multiple independent parallel tracks. Make each brief self-contained with all necessary background, expected output format, and clear scope boundaries. Do not spawn for sequential or dependent work — use reassign_task instead.

## Methodology

### When to Spawn
- Task involves researching multiple independent topics.
- Parallel execution would save significant time.
- Each sub-task is self-contained with no dependency on siblings.

### When NOT to Spawn
- Sub-tasks depend on each other — use sequential reassignment.
- Fewer than 2 distinct parallel tracks — just do the work yourself.
- The total scope is small enough for a single agent run.

### Writing Good Sub-Task Briefs
Make each brief self-contained with all necessary background, expected output format, and clear scope boundaries. Each agent should be able to start immediately with no additional context.
