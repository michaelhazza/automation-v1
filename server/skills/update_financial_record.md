---
name: Update Financial Record
description: Writes a financial record update (budget entry, forecast adjustment, or note) to the connected accounting system. Review-gated — requires human approval before execution.
isActive: true
visibility: none
---

## Parameters

- record_type: enum[budget_entry, forecast_adjustment, expense_note, revenue_note] (required) — Type of financial record to update
- record_id: string — ID of the record to update in the accounting system (if updating existing)
- record_description: string (required) — Human-readable description of what record is being updated — shown in the review item
- updates: string (required) — JSON object. Fields to write: amounts, notes, dates, category assignments
- period: string — The financial period this update applies to (e.g. '2026-Q1', '2026-03')
- reasoning: string (required) — Why this record is being updated — the analysis finding or instruction that triggered this. Shown to the reviewer.

## Instructions

Invoke this skill when `analyse_financials` produces a finding that requires a data correction or annotation in the accounting system, or when the Finance Agent has been explicitly instructed to update a budget or forecast.

This is a review-gated action. Financial record changes require human oversight — the reviewer sees the exact field changes and the reasoning before approving.

**MVP stub:** Accounting system write APIs not yet connected. On approval, logs the intended change and returns `pending_integration` status.

### Pre-Submission Rules

1. `updates` must contain at least one field with a concrete value — no placeholder updates
2. `reasoning` must reference the specific analysis finding or instruction that triggered this update
3. Never create new budget line items without explicit instruction — only annotate or adjust existing records unless `record_type` is `budget_entry` and the instruction is explicit

### Review Item Presentation

1. Record type and description
2. Period the update applies to
3. Field changes: what is being written
4. Reasoning: the finding or instruction

### On Approval

1. Write to accounting system (stub: log to task activity)
2. Return `{ success: true, record_type, record_id, fields_written: [list], message }`

### On Rejection

Return feedback to calling agent. Do not retry with the same values.
