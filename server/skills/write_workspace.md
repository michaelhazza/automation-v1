---
name: Write Workspace
description: Add an activity entry to a task.
isActive: true
visibility: basic
---

## Parameters

- task_id: string (required) — The ID of the task to add an activity to
- activity_type: string (required) — Type of activity: "progress", "note", "completed", "blocked"
- message: string (required) — The activity message content

## Instructions

Always log your progress and findings to tasks so other agents and the team can see what you have done. Be specific and actionable — include data and evidence, not just conclusions. Log one activity per logical step, not a single batch at the end.

### When to Write
- **Progress**: Log meaningful progress updates as you work, not just at the end.
- **Findings**: When you discover something relevant to a task, log it immediately.
- **Blockers**: If you cannot complete something, log a "blocked" activity explaining why.
- **Completion**: Always log a "completed" activity with a summary before moving a task to review/done.

### Quality Standards
- Be specific and actionable. Include data and evidence, not just conclusions.
- Write for your team — assume the reader has context on the task but not on what you just did.

### Decision Rules
- **One activity per logical step**: Do not batch everything into a single activity at the end.
- **Do not duplicate**: Check existing activities before writing.
- **Link to deliverables**: If your work produced an output, add a deliverable instead of pasting content into an activity message.
