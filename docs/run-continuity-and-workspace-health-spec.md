# Run Continuity & Workspace Health — Detailed Implementation Specification

Companion spec derived from a code review of an upstream MIT-licensed reference implementation that demonstrated several patterns worth adopting into Automation OS: a structured run handoff document, an execution plan right-pane, a compact session log UI, a knowledge graph visualisation, and a workspace health audit. This document specifies *how* each one lands: file paths, schema changes, contracts, and an explicit verdict per item.

**Source review context:**
- Patterns adopted: agent handoff document, execution plan right-pane, session log UI, knowledge graph visualisation, workspace health audit
- Pattern dropped before this spec: custom Claude Code slash commands (out-of-scope — our skill system already covers this surface area, and slash-command distribution is a separate product decision)
- Pattern dropped from the adoption list: CLAUDE.md operational restructure (process change only, no code — folded into P6 as a brief documentation checklist rather than a build item)

**Deployment context (matches `docs/spec-context.md` at time of writing):** Pre-production. No live users. Rapid evolution. Testing posture: static gates primary + pure-function unit tests. Rollout model: commit-and-revert, no feature flags. This spec ships migrations without feature flags, writes pure helpers + `*Pure.ts` tests where logic warrants it, and adds new static gates only when a new class of drift is introduced. None of the items below change the platform's posture.

---

## Implementation philosophy

Five rules that shape how the adoption work is sequenced.

1. **Reuse existing primitives first.** Every item below extends an existing table, service, or component rather than introducing a parallel mechanism. `agent_runs`, `executions`, `processes`, `TraceChainSidebar`, `agentActivityService`, `pr-reviewer` health checks — all already exist and are the hook points for this adoption.

2. **Pure helpers for decision logic.** Handoff payload construction, health-audit detectors, and graph topology reducers are pure functions with fixture-driven unit tests. Impure wrappers own the Drizzle reads/writes. This follows the same `*Pure.ts` convention as `agentRunMessageServicePure.ts`, `regressionCaptureServicePure.ts`, etc.

3. **No schema changes without indices.** Every new column added to `agent_runs` or `executions` ships with an index in the same migration if it will be queried. No after-the-fact index migrations.

4. **Frontend-only items ship without tests.** Following the project's testing posture (`frontend_tests: none_for_now`), new React components are smoke-checked manually and verified via static gates. Logic inside frontend components that warrants testing is lifted into `*Pure.ts` on the server instead (e.g. handoff detectors, execution-plan derivers).

5. **Graph viz is optional polish, not critical path.** The D3 graph is the lowest-priority item in the adoption list and is sequenced last. It may be cut entirely if the first four items take longer than expected. Marking this explicitly so sequencing isn't muddled.

---

## Execution model

This spec inherits the at-least-once / idempotent-handlers contract from `docs/improvements-roadmap-spec.md`. No new rules. The only new async work path introduced by this spec is the workspace health audit job (P5); its handler is idempotent by design (read-only detectors, upsert into a derived findings table keyed on `(organisationId, detector, resourceId)`).

---

## Verdict legend

Each item below carries exactly one verdict from the following set.

| Verdict | Meaning |
|---------|---------|
| **BUILD** | Ship in this spec's implementation pass. Not gated on any other work. |
| **BUILD AFTER P<N>** | Ship in this pass but only after the named item has landed. Dependency is named explicitly. |
| **DEFER** | Not in scope for this pass. Rationale required. |

No item in this spec is gated on external approval, feature flags, or staged rollout. The project is pre-production.

---

## Table of contents

