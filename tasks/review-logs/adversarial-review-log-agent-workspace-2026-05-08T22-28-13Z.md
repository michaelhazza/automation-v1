# Adversarial Review Log — agent-workspace

**Branch:** `claude/add-agent-cloud-compute-Kb4ii`
**Build slug:** `agent-workspace`
**Review timestamp:** 2026-05-08T22:28:13Z
**Reviewer:** adversarial-reviewer (Sonnet 4.6)

**Files reviewed:**
- `migrations/0295_agent_workspace_presence_and_sessions.sql`
- `migrations/0296_agent_default_landing_tab.sql`
- `server/config/rlsProtectedTables.ts` (new entries)
- `server/routes/agentPresenceStream.ts`
- `server/routes/agentOverview.ts`
- `server/services/agentPresenceStreamPublisher.ts`
- `server/services/agentPresenceService.ts`
- `server/services/agentWorkingTimeService.ts`
- `server/services/agentObservationService.ts`
- `server/services/ieeSessionService.ts`
- `server/services/agentOverviewAggregator.ts`
- `server/services/agentWorkingTimeServicePure.ts`
- `server/db/schema/agentPresenceProjections.ts`
- `server/db/schema/agentObservations.ts`
- `server/db/schema/ieeSessions.ts`
- `server/db/schema/agentWorkingTimeRollups.ts`
- `server/db/schema/agentWorkingTimeEventLedger.ts`
- `server/jobs/ieeSessionOrphanCleanup.ts`
- `server/jobs/agentObservationsPruneJob.ts`
- `server/jobs/ieeSessionsCompactJob.ts`
- `server/jobs/workingTimeRollupCompactJob.ts`

---

**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes)

---

## 1. RLS / Tenant Isolation

### No findings

