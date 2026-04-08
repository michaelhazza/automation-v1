---
name: Create Task
description: Create a new task (card) on the workspace board.
isActive: true
visibility: basic
---

```json
{
  "name": "create_task",
  "description": "Create a new task (board card). Use this when you identify new work that needs to be done, or when you want to assign a task to another agent.",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Short title for the work item" },
      "description": { "type": "string", "description": "Detailed description of what needs to be done" },
      "brief": { "type": "string", "description": "Brief/instructions for the assigned agent" },
      "priority": { "type": "string", "description": "Priority level: \"low\", \"normal\", \"high\", \"urgent\" (default: \"normal\")" },
      "status": { "type": "string", "description": "Initial board column: \"inbox\", \"todo\", \"assigned\" (default: \"inbox\")" },
      "assigned_agent_id": { "type": "string", "description": "ID of the agent to assign this work to (optional)" }
    },
    "required": ["title"]
  }
}
```

## Instructions

Check for duplicates before creating a task. Each task should have a single clear outcome. If you know which agent should handle a task, assign it and include a detailed brief so the agent can start with no additional context.

## Methodology

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
