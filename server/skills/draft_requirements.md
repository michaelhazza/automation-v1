---
name: Draft Requirements
description: Produces a structured requirements spec from a board task brief. Outputs user stories in INVEST format, Gherkin acceptance criteria, open questions, and a Definition of Done checklist.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_requirements",
  "description": "Produce a structured requirements specification from a board task brief. Outputs user stories in INVEST format, Gherkin acceptance criteria with Given/When/Then blocks (including negative scenarios), a ranked list of open questions, and a Definition of Done checklist. If the brief is too ambiguous to spec, returns a structured clarification-required response instead.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "The board task ID this spec is being drafted for"
      },
      "task_brief": {
        "type": "string",
        "description": "The full board task title, description, and any attached context"
      },
      "workspace_context": {
        "type": "string",
        "description": "Relevant workspace memory entries: active directives, domain constraints, prior specs for related features"
      },
      "codebase_context": {
        "type": "string",
        "description": "Relevant codebase patterns, existing API contracts, or schema structures that constrain the requirements. Omit if not applicable."
      }
    },
    "required": ["task_id", "task_brief"]
  }
}
```

## Instructions

Invoke this skill when a board task needs a formal requirements spec before development can begin. The output is a structured object that the downstream `write_spec` skill packages into the HITL review queue — do not produce free text.

If the brief is too ambiguous to produce a complete spec, do not generate an incomplete spec. Instead, return a `clarification_required` response listing the blocking questions with risk rankings. Use `ask_clarifying_question` to surface those questions formally.

Every acceptance criterion must be traceable to the brief input. Do not invent requirements that are not implied by the brief. If a requirement seems necessary but is not stated, list it as an open question rather than including it as an AC.

## Methodology

### Input Analysis

Before drafting, assess the brief for completeness:
1. Is the problem statement clear enough to derive user stories?
2. Are the affected user roles identifiable?
3. Are the success criteria implied or stated?
4. Are there constraints (technical, business, regulatory) mentioned?

If any of these are unresolvable from the brief + workspace context, trigger the clarification path.

### User Story Format (INVEST)

Each user story must satisfy INVEST criteria:
- **Independent**: can be developed without depending on another story in this spec
- **Negotiable**: expresses intent, not implementation
- **Valuable**: delivers clear value to the identified user role
- **Estimable**: scoped enough that the Dev Agent can plan implementation
- **Small**: achievable in a single development cycle
- **Testable**: every story has at least one Gherkin AC that can be verified

Format:
```
As a [role], I want [capability] so that [benefit].
```

### Gherkin Acceptance Criteria

Each user story must have at least two Gherkin ACs: one positive (happy path) and one negative (error/edge case).

Format:
```
AC-[story_number].[ac_number]: [short description]

Given [precondition]
When [action]
Then [expected outcome]
```

Rules:
- Each AC has a stable ID in the format `AC-X.Y` (story number . AC number)
- Given/When/Then blocks must be specific enough for the QA Agent to derive test cases
- Negative scenarios test boundary conditions, invalid inputs, unauthorised access, and error states
- Do not combine multiple assertions in a single Then block — split into separate ACs
- If a scenario involves state changes, include a verification step in the Then block

### Open Questions

Rank each question by risk level:
- **HIGH**: blocks implementation — the spec cannot be built without resolution
- **MEDIUM**: can be resolved post-build with minor rework
- **LOW**: edge case that can be deferred without affecting the core spec

### Output Format

```
REQUIREMENTS SPEC
Task: [task_id]
Title: [task title from brief]
Date: [ISO date]
Status: draft

## User Stories

### Story 1: [short name]
As a [role], I want [capability] so that [benefit].

**Acceptance Criteria:**

AC-1.1: [description]
Given [precondition]
When [action]
Then [expected outcome]

AC-1.2: [negative scenario description]
Given [precondition]
When [invalid action or boundary condition]
Then [error handling or rejection behaviour]

### Story 2: [short name]
...

## Open Questions
1. [HIGH] [question] — blocks: [which story/AC is affected]
2. [MEDIUM] [question]
3. [LOW] [question]

## Definition of Done
- [ ] All positive-path ACs pass in QA
- [ ] All negative-path ACs pass in QA
- [ ] No high-severity bugs open against this spec
- [ ] [Additional DoD items specific to this task]

## Traceability
Brief section → Story mapping:
- "[quoted brief excerpt]" → Story N
```

### Clarification Required Format

When the brief is too ambiguous:

```
CLARIFICATION REQUIRED
Task: [task_id]
Status: blocked-on-clarification

## Blocking Questions
1. [HIGH] [specific question]
   Impact: [which part of the spec cannot be written without this answer]
   Assumption if proceeding: [what would be assumed — stated so the human can correct it]

2. [HIGH] [specific question]
   ...

## Partial Spec (if any stories are unambiguous)
[Include any stories that can be written regardless of the blocking questions]
```

### Quality Checklist

Before returning the output:
- Every user story satisfies INVEST criteria
- Every story has at least one positive and one negative Gherkin AC
- Every AC has a stable ID (AC-X.Y format)
- Every AC is traceable to a specific part of the brief
- Open questions are ranked by risk
- No requirements were invented — everything traces to the brief or is flagged as an assumption
- Definition of Done is specific to this task, not generic
- Given/When/Then blocks are specific enough for test case derivation
