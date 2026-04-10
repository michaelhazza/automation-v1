---
name: Trigger Process
description: Trigger an automation process/workflow.
isActive: true
visibility: basic
---

## Parameters

- task_id: string (required) — The ID of the process to trigger
- process_name: string (required) — The human-readable name of the process
- input_data: string (required) — JSON string of input data to pass to the task.
- reason: string (required) — Brief explanation of why you are triggering this task

## Instructions

Trigger automation processes when the task requires it. Confirm the process is the right one, validate your input data, and document your reasoning. Never trigger the same process twice for the same reason.

### Before Triggering
1. Confirm the process is the right one. Read the name and description carefully.
2. Validate your input data matches what the process expects.
3. Document your reasoning in the reason field.

### Decision Rules
- **Trigger only when justified**: Each process has real-world effects.
- **One trigger per intent**: Do not trigger the same process multiple times for the same reason.
- **Check workspace first**: Before triggering, check if another agent has already triggered this recently.
