---
title: Routines Response — Development Specification
date: 2026-04-16
status: draft
input: audit response to Anthropic Routines launch (YouTube transcript analysis, 2026-04-16)
revision: 1
---

# Routines Response — Development Specification

## Table of contents

1. Summary
2. Context and rationale
3. Feature 1 — Scheduled Runs Calendar
4. Feature 2 — Inline Run Now test UX
5. Feature 3 — n8n Workflow Import
6. Feature 4 — Positioning refresh (`docs/capabilities.md`)
7. Feature 5 — Strategic stance preservation
8. Build order and dependencies
9. Migration inventory
10. Verification plan
11. Open items and deferred work

<!-- Sections are filled in the order above. Every net-new file path, table, route, and component is enumerated before implementation begins. -->

---

## 1. Summary

This spec translates the audit response to Anthropic's Routines launch into implementation-ready detail. Three user-facing builds (calendar grid, inline Run Now, n8n import) close the three UX gaps surfaced by the audit; one documentation update (`docs/capabilities.md`) absorbs Routines into the positioning framework; one strategic stance (no pitch drift toward "we have agents too") is codified in `CLAUDE.md` so future sessions preserve it.

**What this spec produces when fully implemented:**

- A **Scheduled Runs Calendar** page that visualises the next 7–30 days of scheduled runs across an org or subaccount (heartbeat + cron + recurring playbook + scheduled task occurrences all on one grid) — Feature 1
- An **inline Run Now test panel** on the agent and skill authoring pages, with live-streaming run output, tool-call timeline, and token/cost accounting — no page change required to test an edit — Feature 2
- An **n8n Workflow Import** skill (`import_n8n_workflow`) that parses n8n JSON and produces a draft playbook definition the admin can review, edit, and save via the existing Playbook Studio save-and-PR flow — Feature 3
- A **refreshed positioning section** in `docs/capabilities.md` that names the scheduled-prompt / hosted-routine product category as a distinct competitor class and ships net-new objection-handling copy tuned to it — Feature 4
- A **strategic stance update** in `CLAUDE.md` that reaffirms the non-goal "Automation OS does not compete with LLM-provider primitives" — Feature 5

**North-star acceptance test:** An agency owner running a live demo can (a) open the Scheduled Runs Calendar and show the client "here is everything my agents will do for you next week"; (b) edit an agent's additional prompt, click Run Now on the same page, and watch the test run stream through the inline panel; (c) paste an n8n workflow JSON into the config assistant, receive a validated playbook draft, review it in Playbook Studio, and save it via the existing PR flow — all without leaving the product.

**Build order rationale:** Feature 4 (positioning refresh) and Feature 5 (strategic stance) are doc-only and ship first, in the same commit as this spec, so all subsequent work is done under the updated narrative frame. Feature 1 (calendar) is independent of the other builds and has the clearest ROI on demos — ship second. Feature 2 (inline Run Now) reuses the existing run-trace streaming infrastructure and is the highest authoring-velocity win — ship third. Feature 3 (n8n import) is the most speculative of the three builds (marketing wedge, not core workflow) and ships last, gated on Feature 1 and 2 shipping cleanly.

---

## 2. Context and rationale

**What happened:** On 2026-04-16 Anthropic launched **Routines**, a scheduled-prompt runner bolted onto Claude Code. A Routine is a natural-language prompt plus three trigger types (schedule, webhook, API), connectors (Gmail, Slack, GitHub, etc.), model selection, and a run-now test button with inline input/output viewing. A calendar grid shows upcoming runs. Sub-agent support exists via "managed sessions."

**Why it matters:** Every primitive in Routines already exists in Automation OS — schedules, webhooks, API triggers, connectors, model selection, handoff up to 5 levels, skills, run history. In several areas (three-tier isolation, 42+ HITL gates, idempotency on every run path, agency P&L attribution, client portal, model-agnostic routing) Automation OS is structurally ahead. But Routines shipped **three UX polish items** we have not yet prioritised: a calendar grid view of scheduled runs, an inline "Run Now" test loop on the authoring page, and a first-class migration wedge from no-code workflow tools (n8n/Make/Zapier). Shipping those three closes the last UX-parity gap and reinforces the real moat (operations layer) rather than apologising for a missing feature.

**What this spec is NOT:**

