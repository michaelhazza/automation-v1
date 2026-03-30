---
name: Run Tests
description: Execute the project test suite within the Dev Execution Context.
isActive: true
---

```json
{
  "name": "run_tests",
  "description": "Execute the project test suite using the DEC testCommand. An optional test_filter narrows execution to specific tests. Subject to maxTestRunsPerTask cost limit.",
  "input_schema": {
    "type": "object",
    "properties": {
      "test_filter": { "type": "string", "description": "Optional filter to run specific tests (passed as argument to testCommand, e.g. '--grep login', '--testNamePattern auth')" },
      "reason": { "type": "string", "description": "Brief explanation of why you are running tests at this point (for audit trail)" }
    },
    "required": []
  }
}
```

## Instructions

Run the full suite at the start of any QA task to establish a baseline. After each patch is applied, run a scoped test using `test_filter` to detect regressions early. Never run tests in a loop — respect `maxTestRunsPerTask`. If the limit is reached, force `resultStatus = failed` and escalate via `request_approval`.

## Methodology

### Phase 1: Baseline Run
At the start of a QA task, run the full suite without a filter. Record total test count, pass rate, and any pre-existing failures. This is the lifecycle baseline. Write the `initialBaselineFingerprint` to `qa_intelligence` if this is the first QA run for this task (never overwrite on subsequent runs).

### Phase 2: Scoped Regression Run
After a patch is applied, use `test_filter` to scope the run to changed modules. This is faster and preserves the run budget. Escalate to a full suite run only if the scoped run reveals failures in unrelated areas.

### Failure Classification
For every failing test, classify before reporting:
- **Code bug**: Production code does not do what the test expects. File via `report_bug`.
- **Test data issue**: Test depends on external state (DB records, env vars) that is missing. Log as blocked.
- **Flaky test**: Passes on re-run without any code change. Apply -0.1 confidence penalty per occurrence. Track in `qa_intelligence.flakyTests`.
- **Pre-existing failure**: Was already failing in the baseline run. Note it but do not report as a new bug.

### Flaky Test Escalation
If a flaky test has appeared 3+ times in `qa_intelligence.flakyTests`:
- Create a separate task: "Stabilise flaky test: [test name]".
- Cap maximum achievable confidence score at 0.7 for this run.

### Regression Detection
- If a test that was passing in the baseline run is now failing: auto-classify as `high` severity regression bug.
- If a new failure appears in an area NOT in `changedAreas`: flag as regression, file via `report_bug` with high severity.

### Test Limit Hard Stop
If `maxTestRunsPerTask` is reached:
1. Force `resultStatus = failed`.
2. Write a board summary with all findings so far.
3. Escalate via `request_approval` with a full failure report.
4. Do not attempt further test runs.

### Decision Rules
- Do not retry a failing test more than once in the same run.
- Never modify test files to make tests pass — fix the production code.
- Do not run the full suite more than once per iteration if a scoped run is sufficient.
