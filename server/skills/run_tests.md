---
name: Run Tests
description: Execute the project test suite within the Dev Execution Context.
isActive: true
---

```json
{
  "name": "run_tests",
  "description": "Execute the project test suite. Use this to verify your patches did not break existing functionality, or to establish a quality baseline before making changes.",
  "input_schema": {
    "type": "object",
    "properties": {
      "test_filter": { "type": "string", "description": "Optional filter to run a subset of tests (e.g. a test file path, a describe block name, or a pattern)" }
    },
    "required": []
  }
}
```

## Instructions

Run tests after applying patches to verify nothing is broken. Use `test_filter` to scope runs to relevant tests when possible, to stay within cost limits. Do not run tests in loops — if tests fail repeatedly, report the issue and escalate.

## Methodology

### When to Run
- **Baseline**: Run tests before making any changes to establish a clean starting point.
- **Post-patch**: Run tests after each patch is applied to catch regressions immediately.
- **Pre-PR**: Run the full suite before creating a pull request.

### Scoped vs Full Runs
- Use `test_filter` to run only tests related to the module you changed (faster, lower cost).
- Run the full suite (no filter) for baseline and pre-PR runs.
- Respect `maxTestRunsPerTask` — do not run tests more than the configured limit.

### Analysing Failures
For each failing test:
1. Read the error message and stack trace.
2. Identify whether the failure is: a code bug you introduced, a pre-existing failure, or a flaky test.
3. If you introduced the failure, fix the code and run the scoped test again.
4. If the failure is pre-existing, document it but do not attempt to fix it unless it is in scope.
5. If flaky, note it in your quality report.

### Quality Confidence Score
Compute after each full run:
- Base score = passing tests / total tests
- Penalise: -0.1 per flaky test, -0.05 per previously-failing test now passing without explicit fix
- Report this score in your write_workspace activity.
