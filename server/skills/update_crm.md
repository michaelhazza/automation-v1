---
name: Update CRM
description: Writes contact or deal updates to the connected CRM. Review-gated — requires human approval before any data is written.
isActive: true
visibility: none
---

```json
{
  "name": "update_crm",
  "description": "Write contact or deal updates to the connected CRM. This is a review-gated action — it enters the approval queue and does NOT execute immediately. A human must approve before any CRM data is modified.",
  "input_schema": {
    "type": "object",
    "properties": {
      "record_type": {
        "type": "string",
        "enum": ["contact", "deal", "company"],
        "description": "The type of CRM record to update"
      },
      "record_id": {
        "type": "string",
        "description": "The CRM record ID to update"
      },
      "record_identifier": {
        "type": "string",
        "description": "Human-readable identifier (email, deal name, company name) — shown in the review item"
      },
      "updates": {
        "type": "object",
        "description": "Key-value pairs of CRM fields to update. Keys are CRM field names, values are the new values.",
        "additionalProperties": true
      },
      "update_reason": {
        "type": "string",
        "description": "Why these fields are being updated — the agent action or signal that triggered this update"
      },
      "reasoning": {
        "type": "string",
        "description": "Full reasoning for the update — shown to the human reviewer alongside the field changes"
      }
    },
    "required": ["record_type", "record_id", "record_identifier", "updates", "update_reason", "reasoning"]
  }
}
```

## Instructions

Invoke this skill when the Email Outreach Agent needs to update CRM records after an outreach action — e.g. marking a contact as contacted, updating a deal stage, or logging a response.

This is a review-gated action. The reviewer sees the exact field changes before they are applied. Show the before/after for each field in the review item.

**MVP stub:** CRM write APIs not yet connected. On approval, logs the intended changes and returns `pending_integration` status.

Never write sensitive or inferred data to the CRM without explicit user instruction. Enrichment data that was written via `enrich_contact` does not need a separate `update_crm` call — that write is handled by the enrichment skill directly.

## Methodology

### Pre-Submission Rules

1. `updates` must contain at least one field
2. Do not update fields that would overwrite manually entered data with inferred values — flag these in `reasoning`
3. Deal stage changes (e.g. moving from `prospect` to `qualified`) require clear triggering evidence in `update_reason`

### Review Item Presentation

For each field in `updates`:
- Field name
- Current value (if known) → Proposed value
- Why this field is changing

Plus: record type, record identifier, update reason, full reasoning.

### On Approval

1. Write updates to CRM via integration (stub: log to task activity)
2. Return `{ success: true, record_type, record_id, fields_updated: [list], message }`

### On Rejection

Return feedback to calling agent. Do not retry the same field updates without incorporating the feedback.
