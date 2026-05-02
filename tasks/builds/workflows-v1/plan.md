# Workflows V1 — Implementation Plan

_Build slug: `workflows-v1`_
_Spec: [`docs/workflows-dev-spec.md`](../../../docs/workflows-dev-spec.md) (1775 lines, 19 sections, finalised)_
_Brief: [`docs/workflows-dev-brief.md`](../../../docs/workflows-dev-brief.md) v2 (design intent — wins on conflict with spec)_
_Mockups: [`prototypes/workflows/`](../../../prototypes/workflows/index.html)_
_Classification: MAJOR — schema deltas, engine validator + state machine + runaway protection, real-time WebSocket coordination, three UI surfaces, orchestrator changes, permissions API, naming cleanup, migration plan._
_Spec effort estimate: ~12–16 weeks calendar (~59 engineer-days, parallelisable across 2–3 engineers)._

---

## Contents

1. [System invariants](#system-invariants)
2. [Model-collapse check](#model-collapse-check)
3. [Primitives-reuse search results](#primitives-reuse-search-results)
4. [Pre-existing violations to fix in Chunk 1](#pre-existing-violations-to-fix-in-chunk-1)
5. [Open questions blocking finalisation](#open-questions-blocking-finalisation)
6. [Architecture notes](#architecture-notes)
7. [Chunk overview](#chunk-overview)
8. [Per-chunk detail](#per-chunk-detail)
   - [Chunk 1 — Schema migration + RLS + pre-existing violation fix](#chunk-1--schema-migration--rls--pre-existing-violation-fix)
   - [Chunk 2 — Engine validator (four A's, branching, loops, nesting, isCritical)](#chunk-2--engine-validator)
   - [Chunk 3 — Per-task event log (sequence allocation + replay contract)](#chunk-3--per-task-event-log)
   - [Chunk 4 — Gate primitive (workflow_step_gates write path) + state machine](#chunk-4--gate-primitive--state-machine)
   - [Chunk 5 — Approval routing, pool resolution, isCritical synthesis, decision API hardening](#chunk-5--approval-routing--iscritical)
   - [Chunk 6 — Confidence chip + audit field write paths](#chunk-6--confidence--audit)
   - [Chunk 7 — Cost / wall-clock runaway protection (pause/resume/stop)](#chunk-7--cost--wall-clock-runaway-protection)
   - [Chunk 8 — Stall-and-notify (24h / 72h / 7d) + schedule version pinning](#chunk-8--stall-and-notify--schedule-pinning)
   - [Chunk 9 — Real-time WebSocket coordination (task rooms, replay, gap-detection)](#chunk-9--real-time-websocket-coordination)
   - [Chunk 10 — Permissions API (assignable users) + Teams CRUD UI](#chunk-10--permissions-api--teams-crud)
   - [Chunk 11 — Open task view UI (three-pane layout, Now/Plan/Files tabs, header)](#chunk-11--open-task-view-ui)
   - [Chunk 12 — Ask form runtime (form card primitive, submit/skip, autofill)](#chunk-12--ask-form-runtime)
   - [Chunk 13 — Files tab + diff renderer + per-hunk revert](#chunk-13--files-tab--diff-renderer)
   - [Chunk 14 — Studio canvas, four A's inspectors, publish flow, draft hydration](#chunk-14--studio-canvas--inspectors)
   - [Chunk 15 — Orchestrator changes (suggest-don't-decide, draft creation, milestone events, workflow.run.start skill)](#chunk-15--orchestrator-changes)
   - [Chunk 16 — Naming cleanup (Brief → Task) + workflow_drafts cleanup job](#chunk-16--naming-cleanup--cleanup-job)
9. [Risks and mitigations](#risks-and-mitigations)
10. [Deferred items routed to tasks/todo.md](#deferred-items-routed-to-taskstodomd)
11. [Spec coverage map (every spec section → chunk)](#spec-coverage-map)
12. [Self-consistency pass results](#self-consistency-pass-results)
13. [Executor notes](#executor-notes)

---

## System invariants

These invariants are non-negotiable. Every chunk in this plan respects them; CI gates verify them at merge time.

**Architecture rules (from `CLAUDE.md` / `architecture.md` / `DEVELOPMENT_GUIDELINES.md`):**

- Routes and `server/lib/**` files NEVER import `db` directly. All DB access goes through services.
- Every route handler uses `asyncHandler` — no manual try/catch.
- Service errors throw as `{ statusCode, message, errorCode? }` — never raw strings.
- Every route with `:subaccountId` calls `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming the ID; pass `subaccount.id` downstream.
- Tenant filtering: every read/write by ID also filters by `organisationId` explicitly using `req.orgId` (NOT `req.user.organisationId`).
- Soft-delete pattern: `deletedAt` column + `isNull(table.deletedAt)` filter on every read.
- Schema changes go through Drizzle migrations. New tenant tables ship full RLS in the same migration AND a `RLS_PROTECTED_TABLES` entry. `app.organisation_id` is the canonical session var.
- All terminal status writes flow through `assertValidTransition` (`shared/stateMachineGuards.ts`). Sites that have not yet adopted it emit `state_transition` log with `guarded: false`.
- Discriminated-union validators: adding a new event/step kind and updating the validator's allow-list happen in the same commit (§8.13).
- Idempotency keys on agent-runs / workflow-runs are keyed on the canonical entity ID, never on the variant of the action (§8.11).
- Race-claim ordering: persist state-claim first, verify, only then trigger external side effect (§8.10).
- All LLM calls go through `llmRouter` (§4 of guidelines). No direct provider adapter imports.
- Heartbeat changes preserve `heartbeatOffsetMinutes` minute-level precision.

**Spec-specific invariants pinned for this build:**

- **Stall-not-fail on Approval / Ask timeout.** Tasks waiting on a human gate do NOT auto-fail. They emit notifications at 24h / 72h / 7d to the requester. Recovery is operator-driven Stop or human action on the gate. (Spec §5.3, decision #2.)
- **Version-pin opt-in on schedules.** `schedules.pinned_template_version_id` defaults `null` ("next run uses newest"). When non-null, scheduled runs use that exact version regardless of newer published versions. (Spec §3.1, §5.4, decision #5.)
- **Last-write-wins on concurrent Studio edits.** No soft locks, no presence indicators. Publish modal shows a warning banner if the published version's `updated_at` changed since the user started editing; user clicks Publish-anyway or Cancel. (Spec §10.5, decision #8.)
- **Picker permission scoping.** `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users` returns differently shaped pools by caller role: org admin/manager sees org users + subaccount members; subaccount admin sees only subaccount members; subaccount member gets 403. (Spec §14.2, decision #9.)
- **No auto-commits from main session.** Per CLAUDE.md user prefs. Only review agents auto-commit. The user commits explicitly after reviewing.
- **Confidence is decoration, not authority.** `high` confidence does NOT skip Approval. Engine never short-circuits a gate based on confidence value. (Spec §6.4.)
- **`seen_payload` and `seen_confidence` are immutable.** Snapshotted at gate-creation; never regenerated from current state. (Spec §6.3.)
- **One terminal event per logical run.** Run completion writes one of `succeeded` / `failed` (with reason) / (no `partial` status in V1). Gates write one of `approved` / `rejected` / `submitted` / `skipped` per gate. Step run lifecycle is closed.
- **Run completion guard.** `running → succeeded` requires every step in a terminal status (`completed`, `failed`, `skipped`, `cancelled`) AND no `queued` / `awaiting_input` / `review_required` step remaining. Prevents phantom completion under fan-out. (Spec §7.5 run completion invariant.)
- **Per-task `task_sequence` is gap-free and atomic.** Allocation uses `FOR UPDATE` on a per-task counter row, in the same transaction as the event INSERT. If a non-retryable failure leaves a gap, the run transitions to `failed` with reason `event_log_corrupted`. (Spec §8.1.)
- **Gate eligibility is snapshotted at gate-open.** `workflow_step_gates.approver_pool_snapshot` is the source of truth for membership checks; never re-resolved from `approverGroup`/`submitterGroup` on the fly. The only V1 path to re-resolve is `POST /api/tasks/:taskId/gates/:gateId/refresh-pool` (admin-only). (Spec §5.1, §5.1.2.)
- **Single-decider idempotency on Approval.** UNIQUE `(gate_id, deciding_user_id)` on `workflow_step_reviews` makes double-clicks idempotent at user×gate granularity; 23505 → 200 idempotent-hit. The step transition uses `WHERE status = 'review_required'`; 0 rows → losing caller observes the winning decision. (Spec §5.1.1.)
- **Ask is single-submit / first-wins.** No `(run_id, step_id, user_id)` constraint; the step's status (`awaiting_input → submitted | skipped`) is the gate. 0 rows updated → 409 `already_submitted` returning the winning submitter. (Spec §11.4.1.)

---

## Model-collapse check

Per `CLAUDE.md`-aligned plan-mode rule.

**Three questions:**

1. *Does this feature decompose into ingest → extract → transform → render?* No. The work is durable transactional state machine (Drizzle migrations, RLS, optimistic-predicate UPDATEs, pg-boss scheduling), real-time WebSocket fan-out to three UI panes, multi-tenant permission enforcement on a permission-aware picker API, audit-grade snapshotting, and version-pinned scheduled dispatch.
2. *Is each step doing something a frontier multimodal model could do in a single call?* No. Schema deltas, RLS policies, FK constraints, idempotent CAS predicates, sequence-allocation with `FOR UPDATE`, pg-boss job scheduling, and permission middleware are not model-shaped operations.
3. *Can the whole pipeline collapse into one model call with a structured-output schema?* No.

**Collapsed-call alternative considered and rejected.**

The only LLM-shaped surfaces in this build are: (a) the orchestrator's "suggest-don't-decide" pattern detection (§13.1), (b) the orchestrator's draft-a-workflow intent recognition (§13.2), (c) the agent's file-edit detection in chat (§12.3), and (d) the confidence-chip heuristic (§6.1, ultimately a V2 calibrated model). Even those are decorations on a deterministic execution model, not the entire pipeline. The deterministic surface (engine, schema, gates, real-time fan-out, permissions) provides correctness guarantees (idempotency, audit trail, transactional consistency, RLS, replay) that a single model call cannot — and the spec explicitly names these as load-bearing properties (§8.5 latency budget, §6.4 "confidence is decoration not authority", §5.3 stall-not-fail).

**Decision: reject collapse. Proceed with the deterministic, multi-chunk decomposition below.** The spec's positioning (§3 "Workflows orchestrate. Automations integrate.") is incompatible with a single-model-call shape; a model call is one node, the orchestration layer is the substrate that gates, audits, replays, and routes around them.

---

## Primitives-reuse search results

Searched `server/db/schema/`, `server/services/`, `server/routes/`, `server/lib/`, `server/jobs/`, `server/websocket/`, `client/src/hooks/` for the closest existing primitive to every new addition the spec proposes.

### Existing primitives the build will EXTEND (not duplicate)

| Spec proposal | Existing primitive | How we extend |
|---|---|---|
| `is_critical`, `decision_reason`, `gate_id`, `publish_notes`, `cost_ceiling_cents`, `wall_clock_cap_seconds`, `effective_*`, `extension_count`, `pinned_template_version_id` (spec §3.1) | `workflow_runs`, `workflow_template_versions`, `workflow_step_reviews`, `scheduled_tasks` schema files at `server/db/schema/{workflowRuns,workflowTemplates,scheduledTasks}.ts` | Additive ALTER columns in one Drizzle migration; new fields default-safe so existing rows are untouched. |
| `task_id` + `task_sequence` on `agent_execution_events` (spec §3.1, §8.1) | `agent_execution_events` table + `agent_runs.next_event_seq` counter + `agentExecutionEventService.appendEvent` | Add `task_id`, `task_sequence` columns; add `tasks.next_event_seq` counter mirroring the per-run pattern; extend `appendEvent` to allocate per-task sequence in the same transaction (`FOR UPDATE` on a per-task row, same locking discipline). |
| WebSocket per-task room (spec §8.1) | `server/websocket/{index,rooms,emitters}.ts` already has `agent-run` rooms and `workflow-run` rooms with JWT auth, room scoping, replay-on-reconnect (`useSocketRoom` hook with `onReconnectSync`), envelope `{eventId, type, entityId, timestamp, payload}`, dedup LRU on the client | Add `task` room scope with `join:task` / `leave:task` listener (validated against task ownership). Add `emitTaskEvent(taskId, event, data)` wrapper. Extend `useSocketRoom` use-site for the open task view; the existing `onReconnectSync` callback gives us the gap-detection seam. |
| Workflow Studio drafts (spec §3.3 `workflow_drafts`, §10.6, §13.2) | `workflow_studio_sessions` table already exists with `id`, `createdByUserId`, `agentRunId`, `candidateFileContents`, `candidateValidationState`, `prUrl` | **Open question** — see [Open questions](#open-questions-blocking-finalisation) item 1. The existing table is shaped for Phase 1 GitHub-PR-driven Studio. The spec's `workflow_drafts` is shaped for the Phase-2 chat-orchestrator-drafts-then-author flow with `consumed_at` lifecycle. They DO overlap. The plan tentatively introduces `workflow_drafts` as a new table per the spec; the chunk that owns it (Chunk 14) re-evaluates whether to extend the existing one. |
| Teams CRUD UI (spec §16.2 #31) | `teams` + `team_members` tables exist with `organisationId`, `subaccountId`, `name`, `addedAt` | UI page only — no new schema. RLS already in place for both tables. |
| Approver / Submitter routing on Approval / Ask params (spec §3.2) | `workflow_step_runs.params`-equivalent JSON inside the step definition + `workflow_template_versions.definitionJson` | Embed `approverGroup` / `submitterGroup` / `quorum` / `submitterGroup` in `params` JSON inside `definitionJson` — no new column. |
| Engine validator extensions (spec §4) | `WorkflowTemplateService` (publish path) + the existing publish-time validators | Add new rules in the validator chain; reject deprecated user-facing names from fresh Studio publishes; accept legacy types from existing templates. |
| `isCritical` synthesis (spec §5.2) | `workflowEngineService.requireApproval` already wraps step transitions in supervised-mode | Extend the engine's per-step prelude to check `is_critical` and call `requireApproval` with `reviewKind: 'is_critical_synthesised'` and seed the new `workflow_step_gates` row. |
| Pause / Stop / Resume (spec §7.5) | `workflowRuns.status` enum already has `cancelling`, `cancelled`. `WorkflowRunService.cancelRun` exists | Add `paused` status; extend status enum; add `pauseRun`, `resumeRun`, `stopRun` service methods (`stopRun` aliases the existing cancel path with `reason: 'stopped_by_user'`). |
| Schedule version pinning (spec §5.4) | `agentScheduleService` reads schedule rows and dispatches | Honour `schedules.pinned_template_version_id` if non-null in the dispatch path. |
| Stall-and-notify scheduling (spec §5.3) | `pg-boss` worker registration via `createWorker` and `getJobConfig` patterns | Schedule three `pg-boss` jobs at gate-open (24h, 72h, 7d offsets); cancel on gate-resolve. Reuse the existing notification surface (review-queue / sidebar count + email opt-in). |
| `workflow_drafts` cleanup job (spec §16.3 #35a) | Existing pg-boss cleanup job pattern (e.g., `agentRunCleanupJob`, `securityEventsCleanupJob`, `priorityFeedCleanupJob`) | New job mirrors `priorityFeedCleanupJob.ts` shape. |
| Permission scope helpers (spec §14) | `req.user.role`, `requireOrgPermission`, `requireSubaccountPermission`, the existing role enum | New `assignableUsersService.ts` with role-aware pool resolution; reuses existing role middleware. |
| `workflow.run.start` skill (spec §13.4) | `server/config/actionRegistry.ts` + `server/services/skillExecutor.ts` SKILL_HANDLERS map | Single new entry in both places (DEVELOPMENT_GUIDELINES §8.23 — register in both atomically). |
| Conversational file editing (spec §12.3) | `referenceDocuments` / `executionFiles` schema for file content + version metadata; existing chat-triage classifier | No new schema; extend the chat-triage classifier to detect file-edit intent; agent emits a new file version. |
| Per-hunk revert (spec §12.4) | Existing version table + diff computation at render time | New endpoint + a deterministic diff algorithm (line-level for documents, row-level for spreadsheets); concurrency guard via current-version check. |
| State machine guards | `shared/stateMachineGuards.ts` `assertValidTransition` (per DEVELOPMENT_GUIDELINES §8.18) | Every new terminal-status write (`paused`, `running` on resume, `failed` with `stopped_by_user`, gate `resolved_at`, `submitted`, `skipped`) flows through `assertValidTransition`. |
| Three system templates (spec §1) | `event-creation.workflow.ts`, `weekly-digest.workflow.ts`, `intelligence-briefing.workflow.ts` | Unchanged. Validator accepts their legacy engine type names. |

### New primitives that genuinely need to exist

| New primitive | Why reuse and extension are both insufficient |
|---|---|
| `workflow_step_gates` (spec §3.3) | Spec requires a per-step / per-run row holding the gate-level snapshot fields (`seen_payload`, `seen_confidence`, `approver_pool_snapshot`, `is_critical_synthesised`, `gate_kind`, `resolved_at`). Cannot live on `workflow_step_reviews` because that's per-decider — multi-approver quorum would fragment the snapshot. Cannot live on `workflow_step_runs.outputJson` because the snapshot semantics (immutable at gate-open, audit-bearing) are different from step outputs. The new row aggregates per-decider `workflow_step_reviews` rows by FK. |
| `workflow_drafts` (tentative, see open question 1) | If the open question resolves toward "extend `workflow_studio_sessions`", drop this table. Spec assumes a new table. |
| Per-task `next_event_seq` counter (column on `tasks`, mirrors `agent_runs.next_event_seq`) | Existing per-run sequence is too narrow when a workflow-fired task spawns multiple agent runs. The spec explicitly extends to per-task scope (§8.1 "the existing per-run sequence is preserved for any consumer that already depends on it"). Adding a per-task counter is the minimal extension. |

### What the build will NOT add (re-using existing primitive directly)

- No new chat surface — Approval / Ask / Pause cards land in the existing chat panel via the form-card primitive.
- No new file storage — version-diff is computed at render time from existing version rows.
- No new permission set or role — the spec's roles map onto the existing `org_admin` / `org_manager` / `subaccount_admin` / `subaccount_member` enum.
- No new orchestrator — `orchestratorFromTaskJob` is extended.
- No new pg-boss queue topology — stall jobs and cleanup jobs reuse `getPgBoss()` + `createWorker` + `getJobConfig` patterns.
- No new prompt / cache partition — confidence heuristic is plain SQL aggregation, not LLM-routed.

---

## Pre-existing violations to fix in Chunk 1

These are violations of architecture rules in code that this build directly extends. Fixing them in Chunk 1 keeps the new work clean.

1. **Approval-decision route does not enforce approver pool membership.**
   - File: `server/routes/workflowRuns.ts` line 229–258 (`POST /api/workflow-runs/:runId/steps/:stepRunId/approve`).
   - Issue: route gates only on `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)`. Any user with that org permission can decide any approval — exactly the bug the spec calls out at §5.1: *"this fixes a real bug where today any authenticated user can decide on any approval."*
   - Fix: add a pool-membership check against `workflow_step_gates.approver_pool_snapshot` before delegating to `WorkflowRunService.decideApproval`. 403 with `{ statusCode: 403, message: 'You are not in the approver pool for this gate', errorCode: 'not_in_approver_pool' }` if the caller's id is not in the snapshot. (Spec §5.1.1 maps this code to a 403 surface in the UI.)
   - Justification: any new gate-routing code we ship will inherit this hole if not closed first; the new `workflow_step_gates` write path already exists by the time the route runs, so the check is cheap.

2. **`workflowStepReviewService.requireApproval` writes step status without `assertValidTransition`.**
   - File: `server/services/workflowStepReviewService.ts` line 60–68.
   - Issue: raw `UPDATE workflowStepRuns SET status = 'awaiting_approval'` without flowing through `shared/stateMachineGuards.ts` `assertValidTransition`. DEVELOPMENT_GUIDELINES §8.18 requires every terminal-status write to call this guard or emit a `state_transition` log with `guarded: false`. Currently does neither.
   - Fix: wrap the UPDATE in `assertValidTransition('workflow_step_run', stepRun.status, 'awaiting_approval')` (extend the guard's table-name registry if missing). Catch `InvalidTransitionError` and convert to a service-shape error.
   - Justification: every new gate-creation path in this build adds more callers to this code; one site, one fix.

3. **`workflowRuns.status` does not include `paused`** — a feature gap, not a violation per se. Listed here because the migration in Chunk 1 must extend the enum (TS type union + Postgres CHECK if any) before Chunk 7 can write to it. Without this in Chunk 1, Chunk 7 has nowhere to land the status.

---

## Open questions blocking finalisation

These are questions the planner could not resolve from spec + brief + codebase. They block plan finalisation; the caller should take them to the user.

1. **`workflow_drafts` vs extending `workflow_studio_sessions`.** The codebase already has `workflow_studio_sessions` (`server/db/schema/workflowRuns.ts` lines 214–238) shaped for the Phase 1 GitHub-PR-authoring Studio with `candidateFileContents` + `candidateValidationState` + `prUrl`. The spec §3.3 introduces a new `workflow_drafts` table for the chat-orchestrator-drafts-then-author flow with `payload jsonb` + `consumed_at` + `(subaccount_id, session_id) UNIQUE`. The two are similar in intent but different in shape. Options:
   - **(a)** Add `workflow_drafts` as a new table per the spec. Minor duplication of session-scoped Studio state; clear separation of concerns (orchestrator drafts vs Studio review sessions).
   - **(b)** Extend `workflow_studio_sessions` with `payload`, `consumed_at`, `subaccountId`, `sessionId` (UNIQUE on `(subaccountId, sessionId)`), and reuse for both flows.
   - Recommendation if user does not weigh in: **(a)**, per spec literal. The shapes differ enough (the orchestrator's `payload` is a draft step list; the Studio session's `candidateFileContents` is a serialized template file destined for GitHub) that conflating them risks data-shape ambiguity at read time. Plan currently assumes (a).

2. **Confidence chip threshold cut-points (spec §19.1 #A).** Spec defers to architect-time. The plan in Chunk 6 ships the heuristic + `signals[]` capture but does NOT lock final thresholds — V1 ships with a placeholder mapping (`high` if ≥ 5 similar approved-without-mod runs, `low` if ≤ 0 or any clamp condition fires, `medium` otherwise). Final tuning lands as a one-line config change after 100+ internal Approval cards are reviewed. Caller may want a different default.

3. **Cost-cap extension granularity (spec §19.2 #G).** Spec defers to architect. Plan in Chunk 7 ships a single canned extension button: "Continue for another 30 minutes / $2.50". Cap of 2 extensions per run. Operator clicks once → +30min and +$2.50; second click → another +30min and +$2.50; third click disabled with Stop only. Caller may want different granularity.

4. **Per-task event log retention TTL (spec §8.1 "minimum 24 hours recommended").** Plan in Chunk 3 picks 7 days as the retention window — long enough that a session reconnect after a long lunch break does not gap, short enough that the events table doesn't grow unbounded for tasks that ran weeks ago. Caller may want a different default.

5. **Multi-select renderer threshold (spec §19.2 #I).** Plan in Chunk 12 ships the checkbox list for ≤ 7 options, Combobox for ≥ 8 — matches spec default.

6. **`is_critical` target table (spec §19.2 #F).** Plan in Chunk 1 lands `is_critical: boolean` inside the `params` JSON of step definitions in `workflow_template_versions.definitionJson`. No schema column. Validator + engine read from `params.is_critical`. Justification: step definitions are already schema-less JSON per the existing engine pattern; adding a top-level column on `workflow_template_steps` (a table that may not exist by that name) creates a new query surface for one boolean. JSON path is consistent with how `approverGroup` / `submitterGroup` / `quorum` land in §3.2. Caller may want a different shape.

---

## Architecture notes

### Key decisions

**Decision 1 — Build on the existing workflow engine, do not fork.** The codebase already has `workflowRuns`, `workflowStepRuns`, `workflowStepReviews`, `workflowEngineService`, the pg-boss `workflow-run-tick` queue, the watchdog sweep, the `workflow-run` WebSocket room, and three system templates (per spec §1). The plan extends each in place. Rejected: introducing a parallel "tasks-v2" engine. Reason: the spec explicitly says (§1, §3.5) the engine and three system templates already exist; a fork would duplicate the state machine and create a split-brain window.

**Decision 2 — Per-task `task_sequence` extends the existing per-run pattern.** Spec §8.1 names the existing `agentExecutionEventService` per-run claim pattern as the reference implementation. We add `task_id` + `task_sequence` to `agent_execution_events`, a `tasks.next_event_seq` counter, and the per-task allocation runs in the same transaction as the row INSERT under `FOR UPDATE`. Rejected: a sharded counter (deferred to V2 per spec §8.1). Reason: pre-production load does not warrant the complexity.

**Decision 3 — `workflow_step_gates` is a new table, not a column on `workflow_step_runs`.** The gate-level snapshot (`seen_payload`, `seen_confidence`, `approver_pool_snapshot`, `is_critical_synthesised`) lives once per gate. Multi-approver quorum needs many `workflow_step_reviews` rows but exactly one snapshot. Rejected: putting the snapshot on the step run's `outputJson`. Reason: outputJson is the step's run-time output, not gate-time audit; mixing them creates ambiguity at read time.

**Decision 4 — Reuse existing WebSocket layer, add a `task` room scope.** The existing layer at `server/websocket/{index,rooms,emitters}.ts` already has JWT auth, room scoping, an envelope shape (`eventId`, `type`, `entityId`, `timestamp`, `payload`), reconnect-with-replay via the client's `useSocketRoom(onReconnectSync)`, and a per-event-id LRU dedup. The spec's "one WebSocket per open task" rule maps to a new `task:<taskId>` room. The single new emitter `emitTaskExecutionEvent(taskId, envelope)` mirrors the existing `emitAgentExecutionEvent` shape so the per-task event log integrates with zero changes to the client envelope contract. Rejected: a new WebSocket layer. Reason: the existing one already solves authentication, room isolation, and reconnect-replay for `agent-run` and `workflow-run` rooms.

**Decision 5 — Stall-and-notify uses pg-boss delayed jobs, not a polling loop.** Three jobs per gate (24h, 72h, 7d) scheduled at gate-open via `getPgBoss().send(...)` with `startAfter`. Cancelled at gate-resolve via the pg-boss cancellation API. Rejected: a periodic `agentScheduleService` poll. Reason: pg-boss already has delayed-job primitives; a poll loop is the wrong shape and cannot be cancelled cleanly.

**Decision 6 — Resume vs Retry separation.** Per spec §7.5, resume continues from the next pending step; it does NOT re-execute completed steps and does NOT trigger step-level retries. Step retries remain local to each step's `retryPolicy`. The resume API is a state transition `paused → running` plus an extension write; the engine's existing tick/dispatch loop handles dispatching the next step. Rejected: a unified "resume-and-retry" path. Reason: spec is explicit about the separation; conflating them creates ambiguity about whether resume re-runs failed steps.

**Decision 7 — Per-pane subscription is client-side filtering, not server-side per-pane rooms.** The server emits one event stream per task room; each pane (Chat, Activity, Now, Plan, Files, Thinking) filters by `kind`. Rejected: server-side per-pane rooms. Reason: complicates auth, doubles the room count for no gain — clients receive the same envelope and filter cheaply.

**Decision 8 — Optimistic rendering uses the existing dedup LRU.** The client's `useSocketRoom` already dedups by `eventId`. Optimistic updates reconcile against the server's authoritative event when it arrives (same `eventId`); rollback path uses the existing error-toast surface plus a re-fetch from the REST snapshot endpoint via the `onReconnectSync` seam. No new client primitive. Rejected: a new optimistic-state-management library. Reason: the project's existing pattern (one source-of-truth event stream, dedup by id, reconcile on arrival) handles it.

**Decision 9 — Permission-aware picker via a new endpoint, not via a generic /users endpoint.** Spec §14.2 defines `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users`. The shape (org-grouped vs flat list, per role) is specific to picker UX. Rejected: extending `/api/users` with query params. Reason: a single-purpose endpoint makes the permission scoping logic obvious at the boundary; the response shape (with `is_org_user` / `is_subaccount_member` flags) is picker-specific.

**Decision 10 — Naming cleanup is UI-only, schema unchanged.** Spec §15. `tasks` table stays, `tasks.brief` column stays. The rename is sidebar / nav / page title / breadcrumb / modal copy + a `/briefs/:id → /tasks/:id` redirect. Rejected: schema rename. Reason: any schema-rename would touch every consumer of `tasks.brief`; cost-benefit does not justify it for a pure UI vocabulary change.

### Patterns applied

- **Single responsibility** — every chunk has one boundary it owns. Schema chunk owns migrations; engine chunks own state machine; UI chunks own rendering; permissions chunk owns the picker API.
- **Dependency inversion** — routes call services, services call DB; nothing skips layers. Per architecture rule.
- **Pure-function isolation** — the gate snapshot, confidence heuristic, and pause/resume state-transition logic each get a `*Pure.ts` module with no DB I/O, paired with an impure wrapper. Keeps testing tight (per `docs/spec-context.md` `runtime_tests: pure_function_only`).
- **Mutation-path skeleton (KNOWLEDGE.md 2026-04-22 entry)** — Approval write, Ask submit, Pause/Resume/Stop, file revert each follow Pure → Validate → Guard → Write → Signal pattern.
- **Discriminated-union validators in lockstep with new event kinds** — every new `kind` added to the WebSocket event taxonomy (§8.2) lands in the validator allow-list in the same commit (§8.13).
- **Observability log at every deferred enforcement boundary** — when a guard isn't yet in place (e.g., the legacy step-status writes that haven't migrated to `assertValidTransition`), the boundary still emits `state_transition` with `guarded: false` per §8.20.

### Patterns explicitly NOT applied

- **No event sourcing.** `agent_execution_events` is an append-only log for replay-on-reconnect; the source-of-truth is still `workflow_runs` / `workflow_step_runs` / `workflow_step_gates`. Events are the projection, not the substrate.
- **No CQRS.** Reads and writes share the same DB; there is no read-side projection store.
- **No microservices split.** All new code lands in the existing Express monolith.
- **No new abstraction over pg-boss.** The pattern is `getPgBoss().send(queueName, payload, options)` plus `createWorker(queueName, handler)`. Reused as-is.

---

## Chunk overview

Each chunk is independently testable, ordered for forward-only dependencies. A solo Sonnet session should complete each in one focused build cycle.

| # | Chunk title | Spec sections owned | Depends on | Effort estimate |
|---|---|---|---|---|
| 1 | Schema migration + RLS + pre-existing violation fix | §3 (full), §15 (route redirect setup), §18.1 | none | ~2 days |
| 2 | Engine validator (four A's, branching, loops, nesting, isCritical) | §4.1, §4.2, §4.3, §4.4, §4.5, §4.6, §4.7, §4.8 | 1 | ~1.5 days |
| 3 | Per-task event log (sequence allocation + replay contract) | §8.1 (allocation invariant + replay contract), §3.1 (`task_id`, `task_sequence`) | 1 | ~1.5 days |
| 4 | Gate primitive (workflow_step_gates write path) + state machine | §3.3 (`workflow_step_gates`), §5.1.1 (Approval write contracts), §11.4.1 (Ask write contracts) | 1, 2 | ~2 days |
| 5 | Approval routing, pool resolution, isCritical synthesis, decision API hardening | §5.1, §5.1.2 (`/refresh-pool`), §5.2 (isCritical), §5.4, plus the pre-existing-violation fix on the decision route | 4 | ~2 days |
| 6 | Confidence chip + audit field write paths | §6.1, §6.2, §6.3, §6.4, §6.5 | 4 | ~1.5 days |
| 7 | Cost / wall-clock runaway protection (pause/resume/stop) | §3.1 (`effective_*`, `extension_count`), §7 (full) | 1, 4 | ~2 days |
| 8 | Stall-and-notify (24h / 72h / 7d) + schedule version pinning | §5.3, §3.1 (`pinned_template_version_id`), §5.4 (schedule dispatch) | 4 | ~1.5 days |
| 9 | Real-time WebSocket coordination (task rooms, replay, gap-detection) | §8 (full) | 3 | ~3 days |
| 10 | Permissions API (assignable users) + Teams CRUD UI | §14, §16.2 #31 | 1 | ~2 days |
| 11 | Open task view UI (three-pane layout, Now/Plan/Files tabs, header) | §9 (full), §15 (Brief → Task UI) | 9, 10 | ~5 days |
| 12 | Ask form runtime (form card primitive, submit/skip, autofill) | §3.2 (Ask params shape), §11 (full) | 4, 9, 11 | ~3 days |
| 13 | Files tab + diff renderer + per-hunk revert | §12 (full) | 9, 11 | ~3 days |
| 14 | Studio canvas, four A's inspectors, publish flow, draft hydration | §3.3 (`workflow_drafts` if Open Q1 stays at (a)), §10 (full) | 2, 10 | ~7 days |
| 15 | Orchestrator changes (suggest-don't-decide, draft creation, milestone events, workflow.run.start skill) | §13 (full), §16.3 (full) | 9, 14 | ~3 days |
| 16 | Naming cleanup (Brief → Task) + workflow_drafts cleanup job | §15 (full), §16.3 #35a, §18 (final migration polish + telemetry registry entries) | 1, 11, 14 | ~1 day |

**Total: ~40 engineer-days of focused work.** Lower than the spec's ~59-day estimate because primitives reuse (existing engine, WebSocket layer, schedule service, queue infrastructure) shaves time off engine + real-time chunks. UI chunks remain the dominant cost.

**Chunk dependency graph (forward-only, no cycles):**

```
1 (schema)
├── 2 (validator)
├── 3 (per-task events)
│   └── 9 (websocket)
│       ├── 11 (open task UI)
│       │   ├── 12 (Ask runtime)
│       │   ├── 13 (Files + diff)
│       │   └── 16 (naming cleanup)
│       └── 15 (orchestrator)
│           └── (depends on 14 too)
├── 4 (gates)
│   ├── 5 (approvals)
│   ├── 6 (confidence + audit)
│   ├── 7 (pause/stop/resume)
│   └── 8 (stall-and-notify + pinning)
└── 10 (permissions + teams CRUD)
    ├── 11 (open task UI)
    └── 14 (Studio)
```

**Parallelisation hints (for `feature-coordinator` if multi-engineer):** chunks 2, 3, 4, 10 can ship in parallel after 1 lands. Chunks 5, 6, 7, 8 can ship in parallel after 4 lands. Chunks 11, 14 require 9 and 10. Chunks 12, 13, 15, 16 are post-11/14.

---

## Per-chunk detail

### Chunk 1 — Schema migration + RLS + pre-existing violation fix

**Spec sections owned:** §3 (full), §15 (route redirect setup deferred to Chunk 16; only the schema unchanged-ness asserted here), §18.1.

**Scope.** All additive schema deltas in one Drizzle migration. RLS policies for the two new tenant tables. Pre-existing violation #1 (approval pool-membership check) and #2 (`assertValidTransition` on step-status writes) fixed in the same chunk. Status enum extended to include `paused` so Chunk 7 has a target.

**Out of scope for this chunk.** Engine logic for the new fields (chunks 2, 4, 5, 6, 7, 8). Studio / UI consumption (chunks 11, 14). Backfill of `effective_*` on completed runs (one-time admin script, deferred to Chunk 16).

**Files to create:**

- `migrations/<NNNN>_workflows_v1_additive_schema.sql` — single migration. Placeholder NNNN renamed at merge time per `DEVELOPMENT_GUIDELINES.md` §6.2. Header comment cites spec §3.1 + §3.3.
- `server/db/schema/workflowStepGates.ts` — new schema file. Follows `workflowRuns.ts` shape (imports schema only).
- `server/db/schema/workflowDrafts.ts` — new schema file (assuming Open Question 1 resolves to (a); revisit if (b)).
- `shared/types/workflowStepGate.ts` — `seen_payload`, `seen_confidence`, `approver_pool_snapshot` types extracted to `shared/types/` per `DEVELOPMENT_GUIDELINES.md` §3 (types crossing schema/service boundary live in `shared/types/`).

**Files to modify:**

- `server/db/schema/workflowRuns.ts` — add `effective_cost_ceiling_cents`, `effective_wall_clock_cap_seconds`, `extension_count`. Extend `WorkflowRunStatus` union with `paused` (insert between `running` and `failed`). Extend `workflowStepReviews` with `gateId` (FK), `decisionReason`. Extend `workflowStepReviews` UNIQUE to `(gate_id, deciding_user_id)` (replaces the prior plan of `(workflow_run_id, step_id, deciding_user_id)`).
- `server/db/schema/workflowTemplates.ts` — add `cost_ceiling_cents` and `wall_clock_cap_seconds` on the *org* `workflow_templates` table (not on the version). Add `publish_notes` on `workflow_template_versions`.
- `server/db/schema/scheduledTasks.ts` — add `pinned_template_version_id uuid NULL` (FK to `workflow_template_versions.id`). Note: `scheduledTasks` is the existing schedule table; spec §3.1 names "schedules" as the abstract concept — architect verifies the exact table at chunk-time. If a separate `schedules` table exists, add the column there instead.
- `server/db/schema/agentExecutionEvents.ts` — add `taskId uuid NULL` (FK to `tasks.id`), `taskSequence bigint NULL`. Add UNIQUE INDEX `(task_id, task_sequence)` partial WHERE `task_id IS NOT NULL` (legacy rows have NULL; the unique constraint applies only to new rows).
- `server/db/schema/tasks.ts` — add `nextEventSeq integer NOT NULL DEFAULT 0` mirroring `agent_runs.next_event_seq`.
- `server/db/schema/index.ts` — re-export `workflowStepGates`, `workflowDrafts`.
- `server/config/rlsProtectedTables.ts` — add entries for `workflow_step_gates` and `workflow_drafts` with canonical org-isolation policy reference. Update `policyMigration` to point at the new migration filename.
- `server/routes/workflowRuns.ts` — add pool-membership check on `POST /api/workflow-runs/:runId/steps/:stepRunId/approve` per pre-existing violation #1.
- `server/services/workflowStepReviewService.ts` — wrap the step-status UPDATE in `assertValidTransition` per pre-existing violation #2.
- `shared/stateMachineGuards.ts` — extend the `workflow_run` machine with `paused` status; add `workflow_step_run` machine if not yet registered. Spec valid transitions: `running → paused`, `paused → running`, `running → failed`, `paused → failed`. Forbidden: `failed → *`, `succeeded → *`.

**Migration shape (additive only):**

```sql
-- File header
-- Workflows V1 additive schema (spec docs/workflows-dev-spec.md §3, §18.1)
-- All columns default-safe. RLS for the two new tables in same migration.
-- @scope: this migration is partially baselined — see RLS_PROTECTED_TABLES entries.

-- ── Step definition / params (no column add — `is_critical` lives in JSON) ──
-- (no DDL — `is_critical: boolean` lands in workflow_template_versions.definition_json[steps][i].params)

-- ── workflow_step_reviews ──
ALTER TABLE workflow_step_reviews
  ADD COLUMN gate_id uuid REFERENCES workflow_step_gates(id),
  ADD COLUMN decision_reason text;
-- New UNIQUE (gate_id, deciding_user_id) — partial WHERE deciding_user_id IS NOT NULL
CREATE UNIQUE INDEX workflow_step_reviews_gate_user_uniq_idx
  ON workflow_step_reviews (gate_id, decided_by_user_id)
  WHERE decided_by_user_id IS NOT NULL;

-- ── workflow_template_versions ──
ALTER TABLE workflow_template_versions
  ADD COLUMN publish_notes text;

-- ── workflow_templates (org templates) ──
ALTER TABLE workflow_templates
  ADD COLUMN cost_ceiling_cents integer NOT NULL DEFAULT 500,
  ADD COLUMN wall_clock_cap_seconds integer NOT NULL DEFAULT 3600;

-- ── workflow_runs ──
ALTER TYPE workflow_run_status_enum ADD VALUE IF NOT EXISTS 'paused';   -- if enum is a Postgres enum; if it's a text column with TS union, no DDL needed
ALTER TABLE workflow_runs
  ADD COLUMN effective_cost_ceiling_cents integer,
  ADD COLUMN effective_wall_clock_cap_seconds integer,
  ADD COLUMN extension_count integer NOT NULL DEFAULT 0;

-- ── scheduled_tasks (or `schedules` if separate) ──
ALTER TABLE scheduled_tasks
  ADD COLUMN pinned_template_version_id uuid REFERENCES workflow_template_versions(id);
CREATE INDEX scheduled_tasks_pinned_template_version_idx
  ON scheduled_tasks (pinned_template_version_id)
  WHERE pinned_template_version_id IS NOT NULL;

-- ── agent_execution_events ──
ALTER TABLE agent_execution_events
  ADD COLUMN task_id uuid REFERENCES tasks(id),
  ADD COLUMN task_sequence bigint;
CREATE UNIQUE INDEX agent_execution_events_task_seq_idx
  ON agent_execution_events (task_id, task_sequence)
  WHERE task_id IS NOT NULL;

-- ── tasks ──
ALTER TABLE tasks
  ADD COLUMN next_event_seq integer NOT NULL DEFAULT 0;

-- ── workflow_step_gates (new) ──
CREATE TABLE workflow_step_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  gate_kind text NOT NULL,                                                -- 'approval' | 'ask'
  seen_payload jsonb,
  seen_confidence jsonb,
  approver_pool_snapshot jsonb,
  is_critical_synthesised boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  organisation_id uuid NOT NULL REFERENCES organisations(id)              -- for RLS
);
CREATE UNIQUE INDEX workflow_step_gates_run_step_uniq_idx
  ON workflow_step_gates (workflow_run_id, step_id);
CREATE INDEX workflow_step_gates_unresolved_idx
  ON workflow_step_gates (resolved_at)
  WHERE resolved_at IS NULL;
-- Canonical RLS policy
ALTER TABLE workflow_step_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_step_gates_isolation ON workflow_step_gates
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

-- ── workflow_drafts (new) ──
CREATE TABLE workflow_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid NOT NULL REFERENCES subaccounts(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE UNIQUE INDEX workflow_drafts_subaccount_session_uniq_idx
  ON workflow_drafts (subaccount_id, session_id);
CREATE INDEX workflow_drafts_unconsumed_idx
  ON workflow_drafts (consumed_at, created_at)
  WHERE consumed_at IS NULL;
ALTER TABLE workflow_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_drafts_isolation ON workflow_drafts
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

**Contracts pinned in this chunk:**

- `WorkflowRunStatus` (TS) — extended with `'paused'`. Sites consuming the union (e.g., `runStatus.ts`, route handlers, UI badges) compile-error if they don't handle the new value — caught by `npm run typecheck`.
- `WorkflowStepGate` (TS) — derived from `workflow_step_gates` schema. `gateKind: 'approval' | 'ask'`. Source of truth for `gate.kind` everywhere downstream.
- `WorkflowDraft` (TS) — `payload jsonb` typed loosely; the orchestrator-side draft shape lives in `shared/types/workflowDraftPayload.ts` (Chunk 15 owns the precise shape).
- `seenPayload`, `seenConfidence`, `approverPoolSnapshot` — typed in `shared/types/workflowStepGate.ts` per the spec §6.2.1, §6.3 shapes.

**Error handling:**

- Migration failure (e.g., FK violation if a stale `subaccount_id` references a deleted subaccount): not expected since spec §3 is additive on existing-data tables; migration runs against a clean schema. If FK fails, the migration aborts and the deploy stops — standard Drizzle migration behaviour.
- RLS policy creation failure: same — migration aborts.
- Pool-membership 403: `{ statusCode: 403, message: 'You are not in the approver pool for this gate', errorCode: 'not_in_approver_pool' }`. The route handler returns this before calling `WorkflowRunService.decideApproval`.
- `assertValidTransition` failure in `workflowStepReviewService.requireApproval`: `{ statusCode: 409, message: 'Step is not in a state that can be transitioned to awaiting_approval', errorCode: 'invalid_step_transition', currentStatus, attemptedStatus }`. The pre-existing service path returns this before the DB write.

**Test considerations:**

- Targeted unit test: `server/db/schema/__tests__/workflowsV1Schema.test.ts` (or `.Pure.test.ts` if it tests pure helpers only) — verifies the Drizzle schema files compile, types resolve, and the `WorkflowRunStatus` union now includes `'paused'`.
- Targeted unit test: `server/services/__tests__/workflowApprovalPoolMembershipPure.test.ts` — pure helper extracted from the route's pool-membership check; tests the `(approverPoolSnapshot[], userId) → boolean` resolver under several inputs (in pool, not in pool, snapshot is null, user is org admin override). Pure module name `workflowApprovalPoolPure.ts`.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify the migration file shape matches the schema deltas.
- `npm run build:server`
- `npx tsx server/services/__tests__/workflowApprovalPoolMembershipPure.test.ts`

**Acceptance criteria:**

- Migration file lints, typechecks, runs against a clean database without error.
- `workflow_step_gates` and `workflow_drafts` rows enforce RLS — a query without `app.organisation_id` set returns zero rows. (Tested as part of the existing RLS gate suite at CI time.)
- `workflowRuns.status = 'paused'` typechecks at every consumer site.
- `POST /api/workflow-runs/:runId/steps/:stepRunId/approve` returns 403 with `not_in_approver_pool` when the caller is not in `workflow_step_gates.approver_pool_snapshot` for the gate referenced by the step's review.
- `workflowStepReviewService.requireApproval` rejects with `invalid_step_transition` when called on a step whose status is not in the valid pre-state set (e.g., `'completed'` already).
- `RLS_PROTECTED_TABLES` entries for the two new tables exist; `verify-rls-coverage.sh` (CI) passes.

**Dependencies:** none — this is the foundation. CI gate suite passes after the chunk merges.

---

### Chunk 2 — Engine validator

**Spec sections owned:** §4.1 (four A's vocabulary), §4.2 (branching as output property), §4.3 (parallel fan-out / fan-in + fail-fast), §4.4 (loops only on Approval-on-reject), §4.5 (no workflow → workflow nesting), §4.6 (Approval quorum check), §4.7 (`isCritical` semantics on Agent / Action only), §4.8 (Ask submitter group + single-submit cap).

**Scope.** Extend the existing publish-time validator to enforce the spec's V1 rules. Reject deprecated user-facing names from fresh Studio publishes; accept legacy engine type names from existing templates (no migration of the three system templates).

**Out of scope for this chunk.** Studio UI (Chunk 14). Runtime enforcement of `isCritical` (Chunk 5). Runtime enforcement of branch decisions (Chunk 11 renders branch labels; engine already evaluates branches).

**Files to create:**

- `server/services/workflowValidatorPure.ts` — pure function set per validator rule. One function per spec rule; each takes a parsed `WorkflowDefinition` and returns `{ ok: true } | { ok: false, errors: ValidatorError[] }`. Tests cover branch-target-exists, four-A's vocabulary, parallel-depth check, backward-edge-only-from-approval-reject, no-workflow-to-workflow-nesting, quorum bounds, isCritical-only-on-agent-action, Ask single-submit cap.
- `shared/types/workflowValidator.ts` — `ValidatorError = { rule: string, stepId?: string, message: string, severity: 'error' | 'warning' }`. Source of truth for error codes.

**Files to modify:**

- `server/services/workflowTemplateService.ts` — call `workflowValidatorPure.validate(definition, { acceptLegacyTypes: bool })` before persisting a new version. `acceptLegacyTypes` is true on system-template seeding paths and existing-template edit-and-resave paths; false on fresh Studio publishes.
- `server/lib/workflow/types.ts` — extend the four A's accepted-name list. Existing engine `WorkflowStepType` union stays (the validator distinguishes user-facing names from engine types).

**Contracts pinned in this chunk:**

```typescript
// shared/types/workflowValidator.ts
export interface ValidatorError {
  rule: 'four_as_vocabulary' | 'branching_target_exists' | 'parallel_depth' | 'loop_only_on_approval_reject' |
        'no_workflow_to_workflow' | 'quorum_specific_users' | 'is_critical_only_on_agent_action' | 'ask_single_submit';
  stepId?: string;
  message: string;
  severity: 'error' | 'warning';
}
export interface ValidatorResult {
  ok: boolean;
  errors: ValidatorError[];
}
```

The validator returns ONE object with all errors collected (not first-error-fail) so the Studio UI can show every issue at once.

**Error handling:**

- Validator returns `{ ok: false, errors }` to the caller. `WorkflowTemplateService.publish` translates to `{ statusCode: 422, message: 'Workflow template failed validation', errorCode: 'validation_failed', errors }` and the route returns the JSON.

**Test considerations:**

- `workflowValidatorPure.test.ts` — exhaustive cases per rule. Tests are pure (no DB); the same module is consumed by Studio for client-side preview validation in Chunk 14.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowValidatorPure.test.ts`

**Acceptance criteria:**

- Validator rejects all eight rule violations with structured errors.
- Validator accepts the three existing system templates (`event-creation.workflow.ts`, `weekly-digest.workflow.ts`, `intelligence-briefing.workflow.ts`) without modification when `acceptLegacyTypes: true`.
- Studio publish path returns 422 with structured errors when any rule fails.

**Dependencies:** Chunk 1 (schema for `is_critical` lookup in JSON, but not strictly required — could skip).

---

### Chunk 3 — Per-task event log

**Spec sections owned:** §3.1 (`task_id` + `task_sequence` columns), §8.1 (replay contract, sequence allocation invariant, gap-detection invariant on the client side will land in Chunk 9 — this chunk owns the SERVER side allocation only).

**Scope.** Extend `agentExecutionEventService` to allocate a per-task sequence in addition to the per-run sequence whenever a task_id is in scope. The per-task counter mirrors `agent_runs.next_event_seq` exactly. Allocation + INSERT in the same transaction with `FOR UPDATE` per spec §8.1 invariant. Replay query honours the per-task ordering.

**Out of scope.** WebSocket emission of events (Chunk 9). The client gap-detection protocol (Chunk 9). Specific event kinds for tasks (Chunk 9 owns the taxonomy in §8.2).

**Files to create:**

- `server/services/agentExecutionEventTaskSequencePure.ts` — pure helper. `allocateTaskSequence(currentNextSeq: number) → { allocated: number, newNextSeq: number }`. Trivial but isolated for testing.

**Files to modify:**

- `server/services/agentExecutionEventService.ts` — `appendEvent` accepts an optional `taskId: string | null`. When provided, the persist path also allocates `task_sequence` from `tasks.next_event_seq` under `FOR UPDATE` in the same transaction. Both sequences land on the row. The retry-with-backoff path (critical events) re-allocates a fresh task sequence on retry — the row's transaction rolls back on the first attempt's failure so the sequence is reused, not gapped (per spec §8.1 invariant).
- `server/services/agentExecutionEventService.ts` — new `streamEventsByTask(taskId, fromSeq, limit, forUser)` mirroring the existing `streamEvents(runId, ...)` shape.
- `shared/types/agentExecutionLog.ts` — extend the envelope type with `taskId: string | null`, `taskSequence: number | null`. The existing `eventId` derivation (`${runId}:${sequenceNumber}:${eventType}`) extends to a per-task variant `task:${taskId}:${taskSequence}:${eventType}` for events scoped to a task without a specific run (e.g., the orchestrator's `task.created` event).
- `server/services/agentExecutionEventServicePure.ts` — `buildEventId` extended to handle the per-task case.

**Contracts pinned in this chunk:**

- Replay query (illustrative — exact column names verified at chunk-time):
  ```sql
  SELECT * FROM agent_execution_events
   WHERE task_id = $1 AND task_sequence > $lastSeq
   ORDER BY task_sequence ASC
   LIMIT $limit
  ```
- Allocation invariant (verbatim from spec §8.1): allocation MUST be atomic and gap-free per `task_id`; INSERT must happen in the same transaction. If a non-retryable failure leaves a gap, the run transitions to `failed` with reason `event_log_corrupted`.
- Per-run sequence is preserved on every event (not replaced). Some consumers depend on it (e.g., the existing Live Agent Execution Log spec).

**Error handling:**

- Sequence-allocation race: `FOR UPDATE` serializes; no race possible. Test with concurrent inserts.
- Non-retryable persist failure: log `event_log_corrupted` + flip the parent run to `failed` via `WorkflowRunService.failRun(runId, 'event_log_corrupted', null)`. (Service method added in Chunk 4 / 7.)
- Retryable failure (critical events): existing one-retry-with-50ms-backoff pattern; same logic.

**Test considerations:**

- `agentExecutionEventTaskSequencePure.test.ts` — pure allocation logic.
- `agentExecutionEventTaskSequence.integration.test.ts` — concurrent insert test with two parallel `appendEvent` calls on the same `task_id`; assert sequences are 1 and 2 (or whatever the start is), no gap.
- `agentExecutionEventTaskSequenceReplay.test.ts` — write a sequence of 10 events; replay from `lastSeq=5`; assert exactly 5 events returned in order.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/agentExecutionEventTaskSequencePure.test.ts`

**Acceptance criteria:**

- Concurrent inserts produce monotonic, gap-free `task_sequence` values per `task_id`.
- Replay from `fromSeq=N` returns events strictly greater than N in ascending order.
- Failed inserts roll back the sequence allocation (next attempt reuses the same sequence).
- Per-run sequence is unchanged for existing consumers.

**Dependencies:** Chunk 1 (schema columns).

---

### Chunk 4 — Gate primitive + state machine

**Spec sections owned:** §3.3 (`workflow_step_gates` table — created in Chunk 1, this chunk owns the write path and lifecycle), §5.1.1 (Approval write contracts — execution-safety), §11.4.1 (Ask write contracts), §10.7 invariants on terminal-state writes, plus the gate-aware extensions to the existing `workflowStepReviewService.requireApproval`.

**Scope.** Wire every gate-creation site to insert a `workflow_step_gates` row. Wire gate-resolution to set `resolved_at`. Extend the per-decider `workflow_step_reviews` write to FK back to `gate_id`. State machine: gate transitions tracked via `resolved_at` (NULL → set). Write contracts for Approval and Ask fully pinned. Concurrency guards specified per spec §5.1.1, §11.4.1.

**Out of scope.** Approver pool resolution (Chunk 5). isCritical synthesis (Chunk 5). Confidence chip computation (Chunk 6). The actual gate-open trigger from the engine (chunks 5, 7). UI rendering of gate state (Chunks 11, 12).

**Files to create:**

- `server/services/workflowStepGateService.ts` — service with:
  - `openGate(input: { workflowRunId, stepId, gateKind, seenPayload?, seenConfidence?, approverPoolSnapshot?, isCriticalSynthesised, organisationId }) → Promise<WorkflowStepGate>` — idempotent on `(workflow_run_id, step_id) UNIQUE`; 23505 → returns the existing row.
  - `resolveGate(gateId, organisationId) → Promise<void>` — sets `resolved_at = now()` if NULL; 0-rows → 200 idempotent-hit.
  - `getOpenGate(workflowRunId, stepId, organisationId) → Promise<WorkflowStepGate | null>`.
  - `refreshPool(gateId, organisationId, newSnapshot) → Promise<{ refreshed: boolean, poolSize?: number, reason?: string }>` — implements spec §5.1.2 contract. UPDATE with `WHERE id = $ AND resolved_at IS NULL`; 0 rows → `{ refreshed: false, reason: 'gate_already_resolved' }`.
- `server/services/workflowStepGateServicePure.ts` — pure helper for snapshot construction (`buildGateSnapshot(stepDefinition, runContext, prior?) → { seenPayload, seenConfidence }` — orchestrates Chunks 5 and 6 building blocks).

**Files to modify:**

- `server/services/workflowStepReviewService.ts` — `requireApproval` extended to call `WorkflowStepGateService.openGate` first, then create the per-decider review row with the new `gate_id` FK. The existing pending-review-already-exists idempotency check now keys off `gate_id` (one open gate per step per run, by UNIQUE).
- `server/services/workflowRunService.ts` — `decideApproval` extended:
  1. Look up the open gate via `getOpenGate(runId, stepId)`.
  2. Verify caller is in `gate.approver_pool_snapshot` (delegated to Chunk 5's pool-resolution helper; for now use a thin pass-through).
  3. INSERT `workflow_step_reviews` row with `gate_id` FK; ON CONFLICT (`gate_id`, `decided_by_user_id`) DO NOTHING; if 23505 → return 200 idempotent-hit per spec §5.1.1.
  4. Step transition `awaiting_approval → completed | failed` uses `WHERE status = 'awaiting_approval'`; 0 rows → look up the existing decision and return it (first-commit-wins).
  5. If the step has been transitioned externally (e.g., run was Stopped), return 409 `step_already_resolved` per spec §5.1.1.
  6. On terminal step transition, `WorkflowStepGateService.resolveGate(gateId)`.
- `server/services/workflowRunService.ts` — `submitStepInput` (Ask submission) extended:
  1. Look up the open gate.
  2. Verify caller is in `gate.approver_pool_snapshot` (Ask uses the same column).
  3. Step transition `awaiting_input → submitted` uses `WHERE status = 'awaiting_input'`; 0 rows → 409 `already_submitted` with the winning submitter info per spec §11.4.1.
  4. On success: `resolveGate(gateId)`.
- `server/routes/workflowRuns.ts` — extend the existing input-submit and approve routes with the gate-aware error mapping (200 idempotent-hit, 409 race, 409 already-submitted, 403 not-in-pool).
- `shared/stateMachineGuards.ts` — add `workflow_step_gate` machine: `null → open` (via INSERT) and `open → resolved` (via `resolved_at` set). Forbidden: `resolved → *`, `null → resolved`.

**Contracts pinned in this chunk:**

```typescript
// shared/types/workflowStepGate.ts
export interface SeenPayload {
  step_id: string;
  step_type: 'agent' | 'action' | 'approval';
  step_name: string;
  rendered_inputs: Record<string, unknown>;
  rendered_preview: string | null;
  agent_reasoning: string | null;
  branch_decision: { field: string; resolved_value: unknown; target_step: string } | null;
}
export interface SeenConfidence {
  value: 'high' | 'medium' | 'low';
  reason: string;
  computed_at: string;                                                    // ISO8601
  signals: Array<{ name: string; weight: number }>;
}
export type ApproverPoolSnapshot = string[];                              // user ids; empty means everyone in scope failed to resolve
```

**Error handling:**

- `workflow_step_gates_run_step_uniq_idx` 23505 on `openGate` race: catch, look up existing row, return it (idempotent open).
- `workflow_step_reviews_gate_user_uniq_idx` 23505 on `decideApproval` double-click: catch, look up existing review, return `200 { idempotent_hit: true, existing_review_id }`.
- `step_already_resolved` (status not in the valid pre-state on the optimistic predicate): return `409 { error: 'step_already_resolved', current_status }`.
- `not_in_approver_pool`: return `403 { error: 'not_in_approver_pool' }`.
- Step run not found: `404 { error: 'step_run_not_found' }`.
- Run already terminal: `409 { error: 'run_already_terminal', current_status }`.

**Test considerations:**

- `workflowStepGateServicePure.test.ts` — gate snapshot construction.
- `workflowStepGateConcurrentDecide.integration.test.ts` — two concurrent decisions from different users on the same step before quorum: both rows insert, both succeed, quorum-counting is correct.
- `workflowStepGateRaceConditions.integration.test.ts` — concurrent decision when the step has been externally cancelled: 409 step_already_resolved.
- `workflowStepGateRefreshPool.test.ts` — pool refresh on a still-open gate succeeds; on a resolved gate returns `gate_already_resolved`.
- `workflowAskSingleSubmitConcurrent.integration.test.ts` — two concurrent Ask submits: first wins with 200, second gets 409 `already_submitted` with the winning submitter info.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowStepGateServicePure.test.ts`

**Acceptance criteria:**

- Every Approval / Ask step that opens a gate writes exactly one `workflow_step_gates` row.
- Concurrent double-click on the same Approval is idempotent at the user level.
- Concurrent submitters on the same Ask: exactly one wins.
- Pool refresh on resolved gates is a no-op with `gate_already_resolved` reason.
- Gate resolution sets `resolved_at`; the `unresolved_idx` partial index becomes empty for that row.

**Dependencies:** Chunk 1 (`workflow_step_gates` table, `gate_id` FK on reviews, UNIQUE constraint, status enum extension).

---

### Chunk 5 — Approval routing + isCritical

**Spec sections owned:** §5.1 (approver pool resolution by `kind`), §5.1.2 (`/refresh-pool` admin endpoint), §5.2 (isCritical synthesis), §5.4 (engine entry-point modifications). Plus closing the pre-existing violation #1 from Chunk 1 (the route-level pool-membership check is already in place — Chunk 5 adds the engine-side enforcement and the snapshot-write path).

**Scope.** The four `approverGroup.kind` resolvers (`specific_users`, `team`, `task_requester`, `org_admin`) compute the pool at gate-open time. The pool snapshot lands on `workflow_step_gates.approver_pool_snapshot`. isCritical synthesis: when the engine encounters a step with `is_critical: true`, synthesise an Approval gate before execution. The `/refresh-pool` endpoint per spec §5.1.2.

**Out of scope.** Confidence chip computation (Chunk 6 fills `seen_confidence`). Stall-and-notify scheduling (Chunk 8). Studio inspector UI for `isCritical` toggle (Chunk 14).

**Files to create:**

- `server/services/workflowApproverPoolService.ts` — resolves a pool from `approverGroup`. Methods:
  - `resolvePool(approverGroup, runContext, organisationId, subaccountId) → Promise<ApproverPoolSnapshot>` — dispatches by `kind`. For `team`: queries `team_members` filtered by `teams.deletedAt IS NULL`. For `specific_users`: returns the array verbatim (validator already enforced the IDs are valid). For `task_requester`: reads `tasks.created_by_user_id`. For `org_admin`: queries `org_user_roles` for users with `org_admin` role. Returns `string[]` of user IDs.
  - `userInPool(snapshot, userId) → boolean` — pure helper.
- `server/services/workflowApproverPoolServicePure.ts` — pure `userInPool` and `resolveSpecificUsersPool` (no DB) for testing.
- `server/routes/workflowGates.ts` — new route file owning `POST /api/tasks/:taskId/gates/:gateId/refresh-pool`. Uses `requireOrgPermission` or `requireSubaccountPermission` per spec §5.1.2 permission guard.
- `server/services/workflowGateRefreshPoolService.ts` — wraps `WorkflowApproverPoolService.resolvePool` + `WorkflowStepGateService.refreshPool` with permission verification.

**Files to modify:**

- `server/services/workflowEngineService.ts` — `prepareNextStep` (or whatever the per-step-prelude is named) extended:
  1. Read step's `params.is_critical`. If true and step type is `agent_call` / `prompt` / `action_call` / `invoke_automation`, AND the previous step is not already an Approval (the spec's "no double-gate" rule §5.2 #4): synthesise an Approval gate.
  2. Synthesised approverGroup defaults: `{ kind: 'task_requester' }`, `quorum: 1`. The pool resolver runs, snapshot lands on `workflow_step_gates`.
  3. Set `is_critical_synthesised: true` on the gate row.
- `server/services/workflowStepReviewService.ts` — `requireApproval` extended to accept an `approverGroup` param and resolve the pool via `WorkflowApproverPoolService.resolvePool` before opening the gate.
- `server/services/workflowRunService.ts` — `decideApproval`:
  1. Pool-membership check delegated to `WorkflowApproverPoolService.userInPool(gate.approver_pool_snapshot, userId)`. Returns 403 if false.
  2. Step transition predicate uses `status = 'awaiting_approval'` (not `'review_required'` — the codebase uses `awaiting_approval`; spec uses `review_required` interchangeably; pin to the codebase term and document the spec→code mapping in a code comment).
- `server/routes/workflowGates.ts` — wire `/refresh-pool` (mount in `server/index.ts` route registration).
- `server/lib/permissions.ts` — add new permission keys if needed (e.g., `WORKFLOW_GATE_REFRESH_POOL`); verify with the existing permission registry. If a suitable umbrella permission exists (e.g., `WORKFLOW_RUNS_START` or `WORKFLOW_TEMPLATES_PUBLISH`), reuse it.

**Contracts pinned in this chunk:**

```typescript
// Approver group shape (matches spec §3.2 / §5.1)
export interface ApproverGroup {
  kind: 'specific_users' | 'team' | 'task_requester' | 'org_admin';
  userIds?: string[];                                                     // when kind === 'specific_users'
  teamId?: string;                                                        // when kind === 'team'
}

// Refresh-pool API contract (spec §5.1.2)
// POST /api/tasks/:taskId/gates/:gateId/refresh-pool
// Body: {}
// 200: { refreshed: true, pool_size: number } | { refreshed: false, reason: 'gate_already_resolved' }
// 403: { error: 'forbidden' }
```

**Error handling:**

- `not_in_approver_pool` from the gate-aware decision path: 403.
- `gate_already_resolved` race: 200 idempotent-hit shape.
- Pool empty after resolution (e.g., team has no members) AND quorum > 0: gate stays open with an under-quorum error rendered on the Approval card. The validator does NOT reject this at runtime per spec §4.6 — runtime fallback is `/refresh-pool` after admin adjusts team membership.
- isCritical-synthesised gate REJECTED: per spec §5.2 #3, the workflow stalls (no `onReject` route — author didn't define one for an implicit gate). The engine emits `step.failed` only when explicitly stopped; otherwise the run sits in `awaiting_approval`. (V2 has a privileged-resume path; not in V1 per spec §5.2.)

**Test considerations:**

- `workflowApproverPoolServicePure.test.ts` — `userInPool` and `resolveSpecificUsersPool` (pure), several edge cases.
- `workflowApproverPoolServiceTeam.integration.test.ts` — team resolution honours `deletedAt IS NULL`; deleted-team-member is excluded.
- `workflowIsCriticalSynthesis.integration.test.ts` — Agent step with `is_critical: true` synthesises an Approval gate; `is_critical_synthesised: true` lands on the gate row.
- `workflowIsCriticalNoDoubleGate.integration.test.ts` — author-placed Approval before a critical step → no second synthesised gate; validator emits a warning.
- `workflowApprovalRouteRefreshPool.integration.test.ts` — full HTTP flow: open gate, refresh pool, observe `approver_pool_snapshot` updated.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowApproverPoolServicePure.test.ts`

**Acceptance criteria:**

- All four `approverGroup.kind` resolvers produce the correct pool from real data fixtures.
- Decision API enforces pool membership; 403 when caller is not in the snapshot.
- isCritical synthesis works on Agent and Action steps; not on Ask or Approval (validator already rejects in Chunk 2).
- `/refresh-pool` endpoint is permission-gated and idempotent.
- Approver pool snapshot is immutable except via `/refresh-pool`.

**Dependencies:** Chunks 1 (schema), 2 (validator already rejected `is_critical: true` on Ask/Approval), 4 (`WorkflowStepGateService`).

---

### Chunk 6 — Confidence + audit

**Spec sections owned:** §6.1 (heuristic), §6.2 (operator-language reason copy), §6.2.1 (`seen_confidence` JSONB shape), §6.3 (`seen_payload` snapshot), §6.4 (failsafe — confidence is decoration, not authority), §6.5 (where audit fields surface — Plan tab + audit drawer V2). Plus `decision_reason` capture on the per-decider review row.

**Scope.** Compute confidence at gate-open. Snapshot the rendered preview into `seen_payload`. Both immutable. Plan-tab caption renders from `seen_payload` (front-end consumed by Chunk 11). Audit drawer + export are V2 — schema only in V1.

**Out of scope.** Plan-tab rendering of audit caption (Chunk 11). Studio inspector "audit on decision" footnote (Chunk 14). V2 calibrated confidence model.

**Files to create:**

- `server/services/workflowConfidenceServicePure.ts` — pure heuristic computation. Inputs: `templateVersionId`, `stepId`, `stepDefinition` (for `is_critical`, `side_effect_class`), `pastReviewsCount: { approved, rejected }` (loaded by the impure wrapper), `subaccountFirstUseFlag`, `upstreamConfidence: 'high'|'medium'|'low'|null`. Returns `SeenConfidence`. Plain-language reason copy per §6.2 mapping table.
- `server/services/workflowConfidenceService.ts` — impure wrapper. Loads aggregates from `workflow_step_reviews` filtered by `template_version_id` + `step_id`; loads subaccount-first-use signal. Calls the pure module.
- `server/services/workflowSeenPayloadServicePure.ts` — pure builder for the snapshot per spec §6.3 shape. Inputs: `stepDefinition`, `runContext` (for resolving bindings), `agentReasoning?` (for Agent steps), `branchDecision?`. Returns `SeenPayload`.
- `server/services/workflowSeenPayloadService.ts` — impure wrapper that orchestrates the pure module with run-context loading.

**Files to modify:**

- `server/services/workflowStepGateServicePure.ts` — `buildGateSnapshot` calls both pure modules.
- `server/services/workflowStepReviewService.ts` — `requireApproval` accepts `decisionReasonHint?` (unused — captured at decision-time, not gate-open).
- `server/services/workflowRunService.ts` — `decideApproval` accepts `decisionReason?: string` from the request body, persists it on the per-decider `workflow_step_reviews.decision_reason` column (already added in Chunk 1).
- `server/routes/workflowRuns.ts` — extend the approve route body to accept `decisionReason?: string`.

**Contracts pinned in this chunk:**

The full `seen_payload` and `seen_confidence` shapes from Chunk 4's contracts section. Pinned here as immutable at gate-open. Plan-tab read path is `seen_payload`, never current state (per spec §6.3).

The reason-copy mapping (spec §6.2):

| Heuristic state | Chip + reason |
|---|---|
| Many similar past runs, no clamps | `High` · matches recent successful runs |
| `is_critical: true` on next step | `Medium` · the next step can't be undone, worth a careful look |
| `irreversible` side-effect class | `Medium` · this can't be undone once it runs |
| Cascade from low-confidence upstream | `Low` · the agent isn't sure about this one |
| First use in this subaccount | `Low` · first time running this here |
| Few past runs, mixed history | `Medium` · still learning what's normal here |

Stored in `server/services/workflowConfidenceCopyMap.ts` as a const map; the pure heuristic returns the key, the wrapper looks up the copy. Allows future tuning without touching the heuristic.

**Error handling:**

- Aggregate query failure: log + fall back to `medium` with reason "still learning what's normal here". Confidence is decoration; degrading to a medium default is acceptable rather than blocking the gate-open.
- `seen_payload` build failure: log `seen_payload_build_failed` + write null on the gate row. The Plan-tab caption renders "audit unavailable" rather than blocking. (Spec is silent on this case; choose graceful degradation.)

**Test considerations:**

- `workflowConfidenceServicePure.test.ts` — every mapping row in the table; clamp interactions; cascade from upstream.
- `workflowSeenPayloadServicePure.test.ts` — snapshot shape correctness; null-handling for missing `agentReasoning` / `branchDecision`.
- `workflowConfidenceImmutableSnapshot.integration.test.ts` — gate opens with confidence X; later read of `gate.seen_confidence` returns X regardless of underlying signals shifting.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowConfidenceServicePure.test.ts`
- `npx tsx server/services/__tests__/workflowSeenPayloadServicePure.test.ts`

**Acceptance criteria:**

- Confidence and seen-payload snapshotted at gate-open; never regenerated.
- Plain-language reason strings only — no engineering jargon ("clamp", "threshold", "score").
- High-confidence does NOT auto-approve (failsafe — explicit test).
- `decision_reason` persists on the per-decider review when provided.

**Dependencies:** Chunks 1 (schema columns), 4 (gate write path).

---

### Chunk 7 — Cost / wall-clock runaway protection

**Spec sections owned:** §3.1 (`effective_cost_ceiling_cents`, `effective_wall_clock_cap_seconds`, `extension_count`, `cost_ceiling_cents`, `wall_clock_cap_seconds`), §7 (full): pause card, operator-initiated Pause/Stop, between-step semantics, resume API with extension, stop API, telemetry events.

**Scope.** Per-run cost cap + wall-clock cap. Engine pauses between steps when either is reached. Operator-driven Pause/Stop in the task header. Resume API with mandatory extension after cap-triggered pause. Stop API. Run-completion invariant (every step terminal before `running → succeeded`).

**Out of scope.** Pause card UI rendering (Chunk 11). Operator's Pause / Stop button placement in the task header (Chunk 11). Cost dashboards (V2).

**Files to create:**

- `server/services/workflowRunPauseStopServicePure.ts` — pure state-transition logic. `decideRunNextState({ currentStatus, currentCostCents, currentElapsedSeconds, effectiveCostCeilingCents, effectiveWallClockCapSeconds, operatorAction? }) → { nextStatus, reason, emit }`. Tested under all combinations.
- `server/services/workflowRunPauseStopService.ts` — impure wrapper. Methods: `pauseRun(runId, organisationId, userId, reason)`, `resumeRun(runId, organisationId, userId, { extendCostCents?, extendSeconds? })`, `stopRun(runId, organisationId, userId)`.

**Files to modify:**

- `server/services/workflowEngineService.ts` — between-step loop:
  1. After each step completion, evaluate `currentCostCents = sum of cost-ledger rows for runId`. (Sum, not in-memory aggregate, per spec §7.4.)
  2. Evaluate `currentElapsedSeconds = now() - startedAt`.
  3. If `currentCostCents >= effective_cost_ceiling_cents` OR `currentElapsedSeconds >= effective_wall_clock_cap_seconds`: emit `run.paused.cost_ceiling` or `run.paused.wall_clock` (whichever fired first), transition `running → paused`, do not dispatch the next step.
  4. Wall-clock check additionally fires from a 30-second pg-boss heartbeat job that pauses long-running steps' parent runs without waiting for between-step.
  5. Run completion: when transitioning `running → succeeded`, verify (a) every step is in a terminal status and (b) no `queued` / `awaiting_input` / `awaiting_approval` step remains. Spec §7.5 invariant. If condition fails, the run stays `running` and the engine logs `run_completion_blocked_by_open_step` + the specific step status.
- `server/routes/workflowRuns.ts` — three new routes (mounted on the existing router):
  - `POST /api/tasks/:taskId/run/resume` body `{ extendCostCents?, extendSeconds? }`. Permission guard: caller in §14.5 visibility set.
  - `POST /api/tasks/:taskId/run/stop` body `{}`.
  - (Pause card endpoint reuses `resume` with extension semantics.)
- `server/services/workflowRunService.ts` — extend with pass-through methods to `workflowRunPauseStopService`.
- `shared/stateMachineGuards.ts` — `workflow_run` machine update: add `paused` as a valid state; `running → paused`, `paused → running`, `running → failed`, `paused → failed` valid; everything else from `paused` and to `paused` is invalid.

**Contracts pinned in this chunk:**

```typescript
// POST /api/tasks/:taskId/run/resume
// Body: { extendCostCents?: integer, extendSeconds?: integer }
// 200: { resumed: true, extension_count: number } | { resumed: false, reason: 'not_paused' }
// 400: { error: 'extension_required', reason: 'previous_pause_was_cap_triggered', cap: 'cost_ceiling' | 'wall_clock' }
// 400: { error: 'extension_cap_reached' }                                  // when extension_count >= 2
// 403: { error: 'forbidden' }
// 409: { error: 'race_with_other_action', current_status: string }

// POST /api/tasks/:taskId/run/stop
// Body: {}
// 200: { stopped: true } | { stopped: false, reason: 'already_terminal', current_status: string }
// 403: { error: 'forbidden' }

// Pause-card defaults (Open Question #3):
// extendCostCents = 250, extendSeconds = 1800
// extension_count cap = 2 per run

// Resume vs Retry: resume continues from the next pending step; does NOT
// re-execute completed steps; does NOT trigger step-level retries.
// (Spec §7.5 "Resume vs retry separation".)
```

**Error handling:**

- 400 `extension_required` after cap-triggered pause without extension body: enforced server-side per spec §7.5.
- 400 `extension_cap_reached` on third resume of the same run: `extension_count` already at 2.
- 409 `race_with_other_action` on optimistic predicate failure: `WHERE status = 'paused'` returned 0 rows.
- Visibility 403: caller is not requester / org admin / subaccount admin on the task's subaccount.
- Best-effort cancellation of in-flight skill / Action calls on Stop: log per-skill cancellation outcome; some calls have already fired and are not reversible (spec §7.3 explicitly).

**Test considerations:**

- `workflowRunPauseStopServicePure.test.ts` — every combination of (cap state, operator action, current status) → next state.
- `workflowRunPauseStopBetweenStep.integration.test.ts` — fire a step that exceeds the cap; verify pause happens AFTER the step completes, not mid-step.
- `workflowRunResumeWithExtension.integration.test.ts` — resume after cap-triggered pause without extension → 400; with extension → 200; `effective_*` fields incremented.
- `workflowRunCompletionGuard.integration.test.ts` — fan-out with one branch still in flight: run does NOT transition to `succeeded` even when the parent step's `next` resolves.
- `workflowRunStopMidFlight.integration.test.ts` — Stop while a skill call is in flight: emit `run.stopped.by_user`, attempt cancellation, log result, transition to `failed`.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowRunPauseStopServicePure.test.ts`

**Acceptance criteria:**

- Pause is between-step (not mid-step) per spec §7.4.
- Cap-triggered pause requires an extension on resume; operator-initiated pause does not.
- Extension count caps at 2 per run.
- Run-completion invariant holds: succeeded only when every step is terminal.
- `effective_*` fields update transactionally on resume-with-extension.
- Stop transitions to `failed` with `stopped_by_user` reason; emits `run.stopped.by_user`.

**Dependencies:** Chunks 1 (schema columns + status enum), 4 (gate primitive — Stop must resolve any open gates), 9 (event emission for `run.paused.*` / `run.resumed` / `run.stopped.by_user` — but the events themselves can land in this chunk; Chunk 9 owns the WebSocket transport).

---

### Chunk 8 — Stall-and-notify + schedule pinning

**Spec sections owned:** §5.3 (stall-and-notify cadence on Approval / Ask gates), §3.1 (`pinned_template_version_id`), §5.4 (schedule dispatch path honours pinning).

**Scope.** Three pg-boss delayed jobs (24h, 72h, 7d) scheduled at gate-open, cancelled at gate-resolve. Each job sends a notification to the task requester via the existing notification surface (review-queue / sidebar count + email opt-in). Schedule dispatch path honours `pinned_template_version_id`.

**Out of scope.** Email template authoring (reuse existing template system; one new template per cadence with the spec's copy). Auto-escalation policies beyond stall-and-notify (V2 per spec §5.3).

**Files to create:**

- `server/jobs/workflowGateStallNotifyJob.ts` — pg-boss job handler. Payload: `{ gateId, organisationId, taskId, requesterUserId, cadence: '24h' | '72h' | '7d' }`. Verifies gate is still open (`resolved_at IS NULL`) before notifying — late-firing job after gate resolved is a no-op.
- `server/services/workflowGateStallNotifyService.ts` — schedules and cancels stall jobs.
  - `scheduleStallNotifications(gateId, taskId, requesterUserId, organisationId)` — enqueues three jobs with `startAfter: 24h / 72h / 7d`. Records the pg-boss job IDs on a new `workflow_step_gates.stall_notify_job_ids jsonb` column (added in Chunk 1 supplement — see note below). Or, simpler, the cleanup-on-resolve query queries pg-boss for jobs by name pattern matching `gateId`. Architect picks at chunk-time; the latter is simpler.
  - `cancelStallNotifications(gateId)` — cancels the three jobs.
- `server/services/workflowScheduleDispatchService.ts` — wraps the existing schedule-dispatch path with `pinned_template_version_id` honour. If non-null, dispatches that exact version; else uses the latest published.

**Files to modify:**

- `server/services/workflowStepGateService.ts` — `openGate` calls `WorkflowGateStallNotifyService.scheduleStallNotifications` after the row is committed; `resolveGate` calls `cancelStallNotifications` before setting `resolved_at`.
- `server/services/agentScheduleService.ts` (or whichever service dispatches scheduled tasks) — read `pinned_template_version_id` from the schedule row; pass to dispatch.
- `server/index.ts` — register the new pg-boss worker via `createWorker(WORKFLOW_GATE_STALL_NOTIFY_QUEUE, handler)`.
- `server/services/notificationService.ts` (or whichever service sends in-app notifications + emails) — extend with `sendGateStallNotification(taskId, requesterUserId, cadence)`.

**Note on Chunk 1 schema:** if the stall-job-id-tracking lands as a JSONB column on `workflow_step_gates`, that column needs to land in the Chunk 1 migration. Architect at Chunk 1 time can decide whether to track via a column or a pg-boss query pattern. **Plan-author preference:** pg-boss query pattern (no schema column) — pg-boss has `getJobsByName` / cancel-by-name; one less column.

**Contracts pinned in this chunk:**

- pg-boss queue name: `workflow-gate-stall-notify`. Job name pattern: `stall-notify-${gateId}-${cadence}`. Idempotent on `(gateId, cadence)` via the job-name uniqueness; pg-boss's natural dedup applies.
- Schedule dispatch precedence: pinned > latest published. Spec §5.4 invariant.
- Notification cadence email subject lines (spec §5.3): "Task X has been waiting on [approval / input] for 24 hours" / 72 hours / 7 days. Last cadence's email includes a "Cancel this task?" affordance.

**Error handling:**

- pg-boss enqueue failure: log, do not block gate-open. Notification is best-effort; gate is still open.
- Notification send failure: log, gate stays open, next cadence still fires.
- Pinned version retracted (spec edge case): `template_not_published`. Schedule dispatch fails the run with `pinned_version_unavailable`. Operator-recoverable by re-pointing the schedule.

**Test considerations:**

- `workflowGateStallNotifyService.test.ts` — schedule + cancel + late-fire-no-op (gate already resolved).
- `workflowScheduleDispatchService.test.ts` — pinned version dispatch wins over latest; missing pinned version triggers structured error.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/workflowGateStallNotifyService.test.ts`

**Acceptance criteria:**

- Three notifications fire at 24h / 72h / 7d after gate-open.
- Resolving a gate cancels all three.
- Late-firing job after resolution is a no-op.
- Schedule with `pinned_template_version_id` set always dispatches that version.

**Dependencies:** Chunks 1 (`pinned_template_version_id` column), 4 (gate primitive).

---

### Chunk 9 — Real-time WebSocket coordination

**Spec sections owned:** §8 (full): connection model, event taxonomy, per-pane subscription, optimistic rendering, latency budget, gap-detection invariant, client ordering invariant.

**Scope.** New `task` room scope on the server. New `emitTaskEvent` wrapper. Event taxonomy — every kind in §8.2 lands in a discriminated union with the validator allow-list. Replay-on-reconnect protocol with gap detection. Client-side hook `useTaskEventStream(taskId)` for the open task view (Chunk 11 consumes).

**Out of scope.** Pane-specific filtering (Chunk 11). Optimistic rendering hookup (Chunk 11 — uses the existing primitive). Mockup-driven UI states (Chunks 11, 12, 13).

**Files to create:**

- `shared/types/taskEvent.ts` — discriminated union of every event kind from spec §8.2. One type per kind with literal `kind` discriminator + payload fields. `TaskEventKind` enum exported. Source of truth for the event allow-list (per DEVELOPMENT_GUIDELINES §8.13).
- `shared/types/taskEventValidator.ts` — pure runtime validator: `validateTaskEvent(payload: unknown): { ok: true, event: TaskEvent } | { ok: false, reason: string }`. Used at write-time before persisting.
- `server/services/taskEventService.ts` — write path. Wraps `agentExecutionEventService.appendEvent` with `taskId` and the per-task sequence. Emits via `emitTaskEvent`.
- `server/websocket/taskRoom.ts` — `join:task` / `leave:task` handlers. Validates the user has visibility into the task (per Chunk 10 permission helpers; for now, calls a stub that allows owner / org admin / subaccount admin). Joins `task:${taskId}` room.
- `server/websocket/emitters.ts` (modify) — add `emitTaskEvent(taskId, envelope)` mirroring `emitAgentExecutionEvent`. Envelope shape:
  ```typescript
  {
    eventId: `task:${taskId}:${taskSequence}:${kind}`,
    type: 'task:execution-event',
    entityId: taskId,
    timestamp: ISO8601,
    payload: TaskEvent
  }
  ```
- `client/src/hooks/useTaskEventStream.ts` — React hook. Joins `task` room, subscribes to `task:execution-event`, dedups via the existing LRU, applies events in `taskSequence` order with the gap-detection buffer per spec §8.1 client ordering invariant.
  - On reconnect: re-fetch a REST snapshot via `GET /api/tasks/:taskId/event-stream/replay?fromSeq=N` and reconcile.
  - Client buffer for out-of-order events (max ~1s recovery window per spec); if gap doesn't fill, trigger a replay from the last contiguous `taskSequence`.
- `server/routes/taskEventStream.ts` — `GET /api/tasks/:taskId/event-stream/replay?fromSeq=N` returns events with `taskSequence > fromSeq`. Returns `{ events: TaskEvent[], hasGap: boolean, oldestRetainedSeq: number }`. `hasGap: true` when `fromSeq < oldestRetainedSeq` — client must do a full reload (spec §8.1 "gap-detection invariant").

**Files to modify:**

- `server/websocket/rooms.ts` — wire `join:task` / `leave:task` listeners (calling `taskRoom.handleJoinTask`).
- `server/websocket/emitters.ts` — add the `emitTaskEvent` export.
- `server/services/workflowEngineService.ts` — every step transition calls `taskEventService.appendAndEmit(...)` with the relevant kind. Replace any direct `emitWorkflowRunUpdate` call that should now be a task-scoped event (the per-run scope continues to coexist for legacy consumers).
- `server/services/workflowStepGateService.ts` — `openGate` / `resolveGate` emit `approval.queued` / `approval.decided` / `ask.queued` / `ask.submitted` / `ask.skipped` / `approval.pool_refreshed` events.
- `server/services/workflowRunPauseStopService.ts` — emit `run.paused.cost_ceiling` / `run.paused.wall_clock` / `run.paused.by_user` / `run.resumed` / `run.stopped.by_user`.

**Contracts pinned in this chunk (the V1-canonical event taxonomy):**

```typescript
// shared/types/taskEvent.ts (excerpt — full enumeration in the file)
export type TaskEvent =
  | { kind: 'task.created'; payload: { requesterId: string; initialPrompt: string } }
  | { kind: 'task.routed'; payload: { targetAgentId?: string; targetWorkflowTemplateId?: string } }
  | { kind: 'agent.delegation.opened'; payload: { parentAgentId: string; childAgentId: string; scope: string } }
  | { kind: 'agent.delegation.closed'; payload: { childAgentId: string; summary: string } }
  | { kind: 'step.queued'; payload: { stepId: string; stepType: string; params: Record<string, unknown> } }
  | { kind: 'step.started'; payload: { stepId: string } }
  | { kind: 'step.completed'; payload: { stepId: string; outputs: unknown; fileRefs: string[] } }
  | { kind: 'step.failed'; payload: { stepId: string; errorClass: string; errorMessage: string } }
  | { kind: 'step.branch_decided'; payload: { stepId: string; field: string; resolvedValue: unknown; targetStep: string } }
  | { kind: 'approval.queued'; payload: { gateId: string; stepId: string; approverPool: string[]; seenPayload: SeenPayload; seenConfidence: SeenConfidence } }
  | { kind: 'approval.decided'; payload: { gateId: string; decidedBy: string; decision: 'approved' | 'rejected'; decisionReason?: string } }
  | { kind: 'approval.pool_refreshed'; payload: { gateId: string; actorId: string; newPoolSize: number; stillBelowQuorum: boolean } }
  | { kind: 'ask.queued'; payload: { gateId: string; stepId: string; submitterPool: string[]; schema: AskFormSchema; prompt: string } }
  | { kind: 'ask.submitted'; payload: { gateId: string; submittedBy: string; values: Record<string, unknown> } }
  | { kind: 'ask.skipped'; payload: { gateId: string; submittedBy: string; stepId: string } }
  | { kind: 'file.created'; payload: { fileId: string; version: number; producerAgentId: string } }
  | { kind: 'file.edited'; payload: { fileId: string; priorVersion: number; newVersion: number; editRequest: string } }
  | { kind: 'chat.message'; payload: { authorKind: 'user' | 'agent'; authorId: string; body: string; attachments?: unknown[] } }
  | { kind: 'agent.milestone'; payload: { agentId: string; summary: string; linkRef?: { kind: string; id: string; label: string } } }
  | { kind: 'thinking.changed'; payload: { newText: string } }
  | { kind: 'run.paused.cost_ceiling'; payload: { capValue: number; currentCost: number } }
  | { kind: 'run.paused.wall_clock'; payload: { capValue: number; currentElapsed: number } }
  | { kind: 'run.paused.by_user'; payload: { actorId: string } }
  | { kind: 'run.resumed'; payload: { actorId: string; extensionCostCents?: number; extensionSeconds?: number } }
  | { kind: 'run.stopped.by_user'; payload: { actorId: string } };
```

Adding a new kind requires updating the union AND the validator allow-list in the same commit (DEVELOPMENT_GUIDELINES §8.13).

**Replay protocol pinned:**

- Cursor: `taskSequence` (number).
- Server: `GET /api/tasks/:taskId/event-stream/replay?fromSeq=N` returns `{ events, hasGap, oldestRetainedSeq }`.
- Client: applies events with `taskSequence > N`. If `hasGap === true` (cursor pre-dates oldest retained event), client re-fetches the full task state from the REST snapshot endpoint and rebuilds.
- Retention: 7 days for `agent_execution_events` rows (Open Question 4 default).

**Latency budget:** sub-200ms event-emit-to-render. Architect verifies with synthetic load tests at chunk-time. The existing `agent_execution_events` write-then-emit shape already meets this; the per-task variant inherits.

**Error handling:**

- Malformed event payload (validator rejects): log `task_event_invalid_payload`; do not write the row; do not emit.
- Replay of a `fromSeq` older than retention: 200 with `hasGap: true`; client recovers by full reload.
- WebSocket emission failure (no listeners, broken pipe): log; the event row is still in the DB and replays on reconnect.
- Client gap detection (out-of-order arrival): buffer up to 1 second; if gap not filled, trigger replay from last contiguous `taskSequence`.

**Test considerations:**

- `taskEventValidator.test.ts` — every kind validates correctly; malformed payloads rejected.
- `taskEventStreamReplay.integration.test.ts` — write 20 events, replay from `fromSeq=10`, get exactly 10 events in order.
- `taskEventStreamGap.integration.test.ts` — request replay with `fromSeq` older than retention; receive `hasGap: true`.
- `useTaskEventStreamPure.test.ts` — pure logic of the client-side ordering buffer (extract pure logic per KNOWLEDGE.md 2026-04-21 RTL-absent pattern).

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx shared/types/__tests__/taskEventValidator.test.ts`
- `npx tsx server/services/__tests__/taskEventStreamReplay.integration.test.ts`

**Acceptance criteria:**

- Per-task room joins are permission-validated.
- Every event kind in §8.2 has a typed entry in the union and a validator entry.
- Replay-on-reconnect resumes from `lastEventId` cursor; no events lost; no replay from start.
- Gap detection signals to the client when retention has expired the cursor.
- Out-of-order arrival is buffered and reconciled.

**Dependencies:** Chunks 1 (schema), 3 (per-task event log allocation), 7 (run.paused/resumed/stopped events sourced from this chunk's emitters).

---

### Chunk 10 — Permissions API + Teams CRUD

**Spec sections owned:** §14 (full): roles, the assignable-users endpoint, picker UI behaviour, visibility for non-requester submitters, Pause / Stop button visibility, cross-team / cross-subaccount Asks. §16.2 #31 (Teams CRUD UI in Org settings).

**Scope.** New endpoint for the role-aware picker pool. Two pickers (User picker, Team picker) consumed by Studio inspectors. Teams + Members CRUD UI page (`teams` and `team_members` tables already exist, no schema changes). Visibility rules for non-requester submitters. Pause / Stop server-side permission guard already lives in Chunk 7; this chunk pins the role-set list.

**Out of scope.** Studio inspector usage of the pickers (Chunk 14). Picker rendering inside the Studio Approval / Ask inspectors (Chunk 14). Restricted-view mode for sensitive workflows (V2 per spec §14.4).

**Files to create:**

- `server/services/assignableUsersService.ts` — `resolvePool(callerRole, callerId, organisationId, subaccountId) → Promise<{ users: AssignableUser[], teams: AssignableTeam[] }>` per spec §14.2 shape. Org admin/manager: org users + subaccount members. Subaccount admin: subaccount members only. Subaccount member: 403.
- `server/routes/assignableUsers.ts` — `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users`. Mounted in `server/index.ts`.
- `server/services/teamsService.ts` — Teams CRUD (create, list, update, soft-delete). `team_members` add/remove. Already-implicitly-existing schema; this is the missing service layer.
- `server/routes/teams.ts` — Teams CRUD endpoints. Mounted under `/api/orgs/:orgId/teams` (org-level) and `/api/subaccounts/:subaccountId/teams` (subaccount-scoped, optional in V1).
- `client/src/pages/TeamsAdminPage.tsx` — Teams CRUD UI in Org settings. List view, Create button, Edit modal, Members management.
- `client/src/components/UserPicker.tsx` — generic picker component. Search-and-select against `users[]`; chip render on selection.
- `client/src/components/TeamPicker.tsx` — generic picker for `teams[]`.

**Files to modify:**

- `server/lib/permissions.ts` — add `TEAMS_MANAGE` permission key; gate the Teams CRUD routes on it.
- `server/index.ts` — mount the new routes.
- `client/src/components/sidebar/*` — add a "Teams" entry in Org settings nav.

**Contracts pinned in this chunk:**

```typescript
// GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users
// 200:
{
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: 'org_admin' | 'org_manager' | 'subaccount_admin' | 'subaccount_member';
    is_org_user: boolean;                                                 // true if visible to all subaccounts in org
    is_subaccount_member: boolean;                                        // true if a member of THIS subaccount
  }>,
  teams: Array<{ id: string; name: string; member_count: number }>;
}
// 403: { error: 'forbidden' }                                            // subaccount member or wrong subaccount admin
```

```typescript
// Teams CRUD
// POST /api/orgs/:orgId/teams { name, subaccountId? } → 201 { id, name, ... }
// GET /api/orgs/:orgId/teams → 200 { teams: [...] }
// PATCH /api/orgs/:orgId/teams/:teamId { name? } → 200 { team }
// DELETE /api/orgs/:orgId/teams/:teamId → 200 (soft-delete, sets deletedAt)
// POST /api/orgs/:orgId/teams/:teamId/members { userIds: string[] } → 200 { added: number }
// DELETE /api/orgs/:orgId/teams/:teamId/members/:userId → 200
```

**Error handling:**

- 403 `forbidden` from picker: caller is not authorised to author for this subaccount.
- 404 `subaccount_not_found` from `resolveSubaccount`.
- 409 `team_name_conflict`: team name already exists in the org/subaccount scope.

**Test considerations:**

- `assignableUsersService.test.ts` — three role variants produce correct shapes.
- `assignableUsersServiceCrossSubaccount.test.ts` — org admin can route to another subaccount's users; subaccount admin cannot.
- `teamsServicePure.test.ts` — pure CRUD validation rules.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/assignableUsersService.test.ts`
- `npm run build:client` (Teams admin page)

**Acceptance criteria:**

- Picker endpoint returns correctly scoped pools per role.
- Teams CRUD page allows org admin to create / edit / delete teams and add / remove members.
- Cross-subaccount routing works for org admin; blocked for subaccount admin.

**Dependencies:** Chunk 1 (no schema changes, but the existing `teams` / `team_members` schemas + RLS are required — they exist already).

---

### Chunk 11 — Open task view UI

**Spec sections owned:** §9 (full — three-pane layout, Chat panel, Activity panel, Right pane Now/Plan/Files tabs, header, empty states), §15 (Brief → Task UI rename — sidebar, breadcrumb, page title; the route redirect lands in Chunk 16).

**Scope.** The most important UI surface in the product. Three-pane layout with mockup-faithful styling. Chat panel with milestone cards, thinking box, composer. Activity panel with newest-at-bottom + auto-scroll + "↓ N new events" pill. Right pane with Now / Plan / Files tabs (Plan default per spec-time decision #7). Header with task name + status badge + Pause/Stop buttons (visibility per Chunk 10). Empty states per spec §9.6.

**Out of scope.** Files tab content — strip + reader + diff (Chunk 13). Ask form card runtime (Chunk 12). Studio (Chunk 14).

**Files to create:**

- `client/src/pages/OpenTaskView.tsx` — page-level component. Subscribes to `useTaskEventStream(taskId)` (Chunk 9 hook).
- `client/src/components/openTask/ChatPane.tsx` — chat scroll area, milestone-vs-narration filter, composer, thinking box.
- `client/src/components/openTask/ActivityPane.tsx` — collapsible (36px collapsed, 22% expanded). Auto-scroll-to-bottom on new events; pause-on-manual-scroll; "↓ N new events" pill.
- `client/src/components/openTask/RightPaneTabs.tsx` — tab switcher (Now / Plan / Files), default Plan.
- `client/src/components/openTask/NowTab.tsx` — agent org-chart with status dots + edges.
- `client/src/components/openTask/PlanTab.tsx` — content adapts per task type (trivial / multi-step / workflow-fired); branch labels + "Why?" link; Critical pill; confidence chip preview; empty state.
- `client/src/components/openTask/FilesTab.tsx` — placeholder for Chunk 13's full implementation.
- `client/src/components/openTask/ThinkingBox.tsx` — single-line italic, pulsing dot, plain language.
- `client/src/components/openTask/MilestoneCard.tsx` — per-agent attribution + link affordance.
- `client/src/components/openTask/ApprovalCard.tsx` — refactor of existing pattern; renders `seenConfidence` chip + audit caption ("Approved by X · view what they saw").
- `client/src/components/openTask/PauseCard.tsx` — pause card primitive (Stop / Continue with extension buttons).
- `client/src/components/openTask/TaskHeader.tsx` — task name, status badge, Pause/Stop buttons (visibility per role).
- `client/src/components/openTask/openTaskViewPure.ts` — pure helpers: classify task type from event stream (trivial / multi-step / workflow-fired); pick the latest thinking text from `thinking.changed` events; compute milestone-vs-narration filter set; activity-pane auto-scroll decision logic per KNOWLEDGE.md 2026-05-02 correction.

**Files to modify:**

- `client/src/App.tsx` — register the new route `/tasks/:taskId` (and the redirect from `/briefs/:taskId` lands in Chunk 16).
- `client/src/components/sidebar/*` — change "Briefs" to "Tasks" (rename in Chunk 16, but the tasks-list page lives here).

**Contracts pinned in this chunk:**

- Layout widths from spec §9.1 (Chat 26%, Activity 22% expanded / 36px minimised, Right pane 52% / ~74%).
- Default tab on open: **Plan** (decision #7).
- Activity flows top-down newest-at-bottom (KNOWLEDGE.md 2026-05-02 correction).
- Plain-language thinking text (no engineering jargon).
- Empty states per spec §9.6.

**Error handling:**

- WebSocket disconnect: surface a banner "Reconnecting…" while the hook reconnects; existing `useSocketRoom` reconnect path drives the recovery.
- Missing task (404 from REST snapshot): redirect to Tasks list with toast "Task not found".

**Test considerations:**

- Per CLAUDE.md / spec §17.5, frontend unit tests are deferred at the framing level. Instead:
  - Pure logic in `openTaskViewPure.ts` is unit-tested via `npx tsx`.
  - Visual / interaction states are validated against mockups manually at integration time.
  - Static gates (lint, typecheck) catch regressions in component contracts.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx client/src/components/openTask/__tests__/openTaskViewPure.test.ts`

**Acceptance criteria:**

- Three-pane layout matches mock 07.
- Plan tab is the default tab on open.
- Activity is newest-at-bottom with auto-scroll + manual-scroll-pause + "↓ N new events" pill.
- Thinking box renders the latest `thinking.changed` event in plain language.
- Pause / Stop buttons visible only to users in the §14.5 visibility set.
- Empty states render per §9.6.
- Brief → Task labels in the page title and breadcrumb (full rename in Chunk 16).

**Dependencies:** Chunks 9 (`useTaskEventStream` hook), 10 (visibility role check for Pause/Stop). Chunks 12 (Ask card placeholder consumed), 13 (Files tab placeholder consumed) are downstream — Chunk 11 lands placeholders for both that the later chunks fill in.

---

### Chunk 12 — Ask form runtime

**Spec sections owned:** §3.2 (Ask `params` canonical shape), §11 (full): form-card primitive, V1 field renderer, validation, submission and state transitions, skip endpoint, autofill on re-run, routing UX.

**Scope.** Form card lives in chat panel (alongside Approval cards). Seven field types render. Client-side required + type validation. Submit / Skip endpoints. Auto-fill from last completed run. Routing surfaces (sidebar badge, "Waiting on you" page extended for Asks).

**Out of scope.** Studio Ask inspector (Chunk 14). File-upload field type (V2). Conditional fields (V2). Server-side custom regex validation (V2 per spec §11.3).

**Files to create:**

- `client/src/components/openTask/AskFormCard.tsx` — form card primitive. Amber-tinted, header + prompt + form fields + Submit / Skip buttons.
- `client/src/components/openTask/FormFieldRenderer.tsx` — maps field type → input component. Seven types per §11.2.
- `client/src/components/openTask/askFormValidationPure.ts` — pure validation: required-field check + type-specific check. Returns `{ valid: boolean, errors: Record<fieldKey, string> }`.
- `server/services/askFormSubmissionService.ts` — handler for submit and skip.
- `server/services/askFormAutoFillService.ts` — queries last successful run of the template-version; returns pre-fill values for keys whose key+type match.

**Files to modify:**

- `server/routes/workflowRuns.ts` (or new `server/routes/asks.ts`) — `POST /api/tasks/:taskId/ask/:stepId/submit` and `POST /api/tasks/:taskId/ask/:stepId/skip` per spec §11.4.1, §11.4.2.
- `server/services/workflowRunService.ts` — `submitStepInput` extended to honour the new gate-aware shape from Chunk 4 (already done) plus the Ask-specific outputs shape (`{ submittedBy, submittedAt, values, skipped }` per §11.4 step 3).
- `client/src/pages/WaitingOnYouPage.tsx` (existing review-queue page or new file) — extend to include Ask items alongside Approvals.
- `client/src/components/sidebar/*` — sidebar badge counts pending Asks alongside pending Approvals.

**Contracts pinned in this chunk:**

```typescript
// Ask params shape (from spec §3.2 — pinned in Chunk 1, restated for Chunk 12 reference)
// (full shape elided — see spec §3.2 line 200–222)

// POST /api/tasks/:taskId/ask/:stepId/submit
// Body: { values: Record<string, unknown> }
// 200: { ok: true } | 409 { error: 'already_submitted', submitted_by, submitted_at }
// 403: { error: 'not_in_submitter_pool' }

// POST /api/tasks/:taskId/ask/:stepId/skip
// Body: {}
// 200: { ok: true } | 409 { error: 'already_resolved', current_status, submitted_by, submitted_at }
// 403: { error: 'not_in_submitter_pool' }

// Outputs JSON for an Ask step (persisted on workflow_step_runs.outputJson):
{
  submitted_by: string,
  submitted_at: string,
  values: Record<string, unknown>,
  skipped: boolean
}
```

Auto-fill rule per spec §11.5 step 3: pre-fill where BOTH key AND type match. Type change = treat as new field, no pre-fill, no coercion.

**Error handling:**

- 403 `not_in_submitter_pool`: caller not in `gate.approver_pool_snapshot` for the Ask gate.
- 409 `already_submitted`: another submitter raced ahead.
- 400 client-side validation failures: per-field error inline; submit stays enabled.

**Test considerations:**

- `askFormValidationPure.test.ts` — every field type's required + type validation.
- `askFormSubmissionConcurrent.integration.test.ts` — two submitters race; one wins with 200; other gets 409.
- `askFormAutoFillSchemaChanged.test.ts` — field key matches but type changed → no pre-fill.
- `askFormSkipEndpoint.integration.test.ts` — skip honoured only when `params.allowSkip === true`.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/askFormSubmissionConcurrent.integration.test.ts`

**Acceptance criteria:**

- Form card renders all seven field types.
- Required-field validation runs client-side; submit disabled until valid (or stays enabled and re-runs validation, per spec §11.3).
- Submission persists outputs and emits `ask.submitted` event.
- Skip persists `skipped: true` and emits `ask.skipped`; downstream bindings to skipped fields resolve to `null`.
- Auto-fill respects key+type match invariant.
- Cross-subaccount routing works for org admin.

**Dependencies:** Chunks 4 (gate primitive — pool resolution + write contracts), 9 (event taxonomy includes `ask.queued/submitted/skipped`), 11 (open task view consumes the form card).

---

### Chunk 13 — Files tab + diff renderer

**Spec sections owned:** §12 (full): Files tab strip + reader, files-at-scale grouping, conversational editing flow, diff view + per-hunk revert, no inline editing.

**Scope.** Files tab UI. Document toolbar. Group switcher (Outputs / References / Versions). Latest-only toggle, search, sort. Conversational editing flow (chat-triage classifier extension already exists; this chunk wires up the file-edit detection + version creation). Inline diff renderer with per-hunk revert. Diff endpoint.

**Out of scope.** Side-by-side full-page diff (V2). Structured spreadsheet diff (V2 — V1 fallback is row-level counts). Diff against non-adjacent versions (V1 always diffs against immediately prior).

**Files to create:**

- `client/src/components/openTask/FilesTab.tsx` — strip + reader + group switcher + toggle + search + sort.
- `client/src/components/openTask/FileReader.tsx` — reader pane with document toolbar (Download + Open in new window) + version dropdown + diff toggle.
- `client/src/components/openTask/DiffRenderer.tsx` — inline strikethrough / highlight; per-hunk revert button.
- `client/src/components/openTask/filesTabPure.ts` — pure logic: group classification (Outputs vs References vs Versions), latest-only filter, sort comparators.
- `server/services/fileDiffService.ts` — diff computation (line-level for documents, row-level for spreadsheets). Deterministic output (same `(from_version, hunk_index)` resolves to the same change set).
- `server/services/fileDiffServicePure.ts` — pure diff algorithm + hunk identification.
- `server/services/fileRevertHunkService.ts` — `revertHunk(taskId, fileId, fromVersion, hunkIndex, organisationId, userId)`. Concurrency guard: verify current version is exactly `fromVersion + 1`; 409 if not. Idempotent: if hunk no longer present, 200 `already_absent`.
- `server/routes/fileRevert.ts` — `POST /api/tasks/:taskId/files/:fileId/revert-hunk`.

**Files to modify:**

- Existing chat-triage classifier — extend to detect file-edit intent (new heuristic added; agent then reads, edits, and commits the new version).
- File / version write path — emit `file.created` / `file.edited` events (Chunk 9 taxonomy).

**Contracts pinned in this chunk:**

```typescript
// POST /api/tasks/:taskId/files/:fileId/revert-hunk
// Body: { from_version: number, hunk_index: number }
// 200: { reverted: true, new_version: number }
// 200: { reverted: false, reason: 'already_absent' }
// 409: { error: 'base_version_changed', current_version: number }
// 403: { error: 'forbidden' }
```

Hunk identity invariant: `(file_id, from_version, hunk_index)` deterministically resolves to one change set. Diff algorithm is pinned (line-level for `text/*`, row-level for `text/csv` and `application/vnd.ms-excel`).

**Error handling:**

- 409 `base_version_changed`: current version > `from_version + 1`. Client surfaces "this draft has been edited again".
- 200 `already_absent`: hunk already reverted; idempotent.
- Diff computation failure (corrupt content): log + render "Diff unavailable" in the UI.

**Test considerations:**

- `fileDiffServicePure.test.ts` — diff determinism on a fixed pair of versions.
- `fileRevertHunkConcurrency.integration.test.ts` — concurrent revert attempts; one wins with 200, other gets 409 / `already_absent`.
- `filesTabPure.test.ts` — group classification logic.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/fileDiffServicePure.test.ts`

**Acceptance criteria:**

- Strip + reader render per mock 07.
- Group switcher works (Outputs / References / Versions).
- Diff toggle on the reader shows inline strikethrough + highlight.
- Per-hunk revert creates a new version atomically.
- Concurrency guard prevents stale-base reverts.

**Dependencies:** Chunks 9 (event emission for `file.created/edited`), 11 (Files tab placeholder).

---

### Chunk 14 — Studio canvas + inspectors

**Spec sections owned:** §3.3 (`workflow_drafts` lifecycle — open question 1 may revisit), §10 (full): canvas, four A's inspectors, Ask inspector deep-dive, publish flow with publish-notes modal, concurrent-editing handling, Studio handoff with draft hydration.

**Scope.** Studio is admin / power-user only — not in operator nav. Canvas-first authoring with slide-out inspectors per step type. Studio chat panel (docked bottom-left, expand to side panel) for big restructures via diff card. Bottom action bar with validation status + estimated cost + Publish button. Publish modal with optional notes. Last-write-wins concurrent edit handling. Draft hydration via `?fromDraft=:draftId`.

**Out of scope.** Visual node-graph editor (permanently out per brief §3). Inline file editing (out per brief §9.3). "Explain this workflow" inline explanations (V2). Visual diff between published versions (V2).

**Files to create:**

- `client/src/pages/StudioPage.tsx` — admin route at `/admin/workflows/:id/edit` and `/admin/workflows/new?fromDraft=:draftId`.
- `client/src/components/studio/StudioCanvas.tsx` — vertical step-card list, branching forks, parallel side-by-side, Approval-on-reject dashed back-arrow.
- `client/src/components/studio/StudioInspector.tsx` — slide-out container.
- `client/src/components/studio/inspectors/AgentInspector.tsx` — Agent step inspector (per mock 04).
- `client/src/components/studio/inspectors/ActionInspector.tsx` — Action step inspector.
- `client/src/components/studio/inspectors/AskInspector.tsx` — Ask inspector with five sub-states (per mock 09): default, Who-can-submit dropdown, Auto-fill dropdown, Add-a-field picker, edit-field-detail.
- `client/src/components/studio/inspectors/ApprovalInspector.tsx` — Approval inspector with confidence preview + audit-on-decision footnote (read-only).
- `client/src/components/studio/StudioChatPanel.tsx` — docked pill bottom-left; expands to left side-panel; agent diff cards with Apply / Discard.
- `client/src/components/studio/StudioBottomBar.tsx` — validation status + cost estimate + Publish button.
- `client/src/components/studio/PublishModal.tsx` — single optional textarea + Skip / Publish buttons. Concurrent-edit warning banner if upstream `updated_at` changed.
- `client/src/components/studio/studioCanvasPure.ts` — pure layout logic: branch fork rendering, parallel layout, validate-then-publish gating.
- `server/services/workflowDraftService.ts` — `workflow_drafts` CRUD: create, read by id, mark consumed, list-unconsumed for cleanup.
- `server/routes/workflowDrafts.ts` — `GET /api/workflow-drafts/:draftId` (Studio reads on `?fromDraft` open), `POST /api/workflow-drafts/:draftId/discard` (operator discard from chat).
- `server/services/workflowPublishService.ts` — wraps the existing `WorkflowTemplateService.publish` with publish-notes capture and concurrent-edit detection (compares `workflow_template_versions.updated_at` of the latest version against the user's snapshot).

**Files to modify:**

- `server/services/workflowTemplateService.ts` — `publish` accepts `publishNotes?: string` and persists to `workflow_template_versions.publish_notes` in the same transaction.
- `server/routes/workflowStudio.ts` (existing) — extend with the publish-notes-capable endpoint.
- `client/src/App.tsx` — register `/admin/workflows/:id/edit` and `/admin/workflows/new`.

**Contracts pinned in this chunk:**

```typescript
// POST /api/admin/workflows/:id/publish (extended)
// Body: { steps: WorkflowStep[], publishNotes?: string, expectedUpstreamUpdatedAt?: string }
// 200: { version_id: uuid, version_number: integer }
// 422: { error: 'validation_failed', errors: ValidatorError[] }
// 409: { error: 'concurrent_publish', upstream_updated_at: string, upstream_user_id: string }
//   (When expectedUpstreamUpdatedAt is provided and the latest version was published since.)

// GET /api/workflow-drafts/:draftId
// 200: { id, payload, sessionId, subaccountId, createdAt, updatedAt, consumedAt }
// 404: { error: 'draft_not_found' }
// 410: { error: 'draft_consumed', consumed_at }                          // already published / discarded
```

Concurrent-edit handling: optimistic UX. The Studio reads the latest version's `updated_at` on canvas open. On publish, the request includes `expectedUpstreamUpdatedAt`. If mismatch → 409 with the new upstream info; modal banner shown; user can Publish-anyway (omits the expected field on retry) or Cancel.

**Error handling:**

- 422 validation errors from Chunk 2 validator: render inline error pills next to the offending steps.
- 409 concurrent publish: render banner; user choice.
- 410 draft consumed: render "This draft was already used or discarded — start fresh?".

**Test considerations:**

- `studioCanvasPure.test.ts` — layout calculation logic.
- `workflowDraftServicePure.test.ts` — pure draft hydration logic.
- `workflowPublishConcurrentEdit.integration.test.ts` — two users editing the same template; second-to-publish gets 409.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/services/__tests__/workflowPublishConcurrentEdit.integration.test.ts`

**Acceptance criteria:**

- Studio canvas matches mock 05.
- Four A's inspectors match mock 04 + mock 09 (Ask sub-states).
- Publish modal matches mock 05 publish-notes inset.
- Concurrent-edit warning banner appears when upstream changed.
- Draft hydration on `?fromDraft=:draftId` populates the canvas.
- Discarding a draft sets `consumed_at`.

**Dependencies:** Chunks 2 (validator), 10 (User / Team pickers).

---

### Chunk 15 — Orchestrator changes

**Spec sections owned:** §13 (full): suggest-don't-decide pattern, draft hydration into Studio (server side; Chunk 14 owns the hydration UI), milestone reporting in chat, `workflow.run.start` skill.

**Scope.** Extend the existing orchestrator (`orchestratorFromTaskJob.ts` + chat-triage classifier) with:
1. Cadence-signal detection on the operator's prompt.
2. Recommendation card emission after task completion if signals score high.
3. Draft creation into `workflow_drafts` when intent looks workflow-shaped or when operator explicitly says "make this a workflow".
4. Per-agent `agent.milestone` event emission with attribution + link.
5. New `workflow.run.start` skill registered in `actionRegistry.ts` AND `SKILL_HANDLERS` (DEVELOPMENT_GUIDELINES §8.23 — both in the same commit).

**Out of scope.** Studio-side hydration UI (Chunk 14). Sub-agent reasoning trace surfacing in milestones (existing primitive). V2 workflow promotion ("promote agent run to workflow" — V2).

**Files to create:**

- `server/services/orchestratorCadenceDetectionPure.ts` — pure cadence detection. Inputs: prompt text + run history aggregates. Output: `{ score: number, signals: Array<{ name, weight }> }`. NLP heuristics per spec §13.1 (cadence cues like "every Monday", "weekly"; calendar phrasing; prior-run lookups).
- `server/services/orchestratorMilestoneEmitterPure.ts` — pure helper deciding whether a state change is a milestone (file produced, decision made, hand-off complete, plan changed materially) vs narration.
- `server/services/workflowRunStartSkillService.ts` — handler for the new skill. Validates `workflow_template_id` exists + caller has run-permission on its subaccount; resolves version (latest published unless pinned via `template_version_id`); creates a `tasks` row; starts the workflow run; returns `{ ok: true, task_id }` or structured error.

**Files to modify:**

- `server/jobs/orchestratorFromTaskJob.ts` — extend with:
  - Cadence-signal detection on the task's prompt.
  - Recommendation card emission via `taskEventService.appendAndEmit` with kind `chat.message` + a structured payload that the open task view's chat panel renders as a recommendation card (front-end logic in Chunk 11).
  - Draft creation: when intent classifier returns "workflow-shaped", call `workflowDraftService.upsertBySession` with the chat session_id + a payload (the orchestrator's draft step list).
- `server/services/skillExecutor.ts` — add `workflow.run.start` to `SKILL_HANDLERS`.
- `server/config/actionRegistry.ts` — register `workflow.run.start` (idempotency strategy: `keyed_write` with key on `(workflow_template_id, principal.userId, normalised_initial_inputs)`).
- Chat-triage classifier (existing) — extend to detect (a) "make this a workflow" intent, (b) file-edit intent (Chunk 13 also touches this).
- Per-agent skill / scope code — every sub-agent that completes a milestone-class action calls `emitMilestone(summary, linkRef)` helper. This is a fan-out across many existing skills; identify the call sites at chunk-time.

**Contracts pinned in this chunk:**

```typescript
// workflow.run.start skill input/output (spec §13.4)
{
  name: 'workflow.run.start',
  input: {
    workflow_template_id: string;
    template_version_id?: string;
    initial_inputs: Record<string, unknown>;
  },
  output:
    | { ok: true; task_id: string }
    | { ok: false; error: 'permission_denied' | 'template_not_found' | 'template_not_published' | 'inputs_invalid'; message: string };
}

// Recommendation card payload (rendered in the open task view's chat panel as a structured card)
{
  kind: 'chat.message',
  payload: {
    authorKind: 'agent',
    authorId: '<orchestrator-id>',
    body: 'This looks like something you'd want every Monday. Save it as a scheduled Workflow?',
    cardKind: 'workflow_recommendation',
    cardActions: [
      { id: 'accept', label: 'Yes, set up' },
      { id: 'decline', label: 'No thanks' }
    ]
  }
}
```

**Error handling:**

- `workflow.run.start` permission denial: structured error per output union.
- Cadence-detection failure: log; do not surface a recommendation. Fail-quiet.
- Draft creation fails (RLS, FK, etc.): log; orchestrator continues without offering Studio handoff.

**Test considerations:**

- `orchestratorCadenceDetectionPure.test.ts` — every signal in §13.1; threshold tuning.
- `orchestratorMilestoneEmitterPure.test.ts` — every milestone-vs-narration boundary.
- `workflowRunStartSkillPure.test.ts` — inputs validation, version resolution.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/orchestratorCadenceDetectionPure.test.ts`
- `npx tsx server/services/__tests__/orchestratorMilestoneEmitterPure.test.ts`
- `npx tsx server/services/__tests__/workflowRunStartSkillPure.test.ts`

**Acceptance criteria:**

- Cadence-signal recommendation surfaces only after task completion (not mid-flight).
- Drafts persist with `(subaccount_id, session_id)` UNIQUE.
- Milestone events emit per-agent; narration stays in activity (does not leak to chat).
- `workflow.run.start` skill is reachable from any agent with run-permission on the target subaccount; both ACTION_REGISTRY and SKILL_HANDLERS registered.

**Dependencies:** Chunks 9 (`agent.milestone` + `chat.message` event kinds), 14 (`workflow_drafts` table + service).

---

### Chunk 16 — Naming cleanup + cleanup job

**Spec sections owned:** §15 (full): Brief → Task UI rename. §16.3 #35a: `workflow_drafts` cleanup job. §18 (final migration polish + telemetry registry entries).

**Scope.** Smallest item in the build punch list. UI string + nav + route + redirect. Cleanup job for unconsumed `workflow_drafts` rows older than 7 days. Final telemetry-registry entries for the new event kinds. Final pass on docs (`architecture.md` Key files per domain, etc.) per `docs/doc-sync.md`.

**Files to create:**

- `server/jobs/workflowDraftsCleanupJob.ts` — pg-boss cleanup. Runs daily. SQL: `DELETE FROM workflow_drafts WHERE consumed_at IS NULL AND created_at < now() - interval '7 days'`. Mirrors `priorityFeedCleanupJob.ts` shape.

**Files to modify:**

- `client/src/components/sidebar/*` — "Briefs" → "Tasks" everywhere (one find-and-replace).
- `client/src/pages/BriefsPage.tsx` → rename to `TasksPage.tsx`. Update internal references.
- `client/src/pages/BriefDetailPage.tsx` → rename to (or merge into) `OpenTaskView.tsx` from Chunk 11. Update internal references.
- `client/src/components/NewBriefModal.tsx` → rename to `NewTaskModal.tsx`. Update strings.
- `client/src/App.tsx` — register `/tasks` routes; add redirect from `/briefs/:id` → `/tasks/:id` (preserves any existing `:id`). Existing `/briefs` nav links still work via the redirect.
- `server/templates/email/*` — string-replace "brief" → "task" where user-facing. Internal column references (e.g., `tasks.brief` content column) stay.
- i18n / translation files (if any) — update keys + values.
- `server/index.ts` — register the cleanup job worker.
- `architecture.md` § Key files per domain — add Workflows V1 entries (open task view page, Studio page, gate service, task event service, etc.). Per `docs/doc-sync.md`.
- `docs/capabilities.md` — extend the Workflows entry with V1 capabilities (vendor-neutral, per editorial rules — no engineering jargon).

**Contracts pinned in this chunk:**

- Redirect: `GET /briefs/:id` → 301 to `/tasks/:id`. Server-side route or client-side React Router redirect — architect picks at chunk-time. Both work.
- Cleanup job: runs daily at 03:00 UTC (mirroring existing cleanup-job pattern). Reaps drafts older than 7 days with `consumed_at IS NULL`.

**Error handling:**

- Cleanup job failure: log + retry per pg-boss policy. Drafts accumulate one extra day; non-critical.
- Redirect failure (route not registered): existing fallback `/tasks` route renders an empty state — graceful.

**Test considerations:**

- `workflowDraftsCleanupJobPure.test.ts` — pure SQL query construction.

**Verification commands:**

- `npm run lint`
- `npm run typecheck`
- `npm run build:client`
- `npx tsx server/jobs/__tests__/workflowDraftsCleanupJobPure.test.ts`

**Acceptance criteria:**

- Sidebar / breadcrumb / page titles all say "Tasks" not "Briefs".
- `/briefs/:id` redirects to `/tasks/:id`.
- Email templates use "task" in user-facing copy.
- Cleanup job reaps unconsumed drafts after 7 days.
- `architecture.md` and `docs/capabilities.md` updated.

**Dependencies:** Chunks 1 (`workflow_drafts` table), 11 (Tasks page lives in OpenTaskView), 14 (drafts service exists).

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`workflow_drafts` vs `workflow_studio_sessions` overlap** drives data-shape ambiguity (Open Q1) | Medium | High — wrong choice means rework | Resolve before Chunk 1 lands. Default to (a) — new table — per spec literal. Add a follow-up audit at Chunk 14 entry to validate the choice didn't fragment Studio session state. |
| **Per-task sequence allocation becomes a hotspot** under fan-out (FOR UPDATE contention) | Low V1, possibly Medium V2 | Medium — slows fan-out throughput | Spec acknowledges and defers a sharded counter to V2. Monitor `task_sequence` allocation latency in production; if p95 exceeds the sub-200ms latency budget under sustained fan-out, ship the shard. Until then, accept. |
| **WebSocket reconnect loses events when retention TTL is hit** (Open Q4 — 7d default) | Low — most reconnects within minutes | High when it happens — full reload required | Client implements `hasGap: true` recovery path (Chunk 9). Retention TTL conservative at 7 days; admin can configure if real reconnect-after-vacation patterns emerge. |
| **isCritical-rejected gates leave runs permanently stalled** (no V1 recovery) | Low — operator-driven, intentional | High when accidental rejection happens | Spec §5.2 acknowledges; V2 ships privileged resume. V1 recovery is Stop + re-fire. Studio inspector help text guides authors on `isCritical` semantics; reject-text on the Approval card warns "rejecting will stall the run." |
| **Confidence heuristic produces noisy or unhelpful chip values** in early production | Medium | Low — chip is decoration; doesn't gate | V1 captures `signals[]` for retrospective tuning. V2 calibrated model lands once 100+ Approval cards are reviewed. Threshold cut-points pinned in code (one-line change to retune). |
| **Cost-cap pause runs continuously hit the cap** because authors set it too low | Medium | Medium — operator friction | Telemetry `run.paused.cost_ceiling` surfaces the rate per template. Admin dashboard (V2) aggregates. V1: review per-template pause rate weekly via SQL during early production. |
| **Stall-and-notify jobs accumulate when many gates open simultaneously** (e.g., bulk run mode) | Low — bounded by gate count | Low — pg-boss handles; job names dedup | pg-boss native dedup on job name `(gateId, cadence)` prevents duplicates. Cancellation on resolve is best-effort; late-firing job no-ops. |
| **Brief → Task rename misses a string** (email, search index, audit log) | Medium | Low — cosmetic | Grep for "brief" / "Brief" in `client/src/`, `server/templates/`, and docs at Chunk 16 entry. Acceptance criteria lists the surfaces; manual QA pass before merging. |
| **Schema migration drift** between `workflow_runs` columns and the spec's intent | Low — additive only | High if a column is misnamed or wrong type | One migration per spec §3.1. Drizzle schema files updated atomically. Architect at Chunk 1 entry rereads §3.1 line-by-line against the migration SQL. |
| **`assertValidTransition` registry misses the new state-machine entries** for run + gate | Medium | Medium — terminal-state writes silently bypass guard | Chunk 1 + Chunk 4 + Chunk 7 each extend the registry. Verify by grepping `assertValidTransition('workflow_run'` etc. across the codebase at Chunk 7 close; add a unit test that exercises every valid + forbidden transition. |
| **Concurrent Studio publishes corrupt the version sequence** | Low — last-write-wins is intentional | Low — second user can re-publish | Last-write-wins per spec §10.5. UI banner warns. The `workflow_template_versions.version_number` is allocated server-side; no race. |
| **Cross-subaccount Asks expose data to the wrong sub-account** (RLS hole) | Low | Critical — tenant isolation | Spec §14.6 explicitly authorises org admin to route across subaccounts. Visibility is bound by the task's RLS, not the submitter's home subaccount. RLS verified via the existing gate suite (CI). |
| **Pre-existing violation #1 (pool-membership check) is missed** if Chunk 1 ships partial | High if not closed | Critical — data integrity | Pre-existing violation explicitly listed in Chunk 1 acceptance criteria. CI's `verify-rls-coverage.sh` does not catch this — it's an authz check, not RLS. Manual reviewer (`pr-reviewer`) verifies the route guard at Chunk 1 PR. |
| **Latency budget of sub-200ms event-emit-to-render is missed** | Medium — depends on infra | High — kills the demo experience | Synthetic load test ships in Chunk 9 verification. Optimistic rendering hides any latency to the operator (their actions render immediately). Server-side instrumentation (existing logger.info pattern) captures emit→ack timing per event for post-launch tuning. |
| **Telemetry cascade** — every event emit cascades through tracing, web-socket, log. If one cascade blocks the request path, hot-path latency degrades | Low — existing pattern is fire-and-forget | Medium | Existing `agentExecutionEventService` is already fire-and-forget per spec §4.1. New `taskEventService` mirrors. Soft-breaker pattern (KNOWLEDGE.md 2026-04-21 entry) available if a cascade misbehaves. |

---

## Deferred items routed to tasks/todo.md

These are spec-named V2 items NOT in this build's scope. The plan author SHOULD route each to `tasks/todo.md` so they're tracked for the next planning cycle.

(Plan executor: append the items below to `tasks/todo.md` as part of plan finalisation.)

| Item | Source | Reason for deferral |
|---|---|---|
| Mobile / phone-responsive layouts (V2 read-only single-pane fallback) | Spec §1.2, decision #1 | Three-pane real estate is desktop-only |
| Restricted-view mode for non-requester submitters on sensitive workflows | Spec §14.4 | Speculative until usage signals demand |
| Auto-escalation policies beyond stall-and-notify (per-step `escalateAfterHours`) | Spec §5.3 | Stall-and-notify covers V1 cases |
| Full structured spreadsheet diff | Spec §12.4, decision §19.1 #C | V1 ships row-level "added/removed/modified" counts |
| Audit drawer + audit export UIs | Spec §6.5 | Schema captures everything; UI awaits real audit-review usage |
| Cost dashboards across templates | Spec §1.2 | V1 ships per-run cost on the open task view |
| Run-history search across sub-accounts (admin tooling) | Spec §1.2 | V2 admin tooling |
| Calibrated confidence model (replaces V1 heuristic) | Spec §6.1 | Awaits 100+ Approval cards of training data |
| Conditional fields on Ask forms | Spec §11.2 | V2 — V1 ships seven static field types |
| File-upload field type on Ask | Spec §11.2 | V2 |
| Server-side custom regex validation, no-code forms-builder UI on Ask | Spec §11.3 | V2 |
| Side-by-side full-page diff for files | Spec §12.4 | V1 ships inline strikethrough |
| Diff between non-adjacent file versions | Spec §12.4 | V1 always diffs immediately prior |
| Promote agent run to workflow | Spec Deferred Items | Speculative |
| Visual diff between published workflow-template versions | Spec Deferred Items | V1 ships publish-notes |
| Workflow-template parameter UI (`paramsJson` on templates) | Spec Deferred Items | V1 uses Ask steps for runtime input |
| "Explain this workflow" / "What does this step do?" inline Studio explanations | Brief §10, spec Deferred Items | V2 — once V1 authoring patterns surface |
| Webhook triggers on workflow firing | Spec §1.2 | V2 — needs registration / secrets / replay surface |
| `isCritical`-rejected stall recovery path (privileged operator resume with override reason) | Spec §5.2 V2 note | V2 — V1 stalls and requires Stop + re-fire |
| Mid-step cap interruption (heartbeat checkpoints inside long-running steps) | Spec §7.4 | V2 — V1 is between-step only |
| Sharded per-task sequence counter for high-fan-out workloads | Spec §8.1 | V2 — pre-production load doesn't warrant |
| Frontend-surface unit tests (`*.test.tsx`) | Spec §17.5, `docs/spec-context.md` `frontend_tests: none_for_now` | Codebase-wide testing posture; revisit when posture flips |

**Open spec-time decisions also routed (architect refines at chunk-time, not blockers):**

- Confidence-chip threshold cut-points (Open Q2 / spec §19.1 #A).
- Cost-cap extension granularity (Open Q3 / spec §19.2 #G).
- Per-task event log retention TTL (Open Q4 / spec §8.1 minimum 24h recommended).
- Multi-select renderer threshold (Open Q5 / spec §19.2 #I).
- `is_critical` target table (Open Q6 / spec §19.2 #F).
- Plan-tab "trivial task" detection (spec §19.2 #K).
- Empty-state copy (spec §19.2 #L) — designer pass at component-build time.

---

## Spec coverage map

Every spec section is owned by a chunk OR routed to deferred. No section silently dropped.

| Spec section | Chunk(s) | Notes |
|---|---|---|
| §1 Summary, scope, related docs | covered by intro; spec-time decisions #1–#11 land in their respective chunks | |
| §2 Concepts and cross-references | covered by [System invariants](#system-invariants) + per-chunk references | |
| §3.1 New columns on existing tables | Chunk 1 | |
| §3.2 New `approval` step `params` shape | Chunks 1 (storage shape), 5 (resolution), 12 (Ask consumption) | Embedded in `definitionJson` |
| §3.3 New tables (`workflow_drafts`, `workflow_step_gates`) | Chunk 1 (schema), 4 (gate write path), 14 (drafts) | |
| §3.4 Indexes and constraints | Chunk 1 | |
| §3.5 What does NOT change in schema | Chunk 1 (verified) | |
| §4 Engine validator (4.0–4.8) | Chunk 2 | |
| §5.1 Approver pool resolution | Chunk 5 | |
| §5.1.1 Approval write contracts | Chunk 4 (write contracts), Chunk 5 (pool enforcement) | |
| §5.1.2 `/refresh-pool` endpoint | Chunk 5 | |
| §5.2 isCritical routing | Chunk 5 | V2 recovery path → deferred |
| §5.3 Stall-and-notify | Chunk 8 | |
| §5.4 Engine entry-points modified | Chunks 5 (gate-resolution + isCritical), 7 (cap monitoring), 8 (stall jobs + schedule pinning) | |
| §6.1–§6.5 Confidence + audit | Chunk 6; Plan-tab caption rendering Chunk 11 | Audit drawer V2 → deferred |
| §7.1–§7.6 Cost / wall-clock runaway | Chunk 7; UI rendering of pause card Chunk 11 | Mid-step interruption V2 → deferred |
| §8.1 Connection model + replay + ordering invariants | Chunks 3 (allocation), 9 (replay + client ordering) | |
| §8.2 Event taxonomy | Chunk 9 (taxonomy + validator) | |
| §8.3 Per-pane subscription | Chunk 11 | |
| §8.4 Optimistic rendering | Chunk 11 | |
| §8.5 Latency budget | Chunk 9 (synthetic load test in verification) | |
| §9 Open task view UI | Chunk 11 | Mobile fallback V2 → deferred |
| §10 Studio UI | Chunk 14 | |
| §11 Ask form runtime | Chunk 12 | File-upload + conditional fields V2 → deferred |
| §12 Files and conversational editing | Chunk 13 | Side-by-side diff + non-adjacent-version diff V2 → deferred |
| §13 Orchestrator changes | Chunk 15 | |
| §14 Permissions model | Chunk 10 | Restricted-view V2 → deferred |
| §15 Naming cleanup | Chunk 11 (page-title + breadcrumb), Chunk 16 (full sweep + redirect + email) | |
| §16 Build punch list | Per chunk; effort estimates revised in [Chunk overview](#chunk-overview) | |
| §17 Test plan | Per chunk's "Test considerations" + "Verification commands" sections | Frontend tests V2 → deferred per `spec-context.md` |
| §18 Migration plan and telemetry | Chunk 1 (migration), Chunk 16 (final telemetry registry entries + doc sync) | |
| §19 Open spec-time decisions | [Open questions](#open-questions-blocking-finalisation) + chunk-level architect calls | |
| Deferred Items section (1689–1716) | [Deferred items routed](#deferred-items-routed-to-taskstodomd) | |

---

## Self-consistency pass results

Reviewed the plan against the questions in `spec-authoring-checklist.md` § Self-consistency pass.

- **Goals ↔ Implementation match.** The model-collapse check explicitly rejects single-call collapse; the architecture notes pick deterministic primitives that match the spec's "Workflows orchestrate. Automations integrate." positioning.
- **Every spec section has a verdict.** Every section in the spec coverage map either maps to a chunk or is routed to deferred items.
- **Single-source-of-truth claims hold.**
  - Per-task sequence: `tasks.next_event_seq` counter is the single source. Allocation in same transaction as INSERT under FOR UPDATE.
  - Gate snapshot: `workflow_step_gates.seen_payload` / `seen_confidence` / `approver_pool_snapshot` are immutable post-open. Plan-tab reads from these, never current state.
  - Run completion: `workflow_runs.status` is the source. `running → succeeded` requires the per-step terminal verification.
  - Schedule version pinning: `pinned_template_version_id` overrides "latest" — pinned is the single source when set.
- **Non-functional claims match the execution model.**
  - "Sub-200ms latency budget" matches the existing fire-and-forget WebSocket pattern; verified via synthetic load test in Chunk 9.
  - "Stall-not-fail" matches pg-boss delayed jobs (Chunk 8) — no auto-fail mechanism even exists.
  - "Last-write-wins concurrent edit" matches the optimistic UX in Chunk 14 — no soft-lock primitive added.
- **Forward-only chunk dependencies.** The dependency graph in [Chunk overview](#chunk-overview) has no cycles. Chunk 4 depends on Chunks 1, 2 only. Chunks 5, 6, 7, 8 all depend on Chunk 4. Chunks 11, 14 depend on Chunks 9, 10. Chunks 12, 13, 15, 16 are leaves.
- **Idempotency posture pinned.** Every externally-triggered write declares its posture (Chunk 4 §5.1.1 / §11.4.1; Chunk 5 §5.1.2; Chunk 7 §7.5; Chunk 13 hunk-revert; Chunk 14 publish; Chunk 15 `workflow.run.start`).
- **Concurrency guards declared.** Chunk 4 (gate UNIQUE + step CAS); Chunk 5 (`/refresh-pool` CAS); Chunk 7 (run-status CAS); Chunk 12 (Ask first-commit-wins); Chunk 13 (file-version current-check); Chunk 14 (publish-notes concurrent-edit detection).
- **Terminal events declared.** Chunk 9 event taxonomy. Each cross-flow chain (Approval gate, Ask gate, run lifecycle, file edit) has exactly one terminal event per success / error branch.
- **State machine closure.** `workflow_run`, `workflow_step_run`, `workflow_step_gate` machines fully pinned with valid + forbidden transitions in Chunks 1, 4, 7. `assertValidTransition` registry extended in each.
- **Test posture matches CI-only rule.** Every chunk's verification commands list ONLY lint / typecheck / build:server|client / single targeted unit tests via `npx tsx`. NO `npm run test:gates`, NO `scripts/verify-*.sh`. Frontend unit tests deferred per spec §17.5 framing.
- **Spec-time decisions 1–11 reflected.**
  - #1 mobile → deferred. ✓
  - #2 stall-not-fail → Chunk 8. ✓
  - #3 non-requester full visibility → Chunk 10 §14.4. ✓
  - #4 cost / wall-clock pause → Chunk 7. ✓
  - #5 schedule version pinning → Chunks 1, 8. ✓
  - #6 empty states → Chunk 11 §9.6. ✓
  - #7 default tab Plan → Chunk 11 §9.4. ✓
  - #8 last-write-wins concurrent edit → Chunk 14 §10.5. ✓
  - #9 picker permission scoping → Chunk 10. ✓
  - #10 auto-fill no warning → Chunk 12. ✓
  - #11 effort re-estimate → Chunk overview revised down to ~40 days. ✓
- **System invariants block present** at top of plan. ✓
- **Pre-existing violations flagged** for Chunk 1. ✓
- **Open questions surfaced** for caller. ✓

---

## Executor notes

**Per `CLAUDE.md` test-gate contract — verbatim:**

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

**Per CLAUDE.md user prefs:**

- No auto-commits. The user commits explicitly after reviewing each chunk's PR.
- Concise communication, no emojis.
- No em-dashes in any UI copy, labels, or app-facing text. Use commas, colons, or rewrite the sentence.
- Stop and ask when requirements are ambiguous enough to affect architecture.

**Plan classification:** MAJOR. Per CLAUDE.md, this means `feature-coordinator` orchestrates the full pipeline (architect → implement chunk-by-chunk → `spec-conformance` per chunk → `pr-reviewer` per chunk). `dual-reviewer` and `adversarial-reviewer` are optional and require explicit user request.

**Plan-gate checkpoint per CLAUDE.md.** This plan is the input to `feature-coordinator`. The user reviews `tasks/builds/workflows-v1/plan.md`, then manually switches to Sonnet before proceeding to execution. The plan does NOT proceed to execution on Opus.

**Per-chunk acceptance ritual:** at the end of every chunk, the executor runs the chunk's listed verification commands, marks the chunk's TodoWrite item complete, and pauses for the user to commit + push. CI runs the full gate suite as the merge gate.

**Cross-spec consistency.** This plan introduces several primitives that touch existing specs (universal-brief, live-agent-execution-log, capability-aware-orchestrator). Architect at Chunk 11 entry should verify the open task view does not duplicate the existing brief surface; the spec is explicit (§15) that this is a UI vocabulary change, not a separate surface.

**Doc-sync at the end.** Chunk 16 includes the `architecture.md` Key files per domain update + `docs/capabilities.md` Workflows V1 section. Per CLAUDE.md §11 "Docs Stay In Sync With Code" — same commit as the relevant chunk, not a follow-up.

---

_End of plan. Ready for plan-gate review._






