---
name: Review UX
description: Performs a UX review pass on tasks that produce user-facing UI changes. Catches UX issues before they reach the codebase.
isActive: true
---

```json
{
  "name": "review_ux",
  "description": "Perform a UX review on a task with user-facing UI changes. Starts with the user's job-to-be-done, surfaces assumptions, and produces findings ranked by priority. Invoke after architecture planning and before implementation on any UI-affecting task.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_description": {
        "type": "string",
        "description": "Board task title and full description"
      },
      "ba_spec_reference": {
        "type": "string",
        "description": "The BA requirements spec and Gherkin ACs"
      },
      "architecture_plan": {
        "type": "string",
        "description": "The architecture plan, specifically the UI-touching chunks"
      },
      "tech_stack": {
        "type": "string",
        "description": "Frontend framework, component library, and design conventions from workspace memory"
      },
      "ui_description": {
        "type": "string",
        "description": "Description of the UI changes being made — screens, flows, components"
      }
    },
    "required": ["task_description", "ba_spec_reference", "architecture_plan", "tech_stack", "ui_description"]
  }
}
```

## Instructions

Invoke this skill on any task that produces user-facing UI changes: new screens, modified flows, new forms, modals, or interactive components. Skip for API-only changes, backend bug fixes, or documentation-only changes. If uncertain, invoke — the cost of an unnecessary UX review is low.

Read the findings and apply high-priority items before proceeding to implementation. Note unresolved UX findings for the human reviewer in the patch submission.

## Methodology

### Step 0: Job-to-be-Done (always do this first)

1. What is the user's core problem? State it in user language, not system language.
2. What decision does the user need to make on this screen or in this flow?
3. What is the user's mental model of this domain?
4. Does the proposed UI match that mental model? If misaligned, flag as HIGH PRIORITY.

### Step 1: Surface Assumptions

List 3-5 assumptions the proposed UI makes about the user. For each:
- State the assumption
- Assess it: VALIDATED / UNVALIDATED / CONTRADICTED
- State what breaks if the assumption is false

### Step 2: Findings

**High Priority (must address before implementation):**
- Mental model mismatch between UI and user
- Missing empty, loading, or error states
- Interactions that do not give feedback
- Destructive actions without confirmation
- System-model leakage (internal concept names in user-facing UI)
- Mobile-hostile layouts or inadequate touch targets
- Missing accessibility basics (unlabelled inputs, poor contrast, no keyboard support)

**Medium Priority (should address, does not block):**
- Copy that uses system language instead of user language
- Missing edge case handling (zero results, boundary values, concurrent mutations)
- Inconsistency with patterns elsewhere in the product
- Improvement opportunities in progressive disclosure

**Low Priority (consider for future iteration):**
- Minor polish, wording preferences, subtle improvements

### Step 3: Accessibility Notes

WCAG compliance issues, keyboard navigation, screen reader considerations, colour contrast for value indicators, focus management.

### Step 4: Copy and Micro-interactions

Wording improvements using user domain language. Feedback timing, confirmation patterns for destructive actions, empty and error state messaging.

### Step 5: Mobile Considerations

Touch target adequacy, layout at small viewport, mobile-first concerns.

### Output Format

```
# UX Review
**Task:** [task reference and title]
**Date:** [ISO date]

## Step 0: Job-to-be-Done
**User's core problem:** [in user language]
**Decision the UI helps the user make:** [specific]
**User's mental model:** [how the user thinks about this domain]
**Mental model match:** [ALIGNED | MISALIGNED]

## Assumptions Surfaced
[3-5 assumptions, each with Status and Risk if wrong]

## Findings
### High Priority
### Medium Priority
### Low Priority

## Accessibility Notes
## Copy and Micro-interactions
## Mobile Considerations

## Scope Recommendation
**Ship now:** [minimum lovable]
**Polish later:** [deferrable items]

## Review Verdict
[UX-APPROVED | NEEDS-CHANGES — list specific items if NEEDS-CHANGES]
```
