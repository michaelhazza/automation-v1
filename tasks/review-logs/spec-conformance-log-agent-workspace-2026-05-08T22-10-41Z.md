# Spec Conformance Log

**Spec:** `tasks/builds/agent-workspace/spec.md`
**Spec commit at check:** `5e2231473d0c6bf0d932ee57b8976a82fb22a72b`
**Branch:** `claude/add-agent-cloud-compute-Kb4ii`
**Base:** `1e1d978f7bf9a0d7f27eb57238e1a0efe9fb4925` (merge-base with origin/main)
**Scope:** Phases 1, 2, 3, 4, 6 (all chunks except Chunk 12 — run-trace lineage chips, hard-blocked on Phase 1; deferred per spec)
**Changed-code set:** 96 files (full branch diff vs origin/main, less spec/plan/progress and review-log artifacts)
**Run at:** 2026-05-08T22-10-41Z
**Commit at finish:** `7ee4f417`

---

## Summary

- Requirements extracted:     61
- PASS:                       54
- MECHANICAL_GAP → fixed:      1
- DIRECTIONAL_GAP → deferred:  5
- AMBIGUOUS → deferred:        1
- OUT_OF_SCOPE → skipped:      0 (Chunk 12 / Phase 5 not extracted, per scope)

**Verdict:** CONFORMANT_AFTER_FIXES (1 mechanical gap closed in-session; 6 directional/ambiguous items deferred for operator decision)

---

## Requirements extracted (full checklist)

### Phase 1 — Schema + RLS + permissions + types

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 1 | migration | §6.1 / §5 Phase 1 inventory | PASS | `migrations/0295_agent_workspace_presence_and_sessions.sql:1-94` — `agent_observations` table, all columns, CHECK constraints, indices, RLS policy, immutability trigger, allowed bypass modes |
| 2 | migration | §6.2 | PASS | same file:96-137 — `iee_sessions` table, UNIQUE(run_id), status enum, release_reason enum, indices, RLS |
| 3 | migration | §6.3 | PASS | same file:139-191 — `agent_presence_projections`, all columns, all CHECK constraints (state enum, degraded_reason enum, degraded_base_state enum, consistency CHECKs), indices, RLS |
| 4 | migration | §6.4 | PASS | same file:193-246 — `agent_working_time_rollups` (composite PK), `agent_working_time_event_ledger` (PK = event_id), RLS on both |
| 5 | migration | §6.5 | PASS | same file:248-255 — `iee_artifacts` extended with `agent_run_id`, `producing_event_id`, `produced_version_id` + 3 partial indices |
| 6 | migration | §6.6 | PASS | `migrations/0296_agent_default_landing_tab.sql` — adds `users.default_agent_tab` with CHECK enum |
| 7 | schema | §5 Phase 1 | PASS | All 5 new schema files + 2 modified (`ieeArtifacts.ts`, `users.ts`); all exported via `index.ts:285-289` |
| 8 | manifest | §8 | PASS | `server/config/rlsProtectedTables.ts:1085-1114` — five new entries appended for migration 0295 |
| 9 | permission | §8 | PASS | `server/lib/permissions.ts:55, 108` — `AGENTS_OBSERVATIONS_PIN` and `AGENTS_PRESENCE_STREAM_SUBSCRIBE` keys defined; included in `ALL_PERMISSIONS` and Org Manager / Org Viewer default templates |
| 10 | type | §7.1, §11.7 | PASS | `shared/types/agentPresence.ts` — `AGENT_PRESENCE_STATES` (closed enum, 7 values), `CurrentFocus`, `PRESENCE_FRESHNESS_THRESHOLDS_MS` (all 6 constants matching §11.7 values exactly) |
| 11 | type | §7.3 | PASS | `shared/types/agentObservations.ts` — `OBSERVATION_TYPES`, `OBSERVATION_SOURCE_KINDS`, `AgentObservation` interface |
| 12 | type | §5 Phase 1 | PASS | `shared/types/agentExecutionLog.ts:92, 281-289` — `observation_emitted` event variant added with required fields and criticality entry |
| 13 | service | §4 Phase 1, §7.1 | PASS | `server/services/agentPresenceService.ts` + `agentPresenceServicePure.ts` — `resolveAgentPresence`, `applyEventToPresence`; resolution chain order matches §7.1 |
| 14 | service | §4 Phase 1, §7.3 | PASS | `server/services/agentObservationService.ts` + `agentObservationServicePure.ts` — `append()` with body validation (Buffer.byteLength UTF-8), DFS cycle guard with `SELECT ... FOR UPDATE` row locks, depth bound 32, idempotency-key dedupe, 23505 → return existing row |
| 15 | service | §7.5, §11.1 | PASS | `server/services/agentWorkingTimeService.ts` + `agentWorkingTimeServicePure.ts` — `applyEvent` with ledger PK idempotency check, `splitIntervalAcrossBuckets` with UTC half-open intervals + millisecond-sum invariant; pure `accumulateWorkingTime` returns the §7.5 named tuple |
| 16 | service | §4 Phase 1 | PASS | `server/services/agentExecutionEventServicePure.ts:130, 392-401` — `'retrievalService'` source service added; `observation_emitted` payload validator added |
| 17 | service | §4 Phase 1 | PASS | `server/services/agentExecutionService.ts` (diff) — observation-emit hook chained off retrieval-summary write; emits `observation_emitted` event after observation row inserts |
| 18 | constraint | §6.1, §11.5 | PASS | DB CHECK `octet_length(body) <= 8192` exists; service validator uses `Buffer.byteLength(body, 'utf8')` exactly as §7.3 R2-5 fix specified, throws `400 observation_body_too_large` |
| 19 | constraint | §7.3, §11.5 | PASS | `agentObservationService.append()` rejects supersession cycles with `409 supersession_cycle_detected`; depth bound 32 enforced; FOR UPDATE row locks acquired during DFS |
| 20 | trigger | §6.1 | PASS | `agent_observations_immutability_guard()` plpgsql function + BEFORE UPDATE OR DELETE trigger; default-deny posture; `retention_prune` and `pin` modes implement the §6.1 allow-list rules |

