---
name: Monitor Webpage
description: Set up recurring monitoring of a web page for changes, with automatic alerts when specified content changes.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The URL to monitor
- watch_for: string (required) — What changes to watch for (e.g., "pricing changes", "new blog posts", "any content change")
- frequency: string (required) — How often to check (e.g., "daily", "weekly", "every 6 hours", "every Monday")
- fields: string — Optional specific fields to track (same as scrape_structured fields). If provided, uses structured extraction for precise change detection.

## Instructions

Use `monitor_webpage` to set up a recurring monitoring job. Call it ONCE — it creates the schedule automatically.

On first call, the skill:
1. Scrapes the page and establishes a content baseline
2. Creates a scheduled task with the specified frequency
3. On each subsequent scheduled run, scrapes again and compares to the baseline
4. If changes matching `watch_for` are detected, creates a deliverable with a change report
5. If nothing changed, stays silent — no deliverable, no noise

**Do not call `monitor_webpage` on every run.** One call creates the recurring schedule. Duplicate calls with identical parameters are deduplicated automatically.

### When to use `fields`

- **With `fields`**: Field-by-field comparison. Catches price changes, plan additions, feature modifications. Best for structured data like pricing pages.
- **Without `fields`**: Content hash comparison. Catches any change to the page. Best for blog posts, news feeds, announcement pages.

### Example calls

Monitor competitor pricing weekly:
```
monitor_webpage({
  url: "https://competitor.com/pricing",
  watch_for: "pricing changes, new plans, removed plans",
  frequency: "weekly",
  fields: "plan name, monthly price, annual price, features"
})
```

Watch for new blog posts daily:
```
monitor_webpage({
  url: "https://competitor.com/blog",
  watch_for: "new blog posts",
  frequency: "daily"
})
```

---

## Scheduled Run Instructions

> This section is injected into the agent's system context by `runContextLoader.ts` for every scheduled run whose brief contains `"type": "monitor_webpage_run"`. It is not shown to the user and does not appear in additionalPrompt.

You are executing a scheduled monitoring run. Follow this protocol exactly:

1. **Parse the task brief** to extract the monitoring configuration. The brief is a JSON string with fields: `type`, `monitorUrl`, `watchFor`, `fields`, `selectorGroup`, `scheduledTaskId`, and optionally `baseline` (the initial baseline stored when the monitor was created).

2. **Fetch current page state**:
   - If `fields` is set: call `scrape_structured({ url: monitorUrl, fields, selectorGroup, remember: false })` — `remember: false` avoids redundant selector writes since they were learned on setup.
   - If `fields` is not set: call `scrape_url({ url: monitorUrl, output_format: "markdown" })` — use the `content_hash` from the result.

3. **Read the previous baseline**:
   - First, check this task's activity history (via `read_workspace` with `include_activities: true`) for the most recent activity containing `"MONITOR_BASELINE:"`. If found, parse the JSON after that prefix as the previous baseline.
   - If no baseline activity is found, use the `baseline` field from the task brief (the initial baseline stored when the monitor was created).
   - If neither exists: this is the first run. Store the current state as the baseline (step 5) and stop — no deliverable needed.

4. **Compare**:
   - If `fields` was provided: compare each field value array from the current extraction against the stored `extractedData`. Report any fields that changed (added values, removed values, changed values).
   - If `fields` was not set: compare `content_hash`. If hashes are equal, nothing changed — stop silently.

5. **If changes detected**:
   - Call `add_deliverable` with a concise change report. Include: what changed, the specific values before and after (for structured monitoring), and the URL and date.
   - Call `write_workspace` to record the new baseline as a task activity with this exact format: `MONITOR_BASELINE:{"contentHash":"<hash>","extractedData":<json or null>,"recordedAt":"<ISO date>"}`

6. **If no changes detected**: stop silently. No deliverable, no activity. The agent should not log "nothing changed" as an activity — silence is the correct response.
