---
name: Review Code
description: Structured self-review on all changed files before submitting a patch to the HITL review queue. Catches blocking issues before they reach the human reviewer.
isActive: true
visibility: basic
---

```json
{
  "name": "review_code",
  "description": "Perform a structured self-review on all changed files before submitting a patch. Checks for SOLID violations, security issues, correctness bugs, convention violations, architecture plan compliance, and Gherkin AC coverage. Always invoke before write_patch.",
  "input_schema": {
    "type": "object",
    "properties": {
      "changed_files": {
        "type": "string",
        "description": "All files modified or created during implementation, with their content or diffs"
      },
      "architecture_plan": {
        "type": "string",
        "description": "The architecture plan the implementation was supposed to follow"
      },
      "ba_spec_reference": {
        "type": "string",
        "description": "The BA requirements spec for checking AC coverage. Omit if not available."
      },
      "gherkin_acs": {
        "type": "string",
        "description": "Gherkin acceptance criteria to verify coverage against. Omit if not available."
      },
      "tech_stack": {
        "type": "string",
        "description": "Framework conventions, error handling patterns, auth middleware, test conventions"
      },
      "ux_review_findings": {
        "type": "string",
        "description": "UX review findings to verify were addressed. Omit if no UX review was performed."
      }
    },
    "required": ["changed_files", "architecture_plan", "tech_stack"]
  }
}
```

## Instructions

Always invoke this skill before submitting any patch via `write_patch`. No patch is submitted without a self-review pass. If the verdict is BLOCKED, fix blocking issues and re-invoke. Maximum 3 self-review iterations before escalating to human.

The self-review report is included in the patch submission so the human reviewer sees the diff, the architecture plan, and the self-review findings in one place.

## Methodology

### Blocking Issues (must fix before submitting)

**SOLID Principle Violations:**
- Single Responsibility: a module, class, or function doing more than one thing
- Open/Closed: behaviour added by modifying working code instead of extending it
- Liskov Substitution: implementation that does not honour its interface contract
- Interface Segregation: an interface forcing callers to depend on methods they do not use
- Dependency Inversion: a high-level module depending directly on a concrete implementation

**Security Issues:**
- Missing authentication or authorisation checks on protected routes
- Missing user-scope isolation (a user being able to access another user's data)
- SQL injection or query construction from user input
- Sensitive data logged or exposed in responses
- Direct database access bypassing the defined abstraction layer

**Correctness Bugs:**
- Logic errors in conditionals or calculations
- Unhandled error cases in async operations
- Race conditions in concurrent state mutations
- Broken interface contracts (wrong return type, missing required fields)

**Convention Violations:**
- Missing try/catch in async route handlers (or missing asyncHandler wrapper)
- Wrong HTTP status codes for error responses
- Missing error response body shape
- Incorrect auth middleware usage

### Strong Recommendations (note but do not block)

- Missing test coverage — describe each missing test in Given/When/Then format
- Design pattern opportunity that would genuinely simplify the code

### Non-Blocking Notes (for human reviewer)

- Readability improvements, naming suggestions, minor inconsistencies
- The human decides whether to act on these

### Architecture Compliance

Verify the implementation followed the architecture plan chunk by chunk. Document any deviations with reasons.

### Gherkin AC Coverage

For each acceptance criterion in the BA spec, assess:
- COVERED: implementation fully supports the AC
- PARTIALLY COVERED: some aspects missing
- NOT COVERED: not implemented — explain why

### UX Findings Addressed

If a UX review was performed, confirm each high-priority finding was addressed or document why it was not applied.

### Output Format

```
# Code Self-Review
**Task:** [task reference and title]
**Date:** [ISO date]
**Files reviewed:** [list of all changed files]

## Blocking Issues
[If none: "No blocking issues found."]
[For each: File, Issue (name the principle/concern), Fix (concrete change)]

## Strong Recommendations
[Each: file, issue, recommendation]

## Non-Blocking Notes
[Informational items for human reviewer]

## Architecture Plan Compliance
**Deviations from plan:** [list with reasons]
**Plan gaps encountered:** [any gaps handled during implementation]

## Gherkin AC Coverage
[For each AC: summary, COVERED|PARTIALLY COVERED|NOT COVERED, notes]

## UX Findings Addressed
[If applicable: each finding and confirmation]

## Verdict
[APPROVE — no blocking issues, ready for human review]
[BLOCKED — N blocking issues listed above, fixing before resubmitting]
```
