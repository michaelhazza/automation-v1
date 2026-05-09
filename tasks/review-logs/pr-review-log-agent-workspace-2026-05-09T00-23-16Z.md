# PR Review (re-review after fix-loop round 1) — agent-workspace

**Reviewed:** 2026-05-09T00:23:16Z
**Branch:** `claude/add-agent-cloud-compute-Kb4ii` vs `origin/main`
**Spec:** `tasks/builds/agent-workspace/spec.md` (LOCKED)
**Plan:** `tasks/builds/agent-workspace/plan.md` (Rev 3)
**Prior pr-review:** `pr-review-log-agent-workspace-2026-05-08T22-41-57Z.md` (CHANGES_REQUESTED, 8 Blockers)
**Fix-loop commits inspected:** `2f2a3ed3`, `54796eb9`, `b9f90b49`, `a9f1f2c4`

**Verdict:** CHANGES_REQUESTED (4 new blocking, 5 strong, 2 nice-to-have)

---

## Original Blocker disposition

| ID | Status | Evidence |
|----|--------|----------|
| B1 — Cross-tenant SSE leak | **CLOSED** | `agentPresenceStream.ts:172` calls `resolveAgent(req.params.agentId, req.orgId!)` before `attachStream`. Publisher scope key now `agent:${organisationId}:${agentId}`. PresenceScope agent variant requires `organisationId` (TS-enforced). Token-bound scope check prevents URL-vs-token mismatch. |
| B2 — Producer wiring | **PARTIAL** | Closed for `applyEventToPresence`, `applyWorkingTimeEvent`, and presence-side `fanOut`/`fanOutToWorkspace`. NOT closed for `agentObservationService.append` at run-step terminal-event boundary — only retrieval-summary path wired. Of 5 SSE event types declared in publisher union, only `presence_state_changed` + `server_heartbeat` are emitted anywhere. See B-NEW-1 and B-NEW-2. |
| B3 — SSE auth scheme | **CLOSED** | `POST /api/agent-presence/stream-token` issues 120s TTL signed token via `signStreamToken` with audience `agent-presence-stream`. Middleware verifies, populates req, strips token from `req.url` before logging. Client holds token in closure scope only. |
| B4 — RETURNING id | **CLOSED** | `workingTimeRollupCompactJob.ts:99` now `RETURNING bucket_date`. |
| B5 — Run-count columns | **CLOSED for happy path** | `agentWorkingTimeService.ts:124-157` handles `run.completed`, increments `successful_runs`/`failed_runs`/`total_run_count`. Two derivative gaps — see Strong S1, S2. |
| B6 — Working-time idempotency race | **CLOSED** | `stepStartMap` removed. `agentWorkingTimeService.ts:71-84` reads `step_started` from `agent_execution_events` at completion time. Multi-replica safe. |
| B7 — Observation idempotency key | **CLOSED** | Key formula = `sha256("${eventId}|${source_id ?? ''}|${observationType}|${normalisedBodyHash}")` — exact spec §1110 four-tuple. |
| B8 — Presence projection drops `subaccount_id` | **CLOSED** | INSERT and EXCLUDED branch both include `subaccount_id`. |

**Net:** 6 of 8 fully closed; B2 partial; B5 closed but with two derivative correctness gaps now downgraded to Strong.

---

## Blocking Issues (introduced or remaining)

### B-NEW-1. `agentObservationService.append` not hooked at run-step terminal events (B2 partial)
`server/services/agentExecutionService.ts:1700` — only `append()` call site is inside the `retrievalSummaryPromise.then(...)` continuation. Spec §847 mandates: `agentObservationService.append(...)` invoked from BOTH the run-step terminal-event hook AND the retrieval-summary handler. Without the run-step hook, no `learned`/`detected`/`decided`/`flagged`/`produced` typed observations from step output ever land. The Overview tab's most-emphasised card is functionally empty.

**Fix.** Add an observation-append hook at the run-step terminal-event boundary. Where the run-step result carries a typed-observation payload, call `agentObservationService.append({ agentId, eventId, observationType, body, metadata: { source_kind: 'run_step', source_id: eventId, summarised_from_step_seq } }, ctx)` after the event row is persisted.

### B-NEW-2. SSE channel only emits 1 of 5 specified event types
Producer-side grep finds only `presence_state_changed` (`agentPresenceService.ts:246`) and `server_heartbeat` (`agentPresenceStream.ts:84`). No producer fans out `current_focus_updated`, `observation_appended`, `activity_row`, or `working_time_bucket_updated`. Spec §13.7 freshness matrix promises <5s SSE current-focus, <10s SSE activity feed, <10s SSE recent observations, <30s SSE working-time-bucket. With only `presence_state_changed` flowing, every Overview card except the status pill misses its freshness target.

**Fix.** Emit each missing event type from the corresponding producer:
- `current_focus_updated` from `agentPresenceService.applyEventToPresence` whenever the resolved focus snapshot changes (spec §6.7).
- `observation_appended` from `agentObservationService.append` after row INSERT succeeds.
- `activity_row` from `agentExecutionEventService.appendEvent` for events that map to activity-feed-visible types (spec §7.7).
- `working_time_bucket_updated` from `agentWorkingTimeService.applyEvent` after each bucket UPSERT, scoped to the active-bucket case per §13.7.

