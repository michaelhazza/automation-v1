**Status:** draft
**Spec date:** 2026-05-07
**Last updated:** 2026-05-07 (round 2 — bucket-1/bucket-2 polish folded in; foundation Phase 0 patch assumed available)
**Author:** michael
**Build slug:** consolidation-build
**Depends on:** `tasks/builds/consolidation-foundation/spec.md` (Phase 0; primitives must land first)

---

# Consolidation B — Build

> Phase-2 stream B of the four-spec consolidation programme. Delivers the **authoring** surface: the consolidated **Agents** list, **Agent edit** form (Configure / Behaviour / Personality / Skills / Data sources / Schedule / Budget / Runs), **Recurring tasks** list, and **Project edit** form. Builds against Spec 0 primitives; consolidates seven existing pages (`AdminAgentEditPage`, `AdminSkillsPage`, `AdminSkillEditPage`, `SkillStudioPage`, `SkillAnalyzerPage`, `SubaccountAgentEditPage`, `RecurringTasksPage`-equivalent) into four.

## Table of contents

0. Programme context
1. Goals
2. Non-goals
3. Existing primitives audit
4. Public API contracts
5. File inventory
6. Permissions / RLS / Execution model
7. Phase / chunk plan
8. Testing posture
9. Coordination with Foundation, A, C
10. Deferred items
11. Self-consistency check
12. Pre-review checklist

## 0. Programme context

The 2026-05-06 prototype consolidates ~25 existing pages into ~12. Spec B owns the **Build** surface — configuring agents, skills, scheduled work, and projects. Reference prototypes: `prototypes/consolidation-2026-05-06/{agents,agent-edit,recurring-tasks,project-edit}.html`. Plus `before-agent-edit.html` shows the five-page legacy state being replaced (AdminAgentEditPage + AdminSkillsPage + AdminSkillEditPage + SkillStudioPage + SkillAnalyzerPage).

This spec assumes `consolidation-foundation` has shipped or is in flight; foundation §4 contracts are locked. Primary primitives consumed: `<SortableTable>` (agents list, recurring-tasks list), `<FormFooter>` (agent-edit, project-edit), `<Modal>` (skill picker, agent-test confirmation, etc), `<PageShell>`, `useViewMode` (agent-edit Workspace/Org context), sidebar config.

## 1. Goals

1. Consolidate the agent edit experience: replace the five-page legacy flow (AdminAgentEditPage, AdminSkillsPage, AdminSkillEditPage, SkillStudioPage, SkillAnalyzerPage) with a single tabbed `AgentEditPage` covering Configure / Behaviour / Personality / Skills / Data sources / Schedule / Budget / Runs. The Skills and Data-sources tabs subsume the standalone skill-management pages.
2. Replace `SystemAgentsPage` / `OrgAgentConfigsPage` with a single `AgentsListPage` that respects `useViewMode` (workspace / org / system). Sortable + filterable per foundation §4.3.
3. Ship a `RecurringTasksPage` that lists schedule-fired, event-fired, and manual recurring tasks in a single sortable table with inline filter dropdowns (matching the prototype). Replaces / extends whatever currently surfaces recurring tasks (heartbeat editor + agent triggers list, today scattered).
4. Replace `ProjectEditPage` with the consolidated form per prototype `project-edit.html` (Identity, Objective, Project management, Linked resources, Migrated-from-Goals notice). Sticky form footer per foundation `<FormFooter>`.
5. Keep the existing backend agent / project / trigger domain APIs in place where they already work. Extend only what the consolidated UI demands (e.g. Test agent endpoint formalised; recurring-task list aggregator).
6. Inline Test agent panel on agent-edit (per prototype round 15) — no right-rail layout.

## 2. Non-goals

1. Building any of the Operate-stream pages (home, inbox, activity, run-trace) or Govern-stream pages (knowledge, spending, integrations). Specs A and C own those.
2. Replacing the agent execution engine, the skill registry, the heartbeat scheduler, or the trigger model. This stream consumes those, doesn't redefine them.
3. Introducing a new agent identity primitive. The existing three-tier agent model (`architecture.md § Three-Tier Agent Model`) is preserved end-to-end.
4. Changing the existing skills DB schema beyond additive columns the consolidated UI requires (data sources binding metadata, if needed).
5. Adding a UI test framework. Frontend tests remain `none_for_now`.
6. Building any cross-cutting frontend primitive — escalate to a Spec-0 patch.

## 3. Existing primitives audit

