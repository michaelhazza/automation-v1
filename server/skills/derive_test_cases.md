---
name: Derive Test Cases
description: Transforms Gherkin acceptance criteria from a BA spec into a structured test case manifest with full traceability. Each test case links back to its source AC.
isActive: true
visibility: basic
---

```json
{
  "name": "derive_test_cases",
  "description": "Derive a structured test case manifest from the Gherkin acceptance criteria in an approved BA spec. Each test case traces to its source AC ID and produces a testable contract: preconditions, action, and assertion. The manifest is written to workspace memory and becomes the contract for all subsequent test runs.",
  "input_schema": {
    "type": "object",
    "properties": {
      "spec_reference_id": {
        "type": "string",
        "description": "The spec reference ID (e.g. SPEC-task-42-v1) to derive test cases from"
      },
      "spec_content": {
        "type": "string",
        "description": "The full approved BA spec content including all Gherkin ACs"
      },
      "task_id": {
        "type": "string",
        "description": "The board task ID this test manifest belongs to"
      },
      "tech_context": {
        "type": "string",
        "description": "Technical context from workspace memory or codebase: API routes, DB schema, auth patterns relevant to writing concrete test setups. Omit if not available."
      }
    },
    "required": ["spec_reference_id", "spec_content", "task_id"]
  }
}
```

## Instructions

Invoke this skill after a BA spec has been approved (status: `spec-approved`). The output is the test case manifest that all subsequent QA activities reference. Without this manifest, test runs lack formal linkage to acceptance criteria.

Every Gherkin AC in the spec must produce at least one test case. Negative scenario ACs produce separate test case entries — they are never treated as variations of a positive case.

After generating the manifest, write it to workspace memory. When `report_bug` fires during test execution, it must reference both the test case ID and the originating AC ID so every bug is traceable back to the BA spec.

## Methodology

### AC Extraction

1. Parse the spec content for all Gherkin AC blocks (identified by the `AC-X.Y` ID format)
2. For each AC, extract:
   - The AC ID (`AC-X.Y`)
   - The user story it belongs to (Story X)
   - The Given/When/Then blocks
   - Whether it is a positive or negative scenario
3. If an AC is ambiguous or its Given/When/Then blocks are not specific enough to derive a test, flag it as `untestable` in the manifest rather than guessing

### Test Case Derivation Rules

For each Gherkin AC, produce one or more test cases:

- **One-to-one mapping** is the default: one AC produces one test case
- **One-to-many** is allowed when an AC implies multiple distinct verification paths (e.g. an AC about "valid input" where multiple input shapes exist)
- **Many-to-one** is never allowed: every test case traces to exactly one AC

Each test case must be independently executable — no test case should depend on another test case having run first.

### Test Case ID Format

`TC-[task_id]-[sequential_number]`

Example: `TC-task-42-001`, `TC-task-42-002`

The sequential number is zero-padded to 3 digits for consistent sorting.

### Output Format

```
TEST CASE MANIFEST
Spec Reference: [spec_reference_id]
Task: [task_id]
Date: [ISO date]
Total Test Cases: [count]
Coverage: [count of ACs covered] / [total ACs in spec]

## Test Cases

### TC-[task_id]-001: [human-readable description]
Source AC: AC-1.1
Story: Story 1 — [story name]
Type: positive | negative
Priority: must | should | could

**Preconditions (Given):**
- [Concrete setup step matching the Given block]
- [Additional setup if needed]

**Action (When):**
- [Specific action matching the When block]

**Expected Result (Then):**
- [Specific assertion matching the Then block]
- [Additional assertions if the Then block implies multiple checks]

**Test Data:**
- [Specific input values, if determinable from context]
- [Edge values for boundary tests]

---

### TC-[task_id]-002: [description]
...

## Coverage Matrix

| AC ID | Test Case(s) | Type | Status |
|---|---|---|---|
| AC-1.1 | TC-[task_id]-001 | positive | covered |
| AC-1.2 | TC-[task_id]-002 | negative | covered |
| AC-2.1 | TC-[task_id]-003 | positive | covered |
| AC-2.2 | — | negative | untestable: [reason] |

## Untestable ACs (if any)
- AC-X.Y: [reason the AC cannot be converted to a test case]
  Recommendation: [what the BA should clarify or revise]
```

### Priority Assignment

- **must**: positive-path ACs for core user stories — these are blocking for release
- **should**: negative-path ACs and edge cases — these are expected before release
- **could**: low-severity edge cases explicitly marked LOW in the spec's open questions

### Test Data Strategy

Where technical context is available:
- Derive concrete test data from the API contracts, DB schema, and auth patterns
- Use realistic but synthetic values (never production data references)
- For boundary tests, include the boundary value, one value inside, and one value outside

Where technical context is not available:
- Describe the test data abstractly (e.g. "a valid user with role X")
- Mark the test data section as `needs-tech-context` so the QA Agent can fill it in during test execution after reading the codebase

### Traceability Contract

The manifest establishes a traceability chain:

```
Brief → Story → AC (AC-X.Y) → Test Case (TC-task-N-NNN) → Bug Report (references both TC and AC)
```

This chain must be unbroken. Every `report_bug` invocation during test execution must include:
- `test_case_id`: the TC ID that failed
- `source_ac_id`: the AC ID the test case traces to

If a bug is discovered outside the manifest (exploratory testing), it should still reference the nearest relevant AC if one exists, or note "exploratory — no AC reference" explicitly.

### Quality Checklist

Before writing the manifest to workspace memory:
- Every AC in the spec has at least one corresponding test case (or is explicitly flagged as untestable)
- Every test case has a stable TC ID in the correct format
- The coverage matrix is complete and accurate
- No test case depends on another test case having run first
- Preconditions are specific enough to set up programmatically
- Assertions are specific enough to verify programmatically
- Priority assignments follow the rules above
- Untestable ACs include a recommendation for the BA
