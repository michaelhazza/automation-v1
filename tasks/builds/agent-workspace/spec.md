# Spec — Agent Workspace (Persistent Embodiment Layer)

**Status:** draft (Round 1 ChatGPT-web hardening applied)
**Spec date:** 2026-05-08
**Last updated:** 2026-05-08 (Round 2 ChatGPT-web regression-surface audit: hysteresis monotonic-clock contradiction fix, observation read-query tiebreaker, cycle DFS scope + FOR UPDATE, UTC bucket anchoring lead, Buffer.byteLength pin, at-least-once rebuild classifier with per-agent partition basis, files-snapshot triggers extended to 7 visibility-affecting categories. Round 1: race tiebreaker, supersession cycle guard, single-node SSE topology lock, working-time bucket-split invariant, monotonic clock for degraded timers, observation 8KB body cap, projection rebuild contract, files-snapshot invalidation triggers.)
**Author:** spec-coordinator (Claude Opus 4.7, 1M context)
**Build slug:** agent-workspace
**Source brief:** `docs/agent-workspace-implementation-brief.md` (Rev 10, LOCKED)
**Source branch:** `claude/add-agent-cloud-compute-Kb4ii`
**Mockups (canonical visual reference):** `prototypes/agent-workspace/`
- `index.html` — index of all five mockups
- `home-active-agents.html` — Mockup 1 (Home page Active Agents widget)
- `agent-overview-active.html` — Mockup 2 (Overview tab, active state)
- `agent-overview-idle.html` — Mockup 3 (Overview tab, idle state)
- `agent-overview-first-run.html` — Mockup 4 (Overview tab, first-run / identity-instantiation)
- `run-trace-lineage.html` — Mockup 5 (Run trace inline file lineage)
- **Spec must design TO the mockups.** Where the brief and a mockup disagree, the brief's hard invariants win and the mockup is updated; where the brief is silent, the mockup is canonical.

---

## Table of contents

1. Goals, non-goals, framing assumptions
2. Implementation philosophy and framing alignment
3. Coverage of brief invariants (mapping table)
4. Phase plan
5. File inventory lock
6. Data model and migrations
7. Contracts (data shapes crossing boundaries)
8. Permissions / RLS checklist
9. Execution model (sync / async / streamed / cached)
10. Phase sequencing (dependency graph)
11. Execution-safety contracts
12. State machine (`AgentPresenceState`)
13. Live transport contract (SSE)
14. Capabilities / positioning rewrite (non-code deliverables)
15. Coordination contracts (Phase 1 + Trust)
16. Testing posture
17. Open questions for Phase 2
18. Deferred items
19. Self-consistency pass result

---

## 1. Goals, non-goals, framing assumptions

### 1.1 Goals (verifiable)

- **G1.** Land an `Overview` tab as the new default on `AgentEditPage`. The tab loads in <500ms p95 with an initial payload ≤150KB compressed (brief §5.8).
- **G2.** Build a single, server-derived `AgentPresenceState` projection (closed enum, 7 values: `idle | running | waiting_on_human | waiting_on_dependency | scheduled | degraded | failed`). Every presence-aware UI surface reads this projection; UI never re-derives from raw signals (brief §5.3).
- **G3.** Replace the Home page Active Agents number tile with a sectioned live-status widget per the consolidation prototype (brief §6). Sections in a fixed deterministic order: Waiting on you / Working now / Failing / Scheduled next; each capped at 5 visible rows with `+N more` overflow.
- **G4.** Build session-scoped runtime persistence in IEE — one session per run, container survives across steps within a run, idle-timeout teardown, summary written back to the run record at session end. One run = one session, never shared, never reused (brief §7).
- **G5.** Add inline file-lineage chips on Run trace event rows. Each chip is keyed on the immutable tuple `(run_id, event_id, produced_file_id, produced_version_id)` and deep-links to Phase 1's Knowledge → Files surface at the exact produced version (brief §8).
- **G6.** Type observations into a closed enum (`learned | detected | decided | flagged | produced`), each row tied to a concrete event id (provenance invariant); rows are append-only with an explicit `supersedes_observation_id` correction path (brief §5).
- **G7.** Ship the capabilities and positioning rewrite (brief §3) in the same PR cycle as the Overview tab. Acceptance: a non-technical reviewer reads `docs/capabilities.md` and answers *"what does Synthetos give my agent?"* in workspace-language without reaching for infrastructure language.
- **G8.** The Overview tab's Working Time chart caption surfaces *"You're billed for this time only, not while the agent is idle"* and the chart total reconciles exactly with the **per-agent invoice line** for the same timeframe (brief §5.4 reconciliation invariant). Each agent's chart shows that agent's own Working Time only; sub-agents are charted on their own pages. The parent-level invoice rollup (parent + delegated sub-agents) is a separate invoice surface, not a chart on the parent's Overview page.

### 1.2 Non-goals (in this build)

- Workspace artifact store (Phase 1 owns Knowledge → Files; cloud-compute consumes by deep-link).
- Per-agent Data Sources tab refresh (Phase 1 owns).
- Per-agent memory editing surface (read-only on Overview; editing on Knowledge page).
- Dedicated Agent Runtime tier (deferred, Rev 5 §10.5).
- Cross-task container reuse (sessions are one-task-only).
- Live workspace mutation (drag-and-drop add to memory) — Phase 3 polish.
- Multi-agent shared workspaces — future work.
- Active Session drill-in modal as a separate surface — Run trace already covers it.
- Confidence surface (breadcrumbs only — open observation enum + Trust judgement events anchor a future surface; no schema additions in v1).
- Presence privacy redaction (breadcrumbs only — channel topology and event schema leave the door open; no policy implementation in v1).

### 1.3 Framing assumptions (must hold for the spec to be coherent)

These are assumptions taken from `docs/spec-context.md` and the brief; if any flips, the spec needs revision before build.

- **Pre-production posture.** No live agencies, no live users, no production incidents expected. Rollout model is `commit_and_revert`; staged rollout is forbidden by `docs/spec-context.md`.
- **Testing posture.** `static_gates_primary` + `runtime_tests: pure_function_only`. No new vitest suites for client UI, no API-contract tests, no E2E. Pure-function unit tests for presence resolution, observation classification, working-time accounting, and freshness-window math.
- **Phase 1 will land first or in parallel.** This spec consumes Phase 1 surfaces (Knowledge → Files filterable by agent, `retrieval.summary` events on `agent_execution_events`, `reference_document_data_sources` table). If Phase 1 slips, the Overview tab can ship a degraded variant (no per-document relevance signals; Files snapshot reads raw `iee_artifacts`) — but the build plan in §4 assumes Phase 1 lands first.
- **Trust verification layer is concurrent.** Run trace event-row visual budget (cloud-compute file chips + Trust Stage 1 Pass/Fail badges + Trust Stage 3 Correct hover) is composable; both teams add via composition, neither replaces. Tab-strip ordering is locked at 10 tabs (§5).
- **`agent_execution_events` is the canonical clock authority.** Server-side monotonic timestamps from this table are the only source for ordering, replay, freshness, and Working Time accounting. No client-clock derivation, no locally-incremented sequence numbers (brief §5.3 *Clock authority*).

---

## 2. Implementation philosophy and framing alignment

This section is the explicit framing override required by `docs/spec-context.md` — *"explicit spec-level framing is a permitted override AS LONG AS the override is flagged in a HITL checkpoint first."* No overrides are needed: the brief and spec align with framing on every axis below.

| Axis | Framing default | Spec stance |
|---|---|---|
| `pre_production: yes` | No live-traffic safeguards | Confirmed; commit-and-revert; no feature flags for new migrations. |
| `testing_posture: static_gates_primary` | No frontend / API-contract / E2E tests | Confirmed; pure-function unit tests for presence resolution + observation classification + working-time math + freshness-window math only. |
| `feature_flags: only_for_behaviour_modes` | No rollout flags | Tab-default migration uses **per-user preference** (default landing tab), not a feature flag. See §4 Phase 2 + §17. |
| `prefer_existing_primitives_over_new_ones` | Reuse > extend > invent | Reuse `agent_execution_events` (canonical clock); extend `iee_artifacts` with lineage columns rather than creating a parallel table; reuse `agentExecutionEventService` event emission; reuse the existing operate Run-trace renderer (`RunTraceEventRenderer`) by composition. The Home Active Agents widget cannot reuse `MetricCard` (props do not accept a body slot for the sectioned list); a new `HomeActiveAgentsWidget` is the minimum-scope addition. New primitives are introduced only where the brief explicitly requires them (presence projection, typed observations table, presence stream channel). |
| `staged_rollout: never_for_this_codebase_yet` | No staged rollout | Confirmed. |
| `migration_safety_tests: defer_until_live_data_exists` | No backfill rehearsal | Confirmed. New tables are empty at migration time; backfill is N/A. |
| `composition_tests: defer_until_stabilisation` | No cross-feature composition tests | Confirmed; Trust + Phase 1 + cloud-compute coordinate via §15 contracts, not composition tests. |

---

## 3. Coverage of brief invariants (mapping table)

The brief's load-bearing invariants are mapped to spec sections so reviewers and builders can verify coverage in one pass. Brief sections cited are from `docs/agent-workspace-implementation-brief.md` (Rev 10).

| Brief invariant | Spec section | Mechanism |
|---|---|---|
| §5.1 Current focus invariants + anti-fake-progress rule | §7.2 (`CurrentFocus` contract), §13 | Focus resolution chain + anti-fake-progress validator at the focus-line summariser. |
| §5.2 Presence degradation states + recovery semantics + idempotent monotonic event application | §12 (state machine), §13.4 (replay) | `degraded` is one state in the closed enum; entry conditions populate a `degraded_reason` field; replay safety lives in §13.4 + §11.1. |
| §5.3 Source-of-truth hierarchy + canonical event clock authority | §7.1, §7.2, §7.3, §13.5 | Single server-side resolver `resolveAgentPresence(agentId)`; client never branches on raw signals; clock authority pinned in §13.5. |
| §5.4 Working Time accounting (formal definition + reconciliation invariant) | §7.5, §11.6 | Pure helper `accumulateWorkingTime(events)` with the closed inclusion table; reconciliation invariant tested via pure unit. |
| §5.5 Overview freshness matrix | §13.7 (matrix), §9 (execution model) | Matrix replicated in §13.7 with the delivery model named per row; freshness budget enforced via §13 streaming + cache TTLs. |
| §5.6 Anti-optimistic UI synthesis | §13.6, §16.5 | `useAgentPresence` hook contract pins server-confirmed snapshot; client-side state simulation forbidden in lint/review (no automated gate). |
| §5.7 Retention policy for presence projections | §6.7, §4 (jobs) | Policy table replicated; per-class jobs in `server/jobs/agentObservationsPruneJob.ts`, `ieeSessionsCompactJob.ts`, `workingTimeRollupCompactJob.ts`. |
| §5.8 Overview payload budget | §7.4 | `/api/agents/:id/overview` shape + lazy-load delegations. PR-review check on every new surface. |
| §6 Home widget deterministic ordering | §7.6 | Pure helper `orderHomePresenceSections(rows)` with a fixed comparator. |
| §7 Session multiplicity invariant | §6.2 | `iee_sessions` schema with `(run_id) UNIQUE` constraint + service contract. |
| §8 Run-trace immutable file-lineage tuple | §6.5, §7.7 | Each chip resolves on the four-tuple; deep-link contract locked with Phase 1 in §15. |
| §10 Operator cognitive load + accessibility + section-collapse rules | §13.8, §16.4 | Pre-PR review checklist; accessibility invariants are spec contracts. |

If the brief has a load-bearing invariant not mapped above, it is a spec-coverage gap and reviewers should reject this draft.

---

## 4. Phase plan

Six phases, sized so each fits a single `feature-coordinator → builder` cycle. Phases are sequenced so no later phase references a column / service / table introduced in a later phase. Dependency graph in §10.

### Phase 1 — Schema + presence resolver (server-only, no UI)

**Migration `0288_agent_workspace_presence_and_sessions.sql`** introduces:
- `agent_observations` (typed observations, append-only, with `supersedes_observation_id`).
- `iee_sessions` (one row per run; `UNIQUE (run_id)`).
- `agent_presence_projections` (read-optimised current snapshot per agent; refreshed on event-stream tail).
- `agent_working_time_rollups` (per-day per-agent rollup; projection from `agent_execution_events`).
- Column-additions to `iee_artifacts`: `producing_event_id`, `produced_version_id` (powers Phase 5 lineage tuple).

Service additions:
- `server/services/agentPresenceService.ts` + `server/services/agentPresenceServicePure.ts` — single resolver `resolveAgentPresence(agentId, ctx)` returning the seven-state projection per §12, the focus line per §7.2 chain.
- `server/services/agentObservationService.ts` + `*Pure.ts` — append-only writer with provenance enforcement (every row carries an `event_id` linking to `agent_execution_events`).
- `server/services/agentWorkingTimeService.ts` + `*Pure.ts` — `accumulateWorkingTime(events)` from the closed table in §7.5.
- Extension to `agentExecutionEventService` to emit a typed event-class for observation-emit (no new event-type registry — observations route through the existing discriminated union via a new variant).

RLS:
- All new tables added to `RLS_PROTECTED_TABLES` manifest in the same migration. FORCE RLS. Tenant isolation via `organisation_id` + `subaccount_id`. Layer B default-deny posture per `architecture.md` §1155.

No UI in Phase 1; the resolver is consumed by Phases 2-3.

### Phase 2 — Overview tab (default landing) + Working Time chart

- `client/src/pages/build/AgentEditPage.tsx` gains an `Overview` tab as the leftmost item; new default landing.
- Overview composition components (`client/src/components/agent-workspace/`): identity card, presence hero (status pill + current focus + elapsed timer), active goals, recent observations card (top-3 with `Show 2 more` lazy fetch), knowledge-in-use card (top-3 with provenance expand), files snapshot (top-3 with deep-link to Knowledge → Files), tools usage bands (qualitative), connections health, schedule peek, working time chart with timeframe pills.
- `useAgentPresence(agentId)` hook — single source of presence state for every consumer; never re-derives, no optimistic synthesis (§13.6 invariant).
- Three-state rendering (active / idle / first-run) per Mockups 2/3/4.
- Endpoints: `GET /api/agents/:id/overview` (initial payload ≤150KB), `GET /api/agents/:id/observations?limit=...&cursor=...` (lazy fetch beyond 3), `GET /api/agents/:id/working-time?range=today|week|month|quarter`, `GET /api/agents/:id/activity-feed?limit=...&cursor=...`.
- Migration `0289_agent_default_landing_tab.sql` adds `users.default_agent_tab`.

Existing users land on the new default `Overview`. Per-user preference column on `users` table allows a user to pin a different default. **No feature flag.**

### Phase 3 — Live presence stream + Home widget

- Server-pushed presence channel via **SSE** (one connection per Overview tab) carrying status pill, current focus, elapsed-time anchor (server-now), recent-observation appends, activity-feed appends. Same channel multiplexed for Home widget at workspace scope. See §13 for the contract.
- `client/src/components/home/HomeActiveAgentsWidget.tsx` replaces existing Active Agents `MetricCard` body with the sectioned live-status list per §7.6.
- `useWorkspacePresence(subaccountId)` — workspace-scope companion hook to `useAgentPresence`.
- Section ordering, overflow rule, and `degraded` handling per §7.6.
- Reduced-motion + ARIA-live wiring per §13.8.

### Phase 4 — Session-scoped runtime persistence (IEE)

- Lifecycle in `server/services/ieeExecutionService.ts`:
  - On run start: insert `iee_sessions` row keyed on `run_id` (UNIQUE).
  - Each step: dispatch into existing container if alive; spawn new container only if session row's container handle is null or expired.
  - Heartbeat extension: heartbeat updates `iee_sessions.last_heartbeat_at`; idle-timeout job tears down on stale.
  - Summary: at run terminal-event emission, write `iee_sessions.summary` JSON to the run record; upload durable artifacts to Phase 1 Execution Files store; release container.
- Failure handling: orphan-cleanup job (`server/jobs/ieeSessionOrphanCleanup.ts`) walks `iee_sessions` rows with NULL `released_at` whose run is in a terminal state and forces teardown.
- Working-time-accounting integration: heartbeat events emit `step_started` / `step_completed` per the rules in §7.5; the rollup projection consumes them.

### Phase 5 — Run trace lineage chips