- **Not** a repositioning. The audit confirmed the strategic frame in `CLAUDE.md` and `docs/capabilities.md` ("LLM providers sell capability; Synthetos sells the business") is correct. Routines is a reason to **sharpen** the pitch, not soften it.
- **Not** a chase for every Routines primitive. We deliberately skip things like a public skill marketplace or a general-purpose chat UI — explicit non-goals in `capabilities.md`.
- **Not** a rewrite of the run or schedule data model. All three features reuse existing tables (`agent_runs`, `scheduled_tasks`, `agents.cron`, `heartbeatEnabled`) and existing services (`agentScheduleService`, `scheduledTaskService`, `agentExecutionService`). No schema migrations are required for Features 1 and 2; Feature 3 adds one skill definition and at most one optional import-audit table.

**Design constraints:**

- Every new surface respects the three-tier isolation model (System → Org → Subaccount). Calendar views are scoped by subaccount by default with an org-wide roll-up for org admins; no cross-org visibility ever.
- Every new run-creation path threads `idempotencyKey` per existing conventions (`server/db/schema/agentRuns.ts`).
- Every new UI component uses the column-header sort/filter pattern per `CLAUDE.md` (tables) and respects `/api/my-permissions`.
- No autonomous-agent language in any copy. Prefer "supervised," "approved," "reviewed."

---

## 3. Feature 1 — Scheduled Runs Calendar

### 3.1 Goal

Give agency owners (and their clients, via the portal) a single calendar grid showing every scheduled agent run, recurring playbook run, and scheduled-task occurrence projected forward 7 to 30 days. Routines ships a calendar view of upcoming routine runs; we ship a superset because our schedule surface is wider (heartbeat + cron + recurring playbooks + scheduled tasks, not just one prompt on a cadence).

### 3.2 Sources of scheduled events

The calendar pulls from four existing schedule surfaces. No new scheduling primitive is added.

| Source | Table(s) | Projection function (new) |
|---|---|---|
| Heartbeat agents | `agents.heartbeatEnabled`, `heartbeatIntervalHours`, `heartbeatOffsetMinutes`; per-link overrides on `subaccount_agents` | `projectHeartbeatOccurrences(agent, link, windowStart, windowEnd)` |
| Cron agents | `agents.cron`, `agents.cronTimezone`; per-link overrides on `subaccount_agents` | `projectCronOccurrences(agent, link, windowStart, windowEnd)` |
| Recurring playbooks | `playbook_runs` with recurring schedule; `playbooks.schedule` JSON | `projectPlaybookOccurrences(playbook, link, windowStart, windowEnd)` |
| Scheduled tasks | `scheduled_tasks.cronExpression`, `scheduled_tasks.timezone`, `scheduled_tasks.isActive` | `projectScheduledTaskOccurrences(task, windowStart, windowEnd)` |

**Projection is read-only and stateless.** No rows are written to predict a run. Occurrences are materialised in memory, merged, sorted, and returned to the client.

### 3.3 Data contract

New endpoint, new service, no new tables.

**Route:** `GET /api/subaccounts/:subaccountId/schedule-calendar?start=ISO&end=ISO` (subaccount-scoped)

**Route:** `GET /api/org/schedule-calendar?start=ISO&end=ISO&subaccountId=?` (org-wide roll-up, filterable)

**Service:** `server/services/scheduleCalendarService.ts` + `scheduleCalendarServicePure.ts` for the projection math (pure, unit-testable, no DB access in the pure half).

**Response shape:**

```ts
type ScheduleOccurrence = {
  scheduledAt: string; // ISO
  source: 'heartbeat' | 'cron' | 'playbook' | 'scheduled_task';
  sourceId: string; // agent id / playbook id / scheduled_task id
  sourceName: string; // agent name / playbook name / task name
  subaccountId: string;
  subaccountName: string;
  agentId?: string;
  agentName?: string;
  runType: 'scheduled' | 'triggered' | 'manual';
  estimatedTokens?: number; // from agent's historical avg
  estimatedCost?: number; // from agent's historical avg, USD
  scopeTag: 'system' | 'org' | 'subaccount';
};

type ScheduleCalendarResponse = {
  windowStart: string;
  windowEnd: string;
  occurrences: ScheduleOccurrence[]; // sorted ascending
  totals: { count: number; estimatedTokens: number; estimatedCost: number };
};
```

### 3.4 Client surface

**New page:** `client/src/pages/ScheduleCalendarPage.tsx` — org-wide calendar for org admins.

