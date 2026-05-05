---
name: Spawn Sub-Agents
description: Split work into 2-3 parallel sub-tasks executed by agents simultaneously.
isActive: true
visibility: none
---

## Parameters

- sub_tasks: string (required) — JSON array of objects, each with keys: "title" (string), "brief" (string), "assigned_agent_id" (string). Array of 2-3 sub-tasks to execute in parallel
- delegationScope: string (optional) — Delegation scope: `children` | `descendants`. Default: adaptive (children if you have direct reports, descendants otherwise). `subaccount` is not accepted for spawn. Use this to route tasks within your own team; for cross-team work use `reassign_task`.

## Instructions

Use spawn_sub_agents when work involves multiple independent parallel tracks. Make each brief self-contained with all necessary background, expected output format, and clear scope boundaries. Do not spawn for sequential or dependent work — use reassign_task instead.

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
