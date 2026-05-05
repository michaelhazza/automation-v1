---
name: Import n8n workflow
description: Parses an n8n workflow JSON export and produces a draft Synthetos workflow definition with a mapping report. The admin reviews, edits, and saves via the existing Workflow Studio save-and-PR flow.
isActive: true
visibility: basic
---

## Parameters

- workflow_json: string (required) — The raw n8n workflow JSON (paste the full exported JSON string). Must be 100 nodes or fewer.

## Instructions

Use this skill when an admin wants to migrate an existing n8n workflow into Synthetos.

Steps you must follow:
1. Call this tool with the full `workflow_json` string.
2. Read the mapping report carefully. **Any row with ⚠ is a `high`-severity item** that must be resolved before you call `workflow_propose_save`.
3. For `high`-severity rows (disconnected nodes, unconvertible code/function nodes): explain what the admin must do. Do not proceed past this step until the admin confirms each high-severity item is either resolved or explicitly dismissed.
4. For `medium`-confidence rows: surface them to the admin for a quick review pass.
5. Run `workflow_validate` on the returned draft definition to confirm it passes schema validation.
6. Surface the credential checklist to the admin — they must re-authenticate each connector via Synthetos's OAuth flows before the workflow can run. No credentials are imported.
7. Once the admin has reviewed the report, confirmed all high-severity items, and approved the draft, proceed with `workflow_simulate`, `workflow_estimate_cost`, then `workflow_propose_save`.

**Never call `workflow_propose_save` while any unacknowledged `high`-severity items remain in the import session.**

## Output

```json
{
  "workflowName": "My Workflow",
  "steps": [...],
  "report": "...",
  "credentialChecklist": [...]
}
```

Where `report` is a Markdown table showing: n8n node → mapped step → confidence → action required → notes.
