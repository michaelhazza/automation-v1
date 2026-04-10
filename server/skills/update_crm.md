---
name: Update CRM
description: Writes contact or deal updates to the connected CRM. Review-gated — requires human approval before any data is written.
isActive: true
visibility: none
---

## Parameters

- record_type: enum[contact, deal, company] (required) — The type of CRM record to update
- record_id: string (required) — The CRM record ID to update
- record_identifier: string (required) — Human-readable identifier (email, deal name, company name) — shown in the review item
- updates: string (required) — JSON object. Key-value pairs of CRM fields to update. Keys are CRM field names, values are the new values.
- update_reason: string (required) — Why these fields are being updated — the agent action or signal that triggered this update
- reasoning: string (required) — Full reasoning for the update — shown to the human reviewer alongside the field changes

## Instructions

Invoke this skill when the Email Outreach Agent needs to update CRM records after an outreach action — e.g. marking a contact as contacted, updating a deal stage, or logging a response.

This is a review-gated action. The reviewer sees the exact field changes before they are applied. Show the before/after for each field in the review item.

**MVP stub:** CRM write APIs not yet connected. On approval, logs the intended changes and returns `pending_integration` status.

Never write sensitive or inferred data to the CRM without explicit user instruction. Enrichment data that was written via `enrich_contact` does not need a separate `update_crm` call — that write is handled by the enrichment skill directly.

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