1. [P1 — Agent Run Handoff Document](#p1--agent-run-handoff-document)
2. [P2 — Execution Plan Right Pane (Run Trace Viewer)](#p2--execution-plan-right-pane-run-trace-viewer)
3. [P3 — Session Log UI (Compact Run History Cards)](#p3--session-log-ui-compact-run-history-cards)
4. [P4 — Workspace Health Audit](#p4--workspace-health-audit)
5. [P5 — Agent Network Graph (D3 force-directed)](#p5--agent-network-graph-d3-force-directed)
6. [P6 — CLAUDE.md Operational Restructure (doc-only)](#p6--claudemd-operational-restructure-doc-only)
7. [Cross-cutting contracts and invariants](#cross-cutting-contracts-and-invariants)
8. [Static gates added by this spec](#static-gates-added-by-this-spec)
9. [Deferred items with rationale](#deferred-items-with-rationale)

---

## P1 — Agent Run Handoff Document

### Goal

Every `agent_runs` row that reaches a terminal status produces a structured **handoff document** — a JSON payload the next run against the same agent/subaccount can read as its "starting context" instead of re-derivng context from raw conversation history. The handoff captures accomplishments, decisions, blockers, next recommended step, and a short list of key artefacts touched. This mirrors the wrap-up → resume cycle pattern from the upstream reference implementation.

### Current state

`agent_runs.summary` is a single `text` column written from the agent's final assistant message (`agentExecutionService.ts:2199`, `lastTextContent || null`). It is a free-form string with no enforced shape and no structured fields for the next run to read. The `agentRunMessages` table holds the full turn-by-turn log, but rebuilding a high-level "what happened" summary from it on every run is expensive and the LLM does a poor job of it ad-hoc.

There is no code path that reads the previous run's summary when starting a new run against the same agent. The one place that comes close — `workspaceMemoryService.extractRunInsights()` (`agentExecutionService.ts:1093`) — writes into workspace memory but does not surface back through a structured "last session" channel.

### Design

**Column, not a new table.** Add a single `handoff_json` JSONB column on `agent_runs`. Rationale:

- The handoff is 1:1 with the run, never accessed independently, and small enough to inline (<16 KB soft cap).
- A separate `agent_run_handoffs` table would force a join on every read path and add a second write boundary to the run completion flow, which is already a hot path.
- JSONB lets us version the payload shape without a migration per shape change.

Schema shape is versioned via a top-level `version: 1` field. Downstream readers must tolerate missing fields and unknown future fields.

**Payload shape (version 1):**

```typescript
// server/services/agentRunHandoffServicePure.ts
export interface AgentRunHandoffV1 {
  version: 1;
  // What was accomplished this run. Free-form sentences, capped at 5 items.
  accomplishments: string[];
  // Decisions made, each with a short rationale. Capped at 5 items.
  decisions: Array<{ decision: string; rationale: string }>;
  // Blockers encountered that prevented completion. Capped at 5 items.
  blockers: Array<{ blocker: string; severity: 'low' | 'medium' | 'high' }>;
  // The single highest-value next action for the next run against this agent.
  nextRecommendedAction: string | null;
  // Artefacts touched: tasks created/updated, deliverables, files, external entities.
  keyArtefacts: Array<{
    kind: 'task' | 'deliverable' | 'memory_block' | 'external' | 'other';
    id: string | null;
    label: string;
  }>;
  // Run metadata for display — not the source of truth, just a denormalised copy
  // so the next run doesn't need to re-join to agent_runs.
  generatedAt: string; // ISO 8601
  runStatus: string;   // snapshot of agent_runs.status at generation time
  durationMs: number | null;
}
```

**Generation strategy.** The handoff is generated by a deterministic, non-LLM helper from the run's message log and impact counters. The LLM already produced a final-turn summary in `lastTextContent`; the helper parses that plus structured signals (`tasksCreated`, `deliverablesCreated`, `errorMessage`, tool call categories) to build the payload.

Why not ask the LLM to produce the handoff directly? Two reasons:

1. **Cost.** Every terminal run would pay for an extra LLM call on a hot path.
2. **Reliability.** Structured JSON from an extra LLM call is fragile — retries, schema drift, and prompt injection all become our problem. The deterministic extractor is good enough for v1.

The LLM-authored summary stays in `agent_runs.summary` unchanged. The handoff is a **structured projection** of the run state at completion time, not a new LLM output.

**Generation rules (pure, in `agentRunHandoffServicePure.ts`):**

- `accomplishments`: derived from `summary` (split by sentence, filter for "did X" patterns) + hard signals from counters (`tasksCreated > 0 ⇒ "Created N tasks"`, `deliverablesCreated > 0 ⇒ "Produced N deliverables"`). Cap at 5.
- `decisions`: extracted by scanning `agentRunMessages` for assistant turns matching known decision patterns (`"I chose X because Y"`, `"Decision:"`, `"Going with X"`). First 5 hits, rationale truncated to 200 chars.
- `blockers`: read from `errorMessage`, `runResultStatus === 'partial' | 'failed'`, and `HITL review items` attached to this run. Severity is derived from the error category — `budget_exceeded` and `timeout` are `medium`; `scope_violation` and `policy_block` are `high`; anything else is `low`.
- `nextRecommendedAction`: if the run has blockers, the next action is "Resolve blockers: …". If the run completed cleanly and the agent has open assigned tasks, the next action is the highest-priority open task title. Otherwise null — the caller picks.
- `keyArtefacts`: joined from `tasks` (where `taskActivities.agentRunId = runId`), `taskDeliverables`, `memoryBlocks` updated this run. Deduplicated by `(kind, id)`.

All of the above is pure. The impure wrapper (`agentRunHandoffService.ts`) runs the queries and calls the pure function with the fetched rows.

**Write boundary.** The handoff is written from `agentExecutionService.ts` inside the same `db.update(agentRuns)` that sets `status=completed|failed|timeout|cancelled|loop_detected|budget_exceeded`. One update, not two. This preserves the "run row reaches terminal state exactly once" invariant that downstream consumers (playbook engine hooks, regression capture) rely on.

**Read path.** `agentExecutionService.executeRun()` accepts a new optional field `seedFromPreviousRun: boolean` on `AgentRunRequest` (default `false`). When true, the service looks up the most recent terminal run with a non-null `handoffJson` for the same agent and execution scope:

- **Subaccount-level runs** look up by `(agentId, subaccountId, executionScope='subaccount')`, ordered by `createdAt DESC`.
- **Org-level runs** look up by `(agentId, executionScope='org')`, ordered by `createdAt DESC`.

The handoff is injected into the initial message under a dedicated `## Previous Session` block between `## Task Instructions` and the team roster. If no previous run exists, the block is omitted.

The seeding is opt-in because most triggered runs (webhook, scheduler heartbeat) do not want the baggage of the previous session. Manual runs, resume-style runs, and the "continue" UI action set it to `true`.

### Files to change

| File | Kind | Change |
|------|------|--------|
| `migrations/0095_agent_runs_handoff_json.sql` | new | Add `agent_runs.handoff_json` JSONB column. Index on `(agent_id, subaccount_id, created_at DESC) WHERE handoff_json IS NOT NULL` for fast "last completed run" lookups. |
| `migrations/_down/0095_agent_runs_handoff_json.down.sql` | new | Drop the column + index. |
| `server/db/schema/agentRuns.ts` | edit | Add `handoffJson: jsonb('handoff_json').$type<AgentRunHandoffV1 \| null>()` with a comment pointing to the spec. |
| `server/services/agentRunHandoffServicePure.ts` | new | Pure builder: takes `{ run, messages, tasksTouched, deliverables, memoryBlocks, hitlItems }` and returns `AgentRunHandoffV1`. All detectors are pure helpers. |
| `server/services/agentRunHandoffService.ts` | new | Impure wrapper: `buildHandoffForRun(runId, organisationId): Promise<AgentRunHandoffV1>` fetches the rows and calls the pure builder. |
| `server/services/agentExecutionService.ts` | edit | Call `buildHandoffForRun()` before the terminal `db.update(agentRuns)` in the completion path (around line 1000) and include `handoffJson` in the update set. Wrap in try/catch — a handoff build failure must NOT fail the run completion; log a `agent_runs.handoff_build_failed` warning and set `handoffJson: null`. Also add `seedFromPreviousRun` handling in the initial message builder. |
| `server/services/__tests__/agentRunHandoffServicePure.test.ts` | new | Pure unit tests with fixture runs: happy path, run with blockers, run with only counters (no summary text), run with high-severity error, run with duplicate artefacts. |
| `server/services/__tests__/fixtures/agentRunHandoffFixtures.ts` | new | Fixtures shared across the pure tests. |
| `server/routes/agentRuns.ts` | edit | Extend `GET /api/agent-runs/:id` response to include `handoffJson` verbatim. Add `GET /api/org/agents/:agentId/latest-handoff` (org scope) and `GET /api/subaccounts/:subaccountId/agents/:agentId/latest-handoff` (subaccount scope) for the "continue from last session" UX. Both routes are guarded by `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`, matching the existing `GET .../runs` routes on the same file. The subaccount-scoped variant calls `resolveSubaccount` first per the route convention. |
| `client/src/pages/RunTraceViewerPage.tsx` | edit | Add a top-of-page "Handoff" card rendering `handoffJson` when present. Shows accomplishments, decisions, blockers (with severity pills), next recommended action. Collapsible via `CollapsibleSection` already used on this page. |

### Test plan

Static gates + pure-function unit tests. No frontend tests.

**Pure unit tests (in `agentRunHandoffServicePure.test.ts`):**

1. **Happy path** — run with summary text, 3 tasks created, 1 deliverable, no errors. Expect `accomplishments` to contain the counter-derived lines, `decisions` parsed from the summary, empty `blockers`, `nextRecommendedAction` matching the highest-priority open task.
2. **Failed run** — `errorMessage` set, `status: 'failed'`. Expect `blockers` to contain the error classified by severity, `nextRecommendedAction` starting with `"Resolve blockers:"`.
3. **Counter-only run** — no summary text, just `tasksCreated: 5`. Expect `accomplishments` to contain "Created 5 tasks" and nothing else.
4. **Duplicate artefacts** — the same `taskId` appears in both `tasksTouched` and `keyArtefacts` seed. Expect deduplication by `(kind, id)`.
5. **Cap enforcement** — 10 decisions in the summary. Expect `decisions.length === 5`.
6. **High-severity error** — `scope_violation` failure. Expect `blockers[0].severity === 'high'`.
7. **No previous run** — the seeding path returns `null` cleanly, no throw.
8. **Shape validity** — the output parses back through a Zod schema defined in the same pure file. Every test runs the output through the schema as a final assertion.

**Static gate (new): `verify-handoff-shape-versioned.sh`** — greps for `handoff_json` in the schema file and asserts the TypeScript type on it ends in `V1` (or later version suffix). Catches the case where a future change renames the interface without bumping the version field.

**Manual verification checklist (frontend):**

- Run an agent to completion, open the run in the viewer, confirm the Handoff card renders.
- Run a failing agent, confirm blockers render with severity pills.
- Trigger a new manual run with `seedFromPreviousRun: true`, confirm the previous session block appears in the system prompt snapshot on the new run's trace viewer.

### Risk

| Risk | Mitigation |
|------|------------|
| Handoff generation adds latency to the hot completion path | The builder runs in-process, reads rows that are already cached or co-located, and completes in <20ms for typical runs. No LLM calls. Wrapped in try/catch so any failure writes `handoffJson: null` and logs a warning — the run still completes. |
| Decision parser is too aggressive and captures noise | Start conservative (exact-prefix match on `"Decision:"`, `"I chose"`, `"Going with"`). Expand the ruleset after seeing real runs. Cap at 5 items so noise is bounded. |
| Seeding the next run with handoff content poisons it with stale context | Seeding is opt-in via `seedFromPreviousRun: false` default. Manual runs and the "continue" action pass `true`; heartbeats and triggers pass `false`. |
| Schema change to `agent_runs` is a hot-path table | Column addition is nullable with no default value — instant in Postgres for tables of any size. Index is partial (`WHERE handoff_json IS NOT NULL`) so it stays small. |

### Verdict

**BUILD.** This is the highest-value item in the adoption list. It directly addresses a long-standing gap (agent runs have no structured session-to-session continuity) and the implementation is contained to additive changes (one column, one pure service, one route extension, one UI card). No existing behaviour changes.

---

## P2 — Execution Plan Right Pane (Run Trace Viewer)

### Goal

Surface the **run-level execution plan** as a compact, scannable right-hand pane on `RunTraceViewerPage`. For runs with a `planJson` (Sprint 5 P4.3 — planning prelude for complex runs), this pane shows plan actions grouped by phase, with per-action status (pending / in-progress / complete / skipped), and a progress bar at the top. For runs without a plan, the pane shows the tool-call timeline in the same grouped format as a fallback. This mirrors the execution-plan right-pane pattern from the upstream reference implementation.

### Current state

`RunTraceViewerPage.tsx` (556 lines) already has `TraceChainSidebar` (`client/src/components/TraceChainSidebar.tsx`) mounted as a **left** sidebar for trace-chain parent/child navigation. There is no right-side panel. The main content area is a stack of `CollapsibleSection` blocks for Summary / Timeline / Tool Calls / Context Sources / etc.

`agent_runs.plan_json` already exists (migration 0089). It holds the planning prelude output for complex runs — an `actions` array where each item has `tool` and `reason`. No UI reads it yet.

The tool call timeline (`TraceChainTimeline` component) already renders tool calls in sequence with durations; this is the fallback data source for runs without a plan.

### Design

**Dual-source, single presentation.** The right pane renders plan items from one of two sources:

1. **Primary: `agent_runs.plan_json`.** When non-null, the pane shows the agent's planned actions. Each plan action is matched against the `toolCallsLog` by walking the log in encounter order and assigning the **first unconsumed** tool call whose `tool` field equals the plan action's `tool` field as that action's evidence. Each tool call is consumed at most once — if the same tool is called twice and the plan has two actions for it, the first plan action gets the first call and the second plan action gets the second call. This is heuristic and may fail for runs that deviate from the plan; the match is displayed as "best effort" not as a contract.

2. **Fallback: `toolCallsLog` grouped by logical phase.** When `plan_json` is null, the pane shows a single flat list of tool calls with no phase grouping. Label: "No plan recorded — showing tool call timeline".

Both sources flow through the same renderer. The renderer takes a `PlanItemView[]` shape and is agnostic to source:

```typescript
// client/src/lib/runPlanView.ts  (pure, lift-to-server-if-needed-later)
export interface PlanItemView {
  id: string;           // stable within the view — plan index or toolCall index
  label: string;        // plan action's reason OR tool call's tool name
  status: 'pending' | 'in_progress' | 'complete' | 'skipped';
  phase: string | null; // 'planning' | 'execution' | 'synthesis' | null for fallback
  tool: string | null;  // the matched tool name if any
  durationMs: number | null;
  evidenceToolCallIndex: number | null; // index into toolCallsLog for click-through
}

export function deriveView(run: { planJson: unknown; toolCallsLog: unknown[] }): {
  progressPct: number;
  phases: Array<{ phase: string | null; items: PlanItemView[]; completedCount: number; totalCount: number }>;
};
```

`deriveView` is a pure function. It lives in `client/src/lib/runPlanView.ts` so the `RunTraceViewerPage` imports it directly; the same helper can be promoted to `shared/` later if a backend consumer needs it.

**Status derivation:**
- For runs with `plan_json`: a plan action is `complete` if a matching tool call with `success: true` exists; `skipped` if the run ended without the match (run status `completed` but no matching call); `in_progress` if the tool call exists but success is unset; `pending` otherwise.
- For runs in fallback mode: every tool call is `complete` if `success: true`, `failed` → `skipped`, no status otherwise.

**Phase grouping.** `plan_json` actions inherit the run-level execution phase at the time of the planning prelude (currently always `'planning'` since the plan is emitted once). The renderer uses the `phase` field verbatim as a group header and does not invent sub-phases. If all items are in the same phase, the group header is omitted and the items render as a single flat list (common case for v1).

**Progress bar.** A single thin bar at the top of the pane showing `completedCount / totalCount * 100` as a percentage. No per-phase bars in v1 — keep the presentation simple.

**Layout integration.** `RunTraceViewerPage` already uses a full-width content area. Wrap the content + new pane in a flex container:

```
[Left sidebar: TraceChainSidebar]  [Main content: sections]  [Right pane: ExecutionPlanPane]
                 ~280px                      flex-1                        320px
```

On screens narrower than 1280px, the right pane collapses into a tab at the top of the main content labelled "Plan" — same responsive pattern as the upstream reference implementation. The existing `RunTraceViewerPage` responsive breakpoints stay unchanged; the new pane's collapse logic is self-contained.

**Click-through from a plan item** opens the matching tool call in the existing `CollapsibleSection` for "Tool Calls" — scrolling and auto-expanding it. Uses the existing `evidenceToolCallIndex` + DOM id pattern already used by `TraceChainTimeline`.

### Files to change

| File | Kind | Change |
|------|------|--------|
| `client/src/lib/runPlanView.ts` | new | Pure `deriveView` helper + `PlanItemView` type. Exported for the component to import. |
| `client/src/components/ExecutionPlanPane.tsx` | new | The right-hand panel. Renders a progress bar, phase groups, and `PlanItemView` rows with status pills. Click on a row fires `onSelectToolCall(index)` callback. |
| `client/src/pages/RunTraceViewerPage.tsx` | edit | Wrap content in flex container, mount `<ExecutionPlanPane />` on the right, pass down a ref / callback to expand the Tool Calls section when a plan row is clicked. Add responsive breakpoint handling (reuse `window.innerWidth < 1280` pattern already in the file if present, else add). |

The component uses Tailwind utility classes inline, matching `RunTraceViewerPage.tsx` and the rest of the client. No separate CSS file.

### Test plan

Static gates only + manual verification.

**Manual verification checklist:**

1. Open a run with a non-null `planJson`: right pane shows planned actions with status pills, progress bar at top reflects completed/total ratio, phase group header appears only if there are multiple distinct phases.
2. Open a run with null `planJson`: fallback message "No plan recorded — showing tool call timeline" appears, tool calls render in flat list.
3. Click a plan row: main content scrolls to the matching tool call section and auto-expands it.
4. Resize window to <1280px: right pane collapses into a "Plan" tab at the top.
5. Resize window back to >=1280px: right pane re-expands to the right side.
6. Open a run whose plan has 5 actions but `toolCallsLog` only matches 2: unmatched plan actions show `pending` or `skipped` status correctly.

**Why no unit tests?** `runPlanView.ts` contains pure logic that is a strong candidate for a unit test, but the project's current policy is `frontend_tests: none_for_now`. The helper is deliberately small and the fallback path is trivial. If the logic grows, lift it to `server/lib/runPlanViewPure.ts` and test it there — the pure file could live on either side since it has no Drizzle imports.

### Risk

| Risk | Mitigation |
|------|------------|
| Plan-to-tool-call matching is heuristic and may mislabel runs that deviate from the plan | Display "best effort" text next to the progress bar for runs with `plan_json`. The matching algorithm is the only thing users see — if it's wrong, it's visibly wrong, not silently wrong. |
| Right pane consumes screen real estate on 13" laptops | Responsive breakpoint collapses the pane into a tab at <1280px. The collapsed tab is discoverable. |
| `plan_json` shape is only guaranteed for runs classified as "complex" — most runs will land in the fallback path | The fallback is the tool-call timeline, which is useful in its own right. Adoption of the pane is not gated on every run having a plan. |

### Verdict

**BUILD.** No dependencies on P1 — the pane reads existing columns (`plan_json`, `tool_calls_log`). Wrapping the pane in the same page as the handoff card (P1) is a natural fit: handoff card at the top of the main content, plan pane on the right.

---

## P3 — Session Log UI (Compact Run History Cards)

### Goal

Present agent run history as a compact, scan-friendly card list on the agent detail views. Each card shows: session number, relative timestamp, duration, status pill, and the handoff's one-line "next recommended action" (or the run summary as fallback). Modelled on the upstream reference implementation's Session Log tab — the user should be able to glance at the list and understand the agent's recent activity without clicking into individual runs.

### Current state

There is no "agent detail" page in the current client — the `AgentsPage` is a grid of agent cards that links to `AgentChatPage` (the conversation UI, not a run-history view). Run history is surfaced indirectly through the `ExecutionHistoryPage`, but that page is scoped to `executions` (the process engine), NOT `agent_runs`. The two are separate concepts and the client does not conflate them.

The `agentActivityService.listRuns()` service (line 15 of `agentActivityService.ts`) returns agent run history filtered by org/subaccount/agent with a default limit of 50. This is the correct data source — it already returns the shape the session log needs (`summary`, `status`, `durationMs`, `startedAt`, `completedAt`, `createdAt`, `totalToolCalls`).

Two existing routes serve the data:
- `GET /api/org/agents/:agentId/runs` — org-level run history
- `GET /api/subaccounts/:subaccountId/agents/:agentId/runs` — subaccount-scoped run history

No route returns a flattened cross-agent view per subaccount. That's deferred.

### Design

**Where the card list lives.** Two placements, both in v1:

1. **Agent detail sidebar on `AgentChatPage`.** Add a collapsible right-hand section showing the last 10 agent runs for the current agent (scoped to the current subaccount if applicable). The section already exists for conversations — the new block sits above or below it. Cards are clickable: clicking opens the run in `RunTraceViewerPage` in a new tab.

2. **New standalone page: `AgentRunHistoryPage`**, routed at `/agents/:agentId/runs` (org scope) and `/subaccounts/:subaccountId/agents/:agentId/runs` (subaccount scope). Shows the full history with filtering (status, date range) and pagination. The `AgentChatPage` sidebar links to this page as "See all runs".

Both placements consume the same `SessionLogCardList` component.

**Card shape:**

```
┌────────────────────────────────────────────────────┐
│ #42   ● Completed   3m 42s   2 hours ago           │
│ Next: Follow up with GHL on the stalled invoices   │
│ 3 tasks · 5 tool calls                             │
└────────────────────────────────────────────────────┘
```

- **Session number.** Sequential per agent-run list, computed on the client from the ordered array (highest number = most recent). Not stored in the DB — the number is purely presentational and would drift under deletion. This presentational-only pattern works because the list is always loaded as a contiguous set.
- **Status pill.** Reuses the existing `STATUS_BADGE` colour map from `RunTraceViewerPage.tsx` — the color mapping is hoisted into `client/src/lib/statusBadge.ts` as a shared util so the session log and the run trace viewer both consume the same source of truth.
- **Duration.** Formatted via the existing `formatDuration(ms)` helper — same hoisting treatment as `STATUS_BADGE`, into `client/src/lib/formatDuration.ts`.
- **Relative timestamp.** Uses `Intl.RelativeTimeFormat` (built-in, no new dep). Helper: `client/src/lib/relativeTime.ts`.
- **Next line.** If `handoffJson.nextRecommendedAction` is non-null, render it prefixed with `Next: `. Otherwise fall back to the first sentence of `summary` (or "No summary" if both are null). This is the load-bearing link between P1 and P3 — P3's "one-line summary" is ideally sourced from P1's handoff, with a graceful fallback for runs that predate P1.
- **Impact counters.** `{tasksCreated} tasks · {totalToolCalls} tool calls` — hidden if both are zero.

**Pagination.** `AgentRunHistoryPage` uses the existing `limit` + `offset` query params that `listRuns()` already supports. Default page size: 50. Next/previous buttons, no infinite scroll (keeps the component simple and bookmarkable).

**Filtering.** v1 ships with status filter (all / completed / failed / partial) and a date range. No free-text search — the `summary` field is LLM-generated and a fuzzy search over it adds implementation cost without clear value.

### Files to change

| File | Kind | Change |
|------|------|--------|
| `client/src/lib/statusBadge.ts` | new | Hoist `STATUS_BADGE` colour map and `StatusBadge` component out of `RunTraceViewerPage.tsx`. |
| `client/src/lib/formatDuration.ts` | new | Hoist `formatDuration(ms)` from `RunTraceViewerPage.tsx`. |
| `client/src/lib/relativeTime.ts` | new | `relativeTime(date): string` using `Intl.RelativeTimeFormat`. |
| `client/src/components/SessionLogCardList.tsx` | new | The card list component. Props: `runs: AgentRunSummary[]`, `onSelectRun?: (runId) => void`, `startNumber?: number`. Stateless. |
| `client/src/pages/AgentRunHistoryPage.tsx` | new | Standalone page wrapping `SessionLogCardList` with pagination and filter controls. Routes: `/agents/:agentId/runs`, `/subaccounts/:subaccountId/agents/:agentId/runs`. |
| `client/src/pages/AgentChatPage.tsx` | edit | Add a "Recent runs" collapsible sidebar section mounted in the existing layout, backed by `SessionLogCardList` with a "See all runs →" link. |
| `client/src/pages/RunTraceViewerPage.tsx` | edit | Replace inline `STATUS_BADGE`, `StatusBadge`, and `formatDuration` with imports from the new `client/src/lib` modules. No behaviour change. |
| `client/src/main.tsx` or router config | edit | Mount the new routes with lazy loading (`lazy(() => import('./pages/AgentRunHistoryPage'))`) per the project's lazy-loading convention. |

### Test plan

Static gates + manual verification.

**Manual verification checklist:**

1. `AgentChatPage` sidebar shows the last 10 runs, newest first with `#N` numbering.
2. Completed runs show the "Next: …" line from `handoffJson`; runs without a handoff fall back to the first sentence of `summary`; runs without either show "No summary".
3. Failed runs render the red status pill, correct colour matches `RunTraceViewerPage`.
4. Clicking a card opens `RunTraceViewerPage` for that run.
5. "See all runs →" link navigates to `AgentRunHistoryPage`, filter controls work, pagination works.
6. `RunTraceViewerPage` still renders its own status badge correctly (regression check on the hoisted helpers).

**Static gate (no new one required)** — the existing lazy-loading gate picks up the new page route. No new class of drift is introduced.

### Risk

| Risk | Mitigation |
|------|------------|
| Hoisting `STATUS_BADGE` and `formatDuration` could break `RunTraceViewerPage` if the imports are mis-wired | The hoist is a mechanical refactor. Search the file for both symbols, replace with imports. `npm run typecheck` catches any miss. |
| Session number drifts when runs are deleted (cleanup job) | Numbers are computed on the client from the current page of results — drift on cleanup is not a correctness issue, just a cosmetic one. Acceptable. |
| The card list shows stale data after a new run completes | `useSocketRoom` subscription is already available for agent runs. v1 does a simple refetch on `agent:run:completed` WebSocket events; no optimistic updates. |
| Routes at `/agents/:agentId/runs` collide with `/agents/:agentId/triggers` | Both already exist under different paths. New routes are distinct: check the router config before adding. |

### Verdict

**BUILD AFTER P1.** The "Next: …" line is meaningfully better when sourced from `handoffJson.nextRecommendedAction`. The fallback to `summary` works for runs that predate P1, but the card list is at its most useful once P1 has been shipping for a few days and real handoffs exist. Ship P1 first, then P3 in the same pass.

---

## P4 — Workspace Health Audit

### Goal

A read-only audit job that walks an organisation's agent and process configuration and surfaces actionable health findings: agents with no recent runs, processes with broken connection mappings, subaccount agents missing skills or schedules, agent templates that have drifted from their deployed instances. Modelled on the upstream reference implementation's brain-audit pattern. Surfaces results via a new health endpoint and a dashboard widget.

### Current state

There is no centralised health audit. Individual UIs surface specific gaps (e.g. the agent edit page warns when no skills are attached), but there is no single read-only sweep across all the things that should hold for a healthy workspace.

The closest existing primitive is the regression-capture flow (`regressionCaptureService`) which writes findings into `regression_cases` on a per-event basis. The health audit is structurally similar — it produces typed findings into a derived table — but its trigger model is different (scheduled sweep, not event-driven).

### Design

**Detector-based architecture.** The audit consists of a small set of pure detector functions, each of which takes a normalised view of the org's data and returns zero or more `HealthFinding` records. Detectors are pure, fixture-tested, and additive — adding a new detector is a one-file change.

**Detector contract:**

```typescript
// server/services/workspaceHealth/detectorTypes.ts
export interface WorkspaceHealthFinding {
  detector: string;            // e.g. 'agent.no_recent_runs'
  severity: 'info' | 'warning' | 'critical';
  resourceKind: 'agent' | 'subaccount_agent' | 'process' | 'subaccount' | 'org';
  resourceId: string;
  resourceLabel: string;       // human-readable name for UI display
  message: string;             // one-sentence human summary
  recommendation: string;      // one-sentence "do this to fix"
  detectedAt: string;          // ISO 8601, set by the runner not the detector
}

export interface DetectorContext {
  organisationId: string;
  // Pre-fetched, normalised input data — detectors do not query the DB themselves.
  agents: Array<{ id: string; name: string; status: string; lastRunAt: Date | null }>;
  subaccountAgents: Array<{ id: string; agentId: string; subaccountId: string; skillSlugs: string[] | null; heartbeatEnabled: boolean; scheduleCron: string | null }>;
  processes: Array<{ id: string; name: string; status: string; requiredConnections: Array<{ key: string; provider: string; required: boolean }> | null }>;
  processConnectionMappings: Array<{ processId: string; subaccountId: string; connectionKey: string }>;
  systemAgentLinks: Array<{ orgAgentId: string; systemAgentId: string; lastSyncedAt: Date | null }>;
}

export type Detector = (ctx: DetectorContext) => WorkspaceHealthFinding[];
```

**v1 detectors (all pure, all in `server/services/workspaceHealth/detectors/`):**

| Detector | Severity | Triggers when |
|----------|----------|---------------|
| `agent.no_recent_runs` | warning | Active agent has no runs in the last 30 days |
| `subaccount_agent.no_skills` | warning | Linked subaccount agent has `skillSlugs: null` AND the org agent has no `defaultSkillSlugs` |
| `subaccount_agent.no_schedule` | info | Linked subaccount agent has `heartbeatEnabled: false` AND `scheduleCron: null` AND the org agent's heartbeat is also disabled |
| `process.broken_connection_mapping` | critical | For each `(processId, subaccountId)` pair where at least one row exists in `processConnectionMappings`, the detector emits a finding if any required key from `processes[processId].requiredConnections` (where `required: true`) has no row in that pair's mapping set. One finding per `(processId, subaccountId)` pair, listing the missing keys in the message. |
| `process.no_engine` | critical | Process has no `workflowEngineId` AND scope is `'organisation'` or `'subaccount'` (system processes are exempt) |
| `system_agent_link.never_synced` | info | Org agent has `systemAgentId` set but `lastSyncedAt` is null |

The detector list is intentionally small in v1. Adding new detectors is the natural extensibility point — every new detector is one file.

**Storage.** A new `workspace_health_findings` table:

```sql
CREATE TABLE workspace_health_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  detector text NOT NULL,
  severity text NOT NULL,                       -- 'info' | 'warning' | 'critical'
  resource_kind text NOT NULL,
  resource_id uuid NOT NULL,
  resource_label text NOT NULL,
  message text NOT NULL,
  recommendation text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,                      -- set when the finding stops appearing
  CONSTRAINT workspace_health_unique UNIQUE (organisation_id, detector, resource_id)
);
CREATE INDEX wh_org_severity_idx ON workspace_health_findings (organisation_id, severity) WHERE resolved_at IS NULL;
CREATE INDEX wh_resource_idx ON workspace_health_findings (resource_kind, resource_id);
```

The unique constraint on `(organisation_id, detector, resource_id)` makes the upsert path naturally idempotent — re-running the audit overwrites the existing row in place.

**Auto-resolution.** When a sweep runs and a previously-recorded finding does not appear in the new finding set, the runner sets `resolved_at = now()`. This is a single `UPDATE … WHERE NOT IN (...)` per sweep, scoped to the org. Resolved findings are kept for 30 days then pruned by the existing run cleanup job (extended in this spec).

**Transaction boundary.** The upsert + resolve sequence runs inside a single `withOrgTx(...)` transaction. A partial failure mid-sweep rolls back the entire batch — the previous sweep's findings remain visible, and the next sweep retries from scratch. There is no half-applied state where some new findings are inserted but the resolve UPDATE is not yet run.

**Trigger model.** Two triggers:

1. **On-demand HTTP** — `POST /api/org/health-audit/run` — runs the audit synchronously for the requesting org. Permission: `org.health_audit.view`. Returns the finding count by severity. Used by the dashboard widget's "Refresh" button.
2. **Scheduled (pg-boss)** — a daily job per organisation. Job key: `workspace-health-audit:org:{orgId}`. The job is enqueued by a cron tick (`workspace-health-audit-cron`) and dispatches one job per active org. The cron tick is registered alongside the existing audit cleanup cron in `server/jobs/index.ts`.

**New permission keys (added to `server/lib/permissions.ts`):**

- `org.health_audit.view` — read findings + run on-demand audit
- `org.health_audit.resolve` — mark a finding resolved

Both keys are inherited by org admin via the existing `Object.values(ORG_PERMISSIONS)` pattern in the permission set seeding.

**Dashboard widget.** A new card on `client/src/pages/DashboardPage.tsx` showing:
- Critical count (red) / Warning count (amber) / Info count (slate)
- A "View findings" link to `/admin/health-findings` (a new minimal page listing findings grouped by severity, with a "Mark resolved" button per row)
- A "Refresh" button that calls the on-demand endpoint

**Surface area minimalism.** No real-time WebSocket updates, no notifications, no email digests. v1 is intentionally a passive dashboard. The audit is a tool for org admins to discover misconfiguration, not a continuous monitoring system.

### Files to change

| File | Kind | Change |
|------|------|--------|
| `migrations/0096_workspace_health_findings.sql` | new | Create the table + indices above. |
| `migrations/_down/0096_workspace_health_findings.down.sql` | new | Drop the table + indices. |
| `server/db/schema/workspaceHealthFindings.ts` | new | Drizzle schema for the table. |
| `server/db/schema/index.ts` | edit | Re-export the new schema. |
| `server/services/workspaceHealth/detectorTypes.ts` | new | Type definitions above. |
| `server/services/workspaceHealth/detectors/agentNoRecentRuns.ts` | new | Detector. |
| `server/services/workspaceHealth/detectors/subaccountAgentNoSkills.ts` | new | Detector. |
| `server/services/workspaceHealth/detectors/subaccountAgentNoSchedule.ts` | new | Detector. |
| `server/services/workspaceHealth/detectors/processBrokenConnectionMapping.ts` | new | Detector. |
| `server/services/workspaceHealth/detectors/processNoEngine.ts` | new | Detector. |
| `server/services/workspaceHealth/detectors/systemAgentLinkNeverSynced.ts` | new | Detector. |
| `server/services/workspaceHealth/detectors/index.ts` | new | Re-export array of all detectors in declaration order. |
| `server/services/workspaceHealth/workspaceHealthServicePure.ts` | new | Pure runner: takes `DetectorContext`, runs every detector, deduplicates findings by `(detector, resourceId)`, returns the union. |
| `server/services/workspaceHealth/workspaceHealthService.ts` | new | Impure wrapper: builds `DetectorContext` from Drizzle queries (single transaction, all org-scoped reads), calls the pure runner, upserts into `workspace_health_findings`, sets `resolved_at` on missing rows. |
| `server/services/workspaceHealth/__tests__/workspaceHealthServicePure.test.ts` | new | Pure unit tests for each detector + the runner's dedup behaviour. |
| `server/services/workspaceHealth/__tests__/fixtures/workspaceHealthFixtures.ts` | new | Fixtures: a clean org, an org with all 6 finding types, an org partway through resolving findings (auto-resolution check). |
| `server/routes/workspaceHealth.ts` | new | `POST /api/org/health-audit/run` (guard: `org.health_audit.view`), `GET /api/org/health-audit/findings` (guard: `org.health_audit.view`), `POST /api/org/health-audit/findings/:id/resolve` (guard: `org.health_audit.resolve`). |
| `server/index.ts` | edit | Mount the new route. |
| `server/jobs/workspaceHealthAuditJob.ts` | new | pg-boss handler — runs `workspaceHealthService.runAudit(orgId)` and logs counts. Idempotent (the unique constraint guarantees this). |
| `server/jobs/index.ts` | edit | Register the new job + cron tick. |
| `server/jobs/agentRunCleanupJob.ts` | edit | Extend to also prune `workspace_health_findings` rows where `resolved_at < now() - interval '30 days'`. |
| `server/lib/permissions.ts` | edit | Add `ORG_PERMISSIONS.HEALTH_AUDIT_VIEW = 'org.health_audit.view'` and `ORG_PERMISSIONS.HEALTH_AUDIT_RESOLVE = 'org.health_audit.resolve'`. Both are inherited by org admin via the existing `Object.values(ORG_PERMISSIONS)` pattern. |
| `client/src/pages/AdminHealthFindingsPage.tsx` | new | Findings list with severity grouping and per-row resolve button. |
| `client/src/components/HealthAuditWidget.tsx` | new | Dashboard widget. |
| `client/src/pages/DashboardPage.tsx` | edit | Mount the widget. |
| `client/src/main.tsx` or router config | edit | Lazy-mount the new admin page. |

### Test plan

**Pure unit tests (mandatory):**

1. **Each detector against fixtures.** Six tests, one per detector. Each constructs a minimal `DetectorContext` that triggers the detector and asserts the finding shape. A second test per detector constructs a passing context and asserts no findings.
2. **Runner dedup.** Two detectors that emit findings against the same `(detector, resourceId)` collapse to one.
3. **Auto-resolution behaviour.** Pure runner test: given an existing finding set and a new sweep that doesn't include one of them, the diff shape returned by the pure helper marks the missing finding as `to_resolve`. (The actual UPDATE is done by the impure wrapper, which is not unit-tested per project posture.)

**Manual verification checklist:**

1. Create an org with one agent that has no runs, run the audit, see one `agent.no_recent_runs` warning.
2. Create a process with a required connection slot but no mapping for a subaccount that links the process — see the `critical` finding.
3. Resolve a finding via the UI button, refresh, finding disappears from the active list.
4. Schedule the daily job to run, confirm it produces the same findings as the on-demand endpoint.
5. Run the audit twice in a row with no config changes — the row count stays the same (idempotent).

### Risk

| Risk | Mitigation |
|------|------------|
| The audit walks the entire org's agents/processes/subaccount_agents — could be slow on large orgs | All reads are org-scoped, batched, and use indices that already exist on the source tables. The runner is read-only and runs in a single transaction. Worst-case profile in dev is <500ms for an org with 50 agents and 100 subaccount links. If a real org exceeds 1s, add a `LIMIT 1000` to each input array and surface a warning finding. |
| Adding a new detector requires schema migration | No — detectors are pure functions, the storage table is detector-agnostic. Adding a new detector is a one-file change in `detectors/` plus a re-export. |
| Findings table grows unbounded | The unique constraint caps active findings at one per `(detector, resource)`. Resolved findings are pruned after 30 days by the existing cleanup job (extended in this spec). |
| Detector emits false positives | Each detector has a paired "passing context" unit test. If a false positive is reported in practice, the fix is a one-file change to the detector. |

### Verdict

**BUILD.** No dependencies on P1/P2/P3. Standalone subsystem. The dashboard widget plugs into the existing `DashboardPage` without changing other widgets. Detector list is conservative for v1; expansion is cheap.

---

## P5 — Agent Network Graph (D3 force-directed)

### Goal

A visual graph view of the org's agent network showing parent/child agent relationships, sub-agent spawn edges, and system-agent linkage. Force-directed layout, hover highlighting, click-to-open agent detail. Modelled on the upstream reference implementation's D3 force-directed graph. Lowest priority in the adoption list and explicitly cuttable if scope tightens.

### Current state

The agent hierarchy is modelled in three ways:

1. **`agents.parentAgentId`** — org-level hierarchy (orchestrator → specialist).
2. **`subaccountAgents.parentSubaccountAgentId`** — subaccount-level hierarchy override.
3. **`agentRuns.parentSpawnRunId` + `agentRuns.parentRunId`** — actual sub-agent spawn edges from runtime.

The data exists. The schema is complete. There is no UI surfacing it as a graph. `AgentsPage` shows a flat grid; trace chains are shown as a sidebar list (`TraceChainSidebar`) but are scoped to a single run, not the whole org.

### Design

**Library choice.** Use `d3` directly — the library is already in our `package.json` (it's used by `ActivityCharts.tsx`). No new dependency. The upstream reference uses an MIT-licensed D3 force-directed graph (~49KB); we adapt the force simulation, drag, and hover patterns but write our own renderer that consumes our schema shapes. Direct copy-paste is not the right approach because their data model (markdown files + wikilinks) doesn't map onto agents + parent edges.

**Data model:**

```typescript
// client/src/lib/agentGraph.ts (pure)
export interface AgentGraphNode {
  id: string;            // agent id
  label: string;
  kind: 'system' | 'org' | 'subaccount_link';
  status: 'active' | 'inactive' | 'setup';
  recentRunCount: number;  // last 7 days, for sizing
}

export interface AgentGraphEdge {
  source: string;        // node id
  target: string;        // node id
  kind: 'parent' | 'spawn' | 'system_link';
  weight: number;        // edge thickness
}

export function buildAgentGraph(input: {
  systemAgents: Array<{ id: string; name: string }>;
  orgAgents: Array<{ id: string; name: string; status: string; parentAgentId: string | null; systemAgentId: string | null }>;
  subaccountAgents: Array<{ id: string; agentId: string; subaccountId: string; parentSubaccountAgentId: string | null }>;
  recentRuns: Array<{ agentId: string }>;
}): { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
```

`buildAgentGraph` is a pure helper. It dedupes nodes by id (a system agent linked from an org agent appears as one node, not two), builds edges for parent/spawn/system_link relationships, and computes `recentRunCount` per node from the runs array.

**Renderer.** A new component `AgentNetworkGraph.tsx` mounts a D3 force simulation onto an SVG ref. The simulation uses `forceSimulation`, `forceLink`, `forceCharge`, `forceCenter`, `forceCollide` — the same five force types as the upstream reference. Drag is wired via `d3-drag`. Hover state uses local React state; D3 selects for the highlighting, React owns the layout.

**Interactions:**
- Hover a node → highlight connected nodes and edges, dim the rest.
- Click a node → navigate to the agent's detail page (or chat page for subaccount link nodes).
- Drag a node → repositions and pins it; double-click to unpin.
- Pan/zoom via `d3-zoom`.

**No minimap, no path-finding, no department layout in v1.** The upstream reference has all three; they're not needed for an org with <100 agents and would inflate scope.

**Backend route.** `GET /api/org/agent-graph` returns the four arrays the pure builder needs, all in one round-trip. Service: `agentGraphService.ts` (impure wrapper). The route is org-scoped via `req.orgId` and the service uses `getOrgScopedDb` for all reads. Permission: `requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW)`.

**Page.** `/admin/agent-network` — a new admin page mounting `<AgentNetworkGraph />` full-screen, with a small legend in the bottom-right corner explaining node kinds and edge colours.

### Files to change

| File | Kind | Change |
|------|------|--------|
| `server/services/agentGraphService.ts` | new | Impure wrapper: queries the four input arrays from Drizzle, returns them in one response. |
| `server/routes/agentGraph.ts` | new | `GET /api/org/agent-graph`. |
| `server/index.ts` | edit | Mount the new route. |
| `client/src/lib/agentGraph.ts` | new | Pure `buildAgentGraph` helper + types. |
| `client/src/components/AgentNetworkGraph.tsx` | new | D3 force-directed renderer. |
| `client/src/pages/AdminAgentNetworkPage.tsx` | new | Admin page wrapping the graph. |
| `client/src/main.tsx` or router config | edit | Lazy-mount the new admin page. |

### Test plan

Manual verification only.

**Manual verification checklist:**

1. Open the page on an org with 5+ agents — see the graph render with nodes positioned by force simulation.
2. Hover a node — connected nodes/edges highlight, others dim.
3. Click a node — navigates to the agent's detail page.
4. Drag a node — repositions and pins; double-click — unpins.
5. Pan/zoom — works smoothly with mouse wheel + drag-on-background.
6. Open the page on an org with 1 agent — single node renders, no errors.
7. Open the page on an empty org — empty state message, no D3 errors.

**Why no unit tests?** The pure helper `buildAgentGraph` is small and side-effect-free, but it lives on the client where the project runs no unit tests. The D3 renderer is interactive and not unit-testable in any practical sense. If `buildAgentGraph` grows or moves to the server, lift it to `server/lib/agentGraphPure.ts` and add fixture tests then.

### Risk

| Risk | Mitigation |
|------|------------|
| D3 force sim is slow on large graphs | Cap nodes at 200; if `nodes.length > 200`, render an empty-state message ("Graph view supports up to 200 agents per org") and link to the standard agent list. The cap is aspirational for v1 — most orgs will have <30 agents. |
| Cuttable item with no other dependents | Explicitly stated. P5 is the lowest priority and may be deferred if the implementation pass runs long. P1–P4 are independent of P5. |
| New page route adds to bundle size | The route is lazy-loaded per the project's lazy-loading convention. The D3 import is shared with the existing `ActivityCharts.tsx` so no new chunk is created. |

### Verdict

**DEFER.** Sequenced last in the adoption list and explicitly marked cuttable in the implementation philosophy. The implementation pass that lands P1–P4 will explicitly evaluate whether to also land P5 or to defer it to a follow-up — the call is made at the end of P4 based on remaining time and any drift from the spec. This is the only spec item with a `DEFER` verdict and the rationale is "lowest value-to-cost ratio in the adoption list, not on critical path for the handoff/health/log items".

If P5 is built later, the implementation lands as a standalone PR — none of P1–P4 reference it.

---

## P6 — CLAUDE.md Operational Restructure (doc-only)

### Goal

Add a small operational appendix to the project's `CLAUDE.md` mirroring the upstream reference implementation's "constitution" structure. No code change. Specifies exactly which sections are added so the work is reviewable as a doc patch.

### Current state

`CLAUDE.md` (331 lines) is well-structured around principles (plan mode, subagents, verification, elegance, autonomous bug fixing) and a task management workflow. It does not currently include:

- A current-sprint focus pointer
- A "key files per domain" quick-reference table
- Explicit multi-agent parallelism rules

### Design

Append two new sections to `CLAUDE.md`, after the existing "Local Dev Agent Fleet" section and before "Capturing Ideas During Development":

**Section 1 — Current focus.** A two-line block pointing at the current in-flight spec or sprint. Format:

```markdown
## Current focus

**In-flight spec:** `docs/run-continuity-and-workspace-health-spec.md`
**Active items:** P1, P2, P3, P4 (P5 deferred)
```

This is a hand-maintained pointer. The agent should read it at session start to know what the human is currently working on. **Maintenance gotcha:** Update this pointer whenever the current spec or sprint changes. A stale pointer is worse than no pointer because it actively misleads future agent sessions about what to focus on. If the project has no in-flight spec, set both fields to `none` rather than leaving them stale.

**Section 2 — Key files per domain (quick reference).** A table mapping every common task type to the canonical file or files to start from. Format:

```markdown
## Key files per domain

| Task | Start here |
|------|------------|
| Add a new agent skill | `server/skills/`, `server/config/actionRegistry.ts` |
| Add a new tool action | `server/config/actionRegistry.ts`, `server/services/skillExecutor.ts` |
| Add a new database table | `server/db/schema/`, `migrations/` (next free sequence number) |
| Add a new pg-boss job | `server/jobs/`, `server/jobs/index.ts` (registration) |
| Add a new agent middleware | `server/services/middleware/`, `server/services/middleware/index.ts` |
| Add a new client page | `client/src/pages/`, router config in `client/src/main.tsx` |
| Add a new permission key | `server/lib/permissions.ts` |
| Add a new static gate | `scripts/verify-*.sh`, `scripts/run-all-gates.sh` |
| Add a new run-time test | `server/services/__tests__/` (pure file pattern: `*Pure.test.ts`) |
| Modify the agent execution loop | `server/services/agentExecutionService.ts`, `agentExecutionServicePure.ts` |
```

The table is intentionally short — it points at the door, not at every room behind the door. `architecture.md` is the deep reference; `CLAUDE.md`'s table is the index.

**Multi-agent parallelism rules.** Already covered in the existing "Local Dev Agent Fleet" section — no addition needed. The upstream reference's pattern (multiple agents working in worktrees) is not how this project operates; we use single-session sequential execution with subagents for parallelism inside one session. The existing CLAUDE.md is correct; no edit needed for this point.

### Files to change

| File | Kind | Change |
|------|------|--------|
| `CLAUDE.md` | edit | Append two new sections after "Local Dev Agent Fleet" and before "Capturing Ideas During Development". No other edits. |

### Test plan

None. Doc-only change. Verified by reading the diff.

### Risk

None.

### Verdict

**BUILD.** Doc-only, low cost, high readability dividend for future agent sessions.

---

## Cross-cutting contracts and invariants

These rules apply across the items above. They are stated once here so each item can reference them rather than restating.

### Handoff payload is the only shape that matters

The shape of `agent_runs.handoff_json` is defined exactly once, in `server/services/agentRunHandoffServicePure.ts`, as the `AgentRunHandoffV1` interface. Every consumer (P1 generator, P3 session log card, P3 "Next: …" line, future readers) imports this type and only this type. The type is the source of truth; there is no parallel JSON-schema definition. If the shape needs to change, bump the version field to `V2` and add a discriminated union.

### Pure helpers do not import from `db/`

Reaffirmed for this spec: every `*Pure.ts` file added below is held to the existing `verify-pure-helper-convention.sh` static gate. New pure files added by this spec:

- `server/services/agentRunHandoffServicePure.ts` (P1)
- `server/services/workspaceHealth/workspaceHealthServicePure.ts` (P4)
- Each detector under `server/services/workspaceHealth/detectors/*.ts` (P4)
- `client/src/lib/runPlanView.ts` (P2 — client-side, not subject to the gate but conceptually pure)
- `client/src/lib/agentGraph.ts` (P5 — client-side, not subject to the gate but conceptually pure)

The two client-side pure files are held to the same discipline by convention even though the static gate scope is server-only.

### Routes follow the existing conventions

Every new route added by this spec uses `asyncHandler`, `authenticate`, `resolveSubaccount` where applicable, org scoping via `req.orgId`, no direct `db` access, and `{ statusCode, message, errorCode? }` service errors. All four are already enforced by static gates (`verify-async-handler.sh`, `verify-subaccount-resolution.sh`, `verify-no-db-in-routes.sh`, `verify-org-scoped-writes.sh`).

### Migrations ship without feature flags

Per the spec-context framing — `0095_agent_runs_handoff_json.sql` and `0096_workspace_health_findings.sql` ship as plain forward migrations with no flags, no shadow mode, no opt-in. The corresponding code that uses them ships in the same commit (or the next commit on the same branch).

### No new test category

Per the spec-context framing — no frontend tests, no E2E tests, no API contract tests, no composition tests. The only runtime tests added by this spec are pure-function unit tests under `server/services/__tests__/` (P1 and P4) following the existing `*Pure.test.ts` convention.

---

## Static gates added by this spec

One new static gate.

| Gate | What it checks | Tier |
|------|---------------|------|
| `verify-handoff-shape-versioned.sh` | The TypeScript type backing `agent_runs.handoff_json` ends in a version suffix (`V1`, `V2`, …). Catches the case where a future change renames the interface without bumping the version field. | Tier 1 (hard fail) |

The gate is implemented as a `grep` against `server/db/schema/agentRuns.ts` for the `handoff_json` column declaration and asserts the `$type<...>` argument matches `/AgentRunHandoffV\d+/`. Three lines of bash. Added to `scripts/run-all-gates.sh`.

No other new static gates. The existing 33 gates already cover routes, pure helpers, RLS, idempotency, and action registry concerns — none of the items in this spec introduce a new class of drift that needs its own gate.

---

## Deferred items with rationale

Items considered during scoping and explicitly excluded from this spec.

### D1 — LLM-authored handoff document (deferred from P1)

**What it is:** Have the LLM produce the `handoff_json` payload directly via an extra LLM call at run completion, instead of the deterministic extractor in P1.

**Why deferred:** Adds latency and cost to every terminal run. Structured JSON from LLMs is fragile. The deterministic extractor in P1 is good enough for v1; if real users say "the handoffs miss things", revisit.

### D2 — Brain-style markdown export of handoffs (deferred)

**What it is:** Generate a human-readable markdown file per session log entry, exportable as a "Handoff" document in the same style as the upstream reference implementation.

**Why deferred:** No user has asked for it. The structured JSON in `handoff_json` is queryable in the UI directly. Markdown export is a one-day follow-up if a real need surfaces.

### D3 — Slash command distribution (`/wrap-up`, `/resume`)

**What it is:** The upstream reference ships `.md` slash command files into `~/.claude/commands/` so users can type `/wrap-up` in Claude Code. Adopt the same for our skill system.

**Why deferred:** Surface-area collision with our existing skill system. Slash commands as a distribution mechanism is a separate product decision (do we want to be a Claude Code add-on?) and is not the right call to make as part of an adoption pass. Track the idea via `triage-agent` if it surfaces again.

### D4 — Real-time WebSocket updates on the workspace health dashboard

**What it is:** Push new findings to the dashboard widget as the audit job runs, instead of requiring a manual refresh.

**Why deferred:** v1's audit is a passive dashboard, not a continuous monitoring system. Real-time updates are a UX polish item and would require wiring a new WebSocket room — out of scope for v1.

### D5 — Per-detector configuration (severity overrides, suppression)

**What it is:** Let org admins override the default severity of a detector or suppress specific findings (e.g. "this agent has no recent runs because it's an on-demand archive bot — don't warn about it").

**Why deferred:** Adds complexity (a new `health_audit_overrides` table, a new UI for managing overrides, a precedence model) for a use case that is hypothetical until users actually report false positives. Wait for real complaints.

### D6 — Graph view minimap, path-finding, department layout

**What it is:** The upstream reference's graph view includes a canvas minimap, BFS path-finding between two nodes, and a department-grouped radial layout. We adopt only the force simulation in P5.

**Why deferred:** Each of these is a significant addition to a feature that is already marked DEFER. Out of scope.

### D7 — `agent_run_handoffs` as a separate table

**What it is:** Store handoffs in a dedicated table instead of as a JSONB column on `agent_runs`.

**Why deferred:** Discussed in P1 design. The 1:1 relationship and small payload size make a column the right call. Revisit only if a query pattern surfaces that needs a relational shape (e.g. "find all runs whose handoff mentions X").

---

## End of spec

This spec is implementation-ready against the project conventions in `architecture.md` and the framing in `docs/spec-context.md` as of the date this document was written. The spec-reviewer agent (Codex-backed) was unavailable in the working environment, so the spec has been self-reviewed against the spec-reviewer rubric — the rubric findings and adjudications are recorded in `tasks/run-continuity-self-review-<timestamp>.md` for the human to audit.