- `client/src/pages/operate/RunTracePage.tsx` (existing) extended with `<EventFileLineageChips>` rendered inside each event row's content area.
- Each chip resolves on the four-tuple `(run_id, event_id, produced_file_id, produced_version_id)`. Deep-link query parameter shape locked with Phase 1 (§15).
- Layout caps: max 4 chips visible per event, `+N more` overflow inline-expandable; max event-row height 3 lines, `Show more` overflow; filename truncation 36 chars middle-ellipsis preserving extension.
- Promote-to-knowledge from a chip preserves the version tuple — promoted knowledge entry stores the same four-tuple as origin reference.

### Phase 6 — Capabilities and positioning rewrite

- `docs/capabilities.md`: new top-level *Persistent Agent Workspace* capability section; IEE intro reframe; new *Replaces / Consolidates* row for hosted-VM-per-agent platforms; Always-on capability reframe.
- Marketing-language audit: any mention of *container*, *runtime*, *VM*, *scheduler*, *job* in customer-facing surfaces (sales decks, product copy, blog drafts) replaced with workspace-language equivalents.
- Sales-conversation enablement one-pager: short internal note pivoting *"do you give the agent its own VM?"* to workspace + on-demand compute language.
- Acceptance: a non-technical reviewer can read `docs/capabilities.md` and answer *"what does Synthetos give my agent?"* in workspace-language without reaching for infrastructure language; locating the answer to *"how does this compare to Manus / OpenClaw?"* finds no sentence beginning *"we don't have…"*.

---

## 5. File inventory lock

Every file the spec touches. New = N, Modify = M, Delete = D.

### Phase 1 (server schema + resolver)

| File | Op | Notes |
|---|---|---|
| `migrations/0288_agent_workspace_presence_and_sessions.sql` | N | Creates `agent_observations`, `iee_sessions`; adds columns to `iee_artifacts`; creates `agent_working_time_rollups`, `agent_presence_projections`; adds RLS policies + manifest entries. |
| `migrations/0288_agent_workspace_presence_and_sessions.down.sql` | N | Drop in reverse order. |
| `server/db/schema/agentObservations.ts` | N | Drizzle schema. |
| `server/db/schema/ieeSessions.ts` | N | Drizzle schema. |
| `server/db/schema/agentWorkingTimeRollups.ts` | N | Drizzle schema. |
| `server/db/schema/agentPresenceProjections.ts` | N | Drizzle schema. |
| `server/db/schema/agentWorkingTimeEventLedger.ts` | N | Drizzle schema for the per-event idempotency ledger (§6.4). |
| `server/db/schema/ieeArtifacts.ts` | M | Add `agentRunId`, `producingEventId`, `producedVersionId` columns. |
| `server/db/schema/index.ts` | M | Export new schemas. |
| `server/lib/permissions.ts` | M | Add `ORG_PERMISSIONS.AGENTS_OBSERVATIONS_PIN` (Phase 1). `AGENTS_PRESENCE_STREAM_SUBSCRIBE` is added in Phase 3 — listed once here for clarity. |
| `server/config/rlsProtectedTables.ts` | M | Append five new entries (`agent_observations`, `iee_sessions`, `agent_presence_projections`, `agent_working_time_rollups`, `agent_working_time_event_ledger`). |
| `server/services/agentPresenceService.ts` | N | Tenant-aware orchestrator. |
| `server/services/agentPresenceServicePure.ts` | N | `resolveAgentPresence(events, sessionState, scheduleState, ctx)` — pure resolver. |
| `server/services/agentObservationService.ts` | N | Append-only writer + supersession. |
| `server/services/agentObservationServicePure.ts` | N | Provenance + classification helper. |
| `server/services/agentWorkingTimeService.ts` | N | Rollup writer + read API. |
| `server/services/agentWorkingTimeServicePure.ts` | N | `accumulateWorkingTime(events)` per §7.5. |
| `server/services/agentExecutionEventService.ts` | M | Add observation-event emit hooks (no new event-type registry; uses existing discriminated union). |
| `shared/types/agentExecutionLog.ts` | M | Extend discriminated union with `observation_emitted` event variant. |
| `shared/types/agentPresence.ts` | N | Closed enum `AgentPresenceState`, focus-line type, freshness-budget consts. |
| `shared/types/agentObservations.ts` | N | Observation type enum + provenance contract. |

### Phase 2 (Overview tab + working time chart)

| File | Op | Notes |
|---|---|---|
| `migrations/0289_agent_default_landing_tab.sql` | N | Adds `users.default_agent_tab text DEFAULT 'overview' NOT NULL`. |
| `migrations/0289_agent_default_landing_tab.down.sql` | N | |
| `server/db/schema/users.ts` | M | New column. |
| `server/routes/agents.ts` (or `server/routes/agentOverview.ts` if extracted) | M | New endpoints: `GET /api/agents/:id/overview`, `/observations`, `/working-time`, `/activity-feed`, `/files-snapshot`, `/tools-usage`, `/connections-health/:connectionId`, `/knowledge-in-use/:entryId/provenance`. |
| `server/services/agentOverviewAggregator.ts` | N | Composes the initial-payload contract from §7.4; honours payload budget. |
| `client/src/pages/build/AgentEditPage.tsx` | M | Insert `Overview` as leftmost tab; new default landing per `users.default_agent_tab`. |
| `client/src/components/agent-workspace/AgentOverviewTab.tsx` | N | Composition root. |
| `client/src/components/agent-workspace/PresenceHero.tsx` | N | Status pill + focus line + elapsed timer. |
| `client/src/components/agent-workspace/IdentityCard.tsx` | N | Name / role / reports-to / sub-account. |
| `client/src/components/agent-workspace/RecentObservationsCard.tsx` | N | Top-3 with `Show more` lazy fetch. |
| `client/src/components/agent-workspace/KnowledgeInUseCard.tsx` | N | Top-3 with provenance expand; reads from Phase 1 retrieval observability. |
| `client/src/components/agent-workspace/FilesSnapshotCard.tsx` | N | Top-3 with deep-link to Phase 1 Knowledge → Files. |
| `client/src/components/agent-workspace/ToolsUsageBandsCard.tsx` | N | Three qualitative bands. |
| `client/src/components/agent-workspace/ConnectionsHealthCard.tsx` | N | Read-only snapshot; edits live on Connections page. |
| `client/src/components/agent-workspace/SchedulePeekCard.tsx` | N | When next, what triggers. |
| `client/src/components/agent-workspace/WorkingTimeChart.tsx` | N | Timeframe pills + caption + per-bar hover. |
| `client/src/components/agent-workspace/ActiveGoalsCard.tsx` | N | Open task / schedule the agent is advancing toward. |
| `client/src/components/agent-workspace/ActivityFeedCard.tsx` | N | Capped at 5 rows; *View all* deep-link. |
| `client/src/components/agent-workspace/FirstRunOverview.tsx` | N | Lean first-run page (welcome banner + 3 quick-action cards + identity + tools + connections; no checklist, no empty placeholders). |
| `client/src/hooks/useAgentPresence.ts` | N | Hook contract per §13.6 (server-confirmed snapshot only). |
| `client/src/hooks/useAgentOverview.ts` | N | Initial payload fetch + lazy-fetch delegations. |
| `client/src/hooks/useAgentWorkingTime.ts` | N | Per-timeframe data with bucket-containing-now live update. |

### Phase 3 (live presence stream + Home widget)

| File | Op | Notes |
|---|---|---|
| `server/routes/agentPresenceStream.ts` | N | SSE handler per §13. Single connection per Overview tab; multiplexed channel. |
| `server/services/agentPresenceStreamPublisher.ts` | N | Pushes presence/observation/activity events to subscribed clients. |
| `client/src/lib/agentPresenceStream.ts` | N | SSE client; reconnect with `Last-Event-ID`; replay-safe. |
| `client/src/hooks/useWorkspacePresence.ts` | N | Workspace-scope hook for Home widget. |
| `client/src/pages/operate/HomePage.tsx` | M | Replace the Active Agents `MetricCard` invocation with the new `HomeActiveAgentsWidget`. The existing `MetricCard` (`label/value/sub/icon` props, no children slot) does NOT compose for the sectioned shape and is NOT modified by this build. |
| `client/src/components/home/HomeActiveAgentsWidget.tsx` | N | Sectioned live widget; standalone composition (uses the same outer card chrome as `MetricCard` for visual continuity but renders its own body). |
| `client/src/lib/orderHomePresenceSections.ts` | N | Pure comparator per §7.6. |
| `client/src/lib/accessibility/announceLiveUpdate.ts` | N | ARIA-live throttle helper (§13.8 accessibility). |

### Phase 4 (session-scoped runtime)

| File | Op | Notes |
|---|---|---|
| `server/services/ieeExecutionService.ts` | M | Session lifecycle hooks at run-start / step-dispatch / heartbeat / run-end. |
| `server/services/ieeSessionService.ts` | N | Session create / heartbeat / teardown / orphan detection. |
| `server/services/ieeSessionServicePure.ts` | N | Idle-timeout decision; teardown reason classification. |
| `server/jobs/ieeSessionOrphanCleanup.ts` | N | pg-boss job; default 5-minute schedule. Forces teardown of orphans. |
| `server/jobs/ieeSessionsCompactJob.ts` | N | pg-boss job; daily; compacts session-summary blobs older than 90d. |
| `server/jobs/agentObservationsPruneJob.ts` | N | pg-boss job; daily; prunes non-pinned observations older than 90d. |
| `server/jobs/workingTimeRollupCompactJob.ts` | N | pg-boss job; monthly; collapses per-day buckets older than 1 year to monthly resolution. |
| `server/jobs/index.ts` | M | Register the new jobs + boot-time self-heal. |

### Phase 5 (run trace lineage chips)

| File | Op | Notes |
|---|---|---|
| `client/src/pages/operate/RunTracePage.tsx` | M | Wire `<EventFileLineageChips>` props through to the renderer. |
| `client/src/pages/operate/components/RunTraceEventRenderer.tsx` | M | Compose `<EventFileLineageChips>` into each event row's content area; visual budget per §15.2. |
| `client/src/pages/operate/components/EventFileLineageChips.tsx` | N | Chip cluster per event; max 4 visible + `+N more` expand. |
| `client/src/pages/operate/components/FileLineageChip.tsx` | N | Individual chip; deep-link with version tuple. |
| `shared/types/runTraceLineage.ts` | N | Four-tuple shape + deep-link query-param contract (locked with Phase 1 in §15). |

### Phase 6 (capabilities + positioning rewrite)

| File | Op | Notes |
|---|---|---|
| `docs/capabilities.md` | M | New *Persistent Agent Workspace* section; IEE intro reframe; new *Replaces / Consolidates* row; Always-on reframe. |
| `docs/sales-conversation-vm-question.md` | N | Internal one-pager for the *"do you give the agent its own VM?"* pivot. |

**Out-of-repo deliverables (acceptance notes; not part of §5 file inventory):**
- Marketing-language audit on sales decks, product copy, blog drafts. Tracked in §14.2; operator-driven sweep happens outside the build PR. Acceptance is verified at finalisation by the operator confirming a sample of customer-facing surfaces.

### Doc-sync (every phase touches at least one of these)

| File | Op | Notes |
|---|---|---|
| `architecture.md` | M | Add Agent Workspace section under *Layer 4 — UI*; add *Key files per domain* row; add presence stream + retention policy bullets. Phase 1, 3, 4 land into this. |
| `KNOWLEDGE.md` | M (append) | Patterns observed during build (per existing rule: append-only, never edit). |
| `docs/doc-sync.md` | check | Ensure spec follows the canonical doc-sync checklist. |

---

## 6. Data model and migrations

### 6.1 `agent_observations` (Phase 1, migration 0288)

Append-only typed observations powering the Overview *Recent observations* card.

```sql
CREATE TABLE agent_observations (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),  -- nullable when scope = org-level agent
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  run_id                      UUID         REFERENCES agent_runs(id),    -- the run that produced the observation
  event_id                    UUID         NOT NULL REFERENCES agent_execution_events(id),
  observation_type            TEXT         NOT NULL,  -- closed enum: see CHECK below
  body                        TEXT         NOT NULL,
  body_truncated              BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Hard storage ceiling: 8KB (8192 bytes) of UTF-8. The DB CHECK below
  -- enforces. Larger payloads must be summarised before insert; raw tool
  -- dumps and full LLM responses are forbidden as observation bodies.
  -- Payloads truncated to fit set body_truncated = TRUE; the writer captures
  -- the full original in metadata.original_byte_length so the audit path can
  -- detect when truncation happened.
  metadata                    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  supersedes_observation_id   UUID         REFERENCES agent_observations(id),  -- correction path; the latest non-superseded row is what the Overview shows
  is_pinned                   BOOLEAN      NOT NULL DEFAULT FALSE,  -- operator-driven pin (v1.1 surface; column exists in v1)
  pinned_by                   UUID         REFERENCES users(id),
  pinned_at                   TIMESTAMP WITH TIME ZONE,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Application-level idempotency key: writer supplies a stable hash derived
  -- from (event_id, source_id, observation_type, normalised body). The same
  -- step legitimately produces multiple observations of the same type
  -- (e.g. multiple `learned` facts from a single tool result), so we cannot
  -- dedupe on (event_id, observation_type) alone. The writer is responsible
  -- for computing the key; the DB enforces uniqueness.
  idempotency_key             TEXT         NOT NULL,
  CONSTRAINT agent_observations_type_enum
    CHECK (observation_type IN ('learned','detected','decided','flagged','produced')),
  CONSTRAINT agent_observations_body_size_cap
    CHECK (octet_length(body) <= 8192),
  CONSTRAINT agent_observations_dedupe UNIQUE (idempotency_key)
);

CREATE INDEX agent_observations_agent_created_idx
  ON agent_observations (agent_id, created_at DESC);
CREATE INDEX agent_observations_run_idx
  ON agent_observations (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX agent_observations_event_idx
  ON agent_observations (event_id);
CREATE INDEX agent_observations_pinned_idx
  ON agent_observations (agent_id, created_at DESC) WHERE is_pinned = TRUE;
CREATE INDEX agent_observations_supersedes_idx
  ON agent_observations (supersedes_observation_id) WHERE supersedes_observation_id IS NOT NULL;

ALTER TABLE agent_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_observations_org_isolation ON agent_observations
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

**Append-only enforcement.** Two layers:

1. **DB-level immutability.** A `BEFORE UPDATE OR DELETE` trigger on `agent_observations` raises an exception unless the session has set `app.allow_observation_mutation` to a recognised mode. The trigger function enforces per-column allow-lists per mode. This is the load-bearing layer — it survives any service-side oversight.

   ```sql
   CREATE OR REPLACE FUNCTION agent_observations_immutability_guard()
     RETURNS TRIGGER AS $$
   DECLARE
     mode TEXT := current_setting('app.allow_observation_mutation', true);
   BEGIN
     -- Default deny: no bypass set => mutation forbidden.
     IF mode IS NULL OR mode = '' THEN
       RAISE EXCEPTION 'agent_observations is append-only; create a superseding row instead'
         USING ERRCODE = 'P0001';
     END IF;

     -- DELETE only allowed in 'retention_prune' mode.
     IF TG_OP = 'DELETE' THEN
       IF mode <> 'retention_prune' THEN
         RAISE EXCEPTION 'agent_observations DELETE forbidden outside retention_prune mode'
           USING ERRCODE = 'P0001';
       END IF;
       RETURN OLD;
     END IF;

     -- UPDATE: only 'pin' mode is allowed in v1.1, and only pin-related columns.
     IF TG_OP = 'UPDATE' THEN
       IF mode = 'pin' THEN
         IF (OLD.body IS DISTINCT FROM NEW.body)
            OR (OLD.observation_type IS DISTINCT FROM NEW.observation_type)
            OR (OLD.event_id IS DISTINCT FROM NEW.event_id)
            OR (OLD.run_id IS DISTINCT FROM NEW.run_id)
            OR (OLD.metadata IS DISTINCT FROM NEW.metadata)
            OR (OLD.supersedes_observation_id IS DISTINCT FROM NEW.supersedes_observation_id)
            OR (OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key)
            OR (OLD.created_at IS DISTINCT FROM NEW.created_at)
         THEN
           RAISE EXCEPTION 'agent_observations pin mode only allows is_pinned, pinned_by, pinned_at columns'
             USING ERRCODE = 'P0001';
         END IF;
         RETURN NEW;
       END IF;
       RAISE EXCEPTION 'agent_observations UPDATE forbidden in mode %', mode
         USING ERRCODE = 'P0001';
     END IF;
     RETURN NULL;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER agent_observations_immutability
     BEFORE UPDATE OR DELETE ON agent_observations
     FOR EACH ROW EXECUTE FUNCTION agent_observations_immutability_guard();
   ```

2. **Service-level discipline.** Every writer goes through `agentObservationService.append()`; there is no `update()` method exported. Corrections create a new row with `supersedes_observation_id` set.

The brief's hard rule (§5) — *"Observation rows are immutable. A later summarisation pass MUST NOT rewrite an earlier observation in place."* — is enforced at both layers.

**Allowed maintenance mutations (closed list).** Two bypass modes:

| Mode | Operation | Allowed columns | Caller |
|---|---|---|---|
| `retention_prune` | DELETE | n/a (row deleted) | `agentObservationsPruneJob` |
| `pin` | UPDATE | `is_pinned`, `pinned_by`, `pinned_at` only | v1.1 pin/unpin route (deferred per §18) |

The `body`, `observation_type`, `event_id`, `run_id`, `metadata`, `supersedes_observation_id`, `idempotency_key`, and `created_at` columns can NEVER be updated, even with bypass set; corrections always create a new superseding row. Each bypass-enabled session is logged via `securityAuditService` with the row id and the bypass mode for audit visibility.

**Pinned observations indefinite retention.** Pinned rows are excluded from the 90-day prune in §6.7.

### 6.2 `iee_sessions` (Phase 1, migration 0288)

One row per run, lifetime equals run lifetime. UNIQUE on `run_id` enforces one-session-per-run (brief §7).

```sql
CREATE TABLE iee_sessions (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  run_id                      UUID         NOT NULL UNIQUE REFERENCES agent_runs(id),
  parent_run_id               UUID         REFERENCES agent_runs(id),  -- when this session is for a sub-agent invocation
  container_handle            TEXT,                                     -- whatever the IEE container layer uses; null between steps if torn down
  status                      TEXT         NOT NULL,                    -- 'active' | 'idle' | 'torn_down' | 'failed'
  idle_timeout_seconds        INTEGER      NOT NULL DEFAULT 300,        -- default 5 minutes; brief §7 says "minutes, not hours"
  last_heartbeat_at           TIMESTAMP WITH TIME ZONE,
  started_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  released_at                 TIMESTAMP WITH TIME ZONE,
  release_reason              TEXT,                                     -- 'run_completed' | 'idle_timeout' | 'orphan_cleanup' | 'failed' | 'operator_cancelled'
  summary                     JSONB,                                    -- structured summary written at session end
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT iee_sessions_status_enum
    CHECK (status IN ('active','idle','torn_down','failed')),
  CONSTRAINT iee_sessions_release_reason_enum
    CHECK (release_reason IS NULL OR release_reason IN ('run_completed','idle_timeout','orphan_cleanup','failed','operator_cancelled'))
);

