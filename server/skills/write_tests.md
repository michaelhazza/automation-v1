---
name: Write Tests
description: Write or update test files for a module, feature, or bug fix.
isActive: true
isVisible: true
---

```json
{
  "name": "write_tests",
  "description": "Write new test cases or update existing tests for a given module or feature. Produces a write_patch targeting the test file. Always reads existing tests and the production code first.",
  "input_schema": {
    "type": "object",
    "properties": {
      "module": { "type": "string", "description": "The module, route, or feature under test (e.g. 'server/services/taskService.ts')" },
      "test_type": { "type": "string", "description": "Type of tests to write: 'unit', 'integration', 'e2e', or 'smoke'" },
      "scenarios": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Specific scenarios or acceptance criteria to cover (e.g. ['creates task with correct priority', 'rejects missing title with 400'])"
      },
      "reasoning": { "type": "string", "description": "Why these tests are needed and what gap they fill" }
    },
    "required": ["module", "test_type", "reasoning"]
  }
}
```

## Instructions

Always read the production module AND any existing test file before writing tests. Follow the existing test framework and patterns — do not introduce a new test runner. Submit tests as a `write_patch`. Tests must be runnable via the project's `testCommand`.

## Methodology

### Pre-flight
1. `search_codebase` for the module path to confirm it exists.
2. `search_codebase` for existing test files (`*.test.ts`, `*.spec.ts`) for this module.
3. `read_codebase` on both the production module and any existing tests.
4. Identify the test framework in use (check `package.json` devDependencies).

### Writing Tests

**Unit tests**
- Test one function or class in isolation.
- Mock all external dependencies (DB, APIs, file system).
- Cover: happy path, edge cases, error paths.
- Name pattern: `describe('functionName', () => { it('should ...', ...) })`.

**Integration tests**
- Test a full route or service end-to-end against a real test DB.
- Set up and tear down test data in `beforeEach`/`afterEach`.
- Cover: success, validation errors (400), auth errors (401/403), not-found (404).

**Smoke tests**
- Minimal sanity check: does the server start, does the key endpoint respond?
- Use for CI gating, not comprehensive coverage.

### Coverage Targets
For each new test file, aim for:
- All exported functions/routes have at least one passing test.
- At least one negative/error path per function.
- No test depends on external services (use mocks or test DB).

### QA Acceptance Criteria
After writing, record in the task board:
- Which scenarios are now covered.
- Which scenarios were deferred and why.
- Estimated coverage delta.

### Decision Rules
- **Never modify production code** to make tests pass — fix the test or file a bug.
- **Never hardcode secrets** in test files.
- **Keep tests focused**: one assertion per `it` block where possible.
- **No console.log in tests** unless debugging — remove before submitting.