### Phase 2 — Overview tab + endpoints

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 21 | service | §7.4 | PASS | `server/services/agentOverviewAggregator.ts` — `buildOverviewPayload()` returns `OverviewPayload` shape matching §7.4 keys exactly |
| 22 | service | §9.1 | PASS | `agentOverviewAggregator.ts:122-144` — `subscribeFilesSnapshotInvalidators()` registers all 8 file-event types, with 24h log-suppression keyed on event-type |
| 23 | service | §7.3 read query | PASS | `agentOverviewAggregator.ts:374-394` — observations query orders by `desc(createdAt), desc(id)` (deterministic same-millisecond tiebreak per Round 2 spec fix R2-1) |
| 24 | route | §5 Phase 2 / §7.4 | PASS | `server/routes/agentOverview.ts` — all 8 endpoints registered, all gated by `requireOrgPermission(AGENTS_VIEW)` |
| 25 | route | §5 Phase 2 | PASS | `server/index.ts:62, 338` — `agentOverviewRouter` imported and mounted |
| 26 | client component | §5 Phase 2 inventory | PASS | All 13 components present in `client/src/components/agent-workspace/` |
| 27 | hook | §5 Phase 2 | PASS | `client/src/hooks/useAgentPresence.ts`, `useAgentOverview.ts`, `useAgentWorkingTime.ts` — all three present |
| 28 | client | §4 Phase 2 | PASS | `AgentEditPage.tsx` — `Overview` inserted as leftmost tab; `activeTab` defaults to `'overview'` |
| 29 | UI copy | §1.1 G8, §7.5 | PASS | `WorkingTimeChart.tsx:115` — caption "You're billed for this time only, not while the agent is idle" matches G8 verbatim |
| 30 | client | §13.6 | PASS | `useAgentPresence` exposes only the most-recent server-confirmed snapshot; `PresenceHero` uses `serverElapsedRef` reset from `elapsedSinceRunStartMs` |
| 31 | constraint | §6.6 | PASS | `users.default_agent_tab` CHECK enum matches the 10 spec-named tabs exactly |

