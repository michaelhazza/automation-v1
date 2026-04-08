# How to configure a new recurring report

A practical walkthrough for setting up a new project-style report
(like the 42 Macro weekly analysis) using the cascading context data
sources feature, **without writing any code or new skill files**.

This is the recommended path for new reports as of migration 0078.
The full architecture is documented in [`cascading-context-data-sources-spec.md`](./cascading-context-data-sources-spec.md).

---

## What you're building

A reporting workflow that maps cleanly to a Claude Project:

| Claude Project concept | Automation OS equivalent |
|---|---|
| The project itself | A `scheduledTask` (recurring template) |
| Project instructions | The scheduled task's **Instructions** field |
| Project files | Data sources attached to the scheduled task |
| Starting a chat in the project | A fire of the scheduled task → board task → agent run |
| Uploading a one-off file in chat | Task instance attachment on the fired board task |
| The agent doing the work | A generic reporting agent reused across projects |

The key win: one generic reporting agent + N scheduled tasks = N projects.
You don't create a new agent or write new code for each report type.

---

## Prerequisites

- A reporting agent already exists (or you can create one). The agent's
  master prompt should be **generic** — something like *"You are a reporting
  agent. Read your task briefing and produce a report in the requested
  format."* The specialisation comes from the scheduled task instructions.
- The agent is linked to the subaccount where the report will run (via
  the standard subaccount agent link).
- Your user has the `org.scheduled_tasks.data_sources.manage` permission
  (Org Admin gets this automatically).

---

## Step 1: Create the scheduled task

1. Navigate to the subaccount → **Scheduled Tasks** page.
2. Click **+ New Schedule**.
3. Fill in the form:
   - **Title**: descriptive name, e.g. *"42 Macro Weekly Report"*
   - **Agent**: pick the generic reporting agent
   - **Brief**: short summary, e.g. *"Weekly macro analysis from the latest 42 Macro video"*
   - **Instructions**: this is where you paste the **full briefing**
     (see Step 2 below)
   - **Recurrence**: weekly, daily, etc.
   - **Time / Timezone**: when each fire should happen
4. Click **Create**.

The scheduled task is now created but inactive. Don't enable the schedule
yet — finish configuration first.

---

## Step 2: Write the Instructions

The Instructions field becomes the **Task Instructions** layer in the
agent's system prompt for every run of this scheduled task. Treat it like
the system prompt of a Claude Project.

A good Instructions field includes:

- **Context** — what is this report? Who reads it? Why does it matter?
- **Voice & format** — institutional, conversational, plain English; markdown
  structure; section headers
- **Steps** — the agent will execute these in natural language order. List
  them clearly:
  1. Log into the source (use the `fetch_paywalled_content` skill)
  2. Download / transcribe the source
  3. Analyse using the framework defined in the reference files
  4. Produce a three-tier output
  5. Publish to Slack via the `send_to_slack` skill
- **Output format** — exactly what the deliverable should look like
- **Constraints** — what NOT to do, plain language requirements, tone

### Example skeleton

```markdown
# 42 Macro Weekly Report — Briefing

## Context
You are producing the weekly macro analysis report for Breakout Solutions.
The output is read by retail investors who need plain-language guidance
on positioning their portfolio.

## Workflow
1. Use fetch_paywalled_content to download the latest 42 Macro weekly
   video from app.42macro.com (intent: download_latest, captureMode:
   capture_video). If noNewContent is returned, emit done and stop.
2. Use transcribe_audio on the resulting artifactId.
3. Read the reference materials in your Knowledge Base — especially the
   glossary and KISS portfolio methodology — to ground your analysis.
4. Produce three tiers: Dashboard (≤30s read), Executive Summary (4
   paragraphs), Full Analysis (sectioned).
5. Use send_to_slack to post the result to #macro-reports.

## Format
- Tier 1: 5 data points + 1 sentence
- Tier 2: 250–350 words, plain English
- Tier 3: sections — Macro Snapshot, Bitcoin & Digital Assets, The
  Bottom Line

## Voice
Plain language. Define every technical term immediately. Short sentences.
One idea at a time.

## Constraints
Not financial advice. Translate, don't prescribe.
```

