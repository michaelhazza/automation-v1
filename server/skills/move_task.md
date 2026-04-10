---
name: Move Task
description: Move a task to a different board column.
isActive: true
visibility: basic
---

## Parameters

- task_id: string (required) — The ID of the task to move
- status: string (required) — The target column: "todo", "assigned", "in_progress", "review", "acceptance", "done"

## Instructions

Move tasks through the board as you work on them. Move to "in_progress" when starting, "review" when done. Always log a progress activity before moving a task to the next status.

### Status Transitions
- **inbox → todo**: Task triaged and ready to plan.
- **todo → assigned**: Task assigned to an agent.
- **assigned → in_progress**: Agent started working.
- **in_progress → review**: Work complete, ready for human review.
- **review → acceptance**: Human approved, pending final sign-off.
- **acceptance → done**: Task fully completed.

### Decision Rules
- **Always log before moving**: Write a progress activity before moving to the next status.
- **Do not skip statuses**: Follow the workflow order.
- **Move to "review" only when there is a deliverable**.