| Primitive | Existing | Verdict | Reason |
|---|---|---|---|
| Agents API | `server/routes/agents.ts`, `server/services/agentExecutionService.ts` (+`*Pure.ts`), various agent services | **Reuse** | List + CRUD already exist. Consolidated agents list reads from existing endpoints. |
| Agent skills binding | `server/routes/agents.ts` (likely sub-routes) + `server/skills/` registry + `server/config/actionRegistry.ts` | **Extend** | Skills tab inside agent-edit needs a list-skills endpoint scoped to an agent. Likely partial or scattered today; consolidate into one route. |
| Agent data sources | `server/db/schema/agentDataSources.ts` | **Extend** | Data-sources tab needs a list/add/remove endpoint set scoped to an agent. Schema exists; routes may be partial. |
| Agent schedule / triggers | `server/routes/agentTriggers.ts`, `server/db/schema/agentTriggers.ts` | **Reuse** | Schedule tab on agent-edit consumes existing trigger endpoints. Recurring-tasks list also reads from triggers + heartbeat. |
| Agent budget | `server/routes/agentCharges.ts`, `server/services/computeBudgetService.ts` | **Reuse** | Budget tab on agent-edit reads from existing endpoints. (Spend reporting is Spec C.) |
| Agent runs | `server/routes/agentRuns.ts` | Reuse | Runs tab on agent-edit reads from existing endpoint. |
| Agent test fixtures | `server/services/agentTestFixturesService.ts` + `server/lib/testRunIdempotency.ts` | **Extend** | Inline Test runner card on agent-edit needs a test-run endpoint that returns a result preview + run-trace link, idempotent per existing helper. May already exist as `POST /api/agents/:id/test`; if not, add it. |
| Agent recommendations | `server/routes/agentRecommendations.ts` + `*Service.ts` | Reuse | Used inside Behaviour/Personality tabs (agent suggestions) without modification. |
| Projects API | `server/routes/projects.ts` (+ `pageProjects.ts`) | **Reuse** | Project edit consumes existing CRUD. |
| Heartbeat scheduling | `architecture.md § Heartbeat Scheduling` + relevant service | **Reuse** | Recurring-tasks list reads heartbeat + trigger fires; no scheduler change. |
| Recurring tasks aggregator | None — today's UX surfaces triggers, heartbeat, and manual runs in different places | **New** (`recurringTasksService.ts`) | Single read endpoint that unions schedule-fired (triggers/heartbeats), event-fired (workflow event subscriptions), and manual (one-off run records). Pure aggregator over existing tables; no new persisted state. |
| Frontend SortableTable | Foundation §4.3 | Consume | Agents list, Recurring-tasks list. |
| Frontend FormFooter | Foundation §4.4 | Consume | Agent-edit + project-edit fixed-bottom action row, button group aligned to form column. |
| Frontend Modal | Foundation §4.1 (extended) | Consume | Skill picker, data-source picker, confirm-discard, etc. |
| Frontend PageShell | Foundation §4.8 | Consume | All four pages wrap in `<PageShell>`. |
| Frontend useViewMode | Foundation §4.6 | Consume | Agents list view-mode awareness; Workspace context dropdown on agent-edit Test runner. |
| Existing AdminAgentEditPage / AdminSkillsPage / AdminSkillEditPage / SkillStudioPage / SkillAnalyzerPage / SubaccountAgentEditPage / OrgAgentConfigsPage / SystemAgentsPage / `RecurringTasksPage`-equivalent | `client/src/pages/...` | **Replace** | Folded into the four consolidated pages. |
| Existing `ProjectEditPage` / Goals page | `client/src/pages/...` | **Replace** | Consolidated into project-edit per prototype. The Goals subsystem retirement notice is rendered inline (read-only banner). |
| `<SearchBox>` (foundation Phase 0 patch) | Foundation §4.9 | Consume | Agents list search, Recurring tasks search, Skill picker modal search, Data source picker search. |
| `<EmptyState>` / `<ErrorState>` (foundation Phase 0 patch) | Foundation §4.10/4.11 | Consume | Agents list zero-rows, Recurring tasks empty result, agent-edit Runs tab empty, Skills tab empty. |
| `<ConfirmDialog>` | `client/src/components/ConfirmDialog.tsx` | Reuse | Delete agent, Delete project, agent deploy/promote (when added), trigger pause/resume, skill remove. |
| Agent prompt revisions | `server/db/schema/agentPromptRevisions.ts` | Reuse | Source of the agent version indicator on the agents list (latest deployed prompt-revision id is shown as a small `v23` chip). |

**Out-of-scope items (deferred per §10):** bulk agent operations, keyboard shortcuts, audit-log UI, agent versioning UI for rollback (chip visible but no rollback flow), CSV export, dependency visualisation, agent health metrics dashboards, schedule visual cron editor.

**Verdict summary:** four pages built (replace ~9 legacy pages), one new backend service (recurringTasksService), backend extensions on agents (skills/data-sources/test-run subroutes). Zero new shared frontend primitives. Zero new tables; possibly additive columns on `agent_data_sources` if metadata required (decided in C2 architect plan).

