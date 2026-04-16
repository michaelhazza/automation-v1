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

**North-star acceptance test:** An agency owner running a live demo can (a) open the Scheduled Runs Calendar and show the client "here is everything my agents will do for you next week"; (b) edit an agent's additional prompt, click Run Now on the same page, and watch the test run stream through the inline panel; (c) paste an n8n workflow JSON into the Playbook Studio chat, receive a validated playbook draft, review it in Playbook Studio, and save it via the existing PR flow — all without leaving the product.

**Build order rationale:** Feature 4 (positioning refresh) and Feature 5 (strategic stance) are doc-only and ship first, in the same commit as this spec, so all subsequent work is done under the updated narrative frame. Feature 1 (calendar) is independent of the other builds and has the clearest ROI on demos — ship second. Feature 2 (inline Run Now) reuses the existing run-trace streaming infrastructure and is the highest authoring-velocity win — ship third. Feature 3 (n8n import) is the most speculative of the three builds (marketing wedge, not core workflow) and ships last, gated on Feature 1 and 2 shipping cleanly.

---

## 2. Context and rationale

**What happened:** On 2026-04-16 Anthropic launched **Routines**, a scheduled-prompt runner bolted onto Claude Code. A Routine is a natural-language prompt plus three trigger types (schedule, webhook, API), connectors (Gmail, Slack, GitHub, etc.), model selection, and a run-now test button with inline input/output viewing. A calendar grid shows upcoming runs. Sub-agent support exists via "managed sessions."

**Why it matters:** Every primitive in Routines already exists in Automation OS — schedules, webhooks, API triggers, connectors, model selection, handoff up to 5 levels, skills, run history. In several areas (three-tier isolation, 42+ HITL gates, idempotency on every run path, agency P&L attribution, client portal, model-agnostic routing) Automation OS is structurally ahead. But Routines shipped **three UX polish items** we have not yet prioritised: a calendar grid view of scheduled runs, an inline "Run Now" test loop on the authoring page, and a first-class migration wedge from no-code workflow tools (n8n/Make/Zapier). Shipping those three closes the last UX-parity gap and reinforces the real moat (operations layer) rather than apologising for a missing feature.

**What this spec is NOT:**

- **Not** a repositioning. The audit confirmed the strategic frame in `CLAUDE.md` and `docs/capabilities.md` ("LLM providers sell capability; Synthetos sells the business") is correct. Routines is a reason to **sharpen** the pitch, not soften it.
- **Not** a chase for every Routines primitive. We deliberately skip things like a public skill marketplace or a general-purpose chat UI — explicit non-goals in `capabilities.md`.
- **Not** a rewrite of the run or schedule data model. The three user-facing build features (1, 2, 3) reuse existing tables (`agent_runs`, `scheduled_tasks`, `agents.cron`, `heartbeatEnabled`) and existing services (`agentScheduleService`, `scheduledTaskService`, `agentExecutionService`). No schema migrations are required for Features 1, 3, 4, and 5; Feature 2 adds one column to `agent_runs` and one new `agent_test_fixtures` table (see §9).

**Design constraints:**

- Every new surface respects the three-tier isolation model (System → Org → Subaccount). Calendar views are scoped by subaccount by default with an org-wide roll-up for org admins; no cross-org visibility ever.
- Every new production run-creation path threads `idempotencyKey` per existing conventions (`server/db/schema/agentRuns.ts`). Test-run paths (Feature 2) use an intentionally unique-per-call key format and are exempt from deduplication — see §4.6.
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
| Heartbeat agents | `agents.heartbeatEnabled`, `heartbeatIntervalHours`, `heartbeatOffsetMinutes`; per-link overrides on `subaccount_agents` (link-level values take precedence over agent-level defaults when set) | `projectHeartbeatOccurrences(agent, link, windowStart, windowEnd)` |
| Cron agents | `agents.cron`, `agents.cronTimezone`; per-link overrides on `subaccount_agents` (link-level cron/timezone take precedence over agent-level defaults when set) | `projectCronOccurrences(agent, link, windowStart, windowEnd)` |
| Recurring playbooks | `scheduled_tasks WHERE createdByPlaybookSlug IS NOT NULL` | `projectPlaybookOccurrences(scheduledTask, windowStart, windowEnd)` |
| Scheduled tasks | `scheduled_tasks WHERE createdByPlaybookSlug IS NULL` (`rrule`, `scheduleTime`, `timezone`, `isActive`) | `projectScheduledTaskOccurrences(task, windowStart, windowEnd)` |

**Projection is read-only and stateless.** No rows are written to predict a run. Occurrences are materialised in memory, merged, sorted, and returned to the client.

### 3.3 Data contract

New endpoint, new service, no new tables.

**Route:** `GET /api/subaccounts/:subaccountId/schedule-calendar?start=ISO&end=ISO` (subaccount-scoped)

**Route:** `GET /api/org/schedule-calendar?start=ISO&end=ISO&subaccountId=?` (org-wide roll-up, filterable)

**Request validation:** `start` and `end` are ISO 8601 strings with timezone offset (UTC or explicit offset). `start` must be before `end`. Maximum window: 30 days (matching §3.1 UI maximum). Requests with invalid ISO, `start >= end`, or span > 30 days return `400 Bad Request`. Requests with a valid window that contains no occurrences return `200` with an empty `occurrences` array and `truncated: false` (not 404).

