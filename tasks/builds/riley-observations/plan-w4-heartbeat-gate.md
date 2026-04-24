# Riley Observations — W4 Heartbeat Activity-Gate

**Wave:** 4 of 4 (final wave)
**Source spec:** `docs/riley-observations-dev-spec.md` §7 (Part 4 — Heartbeat activity-gate), §10.1 row 5 (migration 0206), §11.2 Part 4 (test strategy), §12.4 (open questions 15–17)
**Classification:** Significant (new service, schema change, new telemetry event, UI edit, depends on prior waves)
**Estimated effort:** 1–2 engineer-days

## Dependencies

- **W1 (naming pass)** must have landed. Plan references post-rename tables (`workflow_runs`, `agent_runs`) and post-rename column names. If W1 has drifted from spec §4 / §13.2 during execution, re-confirm the rename target names before writing code.
- **W3 (context-assembly telemetry)** must have landed. The Wave 4 test strategy measures skip-rate via `heartbeat.tick.gated` telemetry in parallel with the W3 `context.assembly.complete` telemetry registered in `server/lib/tracing.ts`. W4 adds a new event to the same registry in the same file.

## Table of contents

1. Orientation
2. Architect decisions
3. Schema changes — migration 0206
4. Rule inventory (3 rules after dropping Rule 3)
5. File inventory — Edit vs Write
6. Mockup citations
7. Observability
8. Rollout posture
9. Test strategy
10. Reviewer checklist

---

## 1. Orientation

