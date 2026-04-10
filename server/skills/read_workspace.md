---
name: Read Workspace
description: Read tasks and activities from the shared board.
isActive: true
visibility: basic
---

## Parameters

- status: string — Filter by board column status (e.g. "inbox", "todo", "assigned", "in_progress", "review", "done")
- assigned_to_me: boolean — If true, only return tasks assigned to you
- parent_task_id: string — Filter by parent task ID to retrieve all subtasks of a specific parent. Use this when evaluating whether all subtasks of a decomposed task are complete.
- task_id: string — Retrieve a single specific task by ID, including its full description and brief.
- limit: number — Maximum tasks to return (default 20)
- include_activities: boolean — If true, include recent activity log for each task (default false)

## Instructions

Check the board regularly to stay coordinated with the team. Use `assigned_to_me: true` to see your workload, and include activities only for tasks you plan to act on. Always read before writing to avoid duplicates.

### Phase 1: Orientation
At the start of every run, read the board without filters to understand the current state. Look at task distribution across columns, identify what has changed since your last run, and note any urgent or blocked items.

### Phase 2: Focused Queries
After orientation, use targeted filters:
- Filter by `assigned_to_me: true` to see your current workload.
- Filter by specific statuses to find tasks that need your attention (e.g. "inbox" for new items, "review" for items awaiting feedback).
- Include activities for tasks you plan to work on to understand their full history.

### Phase 3: Pattern Recognition
Look for patterns across the board:
- Tasks stuck in the same status for a long time may need escalation.
- Clusters of related tasks may indicate a larger initiative.
- Recent activity from other agents may inform your own work.

### Decision Rules
- **Read before writing**: Always check the board state before creating new tasks or updating existing ones, to avoid duplicates.
- **Limit scope**: Use the `limit` parameter to avoid pulling excessive data. Start with 20 tasks; only increase if needed.
- **Include activities sparingly**: Only request activities for tasks you intend to act on.
