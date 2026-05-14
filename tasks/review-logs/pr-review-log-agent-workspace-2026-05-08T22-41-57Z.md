# PR Review — agent-workspace (Phase 2 close)

**Reviewed:** 2026-05-08T22:41:57Z
**Branch:** `claude/add-agent-cloud-compute-Kb4ii` vs `origin/main`
**Spec:** `tasks/builds/agent-workspace/spec.md` (LOCKED)
**Plan:** `tasks/builds/agent-workspace/plan.md` (Rev 3) — 13 of 14 chunks landed; Chunk 12 deferred (HARD-BLOCKED upstream, not flagged here).

**Verdict:** CHANGES_REQUESTED (8 blocking, 5 strong, 4 nice-to-have)

---

## Table of Contents

- Blocking Issues B1–B8
- Strong Recommendations S1–S5
- Nice-To-Have N1–N4
- Notes For Caller
- Verdict

---

## Blocking Issues

### B1. Cross-tenant SSE leak on agent-scoped stream — confirms AGW-ADV-1
`server/routes/agentPresenceStream.ts:93-108` — `GET /api/agent-presence/stream/:agentId` only checks `authenticate` + org permissions. It does NOT verify that `req.params.agentId` belongs to `req.orgId`. The publisher's `subscribe()` (`server/services/agentPresenceStreamPublisher.ts:168-186`) keys on `agent:${agentId}` only — no org tuple. Any authenticated user with `org.agents.view` who guesses/leaks an agent UUID from another org receives that org's presence events, current-focus text, run activity, etc. Spec §1028 explicitly mandates: "Cross-org leak guard for SSE … cross-org subscriptions are rejected at handshake time."

**Fix.** Before `attachStream`, fetch `agents` row (`getOrgScopedDb`, filter `eq(agents.id, agentId), eq(agents.organisationId, req.orgId), isNull(deletedAt)`) and 404 if not found. When `fanOut` is wired, include `organisationId` in the scope key.

### B2. Producer-side wiring missing for the entire embodiment pipeline
None of the new services are called from production code (only their own `*Pure.test.ts`):

- `agentPresenceService.applyEventToPresence` — never called.
- `agentWorkingTimeService.applyEvent` — never called.
- `agentObservationService.append` — never called.
- `agentPresenceStreamPublisher.fanOut` / `fanOutToWorkspace` — never called.

Plan §Chunk 4 specifies wiring `agentObservationService.append()` from the run-step terminal-event hook. Plan §Chunk 9: `fanOut(event)` invoked from `agentExecutionEventService` event tail. Neither is in `server/services/agentExecutionEventService.ts`. Result: presence projections never written, working-time rollups never written, SSE never receives anything except heartbeats, observations never created — Overview/Home dead.

**Fix.** Wire from `agentExecutionEventService.persistEvent` (after commit) or `emitEnvelope` to: `applyEventToPresence`, `agentWorkingTimeService.applyEvent`, and the SSE `fanOut`. `agentObservationService.append` hooks at the run-step terminal-event boundary in `agentExecutionService.ts` per spec §847.

### B3. SSE unauthenticated from the browser — auth scheme incompatibility
`client/src/lib/agentPresenceStream.ts:45` constructs `new EventSource(url)`. `EventSource` cannot set custom headers. `server/middleware/auth.ts:66-70` requires `Authorization: Bearer <jwt>` and the client stores the token in `localStorage`. Every browser-initiated SSE connection will receive 401.

**Fix options.** (a) accept token via short-lived signed query param on the SSE route; (b) issue HttpOnly auth cookie alongside JWT; (c) use `@microsoft/fetch-event-source` (supports headers). Pick one and document in `architecture.md`.

### B4. Working-time rollup compact job throws on every run — SQL references non-existent column
`server/jobs/workingTimeRollupCompactJob.ts:99` — `DELETE FROM agent_working_time_rollups … RETURNING id`. The table has composite PK `(organisation_id, agent_id, bucket_date)` with no `id` column. PostgreSQL fails with `column "id" does not exist`. Compaction never happens; tables grow unbounded.

**Fix.** Drop `RETURNING id` or use `RETURNING bucket_date`.

### B5. Working-time service never writes run-count columns
`server/services/agentWorkingTimeService.ts:92-109` — the upsert only touches `working_time_seconds` and `updated_at`. `successful_runs`, `failed_runs`, `partial_runs`, `total_run_count` never incremented. Caption renders "0 runs · 0% success" forever.

**Fix.** Handle `run.completed` / `run_failed` / `run.terminal.*` in `applyEvent`; mirror the pure helper `accumulateWorkingTime`.

### B6. Working-time idempotency ledger races against in-process step start
`server/services/agentWorkingTimeService.ts:43-65` — ledger insert commits "event processed" *before* `stepStartMap.set(event.runId, ms)`. Crash between commit and map-set means matching `step_completed` finds no start → working time lost. Compounds with multi-replica: `step_started` on worker 1, `step_completed` on worker 2 → no in-memory match.

