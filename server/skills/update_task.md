---
name: Update Task
description: Update the content fields of an existing task — title, description, brief, or priority.
isActive: true
visibility: basic
---

```json
{
  "name": "update_task",
  "description": "Update the content of an existing task: its title, description, brief, or priority. Use this to add handoff notes, refine requirements, or update priority as work progresses. Does NOT change status or assignment — use move_task and reassign_task for those.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string", "description": "The ID of the task to update" },
      "title": { "type": "string", "description": "Updated task title (optional)" },
      "description": { "type": "string", "description": "Updated description — visible in the task card. Keep concise." },
      "brief": { "type": "string", "description": "Updated agent brief — the full self-contained instructions for the agent picking up this task. Replace, do not append." },
      "priority": { "type": "string", "enum": ["low", "normal", "high", "urgent"], "description": "Updated priority (optional)" },
      "reasoning": { "type": "string", "description": "Why you are updating this task — logged as an activity for team visibility." }
    },
    "required": ["task_id", "reasoning"]
  }
}
```

## Instructions

Use `update_task` when the task's content needs to change — not its status or owner. Common use cases:

- **Dev → QA handoff**: update `brief` with the QA handoff JSON (changedAreas, patchSummary, Gherkin ACs covered)
- **Orchestrator decomposition**: update a parent task's `description` to reflect the current subtask breakdown and progress
- **BA spec refinement**: update `brief` after a spec revision is approved, so Dev picks up the latest version
- **Priority escalation**: update `priority` to `urgent` when a blocker is confirmed

Always include a `reasoning` field — it is logged as a task activity so the team can see why the update was made.

## Decision Rules

- Never update a task's `brief` during another agent's in-progress run on that task — wait for their run to complete
- Update `description` for human-readable context, `brief` for agent-actionable instructions
- If updating after a human approval event, reference the approval in `reasoning`