## 4. Public API contracts

### 4.1 Agents list — view-mode-aware listing

`GET /api/agents` (existing route; query parameters extended).

```ts
interface AgentsListQuery {
  scope?: 'workspace' | 'org' | 'system'; // matches viewMode
  status?: ('active' | 'paused' | 'draft')[];
  reportsTo?: string[];                    // parent agent IDs
  cursor?: string;
  limit?: number;
  sortKey?: 'name' | 'status' | 'reportsTo' | 'lastRun' | 'runs30d' | 'cost30d';
  sortDir?: 'asc' | 'desc';
  q?: string;
}

interface AgentListItem {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'draft';
  parentAgentId: string | null;
  parentAgentName: string | null;
  lastRunAt: string | null;
  runs30d: number;
  cost30d: number;
  subaccount: { id: string; name: string } | null;
}
```

`filterOptions` returned in the response per `<SortableTable>` contract (foundation §4.3).

### 4.2 Agent edit — sectioned configuration endpoints

The agent-edit page is tabbed; each tab persists independently.

**`GET /api/agents/:id/full`** — returns the full agent payload across all tabs:

```ts
interface AgentFull {
  id: string;
  // Configure
  name: string; description: string;
  roleTitle: string; parentAgentId: string | null;
  model: string; outputSize: 'compact' | 'standard' | 'extended';
  allowSubaccountModelOverride: boolean;
  responseMode: 'balanced' | 'expressive' | 'precise' | 'highly_creative';
  // Behaviour
  behaviour: { briefingTemplate: string; constraints: string[]; ... };
  // Personality
  personality: { traits: string[]; tone: string; ... };
  // Skills (assigned skills with config)
  skills: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }>;
  // Data sources
  dataSources: Array<{ id: string; kind: string; ref: string; status: 'connected' | 'disconnected' | 'error' }>;
  // Schedule (triggers)
  triggers: Array<{ id: string; kind: 'schedule' | 'event' | 'manual'; spec: unknown; status: 'active' | 'paused' }>;
  // Budget
  budget: { dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number };
  // Runs (preview; full list paged separately via /agents/:id/runs)
  runs: { last5: AgentRunPreview[]; total30d: number; cost30d: number };
}
```

**Tab-scoped PATCH endpoints** (each idempotent; partial updates):
- `PATCH /api/agents/:id/configure` — body: `Pick<AgentFull, 'name'|'description'|'roleTitle'|'parentAgentId'|'model'|'outputSize'|'allowSubaccountModelOverride'|'responseMode'>`
- `PATCH /api/agents/:id/behaviour`
- `PATCH /api/agents/:id/personality`
- `PUT /api/agents/:id/skills` — full replacement of skill bindings (atomic)
- `PUT /api/agents/:id/data-sources` — full replacement
- `PUT /api/agents/:id/triggers` — full replacement (delegates to existing trigger service)
- `PATCH /api/agents/:id/budget`

**Idempotency:** key-based via the agent id + `If-Match` ETag returned by `GET /full`. Concurrent edits return `409 conflict` with the current ETag; client re-fetches and surfaces a "another user changed this; reload?" banner. (See `architecture.md § Idempotency Keys` for the existing pattern.)

### 4.3 Agent test-run — inline Test runner

`POST /api/agents/:id/test` (extends existing test-fixture service):

```ts
interface AgentTestRequest {
  input: string;                  // textarea content
  workspaceContextId: string;     // active client/sub-account
  idempotencyKey: string;         // client-generated UUID
}

interface AgentTestResponse {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  durationMs: number | null;
  resultPreview: string;          // ~200-char summary; full output via run-trace
  traceUrl: string;               // → /run-trace/:runId
}
```

**Idempotency:** key-based per `server/lib/testRunIdempotency.ts`. Re-submitting the same `idempotencyKey` returns the existing run (no duplicate execution).

### 4.4 Recurring tasks — aggregated list

`GET /api/recurring-tasks`:

```ts
interface RecurringTasksQuery {
  scope?: 'workspace' | 'org' | 'system';
  fireKind?: ('schedule' | 'event' | 'manual')[];
  status?: ('active' | 'paused' | 'error')[];
  agent?: string[];
  project?: string[];
  cursor?: string; limit?: number;
  sortKey?: 'name' | 'fireCondition' | 'action' | 'scope' | 'project' | 'status' | 'lastFired' | 'fires30d' | 'nextFire';
  sortDir?: 'asc' | 'desc';
}

interface RecurringTask {
  id: string;
  name: string;
  fireKind: 'schedule' | 'event' | 'manual';
  fireCondition: string;          // human-readable, e.g. "Daily 9am UTC", "On hubspot.contact.created", "Manual"
  action: string;                 // agent name, workflow name, or "Manual run"
  scope: { kind: 'workspace' | 'org'; id: string; name: string };
  project: { id: string; name: string } | null;
  status: 'active' | 'paused' | 'error';
  lastFiredAt: string | null;
  fires30d: number;
  nextFireAt: string | null;
}
```

