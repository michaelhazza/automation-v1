# Agent Coworker Features — Development Brief

> **Status:** parked. Captured for future build. Not currently in flight.
> **Captured:** 2026-04-11 from a forum-post dissection conversation.
> **Format:** development brief, not a spec. Captures intent, rationale, shape, and open questions. Spec-level decisions happen at build time.

---

## Table of Contents

1. [Context & Origin](#context--origin)
2. [Feature Summary](#feature-summary)
3. [Feature 1 — Ops Dashboard](#feature-1--ops-dashboard)
4. [Feature 2 — Prioritized Work Feed](#feature-2--prioritized-work-feed)
5. [Feature 3 — Skill Studio](#feature-3--skill-studio)
6. [Feature 4 — Slack Conversational Surface](#feature-4--slack-conversational-surface)
7. [Feature 5 — Cross-Agent Memory Search](#feature-5--cross-agent-memory-search)
8. [Build Order, Dependencies & Open Questions](#build-order-dependencies--open-questions)

---

## Context & Origin

This brief captures five features identified during an architectural gap analysis on 2026-04-11. The analysis was triggered by a forum post about building an "AI coworker" — an agent that operates autonomously with memory, skills, scheduling, tool access, communication, feedback loops, and visibility. The post's conclusion — that an AI coworker is not a model, it's a seven-layer system — was cross-referenced against the current state of `automation-v1`.

The verdict: we are significantly ahead of the post's author on memory, skills, scheduling, tool access, and feedback-loop rigor. We have real gaps in **visibility** (no unified ops dashboard), **prioritization** (no ranked work queue for heartbeat agents), **self-modification** (no Skill Studio equivalent for skills and master prompts), **conversational surface** (Slack is output-only today), and **cross-agent knowledge** (per-subaccount memory with embeddings, but no first-class retrieval skill).

Each gap became one of the five features in this brief. All five were accepted for future build.

### Upstream dependency — skills-from-files-to-DB migration

An in-flight architectural change is moving skills from file-based markdown (`server/skills/*.md`) to database-backed entries. This directly affects **Feature 3 (Skill Studio)** — the original design was organized around a PR-flow trust boundary where the server renders a markdown file and commits it to the repo. With skills in the database, the trust boundary shifts and the design simplifies meaningfully. Feature 3's section calls out the adjustments explicitly. The other four features are unaffected.

**Do not start Feature 3 until the skills-to-DB migration is complete.** Everything else can start independently.

### What this brief is not

- Not a spec. No route signatures, no schema migrations, no file inventory.
- Not a schedule. No dates, no effort estimates beyond rough t-shirt sizing.
- Not a commitment. Captured for future prioritization; priorities may shift.
- Not a replacement for `architecture.md`. Read that for the current state of the codebase.

---

## Feature Summary

| # | Feature | Priority | Effort | Depends on |
|---|---|---|---|---|
| 1 | Ops Dashboard | P0 | Small (1–2 days, mostly frontend) | — |
| 2 | Prioritized Work Feed | P1 | Medium (new service + scoring + one skill) | — |
| 3 | Skill Studio | P1 | Medium–Large (mirror Playbook Studio) | Skills-to-DB migration |
| 4 | Slack Conversational Surface | P1 (Breakout-specific value) | Medium | — |
| 5 | Cross-Agent Memory Search | P2 (quick win, bundle with P0) | Tiny (half day) | — |

**Recommended starting bundle:** Feature 1 + Feature 5. Both are cheap, both are blocked on nothing, and together they unlock immediate operational visibility plus cross-agent knowledge.

---

## 1. Ops Dashboard

### Purpose

A single org-level page answering "what's happening across my entire agent fleet right now?" Today, to get the same picture, an operator has to bounce between `AgentRunHistoryPage`, the inbox, the review queue, `AdminHealthFindingsPage`, and per-agent trace viewers. The primitives all exist; there is no view that stitches them together. This dashboard is that view.

### Scope — single component, three routes

This is a single page component rendered at all three scopes, with queries narrowed via the standard scope pattern we already use for permissioned pages (skills, agents, etc.):

| Scope | Route | Data filter |
|---|---|---|
| Subaccount | `/subaccounts/:id/ops` | Single subaccount |
| Org | `/admin/ops` | All subaccounts in the org |
| System | `/system/ops` | Multi-org via `X-Organisation-Id` header |

One React component, three routes, same layout, different data scope. This mirrors how `AdminSkillsPage` / `SystemSkillsPage` already work.

### Relationship to the existing execution-history pages

The platform already has **two** execution-history pages, both scoped to **process engine runs only** (n8n / ghl / make / zapier / custom_webhook via `processes` + `executions`):

| Page | Route | API | Scope |
|---|---|---|---|
| `ExecutionHistoryPage` | `/executions` | `/api/executions` | Org — "all workflow runs for this org" |
| `SystemActivityPage` | (system admin) | `/api/system/executions` | Platform — all orgs |

Neither covers agent runs, the review queue, the inbox, health findings, or decisions. They are the legacy "workflow runs" slice of what an Ops Dashboard should cover.

**This actually validates the scoping approach.** We already have the pattern of "same feature at org and system scope as sibling pages." Feature 1 extends that pattern to three scopes and adds the missing subaccount variant, and expands all three from "engine executions only" to full Ops coverage.

**Recommended path:** extend `ExecutionHistoryPage` and `SystemActivityPage` in place, keeping the existing "Execution History" panel as one panel among many on the unified Ops page. Add the missing subaccount-scoped variant at the same time. All three routes render the same React component with the same panel layout, narrowed by scope:

- `/subaccounts/:id/ops` (new) — single subaccount
- `/executions` (extend in place) → becomes org-level Ops page
- `/system/ops` (extend `SystemActivityPage`) — platform-level Ops page

Each panel's data source is scope-narrowed at the API level, not the UI level.

### Problem it solves

The forum post captured this bluntly: "slack turned into chaos... so he started building dashboards: what ran, what failed, what's in progress, what decisions were made." We have rich per-run traces and per-agent history, but no single pane of glass. `AdminHealthFindingsPage` is even explicitly noted as a known UI gap in `architecture.md` — registered in the router but only reachable via the dashboard widget, no sidebar entry.

### Data sources (all primitives exist today)

| Panel | Data source | Notes |
|---|---|---|
| Active runs | `agentActivityService.listRuns({ status: 'running' })` | Status filter already supported; returns `handoffJson` inline per row |
| Recently failed runs | `agentActivityService.listRuns({ status: ['failed','timeout','loop_detected','budget_exceeded'] })` | Order by `startedAt` desc |
| Awaiting review | `reviewItems` table | Join with `reviewAuditRecords` for audit context |
| Awaiting input | `agent_inbox` / `playbook_step_runs` where status is `awaiting_input` | Playbook runs in `awaiting_input`/`awaiting_approval` surface here too |
| Open health findings | `workspaceHealthService.listActiveFindings(orgId)` | Already grouped by severity |
| Recent decisions | `tool_call_security_events` + `audit_events` | Filter by actor, action, resource for "why did the agent do X" drill-down |

### View shape

Single page, four stacked panels, each collapsible:

1. **Live** — active runs, grouped by subaccount. Click-through to `RunTraceViewerPage`.
2. **Attention needed** — failed runs + awaiting-review + awaiting-input + critical health findings. Sorted by severity then age. This is the "act on me now" column.
3. **Recent activity** — completed runs in the last 24h, with the `nextRecommendedAction` from each run's `handoffJson` surfaced as the card subtitle. This is the "what did the fleet do today" feed.
4. **Decisions log** — recent policy evaluations and security events. Expandable to show the full tool-call chain for any decision. This answers "why did the agent do / not do X."

Filters at the top: subaccount, agent, status, severity, time range. All filters compose.

### Effort

Small. Roughly 1–2 days, mostly frontend. Backend primitives already exist; no schema changes. The only new server work is a consolidated `GET /api/org/ops-dashboard` endpoint that bundles the queries so the page loads in one round-trip.

### Priority

**P0.** Biggest trust unlock for the cheapest build. Fixes the acknowledged UI gap around `AdminHealthFindingsPage`. Bundle with Feature 5 on the same branch — both are small, both are unblocked.

### Out of scope (v1)

- No editing from the dashboard. All mutations (resolve finding, approve review) navigate to their existing admin pages. v2 can add inline actions.
- No custom saved views / dashboards per user. v1 is a single canonical layout.
- No real-time push via WebSocket — polling every 10s is fine. v2 can subscribe to the existing subaccount rooms.
- No mobile layout. Desktop-only v1.

---

## 2. Prioritized Work Feed

### Purpose

A unified, scored, ranked queue of "open work" that heartbeat agents can read at the start of every run to decide what to do next. Today, a heartbeat agent wakes up, looks at its own schedule, and picks arbitrarily from its own inbox. There is no cross-source notion of "what matters most right now." This feature gives heartbeat agents a single feed to query, ranked by severity × age × assignee.

### Problem it solves

The forum post author's exact complaint: "it struggled to prioritize anything correctly... so most of the time he still triggered things manually because he didn't trust it yet." We have the scheduler (`pg-boss` + heartbeat + event-driven subtask wakeups) but no prioritization layer. Without this, heartbeat autonomy is limited — humans still have to be in the loop to say "do this first." With this, the agent can pull the top N open items, judge them against its capabilities, and pick the highest-leverage action on its own.

This is the feature that turns "heartbeat runs on schedule" into "heartbeat does the most important thing on schedule."

### Where priority comes from — no new fields

A critical point: **this feature introduces no new priority field and no new UI for setting priority.** It consumes signals that already exist in the schema, via a scoring function. Sources of priority by feed entry type:

| Entry type | Priority signal | Where the user sets it |
|---|---|---|
| Task | `tasks.priority` (low/normal/high/urgent) + `tasks.position` (column order) + age since `updatedAt` | **Task creation form** sets initial `priority` (most priority should be set here to minimise manual work later). **Kanban drag-and-drop** adjusts `position` within a column when a human wants fine-grained override. |
| Health finding | Detector-defined severity (critical/warning/info) | Defined in the detector code, not user-set |
| Review item | Age-weighted | Auto — no user field |
| Agent inbox item | Age-weighted | Auto — no user field |
| Playbook run awaiting input/approval | Age-weighted | Auto — no user field |
| Failed run needing retry decision | Failure cost (e.g. `cost_exceeded` > `timeout`) | Auto — derived from `failureReason` |

**For tasks specifically,** drag-and-drop on the kanban already updates `tasks.position`, and the task creation / edit form already writes to `tasks.priority`. The feed's scoring function reads both fields and combines them with age. No new UI, no new database column.

The scoring function returns a ranked list that merges all of these signals onto a common 0–1 score scale, so tasks and findings and review items can all appear in the same top-K feed. Heartbeat agents consume the feed without ever touching the kanban.

### Sources merged into the feed

| Source | Table / service | Weight |
|---|---|---|
| Health findings | `health_findings` via `workspaceHealthService.listActiveFindings` | Severity × age. Critical findings dominate. |
| Pending review items | `reviewItems` | Age-weighted. Older pending approvals are worse. |
| Agent inbox items | `agent_inbox` | Includes clarifying questions awaiting answer. |
| Stale tasks | `tasks` in non-terminal state with no recent activity | Custom scoring by `priority` field + days since `updatedAt`. |
| Playbook runs awaiting input/approval | `playbook_runs` / `playbook_step_runs` with `awaiting_input` or `awaiting_approval` | Age-weighted. |
| Failed runs needing a retry decision | `agent_runs` with terminal failure status and no follow-up action | Weighted by cost of the failure. |

### Scoring

Not a fixed formula — a service with a tunable scoring function. Suggested initial heuristic:

```
score = severity_weight × age_factor × assignment_relevance
```

Where:
- `severity_weight` — critical=1.0, warning=0.6, info=0.3 (from health findings; other sources map their own severity onto this scale).
- `age_factor` — linear ramp from 1.0 at t=0 to 2.0 at 7 days, capped.
- `assignment_relevance` — 1.0 if the item is assigned to the calling agent or its subaccount, 0.5 if org-wide, 0.1 if cross-subaccount.

Return top N (default 20) sorted descending.

### Surface — a new universal skill

`read_priority_feed` auto-injected into every agent run via `server/config/universalSkills.ts`. Two ops:

- `list` — returns the top N items with id, source, severity, age, one-line description, and a `reason` field (why this scored where it did).
- `claim(id)` — marks the item as in-progress by the calling agent, prevents other agents from double-picking it. Uses an optimistic lock with a short TTL in case the agent crashes without releasing.

Agents use it like:

1. Heartbeat wakes agent.
2. Agent calls `read_priority_feed op='list'`.
3. Agent reads the top 3 items, decides which one is in its wheelhouse.
4. Agent calls `read_priority_feed op='claim' id=<x>`.
5. Agent does the work.
6. On completion, the underlying source record is updated (review approved, finding resolved, inbox item answered), which automatically removes it from the next feed query.

### Concrete example — what agents see

Call returns (example payload):

```json
[
  {
    "id": "finding_abc123",
    "source": "health_findings",
    "severity": "critical",
    "ageHours": 72,
    "description": "Churn-risk agent for Acme has been failing on cost_exceeded for 3 consecutive runs",
    "reason": "critical severity × 72h age × assigned to this subaccount"
  },
  {
    "id": "review_def456",
    "source": "review_items",
    "severity": "high",
    "ageHours": 36,
    "description": "3 review items awaiting approval for >24h on Wayne Enterprises board",
    "reason": "high severity × 36h age"
  },
  {
    "id": "inbox_ghi789",
    "source": "agent_inbox",
    "severity": "medium",
    "ageHours": 6,
    "description": "Orchestrator blocked on clarifying question from 6h ago",
    "reason": "medium severity × 6h age × blocking downstream work"
  }
]
```

### Effort

Medium. Roughly:
- New service `priorityFeedService` (impure) + `priorityFeedServicePure` (scoring function, unit-testable)
- New skill file `read_priority_feed.md` + `actionRegistry` entry with Zod schema
- Register in `universalSkills.ts`
- Tests on the pure scoring function

No schema changes. All sources already have the data; this is a read-layer aggregation.

### Priority

**P1.** Valuable only if there are heartbeat agents that can act on it. Build after the Ops Dashboard is shipped so operators can see the feed's outputs and judge whether the scoring heuristic is right before agents start using it blindly.

### Out of scope (v1)

- No learned scoring — scoring is static weights, not ML. v2 can tune weights from HITL rejections.
- No per-agent feed customization — every agent gets the same ranked list, filtered by assignment relevance. v2 can add per-agent filters for "only show me items I can act on."
- No user-facing view of the feed — this is an agent-facing skill. Humans see the same data via the Ops Dashboard.

---

## 3. Skill Studio

> **⚠️ Depends on skills-from-files-to-DB migration.** Do not start this feature until that migration is complete. The migration simplifies this feature's trust boundary significantly — see the "Adjustments for DB-backed skills" subsection below.

### Purpose

A chat-driven authoring surface for refining skill definitions and master prompts based on observed regressions, mirroring the pattern we already have for Playbook Studio. Closes the feedback loop between `regression_cases` (which we already capture) and skill / master-prompt updates (which today require a developer in the middle).

### Problem it solves

Today:
- `regression_cases` auto-captures rejected review items into a per-agent ring buffer (migration 0083).
- `scripts/run-regression-cases.ts` replays them for regression testing.
- But the *close* half of the loop — "now update the skill or master prompt so this class of failure doesn't recur" — requires a developer to manually read the regressions, decide what to change, edit the markdown or DB field, and ship it.

Skill Studio removes the developer from the loop. A system admin (and eventually the platform itself via a `platform-maintainer` agent) can refine skills chat-first, with simulation against captured regressions proving the fix works before it ships.

### Relationship to the Skill Analyzer (complementary, not overlapping)

The platform already has a `SkillAnalyzerPage` and a corresponding spec at `docs/skill-analyzer-spec.md`. These two features cover different halves of the skill lifecycle and should coexist:

| Feature | Stage | What it does |
|---|---|---|
| **Skill Analyzer** (exists) | Intake | Import external skills from paste / upload / GitHub URL, compare against existing library via hybrid pipeline (hash → embedding → LLM), classify as `DUPLICATE` / `IMPROVEMENT` / `PARTIAL_OVERLAP` / `DISTINCT`, operator decides what to absorb |
| **Skill Studio** (this feature) | Refinement | Take a skill already in the library, refine it based on observed regressions, simulate against captured failures, save a new version |

```
External skill → Skill Analyzer → library → Skill Studio → refined skill
  (intake)                                      (refinement)
```

They share infrastructure: embeddings, simulation harness, version history. They should both live as entry points from `SystemSkillsPage` (and `AdminSkillsPage` for org-scope):

- **On `SystemSkillsPage`:** the existing "Analyze & Import" button (Analyzer) plus a new per-skill "Refine in Studio" button / link.
- **On `AdminSkillsPage`:** org-tier Studio access for refining org-owned skills (and eventually writing per-org overrides of system skills).

Skill Studio is not a replacement for Skill Analyzer. It's the missing refinement half.

### How regressions are captured and stored (what Studio reads from)

The regression capture pipeline already exists (Sprint 2 P1.2, migration 0083). Skill Studio is a consumer of this pipeline — it doesn't add to it. The existing flow:

1. **Trigger.** A human rejects a review item via `reviewService.ts`. The service calls `queueService.enqueueRegressionCapture({ reviewItemId, organisationId })`.
2. **Queue.** A pg-boss `regression-capture` job is enqueued.
3. **Worker.** `regressionCaptureService.captureRegressionFromRejection()` runs asynchronously. It loads the review item, the linked action, the agent run, and the run snapshots.
4. **Materialise.** `regressionCaptureServicePure.materialiseCapture()` builds a deterministic snapshot and inserts a row into `regression_cases`.

**What gets stored (`regression_cases` columns):**

| Column | Contents |
|---|---|
| `inputContractJson` | Materialised snapshot of the agent's state at rejection: system prompt, tool manifest, trimmed conversation transcript, run metadata |
| `rejectedCallJson` | The tool call the human rejected: `{ name, args }` canonicalised |
| `rejectionReason` | Reviewer's free-text note |
| `inputContractHash` | sha256 of canonicalised contract — used to mark cases `stale` when the agent's contract drifts |
| `rejectedCallHash` | sha256 of `${toolName}:${canonicalise(args)}` — the assertion key |
| `status` | `active` / `retired` / `stale` |
| `lastReplayedAt` / `lastReplayResult` / `consecutivePasses` | Populated by the replay harness |

**Lifecycle:** per-agent ring buffer capped by `agents.regression_case_cap` (default `DEFAULT_REGRESSION_CASE_CAP` from `server/config/limits.ts`). When the cap is hit, the oldest `active` case is moved to `retired`. The suite always reflects the most recent rejections.

**Best-effort capture:** if the source run, snapshot, or action was already pruned by retention when the job runs, the capture is silently skipped. Regression capture is additive, not on the critical review path.

### Everyday usage flow — rejection to Studio display

1. During normal operation, humans reject review items when an agent's proposed action is wrong.
2. Each rejection auto-captures to `regression_cases` via the pg-boss job. **Zero operator effort.**
3. The agent's recent rejections accumulate in the per-agent ring buffer.
4. When the operator opens Skill Studio for `draft_report`, the `skill_read_regressions` skill queries `regression_cases` filtered by `agentId` (and optionally `rejectedCallJson->>'name' = 'draft_report'` for skill-specific filtering).
5. The cards shown in the regression pane come directly from this table.
6. `skill_simulate` replays the proposed new skill definition against each captured `inputContractJson` and checks whether the new version still emits a call matching `rejectedCallHash`. If the new call hash differs, the regression is marked "resolved by this fix" in the simulation output.

### Gotcha to flag for build time — filtering by skill, not agent

`regression_cases` is indexed by `agentId` and `rejectedCallHash`, not by skill slug. To list regressions "for this skill specifically," Studio has to filter by `rejectedCallJson->>'name' = <skillSlug>`. v1 can scan and filter in memory; if cardinality becomes a problem, add a functional index on `(agentId, (rejectedCallJson->>'name'))`.

Also note: a single regression may span **multiple skill edits** before it's resolved — the first skill fix might resolve 3 of 4 captured failures, leaving the 4th which is actually a different issue entirely. Studio should classify unresolved regressions as `skill-fixable` / `master-prompt-fixable` / `bug` / `data` after simulation, so the operator knows which ones to come back to.

### Mirror of Playbook Studio

Playbook Studio already solves the equivalent problem for playbooks. Skill Studio mirrors that pattern part-for-part:

| Playbook Studio | Skill Studio equivalent |
|---|---|
| `PlaybookStudioPage` at `/system/playbook-studio` | `SkillStudioPage` at `/system/skill-studio` |
| `playbook-author` system agent | `skill-author` system agent |
| Skills: `playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save` | Skills: `skill_read_existing`, `skill_read_regressions`, `skill_validate`, `skill_simulate`, `skill_propose_save` |
| `playbookStudioService` — validate/simulate/estimate/render/save-and-open-pr | `skillStudioService` — validate/simulate/propose-save |
| Trust boundary: `/save-and-open-pr` deterministically renders the file body | Trust boundary: `/save` validates and writes directly to the DB (with DB-backed skills — see below) |
| Definition-hash stamp in the committed file | Version history row in `skillVersions` table |

### Adjustments for DB-backed skills

The original file-based design assumed skills live in `server/skills/*.md` and edits flow through a PR. With the in-flight migration moving skills to database entries, the design simplifies in four meaningful ways:

1. **No PR flow for writes.** The trust boundary moves from "server renders markdown file + commits + opens PR" to "server validates the proposed definition + writes a row to the DB." Immediate effect, no deploy required. Faster iteration loop.
2. **Native versioning.** Instead of git history, use an immutable `skill_versions` table (same pattern as `playbookTemplateVersions`). Every save creates a new version; the "current" pointer on the skill row flips atomically. Rollback is a pointer flip. Diffing any two versions is a SQL query.
3. **Per-org overrides become first-class.** The skill resolution cascade (`systemSkillService` → `skills` table) already supports this. Skill Studio at org scope writes to the `skills` table with an `overridesSystemSlug` pointer, taking effect only for that org. System-admin-tier edits write to `systemSkills` and affect every org.
4. **Simulation is faster.** With skills in the DB, `skill_simulate` can dispatch the new version as a drafted-but-not-committed skill against regression fixtures without needing to checkout or stage files. Simulation becomes a pure service call.

The file-based design's "open PR" flow is not gone forever — it's still useful for system skills that need code review on instruction changes. But it becomes an optional secondary path, not the primary flow.

### Walkthrough (what a system admin actually does)

**Step 1 — Open Skill Studio.** Sidebar → "Skill Studio." Land on a list view of every skill with columns: name, scope (system/org), last refined, open-regression count. Sort by regression count — top of the list is your work queue.

**Step 2 — Open a skill.** Click `draft_report` (example). Page splits into three panes: current definition (read-only), regression feed (cards showing rejected outputs + reviewer notes + timestamps), chat window with `skill-author` agent already seeded with context.

**Step 3 — Read the regressions.** Skim the cards to find the pattern, or ask the author agent to summarize: "These 4 rejected for the same reason — YoY comparison missing on long-range reports."

**Step 4 — Propose a fix.** Ask the author agent for an update. It calls `skill_read_existing` and `skill_read_regressions`, proposes an edit, and shows the diff in the left pane.

**Step 5 — Simulate.** Click "Simulate." The `skill_simulate` skill runs the new version against the captured regression fixtures and reports which regressions would now pass. This is critical — it turns "I hope this fix works" into "this fix provably resolves 3 of the 4 captured failures, and I now know the 4th is a different problem entirely."

**Step 6 — Edit in place if needed.** The proposed diff is editable directly in the Studio UI. Validation runs continuously.

**Step 7 — Save.** Two buttons:
- **"Save to org"** — writes a new row in the `skills` table with `overridesSystemSlug` pointing at the system skill. Takes effect on the next agent run for that org. No deploy.
- **"Save system-wide"** — system_admin only. Writes a new row to `systemSkills` and creates a `skillVersions` entry. Affects every org immediately on next run.

**Step 8 — Classify remaining regressions.** Any regressions the proposed fix didn't resolve get classified:
- `skill-fixable` — another skill edit can catch it
- `master-prompt-fixable` — it's an agent-wide behavior issue, not skill-specific → route to master prompt editor
- `bug` — failure reason is `execution_error` or `environment_error` → create a triage task
- `data` — agent lacked context → route to data source config

The `skill-author` agent does this classification automatically and flags each remaining regression with its category.

**Step 9 — Verify a week later.** Come back to Skill Studio, sort by regression count. If `draft_report` shows 0 new regressions since the save, the fix worked. If it doesn't, iterate.

### Master prompt refinement (in scope)

Skill Studio also targets master prompts, not just skills. Master prompts live in `agents.masterPrompt` and `systemAgents.masterPrompt` — already DB-backed. Some regressions are about the agent's overall behavior ("agent was too terse", "agent forgot to introduce itself"), which is a master-prompt fix not a skill fix. Studio should route these automatically based on regression classification.

### Weekly ritual (what the operator rhythm looks like)

- 15 min: open Studio, sort by regression count, skim top 5 skills
- 5–15 min per skill: read regressions, chat with author agent, simulate, save
- Roughly 30–60 min total for a typical week
- Scales linearly with fleet size — becomes essential once the fleet grows past what a single developer can manually monitor

### Effort

Medium–Large. Mirrors the shape of Playbook Studio, which is already shipped. Estimated roughly equivalent effort to that feature (not counting the skills-to-DB migration, which is the hard part and is being done independently). The author agent, its five skills, the simulation harness, the save endpoint, and the UI page are all net-new. The `skill_versions` table is net-new.

### Priority

**P1.** Becomes genuinely essential once fleet growth outpaces manual developer maintenance of skill definitions. Not day-one, but within a few months of scaling. Blocked on the skills-to-DB migration.

### Out of scope (v1)

- No automatic application of fixes. Every change requires a human to click save.
- No A/B testing of skill versions. A new version replaces the old version on save. v2 could add shadow-mode where both versions run and outputs are compared.
- No bulk-refine across skills. One skill at a time.
- No author-agent-initiated refinement. The author agent only runs when an operator opens a Studio session. v2 could have a `platform-maintainer` agent that proactively scans for high-regression skills and drafts fixes for human review.

---

## 4. Slack Conversational Surface

### Purpose

Turn Slack from an output-only notification channel into a bidirectional conversational surface where team members can talk to agents directly, agents can respond in-thread, HITL escalations surface as interactive messages with approve/reject buttons, and the whole team gets visibility into agent conversations without needing training on the admin UI.

### Problem it solves

The forum post's exact framing: "the key wasn't notifications, it was real conversations plus team visibility." The current Slack integration is skewed toward output — the `send_to_slack` skill pushes messages out, `slackWebhook.ts` ingests events from integrations, but there's no conversational path where a team member can DM an agent and get a threaded response. All interactive agent workflows (HITL approvals, clarifying questions, status checks) happen in the admin UI, which means team members who don't live in that UI are effectively locked out of the agent fleet.

This feature closes that gap, making the agent fleet feel like team members in Slack rather than a bot that posts status messages.

### This feature extends the existing integration — it does not replace it

The current Slack integration already has substantial infrastructure that this feature reuses unchanged:

| Existing piece | File | Reused by this feature |
|---|---|---|
| Multi-tenant inbound webhook with HMAC signature verification + replay protection | `server/routes/webhooks/slackWebhook.ts` | Yes — new event handlers hook in at the normaliser |
| Multi-workspace support via connector configs | `connectorConfigService` + `connectorConfigs` table | Yes — one Slack bot per workspace, same pattern |
| Adapter layer with event normalisation | `server/adapters/slack/` | Yes — new event types plug into the existing adapter |
| Webhook dedup store | `webhookDedupeStore` | Yes |
| Slack OAuth flow for workspace linking | `oauthIntegrations.ts` + `integrationConnections.ts` | Yes |
| Outbound messaging service | `sendToSlackService.ts` | Yes — reused for agent replies |
| `send_to_slack` skill for output | `server/skills/send_to_slack.md` | Yes |

Crucially, `slackWebhook.ts` already contains this exact comment: *"Future: publish to event bus / pg-boss queue for agent processing."* That future is this feature. The existing webhook normalises events and currently just logs them; the new work publishes the normalised events to a pg-boss queue that dispatches to agent runs.

**What this feature adds on top of the existing integration:**

- Event handlers for `app_mention` and `message.im` (currently the webhook ingests but doesn't dispatch)
- Agent dispatch on @mention, routed via pg-boss into the standard agent run infrastructure
- A new `slack_conversations` table mapping `(workspace_id, channel_id, thread_ts)` → `agent_conversation_id` for thread continuity
- Interactive Block Kit message rendering for review items, with action IDs that feed back into `reviewItems` via the existing HITL service
- Slack user ↔ org user linkage (either a new `users.slackUserId` column or a row in `integrationConnections`, TBD)

### New capabilities

1. **DM an agent, get a threaded reply.** A user DMs the Slack bot (or @mentions an agent in a channel), the bot dispatches to the right agent, the agent runs, and the response lands in the same thread. Follow-ups in the thread continue the conversation — `thread_ts` maps to a conversation id, so context persists across messages.

2. **@mention routing to specific agents.** `@ReportingAgent what's the churn rate for Acme this week?` vs `@ChurnRiskAgent analyze the Acme pipeline` — the Slack bot dispatches to the right subaccount agent based on the mention + channel context. Multiple agents can coexist in the same channel.

3. **Review items as interactive messages.** When a `reviewItem` is created, instead of only landing in the in-app review queue, it also posts to a configured Slack channel as a Block Kit message with Approve / Reject / Ask-for-changes buttons. The button action flows back through a webhook, maps the Slack user to an org user, and writes to `reviewAuditRecords` the same way the in-app flow does. HITL latency collapses because approvers don't have to switch apps.

4. **Clarifying questions DM the task owner.** When `ask_clarifying_question` fires inside a run, instead of the question only landing in `agent_inbox`, the bot DMs the task owner directly with the question + thread context. They answer in Slack, the answer flows back, the run resumes.

5. **Channel visibility for team.** Agent-worked channels become a transparent record of what agents are doing for that project. Team members who aren't in the admin UI can still see the work, interject, and course-correct.

6. **Threaded status updates.** Long-running tasks can post progress updates into their own thread, so the channel doesn't get flooded and follow-ups stay contextual.

### How the bot knows what channels to listen to (+ DMs)

Two layers — one controlled by Slack, one controlled by us.

**Layer 1 — Slack controls event delivery.** The Slack Events API only delivers events for channels the bot has been explicitly added to (via `/invite @botname` by a workspace admin), plus any DM to the bot (`message.im`). There is no "configure which channels to listen to" on our side — we listen to whatever Slack delivers. This is Slack's authorisation boundary and we inherit it for free.

**Layer 2 — we control which agent responds to each delivered event.** Routing is configured via an admin UI backed by a new `slack_channel_subscriptions` table mapping `(workspace_id, channel_id) → subaccount_agent_id`. Routing rules per event type:

| Event type | Routing rule |
|---|---|
| `app_mention` (explicit `@AgentName` in a channel) | Parse the mention, look up the named agent in the caller's org, dispatch. Mention wins over channel default. |
| `message.channels` / `message.groups` (any message in a channel the bot is in, no mention) | Silently ignored **unless** the channel has a default agent in `slack_channel_subscriptions`. If so, route there. Lets project channels have a default agent for follow-up messages in threads. |
| `message.im` (DM to the bot) | **Always handled.** Primary 1:1 conversational surface. Routes to: (a) the agent named in an `@mention` if the DM starts with one, (b) the user's default subaccount agent otherwise, (c) fallback `"which agent did you want?"` prompt if nothing resolves. |

**DMs are a first-class surface.** A team member can DM the bot directly without being in any channel, and get threaded replies. The `thread_ts` of the first message becomes the conversation id, and all subsequent messages in that thread belong to the same agent conversation via `slack_conversations`.

**Channel subscription config UI.** New admin page (or a panel on an existing integrations page) where operators map channels to default agents. Only orgs with a linked Slack workspace see this. System admins can manage across all orgs; org admins manage their own org's mappings. Subaccount admins can configure only their own subaccount's channels.

**Thread stickiness.** Once a thread starts with a given agent (via @mention or channel default), all subsequent messages in that thread route to the same agent, regardless of whether later messages also @mention. This prevents a single thread from flipping between agents mid-conversation.

### Tech sketch

- **Event handling via the existing webhook + new dispatchers.** The existing `slackWebhook.ts` already verifies signatures, deduplicates, and normalises events. New work subscribes additional event types (`app_mention`, `message.im`, `message.channels`, `interactive.block_actions`) and publishes them to a pg-boss `slack-inbound` queue — exactly as anticipated by the TODO comment already in the code.
- **Slack user → org user mapping.** Either a new `users.slackUserId` column or a row in `integrationConnections`. Either way, mandatory linkage before a Slack user can act on review items — the authorization boundary.
- **Conversation persistence.** Slack `thread_ts` becomes the key of a new `slack_conversations` table mapping `(workspace_id, channel_id, thread_ts)` to an `agent_conversation_id`. Every message in a thread writes to the same conversation, which the agent reads on each message to get context.
- **@mention dispatch.** Channel metadata determines which subaccount agents are "subscribed" to that channel. When an @mention fires, the dispatcher looks up the intended agent, enqueues an agent run with the Slack message as input, and uses the standard execution infrastructure. No agent-execution changes needed.
- **Bot process.** Runs in the main app process or as a separate worker, TBD. Main-app is simpler and reuses existing webhook plumbing; worker is more scalable. Leaning main-app for v1 since the existing webhook handler already lives there.
- **Interactive review flow.** Block Kit messages include action ids that the webhook handler parses. The handler validates the Slack user is authorized to act on the review item via the user mapping, then writes to `reviewItems` via the existing HITL service. Same code path as the in-app button.

### Benefits

- **HITL latency collapses.** Today approvers have to remember to check the in-app queue. In Slack, they get a DM with buttons — decision in seconds instead of hours.
- **Team visibility without admin UI training.** Non-admin team members see agent work land in project channels. No learning curve.
- **Conversations feel natural.** Instead of a separate chat UI, agent conversations happen where the team already is.
- **Review throughput goes up** because reviewing is one click from wherever the reviewer is, not a context switch.
- **Agents become team members, not dashboards.** Psychological shift — agents are entities you talk to, not systems you monitor.
- **Clarifying questions unblock faster** because they DM the right person directly instead of waiting in an inbox someone has to remember to check.
- **Reuses all existing Slack integration work** — multi-tenant webhook, OAuth, adapters, dedup, outbound messaging all stay as-is. This is an additive layer, not a rewrite.

### Effort

Medium. Slack Bolt is mature, the conversation persistence is a new table, the @mention routing is a thin dispatcher. The review-button flow is the trickiest piece because it's the authorization boundary — a Slack button click needs to be validated as "this Slack user is authorized to approve this item in this org." Most of the work is integration plumbing, not agent-execution changes.

### Priority

**P1.** Value scales with how much any given org's team lives in Slack. For Slack-first teams this is a major UX upgrade; for teams that don't use Slack this is irrelevant. The HITL latency improvement alone justifies building it for any Slack-using org. Feature gates per-org via the existing Slack connector config — orgs that don't link a Slack workspace don't see this functionality.

### Out of scope (v1)

- No Microsoft Teams equivalent. v1 is Slack only.
- No voice / audio message handling. Text only.
- No cross-channel conversation continuity — a thread is a conversation; starting a new thread is a new conversation. v2 could do smart linking via `workspace_memory`.
- No agent-initiated DMs without a triggering event. The agent can only message a user in response to something (review item, clarifying question, scheduled task targeting that user). v2 could allow proactive DMs with policy engine gating.
- No Slack-native rich UI for complex flows (forms, multi-step approvals). v1 keeps it conversational + simple buttons. Complex flows stay in the admin UI.

---

## 5. Cross-Agent Memory Search

### Purpose

Expose the existing `workspaceMemories` embeddings as a first-class retrieval skill, so agents can search what other agents have done and learned — not just their own history. Turns per-agent memory into team memory.

### Problem it solves

Today every agent has access to its own workspace memory via the standard retrieval flow, plus any shared `memoryBlocks` an admin has explicitly attached. But "what does the Revenue agent know about Acme?" is not a query the Churn agent can make. The embeddings exist, the scoping exists, the decay job exists — what's missing is a single skill that lets an agent search across the team's collective knowledge.

### Existing infra (all the heavy lifting is done)

- `workspaceMemories` table with embeddings via pgvector
- `memoryDecayJob` clears stale entities on a schedule
- Per-subaccount org scoping already applied to every query
- Embedding index supports semantic search
- `MAX_EAGER_BUDGET` (60k tokens) caps the knowledge base layer so flooded searches can't blow the context window

This feature is genuinely close to "wire up existing primitives as a new skill."

### Operating model — fully automated, zero-touch

This feature is a **capability**, not a **workflow**. After v1 ships there is nothing for an operator to configure, trigger, or maintain:

- The skill is auto-injected into every agent run via `universalSkills.ts`, same as `read_data_source` and `update_memory_block`.
- Agents decide when to call it based on their own reasoning — no human trigger.
- There is no user-facing UI. The only visibility is via the standard tool-call trace in `RunTraceViewerPage`.
- No background batch jobs. Retrieval happens in-line when the agent calls the skill.
- No operator rituals. You turn it on, and from that moment every agent silently gains the ability to search the team's collective memory whenever it decides that's useful.

Humans are not in the loop for this feature at all after the initial deploy. Agents are the sole consumer.

### Observability — how you see if/when agents are using it

Because it's a normal skill call, every invocation is visible through existing observability infrastructure with zero additional work:

- **Per-run trace:** every call to `search_agent_history` creates a row in the `actions` table and renders in `RunTraceViewerPage` alongside the rest of the run's tool calls. You see the query, the results returned, the duration, and the cost.
- **Agent run history:** `SessionLogCardList` and `AgentRunHistoryPage` already display tool calls per run — cross-agent memory searches show up in the same list.
- **Usage queries:** "How often are agents using this?" → query `actions` table by action name. "Which agent searched for what yesterday?" → filter by `agentRunId` + action name. No new telemetry needed.
- **Cost attribution:** the skill goes through `runCostBreaker` like every other external-call skill, so per-run cost breakdown captures memory search spend automatically in `costAggregates`.

Nothing new needs to be built for observability — it comes free with the existing trace and usage infrastructure.

### The skill

New universal skill: `search_agent_history`. Ops:

- `search(query, scope?, includeOtherSubaccounts?)` — semantic search over `workspaceMemories`, default scope is the current subaccount, `includeOtherSubaccounts: true` expands to the whole org. Returns top K results (default K=10) with `score`, `sourceAgentId`, `sourceSubaccountId`, `createdAt`, `summary`.
- `read(memoryId)` — fetch the full content of a single memory, bounded by existing token limits.

Auto-inject into every agent run via `universalSkills.ts`.

### Scalability analysis — the question you asked

At 15 agents × 100 subaccounts × 1000 tasks each:

- **Capacity:** each task run generates ~5–10 memory entities × ~10 runs/task lifetime ≈ ~5–10M memory rows at steady state. pgvector with an HNSW index handles single-digit-millions at sub-100ms retrieval. The scope filter (`organisationId`, `subaccountId`) is indexed, bounding the vector scan before it starts. **Well within limits.**
- **Signal-to-noise at scale:** at 10M rows, pure cosine similarity starts surfacing semantically-similar-but-irrelevant junk. Fix is hybrid ranking — recency decay × similarity × tag match. Not a scalability blocker, a tuning concern.
- **Chatty-agent flooding:** one noisy agent that writes 10k memories/day drowns out everyone else. Fix is per-agent write quotas and/or a summarization tier that rolls up old memories into distilled entities.

### Build order recommendation

**v1 (ship first — half day):**
- The `search_agent_history` skill with top-K retrieval
- Default scope = current subaccount
- `includeOtherSubaccounts: boolean` flag for cross-subaccount search (off by default)
- Register in `universalSkills.ts`

**v2 (build only if telemetry shows it's needed):**
- Hybrid ranking (recency × similarity × tag match)
- Summarization tier for memories older than N days — daily job rolls up into distilled "what this agent knew about X" entities
- Per-agent write quotas to prevent flooding
- New index on `(organisationId, subaccountId, type, createdAt DESC)` for filtered scans

**Do not preemptively build v2.** The v1 primitives plus the existing decay job will carry well past the 100-subaccount mark. Tune once real telemetry shows noise at scale. The half-day v1 is enough to validate the value proposition.

### Effort

Tiny. Half day for v1. Plumbing already exists — this is one skill file, one service method, one registry entry.

### Priority

**P2.** Quick win. Bundle with Feature 1 (Ops Dashboard) on the same branch for a fast, high-value first delivery. Both are cheap, both are unblocked, both are immediately useful.

### Out of scope (v1)

- No cross-org search. System_admin might want this but it's not worth the complexity for v1.
- No write path. Agents write to their own workspace memory via existing flows; this skill is read-only.
- No search-result caching. Every call hits pgvector fresh. At current scale that's fine.
- No summarization tier (see v2 above).

---

## Build Order, Dependencies & Open Questions

### Recommended build sequence (not a schedule)

**Wave 1 — immediate visibility + quick win (bundle on one branch)**
- Feature 1: Ops Dashboard (P0)
- Feature 5: Cross-Agent Memory Search v1 (P2 freebie)

Rationale: both are unblocked, both are cheap, bundling them delivers operational visibility + cross-agent knowledge in the same release. The dashboard gives you the "what is the fleet doing" view; the memory skill gives agents the "what does the team know" query. Together they establish the baseline for everything downstream.

**Wave 2 — Breakout-specific conversational value**
- Feature 4: Slack Conversational Surface (P1)

Rationale: Breakout lives in Slack. Collapsing HITL latency and giving the team in-Slack visibility pays off immediately. Can be built in parallel with Wave 3 if resourcing allows — no dependency.

**Wave 3 — agent autonomy uplift**
- Feature 2: Prioritized Work Feed (P1)

Rationale: only valuable if the Ops Dashboard is already shipped so operators can see the feed's output and judge whether the scoring heuristic is right before agents act on it. Also genuinely only unlocks value once there are heartbeat agents with enough latitude to pick their own work.

**Wave 4 — feedback loop closure (blocked on upstream)**
- Feature 3: Skill Studio (P1)

Rationale: blocked on skills-to-DB migration. The migration simplifies this feature's design but must complete first. Once unblocked, Skill Studio closes the last major loop — regression capture → skill refinement → deployment — without requiring a developer in the middle.

### Dependency graph

```
Feature 1 (Ops Dashboard) ─────┐
                               ├── can start immediately
Feature 5 (Memory Search v1) ──┘

Feature 2 (Priority Feed) ─── no hard dependency, but ship after Feature 1 for operator validation

Feature 4 (Slack) ─── no dependencies, standalone

Feature 3 (Skill Studio) ─── BLOCKED on skills-to-DB migration
```

### Priority summary

| Priority | Feature | Rationale |
|---|---|---|
| **P0** | 1 — Ops Dashboard | Biggest trust unlock, cheapest build, fixes acknowledged UI gap |
| **P1** | 2 — Priority Feed | Turns heartbeat into real autonomy, requires Dashboard for validation |
| **P1** | 3 — Skill Studio | Closes feedback loop, blocked on upstream migration |
| **P1** | 4 — Slack | High Breakout-specific value, HITL latency collapse |
| **P2** | 5 — Memory Search | Quick win, bundle with P0 as a freebie |

### Open questions — needs decision at build time

**Cross-cutting**
- How does permission gating compose across these features? Each one has its own implied permission keys; should they share a `org.ops.view` / `org.ops.manage` pair or stay fine-grained?
- Do we want a single "agent-coworker" feature flag that gates all five, or per-feature flags? Leaning per-feature.

**Feature 1 — Ops Dashboard**
- **Extend `SystemActivityPage` in place, or build net-new?** Leaning extend-in-place (rename it to Ops, add new panels alongside the existing engine executions panel) to avoid UI sprawl. Needs confirmation before build.
- Real-time updates v1: polling every 10s, or WebSocket-based? Polling is simpler and almost certainly fine.
- Do we want custom user-saved views, or is a single canonical layout enough for v1?
- Does the "Decisions log" panel need a separate permission beyond `org.health_audit.view`?
- How does the system-level view join data across orgs — one query per org or a single multi-org query? The existing `/api/system/executions` endpoint pattern is a template.

**Feature 2 — Prioritized Work Feed**
- Initial scoring weights — do we start with the heuristic in this brief, or calibrate against captured regressions first?
- Should `claim()` be hard-locking (one agent, exclusive) or soft (advisory, multiple agents can observe but only one should act)?
- How does the feed interact with `subtaskWakeupService`? Reactive wake-ups are already a priority signal — does the feed subsume them or complement them?
- How does `tasks.position` (kanban order) translate into a score contribution alongside `tasks.priority`? Needs a concrete formula at build time — e.g. priority tier sets the bucket, position sets the intra-bucket order.
- Do we want to add automatic priority escalation when a task ages past a threshold, or leave that as a v2 concern?

**Feature 3 — Skill Studio**
- Once skills are DB-backed, what does the migration path from existing `server/skills/*.md` files look like? Does it happen in the migration itself, or does Studio include a "import from file" flow?
- Does Skill Studio need multi-user concurrent editing, or is single-editor-per-skill enforced via advisory lock enough?
- How does versioning interact with the existing `regression_cases` replay harness — do we replay against the version that was live when the regression was captured, or the current version?
- Should system-tier edits still go through a PR flow as an optional secondary path for code-review-required changes? (Recommendation: yes, keep it as an option, default to direct DB write.)
- How much infrastructure should Skill Studio share with Skill Analyzer? Both need embeddings, simulation, and version history. Consolidate into a shared `skillPipeline` service layer, or keep them separate for now?
- Button placement on `SystemSkillsPage` / `AdminSkillsPage` — per-skill "Refine in Studio" action on each row, plus a top-level "Skill Studio" link in the sidebar? Needs a UX decision at build time.

**Feature 4 — Slack Conversational Surface**
- Does the Slack bot run in the main app process or as a dedicated worker? Main-app is simpler; worker is more scalable. Leaning main-app for v1.
- Slack user → org user mapping: new `users.slackUserId` column, or via `integrationConnections`? Column is simpler but couples the `users` table to a specific integration.
- How do we handle a Slack user who isn't linked to an org user yet but @mentions an agent? Refuse, or offer a self-serve link flow?
- What's the decay / retention policy on `slack_conversations`? Conversations can accumulate indefinitely.
- Review buttons in Slack: do we require the Slack user to also be signed in to the web app for the authorization check, or is Slack OAuth + org-user mapping enough?

**Feature 5 — Cross-Agent Memory Search**
- Default top-K value? Leaning K=10 but needs validation.
- When `includeOtherSubaccounts: true`, should results be tagged so the agent knows which subaccount each came from? (Recommendation: yes, always.)
- Do we want a per-query audit log entry (for "who searched for what") or is the standard tool-call log enough? Probably the standard log.

### Non-goals

Explicit non-goals for all five features combined, so scope doesn't creep at build time:

- Not building a new agent runtime. All five features sit on top of the existing execution infrastructure.
- Not replacing Playbook Studio. Skill Studio is the sibling feature, not a replacement.
- Not building an LLM-based scoring model for the priority feed. Static heuristic v1; ML only if telemetry shows it's needed.
- Not replacing the in-app admin UI with Slack. Slack is an additional surface, not a replacement. Complex workflows stay in the admin UI.
- Not building cross-org search or memory. Org scoping remains the hard boundary.
- Not introducing new agent types or tiers. Three-tier agent model (System → Org → Subaccount) stays unchanged.

### How to resume this brief when it's time to build

1. Read this brief end-to-end.
2. Check the state of the skills-to-DB migration. If complete, Feature 3 is unblocked.
3. Re-read `architecture.md` to catch any drift between this brief and the current codebase.
4. Pick a wave, expand it into a proper spec in `docs/`, and run it through `spec-reviewer` before starting implementation.
5. Follow the standard task classification in `CLAUDE.md` — most of these features are Significant or Major and need `architect` first, then implementation, then `pr-reviewer` → `dual-reviewer`.

---

_End of brief._