**New page:** `client/src/pages/SubaccountScheduleCalendarPage.tsx` — subaccount-scoped calendar for org + client users.

**New component:** `client/src/components/ScheduleCalendar.tsx` — grid renderer. Default view: **week** (7 × 24 grid). Secondary views: **month** (calendar month block), **day** (24-row list), **list** (chronological table with column-header sort/filter per `CLAUDE.md`).

**Interactions:**

- Click an occurrence → side panel with agent/playbook name, next scheduled time, estimated cost, last run status badge, "Edit schedule" link
- Filter bar: subaccount, source (heartbeat/cron/playbook/scheduled_task), agent, scopeTag
- Toggle: "Show estimated cost" — adds per-cell dollar totals
- Empty state: explanatory copy + "Add a scheduled agent" CTA
- Row striping for the active day; current hour rail

**Routing:** Registered in `client/src/App.tsx` via existing lazy-load pattern. Nav entry added to the primary sidebar under "Operations" — org admin only. Subaccount version surfaces under the subaccount detail page tabs.

**Permission:** Gated by `org.agents.view` (org page) and `subaccount.workspace.view` (subaccount page). Portal exposure gated by a new permission `subaccount.schedule.view_calendar` (default granted to `client_user` permission set to make "here's what I'm doing for you next week" a client-portal win).

### 3.5 Client portal surface (stretch)

**Portal card:** `client/src/components/portal/UpcomingWorkCard.tsx` — compact 7-day horizontal strip on the client portal landing, showing the next 5 scheduled items with agent name and ETA. Clicking navigates to the full subaccount calendar. This is the demoable wedge: the client sees *what the agency is doing for them next week*, a surface a Routines dashboard cannot produce by design.

### 3.6 Implementation plan

1. Write `projectHeartbeatOccurrences`, `projectCronOccurrences`, `projectPlaybookOccurrences`, `projectScheduledTaskOccurrences` in `scheduleCalendarServicePure.ts` with unit tests (DST boundaries, heartbeat offset, cron-to-UTC conversion, end-of-window truncation).
2. Write `scheduleCalendarService.ts` wrapping the pure layer with org-scoped DB reads (via `getOrgScopedDb()`) and scope assertions per `server/lib/scopeAssertion.ts`.
3. Mount routes in `server/routes/scheduleCalendar.ts` + `server/routes/index.ts`.
4. Build `<ScheduleCalendar>` grid component with week view first; month and day come after week renders correctly.
5. Add two pages + nav entries + portal card.
6. Backfill estimated-cost calculation by reading last 10 runs per agent from `agent_runs`.

### 3.7 Verification

- Unit tests on pure projection (cron edge cases, DST, offset, interval > 24h, missing cron expression)
- Integration test: seed a subaccount with heartbeat + cron + playbook + scheduled task, hit both endpoints, assert merged occurrence count and ordering
- E2E: open the calendar page, pick a date range, assert at least one occurrence renders with correct agent name
- Permission test: `client_user` can see subaccount calendar but not org calendar; denied requests return 403
- Demo rehearsal: agency owner demos the portal card to a prospect — the prospect should say "I can see what you're doing for me next week" without prompting

### 3.8 Out of scope

- **Editing schedules from the calendar.** Clicking an occurrence deep-links to the agent/playbook/scheduled-task edit page; no inline editing in v1.
- **Drag to reschedule.** Deferred; existing cron/heartbeat editors are the single source of truth.
- **Historical overlay** (showing what *did* run). Deferred to a post-v1 enhancement that overlays `agent_runs` on the same grid.

---

## 4. Feature 2 — Inline Run Now test UX

### 4.1 Goal

Collapse the authoring feedback loop. Today, an admin editing an agent's additional prompt or a skill's instructions must save, navigate to a separate run-history page, trigger a run, wait, and click through to the trace viewer. Routines bundles edit + test + trace in a single pane; so should we. This is the highest-velocity authoring improvement of the three builds.

### 4.2 Scope

Applies to two authoring surfaces:

- **Agent edit** — `SystemAgentEditPage.tsx`, `AdminAgentEditPage.tsx`, `SubaccountAgentEditPage.tsx`
- **Skill edit** — Skill Studio (`SkillStudioPage.tsx`) — inline test surface already partially exists (`skill_simulate`), but gets a unified panel to match the agent surface