**Fix.** Read the matching `step_started` event for the same `runId` from the events table at `step_completed` time. No in-memory state.

### B7. Observation idempotency key formula deviates from spec — silent observation loss
`server/services/agentObservationService.ts:39-41` — `sha256(agentId + eventId + observationType)`. Spec §1110 mandates `(event_id, source_id, observation_type, normalised_body_hash)`. Two distinct observations with the same `(agent, event, type)` but different bodies collide on the global UNIQUE index; service catches 23505 and returns the first observation as if it were the new one. Second observation lost without error.

**Fix.** Compute key from spec's four-tuple including normalised body hash and `metadata.source_id ?? ''`.

### B8. Presence projection upsert drops `subaccount_id`
`server/services/agentPresenceService.ts:174-225` — INSERT column list omits `subaccount_id`. Workspace-scope SSE and `agent_presence_projections_subaccount_idx` rely on it. Workspace-scoped subscriptions will see no agents.

**Fix.** Resolve `subaccountId` from agent → run linkage and include in INSERT and `EXCLUDED.subaccount_id` UPDATE branch.

---

## Strong Recommendations

### S1. Presence service has TOCTOU on legal-transition check
`agentPresenceService.applyEventToPresence:147-225` reads current `presence_state`, checks legality, then upserts. Two concurrent events can both pass the legality check against the same starting state. Watermark guard protects against stale writes but not transition legality.

**Fix.** Move legality check into SQL `WHERE` clause, or `SELECT … FOR UPDATE` per-agent.

### S2. In-process state for hysteresis and step-pairing breaks horizontal scale
`agentPresenceService.ts:24` (`hysteresisMap`) and `agentWorkingTimeService.ts:15` (`stepStartMap`) are module-level Maps. With multi-worker / multi-replica, hysteresis tracking and working-time pairing become non-deterministic. Spec §13.1.1 calls out single-node SSE only — does NOT extend to working-time / hysteresis.

**Fix.** Persist hysteresis state in `agent_presence_projections` (columns already exist). Persist step pairing in execution events (see B6).

### S3. Idempotency UNIQUE on `agent_observations` is global, not org-scoped
`migrations/0295_…sql:22` — `UNIQUE (idempotency_key)`. Once B7 fix includes `source_id` (potentially user-controlled), a malicious org could craft an observation that pre-empts another org's idempotency slot. Constrain to `(organisation_id, idempotency_key)` for defence in depth.

### S4. `tearDown` cannot return prior teardown's `release_reason`
`server/services/ieeSessionService.ts:115-163` returns `{ alreadyTornDown: true }` with no metadata. Spec §6.2 implies the second caller should see what reason previously released the session.

**Fix.** SELECT row when UPDATE returns 0 rows; surface `prevReason: row.release_reason`.

### S5. Test coverage gap for the producer wiring
Once B2 is fixed, the new emit hooks need three Vitest specs in `server/services/__tests__/`: observation hook idempotency, working-time hook UTC bucket split, SSE fanout scope isolation.

---

## Nice-To-Have

### N1. SSE heartbeat carries empty `agentId` for workspace scope
Make `agentId` optional on the `PresenceStreamEvent` type for non-agent-scoped events.

### N2. `agentOverviewAggregator.ts` uses inclusive ranges; spec §9 specifies half-open
`getWorkingTimeForRange:225-231` uses `gte`/`lte`. Document or align with `[startMs, endMs)`.

### N3. Maintenance jobs lack advisory locking
Optional defence: add `pg_try_advisory_xact_lock(orgIdHash)` per-org loop.

### N4. `subscribeFilesSnapshotInvalidators` logs subscriber-inactive on every boot
Consider one summary log instead of 8.

---

## Notes For Caller

- G2 (lint + typecheck) passed in 1 attempt — none of the blockers are typecheck-detectable (dead-code wiring, runtime SQL error, contract gap), consistent with the verdict.
- Adversarial review's AGW-ADV-1 is confirmed (B1). AGW-ADV-2/AGW-ADV-3 not separately validated — different surface; defer to adversarial log.
- spec-conformance returned `CONFORMANT_AFTER_FIXES` with 6 deferred items in `tasks/todo.md` (AGW-DEF-1..6). My B2/B5/B7/B8 may overlap with deferrals — implementer should cross-check before fixing duplicates.
- Chunk 12 deferral is not flagged (acknowledged HARD-BLOCKED on Phase 1).
- After fix-loop, re-run typecheck — B5/B7/B8 fixes touch SQL strings and may surface column-name typos.

## Verdict

**CHANGES_REQUESTED** — 8 blocking issues. The most important are B1 (cross-tenant SSE leak, also confirms adversarial finding), B2 (the entire embodiment pipeline is dead code because no producer calls it), B3 (SSE auth incompatibility breaks the Home widget), and B4 (working-time compact crashes on every run). B5–B8 are correctness gaps that prevent the Overview tab caption and observation pipeline from working as the spec mandates.