Part 4 ships a deterministic, rule-based pre-dispatch gate on the heartbeat path. The gate reads a handful of domain tables, evaluates three rules (down from the spec's four — see decision D1 below), and either dispatches the agent run or records a skip. No LLM involvement. Cheap, predictable, debuggable — specifically the opposite of an LLM-based signal detector, which §7.2 explicitly defers to v2.

The gate is **optimisation, not safety**. Its default posture is "when in doubt, run" (§7.5 error posture, §7.10 edge 3). Gate errors do not block dispatch — they dispatch and emit a telemetry event with `reason = 'gate_error'`. A permanent-silence guard (Rule 2 mandatory-run) prevents a broken gate or a bad threshold from stalling an agent for longer than `heartbeat_min_ticks_before_mandatory_run` ticks (default 6 = 24h at the 4h Portfolio Health cadence).

**Important substrate caveat.** The heartbeat dispatcher itself is not yet wired in this codebase (see `server/services/scheduleCalendarServicePure.ts` §comment at line 104: _"Any future heartbeat dispatcher must consume `computeNextHeartbeatAt` from this file so the projection and dispatcher stay bit-exact"_). The schema columns and the projection math are in place; the pg-boss handler that actually fires heartbeat ticks is the substrate W4 must extend. The architect's code-audit during the pre-plan search found heartbeat-related assets live in:

- `server/db/schema/agents.ts` — `heartbeatEnabled`, `heartbeatIntervalHours`, `heartbeatOffsetHours`, `heartbeatOffsetMinutes` (lines 50–53).
- `server/db/schema/subaccountAgents.ts` — same four columns (lines 43–46).
- `server/db/schema/systemAgents.ts` — same four columns on the blueprint (lines 45–48).
- `server/services/scheduleCalendarServicePure.ts` — projection math via `computeNextHeartbeatAt` (lines 119–138); this is where the dispatcher, when wired, must read from.
- `server/services/agentScheduleService.ts` — pg-boss cron-based scheduler for `AGENT_RUN_QUEUE` (cron-only, not heartbeat-interval-based). This file registers the cron-originated dispatch path and owns the service module shape the heartbeat dispatcher will extend.

**Wiring-the-dispatcher question — out of W4 scope.** If no heartbeat dispatcher exists in `main` at W4 start, W4 ships the gate as a callable pure/stateful service plus the column additions, AND wires a minimal dispatcher path that consumes it. The architect's recommendation is: build the dispatcher as a sibling to the cron path inside `agentScheduleService.ts` rather than invent a new service — it reuses `createWorker`, the pg-boss wiring, and the same `agentExecutionService.executeRun` contract. If the pre-build audit finds a dispatcher already in `main` (e.g. from a W1-adjacent change), W4 reduces to gate + column + edit-in-place on the existing dispatcher. Either way, the gate itself is the separable deliverable; the dispatch hook is the integration point.

The W4 builder session's very first step is to confirm which state the repo is in (dispatcher wired vs not). The file inventory below covers both variants.

## 2. Architect decisions

Three decisions the spec's §12.4 leaves to the architect. Each confirms the spec's recommendation or proposes an alternative with a one-sentence rationale.

| # | Decision | Spec reference | Outcome | Rationale |
|---|---|---|---|---|
| **D1** | Rule 3 "Check now" fate | §7.4 (Rule 3), §12.4.16 / F21 | **Confirm (b) — drop Rule 3 from v1.** The gate ships with 3 rules: event delta, mandatory-run (with first-tick branch), state flag. | The "Check now" trigger surface (button, route, column) does not exist in `main`; adding it would pull UI + route + schema work into W4 unnecessarily. Post-launch, if operators ask for it, a small follow-up adds a `subaccount_agents.check_now_requested_at timestamptz NULL` column plus a `POST /api/subaccount-agents/:id/check-now` route in one day. The `HeartbeatGateReason` enum still includes `'explicit_trigger'` as a reserved value (see §3 below) so post-launch rework is additive, not a breaking enum change. The spec's §7.5 `HeartbeatGateInput` and `HeartbeatGateDecision` types drop `explicitTriggerQueued` from `signalsEvaluated` in v1; re-add when Rule 3 lands. |
| **D2** | "Meaningful output" definition + update hook | §7.6, §12.4.17 / F22 | **Confirm the recommendation.** "Meaningful" = agent run completed with `agent_runs.status = 'completed'` AND (at least one action proposed OR at least one memory block written) during the run. The update hook lives in `server/services/agentRunFinalizationService.ts` — on a terminal-state transition where the run originated from the heartbeat path, the finalizer writes `subaccount_agents.last_meaningful_tick_at = now()` and resets `subaccount_agents.ticks_since_last_meaningful_run = 0` in the same transaction as the `agent_runs` status write. | Siting the hook at the run-terminal-state transition is the only write site that already holds the terminal `agent_runs` state under a row lock (see the finalizer's `FOR UPDATE` pattern at §Phase C / §8.1 of the IEE spec referenced in `agentRunFinalizationService.ts` header). Placing it elsewhere would require a second query to read the same status. "Action proposed" = one or more rows in `skill_action.proposed` tracing events for this `run_id`; "memory block written" = one or more rows in `memory_blocks` where `source_run_id = agent_runs.id`. The finalizer computes these via two `count(*)` queries inside the same tx. The condition is documented as a pure helper `isMeaningfulRun(runSummary)` exported from `agentRunFinalizationServicePure.ts` so the rule is testable in isolation. |
| **D3** | Event-source table list per heartbeat-enabled agent | §7.7, §12.4.15 | **Portfolio Health is the only currently-enabled heartbeat agent.** Per-agent source mapping: Portfolio Health uses the §7.7 table as-is (6 signals, minus "explicit trigger" which D1 drops → 5 signals). All other agents default to a generic fallback counting (any `agent_runs` + any `memory_blocks` writes scoped to the `(agent_id, subaccount_id)` pair). | Audit of `heartbeat_enabled` in `server/db/schema/*.ts` shows the column defaults to `false` on all three agent-tier tables (`agents`, `subaccount_agents`, `system_agents`) per the schema read above. No seed file in `server/config/` or `server/seeds/` explicitly sets `heartbeat_enabled = true`; the rollout posture in spec §7.11 and the brief "enable on Portfolio Health only" decision mean Portfolio Health will be the first (and likely only) agent flipped on in the first 2 weeks. The generic fallback covers the §7.10 edge case 5 (non-Portfolio-Health agents with the gate enabled) without requiring per-agent code; if a second agent needs domain-specific counting, it extends the per-agent source map rather than special-casing at the gate call site. |

These three decisions close the §12.4 open questions for Part 4. No further architect clarifications are required before build.

## 3. Schema changes — migration 0206

One forward migration + one down migration. Naming matches the spec §10.1 row 5 and the `_down/` convention from §10.1's opening paragraph.

### Files

- `migrations/0206_heartbeat_activity_gate.sql` — forward migration.
- `migrations/_down/0206_heartbeat_activity_gate.sql` — paired down migration. Drops every column added in forward, in reverse order.

### Forward DDL

```sql
-- ========================================================================
-- 0206_heartbeat_activity_gate.sql
-- Spec: docs/riley-observations-dev-spec.md §7 (Part 4) + §10.1 row 5.
-- Plan: tasks/builds/riley-observations/plan-w4-heartbeat-gate.md §3.
-- ========================================================================

-- ── Per-agent (org-tier) config ─────────────────────────────────────────
ALTER TABLE agents
  ADD COLUMN heartbeat_activity_gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN heartbeat_event_delta_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN heartbeat_min_ticks_before_mandatory_run integer NOT NULL DEFAULT 6;

-- ── Per-subaccount-link override (null = inherit from agents) ───────────
ALTER TABLE subaccount_agents
  ADD COLUMN heartbeat_activity_gate_enabled boolean NULL,
  ADD COLUMN heartbeat_event_delta_threshold integer NULL,
  ADD COLUMN heartbeat_min_ticks_before_mandatory_run integer NULL;

-- ── Tick-state tracking (per (agent, subaccount) link) ──────────────────
-- last_tick_evaluated_at: every gate evaluation (run OR skip) updates this.
--   Used as the event-delta cursor in Rule 1 and the "since last tick"
--   reference in the §7.7 signal queries.
-- last_meaningful_tick_at: only "meaningful" runs update this (see D2).
--   NULL → first tick branch in Rule 2 (always runs).
-- ticks_since_last_meaningful_run: monotonically incremented on every skip,
--   reset to 0 on every meaningful run. Used by Rule 2 (mandatory-run).
--   Duplicates a count(*) on gate telemetry but cheap to maintain and avoids
--   a scan of the tracing sink on every dispatch evaluation.
ALTER TABLE subaccount_agents
  ADD COLUMN last_tick_evaluated_at timestamptz NULL,
  ADD COLUMN last_meaningful_tick_at timestamptz NULL,
  ADD COLUMN ticks_since_last_meaningful_run integer NOT NULL DEFAULT 0;

-- ── Index to speed up the Rule 1 event-delta query on subaccount_agents ─
-- Not required for correctness; speeds the per-tick lookup in the hot path.
CREATE INDEX IF NOT EXISTS subaccount_agents_gate_lookup_idx
  ON subaccount_agents (agent_id, subaccount_id)
  WHERE heartbeat_activity_gate_enabled IS NOT NULL OR last_tick_evaluated_at IS NOT NULL;
```

### Down DDL

```sql
-- ========================================================================
-- _down/0206_heartbeat_activity_gate.sql
-- Reverse of 0206_heartbeat_activity_gate.sql.
-- ========================================================================

DROP INDEX IF EXISTS subaccount_agents_gate_lookup_idx;

ALTER TABLE subaccount_agents
  DROP COLUMN IF EXISTS ticks_since_last_meaningful_run,
  DROP COLUMN IF EXISTS last_meaningful_tick_at,
  DROP COLUMN IF EXISTS last_tick_evaluated_at,
  DROP COLUMN IF EXISTS heartbeat_min_ticks_before_mandatory_run,
  DROP COLUMN IF EXISTS heartbeat_event_delta_threshold,
  DROP COLUMN IF EXISTS heartbeat_activity_gate_enabled;

ALTER TABLE agents
  DROP COLUMN IF EXISTS heartbeat_min_ticks_before_mandatory_run,
  DROP COLUMN IF EXISTS heartbeat_event_delta_threshold,
  DROP COLUMN IF EXISTS heartbeat_activity_gate_enabled;
```

### Resolution precedence (from spec §7.3)

The override pattern mirrors the existing heartbeat config: `subaccount_agents.<col>` (if non-null) → `agents.<col>` → schema default. Implement this precedence once in the gate service's config-resolution helper (see §5 file inventory). Match the pattern already used in resolving `heartbeatEnabled` / `heartbeatIntervalHours` — grep `agentScheduleService.ts` and `scheduleCalendarService.ts` for that precedence chain and reuse the same reader helper if one already exists; otherwise add a small `resolveHeartbeatGateConfig(agent, subaccountAgent)` helper in the new gate pure module.

### Drizzle schema updates (not DDL — paired TypeScript edits)

These are required for the migration to be picked up by `drizzle-kit introspect`:

- `server/db/schema/agents.ts` — add `heartbeatActivityGateEnabled`, `heartbeatEventDeltaThreshold`, `heartbeatMinTicksBeforeMandatoryRun`.
- `server/db/schema/subaccountAgents.ts` — add the three override columns + the three tick-state columns.

No changes to `server/db/schema/systemAgents.ts` — the gate is per-agent config, not part of the blueprint. When a system-managed agent is instantiated to an org, the gate defaults to `false` at the schema level; operators enable per-agent on the admin edit page.

### RLS / manifest posture

`agents` and `subaccount_agents` are already tenant-scoped tables with existing RLS policies and entries in `server/config/rlsProtectedTables.ts`. Adding columns does not require new RLS work. Confirm in the build that `rlsProtectedTables.ts` and `verify-rls-coverage.sh` remain green — no new lines expected.

### No data migration needed

Per spec §10.1 closing paragraph: pre-launch posture means zero production rows in `agents` or `subaccount_agents` that would need a backfill. Defaults on every column keep existing row inserts working unchanged.

## 4. Rule inventory

Per decision D1, Rule 3 is dropped from v1. Three rules remain, evaluated in order. If any returns `true`, the gate dispatches. If all return `false`, the gate skips. Cites spec §7.4 for authoritative rule definitions; adapted here to reflect D1.

### Rule 1 — Event delta

**Condition:** `new_events_since_last_tick > config.heartbeat_event_delta_threshold`

**Action on true:** dispatch. Decision `reason = 'event_delta'`.

**Source columns read** (Portfolio Health per §7.7 table):

| Signal | Table | Query shape |
|---|---|---|
| New memory blocks | `memory_blocks` | `count(*) WHERE subaccount_id = ? AND created_at > last_tick_evaluated_at` |
| Onboarding state changes | `subaccount_onboarding_state` | `count(*) WHERE subaccount_id = ? AND updated_at > last_tick_evaluated_at` |
| Failed agent runs | `agent_runs` | `count(*) WHERE subaccount_id = ? AND status = 'failed' AND created_at > last_tick_evaluated_at` |
| Integration errors | `connections` | `count(*) WHERE subaccount_id = ? AND status = 'error' AND updated_at > last_tick_evaluated_at` |
| Pending review items | existing review-queue table (architect confirmed during build as part of §7.7 audit — see note below) | `count(*) WHERE subaccount_id = ? AND assigned_agent_id = ? AND status = 'pending'` |

**Signal sum:** the gate sums the counts from all five signals; the threshold compares against the sum. (Spec §7.4 phrasing `new_events_since_last_tick > threshold` is a single number.)

**Audit note on the review-queue table name.** Spec §7.7 flags this as "(existing review-queue table — audit)". During build, grep `server/db/schema/**/*.ts` for tables with `assigned_agent_id` or `pending` status — the likely candidates are the Slack-review / HITL-review tables landed in recent migrations. If no existing table matches, the gate treats this signal as constant-zero and the build raises a follow-up item in `tasks/todo.md` for a later surface; Rule 1 still functions on the other four signals.

**Generic fallback for non-Portfolio-Health agents:** sum of `count(*)` from `agent_runs` (any status, scoped to agent + subaccount, created_at > last_tick_evaluated_at) and `count(*)` from `memory_blocks` (scoped to subaccount, created_at > last_tick_evaluated_at). No domain-specific signals. Matches §7.10 edge 5.

### Rule 2 — Time-since-last-meaningful-output (with first-tick branch)

**Condition:**

```
last_meaningful_tick_at IS NULL
  OR
ticks_since_last_meaningful_run >= config.heartbeat_min_ticks_before_mandatory_run
```

**Action on true:** dispatch. Decision `reason = 'time_threshold'`.

**Source columns read:**

- `subaccount_agents.last_meaningful_tick_at` (nullable timestamp)
- `subaccount_agents.ticks_since_last_meaningful_run` (not-null integer)

The first-tick branch (`last_meaningful_tick_at IS NULL`) mechanically derives the §7.10 edge case 1 ("first tick after enabling — always run"). It is NOT a layered-on exception; it is the rule as written. No code in the gate special-cases "first tick" — the null check does the work.

### Rule 3 — State flag (was "Rule 4" in spec §7.4; renumbered here after D1 drop)

**Condition:** `subaccount_has_requires_attention_flag = true`

**Action on true:** dispatch. Decision `reason = 'state_flag'`.

**Source columns read** (Portfolio Health):

- Failed `agent_runs` in the last tick window (overlaps with Rule 1's "failed agent runs" signal, intentional — Rule 3 fires even if delta didn't exceed threshold).
- `connections.status = 'error'` for the subaccount (overlaps with Rule 1's integration-errors signal).
- Pending review items assigned to this agent (same table as Rule 1's review-queue signal).

**Implementation note.** Rules 1 and 3 can share one batched query that returns all five counts plus a boolean "any failed/error/pending present". This avoids round-tripping to the DB twice in the hot path. Budget: one SELECT per gate evaluation, target <20ms of the <50ms latency budget (§7.12 SC 4).

### "No signal" — default path

If all three rules return false, the gate skips. Decision `reason = 'no_signal'`.

### Error path

Any DB exception or unexpected error inside the gate → `reason = 'gate_error'`, `shouldRun = true`. Never skip on error (§7.5, §7.10 edge 3).

### Rule-order rationale

Rule 2 is cheap (two column reads from a row already loaded for config resolution) and should run first to short-circuit mandatory-run cases. Rule 1 is the most expensive (five counts). Rule 3 reuses Rule 1's query. Build order in code: **Rule 2 → Rule 1 (batched with Rule 3) → no-signal default.** This matches the <50ms p95 budget (SC 4).

## 5. File inventory — Edit vs Write

Complete inventory of files the builder session touches. Paths are absolute from the repo root. **E** = edit an existing file; **W** = write a new file.

### 5.1 Migration

| Op | Path | Notes |
|---|---|---|
| W | `migrations/0206_heartbeat_activity_gate.sql` | Forward DDL per §3. |
| W | `migrations/_down/0206_heartbeat_activity_gate.sql` | Paired down DDL per §3. |

### 5.2 Drizzle schema

| Op | Path | Notes |
|---|---|---|
| E | `server/db/schema/agents.ts` | Add `heartbeatActivityGateEnabled`, `heartbeatEventDeltaThreshold`, `heartbeatMinTicksBeforeMandatoryRun` columns. Match the camelCase convention of existing heartbeat fields at lines 50–53. |
| E | `server/db/schema/subaccountAgents.ts` | Add the three nullable override columns + `lastTickEvaluatedAt`, `lastMeaningfulTickAt`, `ticksSinceLastMeaningfulRun`. Slot alongside the existing heartbeat block at lines 42–46. |

### 5.3 Gate service (core deliverable)

| Op | Path | Notes |
|---|---|---|
| W | `server/services/heartbeatActivityGateServicePure.ts` | Pure module: rule evaluation only. Exports `evaluateHeartbeatGate(input: HeartbeatGateInput): HeartbeatGateDecision` (sync, no I/O) and the `isMeaningfulRun(runSummary)` helper used by the finalizer hook. Types: `HeartbeatGateInput`, `HeartbeatGateDecision`, `HeartbeatGateReason`. Follows the codebase's `*Pure.ts` pattern (see `agentExecutionServicePure.ts`, `scheduleCalendarServicePure.ts`, `agentRunFinalizationServicePure.ts`). Note: spec §7.5 defines this as async because it reads DB — we split the pure rule math from the stateful DB reader (see next row). |
| W | `server/services/heartbeatActivityGateService.ts` | Stateful wrapper: loads tick state + config + signal counts from the DB, hands them to the pure module, emits telemetry, and writes back the post-decision state to `subaccount_agents` (tick counters + `last_tick_evaluated_at`). Exposes `runGate(ctx)` as the single entry point the dispatcher calls. Uses `getOrgScopedDb('heartbeatActivityGateService')` per `architecture.md` §P3B principal-scoped RLS. |

### 5.4 Dispatcher integration

The existing `server/services/agentScheduleService.ts` handles **cron-based** `AGENT_RUN_QUEUE` scheduling only. It does not currently contain a heartbeat-interval dispatcher (see §1 orientation). Two paths:

**Path A — dispatcher NOT yet in `main` (expected state at W4 start).** Add the heartbeat dispatcher as a sibling to the cron path:

| Op | Path | Notes |
|---|---|---|
| E | `server/services/agentScheduleService.ts` | Add a new queue constant `AGENT_HEARTBEAT_QUEUE = 'agent-heartbeat-run'` + a `createWorker` registration in `initialize()` that consumes heartbeat ticks. The worker's handler: resolves config, loads tick state, calls `heartbeatActivityGateService.runGate(...)`, and either enqueues `AGENT_RUN_QUEUE` (dispatch path) or emits `heartbeat.tick.gated` (skip path). Add `registerAllActiveHeartbeats()` that mirrors `registerAllActiveSchedules()` but iterates `subaccount_agents WHERE heartbeat_enabled = true` (NOT `scheduleEnabled`) and calls `pgboss.schedule` with a cron derived from `heartbeatIntervalHours` + `heartbeatOffsetHours` + `heartbeatOffsetMinutes` — or, if pg-boss's interval-schedule API is used in this codebase, the interval-schedule equivalent. The cron/interval math MUST consume `computeNextHeartbeatAt` from `scheduleCalendarServicePure.ts` so projection and dispatch stay bit-exact (line 104 comment in that file). |
| E | `server/services/agentScheduleService.ts` | Extend `updateSchedule` (or add a paired `updateHeartbeat`) so that flipping `heartbeatEnabled` registers/unregisters the heartbeat schedule. Hook site is the existing `updateSchedule` branch that already calls `registerSchedule` / `unregisterSchedule` for cron. Use a dedicated `registerHeartbeat(subaccountAgentId, ...)` / `unregisterHeartbeat(...)` pair to keep cron and heartbeat dispatches independently schedulable. |

**Path B — dispatcher already in `main` (unexpected but possible from a W1-adjacent change).** Reduce scope:

| Op | Path | Notes |
|---|---|---|
| E | wherever the existing heartbeat dispatcher lives | Add the gate call: between the agent/config resolution step and the call to `agentExecutionService.executeRun`. Insert the skip-path branch (emit telemetry, update tick counters, return without executing). |

The builder's first step in the build session is grepping `server/` for `'agent-heartbeat'`, `heartbeat_enabled = true`, `heartbeatIntervalHours` call sites, and `pgboss.schedule.*heartbeat` to confirm which path applies. Default plan assumption: Path A.

### 5.5 Run-completion hook (D2)

| Op | Path | Notes |
|---|---|---|
| E | `server/services/agentRunFinalizationService.ts` | On terminal-state transition where the source run originated from the heartbeat path (detect via `agent_runs.run_source = 'scheduler'` AND `agent_runs.run_type = 'scheduled'` AND the triggering job ran through the heartbeat queue — exact predicate resolved during build; likely requires reading the run's `triggerContext` or a new `config_snapshot` field flagging heartbeat origin). If `isMeaningfulRun(summary)` returns true, write `subaccount_agents.last_meaningful_tick_at = now()` and `subaccount_agents.ticks_since_last_meaningful_run = 0` in the same tx. The condition check imports from `heartbeatActivityGateServicePure.ts`. |
| E | `server/services/agentRunFinalizationServicePure.ts` | Export `isMeaningfulRun(summary: { status: AgentRunStatus; actionsProposed: number; memoryBlocksWritten: number }): boolean`. Pure. Testable in isolation. |

**Heartbeat-origin detection alternative.** If reading from `run_source`/`run_type`/`triggerContext` in the finalizer is brittle, the cleaner path is to add a boolean `agent_runs.from_heartbeat` column in migration 0206 and set it at dispatch time. The architect recommendation is **not** to add the column in v1 — read from existing run-source fields first; only if that doesn't cleanly discriminate heartbeat-originated runs, promote to a schema change in a follow-up migration. Flag this to the reviewer during PR.

### 5.6 Telemetry registry

| Op | Path | Notes |
|---|---|---|
| E | `server/lib/tracing.ts` | Append `'heartbeat.tick.gated'` to `EVENT_NAMES` (see lines 53–86). Only one new event — the spec's §7.8 observability fires on both run and skip outcomes via the `shouldRun` field on the payload, so no separate `heartbeat.tick.dispatched` is needed. The event's type is `'heartbeat.tick.gated'` regardless of decision; readers filter by `shouldRun`. |

### 5.7 UI — Admin Agent Edit page (toggle only)

| Op | Path | Notes |
|---|---|---|
| E | `client/src/pages/AdminAgentEditPage.tsx` | Add a single toggle in the "Schedule & Concurrency" `SectionCard` (line 1410) immediately below the heartbeat interval/offset controls (line 1492, after `{form.heartbeatEnabled && (...)}` block closes) and above the concurrency divider (line 1495). Copy from mockup 10: label **"Skip ticks with no activity"**, help text **"Only runs when something's changed — prevents unnecessary cost."** Toggle maps to `form.heartbeatActivityGateEnabled` ↔ `agents.heartbeat_activity_gate_enabled` via the existing agent PATCH route (builder confirms route file `server/routes/agents.ts` and Zod schema accept the new field during build). |
| E | `client/src/pages/AdminAgentEditPage.tsx` | Extend the `AgentForm` interface (lines 19–44) with `heartbeatActivityGateEnabled: boolean`. No other form field changes (thresholds are NOT exposed — §3a.2 lock 3). |

**Files NOT in the inventory** (explicit exclusions):

- No route-file edit for a "check now" endpoint (D1 drops Rule 3).
- No admin observability dashboard (§7.9 + §3a.2 lock 3).
- No `SubaccountAgentEditPage.tsx` edit — gate is org-agent level only in v1. Per-link overrides exist in schema (nullable columns) but are not form-exposed; system-admin DBA action is the only way to set them in v1.
- No `server/routes/agents.ts` full-file rewrite — builder adds the one Zod field to the existing PATCH body schema (`server/schemas/agents.ts` or inline), no new routes. Flag if the builder finds the route/schema shape requires more than the single field addition.
- No new seed data — Portfolio Health stays disabled by default (§7.11); an operator enables via the toggle post-migration.

### 5.8 Test files

Per spec §11.2 Part 4 + pure-function-only runtime test posture:

| Op | Path | Notes |
|---|---|---|
| W | `server/services/heartbeatActivityGateServicePure.test.ts` | Unit test matrix: every combination of the three rules (12 inputs covering event-delta over/under threshold, first-tick / ticks-over-min / ticks-under-min, state-flag set / unset). Plus error path. |
| W | `server/services/agentRunFinalizationServicePure.test.ts` | If not already present — add `isMeaningfulRun` matrix: every combination of `status ∈ {'completed', 'partial', 'failed'}` × `actionsProposed ∈ {0, 1+}` × `memoryBlocksWritten ∈ {0, 1+}`. Expect only `status='completed' AND (actions+memory ≥ 1)` returns true. |

Integration tests (spec §11.2 lines 1797–1799) — "enable gate on test agent; force state where no rule fires; assert skip emits telemetry"; "gate throws → run proceeds"; "6 consecutive skips → 7th tick forces run" — are documented as expected coverage but the implementation classification for composition/integration tests follows the codebase posture (`static_gates_primary`, `composition_tests: defer_until_stabilisation`). **Architect deviation flag:** these three integration scenarios sit in the "defer until stabilisation" bucket per `docs/spec-context.md`. Options: (a) defer per framing, with a comment in the pure unit tests citing the integration intent; (b) write them anyway as a framing deviation, flagged explicitly in the builder's PR description. Architect recommendation: **(a) defer.** The three scenarios are already derivable from the pure-unit matrix plus the mandatory-run rule. The builder documents the skipped scenarios in `tasks/todo.md` under a dedicated "Deferred integration tests — heartbeat gate" heading for a later harness pass.

## 6. Mockup citations

Mockup 10 binds the UI for W4. It is the same mockup W2 uses for the Explore/Execute Mode addition; the two Parts share the same Schedule & Concurrency section of `AdminAgentEditPage.tsx` and therefore share a mock page.

- **File:** `/home/user/automation-v1/prototypes/riley-observations/10-agent-config-page.html`
- **Lines 97–104 — the new heartbeat activity-gate toggle block.** Specifically the `<!-- NEW field: heartbeat activity gate (§7.9) -->` comment at line 97 through the closing `</div>` at line 104. This is the exact binding surface for W4.
- **Line 100 — label copy:** `"Skip ticks with no activity"` (build uses this verbatim; the `<span class="new-pill">new</span>` tag is a mockup-only artifact and not part of the shipped UI).
- **Line 101 — help text copy:** `"Only runs a tick when something changed. Prevents unnecessary cost."` (slight variation from spec §7.9's `"Only runs when something's changed — prevents unnecessary cost."` — builder picks one and holds it; architect preference: **spec wording** since the spec is the authoritative source for user-facing copy, mockup comments are secondary).
- **Lines 66–105 — enclosing "Schedule & Concurrency" section** — confirms the new toggle slots INSIDE the existing section, not as a new section. The mock's `border-t border-dashed border-indigo-200` decoration at line 98 is a mockup-only visual divider; ship without it (the section already has its own `mt-5 pt-4` spacing via the SectionCard component in `AdminAgentEditPage.tsx`).
- **Lines 107–116 — the Default safety mode section — belongs to W2, NOT W4.** The W4 builder does not touch it. Called out here only to prevent accidental scope creep during the UI edit.
- **Line 131 — footer note confirms** the surgical nature of the addition and names the file path `client/src/pages/AdminAgentEditPage.tsx` with the target range `~lines 1410–1531` (see §5.7 above for the refined range after reading the current file — 1410–1566 is the actual SectionCard span; insert point is ~1492).

## 7. Observability

Cites spec §7.8 (lines 1422–1447).

### 7.1 Registered events

One new event, added to `server/lib/tracing.ts` `EVENT_NAMES` (currently ends at line 86). Appends immediately after the existing `'llm.router.reconciliation_required'` entry:

```typescript
// ── Heartbeat activity-gate (Riley Observations Part 4, spec §7.8) ────────
'heartbeat.tick.gated',
```

Per D1 (drop Rule 3) and the §7.8 observation that the same event type is emitted for both run and skip outcomes, **no second event is registered**. The payload's `shouldRun` boolean discriminates the two cases for downstream queries.

### 7.2 Event payload shape

Matches spec §7.8 verbatim, with one omission tied to D1 — `explicitTriggerQueued` is dropped from `signalsEvaluated` until "Check now" plumbing lands. The builder wires the type in `heartbeatActivityGateServicePure.ts` and re-exports so the event-emitter in the stateful wrapper can use it.

```typescript
// Event type: 'heartbeat.tick.gated'
// Payload:
{
  agentId: string,
  subaccountId: string,
  // timestamp is supplied by the tracing wrapper, not by the payload.
  shouldRun: boolean,
  reason: 'event_delta' | 'time_threshold' | 'state_flag' | 'no_signal' | 'gate_error',
  //  NB: 'explicit_trigger' is a reserved reason value — kept in the pure
  //  type definition but never emitted in v1 (D1 drops Rule 3).
  signalsEvaluated: {
    newEventCount: number,
    ticksSinceLastMeaningfulRun: number,
    stateFlagSet: boolean,
    // explicitTriggerQueued is NOT present in v1 payloads.
  },
  latencyMs: number,
}
```

### 7.3 Emission sites

- **Skip path** (shouldRun = false): the gate's stateful wrapper emits immediately after deciding, before returning control to the dispatcher. In the same tx, the wrapper also writes `last_tick_evaluated_at = now()` and `ticks_since_last_meaningful_run += 1`.
- **Dispatch path** (shouldRun = true, any `reason`): the stateful wrapper emits the event and then enqueues the `AGENT_RUN_QUEUE` job. `ticks_since_last_meaningful_run` is NOT reset here — it resets only when the dispatched run finalises as meaningful (see §5.5 finalizer hook).
- **Error path** (exception in the gate): emit with `reason = 'gate_error'`, `shouldRun = true`; proceed to dispatch. Log the underlying error via `logger.error('heartbeat_gate_error', { ... })` per the codebase convention.

### 7.4 Not-in-v1

No admin dashboards, sparklines, per-tick decision feeds, or inline "last decision" state on the edit form. All those are explicitly deferred per spec §7.9's "Historical gate activity... is NOT rendered on the Agent Edit page" and the §3a.2 lock 3 / Frontend Design Principles "default to hidden" posture. An operator who needs to investigate a skip queries the tracing sink directly.

## 8. Rollout posture

Cites spec §7.11 and §11.3 reviewer checklist.

- **Default off.** `agents.heartbeat_activity_gate_enabled` defaults to `false` at the schema level (column default). `subaccount_agents.heartbeat_activity_gate_enabled` is nullable → inherits from `agents` default → off. No seed data changes the default. This matches the §11.3 reviewer checklist line *"Feature flags default to safe posture (Explore = default, heartbeat gate = off)"*.
- **First enable: Portfolio Health only.** After the migration lands and the UI ships, the operator flips the toggle on Portfolio Health Agent manually via `AdminAgentEditPage`. No other agent has the toggle enabled. Monitor for 2 weeks per §7.11.
- **Conservative defaults.** `heartbeat_event_delta_threshold = 3` and `heartbeat_min_ticks_before_mandatory_run = 6` favour running over skipping. Spec SC 1 (§7.12) targets a 20–60% skip rate — if the observed rate is outside that window, tune the schema defaults (via a follow-up migration) rather than redesign the rules.
- **No automatic backfill.** The migration adds columns with defaults but does not flip the toggle on any existing row. Enable is explicit, per-agent, via the UI.
- **No auto-enable for other agents.** Portfolio Health is the pilot; other heartbeat-capable agents stay in the generic-fallback mode described in §4 Rule 1 and will not receive the toggle-on treatment without an explicit follow-up decision.
- **Rollback: flip the toggle, not `git revert`.** If Portfolio Health starts dispatching oddly after enable, the first remediation is `UPDATE agents SET heartbeat_activity_gate_enabled = false WHERE slug = 'portfolio-health';` — a zero-downtime operator action. Only if there's a deeper defect (e.g. the gate service itself throwing persistently, or the finalizer hook corrupting tick counters) does the team execute the §10.5 `_down/0206` rollback.
- **Safety net: mandatory-run rule always fires.** Even with a broken threshold or a misconfigured gate, Rule 2's mandatory-run (default 6 ticks = 24h at 4h cadence) guarantees Portfolio Health never goes silent for more than `6 × heartbeatIntervalHours` hours. This is the load-bearing invariant that makes "default-off + enable Portfolio Health as pilot" a safe rollout.

## 9. Test strategy

Per spec §11.2 Part 4 (lines 1795–1799). Pure-function matrices in `heartbeatActivityGateServicePure.test.ts` and `agentRunFinalizationServicePure.test.ts` cover every rule combination, the error path, and the `isMeaningfulRun` predicate; the three integration scenarios from spec §11.2 (gated skip emits telemetry; gate-throws dispatches anyway; 6 skips → 7th forces run) are derivable from the pure matrix under the codebase's `composition_tests: defer_until_stabilisation` posture and route to `tasks/todo.md` as deferred integration coverage. No frontend or API-contract tests per `docs/spec-context.md`.

## 10. Reviewer checklist

See spec §11.3. The `heartbeat gate = off` safe-posture line and the `drizzle-kit introspect clean` / `All migrations reversible` / `Telemetry events register in tracing.ts` / `spec-conformance pass before pr-reviewer` lines all apply to this wave.
