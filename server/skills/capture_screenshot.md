---
name: Capture Screenshot
description: Launch a headless browser, navigate to a URL, and capture a screenshot for visual QA validation.
isActive: true
isVisible: false
---

```json
{
  "name": "capture_screenshot",
  "description": "Capture a screenshot of the application at a given URL using a headless browser. Returns the screenshot as a base64-encoded PNG and saves it to the configured screenshotDir. Requires playwright.baseUrl to be set in devContext.",
  "input_schema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "The full URL to navigate to and capture (e.g. 'http://localhost:5173/dashboard')" },
      "selector": { "type": "string", "description": "Optional CSS selector to capture only a specific element. If omitted, captures the full page." },
      "viewport": {
        "type": "object",
        "properties": {
          "width": { "type": "number", "description": "Viewport width in pixels (default: 1280)" },
          "height": { "type": "number", "description": "Viewport height in pixels (default: 720)" }
        },
        "description": "Optional viewport dimensions. Omit to capture full-page at default viewport."
      },
      "reasoning": { "type": "string", "description": "Why this screenshot is needed — logged as an activity and included in the result." }
    },
    "required": ["url", "reasoning"]
  }
}
```

## Instructions

Use `capture_screenshot` when a Gherkin acceptance criterion requires visual verification, when filing a UI bug report that needs visual evidence, or when comparing before/after states of a UI change.

The screenshot is returned as `screenshot_base64` (a data URI) for immediate inspection, and also written to `screenshot_path` within the configured `playwright.screenshotDir` in devContext. Use `add_deliverable` to attach it to the relevant board task.

## Prerequisites

`playwright.baseUrl` must be set in the subaccount's devContext settings. The application must be running at that URL. Browser binaries must be installed:
```
npx playwright install chromium
```

## Methodology

1. Identify the specific URL and page state to capture — navigate to it if the app requires login first via a separate step
2. Specify a `selector` for targeted element captures (e.g. a specific component or error state)
3. Call `capture_screenshot` with a `reasoning` that describes what the screenshot is verifying
4. Compare the result to the expected UI described in the Gherkin AC
5. Use `add_deliverable` to attach the screenshot path to the task as visual evidence
6. If there is a discrepancy, call `report_bug` with the screenshot path in the `evidence` field

## Decision Rules

- Prefer `selector` over full-page when capturing a specific component — smaller, more focused evidence
- Full-page captures are better for layout and responsiveness bugs
- If the page requires authentication, document the login state assumption in `reasoning`
- Do not use this skill for API validation — use `analyze_endpoint` instead