CREATE INDEX iee_sessions_agent_started_idx ON iee_sessions (agent_id, started_at DESC);
CREATE INDEX iee_sessions_status_active_idx ON iee_sessions (status) WHERE status IN ('active','idle');
CREATE INDEX iee_sessions_orphan_scan_idx
  ON iee_sessions (last_heartbeat_at) WHERE status IN ('active','idle');

ALTER TABLE iee_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iee_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY iee_sessions_org_isolation ON iee_sessions
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

**Status state machine** (§12 closure):
- Initial: `active`.
- `active → idle` when no step in flight + no heartbeat for 30s but within idle_timeout.
- `idle → active` on next dispatched step.
- Any → `torn_down` once `released_at` is set with reason `run_completed`, `idle_timeout`, or `operator_cancelled`.
- Any → `failed` on container failure with reason `failed`.
- `torn_down → *` is forbidden. Sessions are never reused (brief §7).

### 6.3 `agent_presence_projections` (Phase 1, migration 0288)

Read-optimised current snapshot per agent. Refreshed on event-stream tail. Not a true materialised view — a regular table with upsert-on-event semantics so we can write per-row without a global REFRESH.

```sql
CREATE TABLE agent_presence_projections (
  agent_id                    UUID         PRIMARY KEY REFERENCES agents(id),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  presence_state              TEXT         NOT NULL,   -- closed enum (§12)
  presence_subtitle           TEXT,                    -- server-observed subtitle e.g. "Presence delayed…", "Status uncertain" — see §12.3. NEVER carries client-local strings like "Reconnecting…", which are rendered in the client's local UI only.
  active_run_id               UUID         REFERENCES agent_runs(id),
  current_focus_text          TEXT,                    -- truncated at 140 chars (§7.2)
  current_focus_event_id      UUID         REFERENCES agent_execution_events(id),
  last_event_id               UUID         REFERENCES agent_execution_events(id),
  -- (last_event_run_id, last_event_run_seq) is the per-run replay watermark.
  -- agent_execution_events.sequence_number is per-run, NOT global. Concurrent
  -- runs of the same agent each carry their own sequence; the projection
  -- writer compares the new event's (run_id, sequence_number) to the
  -- recorded pair: if run_id matches and seq is greater, accept; otherwise
  -- compare the cross-run tuple (last_event_timestamp ASC, last_event_id ASC).
  -- last_event_id is the deterministic tiebreaker for same-timestamp events
  -- emitted by different runs (timestamp truncation or shared transaction
  -- boundaries can produce equal timestamps). The tuple
  -- (event_timestamp, event_id) is the canonical ordering invariant — used
  -- by §12.4 replay sort, §13.4 SSE replay, and §11.1 acceptance predicate.
  last_event_run_id           UUID         REFERENCES agent_runs(id),
  last_event_run_seq          INTEGER      NOT NULL DEFAULT 0,
  last_event_timestamp        TIMESTAMP WITH TIME ZONE,
  next_run_at                 TIMESTAMP WITH TIME ZONE,
  scheduled_label             TEXT,
  degraded_reason             TEXT,                    -- when state = 'degraded'; closed list per §12.3
  -- The state the agent would have been in if telemetry weren't degraded.
  -- Used by the Home widget §7.6 deterministic ordering rule (degraded
  -- agents float into their base-state's section while keeping the
  -- 'Status uncertain' badge). Null when not degraded.
  degraded_base_state         TEXT,
  degraded_entered_at         TIMESTAMP WITH TIME ZONE,
  degraded_oscillation_count  INTEGER      NOT NULL DEFAULT 0,
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_presence_state_enum
    CHECK (presence_state IN ('idle','running','waiting_on_human','waiting_on_dependency','scheduled','degraded','failed')),
  CONSTRAINT agent_presence_degraded_reason_enum
    CHECK (degraded_reason IS NULL
           OR degraded_reason IN ('event_stream_delayed','worker_heartbeat_stale','focus_source_unavailable')),
  CONSTRAINT agent_presence_degraded_base_state_enum
    CHECK (degraded_base_state IS NULL
           OR degraded_base_state IN ('idle','running','waiting_on_human','waiting_on_dependency','scheduled')),
  CONSTRAINT agent_presence_degraded_reason_consistency
    CHECK ((presence_state = 'degraded') = (degraded_reason IS NOT NULL)),
  CONSTRAINT agent_presence_degraded_base_state_consistency
    CHECK ((presence_state = 'degraded') = (degraded_base_state IS NOT NULL))
);

CREATE INDEX agent_presence_projections_subaccount_idx
  ON agent_presence_projections (subaccount_id, presence_state, updated_at DESC);
CREATE INDEX agent_presence_projections_workspace_widget_idx
  ON agent_presence_projections (organisation_id, presence_state) WHERE presence_state IN ('waiting_on_human','running','failed','scheduled');

ALTER TABLE agent_presence_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_presence_projections FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_presence_projections_org_isolation ON agent_presence_projections
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

The projection is **derived state**. If pruned or corrupted, a backfill job reconstructs it from `agent_execution_events` + `iee_sessions` + scheduler state. Source of truth remains `agent_execution_events`.

**Projection rebuild contract.** A future rebuild implementation (`server/jobs/agentPresenceProjectionsRebuildJob.ts`, deferred per §18) MUST honour these operational invariants — without them, a rebuild on a multi-year event log accidentally loads the full history into memory:

- **Replay guarantee: at-least-once with idempotent projection writes.** Crash recovery resumes from the last checkpoint and replays any events past the checkpoint a second time. Idempotency lives in the projection writers, not the rebuilder: `agent_presence_projections` upserts use the §11.1 `(last_event_timestamp, last_event_id)` watermark (older replayed events ignored); `agent_working_time_rollups` upserts use the `agent_working_time_event_ledger` PK (replayed events produce 0-row ledger inserts and short-circuit the rollup contribution). End state is identical to a single clean run regardless of how many times an event is replayed.
- **Chunk size: 1000 events per replay batch.** The rebuilder reads `agent_execution_events` in `(event_timestamp ASC, event_id ASC)` order using keyset pagination (cursor on the same tuple); each chunk is fully applied to the in-memory replay state before the next chunk is fetched.
- **Ordering invariant.** The same `(event_timestamp ASC, event_id ASC)` tuple from §11.1 / §12.4 is the canonical sort. Any other order is a correctness bug.
- **Checkpoint cadence: every 10 chunks (10000 events).** After applying a chunk, the rebuilder writes the current replay watermark (last applied `(event_timestamp, event_id)` tuple plus the partial projection state) to a `agent_presence_projections_rebuild_state` checkpoint table. A crashed rebuild resumes from the last checkpoint, not from scratch.
- **Max in-memory batch size: bounded by the chunk size.** The rebuilder MUST NOT accumulate replay state across chunks beyond the per-agent projection record (one row per agent in flight). The full event log is never resident.
- **Partition basis: per-agent.** The rebuilder operates one agent at a time (or N agents in parallel where N is bounded by a configurable concurrency cap, default 4). The partition basis is `agent_id` — never per-organisation, per-run, or unbounded global. Output is deterministic because each agent's replay is single-threaded against the canonical event order; concurrency=4 only parallelises across agents whose replays are independent. This bounds memory regardless of how many agents the org has and keeps the deterministic-output guarantee intact.
- **Projection-quiesce window.** During rebuild, the live projection writer for the agent under rebuild is paused (advisory lock keyed on `agent_id`); incoming events queue until the rebuild releases the lock. The freshness budget is breached for the duration; the §13 SSE channel emits a `presence_state_changed` with `presence_subtitle = "Rebuilding presence…"` (closed §12.3 subtitle list extended with this entry — separate spec amendment if used in v1).

The rebuild job itself is deferred to v1.1 (§18); the **contract** is locked here so a builder cannot accidentally write a full-history-in-memory implementation later.

### 6.4 `agent_working_time_rollups` (Phase 1, migration 0288)

Per-day per-agent rollup; powers the Working Time chart at all timeframes.

```sql
CREATE TABLE agent_working_time_rollups (
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  subaccount_id               UUID         REFERENCES subaccounts(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  bucket_date                 DATE         NOT NULL,           -- per-day bucket; tighter resolution computed at query time from event log if needed
  working_time_seconds        BIGINT       NOT NULL DEFAULT 0, -- per §7.5 inclusion table
  successful_runs             INTEGER      NOT NULL DEFAULT 0,
  failed_runs                 INTEGER      NOT NULL DEFAULT 0,
  partial_runs                INTEGER      NOT NULL DEFAULT 0,
  total_run_count             INTEGER      NOT NULL DEFAULT 0,
  -- Watermarking is per-(rollup-row, run): a separate ledger table tracks
  -- which `agent_execution_events` rows have already been folded into this
  -- bucket. We do NOT use a single per-bucket scalar watermark because
  -- agent_execution_events.sequence_number is run-scoped, not global, and
  -- concurrent runs would collide. See agent_working_time_event_ledger below.
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, agent_id, bucket_date)
);