The agent reads this every run. You can edit it any time without
restarting anything — the next run picks up the new version.

---

## Step 3: Attach reference files as data sources

This is the equivalent of "uploading files to a Claude Project."

1. Open the scheduled task's **detail page** (click its name in the list).
2. Scroll to the **Data Sources** panel.
3. Click **+ Add Source** for each reference file.
4. For each source:
   - **Name** — short and descriptive (e.g. `42macro-glossary.md`)
   - **Description** — one-line hint shown to the agent
   - **Source Type** — pick the right type:
     - `File Upload (static)` for files you upload directly
     - `HTTP URL` for files hosted on the public web
     - `Google Docs` for Google Docs (with optional API key)
     - `R2` / `S3` for cloud storage objects
   - **Content Type** — `markdown`, `json`, `csv`, `text`, or `auto`
   - **Loading Mode** — pick **Eager** for files the agent always needs
     (glossary, methodology, style guide); pick **Lazy** for larger
     reference docs the agent only needs sometimes (training transcripts,
     historical reports). Lazy sources don't consume the eager budget
     — they only load when the agent calls `read_data_source`.
   - **Priority** — leave at 0 unless you need a specific within-scope ordering
   - **Max Tokens** — the budget cap for this individual source (default 8000)
5. Click **Add Source** to save.

Repeat for each reference file.

### Best practices

- Keep eager sources small (≤8KB each) so they all fit comfortably in
  the 60KB Knowledge Base budget
- Use lazy mode for anything over ~4KB unless the agent literally needs
  it on every run
- Use clear, distinct names — same-name conflicts across scopes are
  resolved by precedence (most specific wins) and the loser is suppressed
- Test each source after adding it (the **Test** button does a one-shot
  fetch and shows you the token count + first 500 chars)

---

## Step 4: Test the configuration

1. On the scheduled task detail page, click **Run Now**.
2. Open the resulting agent run from the Run History table.
3. Check the **Context Sources** panel in the run trace viewer:
   - Every source you attached should appear with the correct scope label
   - Eager sources should show `in prompt` (green)
   - Lazy sources should show `manifest (lazy)` (grey)
   - If anything shows `excluded (budget)` (red), your eager budget is
     full — convert lower-priority sources to lazy
   - If anything shows `overridden` (amber), you have a name collision
     across scopes — rename one of them
4. Check the actual deliverable the agent produced. Iterate on the
   Instructions field if the output isn't what you wanted.

---

## Step 5: Enable the schedule

Once you're happy with a test run:

1. Go back to the scheduled tasks list page.
2. Find your task and click **Resume** (if it's currently paused).
3. The task will fire on its configured schedule.

---

## Editing later

- **Change the instructions** — open the detail page, click **Edit**, modify
  the Instructions field, click **Save Changes**. Effective on the next run.
- **Add or remove a data source** — open the detail page, use the Data
  Sources panel. Effective immediately.
- **Change the assigned agent** — open the detail page, click Edit, pick a
  different agent. The system will cascade your data sources to the new
  agent automatically. If the new agent has its own data sources with the
  same name as your scheduled task sources, the scheduled task version
  will win at runtime (most specific scope) and the audit log will record
  the override.

---

## When NOT to use this approach

Use a Playbook instead if your workflow needs:

- Multiple parallel branches running simultaneously
- Formal user input forms with schemas
- Approval gates between steps
- Versioned, distributable templates

Use this scheduled task + data sources approach when your workflow is:

- Single agent
- Linear (steps in natural-language order)
- Driven by a briefing document
- Reusable across many similar projects

For the 42 Macro report specifically, this scheduled task approach is
the right fit. The agent reads the briefing, uses its skills (web login,
transcription, Slack), and delivers the report.