**Occurrence cap and no pagination:** This endpoint does not support pagination; truncation is the only limiting mechanism in v1. If projection across all schedule sources yields more than 10,000 occurrences within the requested window, the service returns the first 10,000 sorted per §3.9, sets `truncated: true` and `totalsAreTruncated: true`, and computes `estimatedTotalCount` per the rule above. The UI surface must display a warning banner when `truncated: true` and suggest narrowing the window or applying a subaccount filter. This prevents the endpoint from becoming a silent performance sink in orgs with many high-frequency heartbeat agents across many subaccounts. Pagination is intentionally excluded: the truncation + narrow-window UX is simpler and sufficient for the intended calendar use case.

**Sort-then-truncate invariant (required):** Truncation MUST occur after full sorting. Never truncate before sort. Sorting a partially-truncated set would silently drop the wrong occurrences and break calendar continuity. The sort happens in `scheduleCalendarService.ts` over the merged in-memory list; truncation is the next statement.

**Memory-pressure guard:** Full materialisation of the projected occurrence list must short-circuit once the sorted set has confirmed 10,000 entries — do not naively enumerate all occurrences for a window that will produce hundreds of thousands of events. The implementation should stop projection per-source as early as possible given sort semantics (sources are individually bounded by window; merge-sort across sources allows early exit once the 10k cap is reached). Full materialisation of more than 50,000 occurrences is not required and indicates a missing guard.

**Service:** `server/services/scheduleCalendarService.ts` + `scheduleCalendarServicePure.ts` for the projection math (pure, unit-testable, no DB access in the pure half).

**Response shape:**

```ts
type ScheduleOccurrence = {
  occurrenceId: string; // stable deterministic hash: sha256(source + ':' + sourceId + ':' + scheduledAt)[0..31] — 128-bit hex prefix; not globally unique across all time but collision-free within any realistic response window (birthday bound: ~2^64 before collision in a 10k-item set)
  scheduledAt: string; // ISO — always UTC
  source: 'heartbeat' | 'cron' | 'playbook' | 'scheduled_task';
  sourceId: string; // agent id / playbook id / scheduled_task id
  sourceName: string; // agent name / playbook name / task name
  subaccountId: string;
  subaccountName: string;
  agentId?: string;
  agentName?: string;
  runType: 'scheduled'; // always 'scheduled' — these are projected future occurrences, not yet-run events
  estimatedTokens: number | null; // see §3.9 cost-estimate rules; null when insufficient history
  estimatedCost: number | null; // derived from estimatedTokens × current pricing; null when tokens null
  scopeTag: 'system' | 'org' | 'subaccount';
};

type ScheduleCalendarResponse = {
  windowStart: string; // ISO UTC
  windowEnd: string;   // ISO UTC
  occurrences: ScheduleOccurrence[]; // sorted per §3.9 stable sort rule; max 10,000 items
  truncated: boolean; // true when projection exceeded the 10,000-occurrence hard cap; client must narrow the window
  totalsAreTruncated: boolean; // mirrors `truncated`; separate flag so callers cannot accidentally use totals for financial forecasting when the full set is not reflected
  estimatedTotalCount: number | null; // full projected count before truncation. Computed when total ≤ 50,000; set to null when projection exceeds that threshold (counting >50k is itself expensive). Use for UI messaging only ("showing 10,000 of ~47,000") — never for billing or forecasting.
  totals: { count: number; estimatedTokens: number; estimatedCost: number }; // reflects the truncated set only when truncated=true; null per-occurrence estimates treated as 0; do NOT use for org-level financial forecasting when totalsAreTruncated=true
};
```

**Files introduced by Feature 1:**

| Asset | Path | Purpose |
|---|---|---|
| Service (pure) | `server/services/scheduleCalendarServicePure.ts` | Stateless projection functions for heartbeat, cron, playbook, and scheduled-task occurrences |
| Service | `server/services/scheduleCalendarService.ts` | Wraps pure layer with org-scoped DB reads |
| Route | `server/routes/scheduleCalendar.ts` | Mounts both calendar endpoints |
| Component | `client/src/components/ScheduleCalendar.tsx` | Calendar grid renderer (week / month / day / list views) |
| Page | `client/src/pages/ScheduleCalendarPage.tsx` | Org-wide calendar page |
| Page | `client/src/pages/SubaccountScheduleCalendarPage.tsx` | Subaccount-scoped calendar page |
| Portal card | `client/src/components/portal/UpcomingWorkCard.tsx` | Compact 7-day strip on client portal landing |

Existing files modified by Feature 1:

| File | Change |
|---|---|
| `server/routes/index.ts` | Mount `scheduleCalendar` route |
| `client/src/App.tsx` | Register calendar page routes via existing lazy-load pattern |
| Sidebar navigation component (path confirmed at implementation time) | Add "Schedule" nav entry under "Operations" section — org admin only |
| Subaccount detail tab navigation component (path confirmed at implementation time) | Add calendar tab to subaccount detail page |
| `server/lib/permissions.ts` | Add `subaccount.schedule.view_calendar` under `SUBACCOUNT_PERMISSIONS` |
| `server/services/permissionSeedService.ts` | Include `subaccount.schedule.view_calendar` in `client_user` permission set template |

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

**Permission:** The permission model per surface:
- Org-wide calendar page (`ScheduleCalendarPage`): gated by `org.agents.view` — org admin only.
- Subaccount calendar page (`SubaccountScheduleCalendarPage`): gated by `subaccount.workspace.view` — org admins and subaccount users with standard workspace access.
- Portal card (`UpcomingWorkCard`) and portal-entry path to the subaccount calendar: gated by the new `subaccount.schedule.view_calendar` permission — granted by default to the `client_user` permission set so clients can see upcoming work without general `subaccount.workspace.view` access.