Out of scope: playbook editor (Playbook Studio already has `playbook_simulate` + cost-estimate surfaces that serve this purpose).

### 4.3 UX contract

On each authoring page, a right-hand **Test panel** (collapsible, defaults collapsed on first visit, remembers state in `localStorage`):

- **Input block** — free-text prompt (optional), selectable test-input fixtures stored per agent/skill, a "dry-run" toggle that forces `runType: 'manual'` and sets `testRun: true` on the agent_run row
- **Run button** — disabled unless the form is clean (or explicitly saved). Disabled tooltip: "Save your changes first."
- **Streaming trace** — reuses the `<RunTrace>` component extracted from `RunTraceViewerPage.tsx` (see §4.5 — the component is refactored to be embeddable)
- **Token/cost meter** — live updating from the same WebSocket stream that feeds run history; turns amber at 80% of budget, red at 100%
- **Actions bar** — "Open in full viewer" (deep link to `RunTraceViewerPage`), "Cancel run," "Save input as fixture"

### 4.4 Data model additions

A minimal addition on `agent_runs`:

| Column | Type | Purpose |
|---|---|---|
| `is_test_run` | boolean NOT NULL DEFAULT false | Marks runs produced by the inline test panel. Filtered out of agency P&L and LLM usage aggregates by default; visible in run history with a "Test" badge. |

Test-input fixtures stored in a new table (small; per-agent/per-skill; not migration-heavy):

```sql
CREATE TABLE agent_test_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  scope text NOT NULL CHECK (scope IN ('agent', 'skill')),
  target_id uuid NOT NULL, -- agent id or skill id
  label text NOT NULL,
  input_json jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX agent_test_fixtures_target_idx ON agent_test_fixtures (organisation_id, scope, target_id) WHERE deleted_at IS NULL;
```

RLS policy identical to other org-scoped tables (`rlsProtectedTables.ts` entry + policy migration).

### 4.5 Component refactor

The existing `RunTraceViewerPage.tsx` contains the full trace rendering logic. Extract it into:

- `client/src/components/runs/RunTraceView.tsx` — pure, presentational, accepts run id + streaming state as props
- `client/src/components/runs/TestPanel.tsx` — wraps `RunTraceView` with the input block, fixture picker, and actions bar
- `RunTraceViewerPage.tsx` becomes a thin wrapper that mounts `<RunTraceView>` full-screen

This is a structural improvement that benefits the existing run viewer and is a prerequisite for the test panel — do it first.

### 4.6 Backend changes

Minimal — existing run-creation paths already support manual runs. Changes:

- `server/services/agentExecutionService.ts` — honour `isTestRun` on the run creation input; persist to the new column; skip cost attribution aggregation if `isTestRun === true`
- `server/routes/agents.ts` — new endpoint `POST /api/subaccounts/:subaccountId/agents/:linkId/test-run` that wraps the existing run creation with `isTestRun: true` and a short-circuit idempotency key format (`test:{linkId}:{userId}:{epochSeconds}`)
- `server/routes/skills.ts` + `subaccountSkills.ts` — matching `POST .../skills/:slug/test-run` endpoints that delegate to `skill_simulate` + the new test-run path
- `server/routes/agentTestFixtures.ts` — full CRUD for test fixtures (org- and subaccount-scoped)

### 4.7 Permission and cost guardrails

- Test runs **do** consume tokens and **do** get written to the LLM usage ledger. They are simply flagged so aggregate views can exclude them by default.
- Test runs inherit the agent's existing per-run token budget ceiling. No separate limit.
- Test runs are rate-limited per user (default 10 per hour, configurable in `server/config/limits.ts`). Prevents accidental infinite loops during authoring.
- Test runs on **system agents** are disallowed from the org surface (system agent editing is a platform concern; system admins have a separate surface).

### 4.8 Verification

- Extract `RunTraceView` — existing `RunTraceViewerPage` still renders identically (golden-file snapshot test if useful)
- Unit tests on new endpoint error shapes (missing body, over budget, over rate limit)
- Integration: save an agent, hit test-run, assert `is_test_run=true` on the resulting row and that it's excluded from the default LLM usage aggregate
- E2E: load SystemAgentEditPage, type a test prompt, click Run, assert streaming updates render in the side panel
- Regression: existing run-history, trace viewer, and LLM usage explorer are unaffected (all guarded with the `is_test_run` filter)