Producer: new `server/services/recurringTasksService.ts` that unions over `agent_triggers`, heartbeats, and manual run history. Consumer: `RecurringTasksPage`. **Source-of-truth precedence:** the underlying records (triggers / heartbeats / runs) are the SoT; the recurring-tasks list is a read-only projection. Mutations (pause / resume / edit) flow back to the underlying record's existing endpoint.

### 4.5 Projects — edit endpoint

`PATCH /api/projects/:id` (existing route extended):

```ts
interface ProjectPatch {
  name?: string;
  color?: string;                 // hex
  description?: string;
  status?: 'active' | 'paused' | 'archived';
  objective?: string;             // injected as runtime context to agent prompts under this project
  targetDate?: string;
  budgetUsd?: number;
  budgetWarnThresholdPct?: number;
  repositoryUrl?: string | null;
  linkedAgents?: string[];        // agent IDs
}
```

Migrated-from-Goals notice rendered inline as a static banner if the project has `migratedFromGoalsAt != null`. No new endpoint for the notice — it's a property on the project record returned by `GET /api/projects/:id`.

### 4.6 Sticky form footer (frontend contract)

Per foundation §4.4. Agent-edit and project-edit each render `<FormFooter>` at the bottom of their `<PageShell>` with three buttons: Discard (secondary), Save changes (primary), Delete agent / Delete project (destructive, `margin-left: auto`). Pages MUST set `<PageShell bottomPadding={100}>` to avoid clipping.

### 4.7 Inline Test runner card (frontend contract — agent-edit only)

Per prototype round 15, the Test runner is an inline `<section class="section-card">` at the bottom of agent-edit content (always visible across tabs). Layout: 2-column grid (`1fr 240px`) for Test input + Workspace context, collapsing to single column at <720px. Action row: regular-width Run test button, inline meta line ("Last run completed in Xs"), right-aligned "View run trace" link. Result block: emerald-tinted card with header + body. **Not** a right rail; **not** a modal. Simple inline card.

### 4.8 Page-level full-text search

Agents list and Recurring tasks list each render `<SearchBox>` (foundation §4.9, debounced 200ms) wired to a `q` query parameter:

