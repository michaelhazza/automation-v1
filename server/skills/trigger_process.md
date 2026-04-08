---
name: Trigger Process
description: Trigger an automation process/workflow.
isActive: true
visibility: basic
---

```json
{
  "name": "trigger_process",
  "description": "Trigger an automation process/workflow. Use this when you need to execute a specific automation.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string", "description": "The ID of the process to trigger" },
      "process_name": { "type": "string", "description": "The human-readable name of the process" },
      "input_data": { "type": "string", "description": "JSON string of input data to pass to the task." },
      "reason": { "type": "string", "description": "Brief explanation of why you are triggering this task" }
    },
    "required": ["task_id", "process_name", "input_data", "reason"]
  }
}
```

## Instructions

Trigger automation processes when the task requires it. Confirm the process is the right one, validate your input data, and document your reasoning. Never trigger the same process twice for the same reason.

## Methodology

### Before Triggering
1. Confirm the process is the right one. Read the name and description carefully.
2. Validate your input data matches what the process expects.
3. Document your reasoning in the reason field.

### Decision Rules
- **Trigger only when justified**: Each process has real-world effects.
- **One trigger per intent**: Do not trigger the same process multiple times for the same reason.
- **Check workspace first**: Before triggering, check if another agent has already triggered this recently.