### 4.9 Out of scope

- **"Compare with previous version"** — a diff view between the current edit and the last saved version is valuable but deferred.
- **Prompt playgrounds** — no general-purpose LLM playground UI. The test panel is scoped to agents and skills; it is not a chat with the model.

---

## 5. Feature 3 — n8n Workflow Import

### 5.1 Goal

Convert an n8n workflow JSON export into a **draft Synthetos playbook** that the admin reviews, edits in Playbook Studio, and saves via the existing save-and-PR flow. Position as a **migration wedge**, not a commodity feature: agencies with sprawling n8n workflows get a one-shot conversion that drops them into a supervised, multi-tenant operations system — not a prettier n8n.

### 5.2 Why this shape

The transcript shows Anthropic's Routine Generator skill does the same thing for Routines. Matching that capability is a marketing moment, but the **strategic payoff** is different: a Routine is one prompt; a Synthetos playbook is a DAG with approval gates, cost simulation, per-step retry policies, and side-effect classification. The n8n → playbook conversion therefore **upgrades** the source workflow rather than transliterating it. This is the pitch: "we're not a cheaper n8n, we're the supervised version of what you wish n8n was."

### 5.3 Deliverable shape

One new skill, one new service, no new UI pages (reuse Playbook Studio).

| Asset | Path | Purpose |
|---|---|---|
| Skill | `server/skills/import_n8n_workflow.md` | Admin-callable skill in Playbook Studio chat |
| Parser | `server/services/n8nImportService.ts` + `n8nImportServicePure.ts` | Parses n8n JSON → intermediate representation → proposed playbook definition |
| Tool handler | `server/tools/internal/importN8nWorkflow.ts` | Binds the skill to the parser; returns draft definition + mapping report |
| Registry entry | `server/config/actionRegistry.ts` | `import_n8n_workflow` registered with `sideEffectClass: 'none'`, `idempotencyStrategy: 'read_only'` |

No database schema additions are required. The output flows through the existing Playbook Studio session model (`playbook_studio_sessions`), which already tracks candidate definitions pending human save.

### 5.4 Parsing strategy

**Intermediate representation (IR):**

```ts
type N8nNode = {
  id: string;
  name: string;
  type: string; // e.g. 'n8n-nodes-base.httpRequest'
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  position: [number, number];
};

type N8nConnection = { source: string; sourceOutput: number; target: string; targetInput: number };

type N8nIR = {
  name: string;
  nodes: N8nNode[];
  connections: N8nConnection[];
  triggers: N8nNode[]; // subset: schedule/webhook/manual
};
```

**Node-type mapping table** (`server/services/n8nImportServicePure.ts` constant):

| n8n node type | Playbook step type | Notes |
|---|---|---|
| `scheduleTrigger` | playbook `schedule` config | Converts cron to our cron format; timezone preserved |
| `webhookTrigger` | playbook trigger: `webhook` | Webhook path mounted under our existing `/api/webhooks/...` convention |
| `manualTrigger` | playbook trigger: `manual` | |
| `httpRequest` | `action_call` (step type) → `fetch_url` skill or generic HTTP action | URL + method preserved; auth mapped to connection scoping |
| `gmail`, `slack`, `hubspot`, `github`, `ghl` | `action_call` → matching managed connector | Credentials mapped from n8n credential ID to a Synthetos connection (subaccount-scoped by default) |
| `if`, `switch` | `conditional` step | Expression converted from n8n's JS expression syntax to our expression language (simple cases only; complex → flagged) |
| `set`, `itemLists.splitOut` | Inlined into downstream step templating | |
| `openai`, `anthropic` | `prompt` step with model-agnostic routing | Model selection preserved in a comment; actual routing deferred to Synthetos's per-skill resolver |
| Unknown node type | Emitted as a `user_input` step with a TODO comment | The admin resolves before saving |

**What we deliberately do not map:**

- n8n's "function" nodes (arbitrary JavaScript). These are flagged as unconvertible and surfaced in the mapping report; the admin rewrites the logic as a Synthetos skill or decides not to migrate that branch.
- n8n's "code" nodes with untrusted code. Same treatment.

### 5.5 Output contract

The skill returns two artefacts:

1. **Draft playbook definition** (JSON) — shape matches the output of `playbook_validate`. Not yet saved. Lives on the Studio session as a candidate.
2. **Mapping report** (Markdown) — per-node table showing: n8n node → mapped step → confidence (high/medium/low) → action required (none / review / rewrite). Rendered inline in the Studio chat.