### Phase 3 — SSE + Home widget

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 32 | service | §13.1.1 | PASS | `agentPresenceStreamPublisher.ts` — single-node in-process publisher; per-scope subscriber registry; per-scope ring buffer (300-event cap, sorted by `(eventTimestamp ASC, eventId ASC)`); 32KB per-event payload cap with 24h-suppressed truncation log |
| 33 | route | §13.2 | PASS | `agentPresenceStream.ts` — both endpoints gated by `AGENTS_VIEW` + `AGENTS_PRESENCE_STREAM_SUBSCRIBE`; reconnect via `Last-Event-ID` header (preferred) or `lastEventId` query param (fallback) |
| 34 | replay | §13.4 | PASS | `replaySinceLastEventId()` returns events after found id, full buffer if id not found, last 10 if null — matches §13.4 contract |
| 35 | client lib | §5 Phase 3 | PASS | `agentPresenceStream.ts`, `useWorkspacePresence.ts`, `orderHomePresenceSections.ts`, `announceLiveUpdate.ts` — all four files present |
| 36 | client component | §5 Phase 3 / §7.6 | PASS | `HomeActiveAgentsWidget.tsx` — sectioned widget with all 5 sections in spec order |
| 37 | client | §5 Phase 3 | PASS | `HomePage.tsx` — modified to use `HomeActiveAgentsWidget` |
| 38 | pure | §7.6 | PASS | `orderHomePresenceSections.ts` — implements section order, scheduled_next sorts by next_run_at ASC, all others by updated_at DESC, degraded floats into base-state section |
| 39 | accessibility | §13.8 | PASS | `announceLiveUpdate.ts` throttle helper exists; `HomeActiveAgentsWidget` uses `aria-live="polite"` |
| 40 | event | §13.3 | MECHANICAL_GAP → fixed | `agentPresenceStream.ts:71-82` — heartbeat interval was `30_000`, spec §13.3 says "every 15s"; fixed to `15_000` |

### Phase 4 — IEE session lifecycle + maintenance jobs

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 41 | service | §4 Phase 4 | PASS | `ieeSessionService.ts` — `createSession` (with 23505 → 409 mapping), `heartbeat`, `getSession`, `tearDown` (status `WHERE IN ('active','idle')` predicate; container release explicitly forbidden inside transaction by structure), `markFailed`, `recordSummary` |
| 42 | pure | §4 Phase 4, §16.1 | PASS | `ieeSessionServicePure.ts` — `decideIdleTimeout`, `classifyTeardownReason`, `detectOrphan`, `IEE_SESSION_IDLE_TIMEOUT_SECONDS = 300` |
| 43 | job | §4 Phase 4 / §6.7 | PASS | `ieeSessionOrphanCleanup.ts` — walks rows with NULL `released_at` whose `agent_runs.status` is terminal; calls `tearDown` with reason `'orphan_cleanup'` |
| 44 | job | §4 Phase 4 / §6.7 | PASS | `ieeSessionsCompactJob.ts` — daily 5am UTC; compacts summary blobs older than 90d for status IN ('torn_down','failed') |
| 45 | job | §4 Phase 4 / §6.7 | PASS | `agentObservationsPruneJob.ts` — daily 5:30am UTC; 1000-row batches ordered `(created_at ASC, id ASC)` `FOR UPDATE SKIP LOCKED`, loop-until-empty, per-batch transaction; sets `app.allow_observation_mutation = 'retention_prune'` GUC; emits `recordSecurityEvent` |
| 46 | job | §4 Phase 4 / §6.7 | PASS | `workingTimeRollupCompactJob.ts` — monthly 1st-of-month 6am UTC; collapses daily rows older than 1 year into monthly bucket via single CTE |
| 47 | scheduling | §4 Phase 4 | PASS | `queueService.ts` (diff +45 lines) — all four jobs registered with `boss.work` and scheduled with cron expressions matching the spec/plan |
| 48 | audit event | §6.1 | PASS | `shared/types/securityAuditEvents.ts` — new `agent.observations.retention_prune` event registered |

### Phase 6 — Capabilities & positioning rewrite

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 49 | docs | §14.1 | PASS | `docs/capabilities.md` (diff) — new `### Persistent Agent Workspace` section; IEE intro reframe; new `Hosted VM-per-agent platforms` row in Replaces / Consolidates; new "Working time accounting" bullet; changelog entry |
| 50 | docs | §14.3 | PASS | `docs/sales-conversation-vm-question.md` — present (per diff) |
| 51 | docs | §14.5 | PASS | Capabilities text uses workspace-language; "we don't have…" anti-pattern absent; vendor-neutral and marketing-ready per Editorial Rules |

### Doc-sync (Chunk 14)

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 52 | docs | §5 Doc-sync | PASS | `architecture.md` (diff +78 lines) — `Agent Workspace` anchor + section + Key files per domain table |
| 53 | docs | §5 Doc-sync | PASS | `KNOWLEDGE.md` (diff +20 lines) — 5 new patterns appended |
| 54 | docs | §5 Doc-sync | PASS | `progress.md` Chunk 14 doc-sync verdicts table covers 13 candidate docs |

### Cross-cutting / contract items

