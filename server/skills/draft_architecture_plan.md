---
name: Draft Architecture Plan
description: Enforces plan-before-build discipline. Produces a structured architecture plan that the Dev Agent follows during implementation. Invoked on Standard, Significant, and Major classified tasks.
isActive: true
---

```json
{
  "name": "draft_architecture_plan",
  "description": "Produce a structured architecture plan for an implementation task. Invoke this before writing any code on Standard, Significant, or Major classified tasks. Outputs a plan document with implementation chunks, contracts, failure modes, and open questions.",
  "input_schema": {
    "type": "object",
    "properties": {
      "task_description": {
        "type": "string",
        "description": "The board task title and full description"
      },
      "ba_spec_reference": {
        "type": "string",
        "description": "Reference ID of the approved BA requirements spec from workspace_memories. Omit if not available."
      },
      "gherkin_acs": {
        "type": "string",
        "description": "The Gherkin acceptance criteria from the BA spec. Omit if not available."
      },
      "qa_bug_report": {
        "type": "string",
        "description": "QA bug report for the task including reproduction steps. Omit if not available."
      },
      "codebase_context": {
        "type": "string",
        "description": "Relevant file paths, function signatures, and patterns read from the codebase before invocation"
      },
      "tech_stack": {
        "type": "string",
        "description": "Stack conventions from workspace memory: framework, ORM, routing patterns, error handling, auth middleware"
      },
      "classification": {
        "type": "string",
        "enum": ["standard", "significant", "major"],
        "description": "Task complexity classification. Standard: 2-5 files. Significant: schema/API changes. Major: new domain or cross-cutting."
      }
    },
    "required": ["task_description", "codebase_context", "tech_stack", "classification"]
  }
}
```

## Instructions

Before writing any code on a non-trivial task, invoke this skill to think through the implementation. The output is an architecture plan document that you follow chunk by chunk during implementation.

For **Standard** tasks: produce the plan and proceed to implementation immediately.
For **Significant** tasks: produce the plan and submit it via `request_approval` before coding.
For **Major** tasks: produce the plan and submit it via `request_approval`. Also invoke `draft_tech_spec` before coding.

If you cannot produce a complete plan due to missing or ambiguous requirements, output a PLAN_GAP report instead. Write it to the board task as a comment, update task status to `blocked`, and stop.

## Methodology

### Engineering Standards

**SOLID Principles (apply pragmatically — tools, not dogma):**
- Single Responsibility: each module has one reason to change
- Open/Closed: extend through composition, not modification
- Liskov Substitution: implementations honour their contracts fully
- Interface Segregation: keep interfaces focused
- Dependency Inversion: depend on abstractions, not concrete implementations

**Design Patterns (call out specific patterns with explicit justification):**
- Strategy: interchangeable algorithms or behaviours
- Factory: complex or conditional object creation
- Observer: decoupled state-change notification
- Adapter: integrating external interfaces with internal contracts
- Decorator: cross-cutting concerns without modifying core logic
- If no pattern is needed, say so. Simple code beats forced abstraction.

### Planning Rules

- Refuse to produce a plan if requirements ambiguity would force architectural assumptions that cannot be resolved from context — flag the ambiguity instead
- Split implementation into chunks that can each be completed in a single focused session
- Order chunks to minimise work-in-progress dependencies
- Every public interface must follow Dependency Inversion
- Prefer the simplest pattern that solves the problem
- Never specify raw SQL — schema changes must go through the ORM layer
- Do not write application code in this plan — write contracts and structure only

### Output Format

```
# Architecture Plan
**Task:** [task reference and title]
**Classification:** [Standard | Significant | Major]
**BA Spec Reference:** [reference ID or "N/A"]
**Date:** [ISO date]

## Architecture Notes
[Key decisions, patterns selected with rationale, trade-offs considered.
Call out specific design patterns only where they solve a real problem.
Apply SOLID principles explicitly: name the principle and explain its application.]

## Implementation Plan
[Ordered list of implementation chunks. Each chunk must be:]
[- Achievable in a single focused session]
[- Independently testable]
[- Ordered to minimise work-in-progress dependencies]

### Chunk 1: [short name]
**Files touched:** [explicit list of file paths]
**Contracts:** [interfaces, function signatures, API shapes to be produced]
**Failure modes:** [error cases and handling strategy]
**Testability:** [key failure modes and edge cases the QA Agent should cover]
**Dependencies:** [other chunks this depends on, if any]

## Open Questions
[Ranked: HIGH (blocks implementation), MEDIUM (can be resolved post-build), LOW (edge case)]

## Not In Scope
[Explicit statement of what this plan does not cover]
```

### PLAN_GAP Output Format

When requirements are too ambiguous to plan:

```
PLAN_GAP REPORT
Task: [task reference]
Gap: [specific description of what is missing or ambiguous]
Decision needed: [what choice needs to be made]
Options considered: [list of approaches with trade-offs]
Blocked chunk: [which chunk cannot be designed without resolution]
Assumption if proceeding: [what would be assumed, stated explicitly]
```

### Quality Checklist

Before submitting the plan, self-verify:
- Every chunk is independently testable
- Chunks are ordered to minimise dependencies
- Every design pattern invoked has an explicit justification
- Open questions are ranked by risk
- No application code is present in the plan
- File paths reference the actual codebase structure
- SOLID principles are applied where relevant and named explicitly
- Not-in-scope section prevents implementation creep
