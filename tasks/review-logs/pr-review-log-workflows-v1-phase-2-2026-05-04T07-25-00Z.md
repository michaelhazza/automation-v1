# PR Review Log — workflows-v1-phase-2

**Reviewer:** pr-reviewer (Opus 4.7)
**Branch:** `workflows-v1-phase-2`
**Base:** `main`
**Build slug:** `workflows-v1-phase-2`
**Spec:** `docs/workflows-dev-spec.md`
**Plan:** `tasks/builds/workflows-v1-phase-2/plan.md`
**Files reviewed:** Pre-chunk P0–P6 + Chunks 9–16 surface (126 changed files; focused on routes + services + websocket + jobs + open-task client surface; spec-conformance-deferred items not re-flagged).
**Review timestamp:** 2026-05-04T07:25:00Z

**Verdict:** CHANGES_REQUESTED (7 blocking, 6 strong, 5 non-blocking)

---

## Contents

1. Blocking Issues (B1–B7)
2. Strong Recommendations (S1–S6)
3. Non-Blocking Improvements (N1–N5)
4. Summary

---

## 1. Blocking Issues (must fix before marking done)

### B1 — `OpenTaskView` initial fetch hits a non-existent route — page is unreachable

**Files:**
- `client/src/pages/OpenTaskView.tsx:25`
- `client/src/components/openTask/ApprovalCard.tsx:14`

`OpenTaskView` mounts and immediately runs `api.get<TaskMeta>(`/api/tasks/${taskId}`)`. There is no server route at that path — the closest matches are `/api/subaccounts/:subaccountId/tasks/:itemId` (subaccount-scoped, requires path subaccountId) and `/api/briefs/:briefId` (the existing org-scoped task-meta endpoint). The 404 falls through the `.catch` clause, which calls `navigate('/admin/tasks', { replace: true })` — the user is bounced back to the inbox the instant they open any task. The whole Chunk 11 surface (chat / activity / right-pane tabs / files / inspectors) is reachable only by a direct route hit, then immediately ejected.

`ApprovalCard.tsx:14` has the same shape: it fetches `/api/tasks/${taskId}/gates/${gate.gateId}` — only `POST .../gates/:gateId/refresh-pool` exists in `server/routes/workflowGates.ts`. The GET is missing. Approval card details will fail to load; only the projection-derived shell renders.

**Fix:** Either point `OpenTaskView` at `/api/briefs/${taskId}` (it already returns `{ id, title, status }` plus conversationId per `server/routes/briefs.ts:90-104`), or add a new `GET /api/tasks/:taskId` route that returns the same task-meta shape. Add `GET /api/tasks/:taskId/gates/:gateId` for ApprovalCard. This is the minimum needed for the view to load at all.

### B2 — `appendAndEmitTaskEvent` callers pass `Date.now()` as `taskSequence`, poisoning the projection cursor

**Files:**
- `server/services/askFormSubmissionService.ts:123, 187`
- `server/services/fileRevertHunkService.ts:71`
- `server/services/workflowRunPauseStopService.ts:89, 241, 337`
- `server/services/workflowEngineService.ts:1615` (acknowledged TODO)

`shared/types/taskEvent.ts` and the spec define `taskSequence` as a per-task monotonically-increasing integer allocated against `tasks.next_event_seq`. The pure reducer in `client/src/hooks/useTaskProjectionPure.ts:35-39` advances `lastEventSeq = Math.max(prev.lastEventSeq, taskSequence)`; the polling delta-reconcile in `client/src/hooks/useTaskProjection.ts:51` then queries `?fromSeq=${prev.lastEventSeq}&fromSubseq=${prev.lastEventSubseq}`.

Once any of the seven call sites above fires (e.g. user pauses a run), an envelope arrives with `taskSequence ≈ 1.7e12`. The reducer pins `lastEventSeq` to that value. The next delta poll asks for `?fromSeq=1700000000000&fromSubseq=0`, which never returns rows because real DB-allocated sequences are single-digit. Live deltas are effectively dead between full-rebuild ticks (every 5 polls / 5 minutes, or every 20 minutes), so the UI silently loses freshness for ask-submit, file-edit, pause, resume, stop, and step-awaiting-approval state changes for up to 5 min after each such event.

