---
name: Write Docs
description: Applies an approved documentation update to the connected documentation system. Review-gated — requires human approval before any content is written.
isActive: true
visibility: none
---

## Parameters

- page_id: string — The ID of the documentation page to update
- page_title: string (required) — Human-readable page title — shown in the review item
- full_updated_content: string (required) — The complete updated page content — the result of applying all approved changes from propose_doc_update
- change_summary: string (required) — Brief summary of what changed (e.g. 'Updated API endpoint in Step 3, removed deprecated warning')
- source_proposal_id: string — The ID of the propose_doc_update action that was approved — for traceability
- reasoning: string (required) — Why this update is being applied — should reference the approved proposal. Shown to the reviewer.

## Instructions

Invoke this skill only after `propose_doc_update` has been approved. The `full_updated_content` must be the result of applying the approved changes to the current page content from `read_docs`.

This is a review-gated action. This is the second approval gate in the documentation update workflow (propose → approve → write → approve → live). Both gates are required.

**MVP stub:** Documentation write APIs not yet connected. On approval, logs the update record and returns `pending_integration` status.

### Pre-Submission Rules

1. `full_updated_content` must represent the complete page after applying changes — not just the changed sections
2. `source_proposal_id` should reference the approved `propose_doc_update` action
3. Never overwrite content that was not part of the approved proposal — if uncertain, re-read the page via `read_docs` first

### Review Item Presentation

1. Page title
2. Change summary
3. Full updated content (for final verification)
4. Source proposal reference
5. Reasoning

### On Approval

1. Write content to documentation system (stub: log to task activity)
2. Return `{ success: true, page_id, page_title, status: 'pending_integration', message }`
3. Log the write in workspace memory so future `read_docs` calls can reference this update date

### On Rejection

Do not modify the page. Return feedback to the calling agent — if the content needs further changes, the full workflow (read → propose → write) must restart.
