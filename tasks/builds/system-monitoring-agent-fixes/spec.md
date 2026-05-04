# System Monitor — Tier-1 Hardening Spec

> Source: Tier-1 items selected from [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md), authored after PR #215 merged on 2026-04-27.
>
> Intent: Land these five items on `system-monitoring-agent-fixes` before any new system-managed agent is added to the fleet, so new agents land into a hardened monitoring substrate rather than one with known correctness holes.
>
> Slug: `system-monitoring-agent-fixes`. Working dir for plan / progress / verification: `tasks/builds/system-monitoring-agent-fixes/`.

---

## Table of contents

1. Headline findings
2. Goals
3. Files to change (inventory lock)
4. Contracts
5. Migrations
6. Implementation philosophy
7. Phase 1 — Triage durability (retry idempotency + staleness recovery)
8. Phase 2 — Synthetic check: silent agent success
9. Phase 3 — Synthetic check: monitoring silence
10. Phase 4 — Failed-triage filter pill
11. Execution-safety contracts
12. Testing posture
13. Deferred items (Tier-2 + intentionally out of scope)
14. Acceptance criteria

---

## Section 0 — Verify present state

Each Tier-1 item is sourced from [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md). Verified open against `main` at HEAD `58cf0316` (PR #215 merge commit) on 2026-04-27:

| Item | Evidence | Status |
|---|---|---|
| Rate-limit retry idempotency | [`server/services/systemMonitor/triage/triageHandler.ts:269-277`](../../../server/services/systemMonitor/triage/triageHandler.ts#L269-L277) increments `triage_attempt_count + 1` unconditionally per handler invocation. No idempotency key. | verified open |
| Backend staleness guard | Same file, line 274 sets `triage_status='running'` with no sweep, no timeout, no heartbeat. Worker death leaves the row at `running` indefinitely. | verified open |
| Synthetic check: write vs declared success | [`server/services/systemMonitor/synthetic/index.ts`](../../../server/services/systemMonitor/synthetic/index.ts) lists 8 checks; none compares `agent_runs.status='completed'` against side-effect emission. | verified open |
| Synthetic check: incident silence | Same file: no check fires on absence of `system_incidents` rows in a window. | verified open |
| List filter `failed AND none` | [`server/services/systemIncidentService.ts:92-114`](../../../server/services/systemIncidentService.ts#L92-L114) and [`client/src/components/system-incidents/DiagnosisFilterPill.tsx`](../../../client/src/components/system-incidents/DiagnosisFilterPill.tsx) — pill has `all / diagnosed / awaiting / not-triaged`; no `failed-triage` option. | verified open |

All five items are confirmed open at the time of authoring. No items have been silently closed by surrounding work.

---

## 1. Headline findings

The five Tier-1 items share a single property: they are failure modes that the *next* system-managed agent will expose immediately. Worker death, silent success, monitoring-going-dark, and operator filtering on failed triage all become more likely as the agent fleet grows. Doing them now means new agents land into a hardened monitoring system instead of one with known correctness holes.

Two distinct shapes of work in this spec:

1. **Triage durability** (Phase 1) — two fixes (`triageHandler.ts` retry idempotency + a `triage_status='running'` staleness sweep) that share the same column (`triage_attempt_count`) and the same failure surface (worker death between increment and completion). They MUST land together — implementing one without the other either double-counts attempts or never recovers a stuck row, and both regressions silently degrade the rate-limit gate.

2. **Observability + UX gaps** (Phases 2–4) — three independent additions: two new synthetic checks following the existing `SyntheticCheck` interface, and a new pill option on `DiagnosisFilterPill` plus a server-side filter clause. No shared state; can land in any order after Phase 1 stabilises.

Out of scope (intentionally — these are the Tier-2 items): correlation-ID propagation invariant, frozen heuristic evaluation context, baseline-update guard during anomaly storms, resolution-tag taxonomy, auto-tuning feedback loop. See §13.

## 2. Goals

Every goal is a verifiable assertion. Subjective evaluation has been rewritten into a check that can be run against the implementation.

**G1 — Retry idempotency.** A pg-boss retry of `system-monitor-triage` for the same `incidentId` and the same `jobId` MUST NOT increment `system_incidents.triage_attempt_count`. A re-enqueue with a *different* `jobId` (operator manual retry, or a second incident-driven enqueue after a gap) MUST increment exactly once. Verifiable: pure-helper test that exercises the increment predicate twice with the same `(incidentId, jobId)` and asserts the second call does not bump the counter.

**G2 — Staleness recovery.** A `system_incidents` row left at `triage_status='running'` with `last_triage_attempt_at` older than `SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES` (default 10) MUST be flipped to `triage_status='failed'` by the staleness sweep within one tick after the threshold elapses, AND MUST emit exactly one `agent_triage_timed_out` event, AND MUST NOT re-increment `triage_attempt_count`. Verifiable: integration-style test (real DB) that inserts a stuck row, runs the sweep tick, asserts terminal state + event + counter unchanged.

**G3 — Silent agent success detection.** A new synthetic check fires when ≥30% of system-managed agent runs in the last hour completed (`status='completed'`) without writing any side effect — defined as no `agent_execution_events` rows AND no `system_incident_events` rows authored by the run AND no `skill_executions` rows. Floor of 5 runs in window before the check considers firing (avoids false positives on idle systems). Verifiable: pure-helper test on the counting function.

**G4 — Monitoring silence detection.** A new synthetic check fires when no `system_incidents` rows have been created in the last `SYSTEM_MONITOR_INCIDENT_SILENCE_HOURS` (default 12) hours, AND at least one synthetic check has fired in the prior 24h (proves the monitoring substrate itself is alive enough to have produced *something*). Verifiable: pure-helper test on the silence predicate, parameterised on (incidentsInWindow, syntheticFiresInPriorWindow).

**G5 — Failed-triage filter.** Operators on `SystemIncidentsPage` can select a `failed-triage` pill option that returns incidents where `triage_status='failed'` AND `diagnosis_status IN ('none','partial','invalid')`. Verifiable: type-level test that the pill option exists in `DiagnosisFilter`, plus a server-side test that the filter clause produces the expected SQL predicate.

**Non-goals.** Changes to the triage agent's tool loop, prompt, or skill set. Changes to the heuristic registry. Any new database tables — all five fixes extend existing primitives (one new column on an existing table; new rows in `SYNTHETIC_CHECKS` array; new clause in an existing service).

## 3. Files to change (inventory lock)

This table is the single source of truth for what the spec touches. Any prose reference to a new file, column, migration, or function must appear here. Drift between prose and inventory is a `file-inventory-drift` finding.

### 3.1 New files

| File | Phase | Purpose |
|---|---|---|
| `migrations/0239_system_incidents_last_triage_job_id.sql` | 1 | Adds `last_triage_job_id text` column to `system_incidents`. Down migration: `migrations/0239_system_incidents_last_triage_job_id.down.sql`. |
| `server/services/systemMonitor/triage/staleTriageSweep.ts` | 1 | IO module. Re-exports `parseStaleAfterMinutesEnv` from `staleTriageSweepPure.ts`; exports `runStaleTriageSweep()` (executes UPDATE...RETURNING + writes events) and `findStaleTriageRowsSql(now, staleAfterMs)` (documented SQL fragment for the predicate shape). |
| `server/services/systemMonitor/triage/staleTriageSweepPure.ts` | 1 | Pure helpers: `parseStaleAfterMinutesEnv(raw?)` and `staleCutoff(now, staleAfterMs)`. No DB import — satisfies §7 / verify-pure-helper-convention for the sibling `*Pure.test.ts`. |
| `server/services/systemMonitor/triage/__tests__/staleTriageSweepPure.test.ts` | 1 | Pure-helper test of the staleness predicate boundary AND `parseStaleAfterMinutesEnv` (NaN / empty / non-positive / valid env values). Runnable via `npx tsx`. |
| `server/services/systemMonitor/triage/triageIdempotencyPure.ts` | 1 | Pure helper: `shouldIncrementAttemptCount(currentJobId, candidateJobId): boolean`. |
| `server/services/systemMonitor/triage/__tests__/triageIdempotencyPure.test.ts` | 1 | Pure-helper test for the idempotency predicate. |
| `server/services/systemMonitor/synthetic/silentAgentSuccess.ts` | 2 | New `SyntheticCheck` registered in `SYNTHETIC_CHECKS` array. Imports its predicate / env parsers from `silentAgentSuccessPure.ts`. |
| `server/services/systemMonitor/synthetic/silentAgentSuccessPure.ts` | 2 | Pure helpers: `isSilentAgentRatioElevated`, `parseRatioThresholdEnv`, `parseMinSamplesEnv`. No DB import. |
| `server/services/systemMonitor/synthetic/__tests__/silentAgentSuccessPure.test.ts` | 2 | Pure-helper test of the threshold predicate AND env-parser NaN / non-positive / valid cases. |
| `server/services/systemMonitor/synthetic/incidentSilence.ts` | 3 | New `SyntheticCheck` registered in `SYNTHETIC_CHECKS` array. Imports its predicate / env parsers from `incidentSilencePure.ts`. |
| `server/services/systemMonitor/synthetic/incidentSilencePure.ts` | 3 | Pure helpers: `isMonitoringSilent`, `parseSilenceHoursEnv`, `parseProofOfLifeHoursEnv`. No DB import. |
| `server/services/systemMonitor/synthetic/__tests__/incidentSilencePure.test.ts` | 3 | Pure-helper test of the silence predicate AND env-parser NaN / non-positive / valid cases. |

### 3.2 Modified files

| File | Phase | Change |
|---|---|---|
| [`server/db/schema/systemIncidents.ts`](../../../server/db/schema/systemIncidents.ts) | 1 | Add `lastTriageJobId: text('last_triage_job_id')` column matching migration 0239. No type alias change. |
| [`server/services/systemMonitor/triage/triageHandler.ts`](../../../server/services/systemMonitor/triage/triageHandler.ts) | 1 | (a) Add `jobId: string` parameter to `runTriage`. (b) Replace the unconditional increment at line 269-277 with an idempotent UPDATE predicated on `last_triage_job_id IS DISTINCT FROM $jobId`. (c) Step 5 sets `triageStatus='running'` *only if* the increment fires. (d) Pass `jobId` from caller. (e) Run the idempotent UPDATE *before* the `agent_runs` INSERT so a duplicate-job retry never leaves an orphan run row (§8.10 race-claim ordering). |
| [`server/services/systemMonitor/skills/writeDiagnosis.ts`](../../../server/services/systemMonitor/skills/writeDiagnosis.ts) | 1 | Add `WHERE triage_status = 'running'` to the systemIncidents UPDATE and gate the `diagnosis` event INSERT on `RETURNING ... .length === 1` per §11.0 / §11.3. On suppression, return `{ success: true, suppressed: true, reason: 'terminal_transition_lost' }` — suppression is a benign race outcome, not an error, so the agent's tool loop does not retry. The triage handler's terminal-flip path mirrors this shape with `{ status: 'completed' \| 'failed', suppressed: true }` when its own predicated UPDATE returns 0 rows. |
| [`server/jobs/systemMonitorTriageJob.ts`](../../../server/jobs/systemMonitorTriageJob.ts) | 1 | Pass `job.id` (pg-boss job UUID) into `runTriage`. Update job-shape type to include `id: string`. |
| [`server/services/systemMonitor/synthetic/index.ts`](../../../server/services/systemMonitor/synthetic/index.ts) | 2, 3 | Append `silentAgentSuccess` and `incidentSilence` to the `SYNTHETIC_CHECKS` array. |
| [`server/services/systemMonitor/synthetic/syntheticChecksTickHandler.ts`](../../../server/services/systemMonitor/synthetic/syntheticChecksTickHandler.ts) | 1 | Add `runStaleTriageSweep()` call inside the same tick (cheap UPDATE; runs alongside the existing check loop). Wrapped in try/catch so a sweep error never kills the synthetic-check tick. |
| [`server/services/systemIncidentService.ts`](../../../server/services/systemIncidentService.ts) | 4 | Extend the `diagnosis` filter branch (lines 92-114) with a new `failed-triage` arm: `triageStatus='failed' AND diagnosisStatus IN ('none','partial','invalid')`. |
| [`server/schemas/systemIncidents.ts`](../../../server/schemas/systemIncidents.ts) | 4 | Extend `listIncidentsQuery.diagnosis` enum to include `'failed-triage'`. |
| [`client/src/components/system-incidents/DiagnosisFilterPill.tsx`](../../../client/src/components/system-incidents/DiagnosisFilterPill.tsx) | 4 | Add `'failed-triage'` to `DiagnosisFilter` union and `PILL_OPTIONS` array with label `Failed triage`. |
| [`client/src/pages/SystemIncidentsPage.tsx`](../../../client/src/pages/SystemIncidentsPage.tsx) | 4 | No code change beyond the type narrowing — the page already passes `diagnosis` straight through. Verify with typecheck. |

### 3.3 Environment variables introduced

| Var | Default | Phase | Purpose |
|---|---|---|---|
| `SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES` | `10` | 1 | Window before a `triage_status='running'` row is flipped to `failed` by the sweep. |
| `SYSTEM_MONITOR_TRIAGE_STALE_SWEEP_ENABLED` | `true` | 1 | Kill switch independent of `SYNTHETIC_CHECKS_ENABLED`. |
| `SYSTEM_MONITOR_SILENT_SUCCESS_RATIO_THRESHOLD` | `0.30` | 2 | % of `completed` runs with no side effects above which the check fires. |
| `SYSTEM_MONITOR_SILENT_SUCCESS_MIN_SAMPLES` | `5` | 2 | Floor on runs-in-window before the check considers firing. |
| `SYSTEM_MONITOR_INCIDENT_SILENCE_HOURS` | `12` | 3 | Window after which "no incidents" trips the silence check. |
| `SYSTEM_MONITOR_INCIDENT_SILENCE_PROOF_OF_LIFE_HOURS` | `24` | 3 | Lookback for "at least one synthetic check fired" proof-of-life gate. |

### 3.4 Out of inventory

No new tables. No new pg-boss queues. No new routes. No new permissions. No new RLS-protected tables. No changes to `RLS_PROTECTED_TABLES`. No changes to capabilities.md (no operator-visible capability changes — the Failed-triage pill is a refinement of an existing capability, not a new one).

## 4. Contracts

Every data shape that crosses a boundary or is consumed by a parser is pinned here, with a worked example and source-of-truth precedence where multiple representations exist.

### 4.1 `last_triage_job_id` column contract

| Field | Value |
|---|---|
| Name | `system_incidents.last_triage_job_id` |
| Type | `text NULL` |
| Producer | `triageHandler.runTriage` step 5 (idempotent UPDATE) |
| Consumer | `triageHandler.runTriage` step 5 (read-then-update predicate) only |
| Default | `NULL` (existing rows backfill as `NULL`; first triage attempt sets it) |
| Example | `'b1e7c2f4-8a3d-4f6c-9e2b-1a5d7f0c3b9e'` (a pg-boss job UUID) |
| Mutability | Set on every successful idempotent increment; never cleared |

**Source-of-truth precedence.** `triage_attempt_count` is the operator-facing counter (consumed by the rate-limit gate and the UI). `last_triage_job_id` is internal — it exists *only* to gate the increment of `triage_attempt_count`. If they ever diverge (e.g. `last_triage_job_id` is set but the count is 0), the count is authoritative; the column is recomputed on next attempt by the predicate. Operators MUST NOT read `last_triage_job_id`; it is not surfaced via the route layer or UI.

### 4.2 Idempotent increment predicate

| Field | Value |
|---|---|
| Name | `incrementTriageAttemptIfNewJob` (effective behaviour, not a separate function) |
| Shape | `UPDATE system_incidents SET triage_attempt_count = triage_attempt_count + 1, last_triage_attempt_at = $now, triage_status = 'running', last_triage_job_id = $jobId, updated_at = $now WHERE id = $incidentId AND (last_triage_job_id IS DISTINCT FROM $jobId) RETURNING triage_attempt_count, last_triage_job_id` |
| Returns | One row if increment fired; zero rows if a previous attempt already claimed this `(incidentId, jobId)`. |
| Idempotency posture | **key-based** on `(incidentId, jobId)` (the WHERE clause makes the second invocation a no-op). |
| Retry classification | **safe** — UPDATE is unconditionally retryable; the predicate prevents double-increment on retry. |

**Worked example.**

| Call | Existing row state | New `jobId` | Returns | Effect |
|---|---|---|---|---|
| First attempt | `count=0, last_id=NULL` | `'job-A'` | 1 row, `count=1` | Counter bumped, `last_triage_job_id='job-A'`, `status='running'` |
| pg-boss internal retry of same job | `count=1, last_id='job-A'` | `'job-A'` | 0 rows | No-op; handler proceeds against the existing run |
| Operator manual re-enqueue (new job) | `count=1, last_id='job-A'` | `'job-B'` | 1 row, `count=2` | Counter bumped, `last_triage_job_id='job-B'` |
| Staleness sweep flips to `failed` (no new job) | `count=2, last_id='job-B', status='running'` | (sweep runs separately) | n/a | `status='failed'`, counter unchanged, `last_triage_job_id` unchanged |

### 4.3 `agent_triage_timed_out` event contract

Mirrors the existing `agent_triage_failed` event so downstream consumers do not need a new branch.

| Field | Value |
|---|---|
| `eventType` | `'agent_triage_timed_out'` |
| `actorKind` | `'agent'` |
| `actorAgentRunId` | `null` — the worker died, so we cannot reliably attribute to a specific run UUID. |
| `payload.reason` | `'staleness_sweep'` |
| `payload.staleAfterMinutes` | The threshold value at sweep time (default 10) |
| `payload.lastTriageAttemptAt` | ISO-8601 timestamp of the row's `last_triage_attempt_at` at sweep time |
| `payload.triageAttemptCount` | The unchanged counter (NOT incremented by the sweep) |
| `occurredAt` | Sweep tick `now` |

**Example payload:**

```json
{
  "reason": "staleness_sweep",
  "staleAfterMinutes": 10,
  "lastTriageAttemptAt": "2026-04-27T14:32:18.441Z",
  "triageAttemptCount": 2
}
```

**Producer:** `runStaleTriageSweep` in `staleTriageSweep.ts`. Exactly one event per row flipped (UPDATE...RETURNING returns the affected rows; one event INSERT per returned row, batched in a single transaction with the UPDATE).

**Consumer:** existing system-incidents timeline UI ([`SystemIncidentsPage.tsx`](../../../client/src/pages/SystemIncidentsPage.tsx) `events` map) renders the event by its `eventType` string; no consumer-side change required.

### 4.4 `silent-agent-success` synthetic-check result contract

Conforms to the existing `SyntheticResult` interface in [`server/services/systemMonitor/synthetic/types.ts`](../../../server/services/systemMonitor/synthetic/types.ts).

| Field | Value |
|---|---|
| `fired` | `true` when ratio ≥ threshold AND `total >= MIN_SAMPLES` |
| `severity` | `'medium'` |
| `resourceKind` | `'agent'` |
| `resourceId` | The offending agent's `slug` |
| `summary` | `"Agent '<slug>' completed <N> runs in the last hour with no observable side effects (<pct>% silent)."` |
| `bucketKey` | `bucket15min(ctx.now)` |
| `metadata.checkId` | `'silent-agent-success'` |
| `metadata.agentSlug`, `metadata.totalCompleted`, `metadata.silentCount`, `metadata.ratio`, `metadata.lookbackMs` | Diagnostic context. |

Fingerprint override: `synthetic:silent-agent-success:agent:<slug>` (matches the pattern in `syntheticChecksTickHandler.ts:35`).

**"Side effect" definition.** A `completed` `agent_runs` row is *not silent* if any of:
1. At least one `agent_execution_events` row exists with `run_id = run.id`.
2. At least one `system_incident_events` row exists with `actor_agent_run_id = run.id`.

Silent = none of the above. Verifiable with a single LEFT JOIN query (one row per run, two boolean side-effect probes ANDed).

Note: `skill_executions` is not yet present in the codebase (see `sourceTableQueries.ts` stub comment). The `agent_execution_events` contract (every system-managed agent MUST emit at least one row per run per §4.4 observability contract) makes the third probe redundant — if the contract is held, `agent_execution_events` is sufficient for detection. When `skill_executions` ships, it may be added as a third probe in its own spec amendment.

**Observability contract for system-managed agents.** All system-managed agents (rows in `agents` with `is_system_managed = true`) MUST write at least one of `agent_execution_events` or `system_incident_events` per completed run to remain observable to this check. New write surfaces introduced by future system-managed agents MUST also emit at least one `agent_execution_events` row per run — even if the primary write is to a new table — so this side-effect probe stays stable as the fleet grows. This is an internal contract on system-managed agents; it does not apply to tenant-scoped agents and is not surfaced to operators.

**Timing clause — synchronous emission required.** The required `agent_execution_events` (or other side-effect) row MUST be written synchronously *during the run lifecycle* — i.e. before the `agent_runs` row transitions to `status='completed'`. A system-managed agent that defers side effects asynchronously (e.g. enqueues a follow-up job that writes downstream rows after the run completes, or batches writes via a downstream queue) MUST still emit at least one `agent_execution_events` row inside the run lifecycle to remain observable to this check. This prevents the check from drifting into false positives as the fleet evolves toward async patterns: a run that "looks completed but its side effects are still in flight" would otherwise be indistinguishable from a genuinely silent run at the moment the check executes. The synchronous-emission rule is the load-bearing invariant — `agent_runs.status='completed'` MUST mean "this run produced at least one observable marker by the time it claimed success."

### 4.5 `incident-silence` synthetic-check result contract

| Field | Value |
|---|---|
| `fired` | `true` when `incidentsInWindow == 0 AND syntheticFiresInPriorWindow >= 1` |
| `severity` | `'high'` (monitoring going dark is a louder signal than degraded performance) |
| `resourceKind` | `'system'` |
| `resourceId` | `'monitoring'` (single global resource — one incident max per silence window via fingerprint dedup) |
| `summary` | `"No system incidents recorded in the last <N> hours despite recent monitoring activity."` |
| `bucketKey` | `bucket15min(ctx.now)` |
| `metadata.checkId` | `'incident-silence'` |
| `metadata.silenceHours`, `metadata.proofOfLifeHours`, `metadata.syntheticFiresInProofWindow` | Diagnostic context. |

Fingerprint override: `synthetic:incident-silence:system:monitoring`.

**Why the proof-of-life gate matters.** Without it, the check fires every time an idle staging environment goes quiet (legitimate silence). Requiring at least one synthetic-check fire in the prior 24h means *something* has been observable — so the absence of incidents is genuinely the signal. Cold-start staging with zero activity emits no fire (gracefully degrades).

### 4.6 Failed-triage filter API contract

| Field | Value |
|---|---|
| Query param | `diagnosis=failed-triage` (added to existing enum in `listIncidentsQuery`) |
| Server-side predicate | `triage_status = 'failed' AND diagnosis_status IN ('none','partial','invalid')` |
| UI label | `'Failed triage'` |
| Pill order | `All / Diagnosed / Awaiting / Not auto-triaged / Failed triage` |
| Mutual exclusivity | Same as existing pill — exactly one value at a time. ANDs with status / severity / source filters. |

**Example request:** `GET /api/system/incidents?diagnosis=failed-triage&status=open,investigating`. Returns incidents the auto-triage attempted but never produced a usable diagnosis on, scoped to operator-actionable statuses.

## 5. Migrations

Exactly one migration. Up + down. Drizzle schema synced in the same chunk.

### 5.1 `0239_system_incidents_last_triage_job_id.sql`

```sql
-- 0239_system_incidents_last_triage_job_id
--
-- Adds last_triage_job_id text column to system_incidents to support
-- key-based idempotency on triage_attempt_count increments. The handler
-- updates this column atomically with the increment via a predicate of
-- the form `WHERE last_triage_job_id IS DISTINCT FROM $jobId`, which
-- causes pg-boss internal retries (same job UUID) to no-op rather than
-- inflating the counter.
--
-- See spec §4.1, §4.2 for the contract. Operators do not consume this
-- column; it is internal to the increment predicate.

ALTER TABLE system_incidents
  ADD COLUMN last_triage_job_id text;

-- No backfill needed: NULL is the correct "no attempt yet" state, and
-- the IS DISTINCT FROM predicate correctly fires the first increment
-- when the column is NULL and the candidate jobId is not.
```

Down migration (`0239_system_incidents_last_triage_job_id.down.sql`):

```sql
ALTER TABLE system_incidents
  DROP COLUMN IF EXISTS last_triage_job_id;
```

### 5.2 Drizzle schema sync

[`server/db/schema/systemIncidents.ts`](../../../server/db/schema/systemIncidents.ts) — add the column to the `pgTable` definition. Place adjacent to `triageAttemptCount` / `lastTriageAttemptAt` per the existing column-grouping convention:

```ts
triageAttemptCount: integer('triage_attempt_count').notNull().default(0),
lastTriageAttemptAt: timestamp('last_triage_attempt_at', { withTimezone: true }),
lastTriageJobId: text('last_triage_job_id'),
```

No new index. The column is read+written only as part of an UPDATE predicated on `id` (the primary key), which is already the indexed access path.

## 6. Implementation philosophy

This spec follows `docs/spec-context.md` framing without deviation. Pre-production, rapid evolution, no live agencies, no feature flags. Static gates + pure-helper unit tests are the testing surface (see §12). No frontend / API-contract / E2E tests added. No staged rollout. No new primitives where existing ones fit.

**Existing primitives reused** (per Section 1 of the spec-authoring checklist):

| Primitive | Where reused | Why reuse not extension |
|---|---|---|
| `recordIncident()` (incidentIngestor) | Phases 2 & 3 — both new synthetic checks call it via the existing tick handler. | Already accepts the contract these checks need (`source: 'synthetic'`, `fingerprintOverride`, `idempotencyKey`). No extension needed. |
| `SyntheticCheck` interface (`synthetic/types.ts`) | Phases 2 & 3 — new modules implement the existing interface. | Interface already supports the result shape (resourceKind, resourceId, severity, summary, bucketKey, metadata). No extension. |
| `SYNTHETIC_CHECKS` array (`synthetic/index.ts`) | Phases 2 & 3 — new checks appended. | Registry pattern is the established extension point. |
| `systemIncidentService.listIncidents` `diagnosis` filter | Phase 4 — new arm appended to existing branch. | Branch already exists; adding one arm preserves the contract shape. |
| `DiagnosisFilterPill` component | Phase 4 — new option appended to `PILL_OPTIONS`. | Component already iterates over `PILL_OPTIONS`; no markup change beyond array entry. |
| `system_incidents` table | Phase 1 — one new column added. | A separate `system_monitor_triage_attempts` table was considered and rejected: an attempt-history table would be a new RLS-protected primitive carrying ~one row per attempt forever, when all we need is "did *this* job already increment?". A single `text NULL` column on `system_incidents` answers that with one round-trip, no new RLS surface, no new manifest entry. |
| `agent_triage_failed` event shape | Phase 1 — `agent_triage_timed_out` mirrors the same payload shape. | Per [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md) round-3 implementation note: "mirror the existing `triage_failed` event shape so consumers don't need a new branch." |
| `syntheticChecksTickHandler` tick | Phase 1 — staleness sweep piggybacks on the existing 60s tick. | A separate tick would need its own queue, kill switch, and observability. Reusing the synthetic-check tick keeps operational surface flat. |

**No new primitives invented.** Section 1 of the checklist requires a "why not reuse" paragraph for any new primitive; none qualifies as a *new* primitive, so the requirement is satisfied vacuously.

**Surgical changes.** Every changed line in the inventory traces directly to one of G1–G5. No drive-by reformatting of `triageHandler.ts`, no incidental refactors of `systemIncidentService.ts`, no rename passes.

## 7. Phase 1 — Triage durability (retry idempotency + staleness recovery)

**Why bundled.** Per [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md) round-3 note (lines 58–60): "These two fixes share the same failure surface and should be implemented together to avoid building one on top of the other's not-yet-finished assumptions." Implementing the staleness sweep without idempotency means the sweep flips a row to `failed`, the operator re-enqueues, and the counter inflates by one even though no real work was done. Implementing idempotency without the staleness sweep means a stuck `running` row stays stuck forever — the idempotency predicate has nothing to gate against.

### 7.1 Sub-phase A: Idempotency (G1)

**Order of edits:**

1. Migration `0239_*.sql` + down. Run `npm run db:generate`; verify the generated diff matches §5.1.
2. Add `lastTriageJobId` to [`server/db/schema/systemIncidents.ts`](../../../server/db/schema/systemIncidents.ts).
3. Create `server/services/systemMonitor/triage/triageIdempotencyPure.ts`:
   ```ts
   export function shouldIncrementAttemptCount(
     currentJobId: string | null,
     candidateJobId: string,
   ): boolean {
     return currentJobId !== candidateJobId;
   }
   ```
   The pure helper exists for the unit test surface — the actual idempotency lives in the SQL predicate per §4.2, but the helper documents the equivalence and is the test handle.
4. Modify [`server/jobs/systemMonitorTriageJob.ts`](../../../server/jobs/systemMonitorTriageJob.ts):
   - Update the job-shape parameter type from `{ data: { incidentId: string } }` to `{ id: string; data: { incidentId: string } }`.
   - Pass `job.id` into `runTriage(incidentId, job.id)`.
5. Modify [`server/services/systemMonitor/triage/triageHandler.ts`](../../../server/services/systemMonitor/triage/triageHandler.ts):
   - Update `runTriage` signature: `runTriage(incidentId: string, jobId: string): Promise<TriageResult>`.
   - Replace the unconditional UPDATE at lines 269-277 with the predicated UPDATE from §4.2. Capture the returned row count.
   - If 0 rows returned: emit a structured log with event name `triage.idempotent_skip` at `info`, payload `{ incidentId, jobId, reason: 'duplicate_job' }`. The event name is the contract — log aggregators count occurrences by event name to surface retry-storm volume without a database write or incident. Then early-return `{ status: 'skipped', reason: 'duplicate_job' }`. Do NOT proceed to step 6 (the LLM tool loop) — the previous invocation already owns this attempt.
   - If 1 row returned: proceed exactly as today.

**Why early-return on 0 rows.** Running the LLM tool loop twice for the same `(incidentId, jobId)` would charge tokens twice and write a duplicate `agent_runs` row. The predicate's job is to ensure exactly-once tool-loop execution per `(incidentId, jobId)` pair, not just exactly-once counter increment.

**Concurrency posture.** Two simultaneous handler invocations for the same `(incidentId, jobId)` (theoretically possible with pg-boss in a multi-node deploy if the singleton key briefly fails) both hit the predicated UPDATE; Postgres serialises them, exactly one returns 1 row, the other returns 0. First-commit-wins. The "losing" caller takes the early-return path.

### 7.2 Sub-phase B: Staleness sweep (G2)

**Order of edits:**

1. Create `server/services/systemMonitor/triage/staleTriageSweep.ts`:
   ```ts
   // Pure: builds the SQL fragment.
   export function findStaleTriageRowsSql(now: Date, staleAfterMs: number) {
     const cutoff = new Date(now.getTime() - staleAfterMs);
     return sql`UPDATE system_incidents
       SET triage_status = 'failed', updated_at = ${now}
       WHERE triage_status = 'running'
         AND last_triage_attempt_at < ${cutoff}
         AND last_triage_job_id IS NOT NULL
       RETURNING id, last_triage_attempt_at, triage_attempt_count`;
   }

   // IO: executes UPDATE...RETURNING, batches one event INSERT per row.
   export async function runStaleTriageSweep(now: Date = new Date()): Promise<{ flipped: number }> {
     if (process.env.SYSTEM_MONITOR_TRIAGE_STALE_SWEEP_ENABLED === 'false') return { flipped: 0 };
     const staleAfterMs = parseStaleAfterMinutesEnv() * 60 * 1000;
     // ... runs UPDATE...RETURNING in a transaction with the events INSERT.
   }

   // Pure helper: parse SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES with explicit
   // NaN / non-positive guards. `parseInt('', 10)` returns NaN, and `??` only
   // catches null/undefined — so a malformed env value (e.g. `''`, `'abc'`,
   // `'0'`, `'-5'`) would silently produce NaN minutes and disable the sweep.
   // Always fall back to the default in that case.
   export function parseStaleAfterMinutesEnv(raw: string | undefined = process.env.SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES): number {
     const DEFAULT_MINUTES = 10;
     if (raw === undefined || raw === '') return DEFAULT_MINUTES;
     const parsed = Number.parseInt(raw, 10);
     if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MINUTES;
     return parsed;
   }
   ```
2. Wire `runStaleTriageSweep()` into `syntheticChecksTickHandler.ts`: call it before the `for (const check of SYNTHETIC_CHECKS)` loop, wrapped in its own try/catch so a sweep error never short-circuits the synthetic checks.
3. Counter remains unchanged. The staleness sweep MUST NOT touch `triage_attempt_count` — per round-3 note: "the staleness recovery path is exactly the case where a naive increment would double-charge a single attempt that the worker never actually completed."
4. Event emission: one `agent_triage_timed_out` event per row flipped, payload per §4.3. The events INSERT runs in the same transaction as the UPDATE so the (status flip, event write) pair is atomic — operators never see a `failed` row without an event, or an event without a `failed` row.

**Why the sweep, not a heartbeat.** Per [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md) round-3 note: option (a) is simpler. Heartbeat (option b) generalises better but introduces a write-on-every-iteration tax on a long-running loop, plus a heartbeat column that other long-running ops would also want — that pushes into "general-purpose long-job heartbeat primitive" territory, which is correctly out of scope here. The sweep is one UPDATE per tick, costs nothing, recovers stuck rows within `STALE_AFTER_MINUTES + tick interval`.

**Triage SLA contract.** A triage attempt that does not reach a terminal state within `SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES` (default 10) is considered failed by contract. This is an explicit SLA on the triage tool loop — not an implicit "should be fast enough" assumption. If a future triage variant legitimately needs longer than `STALE_AFTER_MINUTES`, the variant MUST raise the env-var ceiling explicitly (and document why) rather than silently relying on the worker outliving the sweep. The `last_triage_job_id IS NOT NULL` clause is the matching guard: a row that never registered a `jobId` (i.e. never made it past the idempotent UPDATE in §4.2) is excluded from the sweep — it represents a row that is `running` only by an inconsistent prior state, not by a worker actually processing it. Such rows are surfaced separately by gate / state-consistency checks rather than swept.

### 7.3 Coordination tests (G1 + G2 together)

One integration-style test (real DB) in `server/services/systemMonitor/triage/__tests__/triageDurability.integration.test.ts` exercises the full coordination contract:

1. Insert an incident, run `runTriage(id, 'job-A')` → assert `count=1`, `last_triage_job_id='job-A'`, `triage_status='running'`.
2. Manually advance `last_triage_attempt_at` 15 minutes into the past.
3. Run `runStaleTriageSweep(now)` → assert `triage_status='failed'`, `count` UNCHANGED at 1, exactly one `agent_triage_timed_out` event written.
4. Run `runTriage(id, 'job-B')` (operator manual retry) → assert `count=2`, `last_triage_job_id='job-B'`, `triage_status='running'`.
5. Run `runTriage(id, 'job-B')` again (simulating pg-boss retry of same job) → assert `count=2` UNCHANGED, returns `{ status: 'skipped', reason: 'duplicate_job' }`.

This test is the verification of G1 + G2 acting together. It runs against the actual schema; pure-helper tests cover the predicates in isolation.

## 8. Phase 2 — Synthetic check: silent agent success (G3)

This is precisely the failure mode new agents will exhibit: the LLM returns a clean response that satisfies the prompt grammar, the run completes, no error fires, but no skill ran, no event was emitted, no incident was updated. From outside the agent, success looks identical to success-with-side-effect; only a cross-table count exposes the silent runs.

### 8.1 Module: `server/services/systemMonitor/synthetic/silentAgentSuccess.ts`

**Query (executes once per tick):**

```sql
SELECT
  a.slug,
  COUNT(ar.id)::int AS total_completed,
  COUNT(*) FILTER (
    WHERE NOT EXISTS (SELECT 1 FROM agent_execution_events ae WHERE ae.run_id = ar.id)
      AND NOT EXISTS (SELECT 1 FROM system_incident_events sie WHERE sie.actor_agent_run_id = ar.id)
  )::int AS silent_count
FROM agents a
JOIN agent_runs ar ON ar.agent_id = a.id
WHERE a.is_system_managed = true
  AND a.status = 'active'
  AND a.deleted_at IS NULL
  AND ar.status = 'completed'
  AND ar.is_test_run = false
  AND ar.created_at >= $since
GROUP BY a.slug
HAVING COUNT(ar.id) >= $minSamples
```

`$since = ctx.now - 1h`. `$minSamples = SYSTEM_MONITOR_SILENT_SUCCESS_MIN_SAMPLES` (default 5).

### 8.2 Pure helper

```ts
// silentAgentSuccessPure.ts (inlined inside silentAgentSuccess.ts unless shape grows)
export function isSilentAgentRatioElevated(
  totalCompleted: number,
  silentCount: number,
  ratioThreshold: number,
  minSamples: number,
): boolean {
  if (totalCompleted < minSamples) return false;
  if (totalCompleted <= 0) return false;
  return silentCount / totalCompleted >= ratioThreshold;
}
```

Pure-helper test asserts boundary cases: `0/5 → false`, `2/5 (40%) → true at threshold 0.30`, `1/5 (20%) → false at threshold 0.30`, `3/4 → false because below minSamples`, `0/0 → false`.

### 8.3 First-fire-wins

Following the pattern in [`agentRunSuccessRateLow.ts`](../../../server/services/systemMonitor/synthetic/agentRunSuccessRateLow.ts), the check returns `fired: true` on the *first* offending agent encountered, not all of them. The next tick will catch the next worst agent. Operators get one incident at a time per agent (deduped by fingerprint), which matches the existing synthetic-check operational rhythm.

**Detection-latency characteristic.** Detection latency for `silent-agent-success` (and every other first-fire-wins synthetic check in `SYNTHETIC_CHECKS`) scales linearly with the number of simultaneously-degraded agents: `N` degraded agents take `N` ticks to all surface (default tick interval applies). At a 60s tick this is `N` minutes worst-case. This is acceptable for the current fleet size — system-managed agents are added one at a time and degradations rarely arrive in synchronised bursts. If the fleet grows past ~10 system-managed agents *or* simultaneous degradations become a routine pattern, this latency profile becomes the bottleneck and a top-K-offenders variant of the check (configurable cap, default 3) becomes the right promotion path. That promotion lands in its own spec amendment — first-fire-wins remains the convention across `SYNTHETIC_CHECKS` until then.

### 8.4 Why "completed" specifically and not "all runs"

A `failed` agent run with no side effects is not silent — it failed. We're chasing the case where the agent *claims* success (status='completed') but produced nothing. Failed runs are a different observability concern handled by `agentRunSuccessRateLow`. The two checks together cover the success-rate cliff (failures spiking) and the silent-success cliff (successes that aren't really successes).

### 8.5 Why side effects are defined as 2 specific tables

These two tables are the universe of currently-instrumented write surfaces for system_monitor-class agents:

- `agent_execution_events` — every meaningful step in the tool loop emits one of these (per the live-execution-log spec). Column used: `run_id`.
- `system_incident_events` — the diagnosis-skill output is recorded here when the agent writes a diagnosis. Column used: `actor_agent_run_id`.

`skill_executions` is not yet present in the codebase (stubbed in `sourceTableQueries.ts`). Once it ships, it may be added as a third probe via its own spec amendment. The `agent_execution_events` contract makes the third probe redundant for detection purposes in the current fleet.

If none of the two has a row pointing to the run, the agent literally did nothing observable. Logging at `info` when the check fires includes the specific run UUIDs so operators can spot-check the "silent" claim.

The list is held stable by the §4.4 observability contract: every system-managed agent MUST emit at least one `agent_execution_events` row per run regardless of any new write surface it touches. This means a future "execute remediation" skill writing to a new table does not require this list to be extended — the agent's `agent_execution_events` row is still produced, the check still treats it as non-silent. The list expands only if the contract is deliberately revised (e.g. a future class of system-managed agent that writes to a new primary surface and is exempted from emitting `agent_execution_events`); that revision lands in its own spec amendment.

## 9. Phase 3 — Synthetic check: monitoring silence (G4)

If the monitoring substrate breaks silently (a route handler stops calling `recordIncident`, the ingest worker stalls, a connector poll silently returns empty), the absence of incidents is the only signal we have. This check turns absence into presence — a single "monitoring silent" incident every 12h of dead air.

### 9.1 Module: `server/services/systemMonitor/synthetic/incidentSilence.ts`

**Query (executes once per tick):**

```sql
WITH params AS (
  SELECT
    $silenceCutoff::timestamptz AS silence_cutoff,
    $proofCutoff::timestamptz   AS proof_cutoff
)
SELECT
  (SELECT COUNT(*) FROM system_incidents si, params
   WHERE si.created_at >= params.silence_cutoff
     AND si.is_test_incident = false
     AND NOT (si.source = 'synthetic'
              AND si.latest_error_detail->>'checkId' = 'incident-silence'))  AS incidents_in_window,
  (SELECT COUNT(*) FROM system_incidents si, params
   WHERE si.source = 'synthetic'
     AND si.created_at >= params.proof_cutoff
     AND NOT (si.latest_error_detail->>'checkId' = 'incident-silence'))      AS synthetic_fires_in_proof_window
```

`$silenceCutoff = ctx.now - SYSTEM_MONITOR_INCIDENT_SILENCE_HOURS hours` (default 12h).
`$proofCutoff = ctx.now - SYSTEM_MONITOR_INCIDENT_SILENCE_PROOF_OF_LIFE_HOURS hours` (default 24h).

The `incidents_in_window` count **excludes** rows written by this check itself (`source='synthetic' AND metadata.checkId='incident-silence'`). The `synthetic_fires_in_proof_window` count **also excludes** silence-check rows (`metadata.checkId='incident-silence'`) — proof-of-life MUST be carried by an independent synthetic check, not by the silence check itself. Without this exclusion, a system whose only signal is the silence detector would self-validate proof-of-life from its own prior fires, masking the underlying outage. Rationale and the sustained-signal contract that depends on both exclusions: see [§9.6](#96-sustained-silence-signal-contract).

### 9.2 Pure helper

```ts
export function isMonitoringSilent(
  incidentsInWindow: number,
  syntheticFiresInProofWindow: number,
): boolean {
  return incidentsInWindow === 0 && syntheticFiresInProofWindow >= 1;
}
```

Pure-helper test asserts: `(0, 0) → false (cold-start)`, `(0, 1) → true`, `(0, 5) → true`, `(1, 0) → false`, `(1, 5) → false`.

The `syntheticFiresInProofWindow` parameter receives the SQL-side excluded count per §9.1 (silence-check rows already filtered out), so the helper itself is exclusion-agnostic — it asserts the predicate "no incidents AND at least one *independent* synthetic fire." Test cases stay numeric; the SQL-side exclusion is verified by the integration smoke check in §14.3 (A3.3).

### 9.3 Why proof-of-life

A literally idle staging environment will have zero incidents and zero synthetic fires — that is *correct silence*, not failure. The proof-of-life gate says: only fire if *something* recently fired. The 24h proof window is wider than the 12h silence window so a healthy system that just had its last incident 13h ago still has proof-of-life from a synthetic fire at hour 22, 21, 20, etc. — the check tolerates uneven activity but catches genuine silence.

**Why proof-of-life excludes silence-check fires.** Per §9.1, the `synthetic_fires_in_proof_window` count filters out rows where `metadata.checkId='incident-silence'`. Proof-of-life MUST be carried by an *independent* synthetic check (e.g. `agentRunSuccessRateLow`, `pgBossQueueStalled`, `silentAgentSuccess`, etc.) — not by this check's own prior fires. Without that exclusion, a system whose only living signal is the silence detector itself would validate its own proof-of-life: every silence-check fire would count as proof that monitoring is alive, and the check would re-fire on its own ecosystem rather than on real activity. The exclusion is symmetric with the `incidents_in_window` exclusion in §9.1: silence-check rows are neither monitoring activity (don't count toward `incidents_in_window`) nor proof-of-life (don't count toward `synthetic_fires_in_proof_window`). Real synthetic-check fires are the only proof-of-life. If every other synthetic check has been silent for 24h *and* no real incidents in 12h, the check correctly *stops* firing — because at that point the substrate is so dark we can't distinguish "outage" from "genuinely idle," and emitting a silence-check incident would not change that.

### 9.4 Severity

`high`, not `medium`. Monitoring going dark is louder than degraded performance because it means we *can't see* whether the rest is degraded. Per [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md): "If we ship new agents and monitoring breaks silently, we don't notice until things have been broken for hours."

### 9.5 Self-dedup

Single global resource (`resourceKind='system'`, `resourceId='monitoring'`). Fingerprint `synthetic:incident-silence:system:monitoring`. The existing `system_incidents_active_fingerprint_idx` partial unique index ensures at most one *active* incident exists for this fingerprint — repeated silence detection within the same active incident bumps `occurrence_count` rather than creating duplicates. Operator-resolved → next tick after silence-still-active creates a new incident, which is the right behaviour.

### 9.6 Sustained-silence signal contract

Silence-check incidents do **not** count as monitoring activity, and they do **not** count as proof-of-life. The §9.1 query excludes rows where `metadata.checkId='incident-silence'` from *both* `incidents_in_window` and `synthetic_fires_in_proof_window`. A system whose only signal is the silence detector itself is **still considered silent** AND has no proof-of-life from itself — the underlying substrate is still dark, and that's what we want to surface.

Three independent mechanisms cooperate:

1. **Sustained-signal counting (§9.1 `incidents_in_window` predicate):** the silence detector ignores its own prior fires when computing `incidents_in_window`. As long as the underlying silence persists past `silenceCutoff` and proof-of-life still holds, the check *would* re-fire every tick. This is what keeps the signal alive instead of self-healing after one row.
2. **Independent proof-of-life (§9.1 `synthetic_fires_in_proof_window` predicate):** the silence detector ignores its own prior fires when computing proof-of-life as well. Proof-of-life is carried only by *other* synthetic checks (or real incidents), so the silence detector cannot validate its own ecosystem. If every other monitoring signal is dead, the silence check stops firing — because at that point we cannot distinguish outage from idle, and emitting silence-on-silence is not informative.
3. **Active-incident dedup (§9.5):** the partial unique index `system_incidents_active_fingerprint_idx` on fingerprint `synthetic:incident-silence:system:monitoring` ensures at most one *active* row exists at any moment. Per-tick re-fires bump `occurrence_count` on the existing active incident rather than creating duplicates. Operators see one open incident with a rising occurrence count, not a flood of new incidents.

Together: while underlying silence persists *and* an independent synthetic check is still firing within the proof-of-life window, the check re-fires every tick (sustained signal), but the operator sees a single active incident with an incrementing `occurrence_count` (clean inbox). When the operator resolves the incident *and* the underlying silence is still present *and* proof-of-life still holds, the next tick creates a new active incident — by design, because resolution is operator intent, and intent should be respected. When real activity returns (any non-silence-check incident written within the silence window), `incidents_in_window` becomes ≥ 1 and the check stops firing naturally. When *every* synthetic check goes dark for 24h, proof-of-life fails and the check also stops firing — correct fail-quiet posture for total-substrate-down.

No infinite-loop risk: the dedup index caps active-row count at 1, and `occurrence_count` is the only thing that grows while silence persists.

## 10. Phase 4 — Failed-triage filter pill (G5)

Smallest of the four phases. One pill option, one filter arm, one Zod enum value, one type union extension.

### 10.1 Order of edits

1. [`server/schemas/systemIncidents.ts`](../../../server/schemas/systemIncidents.ts) — extend the `diagnosis` enum on `listIncidentsQuery`:
   ```ts
   diagnosis: z.enum(['all', 'diagnosed', 'awaiting', 'not-triaged', 'failed-triage']).optional(),
   ```
2. [`server/services/systemIncidentService.ts`](../../../server/services/systemIncidentService.ts) — add the new `else if` branch after the existing `not-triaged` branch (line 104):
   ```ts
   } else if (filters.diagnosis === 'failed-triage') {
     conditions.push(eq(systemIncidents.triageStatus, 'failed') as ...);
     conditions.push(
       inArray(systemIncidents.diagnosisStatus, ['none', 'partial', 'invalid']) as ...,
     );
   }
   ```
   Type-cast pattern matches the surrounding code.
3. Update `IncidentListFilters.diagnosis` type union (line 40) to add `'failed-triage'`.
4. [`client/src/components/system-incidents/DiagnosisFilterPill.tsx`](../../../client/src/components/system-incidents/DiagnosisFilterPill.tsx):
   ```ts
   export type DiagnosisFilter = 'all' | 'diagnosed' | 'awaiting' | 'not-triaged' | 'failed-triage';
   const PILL_OPTIONS: Array<{ value: DiagnosisFilter; label: string }> = [
     { value: 'all', label: 'All' },
     { value: 'diagnosed', label: 'Diagnosed by agent' },
     { value: 'awaiting', label: 'Awaiting diagnosis' },
     { value: 'not-triaged', label: 'Not auto-triaged' },
     { value: 'failed-triage', label: 'Failed triage' },
   ];
   ```
5. [`client/src/pages/SystemIncidentsPage.tsx`](../../../client/src/pages/SystemIncidentsPage.tsx) — no code change. Verify with `npx tsc --noEmit` that the prop pass-through still types.

### 10.2 Why these specific diagnosisStatus values

Per [`migrations/0237_system_incidents_status_fields.sql`](../../../migrations/0237_system_incidents_status_fields.sql) (lines 24-29): `none / valid / partial / invalid`. The intent of the new pill is "auto-triage attempted but did not produce a usable diagnosis." A `valid` diagnosis is usable — exclude it. `none / partial / invalid` are the three "not usable" states. Including all three rather than just `none` catches the failure mode where the agent wrote *something* (`partial`) but it failed validation, which is exactly the operator-investigation case round-2 named.

### 10.3 Why no count badge on the pill

CLAUDE.md frontend rule 4 ("inline state beats dashboards") and the existing `DiagnosisFilterPill` convention ("no count badges per CLAUDE.md frontend rules" — see file header). Operators see results-or-empty when the filter applies; they don't need a pre-flight count.

## 11. Execution-safety contracts

Section 10 of the spec-authoring checklist. Each new write path has its idempotency posture, retry classification, concurrency guard, and terminal-event story explicitly pinned.

### 11.0 Centralised invariant — single-writer terminal-event rule

**This rule is normative and applies to every writer in the triage flow without exception.**

> **Triage terminal-event invariant:** A terminal event for a triage attempt (`agent_diagnosis_added`, `agent_triage_failed`, `agent_triage_timed_out`) MUST only be emitted by a writer whose `UPDATE` flipped `triage_status` from `'running'` to a terminal value (`'completed'` or `'failed'`) in the same transaction. Every such writer MUST include `WHERE triage_status = 'running'` in its UPDATE and MUST inspect the affected row count before emitting the event. If the UPDATE returns 0 rows, the writer MUST suppress its terminal event — another writer (the tool loop completing late, or the staleness sweep, or a parallel handler invocation) has already won the transition.

**Why this is the load-bearing rule.** Three independent writers can race for the same `(incidentId, attempt)` row: the tool-loop success path, the tool-loop failure path, and the staleness sweep. Without a single-writer invariant, a late tool-loop completion firing after a sweep already flipped the row would emit a `'completed'`-shaped event on top of an `'agent_triage_timed_out'` event — producing a `completed after failed` corruption visible to operators and downstream consumers. The `WHERE triage_status = 'running'` predicate plus the row-count check is the only guard between the spec and that corruption: every emitter follows the same rule, the row transition is serialised by Postgres, exactly one writer wins, only that writer emits.

**Where this is enforced.** §11.3 enumerates the three writers (tool-loop success, tool-loop failure, staleness sweep) and their concrete UPDATE-then-event sequences. §7.1 covers the duplicate-job early-return path that is *not* a terminal event (no event emission) and therefore not bound by this invariant. Any future writer that can transition `triage_status` to a terminal value MUST be added to §11.3's enumeration AND MUST conform to this invariant — adding a writer without conforming is a §11.0 violation and a blocking spec amendment.

### 11.1 Triage attempt increment

| Concern | Posture |
|---|---|
| Idempotency | **Key-based** on `(incidentId, jobId)`. The `last_triage_job_id IS DISTINCT FROM $jobId` predicate makes second-and-later invocations no-ops. |
| Retry classification | **Safe** — UPDATE is unconditionally retryable. The predicate guarantees at-most-one increment per `(incidentId, jobId)`. |
| Concurrency guard | Optimistic predicate. Two simultaneous handler invocations both run `UPDATE ... WHERE last_triage_job_id IS DISTINCT FROM $jobId`. Postgres serialises them; exactly one returns 1 row. The "loser" returns 0 rows and takes the early-return path (`{ status: 'skipped', reason: 'duplicate_job' }`). |
| Unique-constraint mapping | None — the predicate, not a unique constraint, is the gate. No `23505` to map. |

### 11.2 Staleness sweep flip

| Concern | Posture |
|---|---|
| Idempotency | **State-based** on the optimistic predicate `triage_status = 'running' AND last_triage_attempt_at < cutoff AND last_triage_job_id IS NOT NULL`. A second sweep run for the same row finds `triage_status = 'failed'` and matches no rows. |
| Retry classification | **Safe** — the sweep can run any number of times per tick; only rows still in the stuck-running state at the moment of the UPDATE flip. |
| Concurrency guard | Optimistic predicate is the guard. If two sweep ticks race (e.g. multi-instance deploy), Postgres serialises; exactly one tick flips each stuck row, the other sees `triage_status='failed'` and matches nothing for that row. |
| Counter update | Sweep does NOT touch `triage_attempt_count`. |
| Atomicity with event | UPDATE...RETURNING + event INSERT(s) run in the same transaction. Operators never see (status flip, no event) or (event, no status flip). |
| SLA contract | Triages that do not reach a terminal state within `SYSTEM_MONITOR_TRIAGE_STALE_AFTER_MINUTES` are failed by contract (see §7.2). Long-running triage variants MUST raise the ceiling explicitly. |
| `last_triage_job_id IS NOT NULL` guard | Excludes rows in `running` that never registered a jobId (impossible under §4.2 but defensive against historical / inconsistent state). |

### 11.3 Terminal-event guarantee for triage

The triage flow has exactly one terminal event per logical attempt. The closure is:

| Path | Terminal event | `status` field |
|---|---|---|
| Tool loop succeeds | `agent_diagnosis_added` (emitted by `write_diagnosis` skill) — pre-existing | `success` (implicit — diagnosis present) |
| Tool loop max-iterations or LLM error | `agent_triage_failed` — pre-existing | `failed` |
| Worker died, sweep recovers | `agent_triage_timed_out` — **new** | `failed` (semantic) |
| Idempotent skip on duplicate job | (no event — the original attempt's terminal event is authoritative) | n/a |

Post-terminal prohibition: once a row has `triage_status IN ('completed', 'failed')`, the sweep predicate excludes it (`WHERE triage_status = 'running'`), so no spurious `agent_triage_timed_out` can fire after a real terminal event landed. The three terminal events are mutually exclusive per logical attempt.

**Conformance to §11.0.** Each of the three writers below conforms to the centralised single-writer terminal-event invariant in §11.0 — every UPDATE includes `WHERE triage_status = 'running'`, every event INSERT is gated on the UPDATE returning 1 row, and every emitter suppresses its event on a 0-row return.

- **Tool-loop success path:** the `write_diagnosis` skill's UPDATE includes `WHERE triage_status = 'running'`; the `agent_diagnosis_added` event INSERT runs in the same transaction and only if the UPDATE returned 1 row.
- **Tool-loop failure path:** the failure handler's UPDATE includes `WHERE triage_status = 'running'`; `agent_triage_failed` only fires on a 1-row return.
- **Staleness-sweep path:** per §7.2 / §11.2, the predicate (`triage_status = 'running' AND last_triage_attempt_at < cutoff AND last_triage_job_id IS NOT NULL`) is the guard; `agent_triage_timed_out` is emitted once per row in the UPDATE...RETURNING set, in the same transaction. A sweep tick that finds 0 rows (because a tool-loop writer just won the transition) emits no event.

**Race resolution.** A late-arriving tool-loop completion that races a sweep tick finds its UPDATE matches 0 rows (the sweep already flipped the row to `'failed'`) and per §11.0 MUST suppress its terminal event. Symmetrically, a sweep tick racing a late tool-loop completion finds its UPDATE matches 0 rows and emits no event. Exactly one writer wins the row transition per attempt; only that writer emits the terminal event. The closure is self-enforcing at every emitter rather than relying on absence-of-race-condition between three independent writers.

### 11.4 Synthetic check writes

| Concern | Posture |
|---|---|
| Idempotency (silent agent success) | **Key-based** via `recordIncident`'s `idempotencyKey` = `synthetic:silent-agent-success:agent:<slug>:<bucketKey>`. Same bucket = same key = no duplicate. |
| Idempotency (incident silence) | **Key-based** via `idempotencyKey` = `synthetic:incident-silence:system:monitoring:<bucketKey>`. |
| Retry classification | **Safe** — `recordIncident` is fire-and-forget (NEVER throws per `incidentIngestor.ts:5-7`). Retries on the synthetic-check tick are absorbed at ingest. |
| Concurrency guard | Inherited from existing `incidentIngestor` throttle + idempotency layer (`incidentIngestorThrottle.ts`, `incidentIngestorIdempotency.ts`). No new guards. |

### 11.5 Failed-triage filter

Read-only query. No write path, no idempotency / retry / concurrency surface. Section 11 N/A for Phase 4.

### 11.6 State machine closure

`triage_status` is a closed enum: `'pending' | 'running' | 'failed' | 'completed'`. Adding a new value requires a spec amendment. Valid transitions after this spec lands:

| From → To | Trigger | Notes |
|---|---|---|
| `pending` → `running` | First triage attempt (idempotent UPDATE returns 1 row) | Existing |
| `running` → `completed` | Tool loop success | Existing |
| `running` → `failed` | Tool loop failure terminal | Existing |
| `running` → `failed` | Staleness sweep | **New transition trigger, same destination** — same enum value, no new state |
| `failed` → `running` | Operator manual retry (new `jobId`) | Existing transition; new attempt fires the idempotent UPDATE |
| `completed` → `running` | Operator manual retry (re-triage) | Same as above |
| `pending` → `failed` | (forbidden — must transit `running`) | n/a |
| Any → `pending` | (forbidden — `pending` is the initial state only) | n/a |

The sweep does NOT introduce a new `triage_status` value. It introduces a new *trigger* for the existing `running → failed` transition. This is a state-machine modification, not a state-machine extension — closure is preserved.

`diagnosis_status` is unchanged by this spec. No new transitions, no new values.

## 12. Testing posture

Static gates + pure-helper unit tests. Conforms to `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
api_contract_tests: none_for_now
e2e_tests_of_own_app: none_for_now
```

### 12.1 What this spec adds

| Test file | Type | Tooling | What it asserts |
|---|---|---|---|
| `triageIdempotencyPure.test.ts` | Pure unit | `npx tsx` | Predicate correctness on `(currentJobId, candidateJobId)` boundary cases. |
| `staleTriageSweepPure.test.ts` | Pure unit | `npx tsx` | The cutoff calculation is correct on boundary timestamps; `parseStaleAfterMinutesEnv` falls back to `10` for `undefined`, `''`, `'abc'`, `'0'`, `'-5'`, and parses valid positive integers. |
| `silentAgentSuccessPure.test.ts` | Pure unit | `npx tsx` | Ratio threshold + minSamples gate. |
| `incidentSilencePure.test.ts` | Pure unit | `npx tsx` | Silence + proof-of-life predicate. |
| `triageDurability.integration.test.ts` | Integration (real DB) | `npx tsx` against test DB | The G1+G2 coordination contract — see §7.3. |

The integration test is the only DB-touching test. It is justified per the same principle as `bundleUtilizationJob.idempotency.test.ts` and the connector-polling-sync idempotency tests already in the repo: the contract under test relies on Postgres semantics that an in-memory mock cannot faithfully reproduce. The test file follows the existing convention (`__testHooks` seam, `dotenv/config`, `npx tsx` runnable, no vitest/jest framework).

### 12.2 What this spec does NOT add

- **No frontend unit tests** for `DiagnosisFilterPill` extension. Per framing — frontend tests are deferred. The change is one entry in a literal array; type-checking is the gate.
- **No API contract tests** for the new `diagnosis=failed-triage` query param. Per framing — `api_contract_tests: none_for_now`. The Zod enum extension catches malformed values at the parse layer.
- **No E2E test** of operator selecting "Failed triage" pill and seeing filtered incidents. Per framing — `e2e_tests_of_own_app: none_for_now`.
- **No new gates in `scripts/gates/`**. The static gates touched (`verify-rls-coverage.sh`, `verify-job-idempotency-keys.sh`, `verify-heuristic-purity.sh`) all continue to pass without modification — no new RLS surface, no new pg-boss queue, no heuristic touched.

### 12.3 Static gate coverage check

Before merge, confirm:

| Gate | Expected outcome |
|---|---|
| `npx tsc --noEmit` | Passes — `runTriage` signature change is the largest type ripple; verify the job handler call site and any other callers compile. |
| `bash scripts/run-all-unit-tests.sh` | Passes — runs the four new pure tests + all existing pure tests. |
| `npm run db:generate` | Produces a clean diff matching the migration in §5.1. No drift. |
| `npm run lint` | Passes. |
| `bash scripts/verify-job-idempotency-keys.sh` | Passes — the synthetic-check tick handler is not a new pg-boss queue (it's a tick on the existing `system-monitor-synthetic-checks` queue), so no manifest change. |

Per CLAUDE.md gate-cadence rule, `npm run test:gates` is NOT run mid-iteration. Run only when the user signals "we're done, prepare for merge."

## 13. Deferred Items

Items that this spec deliberately does not implement. Each remains tracked in [`tasks/post-merge-system-monitor.md`](../../post-merge-system-monitor.md) until promoted to its own spec.

### 13.1 Tier-2 items (deferred per the prioritisation analysis)

- **Correlation-ID propagation enforced as invariant.** Phase 1 will continue to thread `correlationId` through `recordIncident` by convention; this spec does not introduce a gate, logger middleware, or required-field-on-context. Reason: design-pending — the resolution converges with the staleness-guard pattern but the right enforcement layer (gate? middleware? required field?) is not yet decided. Promote to its own spec when ready.

- **Frozen heuristic evaluation context.** Heuristics continue to read baselines via `BaselineReader` on demand. Touches 24 heuristic modules + a CI gate. Reason: architectural — replay determinism is a real benefit but the cost-of-change is high relative to the launch-window value. Promote to its own spec.

- **Baseline-update guard during anomaly storms.** No guard added between baseline refresh and anomaly rate. Reason: tuning concern — needs real production anomaly data to set the threshold correctly. Pre-prod tuning is theoretical.

- **Resolution-tag taxonomy.** `prompt_was_useful` (boolean) + free-text feedback remains as the only resolution-time capture. Reason: operator workflow change requires a few weeks of real resolutions to inform the right taxonomy.

- **Auto-tuning feedback loop from resolution tags.** Not started. Reason: marked "investigate first" — auto-tuning monitoring from operator tags is a footgun without dedicated spec safeguards (signal weighting, decay, consensus thresholds, A/B isolation, rollback path). Do not start work on this loop until the spec exists.

### 13.2 Other intentional deferrals from this spec

- **Heartbeat-based stuck-job detection.** Considered as alternative to staleness sweep (option (b) in the post-merge file). Rejected for now in favour of the simpler sweep pattern (§7.2). If a second long-running async-work primitive needs the same recovery semantics, the heartbeat pattern is the natural promotion path.

- **A separate `system_monitor_triage_attempts` history table.** Considered as alternative to the single `last_triage_job_id` column. Rejected per §6 — a history table is a new RLS-protected primitive carrying perpetual rows for a question that one column answers in one round-trip.

- **Operator UI surfacing of `last_triage_job_id`.** This column is internal (per §4.1 source-of-truth precedence). Operators do not need it. If it ever becomes useful for debugging, surface it in the detail-drawer "raw" panel — but not in this spec.

- **Cross-instance staleness sweep coordination.** Multi-instance deploys will run the sweep tick in parallel. The optimistic predicate (§11.2) makes this safe but inefficient (each instance does the same UPDATE, only one wins per row). Not optimised here — sweep cost is low, and the synthetic-checks tick is already idempotent at this granularity. If load grows, an `advisory_lock_idle` style guard can be added later.

- **Telemetry on idempotent skips.** When the predicated UPDATE returns 0 rows (`reason: 'duplicate_job'`), we emit a structured log at info under the event name `triage.idempotent_skip` with `{ incidentId, jobId, reason: 'duplicate_job' }` (per §7.1). We do NOT increment a database counter or emit an incident. The event-name contract gives log-aggregator visibility into retry-storm volume without a DB write surface. This is intentional — duplicate-job skips are expected behaviour under pg-boss internal retries, not a problem signal. If the rate of duplicate-job skips becomes pathologically high (e.g. signals a worker stuck in a retry loop), the existing pg-boss DLQ + `pg-boss-queue-stalled` synthetic check are the right detection points.

## 14. Acceptance criteria

A reviewer can confirm this spec is satisfied by running each check below and observing the expected outcome. Each maps to one or more of G1–G5.

### 14.1 Phase 1 (G1 + G2)

| # | Check | Expected outcome |
|---|---|---|
| A1.1 | Apply migration `0239_*.sql`. | `system_incidents.last_triage_job_id` column exists, type `text NULL`, no default. |
| A1.2 | Run `triageIdempotencyPure.test.ts`. | Pass. |
| A1.3 | Run `staleTriageSweepPure.test.ts`. | Pass. |
| A1.4 | Run `triageDurability.integration.test.ts`. | Pass — exercises the full G1+G2 flow per §7.3. |
| A1.5 | Manually insert a `system_incidents` row with `triage_status='running'`, `last_triage_attempt_at = now() - 15 min`. Run `runStaleTriageSweep()`. | `triage_status='failed'`, `triage_attempt_count` unchanged, exactly one `agent_triage_timed_out` event with payload per §4.3. |
| A1.6 | Call `runTriage(id, 'job-X')` twice with the same `jobId`. | First call increments counter and proceeds; second call returns `{ status: 'skipped', reason: 'duplicate_job' }` and counter unchanged. |
| A1.7 | Set `SYSTEM_MONITOR_TRIAGE_STALE_SWEEP_ENABLED=false` and run the synthetic-check tick. | Sweep does not run (no log line, no UPDATE); other synthetic checks proceed normally. |

### 14.2 Phase 2 (G3)

| # | Check | Expected outcome |
|---|---|---|
| A2.1 | Run `silentAgentSuccessPure.test.ts`. | Pass. |
| A2.2 | Inspect `SYNTHETIC_CHECKS` array. | Includes `silentAgentSuccess` entry. |
| A2.3 | Seed test DB: 5 `agent_runs` for a system-managed agent, status='completed', no rows in any of `agent_execution_events`, `system_incident_events`, `skill_executions` referencing those run IDs. Run synthetic-checks tick. | Incident created with `source='synthetic'`, fingerprint matches §4.4, severity=`medium`. |
| A2.4 | Same seeding but only 4 runs (below MIN_SAMPLES). | No incident. |
| A2.5 | Same seeding but 5 runs all of which have at least one `skill_executions` row. | No incident. |

### 14.3 Phase 3 (G4)

| # | Check | Expected outcome |
|---|---|---|
| A3.1 | Run `incidentSilencePure.test.ts`. | Pass. |
| A3.2 | Inspect `SYNTHETIC_CHECKS` array. | Includes `incidentSilence` entry. |
| A3.3 | Seed test DB: zero non-silence `system_incidents` in last 12h, one `system_incidents` row with `source='synthetic'` and `metadata.checkId != 'incident-silence'` (e.g. `agentRunSuccessRateLow`) created 18h ago. Run synthetic-checks tick. | Incident created with fingerprint `synthetic:incident-silence:system:monitoring`, severity=`high`. |
| A3.4 | Seed test DB: zero `system_incidents` ever. | No incident (cold-start tolerance). |
| A3.5 | Seed test DB: one non-silence `system_incidents` in last 12h. | No incident. |
| A3.6 | Seed test DB: zero non-silence `system_incidents` in last 12h, BUT three `system_incidents` rows with `source='synthetic' AND metadata.checkId='incident-silence'` created 6h / 12h / 18h ago. Run synthetic-checks tick. | No incident — silence-check rows do not count as proof-of-life (§9.6, §9.1 `synthetic_fires_in_proof_window` exclusion). |

### 14.4 Phase 4 (G5)

| # | Check | Expected outcome |
|---|---|---|
| A4.1 | `npx tsc --noEmit`. | Pass — `DiagnosisFilter` union extension types through to `SystemIncidentsPage` without error. |
| A4.2 | `GET /api/system/incidents?diagnosis=failed-triage` (as system admin). | 200 with incidents matching `triage_status='failed' AND diagnosis_status IN ('none','partial','invalid')`. |
| A4.3 | Same call as a non-admin. | 403 (existing route guard). |
| A4.4 | `GET /api/system/incidents?diagnosis=invalid-value`. | 400 (Zod enum rejection). |
| A4.5 | Open `SystemIncidentsPage` in a browser, click the "Failed triage" pill. | List filters to the matching incidents. |

### 14.5 Cross-spec consistency

| # | Check | Expected outcome |
|---|---|---|
| A5.1 | Inspect `tasks/post-merge-system-monitor.md` after merge. | The five Tier-1 items are checked off (`- [x]`) with a one-line cross-reference to this spec. Tier-2 items remain `- [ ]`. |
| A5.2 | `architecture.md` — search for "system-monitor" / "triage". | Updated to mention `last_triage_job_id` column purpose and the staleness sweep tick if either is referenced in existing prose. (If existing prose does not mention the affected surface, no update needed — see CLAUDE.md §11.) |
| A5.3 | `docs/capabilities.md` — search for system-monitor capabilities. | No change. The Failed-triage pill is a refinement of an existing operator capability; no new capability entry. |

### 14.6 Definition of done

The spec is fully implemented when:

- All migrations run cleanly up + down on a fresh DB.
- All five pure unit tests + the integration test pass.
- `npx tsc --noEmit`, `npm run lint`, `npm run db:generate` all clean.
- All A1–A5 acceptance checks above pass.
- `tasks/post-merge-system-monitor.md` is updated per A5.1.
- `pr-reviewer` runs clean (no unaddressed findings).
- `spec-conformance` runs clean against this spec (no `NON_CONFORMANT` items, mechanical fixes auto-applied if any surface).



### 5.3 RLS

`system_incidents` is an admin-bypass-RLS table per the schema header comment ("BYPASSES RLS — every reader MUST be sysadmin-gated at the route/service layer"). No RLS policy change. No `RLS_PROTECTED_TABLES` change. Section 4 of the spec-authoring checklist (Permissions / RLS) is satisfied by the existing route-level `requireSystemAdmin` guard; the new column inherits that posture.