The admin then iterates with the existing Studio skills (`playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save`) and saves via the existing PR flow. No net-new persistence layer.

### 5.6 Safety and scope

- **No credentials are migrated.** The parser identifies credential *references* in the n8n export but never imports tokens. Admin re-authenticates via Synthetos's existing OAuth flows; the mapping report surfaces a checklist of required connections.
- **No autonomous save.** The skill never calls `playbook_propose_save`; the admin must review and explicitly invoke it. This matches the existing Studio pattern and prevents drive-by conversions of workflows the admin hasn't fully understood.
- **Side-effect class inference.** Every mapped step is tagged with a conservative default side-effect class (write-class nodes default to `review`, read-class nodes default to `auto`). The admin can downgrade gates after validation.
- **Import size cap.** Workflows over 100 nodes are rejected with a clear error pointing at the manual-conversion path. Keeps LLM cost bounded and prevents pathological imports.

### 5.7 Verification

- Unit tests on `n8nImportServicePure.ts` covering: schedule trigger, webhook trigger, if/switch branching, unknown node flagging, function-node rejection, credential reference extraction, 100-node cap
- Integration: provide a real n8n export (Hacker News scraper from the reference transcript as a golden input), assert generated playbook passes `playbook_validate`
- E2E: admin pastes a workflow JSON in Studio chat, receives a mapping report + candidate definition, clicks through simulate, cost-estimate, save-and-PR
- Regression: existing Studio flow is untouched for playbooks authored from scratch

### 5.8 Marketing rollout

This feature has outsized marketing leverage. Plan for a one-shot content asset at launch:

- Demo video: "Converting a 15-node n8n workflow into a supervised Synthetos playbook in 4 minutes" — covers mapping report, the "add an approval gate before this HTTP call" moment, and the final save-and-PR
- Blog post: "Why we're not building a better n8n" — reinforces the non-goal frame while introducing the import wedge
- Sales enablement: the mapping report is a consultative-selling surface — AEs can run a prospect's workflow through the converter on the discovery call and ship back the report as a pre-signed proposal artefact

### 5.9 Out of scope

- **Make.com and Zapier imports.** Same architectural approach would apply, but deferred until the n8n converter has a validated hit rate.
- **Bidirectional export.** No "convert a Synthetos playbook back to n8n." Not a business we want to enable.
- **Per-node cost simulation in the mapping report.** The admin uses the existing `playbook_estimate_cost` skill after conversion; duplicating that in the import surface is wasted engineering.

---

## 6. Feature 4 — Positioning refresh (`docs/capabilities.md`)

### 6.1 Goal

Absorb **scheduled-prompt / hosted-routine products** into the positioning framework as a distinct competitor class with its own objection-handling row. Add a new Replaces / Consolidates entry for scheduled-routine products. Introduce net-new sales/marketing copy that converts the three shipped features (calendar, inline test, n8n import) into explicit advantages. Do not name any specific LLM provider anywhere in customer-facing sections, per `CLAUDE.md` editorial rule 1.

### 6.2 Scope of edits (all landing in the same commit as this spec)

| Section | Edit |
|---|---|
| Structural differentiators table | Add two rows: one for **Portfolio-wide scheduled-work visibility** (calendar); one for **Supervised migration from no-code workflow tools** (n8n import wedge) |
| Objection handling table | Add new row: *"I'll use a hosted routines product from my LLM provider."* — response uses generic category language and reinforces the operations-layer frame |
| Objection handling table | Sharpen existing *"I'll use a scheduled-prompt tool for scheduling"* row — include calendar, approval gates, three-tier isolation, and multi-client surface as concrete proof points |
| Replaces / Consolidates | Rename existing *"Scheduled-prompt tools"* row to *"Scheduled-prompt and hosted-routine tools"* and extend the "with" column to reference the new calendar surface |
| Product Capabilities → AI Agent System | Add bullets for the new calendar, inline test, and per-agent test-fixture surfaces |
| Product Capabilities → Playbook Engine | Add bullet for the n8n import migration wedge |
| How to apply this in GTM content | Add a bullet on the portfolio-calendar client-facing demo moment |
| Changelog | Add 2026-04-16 entry citing this spec |

### 6.3 Editorial constraints (recap)

