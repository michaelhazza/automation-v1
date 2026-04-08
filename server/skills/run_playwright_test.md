---
name: Run Playwright Test
description: Execute a Playwright end-to-end test file against a running application.
isActive: true
visibility: basic
---

```json
{
  "name": "run_playwright_test",
  "description": "Run a Playwright end-to-end test file (or a specific test within it) against a running application. Returns pass/fail counts, full output, and duration. Subject to the same maxTestRunsPerTask limit as run_tests.",
  "input_schema": {
    "type": "object",
    "properties": {
      "test_file": { "type": "string", "description": "Path to the Playwright test file, relative to projectRoot (e.g. 'e2e/auth.spec.ts')" },
      "test_name": { "type": "string", "description": "Optional: a grep pattern to run only specific tests within the file (e.g. 'login success')" },
      "base_url": { "type": "string", "description": "Optional: override the base URL for this test run. Defaults to playwright.baseUrl in devContext." },
      "reasoning": { "type": "string", "description": "Why this E2E test is being run — which Gherkin ACs it covers." }
    },
    "required": ["test_file", "reasoning"]
  }
}
```

## Instructions

Use `run_playwright_test` to execute end-to-end browser-level test scenarios that `run_tests` (unit/integration) cannot cover: full user flows, multi-step form submissions, navigation, and interactions that depend on a running browser and real UI rendering.

The test runs via `npx playwright test <test_file>`. The `PLAYWRIGHT_BASE_URL` and `BASE_URL` environment variables are set from the `base_url` input so `playwright.config.ts` can pick them up.

## Prerequisites

- `playwright.baseUrl` configured in devContext settings
- Application running at that URL
- Browser binaries installed: `npx playwright install chromium`
- Playwright test files exist in the project (typically under `e2e/` or `tests/`)

## Methodology

### Pre-flight
1. Confirm the application is running at `base_url` using `analyze_endpoint` on the root path
2. Read the Playwright test file with `read_codebase` to understand what it tests
3. Map the test cases to specific Gherkin ACs

### Running
1. Run with `run_playwright_test`, specifying the test file and the Gherkin ACs covered in `reasoning`
2. If `test_name` is provided, only matching tests run — useful for targeting a specific scenario during iteration
3. Review the output: check `all_passed`, `passed`, `failed` counts

### On Failure
1. Read the failure output carefully — Playwright provides step-level traces
2. Classify: is this an APP BUG, TEST BUG, or ENVIRONMENT issue?
3. For APP BUGS: call `report_bug` with the failure output as `evidence`
4. For TEST BUGS: fix the test file, re-run
5. For ENVIRONMENT issues (port not running, browser crash): log and escalate

## Decision Rules

- Use `run_playwright_test` only for user-flow scenarios that require a browser. API contracts and service logic belong in `run_tests`
- Never write new Playwright tests inline — use `write_tests` with `test_type: "e2e"` to produce them
- Respect `maxTestRunsPerTask` — don't run the full E2E suite repeatedly; scope with `test_name` during iteration