- **Agents list** `q` searches `name + description + parentAgentName`.
- **Recurring tasks list** `q` searches `name + fireCondition + action`.
- **Skill picker modal** `q` searches the skill registry by `name + key + description`.
- **Data source picker** `q` searches the connection list (cross-stream — reads from Spec C's connections endpoint).

Empty results render `<EmptyState>` with a "Clear search and filters" action. Page list errors render `<ErrorState>` with a retry button.

### 4.9 RRULE / fire-condition human-readable preview

The Recurring tasks `fireCondition` field (`§4.4 RecurringTask`) is computed server-side from the underlying trigger spec into a human-readable string:

- Schedule-fired: `"Daily 9am UTC"`, `"Weekly Mon 8am UTC"`, `"Monthly 1st 00:00"`, `"Hourly"`, `"Every 15 minutes"` (rrule-style → English projector).
- Event-fired: `"On hubspot.contact.created"`, `"On stripe.invoice.paid"`.
- Manual: `"Manual run"`.

Producer: new pure helper `server/services/recurringTasksServicePure.ts > formatFireCondition(triggerSpec)`. No client-side library; the server emits the string. Test cases for the helper colocated.

### 4.10 Agent versioning indicator

Agents list shows a small version chip next to each agent name: `v<N>` where `N` is the count of `agent_prompt_revisions` rows for that agent. Tooltip: `"Deployed revision · last edited <relative time> by <user>"`. **No rollback UI in this stream** — the chip is read-only awareness; rollback flows are deferred per §10.

Add `agent_revision_count` to `AgentListItem` (§4.1).

### 4.11 Confirmation dialogs on destructive actions

- **Delete agent**: `<ConfirmDialog>` with copy `"Deleting <name>. Active runs will continue but no new runs will start. This cannot be undone."`. Type-to-confirm input (`<name>`) for additional friction on production agents.
- **Delete project**: `<ConfirmDialog>` with copy mentioning linked agents (`"<N> linked agents will be unlinked."`). Type-to-confirm if linked agents > 0.
- **Trigger pause/resume from Recurring tasks row**: `<ConfirmDialog>` only on pause of a high-volume trigger (≥10 fires in last 30d). Resume is one-click.
- **Skill remove from agent**: `<ConfirmDialog>` only if the skill has run in the last 7 days; cold skills remove silently.
- **Agent test from Test runner card**: no confirmation (it's a sandbox).

### 4.12 Agent edit tab UX details

- **Skills tab tier chips** (System / Org / This client): each chip has a tooltip explaining the tier source — System chip says `"From system catalogue. Configurable per agent."`; Org chip says `"From your org's custom skills. Configurable per agent."`; Workspace chip says `"Defined for this client only."`. Tooltip rendered via existing `HelpHint.tsx` (already in `client/src/components/ui`).
- **Data sources tab**: each binding shows a status pill (`connected` / `expired` / `error`) read from the underlying connection (cross-stream — reads Spec C's connection status). Cross-stream coupling is read-only; no Spec-C wait-on.
- **Budget tab**: side-by-side actual vs limit comparison. Render small inline bar per cap (daily, monthly) showing `usedMtdUsd / capUsd` with the existing `<spending-bar>` style class.
- **Runs tab**: add `costUsd` column to the runs preview list.

## 5. File inventory

Files **created** by this spec:

| File | Purpose |
|---|---|
| `client/src/pages/build/AgentsListPage.tsx` | Consolidated agents list (replaces SystemAgentsPage / OrgAgentConfigsPage) |
| `client/src/pages/build/AgentEditPage.tsx` | Tabbed agent edit (replaces 5 legacy admin/skill pages) |
| `client/src/pages/build/RecurringTasksPage.tsx` | Aggregated recurring tasks list |
| `client/src/pages/build/ProjectEditPage.tsx` | Project edit (replaces existing) |
| `client/src/pages/build/components/AgentEditTabs/ConfigureTab.tsx` | Identity + Model settings + Response mode |
| `client/src/pages/build/components/AgentEditTabs/BehaviourTab.tsx` | Briefing template + constraints |
| `client/src/pages/build/components/AgentEditTabs/PersonalityTab.tsx` | Trait pills + tone |
| `client/src/pages/build/components/AgentEditTabs/SkillsTab.tsx` | Skill bindings + per-skill config |
| `client/src/pages/build/components/AgentEditTabs/DataSourcesTab.tsx` | Data source bindings |
| `client/src/pages/build/components/AgentEditTabs/ScheduleTab.tsx` | Triggers (read-only list + edit modal) |
| `client/src/pages/build/components/AgentEditTabs/BudgetTab.tsx` | Daily / monthly caps + warn threshold slider |
| `client/src/pages/build/components/AgentEditTabs/RunsTab.tsx` | Recent runs preview + link to full Activity-filtered view |
| `client/src/pages/build/components/TestRunnerCard.tsx` | Inline Test runner card (per round 15 prototype) |
| `client/src/pages/build/components/SkillPickerModal.tsx` | Modal for adding skills to an agent (with `<SearchBox>` over the skill registry) |
| `client/src/pages/build/components/DataSourcePickerModal.tsx` | Modal for adding data sources (with `<SearchBox>` over connections) |
| `client/src/pages/build/components/AgentVersionChip.tsx` | Small `vN` chip with tooltip on Agents list |
| `client/src/pages/build/components/DeleteAgentDialog.tsx` | Type-to-confirm wrapper around `<ConfirmDialog>` for agent delete |
| `client/src/pages/build/components/DeleteProjectDialog.tsx` | Type-to-confirm wrapper around `<ConfirmDialog>` for project delete |
| `server/services/recurringTasksService.ts` (+ `*Pure.ts`) | New aggregator over triggers/heartbeats/runs; includes `formatFireCondition()` helper per §4.9 |
| `server/routes/recurringTasks.ts` | New route serving the aggregator |
| `shared/types/build.ts` | TypeScript types for `AgentFull`, `AgentListItem`, `RecurringTask`, etc |
| `tasks/builds/consolidation-build/plan.md` | Implementation plan (architect output) |

Files **modified** by this spec:

| File | Change |
|---|---|
| `server/routes/agents.ts` | Add tab-scoped PATCH endpoints (configure/behaviour/personality/budget) and PUT endpoints (skills/data-sources/triggers); add `GET /:id/full` |
| `server/services/agentExecutionService.ts` (or relevant agent service) | Add full-payload assembly for `GET /:id/full` |
| `server/services/agentTestFixturesService.ts` | Confirm/extend `POST /api/agents/:id/test` per §4.3 |
| `server/routes/projects.ts` | Confirm `PATCH /api/projects/:id` accepts the §4.5 fields (additive) |
| `server/db/schema/agentDataSources.ts` | Add additive metadata columns if needed (decided in plan) |
| `server/config/rlsProtectedTables.ts` | If `agent_data_sources` schema change adds tenant scope, confirm entry |
| `client/src/App.tsx` (router) | Re-route `/agents`, `/agents/:id`, `/recurring-tasks`, `/projects/:id` |
| `client/src/config/sidebar.ts` (foundation file) | Add/relabel rows under Build group: Agents, Automations (existing), Recurring tasks. Keep Connections under External. |

Files **NOT modified** by this spec:

- Operate-stream pages, Govern-stream pages, foundation primitives.
- DB schemas for activity, inbox, knowledge, spend, integrations.
- Any existing skill registry / actionRegistry — additive only at the binding layer.

**Possible new column** (decided in plan): `agent_data_sources.metadata jsonb` if the consolidated UI needs per-binding overrides. Single migration if so. **No new tables.**

## 6. Permissions / RLS / Execution model

**Permissions:**
- Agents list: `requirePermission('agents:read')` (existing) gated by scope.
- Agent edit (PATCH/PUT): `requirePermission('agents:write')` (existing). System-tier system-admin override applies via existing helper.
- Test agent (`POST /:id/test`): same write permission as edit + existing test-fixture rate limit.
- Recurring tasks: `requirePermission('triggers:read')` for list; mutations flow through underlying trigger/heartbeat endpoints with their existing gates.
- Projects: `requirePermission('projects:write')` (existing) on PATCH.

**Frontend permission gating (action visibility):**
- **System agents**: read-only for non-system-admin users. Workspace admins viewing a system-tier agent see all tabs but Save / Discard / Delete buttons are hidden; the agent name renders with a "System agent (read-only)" label. Backend rejects any PATCH from non-system-admin on system agents.
- **Delete agent / Delete project / Skill remove**: hidden for non-org-admin users. Backend enforces.
- **Agent deploy / promote** (when added in a follow-up): org-admin only.
- **Agent budget tab editing**: org-admin only when the agent is org-tier; workspace admins editing their workspace overrides allowed.
- **Recurring tasks pause / resume**: workspace-admin or higher; runs into existing trigger-write gate.

No new permission keys.

**RLS:** All tables touched (`agents`, `agent_data_sources`, `agent_triggers`, `agent_runs`, `projects`) are already covered. If `agent_data_sources` gets a `metadata` column, no policy change needed (column-level, not row-level). RLS manifest in `server/config/rlsProtectedTables.ts` already includes these tables.

**Execution model:**
- Agents list, agent edit reads, recurring-tasks aggregator: synchronous.
- Agent edit writes (PATCH/PUT): synchronous, optimistic predicate `UPDATE ... WHERE etag = $expected`. ETag mismatch → `409 conflict` with current ETag. Source-of-truth precedence: DB row is SoT; client-cached `AgentFull` is invalidated on save.
- Skills / data-sources / triggers PUT (full replacement): wrapped in a transaction. Failure rolls back the whole replacement.
- Test agent: synchronous-with-async-result. The endpoint returns 202 with a `runId`; client polls `/api/agents/runs/:runId` (existing) until `status: completed | failed`. Idempotency: key-based per `testRunIdempotency.ts`.
- Trigger pause/resume: unchanged from existing.

**Idempotency / retry / concurrency:**
- Agent edit writes: ETag-based. State-based race guard.
- Test runs: key-based via existing `testRunIdempotency.ts`.
- Project PATCH: state-based, partial updates idempotent.
- HTTP mapping: never bubble `23505` as 500. ETag mismatch → 409. Test idempotency hit → 200 returning the existing run.

**State machine:** Agent status enum (`active | paused | draft`) is closed; existing transitions preserved. No new statuses.

## 7. Phase / chunk plan (preview)

| Chunk | Scope | Depends on |
|---|---|---|
| C1 | Backend: `GET /api/agents/:id/full` + tab-scoped PATCH/PUT endpoints with ETag concurrency | — |
| C2 | Backend: confirm `POST /api/agents/:id/test` matches §4.3; if missing, build it on `agentTestFixturesService.ts` + `testRunIdempotency.ts` | — |
| C3 | Backend: `recurringTasksService.ts` aggregator + `recurringTasks.ts` route; pure-function tests for the union/projection | — |
| C4 | Backend: `PATCH /api/projects/:id` accepts §4.5 fields; additive only | — |
| C5 | Frontend: `shared/types/build.ts` + API client wrappers | C1–C4 |
| C6 | Frontend: `AgentEditPage.tsx` shell + 8 tab components + `<TestRunnerCard>` + skill/data-source picker modals | Foundation FormFooter, Modal, PageShell; C5 |
| C7 | Frontend: `AgentsListPage.tsx` with `<SortableTable>` + view-mode awareness | Foundation SortableTable, useViewMode; C5 |
| C8 | Frontend: `RecurringTasksPage.tsx` with `<SortableTable>` + filter dropdowns + scope/status filters | Foundation SortableTable; C3, C5 |
| C9 | Frontend: `ProjectEditPage.tsx` with `<FormFooter>` and the Goals migration banner | Foundation FormFooter, PageShell; C5 |
| C10 | Sidebar config + router wiring + delete legacy admin/skill pages | C6, C7, C8, C9 |
| C3b | Backend: `formatFireCondition()` helper in `recurringTasksServicePure.ts` + tests | C3 |
| C5b | Backend: agent-list response adds `agent_revision_count` (read from `agentPromptRevisions`) | C1 |
| C11 | Doc-sync: `architecture.md` "Key files per domain" + remove references to retired admin/skill pages | All |

**Dependency graph:** C1–C4 are independent backend chunks; C5 depends on C1–C4; C6 depends on C5; C7 / C8 / C9 each depend on C5; C10 depends on C6/C7/C8/C9. No backward references.

Estimated total: 6–8 days of one builder. Likely two PRs (backend at C1–C4, frontend at C5–C11).

## 8. Testing posture

Per `docs/spec-context.md`:

```
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
```

- **Pure-function tests** for: `recurringTasksServicePure.ts` (union projection), agent-edit ETag derivation (sha256 of canonical JSON), test-run idempotency-key validator. Each colocated `*Pure.test.ts`.
- **No frontend tests, no E2E, no API-contract tests, no visual regression** per framing.
- **Static gates** (lint, typecheck, build:server, build:client) are the verification surface.

**Manual verification at G2:**
- Agents list: switch view-mode (workspace/org/system), sort + filter columns, results match the underlying data.
- Agent edit: open all 8 tabs in sequence, edit each, save, confirm ETag round-trip (mock another writer to trigger 409). Test runner inline card runs a sample input and shows result preview + run-trace link.
- Recurring tasks: union shows schedule-fired + event-fired + manual rows. Filter by fireKind, scope, status. Pause/resume from row action edits the underlying trigger.
- Project edit: form-footer button alignment matches form column edges (Discard left = card left, Delete right = card right). Goals-migration banner shows for migrated projects.
- Old admin/skill pages 404 / redirect from their previous routes.
- **Search**: `<SearchBox>` debounces correctly on Agents list, Recurring tasks, and Skill picker modal.
- **Empty / error states**: empty Agents / Recurring tasks / Runs render `<EmptyState>` with appropriate copy.
- **RRULE preview**: spot-check `formatFireCondition()` against 5 common rrule shapes (daily, weekly Mon, monthly 1st, hourly, every 15 min).
- **Version chip**: each agent on the list shows `vN`. Tooltip shows the last-edited timestamp + author.
- **Confirmation dialogs**: type-to-confirm fires for Delete agent / Delete project (with linked agents > 0); skill remove confirms only for skills with recent runs; trigger pause confirms only for high-volume.
- **Action visibility by role**: workspace user viewing a system agent sees no Save/Delete buttons. Non-org-admin users do not see Delete agent / Delete project. Read-only label visible.
- **Skills tab tooltips**: hover over System / Org / Workspace tier chips shows the configured tooltip text.
- **Data sources status**: each binding shows the upstream connection status pill correctly.
- **Budget tab**: actual vs limit bar renders with current cap usage.
- **Runs tab**: cost column visible per run.

## 9. Coordination with Foundation, A, C

**Foundation primitives consumed:**

- `<SortableTable>` (foundation §4.3) — Agents list, Recurring-tasks list.
- `<Modal>` (foundation §4.1) — Skill picker, data-source picker, confirm-discard, agent test confirmation.
- `<FormFooter>` (foundation §4.4, with the round-14 padding fix) — Agent-edit, project-edit. Pages MUST set `<PageShell bottomPadding={100}>`.
- `<PageShell>` (foundation §4.8) — Wrapper for all four pages.
- `useViewMode` (foundation §4.6) — Agents list scope; agent-edit Test runner Workspace context dropdown.
- `<WorkspaceBadge>` (foundation §4.5) — Subaccount column on agents list (org/system view); recurring-tasks scope column.

**Shared-file edit policy** (per foundation §9):

- `client/src/config/sidebar.ts`: Build stream owns rows under the **Build** group (Agents, Automations, Recurring tasks). Coordinates with Spec C on Connections (under External, owned by Spec C).
- Production shared stylesheet: page-scoped classes only (e.g. `.agent-edit-tabs`, `.recurring-task-row`). No edits to `.form-footer`, `.page-shell`, etc.
- `shared/types/build.ts`: scoped to this stream.
- DB migrations: at most one (additive `agent_data_sources.metadata`), if needed.

**Cross-stream integration points:**
- Agent-edit Runs tab links into Spec A's Activity (filtered by agentId). The link is a route href; no API coupling.
- Agent-edit Budget tab reads spend roll-ups from Spec C's spend service. Uses the existing `agentSpendAggregateService.ts` read API; no Spec-C coupling required at write time.
- Project-edit Linked agents field reads from Spec B's own agents list.
- Recurring tasks list does NOT cross into Spec A's Activity; activity-feed entries come from runs after the trigger fires.

## 10. Deferred items

- **Bulk agent operations.** Mass-pause / mass-archive deferred until volume warrants. Single-row actions only in Phase 1.
- **Agent versioning / rollback flow.** Version chip is read-only in Phase 1. Rollback to previous prompt-revision, diff view between revisions, and revision history modal are deferred to a Phase 1.5 versioning spec. Data already exists in `agentPromptRevisions`.
- **Agent deployment lifecycle UI** (deploy / promote / rollout health). Partial — deploy confirmation dialog covered in §4.11; rollout-status indicators (healthy/degraded/stale) deferred.
- **Agent health dashboards** (error rate, latency trends, run-success rate). Defer to a separate observability spec; data partially exists in `agent_runs` aggregations.
- **Skill marketplace / discovery UI.** Skills tab is binding-only; the "browse skills" UX is the picker modal. Semantic search, recommendations, ratings deferred.
- **Data-source schema validation in UI.** Phase 1 ships a connection-level binding; per-field schema validation deferred.
- **Schedule tab visual cron editor.** Phase 1 reuses the existing trigger editor (modal) plus the `formatFireCondition()` preview. Visual cron / drag-drop scheduling deferred.
- **Agent-edit form auto-save.** Phase 1 uses explicit Save (form footer). Auto-save deferred.
- **Cost forecasting on Budget tab.** Phase 1 shows current usage + caps; forecasting (e.g. "you'll hit cap in N days") deferred.
- **Project-level Gantt / dependency view.** Out of scope; project-edit ships the form only.
- **Project objective character-count guidance / examples.** Phase 1 ships a plain textarea with hint text; example-objective gallery deferred.
- **Audit log / change history** for agent edits, project edits, skill bindings. Data exists; UI is its own spec.
- **CSV / JSON export** of agents, recurring tasks, runs. Defer to a unified export-menu primitive in a foundation patch.
- **Keyboard shortcuts** on agent-edit (Cmd+S to save, Cmd+Enter to test). Defer to global shortcut model.
- **Recurring task dependency graph** (task A depends on task B completing). Defer.
- **Recurring task estimated cost per run.** Add to deferred; data computable from agent budget × historical fire count.
- **Agents list adoption metrics in context** ("5 runs in 30d" with peer comparison "vs avg 18"). Defer.

## 11. Self-consistency check

- Goals (§1) match Implementation (§4–7)? Yes — every page and endpoint named in §1 appears in §4 (contracts), §5 (inventory), and §7 (chunks).
- Every "must" / "guarantees" claim has a backing mechanism?
  - Agent-edit ETag concurrency: `UPDATE ... WHERE etag = $expected` predicate named in §6.
  - Test idempotency: `testRunIdempotency.ts` named in §6 + §4.3.
  - Recurring-tasks SoT precedence: stated in §4.4.
- File inventory complete? Every page/component/service named in §4 appears in §5.
- Phase dependency graph clean? §7 lists C5 deps (C1–C4), C6 deps (C5), C10 deps (C6+C7+C8+C9). No cycles.
- Deferred items section exists? §10.
- Testing posture matches framing? §8 aligns with `frontend_tests: none_for_now`. Pure-function tests on the recurring-tasks aggregator + ETag derivation.
- Permissions/RLS/execution-model statements explicit? §6.

## 12. Pre-review checklist

- [x] §0 No deferred-item references; greenfield consolidation.
- [x] §1 Every reused/extended primitive has an audit row in §3.
- [x] §2 Every new file is in §5.
- [x] §3 Public APIs in §4 include shape + types + producer/consumer.
- [x] §4 If `agent_data_sources.metadata` is added: existing RLS coverage; manifest entry already present; no policy change.
- [x] §5 Execution model declared (sync + ETag + key-based test idempotency) in §6.
- [x] §6 Phase graph in §7 acyclic.
- [x] §7 `## Deferred Items` (§10) present.
- [x] §8 Self-consistency pass complete (§11).
- [x] §9 Testing posture matches framing (§8).
- [x] §10 ETag-mismatch HTTP mapping (409) declared in §6; test-idempotency hit returns existing run.
- [x] §11 Frontmatter present (top of file).

Spec ready for `spec-reviewer`.