- **No specific LLM or AI provider names** in Core Value Proposition, Positioning & Competitive Differentiation, Product Capabilities, Agency Capabilities, or Replaces / Consolidates. Use generic category language (*hosted routines*, *scheduled-prompt tools*, *LLM providers*). This is a hard blocker per `CLAUDE.md`.
- **Marketing- and sales-ready language throughout.** No internal library or service names in customer-facing sections.
- **Model-agnostic north star preserved.** Nothing in the refresh can imply a default or preferred provider.
- **Vendor-neutral even under objection.** The new objection row does not name any provider even in the question itself — it describes the product category.

### 6.4 Acceptance

- `docs/capabilities.md` passes all five editorial rules from `CLAUDE.md` (reviewable by eye — no named providers in customer-facing sections)
- Every GTM asset referenced in §6.2 is reviewable by the sales and marketing team without further edits required (self-contained, no internal jargon)
- The refresh ships in the same commit as this spec so the codebase always tells a coherent story

---

## 7. Feature 5 — Strategic stance preservation

### 7.1 Goal

Codify the non-goal *"Automation OS does not compete with LLM-provider primitives"* in a durable place so future sessions, PRs, and marketing work do not drift the pitch toward "we have agents and skills and scheduling too." The audit confirmed the existing frame is correct; what's missing is a **named reference** future agents can anchor on when the next primitive ships.

### 7.2 Edit (doc-only, same commit as this spec)

Update `CLAUDE.md` under an existing or new section — recommended location: directly below the existing "Core Principles" section as a new subsection titled **"Non-goals: what Automation OS is not"**.

Contents (summarised; exact copy in the commit):

> - **Not a better agent SDK.** Consume LLM-provider primitives under the hood rather than competing with them.
> - **Not a hosted routines / scheduled-prompt product.** We build the operations layer on top of supply from every provider — multi-tenant isolation, approval workflows, client portals, per-client P&L, model-agnostic routing — surfaces an LLM provider's hosted-agent or routine product structurally cannot ship.
> - **Not a general-purpose chat UI.**
> - **Not a standalone IDE.**
> - **Not a commodity workflow automation tool.**
>
> When a provider ships a new primitive (routines, agent SDKs, skills, memory, hosted managed agents, team chat), the response is (a) absorb the category into `docs/capabilities.md` positioning; (b) ship any UX polish that closes a demo gap; (c) never drift the pitch toward parity with the provider's primitive. The moat is the operations layer, not any one feature.

### 7.3 Relationship with Feature 4

Feature 4 updates the externally-visible positioning (`docs/capabilities.md`). Feature 5 updates the internal engineering north star (`CLAUDE.md`). Both land in the same commit so the internal and external narratives stay in sync.

### 7.4 Acceptance

- `CLAUDE.md` contains the new non-goals section
- The in-flight spec pointer in `CLAUDE.md` is updated to reference this spec while it is being implemented
- No other internal docs (`architecture.md`, `tasks/todo.md`) need changes at spec time — downstream doc updates happen when the three build features land per `CLAUDE.md` rule 11 ("docs stay in sync with code")

---

## 8. Build order and dependencies

```
 Commit 1 (this commit) ─── Features 4 + 5 (docs-only, ship immediately)
                             │
                             ▼
 Commit 2 ──────────────── Feature 1 (Scheduled Runs Calendar)
                             │  independent of Feature 2/3
                             ▼
 Commit 3 ──────────────── Feature 2 (Inline Run Now test UX)
                             │  prerequisite: Refactor RunTraceViewerPage → <RunTraceView>
                             │  prerequisite: Migration — is_test_run + agent_test_fixtures
                             ▼
 Commit 4 ──────────────── Feature 3 (n8n Workflow Import)
                             gated on Features 1 + 2 shipping cleanly
```

**Dependency rationale:**

- Features 4 and 5 ship first so every subsequent commit is written under the updated narrative frame. The spec itself, the commit messages, and the PR descriptions reference the new non-goals section.
- Feature 1 is independent of all other work — ship as soon as possible to unlock the portfolio-calendar demo surface.
- Feature 2's component refactor (`RunTraceViewerPage` → `<RunTraceView>`) is the one cross-cutting change; isolate it to a prep commit before adding the test panel.
- Feature 3 is deliberately last: lowest operational value, highest marketing leverage, and it depends on a credible authoring surface (Features 1 + 2) being in place before the migration wedge has a story.

