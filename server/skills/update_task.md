---
name: Update Task
description: Update the content fields of an existing task — title, description, brief, or priority.
isActive: true
visibility: basic
---

## Parameters

- task_id: string (required) — The ID of the task to update
- title: string — Updated task title (optional)
- description: string — Updated description — visible in the task card. Keep concise.
- brief: string — Updated agent brief — the full self-contained instructions for the agent picking up this task. Replace, do not append.
- priority: enum[low, normal, high, urgent] — Updated priority (optional)
- reasoning: string (required) — Why you are updating this task — logged as an activity for team visibility.

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