### B-NEW-3. SSE GET routes use manual try/catch — route-convention violation
`server/routes/agentPresenceStream.ts:163-182, 190-209` — both GET handlers wrap the body in `try { ... } catch (err) { ... }` and inspect `err.statusCode` manually. `architecture.md` § Route Conventions explicitly: *"the manual try/catch pattern is deprecated and must not be used"*. The POST stream-token route 6 lines above uses `asyncHandler` correctly — same file is now inconsistent.

**Fix.** Wrap both GET handlers in `asyncHandler`. Throw `{ statusCode: 403, message: 'Token scope does not match requested agent' }` on scope mismatch. `resolveAgent` and `resolveSubaccount` already throw; let asyncHandler propagate.

### B-NEW-4. architecture.md § Presence stream topology describes the OLD auth scheme
`architecture.md:3887` — paragraph still describes `authenticateSSE` + `?token=<jwt>` + `localStorage` — the rejected design. Implementation uses `authenticateStreamToken` + separate signed stream-token (audience-bound, 120s TTL, in-memory only). CLAUDE.md §11 *Docs Stay In Sync With Code* requires same-commit doc updates. The fix-loop's `b9f90b49` left the old paragraph in place.

**Fix.** Replace the paragraph with: short-lived signed stream-token issued by `POST /api/agent-presence/stream-token` (audience `agent-presence-stream`, 120s TTL, signed with `JWT_SECRET`), held in client memory only (never localStorage), passed as `?token=` on the SSE GET URL, verified by `authenticateStreamToken` middleware which strips the token from `req.url` before logging.

---

## Strong Recommendations

### S1. Working-time `partial_runs` column never increments
`agentWorkingTimeService.ts:124-157` only branches on `finalStatus === 'completed'` vs not. `partial_runs` hard-coded to `0` in INSERT, absent from UPDATE SET. Spec §1150 *"No-silent-partial-success rule"* mandates `partial_runs += 1` when `run.terminal status === 'partial'`. Pure helper already encodes this. Deeper issue: no producer emits `run_partial` today. Either remove `partial_runs` from schema (deferred) or wire producer + apply-event branch.

### S2. Working-time compact job loses `failed_runs` and `partial_runs` history
`workingTimeRollupCompactJob.ts:84-107` — `monthly_agg` CTE only sums `working_time_seconds`, `total_run_count`, `successful_runs`. Schema's NOT NULL DEFAULT 0 masks the omission so INSERT works, but every monthly aggregate row beyond 1 year permanently shows `failed_runs = 0`. Future success-rate calculations against the older horizon over-report success rate.

**Fix.** Add `SUM(failed_runs) AS fr, SUM(partial_runs) AS pr` to CTE, INSERT column list, ON CONFLICT UPDATE clause.

### S3. Idempotency UNIQUE on `agent_observations` is global, NOT org-scoped (re-flagged with new severity)
Migration: `CONSTRAINT agent_observations_dedupe UNIQUE (idempotency_key)`. Now amplified by fix-loop: `agentObservationService.ts:114-128` looks up colliding row by `(idempotency_key, organisationId)` and throws `idempotency_key_collision_unresolvable` when row belongs to different org. Malicious org with knowledge of victim's `event_id + source_id + observation_type + body` can pre-empt the slot, causing victim's append to fail.

**Fix.** Migration follow-up: drop global unique, add `UNIQUE (organisation_id, idempotency_key)`.

### S4. Permission revocation has 120s lag on existing SSE connections
`authenticateStreamToken.ts:50-60` populates `req.user` from token claims with hard-coded `role: 'user'` and `email: ''`. No live permission re-check. If admin revokes `AGENTS_VIEW` after token issued, SSE continues until token expires (max 120s). Acceptable for short-lived tokens; document.

**Fix.** Re-fetch user permissions inside `authenticateStreamToken` and re-assert before populating `req`. Or document 120s lag in `architecture.md`.

### S5. New producer-wiring code has zero test coverage (re-flagged)
Fix-loop adds embodiment-pipeline wiring at `agentExecutionEventService.ts:164-188` and `applyEventToPresence` `fanOut` calls — none exercised by vitest. Original log's S5 asked for three Vitest specs; none exist.

---

## Nice-To-Have

### N1. Unused-import sweep
Verify `npm run lint` clean across the changed files in the fix-loop.

### N2. Repeated scope construction in route
`agentPresenceStream.ts:174` constructs scope inline once per route. Not worth refactoring.

---

## Verdict

**CHANGES_REQUESTED** — fix-loop round 1 closed 6 of 8 original Blockers on solid evidence (B1, B3, B4, B6, B7, B8), but introduced 2 new convention/doc Blockers (B-NEW-3 manual try/catch, B-NEW-4 architecture.md still describes old auth scheme) and left 1 Blocker partially closed with 2 derivative gaps (B-NEW-1 missing observation hook at run-step terminal, B-NEW-2 only 1 of 5 SSE event types emitted). Recommend fix-loop round 2 targeting B-NEW-1 through B-NEW-4 plus S2 (compact-job column loss).