-- Ledger of which events have already been folded into rollups.
-- One row per applied event. Idempotency is by `event_id` (PK).
-- Contribution rule: only `step_completed`, `external_call_completed`,
-- `hitl_pause_resolved`, `retry_backoff_completed`, and `sub_agent_returned`
-- events are folded. Each completion event closes an interval that may span
-- multiple bucket_dates (UTC midnight crossings); the writer applies the
-- contribution to each affected bucket within a single transaction so the
-- ledger insert and all bucket updates commit atomically.
CREATE TABLE agent_working_time_event_ledger (
  event_id                    UUID         PRIMARY KEY REFERENCES agent_execution_events(id),
  organisation_id             UUID         NOT NULL REFERENCES organisations(id),
  agent_id                    UUID         NOT NULL REFERENCES agents(id),
  applied_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_working_time_event_ledger_agent_idx
  ON agent_working_time_event_ledger (agent_id, applied_at DESC);

ALTER TABLE agent_working_time_event_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_working_time_event_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_working_time_event_ledger_org_isolation
  ON agent_working_time_event_ledger
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

ALTER TABLE agent_working_time_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_working_time_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_working_time_rollups_org_isolation ON agent_working_time_rollups
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

**Reconciliation invariant.** The chart total for any timeframe equals `SUM(working_time_seconds)` across the bucket date range. The brief's hard rule (§5.4) — *"the chart total MUST exactly equal the billable time the operator sees on the invoice for that same timeframe"* — holds because both invoice and chart read from the same per-day rollup.

### 6.5 Run-trace produced-file lineage (Phase 1, migration 0288 — extension to `iee_artifacts`)

The brief requires every chip to resolve on `(run_id, event_id, produced_file_id, produced_version_id)`. The existing `iee_artifacts` table is keyed on `iee_run_id` (FK to `iee_runs.id`), not directly on `agent_runs.id`. The join path from agent run → artifact is `agent_runs.id → agent_runs.iee_run_id (= iee_runs.id) → iee_artifacts.iee_run_id`. We extend the table with:

```sql
ALTER TABLE iee_artifacts
  ADD COLUMN agent_run_id UUID REFERENCES agent_runs(id),               -- denormalised for lineage queries; populated at write time
  ADD COLUMN producing_event_id UUID REFERENCES agent_execution_events(id),
  ADD COLUMN produced_version_id UUID;                                   -- stable version handle; allocated at write time

CREATE INDEX iee_artifacts_agent_run_idx ON iee_artifacts (agent_run_id) WHERE agent_run_id IS NOT NULL;
CREATE INDEX iee_artifacts_event_idx     ON iee_artifacts (producing_event_id) WHERE producing_event_id IS NOT NULL;
CREATE INDEX iee_artifacts_version_idx   ON iee_artifacts (produced_version_id) WHERE produced_version_id IS NOT NULL;
```

The lineage four-tuple is therefore `(agent_run_id, producing_event_id, id, produced_version_id)`. The Phase 1 deep-link query parameter shape (§15.1) maps `runId → agent_run_id`, `eventId → producing_event_id`, `fileId → iee_artifacts.id`, `versionId → produced_version_id`.

`produced_version_id` is allocated at the moment the artifact is written; subsequent re-writes of the same logical filename produce a *new* row with a new `produced_version_id`. Every chip is keyed on the four-tuple; clicks resolve to the exact version produced at that event.

**Backfill:** `agent_run_id` is nullable for legacy rows. New writes set it; existing rows stay null. Phase 5 chips render only for events whose `iee_artifacts` rows have all four fields populated; legacy rows surface as un-chipped events with no degradation in the surrounding UI.

### 6.6 `users.default_agent_tab` (Phase 2, migration 0289)

```sql
ALTER TABLE users
  ADD COLUMN default_agent_tab TEXT NOT NULL DEFAULT 'overview'
    CHECK (default_agent_tab IN ('overview','configure','behaviour','personality','skills','scorecards','data-sources','schedule','budget','runs'));
```

Per-user preference; the AgentEditPage reads it on mount. No feature flag. New column only; no backfill required (`DEFAULT 'overview'` covers existing rows).

### 6.7 Retention policy (per brief §5.7)

| Class | Source | Retention | Pruning job |
|---|---|---|---|
| Run lifecycle events (canonical) | `agent_execution_events` | Indefinite | None — immutable. |
| Typed observations | `agent_observations` | 90 days default; `is_pinned = TRUE` indefinite | `agentObservationsPruneJob` daily. |
| Retrieval summaries | `retrieval.summary` events | Owned by Phase 1 — 30 days at full fidelity | Phase 1 owns. |
| Current focus snapshots | In-memory (Redis or equivalent) | Ephemeral, session-bound | TTL 60s on each cache write. Never persisted. |
| Activity feed projection | `agent_execution_events` filtered | 60 days visible; older paged via `View all` from canonical | No projection table; activity feed reads canonical with limit + cursor. |
| Session summaries | `iee_sessions.summary` | 90 days | `ieeSessionsCompactJob` daily — compacts blobs older than 90d, retains row. |
| Working Time aggregates | `agent_working_time_rollups` | 1 year per-day; older months collapse to monthly resolution | `workingTimeRollupCompactJob` monthly. |

Pruning a projection MUST NOT invalidate any user-visible surface; if Overview surfaces data older than the retention window, the surface fails closed (shows *"older than X days, view in Run trace"*) rather than rendering stale data.

---

## 7. Contracts

### 7.1 `AgentPresenceState` (closed enum)

**Type:** TypeScript discriminated union + Postgres `CHECK` constraint.

**Definition:**
```typescript
export const AGENT_PRESENCE_STATES = [
  'idle',
  'running',
  'waiting_on_human',
  'waiting_on_dependency',
  'scheduled',
  'degraded',
  'failed',
] as const;
export type AgentPresenceState = (typeof AGENT_PRESENCE_STATES)[number];
```

**Resolution order** (server-side, single resolver `resolveAgentPresence(agentId, ctx)`; first match wins; brief §5.3):

```
1. failed              — agent is in terminal error state (canonical terminal event present)
2. degraded            — any §12.3 degradation condition is currently true AND no terminal event present
3. waiting_on_human    — active run is paused at a HITL gate
4. running             — active run has at least one step in flight
5. waiting_on_dependency — active run is paused on external system / lock / retry / sub-agent
6. scheduled           — no active run, next run time is known
7. idle                — none of the above
```

`failed` ranks above `degraded` because telemetry staleness must never mask a canonical terminal failure. If the run has emitted a terminal failure event, the resolver returns `failed` regardless of the freshness of subsequent telemetry. `degraded` is only entered when the run is still in flight per the canonical event log AND telemetry has gone stale.

**Producer:** `agentPresenceService.resolveAgentPresence(agentId, ctx)` writes to `agent_presence_projections` on every `agent_execution_events` tail-event for that agent.
**Consumers:** every presence-aware UI surface (Overview hero pill, Home Active Agents widget, sidebar agent list, run trace header, activity badges, Inbox notifications) reads from this projection. UI MUST NOT re-derive state from raw signals (brief §5.3).

**Adding a new state requires a spec amendment** (closed enum). The Postgres `CHECK` constraint is the enforcement mechanism.

### 7.2 `CurrentFocus`

**Type:** TypeScript object.

**Definition:**
```typescript
export interface CurrentFocus {
  text: string;                       // 140 chars max; one sentence
  truncated: boolean;
  fullText: string;                   // surfaced in tooltip on hover
  sourceEventId: string | null;       // anchors to agent_execution_events.id when sourced from a step
  sourceKind:                         // closed enum
    | 'active_run_step'
    | 'pending_hitl_gate'
    | 'scheduled_next_run'
    | 'last_completed_run'
    | 'static_fallback';
  serverNow: string;                  // ISO timestamp; client uses for elapsed-time math
  ageMs: number;                      // `serverNow - sourceEventTimestamp` (server-computed)
}
```

**Resolution chain** (first match wins; brief §5.3):
1. `agent_runs.current_step_summary` of the active run (latest non-idle step).
2. `pending_hitl_gate` description, when status = `waiting_on_human`.
3. `scheduled_next_run` description, when status = `scheduled`.
4. `last_completed_run.summary`, when status = `idle`.
5. Static fallback per brief §5.1 stale-state copy ("No recent activity (last event 4m ago)" with the actual age).

**Anti-fake-progress validator** (brief §5.1 hard rule): the focus-line summariser rejects copy that lacks at least one of (a) a concrete step number, (b) a concrete entity / object id or name, or (c) a concrete blocking condition. Forbidden patterns: `*Thinking*`, `*Analysing data*`, `*Working on task*`, `*Reasoning about*`, `*Preparing*`, `*Processing*`, any `-ing` verb without an object. If the latest event has no concrete subject, the focus line falls back to the explicit stale-state copy rather than synthesising filler.

**Producer:** `agentPresenceService` (server-side, runs at projection-update time).
**Consumer:** Overview tab `PresenceHero` + Home widget rows.

Truncation: 140 characters before middle-ellipsis on desktop; tighter on narrower viewports per existing responsive pattern.

### 7.3 `AgentObservation`

**Type:** Drizzle row + JSONB metadata.

**Required fields:**
- `id`, `agent_id`, `event_id`, `observation_type` (closed enum), `body`, `created_at`.

**Provenance invariant:** every row has `event_id` set. `event_id` references `agent_execution_events.id` for run-derived observations (`learned`, `detected`, `decided`, `flagged`, `produced`). The row's `metadata.source_kind` field discriminates the origin (closed enum: `run_step | retrieval_summary | tool_result | memory_block_insert`); the `metadata.source_id` field carries the underlying entity id (e.g. `agent_execution_events.id`, retrieval-summary event id, structured tool result id, `memory_blocks.id`).

**Body size hard cap.** `body` is capped at **8192 bytes** (UTF-8 octets) by the §6.1 DB `CHECK` constraint plus a service-level pre-insert validator in `agentObservationService.append()`. Both layers measure in **UTF-8 byte length**, never JS string `.length` (which counts UTF-16 code units and undercounts non-ASCII bodies). The service validator computes `Buffer.byteLength(body, 'utf8')` and rejects when the result exceeds 8192; this is the same unit the DB's `octet_length(body)` enforces, so the two checks cannot disagree. **Reject is the primary path** — a writer that produces a body over the cap fails with `400 observation_body_too_large` and the row is never written. Truncation is a fallback for third-party emitters only (see below). Two layers because the service layer produces the better error path (`400 observation_body_too_large` with the actual byte count) and the DB layer is load-bearing if a writer ever bypasses the service.

Writer responsibilities:
- **No raw tool dumps as observation bodies.** A raw tool result, full LLM response, or browser DOM snapshot MUST be summarised before insert. The summary is the observation; the raw artefact lives in `iee_artifacts` with a deep-link the observation can reference via `metadata.source_id`.
- **Truncation is a fallback, not a primary path.** When the writer cannot summarise (rare; e.g. a third-party emitter), it truncates at 8192 bytes, sets `body_truncated = TRUE`, and writes the original byte count to `metadata.original_byte_length`. The Overview UI surfaces the *Truncated* affordance so operators can drill into the audit path for the full body via the run trace event detail panel.

This guarantees the §7.4 Overview payload-budget contract (≤150KB compressed for the initial payload, ≤16KB for the top-3 observation slice) holds against worst-case observation production. Without the cap, a single tool call dumping 100KB of JSON into a `learned` observation would blow the per-row budget and the per-payload budget simultaneously.

**Append-only invariant:** there is no `UPDATE` path. Corrections create a new row with `supersedes_observation_id` set to the row being corrected. The Overview surface reads the latest **non-superseded** row in each correction thread (i.e. rows that no other row points at via `supersedes_observation_id`). The run trace and audit views show the full history.

**Supersession cycle guard.** A DB `CHECK` cannot enforce this — the guard lives at the service layer in `agentObservationService.append()`. Before insert, the service runs a depth-first traversal starting at `supersedes_observation_id`, following each row's own `supersedes_observation_id` recursively up to a hard depth bound (default **32**, well above any realistic correction chain). The write is rejected with `409 supersession_cycle_detected` if the traversal encounters any of:
- the row being inserted (would create A→A self-loop),
- a row already on the traversal stack (would create a back-edge / cycle of any length),
- depth exceeding the bound (defensive; treated as a likely cycle).

**Scope of the DFS.** The traversal is **per-correction-chain, organisation-bounded**. It walks only the chain reachable from the new row's `supersedes_observation_id`; rows in other correction chains, other agents, or other organisations are never visited. RLS plus the `organisation_id` foreign key confine the chain to the caller's organisation by construction — there is no cross-org / cross-workspace / global-graph traversal. The DFS is bounded by depth (32), not by graph size; on healthy data the chain is at most a handful of nodes.

**Transactional isolation.** The traversal runs inside the same `withOrgTx` transaction as the insert. Each visited row is read with `SELECT … FOR UPDATE` (row-level lock); concurrent inserts pointing at the same parent chain serialise on those locks. A second writer's DFS waits for the first's transaction to commit/abort before reading, so it always sees the first writer's chain extension and rejects the cycle. Without `FOR UPDATE`, two concurrent inserts both pointing at the same parent could each pass the DFS independently and then both commit — producing a partial-cycle write the guard was supposed to prevent. A supersession chain that would otherwise become *A supersedes B, B supersedes A* (or longer cycles) is rejected before the second row is written. Without this guard, the *latest non-superseded leaf wins* read query in the canonical SQL below becomes non-deterministic. This guard is REQUIRED — the brief's *latest correction wins* rule depends on the supersession DAG being acyclic.

**Read query (canonical for Overview *Recent observations*):**
```sql
SELECT obs.*
FROM agent_observations obs
WHERE obs.agent_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM agent_observations newer
    WHERE newer.supersedes_observation_id = obs.id
  )
ORDER BY obs.created_at DESC, obs.id DESC
LIMIT $2;
```

The `(created_at DESC, id DESC)` sort guarantees deterministic ordering even when two observations share `created_at` to the millisecond — a realistic case when a single tool result is summarised into multiple typed observations and they all flush in the same transaction. Without the `id DESC` tiebreaker, two clients viewing the same agent could see the top-3 list in different orders. `id` is a UUID and not monotonic across rows, but it is unique per row, which is all the tiebreaker needs. Only `created_at` carries semantic ordering meaning.

This anti-join returns only rows that have NOT been superseded by a later correction. The original-but-now-superseded row is hidden; the latest correction (whose own `supersedes_observation_id` points at the original) is shown. If multiple corrections exist for the same root, they are independent leaves of the supersession graph and all surface on Overview (the correction graph is an audit detail, not a UI concern in v1).

**Example instance:**
```json
{
  "id": "f4ab...",
  "organisation_id": "00...",
  "agent_id": "ag1...",
  "run_id": "run...",
  "event_id": "evt...",
  "observation_type": "learned",
  "body": "Acme Corp has 12 directors with average tenure 3.4 years",
  "metadata": {
    "source_kind": "run_step",
    "source_id": "evt...",
    "summarised_from_step_seq": 7
  },
  "supersedes_observation_id": null,
  "is_pinned": false,
  "created_at": "2026-05-08T14:23:11Z"
}
```

**Producer:** `agentObservationService.append(...)` invoked from the run-step terminal-event hook in `agentExecutionService` and from the retrieval-summary handler.
**Consumer:** Overview tab (`RecentObservationsCard`) reads top-N via the anti-join above, ordered by `(created_at DESC, id DESC)` for deterministic same-millisecond tiebreak. The `WHERE supersedes_observation_id IS NULL` shorthand only captures root observations; the canonical anti-join captures latest leaves of every correction chain.

### 7.4 `/api/agents/:id/overview` (initial payload contract)

**Type:** REST endpoint, JSON response.

**Response shape (initial payload, ≤150KB compressed; brief §5.8):**
```json
{
  "identity": { "id": "...", "name": "...", "role": "...", "reportsTo": "...", "subaccountId": "..." },
  "presence": {
    "state": "running",
    "subtitle": null,
    "activeRunId": "run...",
    "currentFocus": { /* CurrentFocus */ },
    "elapsedSinceRunStartMs": 14211,
    "serverNow": "2026-05-08T14:23:11Z"
  },
  "activeGoals": [ { "type": "scheduled_run", "label": "Weekly Acme outreach", "nextRunAt": "..." } ],
  "recentObservations": [ /* top 3 typed observations; full payload for top 3 only */ ],
  "knowledgeInUse": [ /* top 3 entries with metadata; rest fetched on demand */ ],
  "filesSnapshot": [ /* top 3 files; deep-link to Phase 1 Knowledge → Files */ ],
  "toolsUsageBands": {
    "frequently": ["..."],
    "occasionally": ["..."],
    "rarely": ["..."],
    "asOf": "2026-05-08T13:00:00Z"
  },
  "schedulePeek": { "nextRunAt": "...", "trigger": "weekly_cron", "label": "Weekly Acme outreach" },
  "connectionsHealth": [ { "id": "...", "name": "...", "status": "healthy" } ],
  "workingTime": {
    "range": "today",
    "buckets": [ /* per-hour or per-day buckets with caption-bound rollup */ ],
    "captionTotalSeconds": 0,
    "captionRunsCount": 0,
    "captionSuccessRate": 0,
    "captionAverageRunDurationSeconds": 0
  },
  "activityFeed": [ /* first 5 rows; subsequent fetched on scroll or View all */ ]
}
```

**Lazy-load delegations** (brief §5.8 budget):
- `GET /api/agents/:id/observations?limit=...&cursor=...&pinned_only=...` — beyond initial 3.
- `GET /api/agents/:id/files-snapshot?limit=...&cursor=...` — beyond initial 3.
- `GET /api/agents/:id/tools-usage` — beyond initial bands.
- `GET /api/agents/:id/activity-feed?limit=...&cursor=...` — beyond initial 5.
- `GET /api/agents/:id/connections-health/:connectionId` — per-connection diagnostic detail.
- `GET /api/agents/:id/working-time?range=week|month|quarter` — non-active timeframes.
- `GET /api/agents/:id/knowledge-in-use/:entryId/provenance` — full provenance panel.

**Inline-content prohibition** (brief §5.8): activity-feed rows reference `event_id` only; full event content fetched on click. Recent-observation rows beyond the initial 3 reference `observation_id` only. Knowledge-in-use entries hold metadata + source-document id; never embed source text inline. Run-trace lineage chips reference the four-tuple only.

**Worst-case profiling:** spec author MUST profile the *50-runs-today, 200-pinned-observations, 30-knowledge-entries-loaded* worst case before declaring layout shippable. The 150KB target holds at the 95th-percentile worst case; design for graceful degradation (more aggressive lazy-loading) above it rather than blowing the budget.

**PR-review check.** Every new Overview surface added later asserts a payload-impact note in its PR. The §13.7 freshness matrix and §7.4 budget are paired contracts: every new surface picks one row in each.

### 7.5 Working Time accounting (formal definition; brief §5.4)

**Definition:** Working Time is the sum of intervals during which an `agent_execution_events.step_started` event has fired and a matching `step_completed` event has not yet fired, for runs owned by this agent — **minus** any nested intervals where the worker is in a declared wait state (HITL pause, external dependency wait, retry backoff). The accounting boundary is *worker-side compute*: the run engine and the IEE worker emit explicit start/end events when entering and exiting wait states; Working Time accumulates only outside those wait windows.

**Event pairs that bracket Working Time intervals:**

| Pair | Accumulates? | Notes |
|---|---|---|
| `step_started` → `step_completed` | Yes (as the outer envelope) | The matched envelope is required; an unmatched `step_started` falls into the `degraded` best-effort path below. |
| `tool_call_started` → `tool_call_completed` (worker-local tool, e.g. JSON transform, in-process LLM call) | Yes | Subset of the step interval; counts as Working Time. |
| `external_call_started` → `external_call_completed` (external API in flight, network round-trip) | **Subtracted** from the step interval | The worker is waiting; external service is doing the work. Subtraction is the mechanical rule. |
| `hitl_pause_started` → `hitl_pause_resolved` | **Subtracted** | Operator-blocked. |
| `retry_backoff_started` → `retry_backoff_completed` | **Subtracted** | Worker is sleeping. |
| `sub_agent_delegated` → `sub_agent_returned` | **Subtracted** for the parent (the parent's worker is awaiting the sub-agent); the sub-agent has its own `step_started` / `step_completed` envelope which counts as the sub-agent's Working Time. | Both agents bill separately; invoice rolls up. |

**Inclusion / exclusion summary:**

| Condition | Included? | Billed? |
|---|---|---|
| Active LLM call or worker-local tool call (state = `running`, no nested wait state) | Yes | Yes |
| Queue wait before a step starts | No | No |
| HITL pause (state = `waiting_on_human`) | No | No |
| External API in flight (state = `waiting_on_dependency`, between `external_call_started` and `external_call_completed`) | No | No |
| Retry backoff between attempts | No | No |
| Sub-agent delegation | Yes for parent (only for non-delegated portions) and Yes for sub-agent (both attributed separately; rolls up to parent run for invoice) | Yes for both |
| Failed step | Yes (up to failure timestamp; subtracts any nested wait windows that closed before failure) | Yes |
| Concurrent runs of the same agent | Time intervals **summed, not deduplicated** | Yes |
| Time spent in `degraded` state | Best-effort included based on last known step timestamps; if the step envelope never closed, accumulate up to the last observed event and stop | Yes |

**Bucket-split invariant for intervals crossing UTC midnight (and other bucket boundaries).**

**Bucket anchoring.** All buckets are **UTC-anchored** and **non-overlapping**. `agent_working_time_rollups.bucket_date` is interpreted as the UTC calendar date (`bucket_start = bucket_date 00:00:00 UTC`, `bucket_end = (bucket_date + 1 day) 00:00:00 UTC`). No DST-aware or local-timezone interpretation is permitted anywhere in the working-time pipeline — the rollup, the chart bucket math, the invoice line, and the test fixtures all consume the same UTC interpretation. Operator-facing display in non-UTC timezones is a presentation-layer concern (out of scope for v1; chart and invoice both render UTC labels in v1).

When a Working Time interval `[start, end)` spans more than one `bucket_date` (e.g. a step that started at 23:50 UTC and completed at 00:30 UTC the following day), the contribution is split across the buckets it covers. The split is governed by these hard rules:

1. **Half-open intervals.** All intervals are treated as `[start, end)` — start inclusive, end exclusive. The instant `T = bucket_boundary` belongs to the *new* bucket, never to both. Combined with non-overlapping UTC bucket anchoring, this guarantees every millisecond of the interval lands in exactly one bucket.
2. **Millisecond-exact bucket-sum invariant.** For any interval `I` of true duration `D` milliseconds, the sum of contributions to all affected buckets MUST equal `D` exactly: `Σ contribution(b, I) = D` for every interval, regardless of how many UTC boundaries it crosses. No millisecond is dropped, no millisecond is double-counted.
3. **No rounding during split.** The split function (`splitIntervalAcrossBuckets(start, end)`) operates on millisecond-precision integers and emits per-bucket millisecond contributions as integers. Rounding to the persisted column resolution (`working_time_seconds`, BIGINT) happens **once**, at the final bucket-aggregate write — not during the split, not during accumulation, not per-event.
4. **Single rounding rule at persistence.** When folding accumulated millisecond contributions into the `bucket_date` rollup row, the writer divides the millisecond total by 1000 using floor (truncate towards zero) and stores the result. The dropped sub-second remainder is carried forward in an in-memory `pending_remainder_ms` per (agent_id, bucket_date) within the transaction so the next contribution to the same bucket in the same transaction picks up the remainder. After commit, the remainder is recomputed from the per-event ledger on next write — it is not persisted as a separate column.
5. **Drift bound.** Over any timeframe the cumulative drift between `SUM(working_time_seconds × 1000)` and the true millisecond duration of the underlying intervals is bounded by `bucket_count - 1` milliseconds (the worst-case rounding loss is one bucket boundary's sub-second remainder). For the longest realistic billing window (a year of per-day buckets ≈ 365 buckets), drift is bounded at ≤ 365 ms — well below per-second invoice resolution.

Without this, a long-billing-window report (e.g. a year of per-day buckets) accumulates rounding drift that eventually breaks reconciliation. The pure helper enforces this contract.

**Pure helper** in `agentWorkingTimeServicePure.ts`:
```typescript
export function splitIntervalAcrossBuckets(
  startMs: number,    // monotonic ms
  endMs: number,      // monotonic ms; > startMs
): Array<{ bucketDate: string; contributionMs: number }>;
// Postcondition: sum of contributionMs equals (endMs - startMs) exactly.

export function accumulateWorkingTime(
  events: AgentExecutionEvent[],
): { workingTimeSeconds: number; runCount: number; successfulRuns: number; failedRuns: number; partialRuns: number; }
```

**Reconciliation invariant.** Working Time chart total for any timeframe = the per-agent invoice line for the same timeframe. Both surfaces read from the same `agent_working_time_rollups` table. Tested via pure unit. The parent-run rollup (parent + sub-agent total) is computed at invoice-presentation time as `SUM(parent_agent_rollup, sub_agent_rollups)`; that total is an invoice surface, not a chart on the parent's Overview tab. Per-agent charts and per-agent invoice lines reconcile 1:1.

**Hover affordance.** Each chart bar surfaces the run id(s) that contributed to the bucket — operator's escape hatch when reconciling against the invoice.

### 7.6 Home widget section ordering (brief §6)

**Pure comparator** `orderHomePresenceSections(rows)`:

Section order (top to bottom):
1. **Waiting on you** (`waiting_on_human`) — operator action required to unblock. Top 5 visible; overflow `+N more waiting on you`.
2. **Working now** (`running`) — Top 5 visible; overflow `+N more working`. Footer: `+M paused on system` (`waiting_on_dependency` count).
3. **Failing** (`failed`) — Top 5 visible; overflow `+N more failing`. Section hidden when empty.
4. **Scheduled next** (`scheduled`) — Top 5 visible; overflow `+N more scheduled today`. Sort by `next_run_at ASC` within section.
5. **Idle** (`idle`) — NOT shown; accessed via *All agents* link.

Within each section (except *Scheduled next*): sort by `updated_at DESC`.

`waiting_on_dependency` agents are intentionally NOT a peer section — count rolled into *Working now* footer.

`degraded` agents float into whichever section their `degraded_base_state` would have placed them; the *Status uncertain* badge surfaces the trust signal. The `agent_presence_projections.degraded_base_state` column (§6.3) is the authoritative input — pure-function ordering doesn't synthesise the section from raw signals.

**Cap.** Widget total height ≤17 rows (5 + section header × 4 + footer) regardless of agency size. Spec implementation must mock the 20-running case before declaring layout shippable.

### 7.7 Run-trace lineage chip (brief §8)

**Tuple:** `(run_id, event_id, produced_file_id, produced_version_id)`.

**Click resolution:**
- Default click: opens artifact at `produced_version_id` in Knowledge → Files. File chrome shows *"As produced by Outreach Agent run 1283, step 7, 2 days ago"* + `View latest` affordance.
- Chip never silently re-binds to a newer version.
- A small *Newer version available* badge MAY appear on the chip when the version is no longer current; link target stays bound.

**Layout caps:**
- Maximum visible chips per event: **4**. Beyond 4: render first 4 + `+N more` inline-expandable.
- Chronological ordering invariant: causal order (the order in which the parent event produced them). NEVER alphabetic, NEVER MIME-grouped.
- Filename truncation: **36 characters**, middle-ellipsis preserving extension.
- Maximum event-row height before overflow: **3 lines**, then `Show more` expandable.
- Detail panel (right column on Run trace) is the spillover for full content.

**Phase 1 deep-link contract** (locked in §15): `?agentId=...&runId=...&eventId=...&fileId=...&versionId=...`. Phase 1's Knowledge → Files tab MUST accept and resolve this query parameter.

---

## 8. Permissions / RLS checklist

Every new tenant-scoped table goes through the four-step checklist (CLAUDE.md + `docs/spec-authoring-checklist.md` Section 4):

| Table | RLS policy in same migration | Manifest entry | Route guard | Principal-scoped context |
|---|---|---|---|---|
| `agent_observations` | Yes — `agent_observations_org_isolation` | Yes — appended to `RLS_PROTECTED_TABLES` | `requirePermission(ORG_PERMISSIONS.AGENTS_VIEW)` on read; service-only writer (no direct route) | Yes — observations writer runs inside agent execution path's principal context |
| `iee_sessions` | Yes — `iee_sessions_org_isolation` | Yes — appended | Service-only (no direct HTTP routes); agent overview endpoint gates via `ORG_PERMISSIONS.AGENTS_VIEW` | Yes — session lifecycle runs inside IEE worker's principal context |
| `agent_presence_projections` | Yes — `agent_presence_projections_org_isolation` | Yes — appended | `GET /api/agents/:id/overview` and `/presence` routes via `ORG_PERMISSIONS.AGENTS_VIEW` | Yes — projection writes are inside the same context as event writes |
| `agent_working_time_rollups` | Yes — `agent_working_time_rollups_org_isolation` | Yes — appended | `GET /api/agents/:id/working-time` via `ORG_PERMISSIONS.AGENTS_VIEW` | Yes |
| `agent_working_time_event_ledger` | Yes — `agent_working_time_event_ledger_org_isolation` | Yes — appended | Service-only (no direct HTTP routes) | Yes |

**Permission keys** (existing or new) — canonical store is `server/lib/permissions.ts`:

- `ORG_PERMISSIONS.AGENTS_VIEW` (existing, key `'org.agents.view'`) — gates `/api/agents/:id/overview`, `/api/agents/:id/observations`, `/api/agents/:id/working-time`, `/api/agents/:id/activity-feed`, the SSE stream endpoints, and all related read paths.
- `ORG_PERMISSIONS.AGENTS_OBSERVATIONS_PIN` — **new key**, added to `server/lib/permissions.ts` in Phase 1 alongside the migration. Gates the operator-driven pin affordance (v1.1 surface; column exists in v1, permission exists so v1.1 can ship without a migration).
- `ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE` — **new key**, added in Phase 3 alongside the SSE handler. Defence-in-depth on top of `AGENTS_VIEW` (rare-but-possible separation: an admin can revoke stream-subscription without revoking page view).

No new permission keys required for the Home widget — `ORG_PERMISSIONS.AGENTS_VIEW` at workspace scope already covers it.

**Cross-tenant isolation gate.** `verify-rls-coverage.sh` runs at CI; new tables must be in the manifest before merge.

**Three-layer fail-closed** (architecture.md §1155): all read paths use `withOrgTx` / `getOrgScopedDb`; no direct DB access. The presence stream publisher (Phase 3) MUST resolve org context via `withOrgTx` before subscribing — no fast path that skips RLS.

**Cross-org leak guard for SSE.** The presence stream MUST validate `organisation_id` and `subaccount_id` on every event push; cross-org subscriptions are rejected at handshake time. `agent_presence_projections_org_isolation` policy ensures the publisher's read query already filters; the handshake check is defence-in-depth.

---

## 9. Execution model

Picked once per surface; the rest of the spec is consistent with the choice.

| Surface | Model | Cache / partition | Notes |
|---|---|---|---|
| Status pill (`AgentPresenceState`) | Server-pushed (SSE) | Read from `agent_presence_projections`; pushed on tail-event | <5s end-to-end |
| Current focus | Server-pushed alongside pill | Same channel | <5s end-to-end |
| Activity feed | Append stream over same SSE channel | None | <10s |
| Recent observations | Append stream | None — reads `agent_observations` | <10s |
| Working Time chart (active timeframe) | Server-pushed for the bucket containing "now"; older buckets immutable | Reads `agent_working_time_rollups` | <30s |
| Working Time chart (other timeframes) | Cached read on tab-pill click | TTL 60s | Lazy-fetch |
| Knowledge in use | Event projection from Phase 1 retrieval observability | Active-run live; otherwise last-run snapshot | <5s active; immediate on run-end |
| Files snapshot | Cached per-agent slice of Phase 1 Files projection | TTL 60s | Refresh on run-end + explicit invalidation triggers (§9.1) |
| Tools usage bands | Materialised aggregation | Cache 1h | Bands shift slowly |
| Connections health | Cached read | TTL 60s | Connections page is live; Overview snapshot is the cached read |
| Schedule peek | Cached read | TTL 60s | |
| Identity card | Static (read on tab mount) | None | No live updates |
| Home widget | Same SSE channel multiplexed for workspace scope | None | <5s |

**Cross-cutting rule:** surfaces driven by SSE share **one connection per Overview tab** and one connection per Home widget. No three-independent-channels pattern.

**Idempotency check:** `agent_presence_projections` upserts use `INSERT … ON CONFLICT (agent_id) DO UPDATE` with the §11.1 watermark predicate (per-run `(last_event_run_id, last_event_run_seq)` plus cross-run server-side `(last_event_timestamp, last_event_id)` tiebreaker tuple). The watermark composes per-run + cross-run because `agent_execution_events.sequence_number` is run-scoped, not global; replayed events never overwrite newer state (brief §5.2 *no rollback by replay*). The cross-run tuple is the canonical ordering invariant — same tuple drives replay sort (§12.4), SSE replay (§13.4), and degraded recovery ordering (§12.3).

**No new service layer.** Reuse `agentExecutionEventService` for emission; reuse existing `withOrgTx` for tenant isolation. The presence projection writer is a function inside `agentPresenceService`, not a parallel pipeline.

### 9.1 Files snapshot cache invalidation triggers

The Overview *Files snapshot* card reads a cached per-agent slice of Phase 1's Files projection (TTL 60s). The TTL is the floor; explicit invalidation triggers fire **above** the TTL whenever any of these events occur, so the snapshot never surfaces stale lineage:

| Trigger | Detection | Effect |
|---|---|---|
| Run terminal event | `agent_execution_events` emits `run_completed` | Invalidate the cache key for `(agentId)` and prefetch the new snapshot |
| Artifact promotion to Knowledge | Phase 1 emits a `knowledge.files.promoted` event referencing an `iee_artifacts.id` belonging to this agent | Invalidate `(agentId)` |
| Version supersession | A new `iee_artifacts` row is written with the same logical filename (a new `produced_version_id`) for this agent's runs | Invalidate `(agentId)` |
| Manual deletion or archive | Phase 1 emits a `knowledge.files.deleted` or `knowledge.files.archived` event | Invalidate `(agentId)` |
| Restore / undelete | Phase 1 emits a `knowledge.files.restored` event (a previously deleted/archived file returning to active state) | Invalidate `(agentId)` |
| Metadata edit | Phase 1 emits a `knowledge.files.metadata_changed` event (filename, display name, description, tags, classifier — anything the snapshot renders) | Invalidate `(agentId)` |
| Permission / visibility change | Phase 1 emits a `knowledge.files.access_changed` event (file scoped in or out of this agent's visibility) | Invalidate `(agentId)` — and re-evaluate which files belong in the snapshot at all |
| Merge | Phase 1 emits a `knowledge.files.merged` event (two file lineages collapsed into one). If Phase 1 models merge as a supersession with extra metadata, the supersession trigger above already covers this. | Invalidate `(agentId)` |

Cache invalidation hooks live in `server/services/agentOverviewAggregator.ts`; subscribers are wired at server bootstrap. Phase 1 owns the emission of the `knowledge.files.*` lifecycle events listed above on the same `agent_execution_events` channel — this is added to the §15.1 Phase 1 coordination contract. The trigger set is exhaustive over **visibility-affecting changes** to a file the snapshot can render: write a new file, change which files an agent can see, change what a chip says, or change whether a deep-link still resolves. Anything Phase 1 ships that fits one of those four categories MUST emit on this channel; missing emissions surface as stale-snapshot bugs.

Phase 1 may not implement every trigger above on day one (e.g. restore may not exist if Phase 1 only supports hard-delete in v1). The contract is conditional: *if* Phase 1 emits one of these events, cloud-compute MUST invalidate. The reverse direction — Phase 1 silently performing one of these mutations without an event — is the failure mode this list defends against, and the burden of compliance lives with Phase 1's spec.

Without these triggers, a promoted-or-deleted file remains in the Files snapshot for up to 60 seconds with stale lineage affordances (deep-links pointing at archived files, missing newly-promoted files, mismatched filenames after a metadata edit, or files visible to an agent who has just lost access). The triggers above close the staleness window — the operator never clicks a chip that points at a file that has just moved.

The cache backend is the same process-local cache used elsewhere on the Overview tab (no Redis dependency in v1). On a future multi-node deployment, the §13.1.1 publisher topology decision applies: the cache becomes per-node, and invalidation is fan-out via the same broker layer. Until then, single-node correctness is the contract.

---

## 10. Phase sequencing (dependency graph)

Forward-only. No phase references a primitive introduced in a later phase.

| Phase | Schema introduced | Services introduced | Services modified | Jobs introduced | Columns referenced by code |
|---|---|---|---|---|---|
| 1 | `agent_observations`, `iee_sessions`, `agent_presence_projections`, `agent_working_time_rollups`; columns on `iee_artifacts` | `agentPresenceService`, `agentObservationService`, `agentWorkingTimeService`, `ieeSessionService` (skeleton only — full lifecycle in Phase 4), pure helpers | `agentExecutionEventService` | none | All Phase-1 tables, `agent_execution_events`, `agent_runs` |
| 2 | `users.default_agent_tab` | `agentOverviewAggregator`, overview-route handler | none | none | Phase-1 tables, `agent_runs`, `users.default_agent_tab` |
| 3 | none | `agentPresenceStreamPublisher` | `agentPresenceService` | none | Phase-1, Phase-2 tables |
| 4 | none | `ieeSessionService` (full implementation) | `ieeExecutionService` | `ieeSessionOrphanCleanup`, `ieeSessionsCompactJob`, `agentObservationsPruneJob`, `workingTimeRollupCompactJob` | `iee_sessions`, `iee_runs`, `iee_steps`, `iee_artifacts` |
| 5 | none | none | none — only client | none | `iee_artifacts.producing_event_id`, `iee_artifacts.produced_version_id` (introduced Phase 1) |
| 6 | none | none | none | none | none — capability docs only |

**Backward dependency check:** Phase 5 reads `iee_artifacts.producing_event_id` and `produced_version_id`, which are added in Phase 1 — forward.
**Orphaned deferral check:** `is_pinned` column added Phase 1, surface in v1.1 (§18 deferred); the column exists at v1 build time so no orphaned deferral.
**Phase-boundary contradiction check:** every phase's column references are introduced in itself or earlier; no claim of "no migrations" carries a migration in the inventory.

---

## 11. Execution-safety contracts

Per spec-authoring checklist Section 10, every new write path declares idempotency / retry / concurrency / terminal events.

### 11.1 Idempotency posture

| Operation | Posture | Mechanism |
|---|---|---|
| `INSERT INTO agent_observations` | `key-based` | `UNIQUE (idempotency_key)` — duplicate observation emit for the same logical observation is rejected. The key is computed by the writer from `(event_id, source_id, observation_type, normalised_body_hash)` so multiple distinct observations of the same type from the same event are permitted. `(supersedes_observation_id)` is allowed many-to-one (multiple corrections superseding the same root). |
| `INSERT INTO iee_sessions` | `key-based` | `UNIQUE (run_id)` — second session-creation for the same run rejected with 409 (mapped from 23505). |
| `UPSERT agent_presence_projections` | `state-based` | Predicate: accept if `(excluded.last_event_run_id = projections.last_event_run_id AND excluded.last_event_run_seq > projections.last_event_run_seq) OR (excluded.last_event_timestamp, excluded.last_event_id) > (projections.last_event_timestamp, projections.last_event_id)`. Per-run sequence is the within-run watermark; cross-run uses the server-side monotonic timestamp from `agent_execution_events.event_timestamp` with `agent_execution_events.id` (UUID) as the deterministic tiebreaker for same-timestamp events emitted by concurrent runs (timestamps may collide when truncated to ms or sourced from the same transaction boundary). The tuple `(event_timestamp ASC, event_id ASC)` is the canonical ordering invariant used everywhere — replay sort, projection acceptance predicate, SSE replay, degraded recovery ordering. |
| `INSERT INTO agent_working_time_rollups` (upsert) | `key-based` | The ledger is the single mechanism. `agent_working_time_event_ledger.event_id` is the PK; the writer inserts into the ledger first (`INSERT INTO ledger ON CONFLICT DO NOTHING RETURNING event_id`); only on a non-empty RETURNING does it apply the contribution to the rollup bucket(s) in the same transaction. Replays, retries, and out-of-order events are all idempotent. The rollup table has no sequence watermark of its own; idempotency lives at the per-event ledger. |
| `INSERT INTO iee_artifacts` (with `producing_event_id`, `produced_version_id`) | `key-based` | `produced_version_id` is allocated at write time; subsequent re-writes of the same logical filename produce a new row with a new version id. No upsert path — every write is a new row. |
| Session heartbeat update | `safe` (state-based) | `UPDATE … WHERE id = $1 AND status IN ('active','idle')` — heartbeat after teardown is a no-op (0 rows updated). |
| Session teardown | `guarded` | Optimistic predicate `WHERE status IN ('active','idle')`; second teardown returns the prior teardown's result (the existing `release_reason`). |

### 11.2 Retry classification

| Operation | Class | Boundary |
|---|---|---|
| Observation append | `guarded` | UNIQUE on `idempotency_key` (computed by writer from `(event_id, source_id, observation_type, normalised_body_hash)`) |
| Session create | `guarded` | UNIQUE on `run_id` |
| Presence projection upsert | `safe` | Sequence-watermark predicate |
| Working-time rollup upsert | `guarded` | `agent_working_time_event_ledger` PK on `event_id` — replays produce 0-row ledger inserts, which short-circuit the rollup contribution |
| Heartbeat | `safe` | Idempotent; 0-rows-updated path is no-op |
| Session teardown | `guarded` | Optimistic predicate `WHERE status IN ('active','idle')` |
| Stream reconnect with `Last-Event-ID` (or `lastEventId` query param) | `safe` | Server resolves the `Last-Event-ID` UUID against an in-memory ring buffer (default 60s window) keyed by emitted-event UUID; the buffer entry carries the canonical `event_timestamp`. Server replays events with `event_timestamp > <buffer-lookup-timestamp>` in `(event_timestamp, event_id)` order. If the UUID is not in the buffer (client gone too long, or transport-layer UUID expired), server snaps the client to the current canonical state with a single `presence_state_changed` event. Older replayed events are recorded for audit but not re-applied to the live projection per §12.4. |

### 11.3 Concurrency guards

| Race | Guard | Losing-caller response |
|---|---|---|
| Two parallel runs of same agent (concurrent scheduled triggers) | Two distinct `iee_sessions` rows — `UNIQUE (run_id)` permits this. Working-time intervals **sum, not deduplicate** (brief §5.4). | n/a — both win |
| Two writers attempting to create a session for the same run | `UNIQUE (run_id)` → 23505 → mapped to HTTP 409 with error body referencing the existing session id | 409 with `{ existingSessionId: ... }` |
| Two correctors superseding the same observation | Allowed; both `supersedes_observation_id = X` rows exist. The Overview surface displays the *latest* by `(created_at, id)` per the §7.3 deterministic-ordering query. The audit history shows both. | n/a — both stored |
| Supersession cycle (A supersedes B; B then attempts to supersede A) | Service-level DFS guard in `agentObservationService.append()` walks the supersession chain up to depth 32 inside the same `withOrgTx` transaction. Each visited row is read `SELECT … FOR UPDATE` so concurrent inserts pointing at the same parent serialise on the row lock. Scope: per-correction-chain, organisation-bounded by RLS — never cross-workspace or global. Rejects any write that would self-reach or revisit a stacked row (§7.3). | 409 `supersession_cycle_detected` |
| Two clients both attempting to set the user's default tab simultaneously (v1.1 only — no v1 write path) | Last-write-wins (`users.default_agent_tab` is a single column) | 200 with the persisted value |
| Replay storm (event stream reconnect) | Sequence-watermark on `agent_presence_projections.(last_event_run_id, last_event_run_seq)` + cross-run timestamp tiebreaker; `agent_working_time_event_ledger` makes per-event folding key-based and idempotent — older replayed events ignored | n/a — silently skipped, audit logged |
| Two heartbeats for same session arriving simultaneously | `UPDATE … WHERE id = $1 AND status IN ('active','idle')` — both updates succeed (last `last_heartbeat_at` wins) | n/a — both succeed |

### 11.4 Terminal events

| Chain | Terminal event | Status field | Post-terminal prohibition |
|---|---|---|---|
| Run lifecycle (existing) | `run_completed` (existing) | `success | partial | failed` | No new events with same `run_id` after terminal — existing contract |
| Session lifecycle | Session row's `released_at` set | `release_reason` ∈ closed enum | No further state transitions; `torn_down → *` forbidden |
| Observation thread | Latest non-superseded row | n/a (each row is its own truth) | A superseded row never re-emerges as canonical |

**No-silent-partial-success rule.** Run terminal events that complete with partial side-effects emit `status = 'partial'`. The Overview Working Time chart accounts the run as `partial_runs += 1`; the Working Time bar is coloured indigo (success portion) with red overlay (failed portion) per the brief §5 caption rule.

### 11.5 Unique-constraint → HTTP mapping

| Constraint | HTTP | Body |
|---|---|---|
| `iee_sessions UNIQUE (run_id)` | 409 | `{ "error": { "code": "session_already_exists", "existingSessionId": "..." } }` |
| `agent_observations UNIQUE (idempotency_key)` | 200 (idempotent hit — service treats the existing row as success) | Returns the existing observation row |
| `agent_observations` supersession-cycle guard (§7.3) | 409 | `{ "error": { "code": "supersession_cycle_detected", "rejectedSupersedesObservationId": "..." } }` |
| `agent_observations_body_size_cap` (§6.1, §7.3) | 400 | `{ "error": { "code": "observation_body_too_large", "byteLength": 12345, "limitBytes": 8192 } }` |
| `users.default_agent_tab` (v1.1 only — no v1 write path) | 200 (idempotent — the value is what was set) | n/a |
| `iee_artifacts UNIQUE` (existing) | n/a — every write produces a new row with a new `produced_version_id`; no upsert path | n/a |

No 23505 ever bubbles as 500. Mapping enforced inside the service writer, not at the route boundary.

### 11.6 Working Time accounting reconciliation

Pure-function unit test: `accumulateWorkingTime(events)` for the closed-table cases in §7.5 and the brief §5.4. The reconciliation invariant — chart total equals invoice total — is asserted at the test level by computing both from the same `agent_working_time_rollups` rows and asserting equality. If a future invoice surface diverges (e.g. introduces its own rollup), this invariant must hold at the call-site or be explicitly broken with a recorded ADR.

### 11.7 Anti-stale clock guard (brief §5.1 hard rule, §5.3 clock authority)

The freshness thresholds form one closed set, declared as constants in `shared/types/agentPresence.ts` and used by both the projection writer and the pure tests:

```typescript
export const PRESENCE_FRESHNESS_THRESHOLDS_MS = {
  EVENT_STREAM_DELAYED:   10_000,   // §12.3 entry to `degraded` with reason 'event_stream_delayed'
  WORKER_HEARTBEAT_STALE: 30_000,   // §12.3 entry to `degraded` with reason 'worker_heartbeat_stale'
  FOCUS_LINE_STALE_COPY:  30_000,   // §5.1 stale-state copy threshold (one source-of-truth value)
  DEGRADED_HYSTERESIS:    10_000,   // §12.3 minimum dwell in degraded
  DEGRADED_OSCILLATION_WINDOW: 30_000, // §12.3 anti-oscillation window
  DEGRADED_OSCILLATION_HOLD:    60_000, // §12.3 anti-oscillation hold time
} as const;
```

**Clock domain split for the constants above.**

- `EVENT_STREAM_DELAYED`, `WORKER_HEARTBEAT_STALE`, `FOCUS_LINE_STALE_COPY` are evaluated against the canonical `agent_execution_events.event_timestamp` clock (§13.5). These are *event-age* checks, not timer checks.
- `DEGRADED_HYSTERESIS`, `DEGRADED_OSCILLATION_WINDOW`, `DEGRADED_OSCILLATION_HOLD` are evaluated against a **monotonic process clock** (`process.hrtime.bigint()` or equivalent), per §12.3 monotonic-clock requirement. NTP adjustments and VM clock jumps would otherwise corrupt these deltas. The `agent_presence_projections.degraded_entered_at` column is a wall-clock timestamp kept for audit / UI display ONLY — never used as the source for hysteresis or oscillation arithmetic.

`Current focus` displays MUST be wrapped in a freshness check at the resolver level: if the latest event's age exceeds `EVENT_STREAM_DELAYED` (10s) while status = `running`, the projection writer transitions `presence_state` to `degraded` with `degraded_reason = 'event_stream_delayed'` (per §12.3). The focus line is replaced with the §5.1 stale-state copy when the age exceeds `FOCUS_LINE_STALE_COPY` (30s). Both thresholds are enforced at projection-write time, not at the client.

`failed` is reserved for terminal failure events emitted by the run engine — never inferred from telemetry silence. If the run truly completed while telemetry was stale, the next received event resolves `degraded` to `idle` per §12.3 *State on resolution*. If the run is genuinely stuck (no terminal event ever arrives), the agent stays in `degraded` until the worker heartbeat times out, at which point the orphan-cleanup path (Phase 4) writes a terminal failure event and the projection transitions to `failed` via the canonical chain.

---

## 12. State machine — `AgentPresenceState`

### 12.1 Closed status set

Seven values: `idle | running | waiting_on_human | waiting_on_dependency | scheduled | degraded | failed`. Adding a new value requires a spec amendment (§7.1 enforcement). The Postgres `CHECK` constraint on `agent_presence_projections.presence_state` is the database-level enforcement; the TypeScript discriminated union is the application-level enforcement.

### 12.2 Valid transitions

```
idle ↔ running
idle ↔ scheduled
idle ↔ degraded
running ↔ waiting_on_human
running ↔ waiting_on_dependency
running ↔ degraded
running → idle (run completed cleanly)
running → failed
waiting_on_human → running (operator unblocks)
waiting_on_human → failed (operator rejects / timeout)
waiting_on_dependency → running (dependency resolves)
waiting_on_dependency → failed (dependency permanently unavailable)
waiting_on_dependency → degraded (telemetry uncertain)
scheduled → running (scheduled time arrives)
scheduled → idle (run cancelled before fire)
degraded → <freshly resolved primary state> (per §12.3 — resolver re-runs the §7.1 chain; NOT a return to the pre-degradation state)
failed → idle (operator acknowledges; manual recovery)
```

**Forbidden:** any transition not listed. `failed → running` directly is forbidden — the agent must transition through `idle` (operator-acknowledged recovery). Forbidden transitions are caught at the projection-writer layer; the writer rejects an upsert that would produce an illegal transition and logs `presence.illegal_transition_attempt` for audit.

### 12.3 `degraded` recovery semantics (brief §5.2)

Entry conditions (any one is sufficient):

| Condition | Detection | UI subtitle |
|---|---|---|
| `event_stream_delayed` | Server detects no new event from this run for 10s while activity is expected | Subtitle: "Presence delayed…" |
| `worker_heartbeat_stale` | The IEE worker handling this run has not pinged in 30s | Subtitle: "Status uncertain" |
| `focus_source_unavailable` | The latest event has no summarisable content | "(focus snapshot, X seconds ago)" |

These three **server-observed** conditions are the only ones that populate `agent_presence_projections.degraded_reason`; the table's CHECK constraint pins the closed list. Each is detected on the server and is shared truth across all surfaces.

**Client-side transport failures are NOT canonical presence.** When the client's SSE connection drops (network blip, tab paused, load-balancer flap), the client renders a **local** banner ("Reconnecting…") and freezes its tickers. The server-side `agent_presence_projections.presence_state` is unchanged — every other surface viewing the same agent continues to see the live state. Local transport health and canonical presence are two separate signals; conflating them lets one tab's disconnect mutate global state, which violates the brief §5.3 single-source-of-truth invariant. This separation is hard.

**Recovery threshold.** `degraded` clears only after **two consecutive healthy heartbeat intervals** observed by the server-side projection writer. Recovery is entirely server-observed. Client-side resync acknowledgements (when an SSE client reconnects with `Last-Event-ID`) are a separate non-canonical signal that affects only that client's local UI; they do NOT mutate `agent_presence_projections.presence_state` (per the §12.3 client-vs-canonical separation).

**Hysteresis window.** Minimum **10 seconds** in `degraded` before transitioning back. Prevents one-packet flicker. Implemented at the projection writer — the writer rejects a `degraded → primary` upsert if `(process.hrtime.bigint() - degradedEnteredHrtime) < DEGRADED_HYSTERESIS_NS`. The check runs against the in-process `Map<agentId, { degradedEnteredHrtime: bigint, ... }>` (see *Implementation* below), never against the wall-clock `degraded_entered_at` column. The column remains audit/UI only.

**Anti-oscillation rule.** If `degraded → healthy → degraded` happens twice within a 30-second window, the agent stays in `degraded` for the full 60-second hysteresis period regardless of subsequent healthy heartbeats. `degraded_oscillation_count` field on `agent_presence_projections` tracks within-window count; reset by the projection writer when the 30-second window elapses without an oscillation.

**Monotonic-clock requirement for hysteresis and oscillation timers.** All time deltas evaluated against `DEGRADED_HYSTERESIS`, `DEGRADED_OSCILLATION_WINDOW`, and `DEGRADED_OSCILLATION_HOLD` (defined in §11.7) MUST be measured against a **monotonic process clock** — `process.hrtime.bigint()` in Node.js, or equivalent — never `Date.now()` and never `NOW()` SQL deltas. Two hard reasons:

1. **NTP adjustments and VM clock jumps** can move wall-clock time backward or forward by minutes; `Date.now()` deltas would either prematurely clear `degraded` (false-healthy) or refuse to clear it (false-stuck), depending on jump direction.
2. **Server clock drift between writes and reads** would let a writer compute a delta against a fresher wall-clock than the projection's `degraded_entered_at`, producing inconsistent enforcement across nodes.

Implementation: `agentPresenceService` maintains an in-process `Map<agentId, { degradedEnteredHrtime: bigint, oscillationWindowStartHrtime: bigint }>` keyed off agent id, populated when the projection enters `degraded` and consulted on every projection write. The `degraded_entered_at` column on `agent_presence_projections` remains a wall-clock timestamp for **audit/UI display only**; it is NEVER read as the source for hysteresis or oscillation arithmetic.

This matters operationally because degraded recovery is now load-bearing for the Home widget ordering (§7.6) and the §16.5 anti-optimistic invariant — a stuck-but-recovered or recovered-but-stuck state corrupts those surfaces.

**State on resolution.** Transitions to whatever the primary state actually is — derived fresh from the §7.1 resolution chain — not back to whatever it was before the degradation began. If the agent finished its run while telemetry was degraded, the resolved state is `idle`, not the prior `running`.

### 12.4 Replay semantics (brief §5.2 hard rule)

- Events apply strictly in `(event_timestamp ASC, event_id ASC)` order. This tuple is the **canonical ordering invariant** for the entire spec — the same tuple drives §11.1 projection acceptance, §13.4 SSE replay, and §12.3 degraded-recovery ordering. `event_id` is the deterministic tiebreaker for events whose timestamps collide (truncation to ms, same-transaction-boundary emissions, or events emitted by concurrent runs of the same agent).
- Duplicate events (same `event_id`) detected and ignored on second arrival.
- **Older replayed events never overwrite newer resolved state.** If a replayed event's tuple `(T1, id1)` arrives after the projection has advanced past `(T2, id2)` where `(T2, id2) > (T1, id1)`, the event is recorded for audit but is NOT re-applied to the live presence projection.
- Out-of-order arrival within a batch is fine; the projection sorts by the tuple before applying.

This is enforced at the projection upsert layer (§11.1 sequence-watermark predicate + cross-run `(timestamp, id)` tuple).

---

## 13. Live transport contract

### 13.1 Channel choice

**SSE** (Server-Sent Events). Locked. Rationale:
- Simpler reconnect semantics (`Last-Event-ID` header is built in).
- Read-only event push fits the use case (the Overview tab does not push state to the server).
- Lower complexity than WebSocket — no protocol upgrade negotiation.

If a future surface ever needs a bidirectional channel, that surface adopts WebSocket independently — it does not retrofit onto this presence stream. The contract is SSE-only.

### 13.1.1 Publisher topology (v1 — single-node)

The presence stream's publisher topology is **explicitly single-node** in v1. This is a deliberate scope lock; future scaling is a separate spec.

- **One in-process publisher per node.** `agentPresenceStreamPublisher` is a singleton inside the server process. Every SSE subscriber on this node is held in a process-local subscriber registry keyed by `(agentId | subaccountId)` and `subscriberId`.
- **Process-local subscriber registry.** No shared cache, no message bus, no Redis pub/sub in v1. The publisher is fed by the same `agentExecutionEventService` event tail that writes the projection — projection-write hook → publisher.fanOut(event) → registered subscribers on this node.
- **No cross-node consistency guarantees.** When the deployment becomes horizontally scaled (multi-node), the single-node publisher has no mechanism to push events to subscribers on other nodes. v1 does not promise cross-node consistency. The correct multi-node design (a fan-out broker, e.g. Postgres `LISTEN`/`NOTIFY` or a dedicated pub/sub) is deferred.
- **Reconnect snapshot is the canonical recovery path** for any inconsistency. When a client reconnects (across nodes, after a deploy, after a network blip), the §13.4 reconnect path reads from `agent_presence_projections` (which IS shared via the database) and replays from the per-node ring buffer if the client is still anchored to a buffer entry, else snaps to canonical state. The projection table is the single source of truth — the in-memory publisher is best-effort live delivery on top of it.
- **Cross-node consistency is achieved only through the shared projection table**, not through any in-process publisher coordination. Builders who later add multi-node support MUST NOT assume this v1 publisher offers cross-node fan-out; they design a broker layer.

This topology is sufficient for pre-production. The deferred-items list (§18) carries the multi-node fan-out work; promoting to multi-node requires a fresh spec amendment.

### 13.2 Endpoints

- `GET /api/agent-presence/stream/:agentId` — per-agent stream, used by Overview tab.
- `GET /api/agent-presence/stream/workspace/:subaccountId` — workspace-scope stream, used by Home widget.
- Both gated by `ORG_PERMISSIONS.AGENTS_VIEW` + `ORG_PERMISSIONS.AGENTS_PRESENCE_STREAM_SUBSCRIBE`.

### 13.3 Event types over the channel

Every event carries a server-emitted `id:` line (which the browser's `EventSource` automatically tracks as `lastEventId` for reconnect). The `id:` value is the `agent_execution_events.id` UUID for run-derived events, or a server-allocated UUID for transport-layer events (heartbeat, presence-projection-only updates).

Every event's `data:` payload carries `eventTimestamp` (server-side monotonic; from `agent_execution_events.event_timestamp` for run-derived events, or `NOW()` for transport-layer events) and `serverNow` (current server time). These are required by §13.5 clock authority and §13.4 replay sort.

```
id: <event-uuid>
event: presence_state_changed
data: { agentId, presenceState, presenceSubtitle, eventTimestamp, serverNow }

id: <event-uuid>
event: current_focus_updated
data: { agentId, focus: CurrentFocus, eventTimestamp, serverNow }

id: <event-uuid>
event: observation_appended
data: { agentId, observation: AgentObservation, eventTimestamp, serverNow }

id: <event-uuid>
event: activity_row
data: { agentId, eventRow: ActivityFeedRow, eventTimestamp, serverNow }

id: <event-uuid>
event: working_time_bucket_updated
data: { agentId, bucketDate, workingTimeSeconds, runCounts, eventTimestamp, serverNow }

id: <heartbeat-uuid>
event: server_heartbeat
data: { eventTimestamp, serverNow, lastEventId }    # sent every 15s; client uses to detect channel staleness
```

### 13.4 Reconnect + replay

- The browser's native `EventSource` automatically sends `Last-Event-ID: <last-seen-id>` as a header on reconnect once the connection has emitted at least one `id:` line. **Initial-open** does not carry a header. To resume after a deliberate close (e.g. tab restored from background), the client passes a `lastEventId` query parameter (`GET /api/agent-presence/stream/:agentId?lastEventId=<uuid>`) on initial open; the server prefers the query param, falls back to the header, and falls back to "no resume" if neither is present.
- Server responds with all events since that id, in `(event_timestamp, event_id)` order, then resumes live.
- If the client has been gone for longer than the server-side buffer (default 60s), the server sends a `presence_state_changed` event for the current canonical state (the client snaps to it) — no incremental replay. The buffer-overflow path is logged so operators can detect chronic flapping.
- §12.4 replay semantics apply to the client-side projection: duplicates ignored, older events never overwrite newer resolved state, out-of-order within a batch sorted before applying.

### 13.5 Clock authority (brief §5.3 hard rule)

- Every event over the channel carries `serverNow` and `eventTimestamp` (server-side, monotonic from `agent_execution_events`).
- Client elapsed-time tickers compute `now_server - event_timestamp_server` from server values, NOT from `Date.now()`.
- Local incrementing of event sequence numbers is forbidden.
- The §13.7 freshness budgets are measured **server-to-client**, not by client measuring against its own clock.

### 13.6 `useAgentPresence` hook contract (brief §5.6 anti-optimistic invariant)

- **Single, server-confirmed snapshot per render.** No intermediate predictions leak into the UI.
- **Allowed local synthesis** (presentation only): animating elapsed-time counter between server updates (the *0:42 elapsed* tick is fine; underlying timestamp is server-derived); smoothing the chart bar containing "now" between aggregation pushes; local hover/focus/expand UI state.
- **Forbidden synthesis** (state simulation): pre-committing presence transitions; speculative `waiting_on_human` / `failed` / `degraded` / `completed` assertions; appending observations or knowledge-in-use entries without the server event; inventing activity-feed rows; "Run started" / "Run completed" surfacing before the server-side run-lifecycle event lands.
- The hook MUST expose only the most recent server-confirmed snapshot. Optimistic update libraries (e.g. React Query's `optimisticData`) MUST NOT be used for presence state.

### 13.7 Freshness matrix (brief §5.5; replicated for SSE/cache budget)

| Surface | Target | Delivery |
|---|---|---|
| Status pill | <5s | SSE (no polling fallback — channel is locked SSE-only per §13.1) |
| Current focus | <5s | SSE |
| Activity feed | <10s | SSE append stream |
| Recent observations | <10s active; immediate on run-end | SSE append stream |
| Working Time chart | <30s | SSE for active bucket; rest cached 60s |
| Knowledge in use | <5s active; last-run snapshot | SSE; snapshot persists between runs |
| Files snapshot | <60s | Cached read; refresh on run-end |
| Tools usage bands | Hourly | Materialised; cache 1h |
| Connections health | ≤60s | Cached read |
| Schedule peek | <60s | Cached read |
| Identity | Static | Read on tab mount |

**Graceful degradation:** a surface that misses its freshness target stamps the data ("as of 47s ago") rather than rendering stale data as live. Composes with §12.3 `degraded` state and the brief §5.1 stale-state copy.

**PR-review check.** Every new Overview surface added later asserts a freshness-matrix row in its PR. The §7.4 budget and §13.7 matrix are paired contracts.

### 13.8 Accessibility (brief §10)

- **Reduced-motion.** Every animation honours `prefers-reduced-motion: reduce`. Pulse, fade, slide, marquee all gated. Reduced-motion users see static dots, instant pill transitions, no slide-in feed rows.
- **ARIA live regions.** Status-pill changes, focus updates, activity-feed appends announced via `aria-live="polite"`; `waiting_on_human` and `failed` transitions use `aria-live="assertive"`.
- **Screen-reader throttling.** Live updates rate-limited to **one announcement per 5s per surface**; high-activity bursts collapse to *"Outreach Agent: 12 new activity rows in the last minute"*, not 12 separate announcements.
- **Layout stability.** Status pill width fixed across all 7 states. Activity feed appends below; existing rows do not reflow. Pre-rendered final-state heights for surfaces that update in place.
- **Keyboard navigation.** Every link / expand / hover-only affordance has a keyboard equivalent. Hover is enhancement only.
- **Colour + copy + shape pairing.** Status pill colours (indigo / amber / red / slate) paired with copy and dot shape so colourblind operators parse state correctly.

---

## 14. Capabilities / positioning rewrite (Phase 6 deliverables)

These are non-code deliverables that ship in the same PR cycle as the Overview tab.

### 14.1 `docs/capabilities.md` changes

| Deliverable | Where | What changes |
|---|---|---|
| New top-level *Persistent Agent Workspace* section | New entry near the top of `docs/capabilities.md` | Names the workspace as a first-class product capability. Composes Workspace UI, Memory, Files, Connections, Tools, Schedule, Run History, Continuity. |
| IEE intro reframe | Existing IEE entry | Lead with *"on-demand sandboxed compute that picks up where the last run left off"*, NOT *"Docker containers for browser automation"*. |
| New *Replaces / Consolidates* row for hosted-VM-per-agent platforms | `docs/capabilities.md § Replaces / Consolidates` | Addresses Manus / OpenClaw / equivalents directly. *"Persistent workspace, on-demand compute. Your agent remembers, continues, and only burns compute when work happens."* No anti-VM language; lead with what we have. |
| Always-on capability reframe | Existing entry | Reframed as schedule + workspace state, not idle compute. The 24/7 promise is delivered through schedulers + persistent identity, made visible by the Home Active Agents widget and the Schedule peek on Overview. |

### 14.2 Marketing-language audit

A sweep across customer-facing surfaces (sales decks, product copy, blog drafts) for any mention of *container*, *runtime*, *VM*, *scheduler*, *job*. Each replaced with workspace-language equivalents per the Rev 5 §10.1 language discipline. Engineering surfaces (run logs, IEE diagnostics, cost breakdowns) keep their precise terms.

This is operator-driven (Phase 6 build chunk surfaces the affected files; the actual edits happen outside the build PR).

### 14.3 Sales-conversation enablement

`docs/sales-conversation-vm-question.md` — single-paragraph internal note pivoting *"do you give the agent its own VM?"* to workspace + on-demand compute language without ever using *"we don't have VMs"*.

### 14.4 Acceptance criterion (brief §3)

A non-technical reviewer reads the updated `docs/capabilities.md` and answers *"what does Synthetos give my agent?"* in workspace-language without reaching for infrastructure language. A second reviewer locates the answer to *"how does this compare to Manus / OpenClaw?"* without finding any sentence beginning *"we don't have…"*.

### 14.5 Editorial discipline

All changes obey the existing `docs/capabilities.md § Editorial Rules` (vendor-neutral, marketing-ready, model-agnostic). `spec-conformance` and `pr-reviewer` enforce.

---

## 15. Coordination contracts

### 15.1 Phase 1 (auto-knowledge-retrieval) — what we consume

Owned by `tasks/builds/auto-knowledge-retrieval/` (separate branch). This spec consumes:

| What we need | From Phase 1 |
|---|---|
| Knowledge → Files tab, filterable by agent | Cloud-compute deep-links from Overview Files snapshot card and Run trace lineage chips |
| `retrieval.summary` events on `agent_execution_events` | Cloud-compute Knowledge-in-use card consumes the same data |
| `reference_document_data_sources` table | Cloud-compute reads only; never writes |
| `knowledge.files.deep_link` URL contract | Locked: `?agentId=...&runId=...&eventId=...&fileId=...&versionId=...` (extends Phase 1's likely shape with `runId/eventId/versionId`; Phase 1 must accept and resolve these query params) |
| `knowledge.files.*` lifecycle events | Emitted on `agent_execution_events` by Phase 1 across the full visibility-affecting trigger set: `promoted`, `deleted`, `archived`, `restored`, `metadata_changed`, `access_changed`, `merged`. Cloud-compute consumes via `agentOverviewAggregator` to invalidate the Files snapshot cache (§9.1). Phase 1 owns the *which-events-exist* decision: if Phase 1 does not implement restore in v1, the `restored` event simply never fires and the consumer loop is a no-op. The contract is conditional — *if* Phase 1 mutates a file in a visibility-affecting way, an event MUST fire on this channel. Phase 1 spec author must confirm the exact event names; if Phase 1 prefers different names, §9.1 + §15.1 update accordingly without behavioural change. |

**Graceful degradation if Phase 1 slips — split by surface:**

| This-spec surface | Hard-blocked by Phase 1? | Degradation mode |
|---|---|---|
| Overview Files snapshot card (Phase 2) | No | Reads raw `iee_artifacts` directly; surfaces filename + size + produced-at; no relevance signal; deep-link goes to a placeholder page until Phase 1 lands. |
| Overview Knowledge-in-use card (Phase 2) | No | Shows `Phase 1 surface pending` placeholder with link to existing Data sources tab; v1 ships without the relevance metadata until Phase 1 lands. |
| Overview Tools usage bands (Phase 2) | No | Computed locally from `agent_execution_events` tool-call events; independent of Phase 1. |
| **Run trace lineage chips (Phase 5)** | **Yes — hard-blocked.** | Phase 5 cannot ship until the Phase 1 deep-link query-parameter contract is locked AND Phase 1's Knowledge → Files tab can resolve the four-tuple. Without that contract, every chip click is a dead link. Phase 5 is **gated** on Phase 1 reaching the contract-lock milestone (not full Phase 1 ship — just contract finalisation). |

`feature-coordinator` MUST NOT begin Phase 5 build until Phase 1 has committed its deep-link query-parameter resolver and the contract is locked in `shared/types/runTraceLineage.ts`. This is the only hard cross-phase dependency.

### 15.2 Trust verification layer — visual + tab-strip coordination

Owned by `tasks/builds/trust-verification-layer/` (concurrent). Coordination:

| Trust stage | Surface | Coordination |
|---|---|---|
| Stage 1: runtime checks | Run trace | Trust adds Pass/Fail/Pending badge per step + summary strip + Correct affordance. Cloud-compute file chips appear under event content; Trust's badge appears next to event type label. **Both additive composition; no replacement.** |
| Stage 1: runtime checks | Inbox | Trust feeds runtime-check failures into Inbox. Cloud-compute Home widget surfaces them via the existing Inbox preview pattern; cloud-compute does not modify the Inbox surface itself. |
| Stage 2: scorecards + library + bench | Agent edit tab strip | **Adds Scorecards tab.** Final tab order: Overview, Configure, Behaviour, Personality, Skills, Scorecards, Data sources, Schedule, Budget, Runs. **Locked at 10 tabs.** Cloud-compute owns the Overview tab insertion; Trust owns the Scorecards tab insertion. |
| Stage 2: scorecards + library + bench | Govern surface | New Quality page as 4th Govern primitive. No conflict — Govern is workspace-level, this brief is per-agent. |
| Stage 2: scorecards + library + bench | Run trace | Trust adds quality-score chip in run summary or detail panel. Coexists with file chips. |
| Stage 3: correction-sourced auto-memory | Run trace | Inline Correct hover action per step. Coexists with file chips and Stage 1 badges. **Three additive features per event row.** |

**Run-trace event-row visual budget** (brief §11):
```
[seq] [type-dot] [type-label + Trust badge] [event content + cloud-compute file chips + Trust Correct hover] [event time]
```

PR-merge review confirms layout fit; no shared mutable state. Spec author should mock the worst-case row (failed runtime check + multiple file outputs + visible Correct affordance) before declaring integrated layout shippable.

### 15.3 Concurrent quality-verification work

The brief (§11) names AI agent quality verification as a separate branch. Coordination is minimal — both touch Run trace; no logical conflict. Run-trace event-row visual budget per above accommodates Trust's contributions; quality-verification work composes the same way.

### 15.4 What this spec explicitly does NOT do

To prevent ambiguity at merge time:
- Cloud compute does NOT add Pass/Fail badges to event rows. (Trust Stage 1)
- Cloud compute does NOT add a Correct hover action to event rows. (Trust Stage 3)
- Cloud compute does NOT add a Quality page or Scorecards tab. (Trust Stage 2)
- Cloud compute does NOT add quality-score chips to run summary. (Trust Stage 2)
- Cloud compute does NOT modify the Inbox surface itself. (existing Inbox + Trust Stage 1)
- Cloud compute does NOT modify the Knowledge page. (Phase 1)
- Cloud compute does NOT modify the Data Sources tab. (Phase 1)

---

## 16. Testing posture

Per `docs/spec-context.md`:
- `testing_posture: static_gates_primary`
- `runtime_tests: pure_function_only`
- `frontend_tests: none_for_now`
- `api_contract_tests: none_for_now`
- `e2e_tests_of_own_app: none_for_now`

### 16.1 Pure unit tests authored as part of this build

| Module | Test file | What it covers |
|---|---|---|
| `agentPresenceServicePure.ts` | `agentPresenceServicePure.test.ts` | Resolution-chain order; closed enum; degraded recovery semantics; replay-safety; clock-authority math; `(event_timestamp, event_id)` ordering tuple including same-timestamp tiebreak; monotonic-clock hysteresis (`process.hrtime.bigint()`-based) does not regress under simulated wall-clock jumps |
| `agentObservationServicePure.ts` | `agentObservationServicePure.test.ts` | Provenance enforcement; supersession chain; closed observation-type enum; DFS cycle guard (self-loop, 2-cycle, 3-cycle, depth-bound rejection) |
| `agentWorkingTimeServicePure.ts` | `agentWorkingTimeServicePure.test.ts` | Closed inclusion table from §7.5; reconciliation invariant; concurrent-run summing; bucket-split millisecond-sum invariant (single bucket, exact-boundary edge, multi-bucket span, year-long span drift bound); half-open interval rule; single-rounding-at-persistence rule |
| `orderHomePresenceSections.ts` | `orderHomePresenceSections.test.ts` | Section order, overflow rule, sub-section sorts, degraded float-up behaviour |
| `currentFocusValidator.ts` | `currentFocusValidator.test.ts` | Anti-fake-progress rule from §7.2 — rejects forbidden patterns; enforces concrete-anchor requirement |
| `ieeSessionServicePure.ts` | `ieeSessionServicePure.test.ts` | Idle-timeout decision; teardown reason classification; orphan-detection logic |

Tests are vitest (`expect()` API); single source of truth `references/test-gate-policy.md`.

### 16.2 No frontend / API-contract / E2E tests

These categories are in `convention_rejections` per `docs/spec-context.md`. No `useAgentPresence` hook tests; no SSE-channel integration tests; no Overview-page rendering tests. Verification is by manual operator pass against the mockups (Mockups 2/3/4/5) + the static gates.

### 16.3 Composition / integration tests

Deferred per `composition_tests: defer_until_stabilisation`. Cross-feature composition with Trust + Phase 1 happens at PR-merge review time, not via automated tests.

### 16.4 PR-review checklist additions for this build

These are spec contracts that `pr-reviewer` and `spec-conformance` enforce:
- New Overview surface added later: payload-impact note in PR + freshness-matrix row added (brief §5.5/§5.8 paired contracts).
- Closed enum changes (`AgentPresenceState`, `observation_type`, session `release_reason`) require spec amendment.
- Event-row layout (cloud-compute file chips + Trust badges + Correct hover) verified on the worst-case mock before merge.
- Mockup compliance: every Overview surface verified against Mockups 2/3/4 + Mockup 5 for run trace.
- §16.5 anti-optimistic invariant: review-time check for client-side state simulation patterns; any optimistic-update library use on presence state is a blocker.

### 16.5 Anti-optimistic UI synthesis (lint-style review check)

Reviewers check `client/src/hooks/useAgentPresence.ts` for any branch that writes presence state from a non-server source. Any optimistic-update library binding to presence state is a blocker. No automated lint rule in v1 — operator-driven review.

### 16.6 Worst-case profiling (manual)

Spec author profiles the *50-runs-today, 200-pinned-observations, 30-knowledge-entries-loaded* worst case before declaring §7.4 layout shippable. Output is a paragraph in `tasks/builds/agent-workspace/progress.md` Phase 2.

### 16.7 Migration safety

Per `docs/spec-context.md`: `migration_safety_tests: defer_until_live_data_exists`. New tables are empty at migration time; no backfill rehearsal needed. The down migration is provided for both 0288 and 0289; tested manually by running up-then-down on a clean dev DB.

---

## 17. Open questions for Phase 2

These need resolution before or during build; surfaced to Phase 2 (`feature-coordinator`).

1. **SSE final pick — RESOLVED.** §13.1 locks SSE. WebSocket is not a v1 alternative.
2. **Default-tab migration UX for existing users — RESOLVED.** Locked: per-user `users.default_agent_tab` column with global default `'overview'`. Existing users land on Overview by default. v1 ships READ-ONLY: the column exists and the AgentEditPage reads it on mount. The default-tab preference UI (and the corresponding `PATCH /api/users/me/preferences` write route) is **deferred to v1.1** so the spec's append-only / no-orphan-route discipline holds. The §11 idempotency / concurrency rows for `users.default_agent_tab` describe the future write path; no v1 code path exercises them.
3. **Idle-timeout default value.** Spec uses 300 seconds (5 minutes) per brief §7. Open: should it be configurable per agent? v1 = global default; v1.1 = per-agent override (deferred — see §18).
4. **Phase 1 deep-link query param contract finalisation.** Spec proposes `?agentId=...&runId=...&eventId=...&fileId=...&versionId=...`. Phase 1 spec author MUST confirm and lock before Phase 5 build begins. If Phase 1 prefers a different shape, Phase 5 changes accordingly.
5. **Session container handle lifecycle on container failure.** Spec sets `iee_sessions.status = 'failed'` and `release_reason = 'failed'`. Open: do we keep the `container_handle` for diagnostic purposes for some retention window, or null it on teardown? v1 keeps it for 24h post-teardown; v1.1 may extend.
6. **Worst-case Overview payload profiling.** Spec calls for the 50-runs/200-pinned/30-knowledge profile pass. Owner = Phase 2 builder + operator-driven verification.
7. **Activity feed canonical projection.** Spec reads activity feed directly from `agent_execution_events` filtered. If query latency is unacceptable at scale, a materialised projection with a 60-day retention may be needed; deferred unless profiling shows it's required.
8. **Sub-agent delegation cost roll-up read path.** Resolved in §1.1 G8 + §7.5 Reconciliation invariant. v1 = parent's Overview chart shows the parent agent's own Working Time only; sub-agents are charted on their own pages; the invoice's per-agent line reconciles 1:1 with the per-agent chart; the parent-run rollup is an invoice-presentation surface, not a chart. Phase 4 implementation reads from `agent_working_time_rollups` per-agent — no special parent-run aggregation in the chart path.
9. **Anti-fake-progress validator location.** Spec puts the rule at the focus-line summariser (server-side, before write). Alternative: validate at projection-write time in `agentPresenceService`. Practical implication: if the summariser produces forbidden copy, the projection writer needs a known-safe fallback. Phase 1 implementation locks this.
10. **Current-focus cache backend.** Open: does this repo already have a Redis-equivalent shared cache, or do we use process-local memory for the §6.7 ephemeral focus-snapshot store? Phase 3 (when the SSE publisher lands) confirms. Default for v1 is process-local memory if Redis is not already in use; this is acceptable because the cache is a 60s TTL on top of the canonical `agent_execution_events` data.
11. **Phase 1 file-lifecycle event names AND coverage.** §9.1 lists seven triggers (run terminal, promotion, supersession, deletion/archive, restore, metadata edit, permission/visibility change, merge) plus the `knowledge.files.*` event names. Phase 1 spec author MUST confirm both: (a) which of these mutations Phase 1 actually performs in v1, and (b) the exact event names emitted. If Phase 1 ships different names, §9.1 + §15.1 update without behavioural change — the visibility-affecting trigger categories are the contract; event names are coordination detail. If Phase 1 silently mutates a file without an event, that is a Phase 1 bug that surfaces here as a stale-snapshot defect.

---

## 18. Deferred items

Mandatory per spec-authoring checklist Section 7. Listed even when also out of scope per §1.2.

- **Workspace artifact store (Rev 5 §10.3).** Owned by Phase 1 (auto-knowledge-retrieval). Cloud compute consumes via deep-link. Reason: separation of ownership.
- **Per-agent Data Sources tab refresh.** Owned by Phase 1. Reason: same.
- **Per-agent memory editing surface.** Memory editing happens at workspace level on Knowledge page (Phase 1). Per-agent slice is read-only. Reason: avoid duplication; Phase 1's Data Sources tab is the editing surface.
- **Memory tab on Agent edit.** Phase 1 already exposes per-agent memory via the relevance signal on Data Sources; no separate tab in v1. Reason: tab-strip discipline (10-tab cap).
- **Dedicated Agent Runtime tier (Rev 5 §10.5).** Reserved for validated future demand. Reason: no demand signal yet.
- **Always-on compute** for any agent. Reason: violates no-idle-compute differentiator (brief §3 + Rev 5 §6.4).
- **Cross-task container reuse.** Sessions live for one task only. Reason: brief §7 invariant.
- **Live workspace mutation** (drag-and-drop add to memory). Phase 3 polish concern.
- **Active Session drill-in modal** as separate surface. Run trace already covers it.
- **Multi-agent shared workspaces.** Future work; distinct from per-agent embodiment.
- **Confidence surface** (qualitative bands like *Verified / Inferred / Assumed / Conflicted*). Breadcrumbs only — open observation enum + Trust judgement events anchor a future surface. No schema additions in v1.
- **Presence privacy redaction** (role-based redaction within tenant boundaries). Breadcrumbs only — channel topology + event schema leave the door open. No policy implementation in v1. Forbidden v1 assumptions: *all org members see all focus lines*, *every observation is universally readable within the workspace*, *the SSE channel topology is public per agent*.
- **`is_pinned` operator surface for observations.** Column exists in v1; pin/unpin UI ships in v1.1. Reason: surface scope discipline.
- **Per-agent override of session idle-timeout.** Global default 300s in v1; per-agent override in v1.1 (Open question 3).
- **Materialised activity-feed projection.** Spec reads activity feed directly from `agent_execution_events` filtered. If query latency is unacceptable at scale, a materialised projection with 60-day retention may be needed; deferred unless profiling shows it's required (Open question 7).
- **Self-narrating agents.** Brief §5.1 lists "the agent's own emitted current focus string" as a future capability (priority 2 in the focus resolution chain). v1 only uses priorities 1, 3, 4, 5 from the chain; priority 2 is reserved.
- **Section-collapse persistence** (per `frontend-design-principles.md` accessibility rules in brief §10). v1 ships Overview with all sections expanded; collapsible-with-persistence is deferred until operator feedback specifically asks.
- **Multi-node SSE fan-out broker.** v1 locks single-node publisher topology (§13.1.1). When the deployment goes horizontally scaled, a broker layer (Postgres `LISTEN`/`NOTIFY` or dedicated pub/sub) is required to fan presence events to subscribers on other nodes. Until then, cross-node clients reconcile via the shared projection table on reconnect. Promoting to multi-node requires a fresh spec amendment. Reason: pre-production posture; no demand signal yet.
- **`agent_presence_projections` rebuild job.** The rebuild *contract* is locked in §6.3 (chunk size, ordering invariant, checkpoint cadence, max batch size, per-agent quiesce). The rebuild job itself ships in v1.1 — v1 has no live data corruption to recover from, and the contract being locked is what protects future builders from a full-history-in-memory implementation. Reason: pre-production posture; no recovery scenario observed in v1.

---

## 19. Self-consistency pass result

Run on the entire spec immediately before submitting to `spec-reviewer`.

- Goals (§1.1 G1–G8) mapped to phases in §4 and to inventory in §5. Confirmed.
- Every "single source of truth" claim survives:
  - `agent_execution_events` is the canonical clock authority — referenced from §1.3, §7.5, §11.1, §13.5; all writes go through `agentExecutionEventService`.
  - `AgentPresenceState` is a single resolved value per agent — derived once in `agentPresenceService`, written to `agent_presence_projections`, read by every UI surface; UI never re-derives (§7.1, §13.6).
  - `agent_working_time_rollups` is the single source for the chart and the invoice — reconciliation invariant (§7.5 + §11.6).
  - `agent_observations.event_id` is the provenance anchor — every observation carries a concrete event id (§7.3).
- Goals ↔ Implementation match. G1 (Overview tab + ≤150KB payload) ↔ §4 Phase 2 + §7.4 endpoint contract. G4 (session per run) ↔ §6.2 UNIQUE constraint + §11.3 concurrency guard. G5 (file lineage tuple) ↔ §7.7 + §6.5.
- Non-functional claims match execution model:
  - <5s Status pill + Current focus ↔ SSE delivery model (§13).
  - ≤150KB payload ↔ lazy-load delegations (§7.4).
  - Reconciliation invariant ↔ both surfaces read same rollup table (§7.5).
- Phase dependency graph (§10) — forward-only, no backward references.
- Deferred items (§18) — exists, populated.
- Testing posture sanity check — only pure-function unit tests; aligned with `docs/spec-context.md`.
- Idempotency / retry / concurrency / terminal events (§11) — declared per write path.
- Unique-constraint → HTTP mapping (§11.5) — every constraint pinned.
- State machine (§12) — closed; valid + forbidden transitions enumerated; recovery semantics + replay rules pinned.
- Mockup compliance — Mockups 2/3/4 are the canonical visual reference for Overview tab; Mockup 1 for Home widget; Mockup 5 for run trace lineage. Spec designed TO mockups per brief Rev 10 lock.
- Brief invariants (§3 mapping table) — every load-bearing invariant from the brief is mapped to a spec section.
- File-inventory drift check (§5) — every file referenced in §4–§15 prose is in §5 inventory: `agent_presence_focus_snapshots` removed from prose because it is in-memory cache only (no schema entry needed); checked.

If any item flips during build, surface in `tasks/builds/agent-workspace/progress.md` and re-run this pass.

---
