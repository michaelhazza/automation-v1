---
name: Write Spec
description: Submit a requirements spec to the HITL review queue for human approval. On approval, writes the spec to workspace memory and updates task status.
isActive: true
visibility: none
---

```json
{
  "name": "write_spec",
  "description": "Submit a requirements specification to the HITL review queue for human approval. This is a review-gated action — it enters the approval queue and does NOT execute immediately. A human must approve it before it becomes the authoritative spec. On approval, writes the spec to workspace_memories and updates the board task status to spec-approved.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "The board task ID this spec belongs to"
      },
      "spec_content": {
        "type": "string",
        "description": "The full requirements spec output from draft_requirements"
      },
      "user_stories_count": {
        "type": "number",
        "description": "Number of user stories in the spec"
      },
      "ac_count": {
        "type": "number",
        "description": "Total number of acceptance criteria across all stories"
      },
      "open_questions_count": {
        "type": "number",
        "description": "Number of open questions, broken down by risk level"
      },
      "has_high_risk_questions": {
        "type": "boolean",
        "description": "Whether the spec contains HIGH-risk open questions that may block implementation"
      },
      "reasoning": {
        "type": "string",
        "description": "Summary of the spec scope, key decisions made during drafting, and any assumptions. The human reviewer sees this alongside the spec."
      }
    },
    "required": ["task_id", "spec_content", "user_stories_count", "ac_count", "reasoning"]
  }
}
```

## Instructions

Invoke this skill after `draft_requirements` produces a complete spec. This is the mechanism that places the BA's work in front of a human before the Dev Agent or QA Agent can act on it. Structurally analogous to `write_patch` for the Dev Agent.

Do not invoke this skill if `draft_requirements` returned a `clarification_required` response — resolve the blocking questions via `ask_clarifying_question` first, then re-draft.

If the spec contains HIGH-risk open questions, set `has_high_risk_questions` to true. The review item should prominently flag this so the human can address them during review rather than discovering them downstream.

## Methodology

### Spec Reference ID

On submission, the system generates a stable spec reference ID in the format `SPEC-[task_id]-[version]` (e.g. `SPEC-task-42-v1`). This ID is used by:
- The Dev Agent to retrieve the approved spec from workspace memory
- The QA Agent to trace test cases back to the originating spec
- The `derive_test_cases` skill to link Gherkin ACs to test case IDs

If a spec is revised after rejection, the version increments (v2, v3). Maximum 3 revision rounds before escalating via `request_approval`.

### Review Item Presentation

The review item must present the full spec in a human-readable format:

1. **Summary header**: task reference, story count, AC count, open question count
2. **User stories**: each story with its Gherkin ACs, formatted for readability
3. **Open questions**: prominently displayed if HIGH-risk questions exist
4. **Definition of Done**: the complete checklist
5. **Traceability map**: brief excerpt → story mapping
6. **BA reasoning**: the `reasoning` field, so the reviewer understands the drafting decisions

### Pre-Submission Checklist

Before submitting:
1. `draft_requirements` output is complete (not a `clarification_required` response)
2. All AC IDs are in stable `AC-X.Y` format
3. `user_stories_count` and `ac_count` match the actual content
4. `reasoning` explains scope decisions and assumptions — the reviewer should not need to guess why something was included or excluded
5. No duplicate spec submission for the same task (check workspace memory for existing `SPEC-[task_id]` entries)

### On Approval

When the human approves the spec:
1. Write the full spec to `workspace_memories` under the spec reference ID
2. Update the board task status to `spec-approved`
3. Attach the spec as a deliverable on the board task via `add_deliverable`
4. The spec is now retrievable by the Dev Agent and QA Agent

### On Rejection

When the human rejects the spec:
1. Read the rejection feedback
2. Re-invoke `draft_requirements` with the feedback incorporated
3. Submit a revised spec with an incremented version number
4. If rejected twice for the same task, escalate via `request_approval` with the rejection history

### Idempotency

Before submitting, check workspace memory for an existing spec submission for this task:
- If a pending (unapproved) spec exists for this task, do not submit a duplicate — update the existing submission instead
- If an approved spec exists and you are submitting a revision, increment the version number and note the revision reason
