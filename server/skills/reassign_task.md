---
name: Reassign Task
description: Reassign an existing task to another agent.
isActive: true
visibility: basic
---

## Parameters

- task_id: string (required) — ID of the task to reassign
- assigned_agent_id: string (required) — ID of the agent to assign the task to
- handoff_context: string — Context for the next agent — what you did, what they should do next

## Instructions

You can reassign tasks to other agents on your team. Always provide handoff context describing what you did, key findings, and what the next agent should do. Only reassign when you need a different specialist to continue; log blockers instead of reassigning when stuck.

### When to Reassign
- You completed work within your expertise and a different specialist should continue.
- The task explicitly calls for a multi-agent workflow.

### When NOT to Reassign
- You can complete the entire task yourself.
- You're stuck — log the blocker instead.

### Handoff Context Quality
Always include: what you did, key findings, what to do next, where you left off.
