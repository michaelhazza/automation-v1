---
name: Propose Doc Update
description: Proposes a specific change to an existing documentation page — a diff-style proposal showing what would change and why. Review-gated — requires human approval before any documentation is modified.
isActive: true
visibility: none
---

```json
{
  "name": "propose_doc_update",
  "description": "Propose a specific change to an existing documentation page. Returns a diff-style proposal showing what would change and why. Review-gated — a human must approve before write_docs is invoked to apply the change.",
  "input_schema": {
    "type": "object",
    "properties": {
      "page_id": {
        "type": "string",
        "description": "The ID of the documentation page to update"
      },
      "page_title": {
        "type": "string",
        "description": "Human-readable page title — shown in the review item"
      },
      "current_content": {
        "type": "string",
        "description": "The current page content from read_docs — required to produce a meaningful diff"
      },
      "proposed_changes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "section": { "type": "string" },
            "current_text": { "type": "string" },
            "proposed_text": { "type": "string" },
            "change_reason": { "type": "string" }
          }
        },
        "description": "List of specific changes: each with the section, current text, proposed text, and reason"
      },
      "change_type": {
        "type": "string",
        "enum": ["correction", "update", "addition", "removal", "restructure"],
        "description": "The type of change being proposed"
      },
      "reasoning": {
        "type": "string",
        "description": "Why this update is needed — the trigger (stale info, new feature, user feedback). Shown to the reviewer."
      }
    },
    "required": ["page_title", "current_content", "proposed_changes", "change_type", "reasoning"]
  }
}
```

## Instructions

Invoke this skill after `read_docs` to propose a documentation change. The proposal enters the HITL approval queue. On approval, `write_docs` applies the change.

Never propose a doc update without first reading the current content via `read_docs`. Proposing changes to content you haven't read risks introducing conflicts or overwriting accurate information.

This is a review-gated action. The reviewer sees the full diff (current vs proposed) for each changed section.

## Methodology

### Pre-Submission Rules

1. `current_content` must be populated from `read_docs` output — do not use inferred or recalled content
2. Each change in `proposed_changes` must have a specific `change_reason`
3. Do not propose changes to sections that were not specifically flagged as needing updates
4. `removal` changes require explicit justification — why this content should no longer exist

### Review Item Presentation

For each change in `proposed_changes`:
- Section heading
- Current text (shown in full if < 200 chars, truncated with option to expand if longer)
- Proposed text
- Change reason

Plus: overall change type and reasoning.

### On Approval

Signal to the calling agent to invoke `write_docs` with the approved changes.
Return `{ success: true, page_id, page_title, changes_approved: count, message }`.

### On Rejection

Read the feedback. If specific sections were rejected, revert those changes and re-propose only the approved sections. Do not re-submit the full proposal unchanged.
