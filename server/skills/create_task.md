---
name: Create Task
description: Create a new task (card) on the workspace board.
isActive: true
visibility: basic
---

## Parameters

- title: string (required) — Short title for the work item
- description: string — Detailed description of what needs to be done
- brief: string — Brief/instructions for the assigned agent
- priority: string — Priority level: "low", "normal", "high", "urgent" (default: "normal")
- status: string — Initial board column: "inbox", "todo", "assigned" (default: "inbox")
- assigned_agent_id: string — ID of the agent to assign this work to (optional)

## Instructions

Check for duplicates before creating a task. Each task should have a single clear outcome. If you know which agent should handle a task, assign it and include a detailed brief so the agent can start with no additional context.

### Task Quality Checklist
1. **Clear title**: Short, specific, action-oriented.
2. **Actionable description**: What needs to be done, expected output, and constraints.
3. **Correct priority**: Use "urgent" only for time-sensitive items with real deadlines.
4. **Appropriate status**: Use "inbox" for unassigned, "assigned" if assigning to an agent, "todo" if planned but unassigned.

### Decision Rules
- **Check for duplicates first**: Always read the workspace before creating a task.
- **One task per deliverable**: Each task should have a single clear outcome.
- **Assign when possible**: If you know which agent should handle a task, assign it.
- **Include a brief for assigned tasks**: The brief gives the assigned agent its instructions.