| # | Category | Spec section | Verdict | Evidence |
|---|---|---|---|---|
| 55 | contract | §11.1 watermark predicate | DIRECTIONAL | Implementation upsert WHERE clause uses cross-run `(timestamp, id) >` tuple only; spec §11.1 also names a per-run `(last_event_run_id, last_event_run_seq)` path. Both produce deterministic ordering. Could be intentional simplification; flagged for human judgement. |
| 56 | wire-up | §13.1.1 publisher topology | DIRECTIONAL | `agentPresenceStreamPublisher.fanOut()` is exported and tested but **not invoked** from any production code path. SSE channel will deliver only heartbeats + reconnect-replay until the wire-up lands. |
| 57 | client | §4 Phase 2 / Open Q 2 | DIRECTIONAL | `users.default_agent_tab` column added but never **read**; `AgentEditPage.tsx` hardcodes `'overview'`. Spec §17 Q2 says "v1 ships READ-ONLY: the column exists and the AgentEditPage reads it on mount." |
| 58 | service | §7.5 wait-state subtraction | DIRECTIONAL | `accumulateWorkingTime()` counts `step_started → step_completed` envelope only; spec §7.5 inclusion table requires subtraction of nested wait windows. JSDoc admits "simplified implementation". Reconciliation invariant in §11.6 holds for pure step pairs but breaks the moment a run waits on anything. |
| 59 | event | §13.3 server_heartbeat data shape | DIRECTIONAL | Spec says `data: { eventTimestamp, serverNow, lastEventId }`; impl sets `data: null` for heartbeats. `lastEventId` missing entirely. |
| 60 | bug | §6.7 working-time compact job | AMBIGUOUS | `workingTimeRollupCompactJob.ts:99` uses `RETURNING id` against `agent_working_time_rollups`, but that table has composite PK with no `id` column. Will fail at runtime. Code-quality bug rather than spec deviation; routed for `pr-reviewer` decision. |
| 61 | accessibility | §13.8 | PASS | No animations are gated, but no animations exist either. Spec rule vacuously satisfied. |

---

## Mechanical fixes applied

### `server/routes/agentPresenceStream.ts`

- **REQ #40** — heartbeat interval changed from `30_000` ms to `15_000` ms per spec §13.3 verbatim ("sent every 15s"). One-line edit; comment added pointing to spec §13.3. Surrounding code re-read; clean. Lint and typecheck both green after fix.

## Directional / ambiguous gaps (routed to tasks/todo.md)

See section *Deferred from spec-conformance review — agent-workspace (2026-05-08)* in `tasks/todo.md` (IDs `AGW-DEF-1` … `AGW-DEF-6`):

- **AGW-DEF-1** (REQ #55) — §11.1 watermark predicate: drop per-run sequence path or restore it.
- **AGW-DEF-2** (REQ #56) — wire `agentPresenceStreamPublisher.fanOut()` into projection-writer/observation-writer/working-time hooks. Without this the SSE channel is dead beyond heartbeats and replay.
- **AGW-DEF-3** (REQ #57) — wire `AgentEditPage` to read `users.default_agent_tab`; today the column is dead.
- **AGW-DEF-4** (REQ #58) — `accumulateWorkingTime` is missing wait-state subtraction; reconciliation invariant breaks on real runs.
- **AGW-DEF-5** (REQ #59) — `server_heartbeat` event payload shape mismatch (missing `lastEventId`).
- **AGW-DEF-6** (REQ #60) — `workingTimeRollupCompactJob` uses `RETURNING id` against composite-PK table; will fail at first run.

## Files modified by this run

- `server/routes/agentPresenceStream.ts` — heartbeat interval mechanical fix (15s)
- `tasks/todo.md` — deferred-items section appended (`AGW-DEF-1` … `AGW-DEF-6`)
- `tasks/review-logs/spec-conformance-log-agent-workspace-2026-05-08T22-10-41Z.md` — this log

## Next step

**CONFORMANT_AFTER_FIXES.** Mechanical gap closed in-session — re-run `pr-reviewer` on the expanded changed-code set so the reviewer sees the heartbeat-fix state. The 6 directional/ambiguous items are routed to `tasks/todo.md` for operator decision; none are blockers for `pr-reviewer` or merge gating, but **AGW-DEF-2** (SSE fan-out wire-up missing) is load-bearing for the §13.1.1 single-node topology contract and should be addressed before users see the Overview/Home surfaces in production. Operator should triage AGW-DEF-1…6 before tagging the branch MERGE_READY.