All six new tables (`agent_presence_projections`, `agent_observations`, `iee_sessions`, `agent_working_time_rollups`, `agent_working_time_event_ledger`, `iee_artifacts` additive columns) have `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and correct org-isolation policies using `current_setting('app.organisation_id', true)::uuid` in both `USING` and `WITH CHECK` clauses. All five new tables are listed in `rlsProtectedTables.ts` referencing migration `0295`. `iee_artifacts` (pre-existing, additive columns only) was already in the manifest at line 632.

Service-layer calls consistently use `getOrgScopedDb()`, which enforces an active org-scoped tx. Explicit `eq(table.organisationId, organisationId)` filters present on all reads. `isNull(agents.deletedAt)` applied in `buildOverviewPayload` agent lookup. No `req.user.organisationId` reads found — all use `req.orgId!` or `ctx.organisationId`.

---

## 2. Auth & Permissions

### FINDING 1 — `confirmed-hole` (AGW-ADV-1)

**File:** `server/routes/agentPresenceStream.ts:100-107`

**Attack scenario:** The agent-scoped SSE endpoint (`GET /api/agent-presence/stream/:agentId`) accepts `req.params.agentId` and constructs `PresenceScope = { kind: 'agent', agentId }` without verifying the agent belongs to `req.orgId`. An authenticated user from Org B who holds `AGENTS_VIEW + AGENTS_PRESENCE_STREAM_SUBSCRIBE` permissions (standard role grants — see `server/lib/permissions.ts:374,394`) can supply any UUID they discover (e.g. from a shared support ticket, an error log, or brute-force) and subscribe to the in-process ring buffer for that agent. Because `agentPresenceStreamPublisher.ts` keys all ring buffers and subscriptions by `agent:<agentId>` with no org dimension, the subscriber immediately receives up to 300 buffered events from the ring buffer (via `replaySinceLastEventId`) and then receives all future live presence events for that agent. These events include `presence_state_changed`, `current_focus_updated`, and `observation_appended` — i.e., real-time operational intelligence about Org A's agents. The subscription persists until the HTTP connection closes.

**Why this is confirmed:** The subscriber receives events from the shared in-process data structure; no DB query mediates the ring-buffer read, so RLS provides zero protection here.

**Suggested fix:** Before calling `sseSetup(res)`, verify agent ownership by querying `agents WHERE id = :agentId AND organisation_id = req.orgId AND deleted_at IS NULL`. Throw 404 if not found. The workspace-scoped endpoint (Endpoint 2, line 119) already does the equivalent via `resolveSubaccount` before flushing headers — replicate that pattern for the agent-scoped endpoint.

---

## 3. Race Conditions

### FINDING 2 — `likely-hole` (AGW-ADV-2)

**File:** `server/services/agentWorkingTimeService.ts:43-109`

**Attack scenario (split-brain between ledger and rollup):** The `applyEvent` function inserts the idempotency ledger row (line 44-53) and then — in the same logical `getOrgScopedDb()` transaction — performs one or more rollup upserts (lines 92-110). Because `getOrgScopedDb` returns the current org-scoped tx handle, all writes are in the same Postgres transaction and are atomic. However, between the ledger insert (line 44) and the first rollup upsert (line 92), the function unconditionally stores `stepStartMap.set(event.runId, ...)` for `step_started` events (line 63) and then returns **without** writing to the rollup. If the process restarts between a `step_started` ledger commit and the eventual `step_completed` that would pair with it, the `step_started` is marked as processed in the ledger (so it will never be replayed), but the matching in-process `stepStartMap` entry is lost, making the working time for that step unrecoverable.

**What this means:** The ledger is not a true idempotency guard for working-time calculation — it only prevents the `step_started` event from ever being re-processed. After a crash, the `step_completed` event arrives, `stepStartMap.get(event.runId)` returns undefined (line 72), and the function logs WARN and discards the step's contribution silently. The `step_completed` event's ledger entry is also written, preventing a future replay that could reconstruct the pair from a different code path. Working time for any in-flight step at the time of restart is silently under-counted.

**What would confirm:** The spec §7.5 bucket-split atomicity section — if it acknowledges this as an acceptable gap (start events during crash window are lost), this is a known trade-off rather than a hole. The issue is whether the ledger is marketed as "no-data-loss" idempotency when it actually prevents recovery.

---

## 4. Injection

### No findings

The `sql.raw(String(RETENTION_DAYS))` call at `agentObservationsPruneJob.ts:107` uses a compile-time constant `90` — not user input. No raw SQL string concatenation found. Drizzle parameterised queries used throughout. The supersession cycle guard uses `FOR UPDATE` row-locks with parameterised UUIDs.

The observation body 8KB cap is enforced both in the Postgres CHECK constraint (`agent_observations_body_size_cap`) and in the service layer at `agentObservationService.ts:32-35`.

---

## 5. Resource Abuse

### FINDING 3 — `likely-hole` (AGW-ADV-3)

**File:** `server/routes/agentOverview.ts:36, 50, 74`

**Attack scenario:** Three pagination endpoints (`/api/agents/:id/observations`, `/api/agents/:id/files-snapshot`, `/api/agents/:id/activity-feed`) parse `req.query.limit` via `parseInt(req.query.limit as string, 10)` with no upper cap and no NaN guard. A caller supplying `?limit=0` passes `0` to the service, `?limit=NaN` passes `NaN`, and `?limit=9999999` passes a large integer. The service functions are currently stubs returning empty arrays, so there is no immediate exploit, but the pattern will become a hole as soon as the stubs are replaced with real DB queries. A call with `limit=9999999` would issue an unbounded SELECT against `agent_observations`, `iee_artifacts`, or `agent_execution_events` (each potentially millions of rows for high-volume agents), causing a resource exhaustion DoS against the DB connection pool for the org.

**What would confirm:** Promote this to `confirmed-hole` once the stub implementations are replaced with real queries. At that point, a caller can issue a single authenticated request with an arbitrarily large limit and tie up the DB.

**Suggested fix:** Apply `Math.min(Math.max(parsed, 1), 200) || 50` (matching the pattern already used in `server/routes/agentCharges.ts:92` and `server/routes/activity.ts:72`) before passing the value to any service function.

---

## 6. Cross-Tenant Data Leakage

The confirmed-hole in category 2 is the primary cross-tenant leakage vector. Cross-referenced here.

**Additional observation:** The `subscriberRegistry` and `ringBuffers` module-level singletons in `agentPresenceStreamPublisher.ts` grow without a size bound on the number of distinct scope keys. An attacker (or a runaway client) that repeatedly subscribes to and then disconnects from arbitrary UUIDs would leave ring buffer entries for `agent:<random-uuid>` that are never evicted. The `insertIntoRingBuffer` function caps the per-key buffer at 300 events, but the map itself grows without limit as new keys are added. This is a cross-tenant concern only in that the attacker can use Org A's agent IDs to pre-warm entries.

---

## Additional observations

- `server/services/agentPresenceService.ts:148-170`: The TOCTOU window between reading `existing[0]?.presenceState` and the INSERT-ON-CONFLICT upsert means two concurrent events could both pass the legal-transition check and race to the upsert. The ON CONFLICT WHERE clause guarantees the latest-timestamp event wins, so the result is always a legal final state — this is intentional by design (§11.1 latest-wins). No security hole.
- `server/jobs/ieeSessionOrphanCleanup.ts:95-113`: `db.transaction` wraps a `withOrgTx` call with an explicit `set_config` before it — this is the correct maintenance-job pattern per `architecture.md § pattern 4`. No issue.
- `server/jobs/workingTimeRollupCompactJob.ts:84-107`: The DELETE and INSERT are in the same CTE within a single transaction — the compaction is atomic. No issue.
- Migration `0295` does not add a `NOT NULL` constraint on `agent_observations.supersedes_observation_id` (nullable FK is correct; self-referencing optional link). OK.
- `migrations/0296_agent_default_landing_tab.sql`: Adds `default_agent_tab` column to `users` table with a `CHECK` enum constraint and safe `NOT NULL DEFAULT 'overview'`. No RLS surface change. No issue.