`subaccount.schedule.view_calendar` is therefore the portal-specific grant; `subaccount.workspace.view` gates the main page. `client_user` has `subaccount.schedule.view_calendar` but NOT `subaccount.workspace.view` — they reach the calendar only via the portal card path. The new permission key must be added to `server/lib/permissions.ts` under `SUBACCOUNT_PERMISSIONS` and seeded in `server/services/permissionSeedService.ts` for the `client_user` template.

### 3.5 Client portal surface

**Portal card:** `client/src/components/portal/UpcomingWorkCard.tsx` — compact 7-day horizontal strip on the client portal landing, showing the next 5 scheduled items with agent name and ETA. Clicking navigates to the full subaccount calendar. This is the demoable wedge: the client sees *what the agency is doing for them next week*, a surface a Routines dashboard cannot produce by design.

### 3.6 Implementation plan

1. Write `projectHeartbeatOccurrences`, `projectCronOccurrences`, `projectPlaybookOccurrences`, `projectScheduledTaskOccurrences` in `scheduleCalendarServicePure.ts` with unit tests (DST boundaries, heartbeat offset, cron-to-UTC conversion, end-of-window truncation).
2. Write `scheduleCalendarService.ts` wrapping the pure layer with org-scoped DB reads (via `getOrgScopedDb()`) and scope assertions per `server/lib/scopeAssertion.ts`.
3. Mount routes in `server/routes/scheduleCalendar.ts` + `server/routes/index.ts`.
4. Build `<ScheduleCalendar>` grid component with week view first; month and day come after week renders correctly.
5. Add two pages + nav entries + portal card.
6. Backfill estimated-cost calculation by reading last 10 non-test runs per agent from `agent_runs` (`WHERE is_test_run = false`) to avoid skewing estimates with short test-prompt costs. Note: the `is_test_run` column is added by Feature 2's migration (Commit 3); this step must run after that migration has been applied. In Commit 2 (Feature 1 only), all existing rows have `is_test_run = false` by default, so the filter is safe to write in service code and will become effective once Feature 2's column lands.

### 3.7 Verification

- Unit tests on pure projection (cron edge cases, DST, offset, interval > 24h, missing cron expression)
- Integration test: seed a subaccount with heartbeat + cron + playbook + scheduled task, hit both endpoints, assert merged occurrence count and ordering
- Integration test: hit the calendar endpoint with an invalid/out-of-range date window (e.g. span > 30 days, or `start >= end`), assert `400 Bad Request`
- Integration test: hit the calendar endpoint with a valid window that contains no scheduled occurrences, assert `200` with an empty `occurrences` array and correct `windowStart`/`windowEnd` in response
- Permission test: `client_user` with `subaccount.schedule.view_calendar` can access the portal card and its navigation path to the subaccount calendar; `client_user` without `subaccount.workspace.view` cannot access the main subaccount calendar page directly; org calendar returns 403 for all subaccount-tier users; denied requests return 403
- **Projection–execution parity test (integration):** Seed a test agent with a known heartbeat interval and a known cron expression. Let the scheduler run it for a fixed window (e.g. 2 hours in a time-accelerated test environment). Query the `agent_runs` table for actual run timestamps. Query the calendar endpoint for the same window. Assert that the projected `scheduledAt` values match the actual `startedAt` timestamps within a 60-second tolerance (accounting for scheduler dispatch latency). This test is the enforcement hook for §3.9's projection–execution parity invariant. It lives in `server/services/__tests__/scheduleCalendarParity.test.ts` and must be run as part of the integration test suite.
- Demo rehearsal: agency owner demos the portal card to a prospect — the prospect should say "I can see what you're doing for me next week" without prompting
- UI verification: see §10.3 demo rehearsal.

### 3.8 Out of scope

- **Editing schedules from the calendar.** Clicking an occurrence deep-links to the agent/playbook/scheduled-task edit page; no inline editing in v1.
- **Drag to reschedule.** Deferred; existing cron/heartbeat editors are the single source of truth.
- **Historical overlay** (showing what *did* run). Deferred to a post-v1 enhancement that overlays `agent_runs` on the same grid.

### 3.9 Projection invariants

These rules are **non-negotiable contracts** for `scheduleCalendarServicePure.ts`. All tests use them as assertions; all future changes to the pure layer must preserve them.

#### Determinism

Projection functions must be deterministic:

- **No `Date.now()` inside pure functions.** All time calculations are anchored to the request's `windowStart` parameter.
- **No external I/O** inside pure functions. All necessary data (agent config, schedule config, timezone strings) is passed as arguments.
- Same inputs → identical outputs, always. This invariant enables UI caching, pagination, and debugging.

#### DST handling contract

Cron schedules and heartbeat schedules resolve DST differently:

| Schedule type | DST rule |
|---|---|
| **Cron** | Follows **wall-clock time** (interpreted in `cronTimezone`). When DST moves the clock forward, the skipped hour is skipped (no occurrence). When DST moves the clock backward, the repeated hour fires **once** (the first occurrence in wall-clock time). |
| **Heartbeat** | Follows **absolute interval time** (UTC-anchored). DST shifts do not change when the next occurrence fires — the interval is constant in UTC. |

This matches how the scheduler actually executes heartbeat vs. cron jobs (pg-boss cron uses `cron-parser` with timezone; heartbeat is a fixed-offset interval job). Projection must reproduce the same behaviour so the calendar matches what actually runs.

**Intentional design note:** Heartbeat schedules are UTC-anchored and will drift relative to local wall-clock time across DST boundaries. This is deliberate — heartbeats are meant to fire on a constant absolute interval, not at a fixed local time. Do not "fix" this drift; it is the correct behaviour. Cron-based schedules should be used when a fixed local-time recurrence is required.

#### Estimated-cost calculation rules

`estimatedTokens` and `estimatedCost` are computed per-agent in `scheduleCalendarService.ts` (stateful layer, not pure), using the agent's recent run history:

- **Qualifying runs:** last N completed runs where `is_test_run = false` AND `status IN ('completed', 'timeout')`. Exclude `failed` (might have 0 tokens, skewing low), `cancelled`, and test runs.
- **Minimum history:** if N < 3 qualifying runs exist, set `estimatedTokens = null` and `estimatedCost = null`. Do not estimate from a single noisy sample.
- **Window:** use `min(10, N)` qualifying runs.
- **Calculation:** `estimatedTokens = avg(promptTokens + completionTokens)` across the window. `estimatedCost = estimatedTokens × currentModelPricePerToken` (use the agent's `modelId` to look up price from the pricing table in `server/config/modelPricing.ts`).
- **Pricing caveat:** Estimates use **current pricing** at query time, not the pricing that was in effect when the historical runs were executed. Historical run costs in `agent_runs` may differ from the estimate if pricing changed between those runs and now. This is intentional and acceptable — the estimate is a forward-looking planning figure, not a precise financial guarantee. The system must not attempt to replay historical pricing.
- **Null propagation:** `totals.estimatedTokens` and `totals.estimatedCost` aggregate only non-null occurrences; if all are null, totals are 0.

#### Stable sort order

Occurrences are sorted with the following multi-key rule (applied in `scheduleCalendarService.ts` before truncation):

1. `scheduledAt` ascending (primary — chronological order)
2. `source` priority ascending per `SOURCE_PRIORITY` enum (secondary — deterministic tie-breaking within the same timestamp)
3. `sourceId` lexicographic ascending (tertiary — deterministic tie-breaking within same timestamp + source)

This ordering is stable and deterministic. It matches the week/month/day grid rendering order. The `occurrenceId` hash is computed from inputs that are independent of sort position — implementations should compute hashes before sorting to keep the logic clear.

**`SOURCE_PRIORITY` enum** — defined once in `scheduleCalendarServicePure.ts` as a constant; all sort logic references this constant, never inline literals:

```ts
const SOURCE_PRIORITY = {
  heartbeat: 1,
  cron: 2,
  playbook: 3,
  scheduled_task: 4,
} as const satisfies Record<ScheduleOccurrence['source'], number>;
```

#### Projection–execution parity invariant

**This is a durable maintenance contract, not just a v1 rule.**

The projection functions in `scheduleCalendarServicePure.ts` must be functionally equivalent to the scheduler's actual timing logic:

- `projectHeartbeatOccurrences` must match the interval arithmetic in `agentScheduleService.ts`'s heartbeat job dispatcher.
- `projectCronOccurrences` must produce the same timestamps as `cron-parser` (the library used by pg-boss) for any given cron expression + timezone pair.

**Enforcement:** Any future change to scheduler timing logic (heartbeat interval calculation, cron library upgrade, DST handling change) **must** be mirrored in the corresponding projection function in the same commit. Failure to keep them in sync means the calendar shows times that never actually fire — or misses times that do. Add a comment cross-reference in both files:

```ts
// agentScheduleService.ts
// ⚠️ Heartbeat interval arithmetic here must stay in sync with
//    projectHeartbeatOccurrences() in scheduleCalendarServicePure.ts
```

---

## 4. Feature 2 — Inline Run Now test UX

### 4.1 Goal

Collapse the authoring feedback loop. Today, an admin editing an agent's additional prompt or a skill's instructions must save, navigate to a separate run-history page, trigger a run, wait, and click through to the trace viewer. Routines bundles edit + test + trace in a single pane; so should we. This is the highest-velocity authoring improvement of the three builds.

### 4.2 Scope

Applies to two authoring surfaces:

- **Agent edit** — `AdminAgentEditPage.tsx`, `SubaccountAgentEditPage.tsx` (org and subaccount authoring pages only)
- **Skill edit** — Skill Studio (`SkillStudioPage.tsx`) — inline test surface already partially exists (`skill_simulate`), but gets a unified panel to match the agent surface

Out of scope: playbook editor (Playbook Studio already has `playbook_simulate` + cost-estimate surfaces that serve this purpose).

Note: Skill test runs also create `agent_runs` rows (via the `skill_simulate` path, which wraps agent execution internally); `is_test_run` applies uniformly to both agent and skill test runs.

### 4.3 UX contract

On each authoring page, a right-hand **Test panel** (collapsible, defaults collapsed on first visit, remembers state in `localStorage`):

- **Input block** — free-text prompt (optional), selectable test-input fixtures stored per agent/skill (the fixture picker shows subaccount-level fixtures for the current subaccount only — subaccount users cannot see org-level fixtures (where `subaccount_id IS NULL`) or other subaccounts' fixtures, per §4.4 access matrix; org admins see all fixtures within their `organisation_id`), a "This is a test run" indicator (always on; this panel is exclusively a test surface — for production manual runs, use the agent detail page) that forces `runType: 'manual'` and sets `isTestRun: true` on the agent_run row (note: test runs DO consume tokens — they are flagged so aggregate views exclude them by default, per §4.7)
- **Run button** — disabled unless the form is clean (or explicitly saved). Disabled tooltip: "Save your changes first."
- **Streaming trace** — reuses the `<RunTraceView>` component extracted from `RunTraceViewerPage.tsx` (see §4.5 — the component is refactored to be embeddable)
- **Token/cost meter** — live updating from the same WebSocket stream that feeds run history; turns amber at 80% of the agent's per-run token budget ceiling (`agents.tokenBudget` or the org-level default from `server/config/limits.ts`), red at 100% (see §4.7 — test runs inherit the agent's existing per-run token budget ceiling)
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

Note: `target_id` carries no FK constraint — it is a polymorphic reference (agent id when `scope='agent'`, skill id when `scope='skill'`). Referential integrity is enforced at the application layer in `agentTestFixturesService`.

**Access matrix:** Org admins can read/write all fixtures within their `organisation_id`. Subaccount users (including roles at the subaccount tier) can read/write only fixtures where `subaccount_id` matches their own subaccount — they cannot see org-level fixtures (where `subaccount_id IS NULL`) or fixtures belonging to other subaccounts. `client_user` is excluded (no access). Enforced via `assertScope()` in `agentTestFixturesService`. Mirrors the pattern on `agent_runs` and other subaccount-scoped tables. RLS policy entry required in `rlsProtectedTables.ts` plus a policy migration.

**Orphan cleanup:** When an agent or skill is soft-deleted (`deletedAt` set), its associated fixtures must be soft-deleted in the same transaction. The agent delete path in `agentService.ts` and the skill delete path in `skillService.ts` must call `agentTestFixturesService.softDeleteByTarget(scope, targetId, orgId)` as part of their existing delete transactions. Hard-deleted or purged fixtures accumulate without this; the index `WHERE deleted_at IS NULL` keeps them invisible to queries but they still grow the table. Implement on Feature 2's build commit — do not defer.

**Table growth:** Soft-deleted fixtures are never physically removed in v1. This is intentional (same pattern as all other soft-delete tables in the system). At high usage over time, the `agent_test_fixtures` table will accumulate deleted rows indefinitely. A periodic hard-purge job (e.g. `DELETE FROM agent_test_fixtures WHERE deleted_at < now() - interval '90 days'`) is the correct long-term solution and should be added to the existing nightly cleanup job in `server/jobs/nightlyCleanup.ts` as a follow-up task. Deferred from v1 scope — add to `tasks/todo.md` at build time so it is not forgotten. Additionally: soft-delete tables with high write volume can degrade index performance over time due to index bloat; periodic `VACUUM` (automatic in Postgres with autovacuum enabled, which is the default) and occasional `REINDEX` may be required depending on growth patterns. Monitor table bloat at scale via standard Postgres tooling.

### 4.5 Component refactor

The existing `RunTraceViewerPage.tsx` contains the full trace rendering logic. Extract it into:

- `client/src/components/runs/RunTraceView.tsx` — pure, presentational, accepts run id + streaming state as props
- `client/src/components/runs/TestPanel.tsx` — wraps `RunTraceView` with the input block, fixture picker, and actions bar
- `RunTraceViewerPage.tsx` becomes a thin wrapper that mounts `<RunTraceView>` full-screen

This is a structural improvement that benefits the existing run viewer and is a prerequisite for the test panel — do it first.

**Files introduced by Feature 2:**

| Asset | Path | Purpose |
|---|---|---|
| Component (extracted) | `client/src/components/runs/RunTraceView.tsx` | Pure presentational trace renderer; extracted from RunTraceViewerPage |
| Component (new) | `client/src/components/runs/TestPanel.tsx` | Test panel shell: input block, fixture picker, actions bar, wraps RunTraceView |
| Route | `server/routes/agentTestFixtures.ts` | CRUD endpoints for test-input fixtures |
| Service | `server/services/agentTestFixturesService.ts` | Business logic: fixture CRUD, `assertScope()` enforcement, polymorphic referential integrity checks |
| Schema | `server/db/schema/agentTestFixtures.ts` | Drizzle schema for `agent_test_fixtures` table |

Existing files modified (not new):

| File | Change |
|---|---|
| `server/services/agentExecutionService.ts` | Honour `isTestRun`; skip cost attribution |
| `server/routes/subaccountAgents.ts` | New `POST .../test-run` endpoint |
| `server/routes/skills.ts`, `subaccountSkills.ts` | New `POST .../test-run` endpoints |
| `server/db/schema/agentRuns.ts` | Add `is_test_run` column |
| `server/config/rlsProtectedTables.ts` | Register `agent_test_fixtures` |
| `client/src/pages/AdminAgentEditPage.tsx`, `SubaccountAgentEditPage.tsx` (2 files) | Mount `<TestPanel>` |
| `client/src/pages/SkillStudioPage.tsx` | Mount `<TestPanel>` |
| `client/src/pages/RunTraceViewerPage.tsx` | Refactor to thin wrapper |
| `server/config/limits.ts` | Add `TEST_RUN_RATE_LIMIT_PER_HOUR` constant (default 10) |
| `server/routes/index.ts` | Mount `agentTestFixtures` router |
| `server/routes/subaccountAgents.ts` | Also: add `WHERE is_test_run = false` default filter to `GET .../agent-runs` list endpoint (§4.7) |
| `server/routes/llmUsage.ts` | Add `WHERE is_test_run = false` default filter to `GET /api/subaccounts/:id/llm-usage` and `GET /api/org/llm-usage` (§4.7) |
| `server/services/reportingService.ts` | Add `WHERE is_test_run = false` to Agency P&L aggregation queries (§4.7; not overridable) |

### 4.6 Backend changes

Minimal — existing run-creation paths already support manual runs. Changes:

- `server/services/agentExecutionService.ts` — honour `isTestRun` on the run creation input; persist to the new column; skip cost attribution aggregation if `isTestRun === true`
- `server/routes/subaccountAgents.ts` — new endpoint `POST /api/subaccounts/:subaccountId/agents/:linkId/test-run` that wraps the existing run creation with `isTestRun: true` and an intentionally unique-per-call idempotency key format (`test:{linkId}:{userId}:{epochMilliseconds}`). Note: test-run keys are unique by design (each button press is a distinct test run, not a deduplicated operation); this departs from the general §2 idempotency convention, which applies to production run-creation paths only. Subaccount-scoped agent endpoints live in `subaccountAgents.ts` per `architecture.md` route conventions.
- `server/routes/skills.ts` — new endpoint `POST /api/org/skills/:slug/test-run` (org-admin callable); `server/routes/subaccountSkills.ts` — new endpoint `POST /api/subaccounts/:subaccountId/skills/:slug/test-run` (subaccount-scoped); both delegate to `skill_simulate` + the new test-run path
- `server/routes/agentTestFixtures.ts` — full CRUD for test fixtures (org- and subaccount-scoped)

### 4.7 Permission and cost guardrails

- Test runs **do** consume tokens and **do** get written to the LLM usage ledger. They are simply flagged so aggregate views can exclude them by default.
- Test runs inherit the agent's existing per-run token budget ceiling. No separate limit.
- Test runs are rate-limited per user (default 10 per hour, configurable in `server/config/limits.ts` as `TEST_RUN_RATE_LIMIT_PER_HOUR`). Enforced in the `POST .../test-run` route handler via a sliding-window counter keyed on `userId`.
  - **Phase 1 (v1):** In-memory counter per-instance. Acceptable at low to moderate traffic and single-instance deploys. In a multi-instance setup this limit can be bypassed via load-balancer routing (each instance has an independent counter). Concurrent requests from multiple browser tabs or rapid bursts within a single event-loop tick may briefly exceed the per-user ceiling before the counter increments — this is bounded by request execution latency and is not a blocking concern at authoring-session traffic volumes. This is a deliberate v1 trade-off: complexity is low, and test-run abuse at low traffic causes no meaningful harm.
  - **Phase 2 (when needed):** Migrate to a Redis-backed sliding window using the existing Redis connection in the app. The `TEST_RUN_RATE_LIMIT_PER_HOUR` constant and rate-check call site remain unchanged; only the counter backend changes. Do not implement Phase 2 speculatively — trigger it when multi-instance deploys become standard.
- Test runs on **system agents** are disallowed from the org surface (system agent editing is a platform concern; system admins have a separate surface).

**Enforcement points for `is_test_run` default exclusion** — the following endpoints and aggregates must apply `WHERE is_test_run = false` by default; a `?includeTestRuns=true` query param overrides the filter where noted:

| Endpoint / query | Exclusion default | Override param |
|---|---|---|
| `GET /api/subaccounts/:id/agent-runs` (run history list) | exclude test runs | `includeTestRuns=true` |
| `GET /api/subaccounts/:id/llm-usage` (usage explorer) | exclude test runs | `includeTestRuns=true` |
| `GET /api/org/llm-usage` (org usage roll-up) | exclude test runs | `includeTestRuns=true` |
| Agency P&L aggregation in `reportingService.ts` | exclude test runs | not overridable |
| `GET /api/subaccounts/:id/agent-runs/:runId` (individual run detail) | included (test badge shown) | N/A — always visible |

### 4.8 Failure behavior

The test panel must handle two distinct failure modes:

**Run failure (terminal error from the agent):** When the streaming run reaches a terminal status of `failed` or `timeout`, the `<RunTraceView>` component renders a red failure badge with the terminal error message surfaced from `agent_runs.errorMessage`. An inline **Retry** button starts a new test run (calls `POST .../test-run` again with the same fixture inputs). The failed run is archived in the run-history viewer with a "Test" badge and can be inspected there.

**WebSocket disconnect (mid-run connection drop):** When the WebSocket connection drops while a run is in progress, the test panel displays a disconnection banner: *"Connection interrupted — your run is still processing."* A **Check status** button polls `GET .../agent-runs/:runId` once and updates the panel to the run's current state. If the run has already completed, the trace is loaded from the REST endpoint. If it is still running, the panel offers a re-subscribe option. The run is never abandoned server-side; only the real-time feed is disrupted.

### 4.9 Verification

- Extract `RunTraceView` — verify existing `RunTraceViewerPage` still renders identically by running the app
- Unit tests on new endpoint error shapes (missing body, over budget, over rate limit)
- Integration: save an agent, hit `POST .../test-run`, assert the response includes a run id, assert the persisted row has `is_test_run=true`, and assert the row is excluded from the default LLM usage aggregate endpoint response
- Integration: exhaust the per-user rate limit by hitting `POST .../test-run` 11 times in rapid succession, assert 429 on the 11th request (rate-limit window: 10 per hour per user, per §4.7)
- Failure mode: simulate a run that reaches `status=failed`; assert the test panel shows the failure badge + error message + Retry button
- Failure mode: simulate a WebSocket disconnect mid-run; assert the disconnection banner appears and the Check status button polls the REST endpoint correctly
- Regression: existing run-history, trace viewer, and LLM usage explorer are unaffected (all guarded with the `is_test_run` filter)
- UI verification: see §10.3 demo rehearsal.

### 4.10 Out of scope

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

No database schema additions are required. The output flows through the existing Playbook Studio session model (`playbook_studio_sessions`), which already tracks candidate definitions pending human save. Note: `sideEffectClass: 'none'` refers to external side-effects (HTTP calls, credential writes, external-system mutations) — updating the Studio session's candidate state is internal session management, consistent with how other Studio skills (`playbook_validate`, `playbook_simulate`) are registered. The draft playbook definition uses the same step-type primitives accepted by `playbook_validate` (`action_call`, `conditional`, `user_input`, `prompt`, `schedule`, etc.) — no new step-type schema additions are required.

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

The mapping table uses the exact `type` string from the n8n export JSON (fully qualified, e.g. `n8n-nodes-base.httpRequest`). The parser normalises each node's `type` field to a canonical short key by stripping the `n8n-nodes-base.` and `n8n-nodes-langchain.` prefixes before lookup. The short keys used in this table are the post-normalisation values.

| n8n node type (short key after normalisation) | Full n8n type string (example) | Playbook step type | Notes |
|---|---|---|---|
| `scheduleTrigger` | `n8n-nodes-base.scheduleTrigger` | playbook `schedule` config | Converts cron to our cron format; timezone preserved |
| `webhook` | `n8n-nodes-base.webhook` | playbook trigger: `webhook` | Webhook path defined as placeholder in draft; real path allocated only on save via `playbook_propose_save` |
| `manualTrigger` | `n8n-nodes-base.manualTrigger` | playbook trigger: `manual` | |
| `httpRequest` | `n8n-nodes-base.httpRequest` | `action_call` (step type) → `fetch_url` skill or generic HTTP action | URL + method preserved; auth mapped to connection scoping |
| `gmail`, `slack`, `hubspot`, `github`, `ghl` | `n8n-nodes-base.gmail`, etc. | `action_call` → matching managed connector | Credentials mapped from n8n credential ID to a Synthetos connection (subaccount-scoped by default) |
| `if`, `switch` | `n8n-nodes-base.if`, `n8n-nodes-base.switch` | `conditional` step | Expression converted from n8n's JS expression syntax to our expression language (simple cases only; complex → flagged) |
| `set`, `splitOut` | `n8n-nodes-base.set`, `n8n-nodes-base.splitOut` | Inlined into downstream step templating | |
| `openAi`, `lmAnthropicClaude` | `n8n-nodes-langchain.openAi`, `n8n-nodes-langchain.lmAnthropicClaude` | `prompt` step with model-agnostic routing | Model selection preserved in a comment; actual routing deferred to Synthetos's per-skill resolver |
| (any other short key) | — | Emitted as a `user_input` step with a TODO comment | The admin resolves before saving |

**Confidence criteria** — used in the mapping report column and returned on each mapped step object:

| Value | Criteria |
|---|---|
| `high` | Deterministic 1:1 mapping. The source node type is in the known mapping table, no field transformation was required, and the emitted step type is directly supported with no heuristic interpretation. |
| `medium` | Partial or assumption-based mapping. The node type is known but one or more fields required a heuristic interpretation: e.g. a complex JS expression was simplified to a literal, a credential was matched by provider name rather than verified by ID, or optional fields were defaulted. |
| `low` | Incomplete or unknown mapping. The node type had no direct table entry, was emitted as a `user_input` step with a TODO comment, or the conversion logic could not be verified. Admin must review before saving. |

All `low`-confidence steps must appear in the **Action required** column of the mapping report as `rewrite` or `review`. `medium` steps appear as `review`. `high` steps appear as `none`.

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
- **Graph validation and topological ordering.** The parser validates the n8n connection graph before producing any step output, then emits steps in topological order:
  - **Cycle detection:** A directed cycle anywhere in the connection graph (any node reachable from itself via connection edges) causes immediate rejection with an error: `"Workflow contains a directed cycle at nodes: [names]. Cyclic graphs cannot be converted to a linear playbook."` Cyclic graphs have no well-defined linear-playbook representation.
  - **Topological order:** After cycle detection passes, playbook steps are emitted in **topological sort order** of the DAG (sources before sinks). This guarantees that the step sequence in the draft playbook matches the execution order of the original workflow and that no step references outputs from a step that has not yet run. Implemented via Kahn's algorithm in `n8nImportServicePure.ts` (iterative BFS, O(V+E), avoids recursion stack overflow on large graphs). Different valid topological orderings of the same DAG are a known non-determinism; the implementation must use a deterministic tie-breaking rule to produce the same output on repeated runs. Tie-break key: `(node.name, node.id)` lexicographic ascending — node names are not guaranteed unique within an n8n workflow, so `node.id` (the UUID assigned by n8n) is the tiebreaker when names collide.
  - **Disconnected nodes:** Nodes with neither inbound nor outbound connections — excluding trigger nodes, which by definition have no inbound connections — are flagged in the mapping report as `severity: 'high'` warnings. They are omitted from the draft playbook steps. The `high` severity is intentional: a disconnected non-trigger node almost certainly represents a misconfiguration or an incomplete workflow branch — the admin should explicitly decide whether to wire it, hand-convert it, or discard it. The high-severity warning ensures it is not silently lost. **UX contract:** The Playbook Studio chat must visually highlight all `severity: 'high'` mapping-report rows (e.g. red row background or ⚠ icon), and the `playbook_propose_save` skill must not be callable until all `high`-severity items in the current import session are acknowledged by the admin (either resolved or explicitly marked "dismissed"). This acknowledgement gate is enforced in the skill's pre-condition check, not in the UI alone.
- **Side-effect class inference.** Every mapped step is tagged with a conservative default side-effect class using the `sideEffectClass` field on the playbook step object:
  - Write-class nodes (CRM writes, email sends, Slack messages, HTTP POSTs/PATCHs/DELETEs, any `action_call` targeting a managed connector that mutates state) → `'review'`
  - Read-class nodes (HTTP GETs, data fetches, trigger nodes, `prompt` steps) → `'auto'`
  - **Override:** if the mapped step targets an external system and the scope or permissions required cannot be determined from the source node's credential reference or URL (e.g. the credential is of an unknown provider type, or the HTTP method is a variable expression), the step defaults to `'review'` regardless of the read/write classification. When in doubt, gate it.
  - The `sideEffectClass` field is the same field consumed by `playbook_validate`'s step schema. The admin can relax gates after validation via the existing Playbook Studio interface.
- **Import size cap.** Workflows over 100 nodes are rejected with a clear error pointing at the manual-conversion path. Keeps LLM cost bounded and prevents pathological imports.

### 5.7 Verification

- Unit tests on `n8nImportServicePure.ts` covering: schedule trigger, webhook trigger, if/switch branching, unknown node flagging, function-node rejection, credential reference extraction, 100-node cap
- Unit test: provide a workflow JSON containing a directed cycle (A → B → C → A); assert the parser returns a rejection error citing the cycling nodes by name, and returns no draft playbook steps
- Unit test: provide a workflow JSON with a non-trigger node that has no inbound or outbound connections; assert it is absent from the draft playbook steps and appears in the mapping report with a `warning` classification
- Unit test: side-effect inference — provide a workflow with an HTTP POST node and assert the mapped step has `sideEffectClass: 'review'`; provide an HTTP GET node and assert `sideEffectClass: 'auto'`; provide an HTTP node with a method set to a JS variable expression and assert `sideEffectClass: 'review'` (unknown-scope override)
- Integration: invoke the `import_n8n_workflow` skill via the existing skill simulation path (`skill_simulate` with slug `import_n8n_workflow`), supplying a real n8n export (Hacker News scraper from the reference transcript as the golden input); assert the response contains a draft playbook definition and a mapping report, and assert the draft passes `playbook_validate`
- Integration: POST a workflow exceeding 100 nodes, assert a 400 error response with the expected message
- Regression: existing Studio flow is untouched for playbooks authored from scratch
- UI verification: see §10.3 demo rehearsal.

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

Absorb **scheduled-prompt / hosted-routine products** into the positioning framework as a distinct competitor class with its own objection-handling row. Add a new Replaces / Consolidates entry for scheduled-routine products. Introduce net-new sales/marketing copy that anticipates the three planned build features (calendar, inline test, n8n import) as concrete advantages — this copy lands in Commit 1 and is written in anticipation of Features 1–3 shipping in subsequent commits. Do not name any specific LLM provider anywhere in customer-facing sections, per `CLAUDE.md` editorial rule 1.

### 6.2 Scope of edits (all landing in Commit 1 — the docs-only commit, per §8 build order)

| Section | Edit |
|---|---|
| Structural differentiators table | Add two rows: one for **Portfolio-wide scheduled-work visibility** (calendar); one for **Supervised migration from no-code workflow tools** (n8n import wedge) |
| Objection handling table | Add new row: *"I'll use a hosted routines product from my LLM provider."* — response uses generic category language and reinforces the operations-layer frame |
| Objection handling table | Sharpen existing *"I'll use a scheduled-prompt tool for scheduling"* row — include calendar, approval gates, three-tier isolation, and multi-client surface as concrete proof points |
| Replaces / Consolidates | Rename existing *"Scheduled-prompt tools"* row to *"Scheduled-prompt and hosted-routine tools"* and extend the "with" column to reference the new calendar surface |
| Product Capabilities → AI Agent System | Add bullets for the new calendar, inline test, and per-agent/per-skill test-fixture surfaces |
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
- The refresh ships in Commit 1 (the docs-only commit per §8 build order) so the codebase always tells a coherent story

---

## 7. Feature 5 — Strategic stance preservation

### 7.1 Goal

Codify the non-goal *"Automation OS does not compete with LLM-provider primitives"* in a durable place so future sessions, PRs, and marketing work do not drift the pitch toward "we have agents and skills and scheduling too." The audit confirmed the existing frame is correct; what's missing is a **named reference** future agents can anchor on when the next primitive ships.

### 7.2 Edit (doc-only, Commit 1 — the docs-only commit per §8 build order)

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
- The in-flight spec pointer in `CLAUDE.md` §"Current focus" is updated to reference this spec as part of Commit 1 (same commit as Features 4 and 5), and kept current until Features 1–3 are merged (per the end note in §8)
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
| `NNNN_agent_test_fixtures.sql` | Feature 2 | `agent_test_fixtures` (new) | RLS policy added; entry in `server/config/rlsProtectedTables.ts`; create Drizzle schema `server/db/schema/agentTestFixtures.ts` |
| `NNNN_agent_runs_is_test_run.sql` | Feature 2 | `agent_runs` (column) | Add `is_test_run boolean NOT NULL DEFAULT false`; backfill is implicit (existing rows get false); update Drizzle schema `server/db/schema/agentRuns.ts` |

**Code-only changes required for Feature 1 (no DB migration):**

- Add `subaccount.schedule.view_calendar` to `server/lib/permissions.ts` (`SUBACCOUNT_PERMISSIONS`) and update `server/services/permissionSeedService.ts` default permission set templates to include it for `client_user`

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

Run the full north-star demo script (per §1) against the local development environment before declaring the spec complete:

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
- **"Compare with previous version" in the inline test panel** — a diff view between current edit and last saved. Deferred — valuable follow-up, not v1.
- **Make.com and Zapier importers** — same architectural shape as n8n. Deferred — gated on n8n converter hit-rate data.
- **Public skill marketplace** — explicit non-goal per §7.2. Not deferred — cancelled.
- **General-purpose chat UI** — explicit non-goal per §7.2. Not deferred — cancelled.
- **Bidirectional export (playbook → n8n)** — explicit non-goal per §5.9. Not deferred — cancelled.
- **Per-subaccount schedule cost ceiling** — an upcoming-cost cap enforced at schedule time (not just at run time). Worth scoping after the calendar ships and per-subaccount cost visibility is in hand. Out of scope for this spec.

---

*End of spec. The in-flight pointer update in `CLAUDE.md` §"Current focus" is part of Commit 1 (together with Features 4 and 5), per §7.4 acceptance. It remains set to `routines-response-dev-spec.md` until Features 1–3 are merged.*