**Each build is classified (per `CLAUDE.md` §"Task Classification"):**

| Feature | Classification | Review pipeline |
|---|---|---|
| 1 — Calendar | Standard | `pr-reviewer` before merge |
| 2 — Inline Run Now | Significant (cross-cutting: new column, component refactor, new endpoint + table) | `architect` (if scope expands further), `pr-reviewer`, `dual-reviewer` |
| 3 — n8n Import | Standard | `pr-reviewer` before merge; design review with sales on the mapping report before shipping |
| 4 — Positioning refresh | Trivial docs | self-review; no reviewer agent needed |
| 5 — Strategic stance | Trivial docs | self-review; no reviewer agent needed |

---

## 9. Migration inventory

Sequence numbers allocated against current migration count (confirm the next free number at implementation time — `migrations/` directory is the source of truth).

| Migration | Feature | Table(s) | Notes |
|---|---|---|---|
| `NNNN_agent_test_fixtures.sql` | Feature 2 | `agent_test_fixtures` (new) | RLS policy added; entry in `server/config/rlsProtectedTables.ts` |
| `NNNN_agent_runs_is_test_run.sql` | Feature 2 | `agent_runs` (column) | Add `is_test_run boolean NOT NULL DEFAULT false`; backfill is implicit (existing rows get false) |

**No migrations required for:**

- Feature 1 (calendar — read-only projection over existing tables)
- Feature 3 (n8n import — uses existing `playbook_studio_sessions` candidate model)
- Features 4 and 5 (docs only)

---

## 10. Verification plan

### 10.1 Pre-merge gates (per `CLAUDE.md` Verification Commands)

- `npm run lint` — all features
- `npm run typecheck` — all features
- `npm test` — Features 1, 2, 3
- `npm run db:generate` — Feature 2 only (new migrations)
- `npm run build` — Features 1, 2

### 10.2 Feature-specific acceptance

- **Feature 1** — §3.7
- **Feature 2** — §4.8
- **Feature 3** — §5.7
- **Feature 4** — §6.4
- **Feature 5** — §7.4

### 10.3 End-to-end demo rehearsal

Run the full north-star demo script (per §1) against staging before declaring the spec complete:

1. Open the Scheduled Runs Calendar as an org admin; confirm at least one subaccount has events in the next 7 days
2. Open the client portal as `client_user`; confirm the "Upcoming Work" card renders
3. Edit a subaccount-agent's additional prompt, click Run Now in the inline panel, watch a test run stream
4. Paste a 20-node n8n workflow JSON into Playbook Studio chat, receive a mapping report + candidate definition, simulate, estimate cost, save via PR
5. Verify every customer-facing doc passes the editorial-rules check in `CLAUDE.md`

### 10.4 Regression focus

- LLM usage explorer excludes `is_test_run` rows by default; toggle to include test runs works
- Existing run-history trace viewer renders unchanged after `<RunTraceView>` extraction
- Agent and playbook schedule editors remain the source of truth for cron/heartbeat — calendar read-only

---

## 11. Open items and deferred work

Tracked here so the implementer is not surprised and reviewers can see what was deliberately parked.

- **Historical overlay on the calendar** — overlay `agent_runs` on the same week/month grid. Deferred until the projection endpoint ships and adoption is measured.
- **Drag-to-reschedule on the calendar** — deferred indefinitely; existing cron/heartbeat editors are the single source of truth.
- **"Compare with previous version" in the inline test panel** — a diff view between current edit and last saved. Valuable follow-up; not v1.
- **Make.com and Zapier importers** — same architectural shape as n8n. Gated on n8n converter hit-rate data.
- **Public skill marketplace** — explicit non-goal per §7.2. Not deferred — cancelled.
- **General-purpose chat UI** — explicit non-goal per §7.2. Not deferred — cancelled.
- **Bidirectional export (playbook → n8n)** — explicit non-goal per §5.9. Not deferred — cancelled.
- **Per-subaccount schedule cost ceiling** — an upcoming-cost cap enforced at schedule time (not just at run time). Worth scoping after the calendar ships and per-subaccount cost visibility is in hand. Out of scope for this spec.

---

*End of spec. Once Features 4 and 5 land in the same commit as this document, the in-flight pointer in `CLAUDE.md` §"Current focus" should be updated to `routines-response-dev-spec.md` until the three build features complete.*