The orchestrator job sites (`server/jobs/orchestratorFromTaskJob.ts:294, 321`) pass `0` instead — also wrong, but harmless because (a) the reducer never decreases `lastEventSeq` below `0`, and (b) `eventId = task:${taskId}:0:0:${kind}` collides on every emission, so all but the first get deduped on the client.

Compounding the problem: `appendAndEmitTaskEvent` does NOT persist to `agent_execution_events`. It is WS-only. The replay endpoint (`/api/tasks/:taskId/event-stream/replay`) reads exclusively from `agent_execution_events`. So a client that connects after a pause/resume/file-edit event fired will never see it on full rebuild either — the projection's pause/file/ask state is whatever the reducer recorded on the live socket, period.

**Fix:** Allocate `task_sequence` against `tasks.next_event_seq` inside the same transaction that writes the underlying state change (mirror `agentExecutionEventService.appendEvent`'s `UPDATE tasks SET next_event_seq = next_event_seq + 1 RETURNING next_event_seq`). Persist the event to `agent_execution_events` so replay works. The function signature already exposes `taskSequence: number`, so the caller signature stays the same — the inline allocation moves into the caller's transaction, or `appendAndEmitTaskEvent` grows an `allocate: true` mode that does the UPDATE itself when it doesn't already have a transaction handle.

If full transactional integration is too large for this branch, a minimum hot-fix that prevents cursor poisoning: have `appendAndEmitTaskEvent` allocate via a one-statement `UPDATE tasks SET next_event_seq = next_event_seq + 1 WHERE id = ${taskId} RETURNING next_event_seq`, and STILL persist the event row. The TODO comment at `workflowEngineService.ts:1617` is a known landmine; it must be resolved before the projection path is usable in production.

### B3 — `assignableUsers.ts` route missing `resolveSubaccount(...)` call

**File:** `server/routes/assignableUsers.ts:11-43`

The route is `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users` but never calls `resolveSubaccount(req.params.subaccountId, req.orgId!)`. `DEVELOPMENT_GUIDELINES.md §1` explicitly: *"Routes with `:subaccountId` must call `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming the ID."* The downstream `assignableUsersService.resolvePool` reads `subaccountUserAssignments` which has no RLS entry in `server/config/rlsProtectedTables.ts`; a same-org user who guesses a foreign subaccount UUID could enumerate that subaccount's user assignments via the route. The cross-org case is mitigated by `users.organisationId = orgId` filters inside the service, but the same-org cross-subaccount case is open.

**Fix:** Add `await resolveSubaccount(req.params.subaccountId, req.orgId!);` immediately after the org-id check at line 19, and pass `subaccount.id` (not the raw param) to the service. Detection gate `scripts/verify-subaccount-resolution.sh` will flag this if not fixed.

### B4 — `workflowDrafts` route does not verify `subaccount_id = resolvedSubaccount.id` (security-critical)

**File:** `server/routes/workflowDrafts.ts:26-87`

Already routed to `tasks/todo.md` by spec-conformance (REQ 14b-extra) but listed here because spec §3.3 explicitly classifies this as security-critical: *"every read endpoint MUST verify subaccount_id = resolvedSubaccount.id in the route handler — RLS only enforces org scope, so a same-org cross-subaccount read by ID would otherwise leak."* The current implementation only checks `(draftId, organisationId)` in `workflowDraftService.findById/markConsumed`. A same-org user with `AGENTS_VIEW` can fetch any draft created in any subaccount of the org, including drafts from subaccounts they have no `subaccountUserAssignments` row for.

**Fix:** Either pass an explicit `:subaccountId` segment in the route path and call `resolveSubaccount` (preferred — mirrors the spec route shape), or have the service accept the user's accessible-subaccount set and filter by it. The minimum hot-fix is to add a `subaccountId` filter in `findById` and `markConsumed` and require the route to pass it.

### B5 — Three task-scoped routes bypass the service tier (direct `db` access in route files)

**Files:**
- `server/routes/fileRevert.ts:39-43, 94-98` (task-org verification SELECT)
- `server/routes/taskEventStream.ts:41-46, 53-57` (task-org verification SELECT + min(taskSequence) aggregate)

Per `DEVELOPMENT_GUIDELINES.md §2`: *"Routes and `server/lib/**` never import `db` directly — call a service. Enforced by `scripts/verify-rls-contract-compliance.sh`."* All four blocks above import `getOrgScopedDb` and run SELECTs against `tasks` / `agentExecutionEvents` directly from the route. The CI gate will fail on this branch.

**Fix:** Move the task-org verification into a small `taskService.assertOrgOwnsTask(taskId, orgId)` helper, and move the gap-detection `min(taskSequence)` query into `agentExecutionEventService.getOldestRetainedTaskSequence(taskId)`. Routes call the helpers; gate passes.

### B6 — `workflowEngineService` direct `insert(workflowRuns)` paths bypass the `23505 → 409` conversion + miss the `taskId` invariant

**File:** `server/services/workflowEngineService.ts:2555-2569` (bulk fanout) and `:2806-2821` (replay)

This is the same pattern called out by spec-conformance REQ P1-8, but I'm escalating it from "deferred directional" to blocking because:

1. The bulk-fanout path does pass `taskId: childTask.id` (good), but if a same-task replay race ever fires the partial unique index `workflow_runs_one_active_per_task_idx`, the caller gets a raw Postgres error instead of the typed `TaskAlreadyHasActiveRunError → 409`. The plan's acceptance criterion P1-8 names *"zero matches outside `WorkflowRunService.startRun`"* explicitly.
2. The replay path is identical and a user double-clicking the replay button can race against itself.

**Fix:** Extract `WorkflowRunService.startRun`'s INSERT-and-23505-translate block into a private `insertRunRow(tx, values)` helper inside the service module, then call that helper from both engine sites. Three lines of change.

### B7 — Service-tier convention violations: bare `Error` thrown + non-shaped errors

**Files:**
- `server/services/workflowPublishService.ts:73` — `throw new Error('Version row not found after publish');` should be `throw { statusCode: 500, message: 'Version row not found after publish', errorCode: 'publish_inconsistent' };` per service-tier convention.
- `server/services/fileRevertHunkService.ts:28, 35-39, 49` — throws plain object literals with a `error:` (not `message:`) field; the route at `server/routes/fileRevert.ts:174-188` then matches on both `e.statusCode` and `e.error`. The convention is `{ statusCode, message, errorCode? }`. `error:` is an ad-hoc shape that won't be picked up by the global `asyncHandler` error renderer if the route handler doesn't translate it.
- `server/services/askFormSubmissionService.ts:56, 63-65, 78` — throws `{ statusCode, message: 'no_active_run_for_task' }`; the message slot is being misused as an error code (the route at `asks.ts:58-60` reads `shaped.message` and emits it as `error:`). Use `errorCode` for the machine-readable token; reserve `message` for prose.

**Fix:** Standardise on `{ statusCode, message, errorCode? }` across the new services and update routes to read `errorCode`. The architecture.md service-layer pattern is the canonical reference.

---

## 2. Strong Recommendations (should fix)

### S1 — `appendAndEmitTaskEvent` events are not durable; client full-rebuild is incomplete

This is the architectural twin of B2. Even after fixing the cursor poisoning, the `appendAndEmitTaskEvent` path does NOT persist to `agent_execution_events`, so the replay endpoint at `server/routes/taskEventStream.ts` cannot serve them on a fresh load. Any of the following are unrecoverable across a page refresh:

- `run.paused.by_user / cost_ceiling / wall_clock` (`workflowRunPauseStopService.ts:89, 241, 337`)
- `run.resumed`, `run.stopped.by_user` (same file)
- `ask.submitted`, `ask.skipped` (`askFormSubmissionService.ts:123, 187`)
- `file.edited` (`fileRevertHunkService.ts:71`)
- `chat.message`, `agent.milestone` (`orchestratorFromTaskJob.ts:294, 321`)
- `step.awaiting_approval` (`workflowEngineService.ts:1615`)

The `useTaskProjection` hook's full-rebuild branch (`client/src/hooks/useTaskProjection.ts:21-38`) replays events via the HTTP endpoint that returns only `agent_execution_events` rows — these synthetic events are silently absent. A user who opens an open-task view 30 seconds after a pause sees the run as "running" because the reducer's initial state has `runStatus: 'running'` and no event ever counters it.

**Fix as part of B2's resolution:** persist every `appendAndEmitTaskEvent` payload as a row in `agent_execution_events` with the allocated `(taskSequence, eventSubsequence)`. The schema already supports this (`migrations/0276_*` adds `task_id`, `task_sequence`, `event_subsequence`, `event_origin`, `event_schema_version`).

### S2 — Tests missing for `appendAndEmitTaskEvent` correctness

Given/When/Then specs the implementer should author then run via `npx tsx <path>`:

- **Given** a task with `next_event_seq=5`, **when** `appendAndEmitTaskEvent` fires twice in a row, **then** the two emitted envelopes carry `taskSequence: 6` and `taskSequence: 7` respectively, and `tasks.next_event_seq` is `7`.
- **Given** a task with five WS events emitted, **when** the client calls `/api/tasks/:taskId/event-stream/replay?fromSeq=0&fromSubseq=0`, **then** all five events are returned in `(taskSequence ASC, eventSubsequence ASC)` order.
- **Given** a paused workflow run and a connected client, **when** the user resumes the run, **then** the projection's `runStatus` transitions `paused → running` and the cursor advances by exactly 1 (not by `Date.now()`).

These would catch B2 + S1 in CI without anyone re-deriving the cursor logic.

### S3 — Fire-and-forget `workflowDraftService.create` in orchestrator job

**File:** `server/jobs/orchestratorFromTaskJob.ts:148-161`

The call is `workflowDraftService.create({...}).catch(...)` — not awaited. The orchestrator dispatch continues on line 174 before the draft INSERT completes. If the user navigates to the Studio via the cadence-recommendation card before the draft row commits, the StudioPage will fetch `/api/workflow-drafts/${draftId}` and 404. Probability is small (the dispatch loop is async too) but the ordering is unenforced.

**Fix:** `await` the create. The latency added is negligible (one INSERT) and the consistency win is real.

### S4 — `teams.ts` route `checkOrgId` returns `false`/early-returns instead of using a shared guard

**File:** `server/routes/teams.ts:9-15` — every handler invokes `if (!checkOrgId(req, res)) return;` as the first line. This is a custom local helper that duplicates what `requireOrgPermission` is supposed to enforce: it rejects when `req.params.orgId !== req.orgId!`. The pattern works but is not used anywhere else in the codebase — searches in `server/routes/` show every other org-scoped route either embeds the path-orgId in the permission middleware or uses a shared `assertPathOrgMatchesAuthOrg` helper (consistency win). Drives unnecessary divergence.

**Fix (low cost):** factor `checkOrgId` into `server/lib/assertPathOrgMatchesAuthOrg.ts` and reuse from teams + assignableUsers (which has its own copy at `:16-19`).

### S5 — `assignableUsersService.ts` queries are not protected against deleted-user leak in the org-level path

**File:** `server/services/assignableUsersService.ts:67-90` — the org-level branch filters `isNull(users.deletedAt)` (good). The subaccount-level branch at `:103-120` joins through `subaccountUserAssignments`, but `subaccountUserAssignments` itself is not filtered by `isNull(deletedAt)` (the schema may not have a `deletedAt` column on that table, in which case ignore — but if it does, this leaks tombstoned assignments). Verify against `server/db/schema/subaccountUserAssignments.ts`.

If no `deletedAt`, this is N/A. If yes, add the filter.

### S6 — `useTaskProjection` full-rebuild request is unbounded (no `?limit`)

**File:** `client/src/hooks/useTaskProjection.ts:25`

`api.get<...>(`/api/tasks/${taskId}/event-stream/replay?fromSeq=0&fromSubseq=0`)` does not pass a `limit` query param. The server enforces a server-side cap of 1000 (per `server/services/agentExecutionEventService.ts:687`), but never returns the cursor-end signal back to the client beyond `events.length` — the client doesn't paginate. A task with 1001+ retained events will silently truncate to 1000 and the projection will be missing the latest. Add a paginate-until-empty loop, or have the server return `hasMore` and have the client follow.

---

## 3. Non-Blocking Improvements

### N1 — `filesTabPure.ts` sort tiebreakers are primary-key only

`client/src/components/openTask/filesTabPure.ts:49-56` — `recent` / `oldest` / `author` sorts compare by a single key with no secondary tiebreaker. Per `DEVELOPMENT_GUIDELINES.md §8.17` (multi-source UI merges) and §8.21 (pure functions whose inputs may reorder), add a `.fileId` secondary tiebreaker so two files with the same `updatedAt` (e.g. created in the same batch) render in a deterministic order across renders.

### N2 — `taskEventService.ts` short-circuits on validation failure but doesn't surface to caller

`server/services/taskEventService.ts:31-38` — when `validateTaskEvent` or `validateEventOrigin` fails, the function returns `void` after a `logger.warn`. The caller has no signal that nothing was emitted. Consider returning `Promise<{ ok: true } | { ok: false, reason: string }>` so caller-side observability (counters, retries) can branch on it.

### N3 — `workflowDraftsCleanupJob.ts` deletes drafts older than 7 days but doesn't log per-org breakdown

`server/jobs/workflowDraftsCleanupJob.ts:20-30` — single admin-tx DELETE across all orgs, single log line `{ deleted }`. Per `DEVELOPMENT_GUIDELINES.md §2`: *"Maintenance jobs that advertise per-org partial-success use one admin transaction per organisation, or SAVEPOINT subtransactions inside an outer admin tx that holds the advisory lock — never a single shared admin tx across all orgs."* The cleanup doesn't advertise per-org partial-success today, so this isn't a hard violation, but the spec calls out this pattern as a gotcha. If a single broken row in one org's drafts ever blocks the entire job, all orgs lose cleanup. Move to per-org admin-tx + per-org log if the drafts table grows.

### N4 — `appendAndEmitTaskEvent` ignores `Promise` rejections at most call sites

Most callers do `void appendAndEmitTaskEvent(...)` (which suppresses the unhandled-rejection warning) but the orchestrator-job sites use `.catch((err: unknown) => logger.warn(...))`. Pick one pattern. The `.catch` shape is more debuggable; `void` loses the error entirely.

### N5 — `OpenTaskView.tsx:34` shows `Loading...` with three trailing dots

Cosmetic — many other pages in this codebase use `Loading…` (single ellipsis char) or just a spinner. Consistency.

---

## 4. Summary

The `workflows-v1-phase-2` branch lands a substantial multi-chunk surface and the spec-conformance review already routed 11 directional gaps to `tasks/todo.md`. The seven blocking items above are independent of those — they are correctness, security, and convention bugs that the spec-conformance pass does not cover.

The most serious are **B1** (the open-task view literally cannot load the task it's pointed at) and **B2** (the live event-stream cursor is poisoned by `Date.now()` and silently breaks delta reconciliation across the entire surface). B2 + S1 together mean the projection is non-replayable for half the event kinds; this needs to be the first fix.

After B1–B7 are resolved, re-run `pr-reviewer` against the expanded changeset. The strong-recommendation tests in S2 should land in the same PR as the B2 fix so CI gates against regression.
