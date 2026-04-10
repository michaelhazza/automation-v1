---
name: Capture Screenshot
description: Launch a headless browser, navigate to a URL, and capture a screenshot for visual QA validation.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to navigate to and capture (e.g. 'http://localhost:5173/dashboard')
- selector: string — Optional CSS selector to capture only a specific element. If omitted, captures the full page.
- viewport: string — JSON object with keys: "width" (number), "height" (number). Optional viewport dimensions. Omit to capture full-page at default viewport.
- reasoning: string (required) — Why this screenshot is needed — logged as an activity and included in the result.

## Instructions

Use `capture_screenshot` when a Gherkin acceptance criterion requires visual verification, when filing a UI bug report that needs visual evidence, or when comparing before/after states of a UI change.

The screenshot is returned as `screenshot_base64` (a data URI) for immediate inspection, and also written to `screenshot_path` within the configured `playwright.screenshotDir` in devContext. Use `add_deliverable` to attach it to the relevant board task.

1. Identify the specific URL and page state to capture — navigate to it if the app requires login first via a separate step
2. Specify a `selector` for targeted element captures (e.g. a specific component or error state)
3. Call `capture_screenshot` with a `reasoning` that describes what the screenshot is verifying
4. Compare the result to the expected UI described in the Gherkin AC
5. Use `add_deliverable` to attach the screenshot path to the task as visual evidence
6. If there is a discrepancy, call `report_bug` with the screenshot path in the `evidence` field

## Prerequisites

`playwright.baseUrl` must be set in the subaccount's devContext settings. The application must be running at that URL. Browser binaries must be installed:
```
npx playwright install chromium
```

## Decision Rules

- Prefer `selector` over full-page when capturing a specific component — smaller, more focused evidence
- Full-page captures are better for layout and responsiveness bugs
- If the page requires authentication, document the login state assumption in `reasoning`
- Do not use this skill for API validation — use `analyze_endpoint` instead
