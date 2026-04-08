---
name: Draft Tech Spec
description: Produces technical specification artifacts (OpenAPI, ERD, sequence diagrams) for significant API or schema changes. Invoked on Major classified tasks.
isActive: true
visibility: basic
---

```json
{
  "name": "draft_tech_spec",
  "description": "Produce technical specification artifacts for API or schema changes. Outputs OpenAPI spec updates, database ERD diffs, and sequence diagrams as needed. Invoked on Major classified tasks or any task with new endpoints or schema changes.",
  "input_schema": {
    "type": "object",
    "properties": {
      "architecture_plan": {
        "type": "string",
        "description": "The approved architecture plan from draft_architecture_plan"
      },
      "ba_spec_reference": {
        "type": "string",
        "description": "The approved BA requirements spec"
      },
      "gherkin_acs": {
        "type": "string",
        "description": "Acceptance criteria the API must support"
      },
      "existing_api_spec": {
        "type": "string",
        "description": "Current OpenAPI spec from workspace memory or docs. Omit if not available."
      },
      "existing_schema": {
        "type": "string",
        "description": "Current database schema (Drizzle schema file content)"
      },
      "tech_stack": {
        "type": "string",
        "description": "Framework, ORM, error handling conventions, auth middleware patterns"
      }
    },
    "required": ["architecture_plan", "ba_spec_reference", "gherkin_acs", "existing_schema", "tech_stack"]
  }
}
```

## Instructions

Invoke this skill on Major classified tasks where new API endpoints, endpoint contract changes, or database schema changes are involved. The output becomes the build contract alongside the BA requirements spec. The Dev Agent references it during implementation. The QA Agent uses the API spec to validate response shapes.

After producing the spec, submit it via `request_approval`. Do not begin coding until the spec is approved. Maximum 3 revision rounds before escalating to human.

## Methodology

### When to Invoke

| Condition | Invoke? |
|---|---|
| New API endpoints being added | Yes |
| Existing endpoint request/response shapes changing | Yes |
| New database tables or columns being added | Yes |
| UI-only changes with no API/schema impact | No |
| Bug fixes with no contract changes | No |
| Standard classified tasks | No |

### API Specification Rules (OpenAPI 3.1)

- Every endpoint in the task's Gherkin ACs must be specified — no gaps
- Request/response schemas must have full type definitions, required fields, and at least one example
- Error responses must be specified for each applicable status code (400, 401, 404, 409, 500)
- Endpoint paths and methods must align with the project's route conventions
- Schema component names must use the project's domain vocabulary
- Description fields use business language, not system language
- Specs are additive — preserve everything that already exists

### Database Schema Rules (ERD Diff)

- New tables: include all columns with types, constraints (PK, FK, NOT NULL, UNIQUE, DEFAULT)
- Modified tables: show only the changed columns, note that existing columns are unchanged
- Relationships: include cardinality notation
- Column types must match ORM column definitions exactly
- Must be consistent with the existing schema — no conflicts with existing tables

### Sequence Diagrams

Produce for flows with complex multi-step logic, external service calls, or non-obvious data paths. Include alt blocks for error paths.

### Authoring Checklist

Before submitting:
- Every Gherkin AC is supportable by the specified endpoints
- All endpoint paths and methods align with the architecture plan
- Error responses are specified for all applicable status codes
- ERD changes are consistent with the existing schema
- No requirements were invented — everything is traceable to the BA spec or architecture plan
