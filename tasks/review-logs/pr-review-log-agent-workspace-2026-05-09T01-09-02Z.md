# PR Review (round 2 — post-fix-loop-2 + S2 merge of origin/main) — agent-workspace

**Reviewed:** 2026-05-09T01:09:02Z
**Branch:** `claude/add-agent-cloud-compute-Kb4ii` vs `origin/main` (0 behind / 52 ahead, post-merge `d931116d`)
**Spec:** `tasks/builds/agent-workspace/spec.md` (LOCKED, 1599 lines)
**Plan:** `tasks/builds/agent-workspace/plan.md` (Rev 4 — migration renumber)
**Prior reviews:**
- Round 0: `pr-review-log-agent-workspace-2026-05-08T22-41-57Z.md` — 8 Blockers
- Round 1: `pr-review-log-agent-workspace-2026-05-09T00-23-16Z.md` — 4 new Blockers + 5 Strong
**Fix-loop round 2 commit inspected:** `ba956806`. Migration rename: `cbe5904f`. S2 merge: `d931116d`.

**Verdict:** APPROVED (zero Blockers; 4 Strong carry-overs + 1 new Strong)

---

## Round 1 Blocker disposition

| ID | Status | Evidence |
|----|--------|----------|
| **B-NEW-1** — run-step observation hook | **CLOSED** | `server/services/agentExecutionEventService.ts:192-227` adds the run-step hook: when `persisted.event.payload.observation` is present, dynamically imports `agentObservationService.append`, resolves `agentId` via `agentRuns` lookup, and writes the observation row with `metadata = { source_kind: 'run_step', source_id: event.id, summarised_from_step_seq: event.sequenceNumber, ...obs.metadata }`. Hook is fire-and-forget with proper error logging. `shared/types/agentExecutionLog.ts:20-24` defines `RunStepObservation`; `:206` and `:230` add `observation?: RunStepObservation` to `skill.completed` and `llm.completed` payload variants. |
| **B-NEW-2** — SSE 5-event-type fanout | **CLOSED** | Producer-side fanOut calls verified: `presence_state_changed` (existing), `current_focus_updated` (subtitle-change gated), `activity_row` (gated by `ACTIVITY_FEED_VISIBLE_TYPES` covering 11 event types from spec §7.7), `observation_appended` (post-INSERT, summary slice ≤240 chars), `working_time_bucket_updated` with explicit `bucketDate !== todayUtcDateString()` gate to active-bucket-only per spec §13.7. |
| **B-NEW-3** — SSE GET routes asyncHandler | **CLOSED** | Both GET handlers wrapped in `asyncHandler`, scope-mismatch throws `{ statusCode: 403, message }`, no manual try/catch. POST stream-token also uses `asyncHandler`. File internally consistent. |
| **B-NEW-4** — architecture.md auth scheme | **CLOSED** | Grep `authenticateSSE` in `architecture.md` returns 0 hits. `architecture.md:3935` describes the new design verbatim: short-lived signed stream-token (audience `agent-presence-stream`, 120s TTL, JWT-signed), in-memory only, passed as `?token=` on SSE GET, verified by `authenticateStreamToken` middleware which strips the token from `req.url` before logging. |
| **S2** — compact job partial/failed_runs | **CLOSED** | `workingTimeRollupCompactJob.ts:84-111` — CTE `monthly_agg` includes `SUM(failed_runs) AS fr, SUM(partial_runs) AS pr`; INSERT and ON CONFLICT UPDATE both reference `failed_runs` and `partial_runs`. No history loss beyond 1-year horizon. |

**Net round-2 closure:** 4/4 Blockers + 1 Strong all CLOSED on solid evidence.

---

## Post-merge regression check (origin/main absorbed)

| Check | Result |
|-------|--------|
| `agentExecutionService.ts` imports `getActionDefinition` (main) AND `ServicePrincipal` (branch) | OK — both imports present; retrieval-summary observation hook intact, includes `ServicePrincipal` ctx construction. |
| `permissions.ts` — `AGENTS_PRESENCE_STREAM_SUBSCRIBE` + `SCORECARDS_VIEW/MANAGE/BENCH_RUN` co-exist | OK — keys + role grants intact on both sides. |
| `server/index.ts` — both routers imported and mounted | OK — `scorecardsRouter` + `agentPresenceStreamRouter` co-exist. |
| `schema/index.ts` — both export blocks present | OK — Trust & Verification 4 schemas; Agent Workspace 5 schemas. No shadowing. |
| `rlsProtectedTables.ts` — Trust + Workspace entries co-exist | OK — Trust: 6 entries (0296-0300). Workspace: 5 entries (0305). Total 11 new entries since 0294. |
| Migrations 0305/0306 exist with correct names | OK — no collisions. |
| `users.ts` schema column `defaultAgentTab` matches migration 0306 | OK — typed as same 10-value union as the migration CHECK constraint. |
| `KNOWLEDGE.md` agent-workspace patterns retained | OK — entries cover SSE topology, monotonic clock, bounded payload, immutability GUC bypass, `withOrgTx` boundary. |

---

## Blocking Issues

**None.** Zero new Blockers introduced by fix-loop round 2 or the origin/main merge.

---

## Strong Recommendations

### S1 (carry-over). Idempotency UNIQUE on `agent_observations` is global, not org-scoped
Migration `0305_agent_workspace_presence_and_sessions.sql:22` — `CONSTRAINT agent_observations_dedupe UNIQUE (idempotency_key)`. Practically mitigated because the key derivation includes `event_id` (org-private UUID). Recommend follow-up migration to `UNIQUE (organisation_id, idempotency_key)` for defence-in-depth.

### S2 (carry-over). Permission-revocation lag on live SSE connections
`authenticateStreamToken.ts:52-57` — token verified but no live permission re-check. Lag bounded by 120s TTL. Either re-fetch permissions on each verify, or document the 120s lag in `architecture.md § Presence stream topology`.

### S3 (carry-over). Producer-wiring code has no test coverage
3 Vitest specs needed:
1. Run-step observation hook fires when payload carries `observation`.
2. `working_time_bucket_updated` is suppressed for non-today buckets.
3. `current_focus_updated` only fires on subtitle change.

### S4 (NEW). Dead `authenticateSSE` export presents a footgun
`server/middleware/auth.ts:190-214` still exports the legacy `authenticateSSE` middleware which accepts the long-lived auth JWT as `?token=`. No caller uses it (verified via grep). The middleware is the explicitly-rejected design — any future code importing it would get the long-lived-JWT-in-URL pattern that B3 was created to replace. Delete the export to prevent regression.

---

## Non-Blocking Improvements

### N1. Client-side SSE consumption coverage is partial
`useWorkspacePresence.ts` consumes `presence_state_changed` only. Other 4 SSE event types are emitted server-side but no client hook subscribes. Track as Chunk 6/7/8 follow-up.

### N2. Dynamic import in hot path
`agentExecutionEventService.ts:197` uses `await import('./agentObservationService.js')` per-event. ESM module cache makes cost negligible. Non-blocking.

---

## Verdict

**APPROVED** — fix-loop round 2 fully closed the 4 round-1 Blockers and the S2 strong. Post-merge integration clean. Migration renumber consistent across all artifacts. Remaining items are 4 Strong carry-overs plus 2 Non-Blocking. The branch is ready for dual-reviewer + doc-sync gate + Phase 2 handoff.

**Highest-priority follow-up:** S4 (delete dead `authenticateSSE` export — 1-line cleanup, prevents future regression).
