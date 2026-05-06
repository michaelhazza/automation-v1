# F3 Baseline Capture at Sub-Account Onboarding — Implementation Plan

| Field | Value |
|---|---|
| Spec | `docs/baseline-capture-spec.md` |
| Branch | `claude/baseline-capture` |
| Worktree | `C:\Files\Projects\automation-v1.baseline-capture\` (referred to below as `<worktree>`) |
| Migrations | `0278_subaccount_baselines.sql`, `0279_subaccount_baseline_metrics.sql`, `0280_baseline_rls_and_dictionary.sql` (each paired with `.down.sql`) |
| Stream | 2 of 2 — F1 (`subaccount-artefacts`, PR #263) merged on `main`; F3 starts now |
| Status | READY |
| Plan model | Opus (decomposition) → execute on Sonnet |
| Migration high-water on main at plan time | `0277_subaccount_baseline_artefacts.sql` (F1) — confirmed 2026-05-04 |

> All paths in this plan are relative to the **worktree root** `<worktree>`, not to the main session's CWD. Code is written there. The plan itself lives in the main repo at `tasks/builds/baseline-capture/plan.md` because plans are coordination documentation, not code.

---

## Table of contents

- [Model-collapse check](#model-collapse-check)
- [Architecture notes](#architecture-notes)
- [Chunk list](#chunk-list)
- [Forward dependency graph](#forward-dependency-graph-no-backward-refs)
- [Executor notes](#executor-notes)
- [Chunk 1A — Migrations 0278/0279 + Drizzle schemas](#chunk-1a--migrations-02780279--drizzle-schemas)
- [Chunk 1B — Migration 0280 (RLS) + canonical dictionary + settings schema](#chunk-1b--migration-0280-rls--canonical-dictionary--settings-schema)
- [Chunk 1C — Pure validator + retry classifier tests](#chunk-1c--pure-validator--retry-classifier-tests)
- [Chunk 2A — `baselineReadinessService` + onboarding pending-row insert](#chunk-2a--baselinereadinessservice--onboarding-pending-row-insert)
- [Chunk 2B — `connector.sync.complete` event + subscriber + cron fallback](#chunk-2b--connectorsynccomplete-event--subscriber--cron-fallback)
- [Chunk 3A — `captureBaselineService` core](#chunk-3a--capturebaselineservice-core)
- [Chunk 3B — Per-metric readers + retry job](#chunk-3b--per-metric-readers--retry-job)
- [Chunk 3C — `baselineInvariants.test.ts` + integration test](#chunk-3c--baselineinvariantstestts--integration-test)
- [Chunk 4A — UI components + server routes](#chunk-4a--ui-components--server-routes)
- [Chunk 4B — `AdminSubaccountDetailPage` wiring](#chunk-4b--adminsubaccountdetailpage-wiring)
- [Chunk 5 — Reporting Agent delta integration](#chunk-5--reporting-agent-delta-integration)
- [Chunk 6 — Closeout](#chunk-6--closeout-capability-docs--manual-verification--progress-note)
- [Risks and mitigations](#risks-and-mitigations)
- [Self-consistency pass](#self-consistency-pass--coverage-check-against-spec-10-done-definition)
- [File inventory cross-check vs spec §9](#file-inventory-cross-check-vs-spec-9)
- [Deferred Items](#deferred-items)
- [Sign-off](#sign-off)

---

## Model-collapse check

Question 1 — does this feature decompose into ingest → extract → transform → render? Partially. Per-metric readers fetch from `canonical_metrics` (already-ingested data); the capture service aggregates and writes a baseline row; the Reporting Agent later renders delta narration. There is no LLM call in the F3 critical path.

Question 2 — could a frontier multimodal model do this in a single call? No. The work is deterministic numeric capture from structured tables (`canonical_metrics`, `connector_configs`). An LLM cannot replace `SELECT current_value FROM canonical_metrics WHERE …` — this is precisely the class of work where model jaggedness, non-determinism, and cost would degrade an otherwise mechanical operation. The downstream Reporting Agent narration (Phase 5) is the only place an LLM enters, and it operates over the captured rows; that step is already a single LLM call inside an existing skill.

Decision: **collapse rejected.** A baseline is an immutable numeric snapshot. Determinism, audit trail, and idempotent retry semantics demand a service-layer write path, not a model call. The Reporting Agent already collapses the narration step into a single skill call — that part is correctly model-driven; the capture is correctly deterministic.

---

## Architecture notes

Decisions and the reasoning behind them.

### 1. The `capturing` status — single-writer enforcement during in-flight

Spec §5.1 introduces `capturing` as an explicit DB-visible state between `pending|ready` and the terminal `captured|failed`. Two retry workers picking up the same baseline would otherwise both start work, double-fire telemetry, and race to overwrite metric rows. The lock-acquisition step is:

```sql
UPDATE subaccount_baselines
SET status = 'capturing', last_attempt_at = now()
WHERE id = $1
  AND status IN ('pending', 'ready')
RETURNING id, organisation_id, subaccount_id, capture_attempt_count;
```

Single source of authority for "exactly one runnable row per sub-account": the partial UNIQUE index (§2 below). The lock acquisition does NOT need to subquery `MAX(baseline_version)` to disambiguate — the partial UNIQUE on `(subaccount_id) WHERE status <> 'reset'` already guarantees that a given sub-account has at most one non-reset row, and reset rows are filtered out by the `status IN ('pending','ready')` predicate. Adding a `baseline_version` clause would couple the lock to versioning logic in a way that creates regression risk if the version model evolves. Keep invariant enforcement in one place — the index.

Zero rows returned is a **clean exit**, not an error: the row is no longer in a runnable state because (a) another worker beat us to it, or (b) the row was reset, or (c) the row is already `captured`/`failed`/`manual`. The job logs the miss with structured context (see §3A step 2) and returns; it does not throw.

- **Considered:** advisory locks via `pg_try_advisory_lock(subaccountId-as-bigint)`. Rejected because the lock state is invisible in the DB (impossible to debug from `SELECT * FROM subaccount_baselines`) and because advisory locks survive transaction boundaries unpredictably.
- **Considered:** a `lock_expires_at` column with a stale-lock reaper. Rejected because it adds a second background sweeper for a problem the partial UNIQUE index + `UPDATE … WHERE status IN (…) RETURNING` already solves cleanly.

### 2. The partial UNIQUE index — `WHERE status <> 'reset'`, NOT `(subaccount_id, baseline_version)`

```sql
CREATE UNIQUE INDEX subaccount_baselines_active_uniq
  ON subaccount_baselines(subaccount_id)
  WHERE status <> 'reset';
```

The §10 hard invariant is "Exactly one ACTIVE baseline per sub-account." If the index were on `(subaccount_id, baseline_version)`, two non-reset rows at different versions could coexist for the same sub-account — defeating the invariant. The reset transaction is therefore a single SQL block:

```sql
BEGIN;
  UPDATE subaccount_baselines SET status = 'reset', reset_at = now(), reset_by_user_id = $1, admin_reset_reason = $2
    WHERE subaccount_id = $3 AND status <> 'reset';  -- vacates the partial index
  INSERT INTO subaccount_baselines (organisation_id, subaccount_id, baseline_version, status)
    VALUES ($org, $sub, (SELECT COALESCE(MAX(baseline_version), 0) + 1 FROM subaccount_baselines WHERE subaccount_id = $sub), 'pending');
COMMIT;
```

Outside the transaction, a non-reset row blocks the new INSERT — the prior row must be marked `reset` first. This is what makes the four-writer surface (subscriber, fallback cron, retry, manual entry) safe to leave in place: each writer either gets the row or doesn't, deterministically.

### 3. Single-writer rule

`captureBaselineService` is the only service that mutates `subaccount_baselines.status` after the initial `pending` row insert. Every other surface emits signals only:

| Surface | Action |
|---|---|
| `subaccountOnboardingService.markBaselinePending` | INSERT initial `pending` row (only at creation time) |
| Subscriber on `connector.sync.complete` | Calls `evaluate`; on `ready` enqueues capture job |
| `evaluateAllPendingBaselines` cron | Same as above, fallback path |
| `<ManualBaselineForm>` POST handler | Calls `captureBaselineService.runManual(...)` |
| `<AdminBaselineResetButton>` POST | Calls `captureBaselineService.adminReset(...)` |

Concentrating writes in one service is what makes the §3 idempotency invariants enforceable. **Asserted in code by `baselineInvariants.test.ts`** (Chunk 3C) — a grep over `server/services/**` for `INSERT INTO subaccount_baselines` and `UPDATE subaccount_baselines` returns matches only inside `captureBaselineService.ts` and the single creation-time insert in `subaccountOnboardingService.ts`.

### 4. Retry classification — 3-attempt budget, retryable vs non-retryable

Errors are classified at the per-metric reader boundary. Aggregate classification at the service boundary determines next state:

| Class | Examples | Retry? | Next state |
|---|---|---|---|
| Retryable | HTTP 5xx, 429, network timeouts, `no_data_yet`, transient DB serialisation | Yes — backoff 1h / 4h / 24h | `ready` (cron re-picks at next eligible window) |
| Non-retryable | HTTP 4xx (other than 429), schema mismatch, `integration_not_connected`, missing reader | No | `failed` immediately; consumes 0 retry budget |
| Soft-success | ≥2 metrics already captured | n/a | `captured` with `confidence='partial'` |

After 3 retryable failures: `failed` with `failure_reason='retry_budget_exhausted'`. `failed` rows are terminal — the cron does not re-enqueue them. Recovery is via `<ManualBaselineForm>` only. Non-retryable failures bypass retry budget so a sub-account whose connector isn't installed never burns 3 attempts before surfacing for manual entry.

Backoff anchor is `last_attempt_at`. Cron query for retry pickup:

```sql
SELECT id FROM subaccount_baselines
WHERE status = 'ready'
  AND capture_attempt_count > 0
  AND last_attempt_at <= now() - INTERVAL '<window>'
```

Window per attempt: 1h after attempt 1, 4h after attempt 2, 24h after attempt 3 → `failed`. Pure-function classifier in `baselineRetryClassifierPure.ts` is unit-tested (Chunk 1C).

### 5. Idempotent metric writes — `ON CONFLICT (baseline_id, metric_slug) DO UPDATE`

The PK on `subaccount_baseline_metrics(baseline_id, metric_slug)` means re-running capture for the same baseline overwrites rather than duplicates:

```sql
INSERT INTO subaccount_baseline_metrics (baseline_id, metric_slug, value, source, unavailable_reason)
VALUES (...)
ON CONFLICT (baseline_id, metric_slug) DO UPDATE
  SET value = EXCLUDED.value,
      source = EXCLUDED.source,
      unavailable_reason = EXCLUDED.unavailable_reason,
      captured_at = now();
```

The §10 invariant "calling `captureBaselineService.run` twice for the same `ready` baseline produces the same row state" is enforced by this ON CONFLICT plus the lock acquisition (§1 above). Tested in `baselineInvariants.test.ts`.

### 6. Timestamp invariant — Postgres `now()` only, never `Date.now()`

Every `TIMESTAMPTZ` in `subaccount_baselines` and `subaccount_baseline_metrics` is set by the database (`DEFAULT now()` on column or `sql\`now()\`` in service code). This guarantees deterministic ordering across application servers with clock drift, and makes month-over-month delta narration in the Reporting Agent reproducible.

Enforced by the §10 hard invariant: a CI grep over the full F3 capture surface (`captureBaselineService.ts`, `baselineReadinessService.ts`, `baselineSubscriberService.ts`, `baselineMetricReaders/`, `reportingAgent/baselineHelper.ts`, `server/jobs/captureBaselineJob.ts`, `server/jobs/evaluateAllPendingBaselines.ts`) for `Date.now()` returns zero hits. The grep lives in `baselineInvariants.test.ts` (Chunk 3C). Duration measurement uses `process.hrtime.bigint()` (monotonic, immune to NTP) — not a wall-clock timestamp and intentionally excluded from the grep target.

### 7. Per-metric reader pattern — one file per slug, uniform contract

Each v1 metric has a dedicated reader file under `server/services/baselineMetricReaders/`:

```ts
export interface MetricReaderResult {
  value: { numeric: number; currency?: string; unit: string } | null;
  source: 'canonical_metric' | 'unavailable';
  unavailable_reason?: 'integration_not_connected' | 'api_failure' | 'no_data_yet';
  errorClass?: 'retryable' | 'non_retryable';  // set when source='unavailable'
}

export type BaselineMetricReader = (
  ctx: { organisationId: string; subaccountId: string }
) => Promise<MetricReaderResult>;
```

Files: `getPipelineValue.ts`, `getOpenOpportunityCount.ts`, `getLeadCount.ts`, `getConversationEngagement.ts`, `getRevenueLast30d.ts`. The capture service dispatches via a registry map `READERS: Record<MetricSlug, BaselineMetricReader>`. Out-of-scope metrics (GMB, Stripe MRR/customer/churn) are recorded as `unavailable` with `unavailable_reason='integration_not_connected'` and `errorClass='non_retryable'` directly from the registry — they don't get their own reader, just a synthetic entry.

- **Considered:** one big `getAllMetrics(subaccountId)` function. Rejected because per-metric isolation makes retry classification clean (one reader's HTTP 5xx doesn't poison sibling readers' results) and unit-testing each reader becomes trivial.

### 8. Readiness condition — pure read, deterministic, restart-safe

`baselineReadinessService.evaluate(subaccountId)` is a pure read over `connector_configs`, the polling-completion signal, and `canonical_metrics`. Returns:

```ts
{ ready: boolean, missing: string[], reason?: string, qualifying_poll_count: number, earliest_qualifying_poll_at: Date | null }
```

Idempotent — calling 1× or 100× per sub-account produces the same answer until the underlying data changes. **Resolves the spec §4 caveat** "resolve canonical source [for poll history] at build start" as follows: `connectorPollingService` writes `last_sync_at` and `last_sync_status` on `connector_configs` itself but does NOT maintain a `connector_poll_history` table on main (verified at plan time via `Grep` — zero matches in `server/db/schema/**`).

**Locked decision:** Chunk 1A adds two columns to `connector_configs` via migration 0278: `successful_poll_count_total` (INTEGER, default 0) and `first_qualifying_poll_at` (TIMESTAMPTZ, nullable). The polling service updates both on every successful sync (Chunk 2B). The readiness condition derives the four §4 checks from these two columns + `canonical_metrics` non-null counts. The "≥1h settle window" check uses `now() - first_qualifying_poll_at >= interval '1 hour'` evaluated **inside Postgres** — never `Date.now() - earliest.getTime()` in application code. DB-time-as-source-of-truth (§6) applies even to ephemeral comparisons; running the comparison in SQL eliminates clock-drift risk across application servers and removes the `Date.now()` allowance from `baselineReadinessService.ts` entirely.

- **Considered:** add a `connector_poll_history` table. Rejected because it duplicates information already captured in `connector_configs` for the only data the readiness evaluator needs (count + earliest qualifying timestamp), and no other consumer needs full poll history. If a future feature needs full per-poll audit, that's its migration to add.

### 9. Trigger model — signal vs writer

Spec §4 makes this explicit and the implementation must preserve the separation:

- **Event-driven signal (subscriber):** `connectorPollingService` emits `connector.sync.complete` on every successful poll. Subscriber `onSyncCompleteEvaluateReadiness(subaccountId)` calls `baselineReadinessService.evaluate`. If `{ready:true}` AND status is `pending`, enqueue `captureBaselineJob`. **No write to `subaccount_baselines`** in the subscriber.
- **Cron fallback signal:** daily pg-boss job `evaluateAllPendingBaselines` iterates `pending` rows + `ready` rows due for retry, evaluates readiness, enqueues the capture job. **No write.**
- **Manual override:** `<ManualBaselineForm>` POST → `captureBaselineService.runManual(...)`. Same single-writer entrypoint.
- **Admin reset:** `<AdminBaselineResetButton>` POST → `captureBaselineService.adminReset(...)`. Same entrypoint.

The `pending → ready` transition is implicit: it never persists. Readiness is evaluated lazily; the lock-acquisition step matches both `pending` and `ready` so the first-ever capture (initial `pending` row) and retry pickups (rows already moved to `ready`) flow through the same `UPDATE … RETURNING` statement.

### 10. `baseline_metrics_opt_in` lives in `subaccounts.settings` JSONB

The spec text says `subaccount_settings.baseline_metrics_opt_in[]`. There is **no separate `subaccount_settings` table** on main — `subaccounts.settings` (existing nullable JSONB column) is the canonical store. F3 extends the existing `shared/schemas/subaccount.ts` (which F1 already shipped with `baselineArtefactsStatusSchema`) to add a sibling `subaccountSettingsSchema` whose shape is `{ baseline_metrics_opt_in?: string[] }`. The capture service reads `subaccounts.settings.baseline_metrics_opt_in ?? <full v1 set>`.

- **Considered:** a dedicated `subaccount_settings` table. Rejected — F1 added a JSONB column on `subaccounts` for the same class of state; doing the same here is consistent and avoids a 4th migration.

### 11. Reporting Agent integration — pure helper, no schema change

`getBaselineForSubaccount(subaccountId): Promise<BaselineSnapshot | null>` lives in `server/services/reportingAgent/baselineHelper.ts`. Reads the active baseline + its metric rows. Returns null when no baseline is `captured` (or `manual`/`mixed`). The `generate_portfolio_report` skill (in `intelligenceSkillExecutor.ts`) is extended to call this helper per sub-account and compute `delta = current - baseline.value`, `pct = (delta / baseline.value) * 100`. Honest-gap narration: when a metric is `unavailable` at baseline, narrate "first measurement is today's value" rather than fabricating a delta.

### 12. RLS — full template, both new tables

Both new tables are tenant-owned and require RLS in the same migration that creates them (DEVELOPMENT_GUIDELINES §1). The canonical RLS policy template (per `migrations/0245_all_tenant_tables_rls.sql`) is applied in migration 0280. Both tables register in `server/config/rlsProtectedTables.ts`.

### 13. Capture-duration telemetry — `duration_ms` on terminal events

`captureBaselineService.run` measures wall-clock duration via `process.hrtime.bigint()` (monotonic; immune to NTP adjustments and the §6 DB-time invariant) and emits `duration_ms` on each terminal event: `baseline.capture.succeeded`, `baseline.capture.failed`, `baseline.capture.retry_scheduled`. This surfaces slow readers and per-org scaling pressure (a degrading canonical_metrics scan against a large org becomes visible in telemetry before it manifests as user-reported delay). Lightweight — three numeric fields on existing events, no new event type.

**Anchor placement:** the start timestamp is taken **after** successful lock acquisition, not before. Including lock-contention time in `duration_ms` would mix two different signals (queue wait vs. work time) into one number; placing the anchor after the lock means `duration_ms` is the time the worker actually spent doing work for this attempt.

**Semantics — not comparable to DB timestamps:** `process.hrtime.bigint()` is process-monotonic clock time. It is NOT a wall-clock timestamp; it cannot be compared to `captured_at`, `last_attempt_at`, or any other `TIMESTAMPTZ` value. Telemetry consumers MUST treat `duration_ms` as a duration (a delta), never as a point in time. Per-reader durations (§14 below) follow the same rule.

### 14. Per-reader `duration_ms` — diagnostic field

For each metric in `perMetric`, the capture service measures the reader's elapsed time (process-monotonic) and includes it in the `baseline.metric.captured` and `baseline.metric.unavailable` telemetry events. This surfaces *which* integration is slow (vs. only that capture as a whole is slow) and lets dashboards distinguish "GHL pipeline reader is degrading" from "Stripe revenue reader is degrading". Same monotonic-clock semantics as §13 — a duration, never a timestamp.

### 15. `next_attempt_at` invariant — model rule

`next_attempt_at` is set only on the retry transition and cleared on every terminal transition. Our state model never persists `status='ready'` for the first-capture path (the readiness transition is `pending → capturing` directly), so:

- `status = 'ready'` → `next_attempt_at IS NOT NULL` (the row is awaiting a retry)
- `status IN ('pending','capturing','captured','failed','manual','reset')` → `next_attempt_at IS NULL`

Stated as: `next_attempt_at IS NOT NULL ↔ status = 'ready'`. Documented invariant; asserted by Chunk 3C invariant 7. Not enforced as a DB CHECK constraint because the cross-column predicate adds index-write overhead to every UPDATE — the test assertion is sufficient and prevents the realistic regression mode (a future change to the retry path forgetting to set or clear the column).

### 16. Retry backoff — explicit ceiling

The §5.4 schedule is `[1h, 4h, 24h]` with a 3-attempt budget. Two consequences worth stating:

- **Ceiling is 24h.** No additional cap is needed because `nextBackoffMinutes(4) === null` and `isRetryBudgetExhausted(3) === true` → the row transitions to `failed` rather than computing a longer interval. Documented to prevent a future change from extending the array without realising the cap is the array length, not a `min()`.
- **No starvation under repeated failure.** A row hits `failed` on the 3rd retryable attempt; recovery is operator-driven via `<ManualBaselineForm>` only. The cron is incapable of re-enqueuing a `failed` row (eligibility filter excludes it). This is the §5.4 contract — making it explicit here so future work doesn't introduce a "soft retry" path that bypasses the budget.

### 17. Retry-job early-exit rule

Every entry point into `captureBaselineService.run` (subscriber, fallback cron, manual route's auto-trigger if any) MUST early-exit when the row is no longer in `('pending','ready')` state. This is enforced two ways:

1. **Pre-read at the worker entrypoint** (Chunk 3A step 0) — emits a structured `lock_miss` log with reason classification.
2. **Lock acquisition predicate** (`status IN ('pending','ready')`) — zero rows returned is a clean exit.

The combined effect: a manual override that lands while a retry job is queued does NOT cause a double-write — the retry job's pre-read sees `status='manual'` and exits with `reason: 'pre_read_terminal'`, and even if it raced past the pre-read, the lock acquisition would return zero rows. Stated as a rule so the next person who adds a fourth entry point (e.g. a new admin-replay endpoint) preserves the same guard.

---

## Chunk list

A "chunk" is a single builder-session-sized unit. Phase 1 splits into 1A (data tables + Drizzle), 1B (RLS + canonical dictionary + settings schema), 1C (pure validator tests). Phase 2 splits into 2A (readiness service + pending-row insert hook) and 2B (event emit + subscriber + fallback cron). Phase 3 splits into 3A (capture service core), 3B (per-metric readers + retry job), 3C (invariants + integration test). Phase 4 splits into 4A (UI components + server routes) and 4B (admin page wiring). Phase 5 is the Reporting Agent delta. Phase 6 is closeout.

| # | Name | Phase | Files (count) | Estimated effort |
|---|---|---|---|---|
| 1A | Migrations 0278/0279 + Drizzle schemas | 1 | 6 | 1.5h |
| 1B | Migration 0280 (RLS) + rlsProtectedTables + canonical dictionary + settings schema | 1 | 5 | 2h |
| 1C | Pure validator + retry classifier tests | 1 | 5 + 2 tests | 2h |
| 2A | `baselineReadinessService` + onboarding pending-row insert | 2 | 4 + 1 test | 2.5h |
| 2B | `connector.sync.complete` event + subscriber + cron fallback | 2 | 5 + 1 test | 2.5h |
| 3A | `captureBaselineService` core | 3 | 3 + 1 test | 3h |
| 3B | Per-metric readers + retry job | 3 | 7 + 1 test | 3h |
| 3C | `baselineInvariants.test.ts` + integration test | 3 | 2 tests | 2h |
| 4A | UI components + server routes (manual + reset + status) | 4 | 5 + 0 tests (per spec-context UI policy) | 3h |
| 4B | `AdminSubaccountDetailPage` wiring | 4 | 1 | 1.5h |
| 5 | Reporting Agent delta integration | 5 | 2 + 1 test | 2.5h |
| 6 | Closeout — capability docs + manual verification + progress note | 6 | 4 docs | 1.5h |

Total estimated: ~26-27h. Matches spec §8 phase ranges (3+5+5+4+3+2 = 22h) with overhead for the F1 coordination work and richer test coverage in Chunk 3C.

---

## Forward dependency graph (no backward refs)

```
1A → 1B → 1C → 2A → 2B → 3A → 3B → 3C → 4A → 4B → 5 → 6
                              ↑              (3C uses test scaffolding from 3A+3B)
                              └─ 3A blocks 3B (readers depend on capture entrypoint contract)
```

- 1A is the schema foundation; 1B requires the tables to exist (RLS attaches to them); 1C is pure tests against the schemas defined in 1A+1B.
- 2A wires the pending-row creation hook (depends on 1A's table); 2B adds the signal path (depends on 2A's existing readiness function).
- 3A is the writer service (depends on 1A's tables, 2A's readiness function); 3B's per-metric readers depend on 3A's contract (`MetricReaderResult` shape).
- 3C asserts §10 invariants — runs after 3A+3B because it integrates the capture path.
- 4A and 4B must ship together in one PR (cross-chunk dependency: 4A introduces the routes; 4B wires the page; the spec UX is incomplete with only one of them).
- 5 (Reporting Agent) depends on a captured baseline existing — uses 3A+3B's writes.
- 6 is closeout.

---

## Executor notes

- Run all chunks in the worktree at `<worktree>`. Switch into it before issuing commands.
- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- After each chunk: `npm run lint` + `npm run typecheck`. Add `npm run build:client` for chunks 4A and 4B. Add the targeted `npx tsx <test>` for any chunk that authors a test file.
- **Migration pre-flight at every schema phase (1A, 1B):** before authoring, run `ls migrations/*.sql | tail -10` and confirm `0277` is still the highest number on main. If main has moved, halt and request a re-allocation. Migrations `0278`, `0279`, `0280` are reserved for this build.
- F1 has shipped on main (PR #263). F1 added `markArtefactCaptured`, `markArtefactSkipped`, `markArtefactEdited`, `recordArtefactStarted` to `subaccountOnboardingService.ts`, plus `shared/schemas/subaccount.ts` with `baselineArtefactsStatusSchema`. F3 modifications are **ADDITIVE only** — do NOT modify those F1 methods or that F1 schema. Add a sibling method `markBaselinePending` and a sibling schema `subaccountSettingsSchema`.
- The user commits explicitly after reviewing changes. Do NOT auto-commit. Commit messages below are suggested; present them for the user to apply.
- Chunks 4A and 4B ship together in a single PR (same as F1's 4A+4B rule). The executor must complete both before opening the PR — split branches not permitted because the page wiring without the components produces a broken UI.
- Tests authored in Chunk 3C (`baselineInvariants.test.ts`) reference §10 hard invariants. They MUST be authored in this build and run targeted via `npx tsx`. **They are NOT claimed as "green" elsewhere in this plan** — until 3C runs, those assertions don't exist.

---

## Chunk 1A — Migrations 0278/0279 + Drizzle schemas

**Goal:** Create the two storage tables (`subaccount_baselines`, `subaccount_baseline_metrics`) and their Drizzle schemas. Add `successful_poll_count_total` + `first_qualifying_poll_at` columns to `connector_configs`. Establish the partial UNIQUE index, retry-pickup index, status CHECK constraints. Migrations are reversible.

**Phase:** 1

**Files:**
- create: `migrations/0278_subaccount_baselines.sql`
- create: `migrations/0278_subaccount_baselines.down.sql`
- create: `migrations/0279_subaccount_baseline_metrics.sql`
- create: `migrations/0279_subaccount_baseline_metrics.down.sql`
- create: `server/db/schema/subaccountBaselines.ts`
- create: `server/db/schema/subaccountBaselineMetrics.ts`
- modify: `server/db/schema/connectorConfigs.ts` (add `successful_poll_count_total` integer, `first_qualifying_poll_at` timestamptz)
- modify: `server/db/schema/index.ts` (export the two new tables)

**Steps:**

1. Pre-flight: `cd <worktree> && ls migrations/02*.sql | sort | tail -5`. Confirm `0277_subaccount_baseline_artefacts.sql` is highest. If a higher number appears (e.g. 0278+ landed since plan time), halt and re-allocate via the user.

2. Author `migrations/0278_subaccount_baselines.sql`:

   ```sql
   -- F3 Baseline Capture (spec §3) — primary baseline row per subaccount.
   -- See docs/baseline-capture-spec.md.
   CREATE TABLE subaccount_baselines (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organisation_id UUID NOT NULL REFERENCES organisations(id),
     subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
     baseline_version INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'capturing', 'captured', 'failed', 'manual', 'reset')),
     capture_attempt_count SMALLINT NOT NULL DEFAULT 0,
     last_attempt_at TIMESTAMPTZ,
     -- §5.4 — stamped explicitly on retry transitions (last_attempt_at + backoff
     -- window). The cron's eligibility filter could derive this from
     -- last_attempt_at + capture_attempt_count, but persisting it gives operators
     -- direct visibility into "when does this retry next?" without re-deriving
     -- the schedule. Set to NULL when status is not 'ready' with attempts > 0.
     next_attempt_at TIMESTAMPTZ,
     ready_at TIMESTAMPTZ,
     captured_at TIMESTAMPTZ,
     source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'mixed')) DEFAULT 'auto',
     confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'estimated', 'partial')) DEFAULT 'partial',
     failure_reason TEXT,
     admin_reset_reason TEXT,
     reset_at TIMESTAMPTZ,
     reset_by_user_id UUID REFERENCES users(id),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   -- §10 invariant: AT MOST ONE active (non-reset) baseline per sub-account.
   -- The partial index on subaccount_id (NOT (subaccount_id, baseline_version))
   -- enforces "exactly one active baseline" regardless of version. Admin reset
   -- is a single transaction: UPDATE prior SET status='reset' THEN INSERT new
   -- with baseline_version+1 (see captureBaselineService.adminReset).
   CREATE UNIQUE INDEX subaccount_baselines_active_uniq
     ON subaccount_baselines(subaccount_id)
     WHERE status <> 'reset';

   CREATE INDEX subaccount_baselines_status_idx
     ON subaccount_baselines(organisation_id, status);

   -- Retry pickup: covers cron's `WHERE status='ready' AND capture_attempt_count > 0`.
   -- 'failed' is terminal (recovery via manual entry only) and excluded.
   CREATE INDEX subaccount_baselines_pending_retry_idx
     ON subaccount_baselines(last_attempt_at)
     WHERE status = 'ready' AND capture_attempt_count > 0;

   -- F3 §4 — readiness condition support: counter + earliest qualifying poll.
   -- Polling service maintains both via UPDATE on every successful sync. See
   -- baselineReadinessService.evaluate().
   ALTER TABLE connector_configs
     ADD COLUMN IF NOT EXISTS successful_poll_count_total INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS first_qualifying_poll_at TIMESTAMPTZ;
   ```

3. Author `migrations/0278_subaccount_baselines.down.sql`:

   ```sql
   ALTER TABLE connector_configs
     DROP COLUMN IF EXISTS first_qualifying_poll_at,
     DROP COLUMN IF EXISTS successful_poll_count_total;
   DROP INDEX IF EXISTS subaccount_baselines_pending_retry_idx;
   DROP INDEX IF EXISTS subaccount_baselines_status_idx;
   DROP INDEX IF EXISTS subaccount_baselines_active_uniq;
   DROP TABLE IF EXISTS subaccount_baselines;
   ```

4. Author `migrations/0279_subaccount_baseline_metrics.sql`:

   ```sql
   -- F3 §3 — per-metric rows, one row per (baseline, metric_slug). PK enforces
   -- idempotent re-capture via ON CONFLICT (baseline_id, metric_slug) DO UPDATE.
   CREATE TABLE subaccount_baseline_metrics (
     baseline_id UUID NOT NULL REFERENCES subaccount_baselines(id) ON DELETE CASCADE,
     metric_slug TEXT NOT NULL,
     value JSONB NOT NULL,
     source TEXT NOT NULL CHECK (source IN ('canonical_metric', 'manual', 'unavailable')),
     unavailable_reason TEXT,
     captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (baseline_id, metric_slug)
   );

   CREATE INDEX subaccount_baseline_metrics_slug_idx
     ON subaccount_baseline_metrics(metric_slug);
   ```

5. Author `migrations/0279_subaccount_baseline_metrics.down.sql`:

   ```sql
   DROP INDEX IF EXISTS subaccount_baseline_metrics_slug_idx;
   DROP TABLE IF EXISTS subaccount_baseline_metrics;
   ```

6. Author `server/db/schema/subaccountBaselines.ts`:

   ```ts
   import { pgTable, uuid, text, integer, smallint, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
   import { sql } from 'drizzle-orm';
   import { organisations } from './organisations.js';
   import { subaccounts } from './subaccounts.js';
   import { users } from './users.js';

   export type BaselineStatus = 'pending' | 'ready' | 'capturing' | 'captured' | 'failed' | 'manual' | 'reset';
   export type BaselineSource = 'auto' | 'manual' | 'mixed';
   export type BaselineConfidence = 'confirmed' | 'estimated' | 'partial';

   export const subaccountBaselines = pgTable(
     'subaccount_baselines',
     {
       id: uuid('id').defaultRandom().primaryKey(),
       organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
       subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),
       baselineVersion: integer('baseline_version').notNull().default(1),
       status: text('status').notNull().$type<BaselineStatus>(),
       captureAttemptCount: smallint('capture_attempt_count').notNull().default(0),
       lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
       nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
       readyAt: timestamp('ready_at', { withTimezone: true }),
       capturedAt: timestamp('captured_at', { withTimezone: true }),
       source: text('source').notNull().default('auto').$type<BaselineSource>(),
       confidence: text('confidence').notNull().default('partial').$type<BaselineConfidence>(),
       failureReason: text('failure_reason'),
       adminResetReason: text('admin_reset_reason'),
       resetAt: timestamp('reset_at', { withTimezone: true }),
       resetByUserId: uuid('reset_by_user_id').references(() => users.id),
       createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
     },
     (table) => ({
       activeUniq: uniqueIndex('subaccount_baselines_active_uniq')
         .on(table.subaccountId)
         .where(sql`${table.status} <> 'reset'`),
       statusIdx: index('subaccount_baselines_status_idx').on(table.organisationId, table.status),
       pendingRetryIdx: index('subaccount_baselines_pending_retry_idx')
         .on(table.lastAttemptAt)
         .where(sql`${table.status} = 'ready' AND ${table.captureAttemptCount} > 0`),
     }),
   );

   export type SubaccountBaseline = typeof subaccountBaselines.$inferSelect;
   export type NewSubaccountBaseline = typeof subaccountBaselines.$inferInsert;
   ```

7. Author `server/db/schema/subaccountBaselineMetrics.ts`:

   ```ts
   import { pgTable, uuid, text, jsonb, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
   import { subaccountBaselines } from './subaccountBaselines.js';

   export type MetricSource = 'canonical_metric' | 'manual' | 'unavailable';

   /** JSONB shape stored in subaccount_baseline_metrics.value. */
   export interface MetricValue {
     numeric: number;
     currency?: string;  // e.g. 'USD', set when unit is a currency
     unit: string;       // 'cents', 'count', 'percent'
   }

   export const subaccountBaselineMetrics = pgTable(
     'subaccount_baseline_metrics',
     {
       baselineId: uuid('baseline_id').notNull().references(() => subaccountBaselines.id, { onDelete: 'cascade' }),
       metricSlug: text('metric_slug').notNull(),
       value: jsonb('value').notNull().$type<MetricValue>(),
       source: text('source').notNull().$type<MetricSource>(),
       unavailableReason: text('unavailable_reason'),
       capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
     },
     (table) => ({
       pk: primaryKey({ columns: [table.baselineId, table.metricSlug] }),
       slugIdx: index('subaccount_baseline_metrics_slug_idx').on(table.metricSlug),
     }),
   );

   export type SubaccountBaselineMetric = typeof subaccountBaselineMetrics.$inferSelect;
   export type NewSubaccountBaselineMetric = typeof subaccountBaselineMetrics.$inferInsert;
   ```

8. Modify `server/db/schema/connectorConfigs.ts` — after existing `expiresAt` / `scope` columns, add:

   ```ts
   // F3 §4 — readiness condition support (migration 0278).
   // Both columns updated by connectorPollingService on every successful sync.
   successfulPollCountTotal: integer('successful_poll_count_total').notNull().default(0),
   firstQualifyingPollAt: timestamp('first_qualifying_poll_at', { withTimezone: true }),
   ```

9. Modify `server/db/schema/index.ts` to export the two new tables alongside existing exports.

10. Run `npm run db:generate` and confirm no spurious diff. Hand-authored migrations are canonical; delete any generated artefact.

**Contracts pinned by this chunk:**
- `subaccount_baselines.status` is a TEXT CHECK enum with seven values; the `BaselineStatus` Drizzle type is the application-layer mirror.
- The partial UNIQUE index `subaccount_baselines_active_uniq` is on `(subaccount_id) WHERE status <> 'reset'`, NOT on `(subaccount_id, baseline_version)`. This is the §10 single-active-baseline invariant. Enforced by the index, asserted by `baselineInvariants.test.ts` (Chunk 3C).
- `subaccount_baseline_metrics` PK is `(baseline_id, metric_slug)` — supports idempotent ON CONFLICT writes.
- `connector_configs.successful_poll_count_total` is monotonically non-decreasing per row; the polling service is the only writer.

**Tests:** None in this chunk (Drizzle compile verifies type wiring; migration shape and invariants are exercised in Chunks 1C and 3C).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify no spurious diff)

**Commit:** `feat(baseline): migrations 0278/0279 — subaccount_baselines + metrics + connector poll counters`

---

## Chunk 1B — Migration 0280 (RLS) + canonical dictionary + settings schema

**Goal:** Apply the canonical RLS template to both new tables in migration 0280. Register them in `rlsProtectedTables.ts`. Add canonical-dictionary entries. Extend `shared/schemas/subaccount.ts` with `subaccountSettingsSchema` carrying the `baseline_metrics_opt_in` field.

**Phase:** 1

**Files:**
- create: `migrations/0280_baseline_rls_and_dictionary.sql`
- create: `migrations/0280_baseline_rls_and_dictionary.down.sql`
- modify: `server/config/rlsProtectedTables.ts`
- modify: `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`
- modify: `shared/schemas/subaccount.ts` (extend with `subaccountSettingsSchema`, do NOT modify existing `baselineArtefactsStatusSchema` from F1)
- create: `shared/constants/baselineMetrics.ts`

**Steps:**

1. Pre-flight migration check (same as Chunk 1A step 1).

2. Author `migrations/0280_baseline_rls_and_dictionary.sql` — apply the canonical RLS policy template (per `migrations/0245_all_tenant_tables_rls.sql`, mirrored from `architecture.md` § Row-Level Security):

   ```sql
   -- F3 §3 — RLS for both new tables.
   ALTER TABLE subaccount_baselines ENABLE ROW LEVEL SECURITY;
   ALTER TABLE subaccount_baselines FORCE ROW LEVEL SECURITY;

   CREATE POLICY subaccount_baselines_tenant_isolation ON subaccount_baselines
     USING (organisation_id::text = current_setting('app.organisation_id', true))
     WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));

   -- subaccount_baseline_metrics is keyed off baseline_id (no organisation_id column).
   -- Policy walks the FK to subaccount_baselines.
   ALTER TABLE subaccount_baseline_metrics ENABLE ROW LEVEL SECURITY;
   ALTER TABLE subaccount_baseline_metrics FORCE ROW LEVEL SECURITY;

   CREATE POLICY subaccount_baseline_metrics_tenant_isolation ON subaccount_baseline_metrics
     USING (
       EXISTS (
         SELECT 1 FROM subaccount_baselines sb
         WHERE sb.id = subaccount_baseline_metrics.baseline_id
           AND sb.organisation_id::text = current_setting('app.organisation_id', true)
       )
     )
     WITH CHECK (
       EXISTS (
         SELECT 1 FROM subaccount_baselines sb
         WHERE sb.id = subaccount_baseline_metrics.baseline_id
           AND sb.organisation_id::text = current_setting('app.organisation_id', true)
       )
     );
   ```

3. Author `migrations/0280_baseline_rls_and_dictionary.down.sql`:

   ```sql
   DROP POLICY IF EXISTS subaccount_baseline_metrics_tenant_isolation ON subaccount_baseline_metrics;
   ALTER TABLE subaccount_baseline_metrics NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE subaccount_baseline_metrics DISABLE ROW LEVEL SECURITY;

   DROP POLICY IF EXISTS subaccount_baselines_tenant_isolation ON subaccount_baselines;
   ALTER TABLE subaccount_baselines NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE subaccount_baselines DISABLE ROW LEVEL SECURITY;
   ```

4. In `server/config/rlsProtectedTables.ts`, append two entries to `RLS_PROTECTED_TABLES`:

   ```ts
   {
     tableName: 'subaccount_baselines',
     schemaFile: 'subaccountBaselines.ts',
     policyMigration: '0280_baseline_rls_and_dictionary.sql',
     rationale: 'Per-subaccount baseline snapshot — captures opening-state metrics. Cross-tenant leak would expose competitive financial data.',
   },
   {
     tableName: 'subaccount_baseline_metrics',
     schemaFile: 'subaccountBaselineMetrics.ts',
     policyMigration: '0280_baseline_rls_and_dictionary.sql',
     rationale: 'Per-baseline metric values — pipeline value, lead count, revenue. Cross-tenant leak would expose customer-specific revenue figures.',
   },
   ```

5. In `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`, append two `CanonicalTableEntry` objects:

   ```ts
   {
     tableName: 'subaccount_baselines',
     humanName: 'Subaccount Baselines',
     purpose: 'Immutable opening-state snapshot for each sub-account, captured at onboarding readiness. Reporting Agent reads it to narrate month-over-month delta.',
     principalSemantics: 'Org-scoped, subaccount-scoped. One active (non-reset) row per subaccount.',
     visibilityFields: { ownerUserId: false, visibilityScope: false, sharedTeamIds: false },
     columns: [
       { name: 'id', type: 'uuid', purpose: 'Primary key' },
       { name: 'organisation_id', type: 'uuid', purpose: 'Owning organisation' },
       { name: 'subaccount_id', type: 'uuid', purpose: 'Owning sub-account' },
       { name: 'baseline_version', type: 'integer', purpose: 'Bumps on admin reset; preserves history' },
       { name: 'status', type: 'text', purpose: 'pending | ready | capturing | captured | failed | manual | reset' },
       { name: 'capture_attempt_count', type: 'smallint', purpose: 'Retry budget (max 3 retryable failures)' },
       { name: 'last_attempt_at', type: 'timestamptz', purpose: 'Backoff anchor for cron retry pickup' },
       { name: 'next_attempt_at', type: 'timestamptz', purpose: 'Stamped at retry transition: last_attempt_at + backoff window. NULL when not in retry-pending state.' },
       { name: 'ready_at', type: 'timestamptz', purpose: 'When readiness condition was first met' },
       { name: 'captured_at', type: 'timestamptz', purpose: 'Set on transition to captured; immutable thereafter' },
       { name: 'source', type: 'text', purpose: 'auto | manual | mixed' },
       { name: 'confidence', type: 'text', purpose: 'confirmed | estimated | partial' },
       { name: 'failure_reason', type: 'text', purpose: 'Terminal-failure category' },
     ],
     foreignKeys: [
       { column: 'organisation_id', referencesTable: 'organisations', referencesColumn: 'id' },
       { column: 'subaccount_id', referencesTable: 'subaccounts', referencesColumn: 'id' },
       { column: 'reset_by_user_id', referencesTable: 'users', referencesColumn: 'id' },
     ],
     freshnessPeriod: 'Immutable once captured; admin reset creates a new version row',
     cardinality: '1:1',
     skillReferences: ['generate_portfolio_report'],
     exampleQueries: [
       'SELECT * FROM subaccount_baselines WHERE subaccount_id = $1 AND status <> \'reset\' ORDER BY baseline_version DESC LIMIT 1',
     ],
     commonJoins: [
       'subaccount_baseline_metrics via subaccount_baseline_metrics.baseline_id',
     ],
     antiPatterns: [
       'Do not write directly — only captureBaselineService.run / runManual / adminReset are valid writers (single-writer rule).',
       'Do not bypass the \'reset\' status to delete history. Admin reset preserves prior rows by design.',
     ],
   },
   {
     tableName: 'subaccount_baseline_metrics',
     humanName: 'Subaccount Baseline Metrics',
     purpose: 'Per-metric value rows for each baseline. PK on (baseline_id, metric_slug) supports idempotent ON CONFLICT writes.',
     principalSemantics: 'Org-scoped via baseline FK. RLS walks the FK to enforce tenant isolation.',
     visibilityFields: { ownerUserId: false, visibilityScope: false, sharedTeamIds: false },
     columns: [
       { name: 'baseline_id', type: 'uuid', purpose: 'Owning baseline (FK)' },
       { name: 'metric_slug', type: 'text', purpose: 'pipeline_value | lead_count | conversation_engagement | revenue | open_opportunity_count | …' },
       { name: 'value', type: 'jsonb', purpose: '{ numeric, currency?, unit }' },
       { name: 'source', type: 'text', purpose: 'canonical_metric | manual | unavailable' },
       { name: 'unavailable_reason', type: 'text', purpose: 'integration_not_connected | api_failure | no_data_yet' },
       { name: 'captured_at', type: 'timestamptz', purpose: 'Set by Postgres now() on insert; updated on ON CONFLICT' },
     ],
     foreignKeys: [
       { column: 'baseline_id', referencesTable: 'subaccount_baselines', referencesColumn: 'id' },
     ],
     freshnessPeriod: 'Immutable on captured baseline; manual edit may overwrite via runManual',
     cardinality: '1:N',
     skillReferences: ['generate_portfolio_report'],
     exampleQueries: [
       'SELECT metric_slug, value, source FROM subaccount_baseline_metrics WHERE baseline_id = $1',
     ],
     commonJoins: ['subaccount_baselines via subaccount_baseline_metrics.baseline_id'],
     antiPatterns: [
       'Do not insert without ON CONFLICT (baseline_id, metric_slug) DO UPDATE — the PK enforces uniqueness; raw INSERT will throw on retry.',
     ],
   },
   ```

6. Author `shared/constants/baselineMetrics.ts` — single source of truth for v1 metric slugs and units. Used by capture service, per-metric readers, manual form, Reporting Agent helper.

   ```ts
   /**
    * F3 §2 — v1 metric registry. Each entry pins:
    *   - slug: stable identifier (matches subaccount_baseline_metrics.metric_slug)
    *   - unit: 'cents' | 'count' | 'percent'
    *   - currencyHint: present when unit='cents'
    *   - readerStatus: 'available' (has reader) | 'unavailable_default' (no
    *     adapter; written as source='unavailable' with non_retryable class)
    *   - source: provider name for narration ('GHL', 'Stripe', etc.)
    */
   export const V1_BASELINE_METRICS = [
     { slug: 'pipeline_value',           unit: 'cents',   currencyHint: 'USD', readerStatus: 'available',           source: 'GHL' },
     { slug: 'open_opportunity_count',   unit: 'count',                          readerStatus: 'available',           source: 'GHL' },
     { slug: 'lead_count',               unit: 'count',                          readerStatus: 'available',           source: 'GHL' },
     { slug: 'conversation_engagement',  unit: 'count',                          readerStatus: 'available',           source: 'GHL' },
     { slug: 'revenue_last_30d',         unit: 'cents',   currencyHint: 'USD', readerStatus: 'available',           source: 'Stripe' },
     // Out-of-scope — no adapter; recorded as unavailable / non_retryable.
     { slug: 'gmb_rank',                 unit: 'count',                          readerStatus: 'unavailable_default', source: 'Google Business Profile' },
     { slug: 'review_count',             unit: 'count',                          readerStatus: 'unavailable_default', source: 'Google Business Profile' },
     { slug: 'review_avg_rating',        unit: 'count',                          readerStatus: 'unavailable_default', source: 'Google Business Profile' },
     { slug: 'mrr',                      unit: 'cents',   currencyHint: 'USD', readerStatus: 'unavailable_default', source: 'Stripe' },
     { slug: 'customer_count',           unit: 'count',                          readerStatus: 'unavailable_default', source: 'Stripe' },
     { slug: 'churn_rate',               unit: 'percent',                        readerStatus: 'unavailable_default', source: 'Stripe' },
   ] as const;

   export type BaselineMetricSlug = typeof V1_BASELINE_METRICS[number]['slug'];

   export const ALL_METRIC_SLUGS: readonly BaselineMetricSlug[] =
     V1_BASELINE_METRICS.map((m) => m.slug);

   export const AVAILABLE_METRIC_SLUGS: readonly BaselineMetricSlug[] =
     V1_BASELINE_METRICS.filter((m) => m.readerStatus === 'available').map((m) => m.slug);

   export function isBaselineMetricSlug(s: string): s is BaselineMetricSlug {
     return ALL_METRIC_SLUGS.includes(s as BaselineMetricSlug);
   }

   export function metricMeta(slug: BaselineMetricSlug) {
     return V1_BASELINE_METRICS.find((m) => m.slug === slug)!;
   }
   ```

7. In `shared/schemas/subaccount.ts`, **EXTEND** the existing file (do NOT overwrite the F1 `baselineArtefactsStatusSchema`). Append:

   ```ts
   import { ALL_METRIC_SLUGS, type BaselineMetricSlug } from '../constants/baselineMetrics.js';

   /**
    * F3 §2 — opt-in subset of baseline metrics for this subaccount. Stored in
    * subaccounts.settings JSONB under the key `baseline_metrics_opt_in`. When
    * absent, default = full v1 set (all slugs from ALL_METRIC_SLUGS).
    */
   export const subaccountSettingsSchema = z.object({
     baseline_metrics_opt_in: z.array(z.enum(ALL_METRIC_SLUGS as [BaselineMetricSlug, ...BaselineMetricSlug[]])).optional(),
   }).passthrough();  // allow other settings keys (existing JSONB shape is open)

   export type SubaccountSettings = z.infer<typeof subaccountSettingsSchema>;

   /**
    * F3 — resolve the effective opt-in metric set for a subaccount, defaulting
    * to ALL_METRIC_SLUGS when the field is absent or settings is null.
    */
   export function resolveBaselineOptIn(rawSettings: unknown): readonly BaselineMetricSlug[] {
     if (!rawSettings || typeof rawSettings !== 'object') return ALL_METRIC_SLUGS;
     const parsed = subaccountSettingsSchema.safeParse(rawSettings);
     if (!parsed.success) return ALL_METRIC_SLUGS;
     return parsed.data.baseline_metrics_opt_in ?? ALL_METRIC_SLUGS;
   }
   ```

   Confirm `z` import is already present at top of file (it is — line 1).

**Contracts pinned by this chunk:**
- Both new tables have RLS enabled + forced + canonical policy + manifest entry. The CI gate `verify-rls-coverage.sh` will pass once 0280 lands.
- `resolveBaselineOptIn(rawSettings)` is the only public function service code calls to determine which metrics to capture. It returns `ALL_METRIC_SLUGS` on any failure mode (null, malformed, missing key) — failure-safe default.
- `V1_BASELINE_METRICS` is the canonical metric registry. Adding a new metric requires editing this file PLUS authoring a new `getXxx.ts` reader (Chunk 3B) PLUS updating the manual form schema.

**Tests:** None in this chunk (RLS coverage verified by CI gate; opt-in resolver is exercised in Chunk 1C).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Commit:** `feat(baseline): migration 0280 RLS + canonical dictionary + opt-in settings schema`

---

## Chunk 1C — Pure validator + retry classifier tests

**Goal:** Author pure-function modules and unit tests for the deterministic core of the capture flow: status state machine, source enum guard, confidence enum guard, retry classifier, idempotency-key shape, opt-in resolver. All tests run via `npx tsx` without DB.

**Phase:** 1

**Files:**
- create: `server/services/baselineStateMachinePure.ts`
- create: `server/services/baselineRetryClassifierPure.ts`
- create: `server/services/__tests__/baselineStateMachinePure.test.ts`
- create: `server/services/__tests__/baselineRetryClassifierPure.test.ts`
- create: `shared/constants/__tests__/baselineMetrics.test.ts` (slug registry sanity)
- create: `shared/schemas/__tests__/subaccountSettings.test.ts` (opt-in resolver edge cases)

**Steps:**

1. Author `server/services/baselineStateMachinePure.ts`:

   ```ts
   import type { BaselineStatus } from '../db/schema/subaccountBaselines.js';

   export const TERMINAL_STATUSES: ReadonlySet<BaselineStatus> = new Set(['captured', 'failed', 'reset']);
   export const RUNNABLE_STATUSES: ReadonlySet<BaselineStatus> = new Set(['pending', 'ready']);

   /** Allowed status transitions per spec §5.1. */
   const ALLOWED_TRANSITIONS: Record<BaselineStatus, ReadonlySet<BaselineStatus>> = {
     pending:   new Set(['capturing', 'reset']),  // capturing via lock acquire; reset via admin
     ready:     new Set(['capturing', 'reset']),
     capturing: new Set(['captured', 'ready', 'failed', 'manual']),  // ready = retry; manual = manual override during in-flight
     captured:  new Set(['reset', 'manual']),     // manual = post-capture manual edit converting source
     failed:    new Set(['manual', 'reset']),     // recovery via manual entry; reset via admin
     manual:    new Set(['reset']),                // terminal except for admin reset
     reset:     new Set(),                          // truly terminal — never transitions out
   };

   export function canTransition(from: BaselineStatus, to: BaselineStatus): boolean {
     return ALLOWED_TRANSITIONS[from].has(to);
   }

   /**
    * Spec §5.4 — terminal classification.
    * 'failed' rows are not re-enqueued by the cron; recovery via manual entry only.
    */
   export function isTerminal(status: BaselineStatus): boolean {
     return TERMINAL_STATUSES.has(status);
   }

   export function isRunnable(status: BaselineStatus): boolean {
     return RUNNABLE_STATUSES.has(status);
   }
   ```

2. Author `server/services/baselineRetryClassifierPure.ts`:

   ```ts
   export type ErrorClass = 'retryable' | 'non_retryable';

   export type FailureReason =
     | 'integration_not_connected'
     | 'api_failure'
     | 'no_data_yet'
     | 'schema_mismatch'
     | 'reader_not_implemented'
     | 'http_4xx'
     | 'http_5xx'
     | 'http_429'
     | 'network_timeout'
     | 'db_serialisation_conflict'
     | 'retry_budget_exhausted';

   const RETRYABLE_REASONS: ReadonlySet<FailureReason> = new Set([
     'http_5xx', 'http_429', 'network_timeout', 'no_data_yet',
     'db_serialisation_conflict', 'api_failure',
   ]);

   const NON_RETRYABLE_REASONS: ReadonlySet<FailureReason> = new Set([
     'http_4xx', 'schema_mismatch', 'integration_not_connected', 'reader_not_implemented',
   ]);

   export function classifyFailure(reason: FailureReason): ErrorClass {
     if (RETRYABLE_REASONS.has(reason)) return 'retryable';
     if (NON_RETRYABLE_REASONS.has(reason)) return 'non_retryable';
     // 'retry_budget_exhausted' is the synthetic terminal marker; treat as non-retryable.
     return 'non_retryable';
   }

   /** Spec §5.4 — backoff schedule. Returns minutes since last_attempt_at when the row becomes eligible for retry. */
   const BACKOFF_MINUTES: readonly number[] = [60, 240, 1440];  // 1h, 4h, 24h

   export function nextBackoffMinutes(attemptCount: number): number | null {
     if (attemptCount < 1 || attemptCount > BACKOFF_MINUTES.length) return null;
     return BACKOFF_MINUTES[attemptCount - 1];
   }

   /** Spec §5.4 — 3-attempt budget. Returns true when we've burned all 3 retryable attempts. */
   export function isRetryBudgetExhausted(attemptCount: number): boolean {
     return attemptCount >= 3;
   }

   /**
    * Aggregate per-metric classifications into a baseline-level outcome.
    * Spec §5.3 step 5 + §5.4.
    */
   export interface MetricOutcome { source: 'canonical_metric' | 'unavailable'; errorClass?: ErrorClass; }

   export type BaselineOutcome =
     | { kind: 'success'; confidence: 'confirmed' | 'partial' }
     | { kind: 'retryable_failure' }
     | { kind: 'non_retryable_failure'; reason: FailureReason };

   export function aggregateOutcome(
     perMetric: readonly MetricOutcome[],
     optedInCount: number,
   ): BaselineOutcome {
     const captured = perMetric.filter((m) => m.source === 'canonical_metric').length;
     if (captured >= 2) {
       // Edge: if optedInCount is 0 (degenerate settings — empty opt-in
       // array explicitly set), 'confirmed' would be vacuously true. Force
       // 'partial' so confidence is never claimed without underlying metrics.
       const confidence: 'confirmed' | 'partial' =
         optedInCount > 0 && captured >= optedInCount ? 'confirmed' : 'partial';
       return { kind: 'success', confidence };
     }
     // < 2 canonical metrics — failure path. Determine whether any failure was non-retryable.
     const hasNonRetryable = perMetric.some((m) => m.source === 'unavailable' && m.errorClass === 'non_retryable');
     if (hasNonRetryable) return { kind: 'non_retryable_failure', reason: 'integration_not_connected' };
     return { kind: 'retryable_failure' };
   }
   ```

3. Author `server/services/__tests__/baselineStateMachinePure.test.ts` — assertions:
   - `canTransition('pending', 'capturing')` true.
   - `canTransition('captured', 'pending')` false.
   - `canTransition('reset', 'pending')` false (reset is truly terminal — new pending row is a different ID).
   - `canTransition('failed', 'manual')` true (manual recovery).
   - `canTransition('capturing', 'ready')` true (retryable failure).
   - `canTransition('capturing', 'failed')` true (3rd retryable failure or non-retryable).
   - `isTerminal('captured')` true; `isTerminal('manual')` false (manual can still be reset).
   - `isRunnable('pending')` true; `isRunnable('ready')` true; `isRunnable('capturing')` false.

4. Author `server/services/__tests__/baselineRetryClassifierPure.test.ts`:
   - `classifyFailure('http_5xx')` = `'retryable'`.
   - `classifyFailure('http_4xx')` = `'non_retryable'`.
   - `classifyFailure('http_429')` = `'retryable'` (rate-limited, retry with backoff).
   - `classifyFailure('integration_not_connected')` = `'non_retryable'`.
   - `classifyFailure('reader_not_implemented')` = `'non_retryable'`.
   - `nextBackoffMinutes(1)` = `60`; `nextBackoffMinutes(2)` = `240`; `nextBackoffMinutes(3)` = `1440`; `nextBackoffMinutes(4)` = `null`.
   - `isRetryBudgetExhausted(2)` = false; `isRetryBudgetExhausted(3)` = true.
   - `aggregateOutcome([{source:'canonical_metric'},{source:'canonical_metric'}], 2)` = `{kind:'success', confidence:'confirmed'}`.
   - `aggregateOutcome([{source:'canonical_metric'},{source:'canonical_metric'},{source:'unavailable',errorClass:'retryable'}], 3)` = `{kind:'success', confidence:'partial'}`.
   - `aggregateOutcome([{source:'unavailable',errorClass:'retryable'}], 5)` = `{kind:'retryable_failure'}`.
   - `aggregateOutcome([{source:'unavailable',errorClass:'non_retryable'}], 5)` = `{kind:'non_retryable_failure', reason:'integration_not_connected'}`.
   - **Edge — optedInCount=0:** `aggregateOutcome([{source:'canonical_metric'},{source:'canonical_metric'}], 0)` = `{kind:'success', confidence:'partial'}`. Confidence is forced to 'partial' even when `captured >= optedInCount` is vacuously true, so no row is marked 'confirmed' on degenerate empty-opt-in settings.

5. Author `shared/constants/__tests__/baselineMetrics.test.ts`:
   - `ALL_METRIC_SLUGS.length` matches `V1_BASELINE_METRICS.length`.
   - Every entry's slug is unique (no duplicates).
   - `isBaselineMetricSlug('pipeline_value')` true; `isBaselineMetricSlug('made_up')` false.
   - `AVAILABLE_METRIC_SLUGS` contains exactly the 5 v1 spec §2 supported rows: `pipeline_value`, `open_opportunity_count`, `lead_count`, `conversation_engagement`, `revenue_last_30d`.
   - Every `unavailable_default` entry's metric appears in `ALL_METRIC_SLUGS` but NOT in `AVAILABLE_METRIC_SLUGS`.
   - Every `currencyHint` is set if and only if `unit==='cents'`.

6. Author `shared/schemas/__tests__/subaccountSettings.test.ts`:
   - `resolveBaselineOptIn(null)` = `ALL_METRIC_SLUGS`.
   - `resolveBaselineOptIn({})` = `ALL_METRIC_SLUGS` (no key set).
   - `resolveBaselineOptIn({ baseline_metrics_opt_in: ['pipeline_value', 'lead_count'] })` returns `['pipeline_value', 'lead_count']`.
   - `resolveBaselineOptIn({ baseline_metrics_opt_in: ['made_up_slug'] })` = `ALL_METRIC_SLUGS` (zod rejects, falls back to default).
   - `resolveBaselineOptIn({ otherKey: 'value', baseline_metrics_opt_in: ['lead_count'] })` returns `['lead_count']` (passthrough preserves other keys; opt-in still parses).

**Tests:** as listed in steps 3-6.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/baselineStateMachinePure.test.ts`
- `npx tsx server/services/__tests__/baselineRetryClassifierPure.test.ts`
- `npx tsx shared/constants/__tests__/baselineMetrics.test.ts`
- `npx tsx shared/schemas/__tests__/subaccountSettings.test.ts`

**Commit:** `feat(baseline): pure state machine + retry classifier + slug registry tests`

---

## Chunk 2A — `baselineReadinessService` + onboarding pending-row insert

**Goal:** Author `baselineReadinessService.evaluate(subaccountId)` as a pure read over the four §4 conditions. Add `markBaselinePending(...)` to `subaccountOnboardingService` (a sibling of F1's existing methods — additive only). Wire the pending-row INSERT into the existing `autoStartOwedOnboardingWorkflows` hook in `server/routes/subaccounts.ts:121-150`.

**Phase:** 2

**Files:**
- create: `server/services/baselineReadinessService.ts`
- modify: `server/services/subaccountOnboardingService.ts` (ADD `markBaselinePending` method — do NOT modify F1's `markArtefactCaptured`/`markArtefactSkipped`/`markArtefactEdited`/`recordArtefactStarted`)
- modify: `server/routes/subaccounts.ts` (add the pending-row INSERT alongside the existing `autoStartOwedOnboardingWorkflows` call — do NOT replace the existing hook)
- create: `server/services/__tests__/baselineReadinessService.test.ts`

**Steps:**

1. Author `server/services/baselineReadinessService.ts`:

   ```ts
   import { and, eq, isNotNull, sql } from 'drizzle-orm';
   import { db } from '../db/index.js';
   import { connectorConfigs } from '../db/schema/connectorConfigs.js';
   import { canonicalMetrics } from '../db/schema/canonicalMetrics.js';
   import { canonicalAccounts } from '../db/schema/canonicalAccounts.js';

   export interface ReadinessResult {
     ready: boolean;
     missing: string[];
     reason?: string;
     qualifying_poll_count: number;
     earliest_qualifying_poll_at: Date | null;
   }

   const CORE_METRIC_SLUGS = ['pipeline_value', 'lead_count', 'conversation_engagement', 'revenue_last_30d'] as const;

   /**
    * F3 §4 — pure read over four conditions:
    *   (1) ≥1 active connector for the subaccount
    *   (2) ≥2 successful polls (via connector_configs.successful_poll_count_total)
    *   (3) Settle window: now() - first_qualifying_poll_at >= 1h
    *   (4) ≥2 of 4 core metrics non-null in canonical_metrics
    *
    * Idempotent. Never mutates state.
    */
   export const baselineReadinessService = {
     async evaluate(subaccountId: string, organisationId: string): Promise<ReadinessResult> {
       const missing: string[] = [];

       // (1) + (2) + (3) — single query against connector_configs (one row per active connector).
       // Settle-window check is evaluated inside Postgres via `now() - first_qualifying_poll_at >= interval '1 hour'`
       // (§6 DB-time invariant). We compute three columns server-side: pollCount,
       // firstAt (for telemetry exposure), and settleOk (the boolean we actually
       // condition on). No Date.now() in this service — eliminates clock drift
       // across application servers and keeps comparison authority in the DB.
       const connectors = await db
         .select({
           pollCount: connectorConfigs.successfulPollCountTotal,
           firstAt: connectorConfigs.firstQualifyingPollAt,
           settleOk: sql<boolean>`(${connectorConfigs.firstQualifyingPollAt} IS NOT NULL AND now() - ${connectorConfigs.firstQualifyingPollAt} >= interval '1 hour')`,
         })
         .from(connectorConfigs)
         .where(
           and(
             eq(connectorConfigs.organisationId, organisationId),
             eq(connectorConfigs.subaccountId, subaccountId),
             eq(connectorConfigs.status, 'active'),
           ),
         );

       const activeConnectorCount = connectors.length;
       if (activeConnectorCount === 0) missing.push('active_connector');

       const totalPolls = connectors.reduce((sum, c) => sum + (c.pollCount ?? 0), 0);
       if (totalPolls < 2) missing.push('successful_polls_min_2');

       // earliest timestamp is reported back for observability/telemetry only —
       // never used as a comparison anchor in JS time. The settle decision is
       // already made by Postgres (settleOk above).
       const earliest = connectors
         .map((c) => c.firstAt)
         .filter((d): d is Date => d != null)
         .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

       const settleOk = connectors.some((c) => c.settleOk === true);
       if (!settleOk) missing.push('settle_window_1h');

       // (4) — count of non-null currentValue in canonical_metrics for the four core slugs.
       const metricCounts = await db
         .select({ slug: canonicalMetrics.metricSlug })
         .from(canonicalMetrics)
         .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetrics.accountId))
         .where(
           and(
             eq(canonicalAccounts.organisationId, organisationId),
             eq(canonicalAccounts.subaccountId, subaccountId),
             isNotNull(canonicalMetrics.currentValue),
             sql`${canonicalMetrics.metricSlug} = ANY(ARRAY[${sql.join(CORE_METRIC_SLUGS.map((s) => sql`${s}`), sql`, `)}]::text[])`,
           ),
         );

       const distinctSlugsWithValue = new Set(metricCounts.map((r) => r.slug)).size;
       if (distinctSlugsWithValue < 2) missing.push('canonical_metrics_min_2');

       return {
         ready: missing.length === 0,
         missing,
         reason: missing.length === 0 ? undefined : `missing: ${missing.join(', ')}`,
         qualifying_poll_count: totalPolls,
         earliest_qualifying_poll_at: earliest,
       };
     },
   };
   ```

2. In `server/services/subaccountOnboardingService.ts`, **APPEND** a new method (do NOT modify F1's existing methods). Add the import for `subaccountBaselines`:

   ```ts
   // (Already imported in F1 commit; if not present, add to the existing import block:)
   import { subaccountBaselines } from '../db/schema/subaccountBaselines.js';

   // … inside the SubaccountOnboardingService class …

   /**
    * F3 §4 — insert the initial `pending` baseline row at sub-account creation.
    * Idempotent: the partial UNIQUE index on (subaccount_id) WHERE status <> 'reset'
    * prevents a duplicate row even if the onboarding hook fires twice.
    *
    * Single-writer rule (§5.2): this is the ONLY surface that writes the
    * initial `pending` row. After this insert, captureBaselineService is the
    * only writer.
    */
   async markBaselinePending(params: {
     organisationId: string;
     subaccountId: string;
   }): Promise<void> {
     try {
       await db.insert(subaccountBaselines).values({
         organisationId: params.organisationId,
         subaccountId: params.subaccountId,
         baselineVersion: 1,
         status: 'pending',
       });
     } catch (err) {
       // The partial UNIQUE index throws on duplicate. That is the expected
       // idempotent outcome — log and swallow.
       const msg = err instanceof Error ? err.message : String(err);
       if (msg.includes('subaccount_baselines_active_uniq')) return;
       throw err;
     }
   }
   ```

3. In `server/routes/subaccounts.ts`, locate the existing `autoStartOwedOnboardingWorkflows` block (around line 111-145). **ADD** the pending-row insert alongside the existing call (do NOT replace it). Both run after `boardService.initSubaccountBoard`. The insert is fire-and-forget (`.catch(...)` to log; never blocks subaccount creation):

   ```ts
   // F3 §4 — insert initial pending baseline row. Idempotent via the partial
   // UNIQUE index. Fire-and-forget — failure must never block subaccount
   // creation (mirrors the auto-start hook pattern).
   subaccountOnboardingService
     .markBaselinePending({ organisationId, subaccountId: sa.id })
     .catch((err) => {
       logger.warn('baseline_pending_insert_failed', {
         event: 'baseline.pending_insert.failed',
         subaccountId: sa.id,
         organisationId,
         error: err instanceof Error ? err.message : String(err),
       });
     });
   ```

   Place this immediately before or after the existing `subaccountOnboardingService.autoStartOwedOnboardingWorkflows({...}).then(...).catch(...)` block — they are independent and both fire-and-forget.

4. Author `server/services/__tests__/baselineReadinessService.test.ts` — pure-input tests. Mock the db client following the existing `*Pure.test.ts` pattern; if the project's mocking style is fragile, restrict to a stub that returns canned rows for each query and assert the function's combinatorial output. Because the settle-window comparison is now evaluated in SQL, the stub returns a `settleOk` boolean alongside `pollCount` and `firstAt` — tests assert behaviour against the boolean, not against time arithmetic in JS:
   - 0 active connectors → `{ ready:false, missing:['active_connector', 'successful_polls_min_2', 'settle_window_1h', 'canonical_metrics_min_2'] }`.
   - 1 active connector with `pollCount=1, settleOk=true` → still missing `successful_polls_min_2`.
   - 1 active connector with `pollCount=2, settleOk=false` → missing `settle_window_1h`.
   - 1 active connector with `pollCount=2, settleOk=true`, 1 metric non-null → missing `canonical_metrics_min_2`.
   - 1 active connector with `pollCount=2, settleOk=true`, 2 metrics non-null → `{ ready:true, missing:[] }`.
   - 2 active connectors with poll-counts 1 and 2 (sum=3), at least one `settleOk=true`, 4 metrics non-null → `ready:true`.
   - Settle-window boundary cases (`firstQualifyingPollAt` exactly 60 minutes ago vs 59 minutes ago) are exercised as a thin SQL-level assertion in the integration test (Chunk 3C) — the unit test trusts the boolean from the stub because the boundary semantics are owned by Postgres `interval` arithmetic.

**Tests:** as in step 4.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/baselineReadinessService.test.ts`

**Commit:** `feat(baseline): readiness service + pending row creation hook`

---

## Chunk 2B — `connector.sync.complete` event + subscriber + cron fallback

**Goal:** Emit `connector.sync.complete` from `connectorPollingService` after each successful poll (also bump `successful_poll_count_total` and stamp `first_qualifying_poll_at` on first success). Author the subscriber that calls `baselineReadinessService.evaluate` and enqueues the capture job. Author the daily fallback cron `evaluateAllPendingBaselines`. Register two telemetry events.

**Phase:** 2

**Files:**
- modify: `server/services/connectorPollingService.ts` (event emit + counter bumps after successful sync)
- modify: `server/lib/tracing.ts` (register `connector.sync.complete`, `baseline.capture.triggered` and the rest of the §6a events)
- create: `server/services/baselineSubscriberService.ts` (subscriber and capture-job enqueue helper)
- create: `server/jobs/evaluateAllPendingBaselines.ts` (pg-boss daily cron)
- modify: `server/jobs/index.ts` or wherever pg-boss schedules are registered (register the new daily job)
- create: `server/services/__tests__/baselineSubscriberPure.test.ts` (pure decision-table tests for the subscriber's enqueue predicate)

**Steps:**

1. In `server/lib/tracing.ts` `EVENT_NAMES`, append:

   ```ts
   // F3 baseline capture — event emitted by connectorPollingService on every
   // successful poll cycle. Subscriber re-evaluates readiness; cron fallback
   // covers missed signals.
   'connector.sync.complete',
   // F3 §6a — capture-flow audit events (9 names).
   'baseline.capture.triggered',
   'baseline.capture.started',
   'baseline.metric.captured',
   'baseline.metric.unavailable',
   'baseline.capture.succeeded',
   'baseline.capture.retry_scheduled',
   'baseline.capture.failed',
   'baseline.manual.applied',
   'baseline.admin_reset',
   ```

   This registers all 9 §6a events plus `connector.sync.complete`. Other chunks (3A/3B/3C/4A/4B) emit them at the appropriate transitions.

2. In `server/services/connectorPollingService.ts`, locate the existing successful-sync block (line 277-289 — the `if (errors.length === 0)` / phase-transition path). After `connectorConfigService.updateSyncStatus(...)` returns and `syncStatus === 'success'`:

   ```ts
   if (syncStatus === 'success') {
     // F3 §4 — bump counter and stamp first qualifying poll. The
     // `first_qualifying_poll_at` is set only on transition from null
     // (the first successful sync ever for this connector).
     await db.execute(sql`
       UPDATE connector_configs
       SET successful_poll_count_total = successful_poll_count_total + 1,
           first_qualifying_poll_at = COALESCE(first_qualifying_poll_at, now())
       WHERE id = ${config.id}
     `);

     // F3 §4 — emit `connector.sync.complete`. Subscriber re-evaluates
     // baseline readiness and enqueues capture job when transitioning to ready.
     createEvent('connector.sync.complete', {
       organisation_id: config.organisationId,
       subaccount_id: config.subaccountId,
       connector_config_id: config.id,
       connector_type: config.connectorType,
     });

     // Direct subscriber invocation. The subscriber is a service call (not a
     // pg-boss job) because the readiness evaluation is cheap and the enqueue
     // step is itself the boundary to async work. If it throws we log and
     // swallow — this must not fail the polling sync.
     if (config.subaccountId) {
       const { baselineSubscriberService } = await import('./baselineSubscriberService.js');
       baselineSubscriberService
         .onSyncCompleteEvaluateReadiness(config.subaccountId, config.organisationId)
         .catch((err) => {
           console.error('[BaselineSubscriber] readiness evaluation failed:', err);
         });
     }
   }
   ```

   Confirm `createEvent` is imported (existing import in `tracing.ts`); if not, add `import { createEvent } from '../lib/tracing.js'`. Confirm `sql` is imported from `drizzle-orm` (it is — used elsewhere in this file).

3. Author `server/services/baselineSubscriberService.ts`:

   ```ts
   import { and, eq } from 'drizzle-orm';
   import { db } from '../db/index.js';
   import { subaccountBaselines } from '../db/schema/subaccountBaselines.js';
   import { baselineReadinessService } from './baselineReadinessService.js';
   import { createEvent } from '../lib/tracing.js';
   import { getPgBoss } from '../lib/pgBoss.js';  // confirm path; see step 5

   export const CAPTURE_BASELINE_JOB = 'capture-baseline';

   export const baselineSubscriberService = {
     /**
      * F3 §4 — invoked by connectorPollingService after a successful sync.
      * Single-writer rule: this method ONLY enqueues; it never writes to
      * subaccount_baselines.
      */
     async onSyncCompleteEvaluateReadiness(
       subaccountId: string,
       organisationId: string,
     ): Promise<void> {
       const result = await baselineReadinessService.evaluate(subaccountId, organisationId);
       if (!result.ready) return;

       const [row] = await db
         .select({ id: subaccountBaselines.id, status: subaccountBaselines.status })
         .from(subaccountBaselines)
         .where(
           and(
             eq(subaccountBaselines.subaccountId, subaccountId),
             eq(subaccountBaselines.organisationId, organisationId),
           ),
         );
       if (!row) return;
       // Only enqueue when there's a runnable row. captured/failed/manual/reset are no-ops.
       if (row.status !== 'pending' && row.status !== 'ready') return;

       await this.enqueueCaptureBaselineJob({
         baselineId: row.id,
         subaccountId,
         organisationId,
         triggerSource: 'subscriber',
       });
     },

     /**
      * Single source of truth for enqueueing the capture job. All four trigger
      * paths (subscriber, fallback cron, manual entry, admin reset) call this
      * — which in turn emits `baseline.capture.triggered`.
      */
     async enqueueCaptureBaselineJob(params: {
       baselineId: string;
       subaccountId: string;
       organisationId: string;
       triggerSource: 'subscriber' | 'fallback' | 'manual' | 'admin_reset';
     }): Promise<void> {
       const boss = await getPgBoss();
       await boss.send(CAPTURE_BASELINE_JOB, {
         baselineId: params.baselineId,
         subaccountId: params.subaccountId,
         organisationId: params.organisationId,
       }, {
         // pg-boss singleton key — prevents duplicate enqueue if the subscriber
         // and the fallback cron both fire within the singleton window.
         singletonKey: `baseline:${params.baselineId}`,
         singletonHours: 1,
       });
       createEvent('baseline.capture.triggered', {
         subaccount_id: params.subaccountId,
         baseline_id: params.baselineId,
         source: params.triggerSource,
       });
     },
   };
   ```

   **Note on imports:** locate the actual pg-boss bootstrapper. If the repo uses a different helper (`server/lib/queue.ts`, `server/jobs/queue.ts`, etc.), substitute the correct import. Likely matches one of the patterns used in `server/jobs/connectorPollingTick.ts`.

4. Author `server/jobs/evaluateAllPendingBaselines.ts` — daily pg-boss cron:

   ```ts
   import type PgBoss from 'pg-boss';
   import { sql } from 'drizzle-orm';
   import { subaccountBaselines } from '../db/schema/subaccountBaselines.js';
   import { baselineReadinessService } from '../services/baselineReadinessService.js';
   import { baselineSubscriberService } from '../services/baselineSubscriberService.js';
   import { withAdminConnection } from '../lib/adminDbConnection.js';

   export const EVALUATE_ALL_PENDING_BASELINES_JOB = 'evaluate-all-pending-baselines';

   /**
    * F3 §4 — daily fallback. Enumerates `pending` rows + `ready` rows due for
    * retry. Invokes readiness evaluation (per-org context) and enqueues capture
    * jobs. Single-writer rule honoured: this job only ENQUEUES.
    *
    * Retry-eligibility is filtered in SQL using the §5.4 backoff schedule so
    * the candidate list IS the eligibility list — no JS-time comparison
    * (DB-time invariant §6).
    */
   export async function evaluateAllPendingBaselinesHandler(_job: PgBoss.Job<unknown>): Promise<void> {
     // Cross-org sweep — admin connection required (cf. connectorPollingTick.ts).
     // SQL eligibility filter:
     //   - status='pending'                                                 → always eligible (no prior attempt)
     //   - status='ready' AND attempt=1 AND last_attempt_at <= now() - 1h
     //   - status='ready' AND attempt=2 AND last_attempt_at <= now() - 4h
     //   - status='ready' AND attempt=3 AND last_attempt_at <= now() - 24h
     // Attempt>=4 is the 'retry budget exhausted' state — those rows should
     // already be 'failed', but the filter excludes them defensively.
     const candidates = await withAdminConnection(
       { source: 'baseline_evaluate_all_pending', skipAudit: true },
       async (adminDb) => {
         await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
         const result = await adminDb.execute(sql`
           SELECT id, organisation_id, subaccount_id, status, capture_attempt_count
           FROM subaccount_baselines
           WHERE status = 'pending'
              OR (
                status = 'ready'
                AND (
                  (capture_attempt_count = 0)
                  OR (capture_attempt_count = 1 AND last_attempt_at <= now() - interval '1 hour')
                  OR (capture_attempt_count = 2 AND last_attempt_at <= now() - interval '4 hours')
                  OR (capture_attempt_count = 3 AND last_attempt_at <= now() - interval '24 hours')
                )
              )
         `);
         return (result as unknown as { rows: Array<{ id: string; organisation_id: string; subaccount_id: string; status: string; capture_attempt_count: number }> }).rows;
       },
     );

     for (const c of candidates) {
       try {
         const result = await baselineReadinessService.evaluate(c.subaccount_id, c.organisation_id);
         if (!result.ready && c.status === 'pending') continue;
         await baselineSubscriberService.enqueueCaptureBaselineJob({
           baselineId: c.id,
           subaccountId: c.subaccount_id,
           organisationId: c.organisation_id,
           triggerSource: 'fallback',
         });
       } catch (err) {
         console.error('[evaluateAllPendingBaselines] failed for baseline', c.id, err);
       }
     }
   }
   ```

5. Register the daily cron at the existing pg-boss schedule registration site. Locate via `Grep` for `boss.schedule(` or look at `server/index.ts` / `server/jobs/index.ts` — wherever existing daily jobs are registered. Add:

   ```ts
   await boss.schedule(EVALUATE_ALL_PENDING_BASELINES_JOB, '0 6 * * *');  // daily at 06:00 UTC
   await boss.work(EVALUATE_ALL_PENDING_BASELINES_JOB, evaluateAllPendingBaselinesHandler);
   ```

   Confirm cron syntax matches repo conventions.

6. Author `server/services/__tests__/baselineSubscriberPure.test.ts` — pure decision-table tests for the enqueue predicate:
   - Readiness=false → no enqueue.
   - Readiness=true, status='pending' → enqueue, source='subscriber'.
   - Readiness=true, status='ready' → enqueue, source='subscriber'.
   - Readiness=true, status='captured' → no enqueue.
   - Readiness=true, status='failed' → no enqueue (terminal; recovery via manual entry).
   - Readiness=true, status='reset' → no enqueue.
   - Readiness=true, no row exists → no enqueue (defensive — initial pending row should exist via creation hook).

   Mock `baselineReadinessService.evaluate` and `baselineSubscriberService.enqueueCaptureBaselineJob` directly. The test asserts the predicate logic, not the DB query.

**Tests:** as in step 6.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/baselineSubscriberPure.test.ts`

**Commit:** `feat(baseline): connector.sync.complete event + subscriber + daily cron + 9 telemetry events registered`

---

## Chunk 3A — `captureBaselineService` core

**Goal:** Author the single-writer service that owns all `subaccount_baselines` mutations after the initial pending insert. Three public methods: `run(baselineId)` (auto path; called from `captureBaselineJob`), `runManual(subaccountId, metricInputs, userId)` (manual entry from `<ManualBaselineForm>`), `adminReset(subaccountId, reason, userId)` (from `<AdminBaselineResetButton>`). Implements the §5.3 capture sequence: lock acquisition → opt-in resolution → metric dispatch (registry only — readers land in 3B) → idempotent metric upsert → final-state decision → telemetry.

**Phase:** 3

**Files:**
- create: `server/services/captureBaselineService.ts`
- create: `server/services/baselineMetricReaders/registry.ts` (registry shape; per-metric files in 3B)
- create: `server/jobs/captureBaselineJob.ts` (pg-boss work handler)
- modify: pg-boss registration site to register the work handler
- create: `server/services/__tests__/captureBaselineServicePure.test.ts` (pure logic — final-state decision, lock-zero-rows clean exit)

**Steps:**

1. Author `server/services/baselineMetricReaders/registry.ts`:

   ```ts
   import type { BaselineMetricSlug } from '../../../shared/constants/baselineMetrics.js';
   import type { ErrorClass } from '../baselineRetryClassifierPure.js';

   export interface MetricReaderResult {
     value: { numeric: number; currency?: string; unit: string } | null;
     source: 'canonical_metric' | 'unavailable';
     unavailable_reason?: 'integration_not_connected' | 'api_failure' | 'no_data_yet';
     errorClass?: ErrorClass;
   }

   export type BaselineMetricReader = (
     ctx: { organisationId: string; subaccountId: string }
   ) => Promise<MetricReaderResult>;

   /** Populated in 3B with per-slug imports. Empty here so 3A compiles standalone. */
   export const METRIC_READERS: Partial<Record<BaselineMetricSlug, BaselineMetricReader>> = {};

   /**
    * Synthetic reader for v1 metrics with no adapter. Returns
    * `{source:'unavailable', unavailable_reason:'integration_not_connected', errorClass:'non_retryable'}`.
    * Used by the capture service for slugs marked `readerStatus: 'unavailable_default'`
    * in `V1_BASELINE_METRICS`.
    */
   export const UNAVAILABLE_INTEGRATION_NOT_CONNECTED: MetricReaderResult = {
     value: null,
     source: 'unavailable',
     unavailable_reason: 'integration_not_connected',
     errorClass: 'non_retryable',
   };
   ```

2. Author `server/services/captureBaselineService.ts`. Key invariants enforced by this file:
   - Lock acquisition uses `UPDATE … WHERE status IN ('pending','ready') … RETURNING id`. Zero rows → clean exit, no throw.
   - Final-state decision uses pure `aggregateOutcome` from Chunk 1C.
   - Metric upserts use `ON CONFLICT (baseline_id, metric_slug) DO UPDATE`.
   - All TIMESTAMPTZ writes use `sql\`now()\``.
   - `runManual` is the manual entry path; `adminReset` is a single transaction.

   Skeleton:

   ```ts
   import { and, eq, sql } from 'drizzle-orm';
   import { db } from '../db/index.js';
   import { subaccountBaselines } from '../db/schema/subaccountBaselines.js';
   import { subaccountBaselineMetrics } from '../db/schema/subaccountBaselineMetrics.js';
   import { subaccounts } from '../db/schema/subaccounts.js';
   import { createEvent } from '../lib/tracing.js';
   import { logger } from '../lib/logger.js';  // confirm exact path; matches existing logger usage in this layer
   import { resolveBaselineOptIn } from '../../shared/schemas/subaccount.js';
   import {
     V1_BASELINE_METRICS,
     metricMeta,
     type BaselineMetricSlug,
   } from '../../shared/constants/baselineMetrics.js';
   import {
     METRIC_READERS,
     UNAVAILABLE_INTEGRATION_NOT_CONNECTED,
     type MetricReaderResult,
   } from './baselineMetricReaders/registry.js';
   import {
     aggregateOutcome,
     isRetryBudgetExhausted,
     nextBackoffMinutes,
   } from './baselineRetryClassifierPure.js';

   export const captureBaselineService = {
     async run(baselineId: string): Promise<void> {
       // Step 0: cheap idempotency guard at the worker entrypoint. The lock
       // acquisition in Step 1 already filters on status IN ('pending','ready'),
       // but reading the row first lets us emit a clean structured log on
       // terminal-state job firings (subscriber and cron racing inside the
       // pg-boss singleton window) and protects future changes that might
       // narrow the lock predicate. This is detective, not preventive.
       //
       // Lock-miss reason taxonomy:
       //   pre_read_terminal — row already in a terminal state when the job
       //                       fired. Expected (subscriber + cron + manual
       //                       can race inside the singleton window).
       //   not_runnable      — row exists but is in 'capturing' (another
       //                       worker holds the lock). Possible scheduling
       //                       issue if it stays this way for long.
       //   lock_race         — pre-read passed but lock acquisition lost the
       //                       race. Indicates concurrency at the second
       //                       checkpoint (see step 1 below).
       //   not_found         — baselineId stale (row deleted, or job carries
       //                       an ID that never existed). Should be rare.
       const [current] = await db
         .select({ status: subaccountBaselines.status })
         .from(subaccountBaselines)
         .where(eq(subaccountBaselines.id, baselineId));
       if (!current) {
         logger.info('baseline.capture.lock_miss', {
           event: 'baseline.capture.lock_miss',
           baseline_id: baselineId,
           reason: 'not_found',
         });
         return;
       }
       if (current.status === 'captured' || current.status === 'failed'
           || current.status === 'manual' || current.status === 'reset') {
         logger.info('baseline.capture.lock_miss', {
           event: 'baseline.capture.lock_miss',
           baseline_id: baselineId,
           reason: 'pre_read_terminal',
           status: current.status,
         });
         return;
       }
       if (current.status === 'capturing') {
         logger.info('baseline.capture.lock_miss', {
           event: 'baseline.capture.lock_miss',
           baseline_id: baselineId,
           reason: 'not_runnable',
           status: current.status,
         });
         return;
       }

       // Step 1: acquire `capturing` lock. Zero rows = clean exit.
       // Authority for "one runnable row per sub-account" lives in the partial
       // UNIQUE index (subaccount_id) WHERE status <> 'reset'. We do NOT
       // subquery baseline_version here — coupling the lock to version logic
       // creates regression risk and the index already guarantees uniqueness.
       const locked = await db.execute(sql`
         UPDATE subaccount_baselines
         SET status = 'capturing', last_attempt_at = now()
         WHERE id = ${baselineId}
           AND status IN ('pending', 'ready')
         RETURNING id, organisation_id, subaccount_id, capture_attempt_count
       `);
       const lockedRow = (locked as unknown as { rows: Array<{ id: string; organisation_id: string; subaccount_id: string; capture_attempt_count: number }> }).rows[0];
       if (!lockedRow) {
         // Clean exit. Structured log so operators can see lock misses without
         // mistaking them for silent no-ops. The pre-read above (step 0) caught
         // the terminal-status case; reaching here means another worker won
         // the race between the pre-read and this UPDATE — distinguishing the
         // two reasons matters at scale (lock_race indicates concurrency,
         // not_runnable / pre_read_terminal indicate scheduling issues).
         logger.info('baseline.capture.lock_miss', {
           event: 'baseline.capture.lock_miss',
           baseline_id: baselineId,
           reason: 'lock_race',
         });
         return;
       }

       // Duration anchor: taken AFTER successful lock acquisition so
       // duration_ms reflects the time the worker actually spent doing work
       // for this attempt — not lock-contention time. process.hrtime.bigint()
       // is monotonic-process time (immune to NTP adjustments and the §6
       // DB-time invariant). NOT comparable to TIMESTAMPTZ values; treat as
       // a delta only.
       const captureStartHr = process.hrtime.bigint();

       const { organisation_id: organisationId, subaccount_id: subaccountId, capture_attempt_count: attempts } = lockedRow;
       const attemptNumber = attempts + 1;

       createEvent('baseline.capture.started', {
         subaccount_id: subaccountId,
         baseline_id: baselineId,
         attempt_number: attemptNumber,
         version: 1,
       });

       // Step 2: read opted-in metric set from subaccounts.settings JSONB.
       const [sub] = await db
         .select({ settings: subaccounts.settings })
         .from(subaccounts)
         .where(eq(subaccounts.id, subaccountId));
       const optedIn = resolveBaselineOptIn(sub?.settings ?? null);

       // Step 3: per-metric dispatch. Each reader returns
       // {value, source, unavailable_reason?, errorClass?}. Each reader call
       // is wrapped in a 5-second timeout — a slow external query (e.g. a
       // canonical_metrics scan against a large org) must not stall the whole
       // capture. Timeout is classified as api_failure / retryable, so the
       // cron retries with backoff. The timeout is per-reader; sibling
       // readers continue independently.
       //
       // Per-reader duration is measured (process.hrtime.bigint(), monotonic)
       // and emitted on every metric event — surfaces *which* integration is
       // slow vs. only that capture is slow. Same semantics as overall
       // duration_ms (architecture §13/§14): a delta, not a timestamp.
       const READER_TIMEOUT_MS = 5_000;
       const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
         new Promise<T>((resolve, reject) => {
           const t = setTimeout(() => reject(new Error('reader_timeout')), ms);
           p.then((v) => { clearTimeout(t); resolve(v); },
                  (e) => { clearTimeout(t); reject(e); });
         });

       interface PerMetricEntry {
         slug: BaselineMetricSlug;
         result: MetricReaderResult;
         durationMs: number;
         timedOut: boolean;
       }
       const perMetric: PerMetricEntry[] = [];
       for (const slug of optedIn) {
         const meta = metricMeta(slug);
         const readerStartHr = process.hrtime.bigint();
         let result: MetricReaderResult;
         let timedOut = false;
         try {
           if (meta.readerStatus === 'unavailable_default') {
             result = UNAVAILABLE_INTEGRATION_NOT_CONNECTED;
           } else {
             const reader = METRIC_READERS[slug];
             if (!reader) {
               // Reader-not-implemented — non-retryable.
               result = {
                 value: null, source: 'unavailable',
                 unavailable_reason: 'integration_not_connected',
                 errorClass: 'non_retryable',
               };
             } else {
               result = await withTimeout(
                 reader({ organisationId, subaccountId }),
                 READER_TIMEOUT_MS,
               );
             }
           }
         } catch (err) {
           // Thrown errors (including reader_timeout) are treated as
           // api_failure / retryable. The cron picks the row up at the
           // configured backoff window.
           const msg = err instanceof Error ? err.message : String(err);
           timedOut = msg === 'reader_timeout';
           console.error('[captureBaselineService] reader failed for', slug, msg);
           result = {
             value: null, source: 'unavailable',
             unavailable_reason: 'api_failure',
             errorClass: 'retryable',
           };
         }
         const readerDurationMs = Number(process.hrtime.bigint() - readerStartHr) / 1_000_000;
         perMetric.push({ slug, result, durationMs: readerDurationMs, timedOut });

         // Telemetry per metric. duration_ms is process-monotonic; never
         // compared to DB timestamps. timeout_ms / elapsed_ms appear only on
         // the unavailable path when timedOut is true — they distinguish
         // "slow integration" (elapsed close to budget) from "dead integration"
         // (elapsed exactly at budget) from "flaky integration" (elapsed well
         // below budget but threw).
         if (result.source === 'canonical_metric' && result.value) {
           createEvent('baseline.metric.captured', {
             subaccount_id: subaccountId,
             baseline_id: baselineId,
             metric_slug: slug,
             source: 'canonical_metric',
             value_summary: { unit: result.value.unit, numeric: result.value.numeric },
             duration_ms: readerDurationMs,
           });
         } else if (result.source === 'unavailable') {
           createEvent('baseline.metric.unavailable', {
             subaccount_id: subaccountId,
             baseline_id: baselineId,
             metric_slug: slug,
             unavailable_reason: result.unavailable_reason,
             error_class: result.errorClass ?? 'retryable',
             duration_ms: readerDurationMs,
             ...(timedOut
               ? { timed_out: true, timeout_ms: READER_TIMEOUT_MS, elapsed_ms: readerDurationMs }
               : {}),
           });
         }
       }

       // Step 4: idempotent metric upsert (ON CONFLICT DO UPDATE).
       for (const { slug, result } of perMetric) {
         const valueJson = result.value ?? { numeric: 0, unit: metricMeta(slug).unit };
         await db.execute(sql`
           INSERT INTO subaccount_baseline_metrics (baseline_id, metric_slug, value, source, unavailable_reason)
           VALUES (${baselineId}, ${slug}, ${JSON.stringify(valueJson)}::jsonb, ${result.source}, ${result.unavailable_reason ?? null})
           ON CONFLICT (baseline_id, metric_slug)
           DO UPDATE SET
             value = EXCLUDED.value,
             source = EXCLUDED.source,
             unavailable_reason = EXCLUDED.unavailable_reason,
             captured_at = now()
         `);
       }

       // Step 5: final-state decision (pure helper from Chunk 1C).
       const outcome = aggregateOutcome(
         perMetric.map((m) => ({ source: m.result.source, errorClass: m.result.errorClass })),
         optedIn.length,
       );

       if (outcome.kind === 'success') {
         await db
           .update(subaccountBaselines)
           .set({
             status: 'captured',
             capturedAt: sql`now()`,
             confidence: outcome.confidence,
             readyAt: sql`COALESCE(ready_at, now())`,
             nextAttemptAt: null,  // clear retry-schedule pointer on terminal transition
           })
           .where(eq(subaccountBaselines.id, baselineId));

         createEvent('baseline.capture.succeeded', {
           subaccount_id: subaccountId,
           baseline_id: baselineId,
           confidence: outcome.confidence,
           metrics_captured_count: perMetric.filter((m) => m.result.source === 'canonical_metric').length,
           metrics_unavailable_count: perMetric.filter((m) => m.result.source === 'unavailable').length,
           duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
         });
         return;
       }

       if (outcome.kind === 'non_retryable_failure') {
         await db
           .update(subaccountBaselines)
           .set({ status: 'failed', failureReason: outcome.reason, captureAttemptCount: attemptNumber, nextAttemptAt: null })
           .where(eq(subaccountBaselines.id, baselineId));

         createEvent('baseline.capture.failed', {
           subaccount_id: subaccountId,
           baseline_id: baselineId,
           failure_reason: outcome.reason,
           final_attempt_count: attemptNumber,
           duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
         });
         return;
       }

       // outcome.kind === 'retryable_failure'
       if (isRetryBudgetExhausted(attemptNumber)) {
         await db
           .update(subaccountBaselines)
           .set({ status: 'failed', failureReason: 'retry_budget_exhausted', captureAttemptCount: attemptNumber, nextAttemptAt: null })
           .where(eq(subaccountBaselines.id, baselineId));

         createEvent('baseline.capture.failed', {
           subaccount_id: subaccountId,
           baseline_id: baselineId,
           failure_reason: 'retry_budget_exhausted',
           final_attempt_count: attemptNumber,
           duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
         });
         return;
       }

       // Schedule retry: bump count + transition back to 'ready'. last_attempt_at
       // already set by the lock acquisition. Stamp next_attempt_at explicitly
       // (last_attempt_at + backoff window) so operators have direct visibility
       // into when the retry will fire — and so telemetry carries a real
       // timestamp instead of null. Cron eligibility filter still re-derives
       // the same window in SQL; persisting it is for observability, not
       // authority. Use Postgres now() + interval to keep DB-time as source.
       const backoffMin = nextBackoffMinutes(attemptNumber);  // never null here — exhausted case handled above
       const updated = await db
         .update(subaccountBaselines)
         .set({
           status: 'ready',
           captureAttemptCount: attemptNumber,
           nextAttemptAt: sql`now() + (${backoffMin} || ' minutes')::interval`,
         })
         .where(eq(subaccountBaselines.id, baselineId))
         .returning({ nextAttemptAt: subaccountBaselines.nextAttemptAt });

       const failureReasons = perMetric
         .filter((m) => m.result.source === 'unavailable')
         .map((m) => m.result.unavailable_reason ?? 'no_data_yet');

       createEvent('baseline.capture.retry_scheduled', {
         subaccount_id: subaccountId,
         baseline_id: baselineId,
         attempt_number: attemptNumber,
         next_attempt_at: updated[0]?.nextAttemptAt ?? null,
         failure_reasons: failureReasons,
         duration_ms: Number(process.hrtime.bigint() - captureStartHr) / 1_000_000,
       });
     },

     /**
      * F3 §6 — manual entry. Writes individual metric rows with source='manual',
      * transitions baseline to source='mixed' (when some auto + some manual) or
      * source='manual', recomputes confidence.
      */
     async runManual(params: {
       organisationId: string;
       subaccountId: string;
       userId: string;
       metricInputs: Array<{ slug: BaselineMetricSlug; numeric: number; currency?: string }>;
     }): Promise<void> {
       // Find the active baseline (any non-reset status).
       const [baseline] = await db
         .select({ id: subaccountBaselines.id, source: subaccountBaselines.source, status: subaccountBaselines.status })
         .from(subaccountBaselines)
         .where(and(
           eq(subaccountBaselines.subaccountId, params.subaccountId),
           eq(subaccountBaselines.organisationId, params.organisationId),
           sql`status <> 'reset'`,
         ));
       if (!baseline) {
         throw { statusCode: 404, errorCode: 'BASELINE_NOT_FOUND', message: 'No active baseline for this subaccount' };
       }

       // §10 invariant: manual override never conflicts with auto. The read
       // above is a best-effort guard for fast feedback. The atomic guard is
       // the final UPDATE below: it predicates on status <> 'capturing'. If
       // the auto path acquires the lock between this read and the metric
       // upserts, the final UPDATE returns zero rows and we throw 409 — the
       // metric upserts are themselves idempotent (PK + ON CONFLICT) so even
       // a partial pre-empt leaves no orphaned writes the auto path can't
       // overwrite.
       if (baseline.status === 'capturing') {
         throw { statusCode: 409, errorCode: 'BASELINE_CAPTURING', message: 'Auto capture in flight; retry shortly' };
       }

       const overridden: BaselineMetricSlug[] = [];
       for (const input of params.metricInputs) {
         const meta = metricMeta(input.slug);
         await db.execute(sql`
           INSERT INTO subaccount_baseline_metrics (baseline_id, metric_slug, value, source)
           VALUES (
             ${baseline.id},
             ${input.slug},
             ${JSON.stringify({ numeric: input.numeric, ...(input.currency ? { currency: input.currency } : {}), unit: meta.unit })}::jsonb,
             'manual'
           )
           ON CONFLICT (baseline_id, metric_slug)
           DO UPDATE SET
             value = EXCLUDED.value,
             source = 'manual',
             unavailable_reason = NULL,
             captured_at = now()
         `);
         overridden.push(input.slug);
       }

       // Recompute baseline source: 'manual' if all rows are manual, else 'mixed'.
       const allRows = await db
         .select({ source: subaccountBaselineMetrics.source })
         .from(subaccountBaselineMetrics)
         .where(eq(subaccountBaselineMetrics.baselineId, baseline.id));
       const hasNonManual = allRows.some((r) => r.source !== 'manual');
       const newSource: 'manual' | 'mixed' = hasNonManual ? 'mixed' : 'manual';

       // Confidence: ratio of canonical+manual rows over opted-in length.
       const captured = allRows.filter((r) => r.source === 'canonical_metric' || r.source === 'manual').length;
       const [sub] = await db
         .select({ settings: subaccounts.settings })
         .from(subaccounts)
         .where(eq(subaccounts.id, params.subaccountId));
       const optedIn = resolveBaselineOptIn(sub?.settings ?? null);
       // §6 edge: if optedIn is empty (degenerate settings — empty array
       // explicitly set), confidence cannot be 'confirmed'. Default to 'partial'
       // so the row is never marked confirmed without underlying metrics.
       const newConfidence: 'confirmed' | 'partial' =
         optedIn.length > 0 && captured >= optedIn.length ? 'confirmed' : 'partial';

       // Atomic write-time guard against the lock race: predicate on status
       // not being 'capturing'. If the auto path acquired the lock between
       // our pre-check and now, this UPDATE returns zero rows — surface 409
       // so the operator retries.
       const result = await db
         .update(subaccountBaselines)
         .set({
           status: 'manual',
           source: newSource,
           confidence: newConfidence,
           capturedAt: sql`COALESCE(captured_at, now())`,
           nextAttemptAt: null,
         })
         .where(and(
           eq(subaccountBaselines.id, baseline.id),
           sql`status <> 'capturing'`,
         ))
         .returning({ id: subaccountBaselines.id });
       if (result.length === 0) {
         throw { statusCode: 409, errorCode: 'BASELINE_CAPTURING', message: 'Auto capture in flight; retry shortly' };
       }

       createEvent('baseline.manual.applied', {
         subaccount_id: params.subaccountId,
         baseline_id: baseline.id,
         user_id: params.userId,
         metrics_overridden: overridden,
       });
     },

     /** F3 §6 — admin reset. Single transaction. Preserves history. */
     async adminReset(params: {
       organisationId: string;
       subaccountId: string;
       userId: string;
       reason: string;
     }): Promise<{ priorBaselineId: string; newBaselineId: string; newVersion: number }> {
       return db.transaction(async (tx) => {
         const [prior] = await tx
           .select({ id: subaccountBaselines.id, version: subaccountBaselines.baselineVersion })
           .from(subaccountBaselines)
           .where(and(
             eq(subaccountBaselines.subaccountId, params.subaccountId),
             eq(subaccountBaselines.organisationId, params.organisationId),
             sql`status <> 'reset'`,
           ));
         if (!prior) {
           throw { statusCode: 404, errorCode: 'BASELINE_NOT_FOUND' };
         }

         await tx
           .update(subaccountBaselines)
           .set({
             status: 'reset',
             resetAt: sql`now()`,
             resetByUserId: params.userId,
             adminResetReason: params.reason,
           })
           .where(eq(subaccountBaselines.id, prior.id));

         const newVersion = prior.version + 1;
         const [inserted] = await tx
           .insert(subaccountBaselines)
           .values({
             organisationId: params.organisationId,
             subaccountId: params.subaccountId,
             baselineVersion: newVersion,
             status: 'pending',
           })
           .returning({ id: subaccountBaselines.id });

         createEvent('baseline.admin_reset', {
           subaccount_id: params.subaccountId,
           prior_baseline_id: prior.id,
           new_baseline_id: inserted.id,
           prior_version: prior.version,
           new_version: newVersion,
           user_id: params.userId,
           reason: params.reason,
         });

         return { priorBaselineId: prior.id, newBaselineId: inserted.id, newVersion };
       });
     },
   };
   ```

3. Author `server/jobs/captureBaselineJob.ts`:

   ```ts
   import type PgBoss from 'pg-boss';
   import { captureBaselineService } from '../services/captureBaselineService.js';

   export interface CaptureBaselineJobData {
     baselineId: string;
     subaccountId: string;
     organisationId: string;
   }

   export async function captureBaselineJobHandler(
     job: PgBoss.Job<CaptureBaselineJobData>,
   ): Promise<void> {
     await captureBaselineService.run(job.data.baselineId);
   }
   ```

4. Register the work handler at the same site as the cron registration in Chunk 2B:

   ```ts
   await boss.work(CAPTURE_BASELINE_JOB, captureBaselineJobHandler);
   ```

5. Author `server/services/__tests__/captureBaselineServicePure.test.ts` — focuses on the deterministic transition logic; the DB writes can be asserted via a mock client capturing the issued SQL. If integration is fragile, restrict to `aggregateOutcome` + `isRetryBudgetExhausted` composition tests already covered in Chunk 1C and add ONE end-to-end happy-path test in Chunk 3C against a real DB fixture. Cases:
   - Lock acquisition zero rows → clean exit (no error thrown).
   - 2 canonical_metric → 'captured' with `confidence='confirmed'` when all opted-in returned canonical.
   - 2 canonical_metric out of 3 opted-in → 'captured' with `confidence='partial'`.
   - 1 canonical_metric, 1 retryable unavailable, 1st attempt → 'ready' with retry_scheduled emit.
   - 1 canonical_metric, 1 retryable unavailable, 3rd attempt → 'failed' with `failure_reason='retry_budget_exhausted'`.
   - 1 canonical_metric, 1 non-retryable unavailable → 'failed' immediately (consumes 0 budget).

**Tests:** as in step 5.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/captureBaselineServicePure.test.ts`

**Commit:** `feat(baseline): captureBaselineService — auto/manual/reset paths + capture job handler`

---

## Chunk 3B — Per-metric readers + retry job

**Goal:** Implement the five v1 metric readers as per-file modules under `server/services/baselineMetricReaders/`. Wire each into the `METRIC_READERS` registry from Chunk 3A. Each reader follows the pure `BaselineMetricReader` contract: returns `{value, source, unavailable_reason?, errorClass?}`. The retry "job" is the existing `evaluateAllPendingBaselines` cron (Chunk 2B) — no new job here, just configuration.

**Phase:** 3

**Files:**
- create: `server/services/baselineMetricReaders/getPipelineValue.ts`
- create: `server/services/baselineMetricReaders/getOpenOpportunityCount.ts`
- create: `server/services/baselineMetricReaders/getLeadCount.ts`
- create: `server/services/baselineMetricReaders/getConversationEngagement.ts`
- create: `server/services/baselineMetricReaders/getRevenueLast30d.ts`
- modify: `server/services/baselineMetricReaders/registry.ts` (populate `METRIC_READERS`)
- create: `server/services/__tests__/baselineMetricReaders.test.ts`

**Steps:**

0. **Mandatory build-blocking pre-check — revenue slug discovery.** Before authoring any reader, run:

   ```bash
   grep -REn "metric_slug.*['\"]revenue" server/services/canonicalDataService.ts server/services/integrations/ shared/ | head -20
   grep -REn "['\"]revenue[^'\"]*['\"]" server/services/canonicalDataService.ts | head -20
   ```

   Capture the **exact** slug string the existing GHL/Stripe ingestion writes for revenue values into `canonical_metric_history` (or `canonical_metrics`). Possibilities observed historically: `revenue`, `monthly_revenue`, `revenue_last_30d`, `revenue_total`. If the grep returns no slug at all (no revenue ingestion exists yet), this is also a positive signal — the reader's `unavailable / no_data_yet` path is the correct steady state until ingestion lands.

   **Decision tree — must be resolved BEFORE step 4:**
   - Slug found, matches `revenue_last_30d` (the v1 registry default in Chunk 1B): proceed to step 4 unchanged.
   - Slug found, differs from `revenue_last_30d` (e.g. `revenue`): update three places in the same commit before step 4 — the reader query (step 4 below), the v1 metric registry entry in `shared/constants/baselineMetrics.ts` (Chunk 1B), and the slug constant in any test fixture introduced in Chunk 3C. Document the canonical name in the Chunk 3B commit message.
   - No slug found at all (no existing revenue ingestion): leave the reader returning `unavailable / no_data_yet / retryable` and document under `## Deferred Items` in `tasks/builds/baseline-capture/progress.md`. Do not invent a slug.

   **Build-blocking:** the executor MUST resolve this before authoring step 4. Proceeding with the default assumption (`revenue` or `revenue_last_30d`) without verification produces baselines that always look "partial" for revenue and never recovers automatically. This is the single most likely silent-failure mode in F3 — treat it as a hard gate, not a follow-up.

1. Establish the reader pattern. Each reader queries `canonical_metrics` joined to `canonical_accounts` filtered on `organisationId + subaccountId`, looks up the named slug, and translates the numeric value into the canonical `MetricValue` shape. For `revenue_last_30d`, sum over the last 30 days of `canonical_metric_history`. Failure paths:
   - No row found → `{source:'unavailable', unavailable_reason:'no_data_yet', errorClass:'retryable'}`.
   - DB error / network → throw (caller treats as `api_failure`/retryable).
   - Schema mismatch (numeric parse fails) → `{source:'unavailable', unavailable_reason:'no_data_yet', errorClass:'non_retryable'}` (spec §5.4 classifies `schema_mismatch` as non-retryable).

2. Author `server/services/baselineMetricReaders/getPipelineValue.ts`:

   ```ts
   import { and, eq } from 'drizzle-orm';
   import { db } from '../../db/index.js';
   import { canonicalMetrics } from '../../db/schema/canonicalMetrics.js';
   import { canonicalAccounts } from '../../db/schema/canonicalAccounts.js';
   import type { BaselineMetricReader } from './registry.js';

   /**
    * F3 §2 — pipeline value (currency cents). Reads canonical_metrics where
    * metric_slug='pipeline_value'. Sum across all accounts for the subaccount.
    */
   export const getPipelineValue: BaselineMetricReader = async ({ organisationId, subaccountId }) => {
     const rows = await db
       .select({ value: canonicalMetrics.currentValue })
       .from(canonicalMetrics)
       .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetrics.accountId))
       .where(and(
         eq(canonicalAccounts.organisationId, organisationId),
         eq(canonicalAccounts.subaccountId, subaccountId),
         eq(canonicalMetrics.metricSlug, 'pipeline_value'),
       ));

     if (rows.length === 0) {
       return { value: null, source: 'unavailable', unavailable_reason: 'no_data_yet', errorClass: 'retryable' };
     }

     let sum = 0;
     for (const r of rows) {
       const n = Number(r.value);
       if (!Number.isFinite(n)) {
         // schema_mismatch — non-retryable.
         return { value: null, source: 'unavailable', unavailable_reason: 'no_data_yet', errorClass: 'non_retryable' };
       }
       sum += n;
     }

     return {
       value: { numeric: Math.round(sum), currency: 'USD', unit: 'cents' },
       source: 'canonical_metric',
     };
   };
   ```

3. Author `getOpenOpportunityCount.ts`, `getLeadCount.ts`, `getConversationEngagement.ts` — same shape, different `metricSlug` filter and different `unit`:
   - `getOpenOpportunityCount`: `metricSlug='open_opportunity_count'`, unit `'count'`, no currency.
   - `getLeadCount`: `metricSlug='lead_count'`, unit `'count'`.
   - `getConversationEngagement`: `metricSlug='conversation_engagement'`, unit `'count'`.

4. Author `getRevenueLast30d.ts` — aggregates `canonical_metric_history` over the last 30 days:

   ```ts
   import { and, eq, sql } from 'drizzle-orm';
   import { db } from '../../db/index.js';
   import { canonicalMetricHistory } from '../../db/schema/canonicalMetrics.js';
   import { canonicalAccounts } from '../../db/schema/canonicalAccounts.js';
   import type { BaselineMetricReader } from './registry.js';

   /**
    * F3 §2 — revenue over the last 30 days. Lower bound is computed by
    * Postgres (`now() - interval '30 days'`) to keep DB-time the source of
    * truth (§6) and to keep the F3 surface free of `Date.now()` calls
    * (Invariant 6, Chunk 3C).
    */
   export const getRevenueLast30d: BaselineMetricReader = async ({ organisationId, subaccountId }) => {
     const rows = await db
       .select({ value: canonicalMetricHistory.value })
       .from(canonicalMetricHistory)
       .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetricHistory.accountId))
       .where(and(
         eq(canonicalAccounts.organisationId, organisationId),
         eq(canonicalAccounts.subaccountId, subaccountId),
         eq(canonicalMetricHistory.metricSlug, 'revenue'),
         sql`${canonicalMetricHistory.computedAt} >= now() - interval '30 days'`,
       ));

     if (rows.length === 0) {
       return { value: null, source: 'unavailable', unavailable_reason: 'no_data_yet', errorClass: 'retryable' };
     }

     let sum = 0;
     for (const r of rows) {
       const n = Number(r.value);
       if (!Number.isFinite(n)) {
         return { value: null, source: 'unavailable', unavailable_reason: 'no_data_yet', errorClass: 'non_retryable' };
       }
       sum += n;
     }

     return {
       value: { numeric: Math.round(sum), currency: 'USD', unit: 'cents' },
       source: 'canonical_metric',
     };
   };
   ```

   *Note* (load-bearing assumption): the `revenue` slug used here MUST match what `canonicalDataService` writes. Cross-check at build start by grepping `metric_slug.*revenue` in `server/services/canonicalDataService.ts` and the GHL/Stripe adapters' `computeMetrics`. If the slug differs, adjust this reader and the v1 `revenue_last_30d` registry entry to match the canonical slug. See Risk R8.

5. Modify `server/services/baselineMetricReaders/registry.ts` — populate `METRIC_READERS`:

   ```ts
   import { getPipelineValue } from './getPipelineValue.js';
   import { getOpenOpportunityCount } from './getOpenOpportunityCount.js';
   import { getLeadCount } from './getLeadCount.js';
   import { getConversationEngagement } from './getConversationEngagement.js';
   import { getRevenueLast30d } from './getRevenueLast30d.js';

   export const METRIC_READERS: Partial<Record<BaselineMetricSlug, BaselineMetricReader>> = {
     pipeline_value: getPipelineValue,
     open_opportunity_count: getOpenOpportunityCount,
     lead_count: getLeadCount,
     conversation_engagement: getConversationEngagement,
     revenue_last_30d: getRevenueLast30d,
   };
   ```

   The registry is `Partial` because the `unavailable_default` slugs (GMB, MRR, etc.) intentionally have no reader — the capture service in 3A handles those via the `UNAVAILABLE_INTEGRATION_NOT_CONNECTED` short-circuit.

6. Author `server/services/__tests__/baselineMetricReaders.test.ts` — pure-style tests with stubbed db rows:
   - `getPipelineValue` with one row `{value: '47000'}` → `{numeric: 47000, currency: 'USD', unit: 'cents', source: 'canonical_metric'}`.
   - `getPipelineValue` with multiple rows → sum.
   - `getPipelineValue` with no rows → `unavailable / no_data_yet / retryable`.
   - `getPipelineValue` with non-numeric row → `unavailable / no_data_yet / non_retryable` (schema mismatch path).
   - `getLeadCount` with `{value: '127'}` → `{numeric: 127, unit: 'count'}` (no currency).
   - `getRevenueLast30d` with two history rows → sum.
   - Registry membership: every entry in `AVAILABLE_METRIC_SLUGS` has a reader; every `unavailable_default` entry does NOT have a reader.

7. **Confirm step 0 was executed.** If the executor jumped straight to authoring without running the build-blocking pre-check above, halt the chunk and run it now. The pre-check is the single most likely silent-failure mode in F3 — see Risk R8 (now resolved by step 0).

**Tests:** as in step 6.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/baselineMetricReaders.test.ts`

**Commit:** `feat(baseline): per-metric readers (pipeline, opps, leads, conversations, revenue) + registry`

---

## Chunk 3C — `baselineInvariants.test.ts` + integration test

**Goal:** Author the §10 hard-invariants test file. Author the integration test that seeds canonical_metrics fixtures, runs capture, and asserts state machine + telemetry. **These tests WILL BE AUTHORED IN THIS CHUNK** — they do not exist yet, and this plan does not claim them as already-passing anywhere else.

**Phase:** 3

**Files:**
- create: `server/services/__tests__/baselineInvariants.test.ts`
- create: `server/services/__tests__/captureBaselineIntegration.test.ts` (DB-backed)

**Steps:**

1. Author `server/services/__tests__/baselineInvariants.test.ts` — tests the §10 hard invariants:

   **Invariant 1 — Exactly one active baseline per sub-account.** Two `pending` inserts in parallel; the second must throw `subaccount_baselines_active_uniq` constraint violation. Approach: insert row #1 + commit, insert row #2 → expect throw containing `subaccount_baselines_active_uniq`.

   **Invariant 1b — Admin reset transaction succeeds.** `captureBaselineService.adminReset(...)` followed by inspection: prior row `status='reset'` AND new row `status='pending'` AND `baseline_version = prior + 1`. Both rows exist (history preserved).

   **Invariant 1c — Non-transactional double-insert fails.** Insert first row + commit; attempt second row (different version, same sub-account, status='pending') — expect violation.

   **Invariant 2 — Idempotent retry.** Set up a fixture where `aggregateOutcome` returns success. Call `captureBaselineService.run(baselineId)` twice. Assert: row state unchanged after second call (`status='captured'`, `confidence=...`, same `captured_at`); metric row count for the baseline unchanged.

   **Invariant 3 — Single-writer rule (static check).** Grep over `server/**/*.ts` for write surfaces against `subaccountBaselines`. Three patterns covered (the third catches simple aliasing — e.g. `const sb = subaccountBaselines; await db.update(sb)`):
     - Raw SQL: `INSERT INTO subaccount_baselines`, `UPDATE subaccount_baselines`.
     - Drizzle direct: `db.insert(subaccountBaselines)`, `db.update(subaccountBaselines)`.
     - Drizzle aliased: any call site whose argument expression contains the literal `subaccountBaselines)` — catches `db.update(subaccountBaselines)`, `tx.insert(subaccountBaselines)`, `someAlias(subaccountBaselines)`. This is detective for the trivial alias case (`const sb = subaccountBaselines`); a determined developer can still defeat it with deeper indirection. The mitigation is a code-review note in DEVELOPMENT_GUIDELINES (Chunk 6) — not a perfect static guarantee.

   Filter out `*_test.ts`, `*.test.ts`, `__tests__/`, `migrations/`. The remaining matches MUST live ONLY in:
     - `server/services/captureBaselineService.ts`
     - `server/services/subaccountOnboardingService.ts` (the `markBaselinePending` method only — INSERT)

   ```ts
   import { execSync } from 'node:child_process';
   // Pattern set:
   //   1. Raw SQL writes
   //   2. Drizzle direct call: db.insert(subaccountBaselines) etc.
   //   3. Drizzle aliased / trailing-paren form: catches `subaccountBaselines)` in any position
   //      — covers `tx.update(subaccountBaselines)`, helper(subaccountBaselines), etc.
   const violations = execSync(
     'grep -rEn "(INSERT INTO subaccount_baselines|UPDATE subaccount_baselines|db\\.(insert|update|delete)\\(subaccountBaselines\\)|subaccountBaselines\\))" server --include="*.ts" --exclude-dir=__tests__ || true',
     { encoding: 'utf8' },
   );
   const allowed = [
     'server/services/captureBaselineService.ts',
     'server/services/subaccountOnboardingService.ts',
   ];
   const violationLines = violations.split('\n')
     .filter((l) => l.length > 0)
     .filter((l) => !allowed.some((path) => l.startsWith(path)))
     // The third pattern (subaccountBaselines\)) is broad and matches benign
     // read sites (db.select().from(subaccountBaselines) — note: from(...) NOT
     // a write). Filter out reads explicitly to keep the signal high.
     .filter((l) => !/\.(select|from)\s*\(/.test(l));
   assert.equal(violationLines.length, 0, `Single-writer violation: ${violationLines.join('\n')}`);
   ```

   **Invariant 4 — Manual override never duplicates rows under contention.** Simulate: spawn two parallel calls — `captureBaselineService.run(id)` and `captureBaselineService.runManual(...)`. Assert: zero duplicate rows in `subaccount_baseline_metrics` (PK guarantees this); the manual path gets 409 `BASELINE_CAPTURING` if the auto path holds the lock, else manual proceeds and the auto path's lock acquisition zero-rows-cleanly-exits.

   **Invariant 5 — Admin reset preserves history.** After reset, `SELECT COUNT(*) FROM subaccount_baselines WHERE subaccount_id=$1` >= 2; one row has `status='reset' AND admin_reset_reason IS NOT NULL`; one row has `status='pending' AND baseline_version=2`.

   **Invariant 6 — All timestamps via Postgres `now()` (static grep).** Same shape as Invariant 3. Per the §6 DB-time invariant the F3 capture path contains zero `Date.now()` calls — including the readiness service, which now does the settle-window comparison inside SQL (`now() - first_qualifying_poll_at >= interval '1 hour'`). The grep covers the full F3 surface:

   ```ts
   const dateNowHits = execSync(
     'grep -rEn "Date\\.now\\(\\)" server/services/captureBaselineService.ts server/services/baselineReadinessService.ts server/services/baselineSubscriberService.ts server/services/baselineMetricReaders/ server/services/reportingAgent/baselineHelper.ts server/jobs/captureBaselineJob.ts server/jobs/evaluateAllPendingBaselines.ts || true',
     { encoding: 'utf8' },
   );
   const lines = dateNowHits.split('\n').filter((l) => l.length > 0);
   assert.equal(lines.length, 0, `Date.now() found in F3 capture path: ${lines.join('\n')}`);
   ```

   *Allowed exception:* `getRevenueLast30d.ts` (Chunk 3B) uses `new Date(Date.now() - 30 days)` to build the lower bound for the history query. This is a **query-parameter computation**, not a comparison anchor — Postgres receives the timestamp and uses it in `WHERE computed_at >= $1`. To keep the grep tight, that file passes `sql\`now() - interval '30 days'\`` instead of computing the date in JS (see Chunk 3B step 4 update). After that change, zero `Date.now()` hits across the entire F3 surface — no exception needed.

   The cron retry-eligibility check in `evaluateAllPendingBaselines.ts` also previously used `Date.now()` to compute elapsed minutes against `lastAttemptAt`. That is rewritten to a SQL filter (Chunk 2B step 4 update) so the cron candidate list is itself the eligibility list — no JS-time comparison.

   **Invariant 7 — `next_attempt_at IS NOT NULL ↔ status = 'ready'`.** Per architecture note §15. Test by exercising each transition path on a single fixture baseline:

   ```ts
   // After initial pending insert: next_attempt_at IS NULL
   // After lock → 'capturing': next_attempt_at IS NULL (unchanged from pending)
   // After retryable failure → 'ready' with attempts=1: next_attempt_at IS NOT NULL
   // After 3rd retryable failure → 'failed': next_attempt_at IS NULL
   // After non-retryable → 'failed': next_attempt_at IS NULL
   // After success → 'captured': next_attempt_at IS NULL
   // After runManual → 'manual': next_attempt_at IS NULL
   // After adminReset → prior 'reset' (NULL) + new 'pending' (NULL)
   ```

   Exhaustive coverage. The forward direction (`status='ready' → next_attempt_at IS NOT NULL`) prevents the regression "retry transition forgot to stamp next_attempt_at" — operators would still get retries via cron, but lose observability. The backward direction (`next_attempt_at IS NULL → status != 'ready'`) prevents stale retry pointers on terminal rows.

2. Author `server/services/__tests__/captureBaselineIntegration.test.ts` — DB-backed end-to-end fixture. Pattern to follow: existing repo integration tests (search for one like `*.integration.test.ts` or check whether F1 introduced one in `tasks/builds/subaccount-artefacts/`):
   - Setup: create test org + sub-account; insert a fake `connector_configs` row with `successfulPollCountTotal=2` and `firstQualifyingPollAt = 2h ago`; insert canonical_accounts + canonical_metrics fixture covering `pipeline_value` and `lead_count` (>= 2 of 4 core slugs).
   - Insert initial `pending` row via `subaccountOnboardingService.markBaselinePending(...)`.
   - Verify readiness: `await baselineReadinessService.evaluate(...)` returns `{ready:true}`.
   - Run capture: `await captureBaselineService.run(baselineId)`.
   - Assert: `subaccount_baselines.status='captured'`, `confidence='partial'` (not all 5 v1 metrics returned canonical), `captured_at IS NOT NULL`.
   - Assert: 5+ `subaccount_baseline_metrics` rows; `pipeline_value` row has `source='canonical_metric'` and `value->>'numeric'` equal to seeded value; `gmb_rank` (synthetic) has `source='unavailable', unavailable_reason='integration_not_connected'`.
   - Assert: telemetry events emitted — `baseline.capture.started`, `baseline.metric.captured` × 2 (or more), `baseline.metric.unavailable` × N, `baseline.capture.succeeded`. Verify by inspecting the test-mode tracing buffer (existing pattern: `tracing.ts` exposes `getRecentEvents()` or similar — confirm at build time).

   If the repo has no DB-test scaffolding callable from `npx tsx`, scope this test to in-memory fixtures via a Drizzle test harness, OR document under `## Deferred Items` that the integration assertion is covered by CI gates only.

3. **Telemetry buffer sanity:** if no test-mode buffer exists, add a minimal one OR rely on per-event service mock. The test should NOT depend on production tracing infrastructure.

**Tests:** the two test files above. Both run via `npx tsx`. The grep-based static checks (Invariants 3 + 6) execute as part of the same test file via `child_process.execSync`.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/baselineInvariants.test.ts`
- `npx tsx server/services/__tests__/captureBaselineIntegration.test.ts`

**Commit:** `feat(baseline): hard invariants test + integration test`

---

## Chunk 4A — UI components + server routes

**Goal:** Author three React components and three server routes. Components: `<ManualBaselineForm>`, `<BaselineStatusBadge>`, `<AdminBaselineResetButton>`. Routes: status read, manual entry POST, admin reset POST.

**Phase:** 4

**Files:**
- create: `client/src/components/baseline/ManualBaselineForm.tsx`
- create: `client/src/components/baseline/BaselineStatusBadge.tsx`
- create: `client/src/components/baseline/AdminBaselineResetButton.tsx`
- create: `server/routes/baselines.ts` (new file: status, manual, reset routes)
- modify: `server/routes/index.ts` (or wherever routes register) — mount `baselines.ts`
- create: `shared/schemas/baselineManualForm.ts` (form validation schema shared between client and server)

**Steps:**

1. Author `shared/schemas/baselineManualForm.ts`:

   ```ts
   import { z } from 'zod';
   import { ALL_METRIC_SLUGS, type BaselineMetricSlug } from '../constants/baselineMetrics.js';

   export const manualMetricInputSchema = z.object({
     slug: z.enum(ALL_METRIC_SLUGS as [BaselineMetricSlug, ...BaselineMetricSlug[]]),
     numeric: z.number().nonnegative(),  // §6 validation: no negatives
     currency: z.string().length(3).optional(),  // ISO 4217 — required when unit='cents'
   });

   export const manualBaselineFormSchema = z.object({
     metrics: z.array(manualMetricInputSchema).min(1),
   });

   export const adminResetSchema = z.object({
     reason: z.string().min(1).max(500),
   });

   export type ManualBaselineForm = z.infer<typeof manualBaselineFormSchema>;
   export type AdminResetPayload = z.infer<typeof adminResetSchema>;
   ```

   The lead-count cap rule (`lead count ≤ all-time-high seen in history`) is enforced at the server route, not the form — needs DB read; see step 2.

2. Author `server/routes/baselines.ts`:

   ```ts
   import { Router } from 'express';
   import { and, eq, sql } from 'drizzle-orm';
   import { authenticate } from '../middleware/auth.js';
   import { requireOrgPermission, ORG_PERMISSIONS } from '../config/orgPermissions.js';
   import { resolveSubaccount } from '../lib/resolveSubaccount.js';
   import { asyncHandler } from '../lib/asyncHandler.js';
   import { db } from '../db/index.js';
   import { subaccountBaselines } from '../db/schema/subaccountBaselines.js';
   import { subaccountBaselineMetrics } from '../db/schema/subaccountBaselineMetrics.js';
   import { canonicalMetricHistory } from '../db/schema/canonicalMetrics.js';
   import { canonicalAccounts } from '../db/schema/canonicalAccounts.js';
   import { captureBaselineService } from '../services/captureBaselineService.js';
   import { manualBaselineFormSchema, adminResetSchema } from '../../shared/schemas/baselineManualForm.js';
   import { metricMeta, type BaselineMetricSlug } from '../../shared/constants/baselineMetrics.js';

   const router = Router();

   /** GET /api/subaccounts/:subaccountId/baseline — status + metrics for client display. */
   router.get(
     '/api/subaccounts/:subaccountId/baseline',
     authenticate,
     requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
     asyncHandler(async (req, res) => {
       const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
       const [baseline] = await db
         .select()
         .from(subaccountBaselines)
         .where(and(
           eq(subaccountBaselines.subaccountId, sa.id),
           eq(subaccountBaselines.organisationId, req.orgId!),
           sql`status <> 'reset'`,
         ));
       if (!baseline) {
         res.json({ status: 'pending', baselineVersion: 1, metrics: [] });
         return;
       }
       const metrics = await db
         .select()
         .from(subaccountBaselineMetrics)
         .where(eq(subaccountBaselineMetrics.baselineId, baseline.id));
       res.json({
         id: baseline.id,
         status: baseline.status,
         baselineVersion: baseline.baselineVersion,
         confidence: baseline.confidence,
         source: baseline.source,
         capturedAt: baseline.capturedAt,
         failureReason: baseline.failureReason,
         metrics: metrics.map((m) => ({
           slug: m.metricSlug,
           value: m.value,
           source: m.source,
           unavailableReason: m.unavailableReason,
         })),
       });
     }),
   );

   /** POST /api/subaccounts/:subaccountId/baseline/manual — manual entry. */
   router.post(
     '/api/subaccounts/:subaccountId/baseline/manual',
     authenticate,
     requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
     asyncHandler(async (req, res) => {
       const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
       const parsed = manualBaselineFormSchema.safeParse(req.body);
       if (!parsed.success) {
         throw { statusCode: 400, errorCode: 'INVALID_BASELINE_INPUT', fieldErrors: parsed.error.flatten().fieldErrors };
       }

       // Server-side validation: lead_count ≤ all-time-high (§6); currency required for cents.
       for (const m of parsed.data.metrics) {
         const meta = metricMeta(m.slug as BaselineMetricSlug);
         if (meta.unit === 'cents' && !m.currency) {
           throw { statusCode: 400, errorCode: 'CURRENCY_REQUIRED', message: `${m.slug} requires currency` };
         }
         if (m.slug === 'lead_count') {
           const [maxRow] = await db
             .select({ max: sql<string>`MAX(${canonicalMetricHistory.value})` })
             .from(canonicalMetricHistory)
             .innerJoin(canonicalAccounts, eq(canonicalAccounts.id, canonicalMetricHistory.accountId))
             .where(and(
               eq(canonicalAccounts.organisationId, req.orgId!),
               eq(canonicalAccounts.subaccountId, sa.id),
               eq(canonicalMetricHistory.metricSlug, 'lead_count'),
             ));
           const cap = maxRow?.max ? Number(maxRow.max) : Infinity;
           if (m.numeric > cap) {
             throw { statusCode: 400, errorCode: 'LEAD_COUNT_EXCEEDS_CAP', message: `lead_count exceeds historical max (${cap})` };
           }
         }
       }

       await captureBaselineService.runManual({
         organisationId: req.orgId!,
         subaccountId: sa.id,
         userId: req.user!.id,
         metricInputs: parsed.data.metrics.map((m) => ({ slug: m.slug as BaselineMetricSlug, numeric: m.numeric, currency: m.currency })),
       });
       res.json({ ok: true });
     }),
   );

   /** POST /api/admin/subaccounts/:subaccountId/baseline/reset — admin reset (sysadmin only). */
   router.post(
     '/api/admin/subaccounts/:subaccountId/baseline/reset',
     authenticate,
     requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_ADMIN),  // confirm exact permission name; sysadmin gating
     asyncHandler(async (req, res) => {
       const sa = await resolveSubaccount(req.params.subaccountId, req.orgId!);
       const parsed = adminResetSchema.safeParse(req.body);
       if (!parsed.success) {
         throw { statusCode: 400, errorCode: 'INVALID_RESET_REASON', fieldErrors: parsed.error.flatten().fieldErrors };
       }
       const result = await captureBaselineService.adminReset({
         organisationId: req.orgId!,
         subaccountId: sa.id,
         userId: req.user!.id,
         reason: parsed.data.reason,
       });
       res.json(result);
     }),
   );

   export default router;
   ```

   Confirm exact permission name (`SUBACCOUNTS_VIEW` / `SUBACCOUNTS_EDIT` / `SUBACCOUNTS_ADMIN`) by reading `server/config/orgPermissions.ts`. Sysadmin gating may use a different mechanism — check `requireOrgPermission` vs `requireSysadmin` or similar.

3. Mount the router. Locate `server/index.ts` (or `server/routes/index.ts`) and add:

   ```ts
   import baselineRoutes from './routes/baselines.js';
   app.use(baselineRoutes);
   ```

4. Author `client/src/components/baseline/BaselineStatusBadge.tsx` — compact, inline, hidden-by-default per CLAUDE.md frontend rules:

   ```tsx
   import { useEffect, useState } from 'react';
   import { api } from '../../lib/api.js';

   /** F3 §6 — inline status pill on the subaccount detail page.
    *  Renders ONLY the dot + status word; no metrics, no charts, no counts.
    */
   export function BaselineStatusBadge({ subaccountId }: { subaccountId: string }) {
     const [status, setStatus] = useState<string | null>(null);
     useEffect(() => {
       api.get(`/api/subaccounts/${subaccountId}/baseline`)
         .then((r) => setStatus(r.data.status))
         .catch(() => setStatus(null));
     }, [subaccountId]);
     if (!status) return null;
     const colorMap: Record<string, string> = {
       pending: 'bg-slate-300',
       ready: 'bg-amber-400',
       capturing: 'bg-blue-400',
       captured: 'bg-emerald-500',
       failed: 'bg-rose-500',
       manual: 'bg-violet-500',
     };
     const labelMap: Record<string, string> = {
       pending: 'Baseline pending',
       ready: 'Capturing soon',
       capturing: 'Capturing',
       captured: 'Baseline captured',
       failed: 'Capture failed',
       manual: 'Baseline (manual)',
     };
     return (
       <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
         <span className={`size-2 rounded-full ${colorMap[status] ?? 'bg-slate-300'}`} />
         {labelMap[status] ?? status}
       </span>
     );
   }
   ```

5. Author `client/src/components/baseline/ManualBaselineForm.tsx` — only rendered when status is `failed` OR `captured` with `confidence='partial'` (CTA on subaccount detail page, wired in 4B):
   - Renders form fields per slug from `V1_BASELINE_METRICS`. Each input is a numeric field; cents-unit slugs render with a currency dropdown defaulting to USD.
   - Submit posts to `/api/subaccounts/:id/baseline/manual`.
   - Validation: numeric ≥ 0 (matches `manualMetricInputSchema`). Server enforces lead-count cap and currency-required-for-cents.
   - States: loading (fetch current values), error (4xx with field errors), submitted ('Saved'), partial-edit (allow leaving some metrics blank — only filled fields are submitted).
   - The component reads the current `/api/subaccounts/:id/baseline` to pre-fill inputs from existing metric rows; user can edit any subset; submit posts only the changed inputs. Error states surface inline (use the existing app's error-display convention — search for `<FormErrorList>` or similar).

6. Author `client/src/components/baseline/AdminBaselineResetButton.tsx` — sysadmin-gated CTA:
   - Renders a destructive button. On click: opens a modal with a textarea ("Why are you resetting?").
   - On submit: POST `/api/admin/subaccounts/:id/baseline/reset` with `{ reason }`.
   - On success: emits a toast + invalidates the parent page's baseline cache.
   - Sysadmin gating happens client-side (component reads `useUser()` and renders null when `!user.isSysadmin`). Server-side enforcement is the source of truth — the server route uses `requireOrgPermission(SUBACCOUNTS_ADMIN)`.

7. **Frontend re-check** per CLAUDE.md `Frontend Design Principles`:
   - Primary task: capture / repair the baseline. ONE task per screen.
   - Default to hidden: no metric dashboard, no KPI grid. The badge shows status only; the form is the recovery surface.
   - Inline state: badge is inline on the existing page, not a dedicated dashboard.
   - Re-check: a non-technical operator should be able to interpret "Capture failed" and click into a form. No jargon in labels; no exposed `unavailable_reason` codes — translate to plain text ("Pipeline value isn't available yet, try again later, or enter manually below"). NO em-dashes (per user preferences).

**Tests:** none for the client components per the spec-context UI testing posture (`frontend_tests: none_for_now`). Server route logic is exercised in Chunk 3C's integration test (manual path) plus Chunk 5's reporting helper test.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Commit:** `feat(baseline): manual entry form + status badge + admin reset button + 3 server routes`

---

## Chunk 4B — `AdminSubaccountDetailPage` wiring

**Goal:** Wire the three new components into the existing `AdminSubaccountDetailPage.tsx`. F1 has already populated `client/src/components/baseline/` with `EditArtefactDrawer.tsx` and `BaselineArtefactsStatusBadge.tsx` — add the F3 components alongside.

**Phase:** 4

**Files:**
- modify: `client/src/pages/AdminSubaccountDetailPage.tsx`

**Steps:**

1. Read the existing page to find the natural mount point. F1 wired `BaselineArtefactsStatusBadge` to the Knowledge tab; F3's `BaselineStatusBadge` is a different signal (data baseline vs artefact wizard) — they coexist on the page header.

2. Add to the page header / overview section:
   - `<BaselineStatusBadge subaccountId={sa.id} />` next to the existing artefact badge.
   - Conditional render of `<ManualBaselineForm subaccountId={sa.id} />` when the GET `/api/subaccounts/:id/baseline` returns `status='failed'` OR (`status='captured' AND confidence='partial'`). Hide otherwise.
   - `<AdminBaselineResetButton subaccountId={sa.id} />` rendered in the admin actions area (the F1 plan called this "sysadmin-gated"; mirror that pattern).

3. Wire data fetching — use the existing `useQuery` / data-loading hook the page already uses (search the page for `useQuery` or `useEffect(() => api.get`). Cache key: `['baseline', subaccountId]`. Invalidate on form submission and admin reset.

4. **CTA copy:** when status='failed' show "We couldn't capture the baseline automatically. You can enter values manually." When `confidence='partial'` show "Some metrics weren't available. Add them manually below." No emojis (per user preferences). No em-dashes (per user preferences) — use commas.

5. **Frontend re-check:** the page already has multiple panels (per F1's wiring). F3 adds ONE badge + ONE conditionally-rendered form + ONE admin action. Does this push past the "≥2 primary actions = split" rule? The form appears only on failure recovery (rare path); it's not a primary action competing for attention. Admin reset is a destructive admin-only action and lives in the admin area. Decision: ship as one section.

**Tests:** none.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Commit:** `feat(baseline): wire status badge, manual form, admin reset into AdminSubaccountDetailPage`

> Chunks 4A and 4B ship together in one PR.

---

## Chunk 5 — Reporting Agent delta integration

**Goal:** Author `getBaselineForSubaccount(subaccountId)` helper in `server/services/reportingAgent/baselineHelper.ts`. Extend `executeGeneratePortfolioReport` in `server/services/intelligenceSkillExecutor.ts` to compute delta per metric per sub-account and include "Since onboarding" sections. Honest-gap narration when a metric was unavailable at baseline.

**Phase:** 5

**Files:**
- create: `server/services/reportingAgent/baselineHelper.ts`
- modify: `server/services/intelligenceSkillExecutor.ts` (extend `executeGeneratePortfolioReport`)
- create: `server/services/reportingAgent/__tests__/baselineHelper.test.ts`

**Steps:**

1. Author `server/services/reportingAgent/baselineHelper.ts`:

   ```ts
   import { and, eq, sql } from 'drizzle-orm';
   import { db } from '../../db/index.js';
   import { subaccountBaselines } from '../../db/schema/subaccountBaselines.js';
   import { subaccountBaselineMetrics } from '../../db/schema/subaccountBaselineMetrics.js';
   import type { BaselineMetricSlug } from '../../../shared/constants/baselineMetrics.js';

   export interface BaselineSnapshot {
     id: string;
     subaccountId: string;
     baselineVersion: number;
     status: 'captured' | 'manual';
     source: 'auto' | 'manual' | 'mixed';
     confidence: 'confirmed' | 'estimated' | 'partial';
     capturedAt: Date;
     metrics: Array<{
       slug: BaselineMetricSlug;
       value: { numeric: number; currency?: string; unit: string } | null;
       source: 'canonical_metric' | 'manual' | 'unavailable';
       unavailableReason?: string;
     }>;
   }

   /**
    * F3 §7 — read the active captured baseline for a subaccount. Returns null
    * when no captured/manual baseline exists (status='pending'|'ready'|'capturing'|'failed'|'reset').
    *
    * Pure read. Idempotent. No mutations.
    */
   export async function getBaselineForSubaccount(
     organisationId: string,
     subaccountId: string,
   ): Promise<BaselineSnapshot | null> {
     const [baseline] = await db
       .select()
       .from(subaccountBaselines)
       .where(and(
         eq(subaccountBaselines.organisationId, organisationId),
         eq(subaccountBaselines.subaccountId, subaccountId),
         sql`status IN ('captured', 'manual')`,
       ));
     if (!baseline) return null;

     const metrics = await db
       .select()
       .from(subaccountBaselineMetrics)
       .where(eq(subaccountBaselineMetrics.baselineId, baseline.id));

     return {
       id: baseline.id,
       subaccountId: baseline.subaccountId,
       baselineVersion: baseline.baselineVersion,
       status: baseline.status as 'captured' | 'manual',
       source: baseline.source,
       confidence: baseline.confidence,
       capturedAt: baseline.capturedAt!,
       metrics: metrics.map((m) => ({
         slug: m.metricSlug as BaselineMetricSlug,
         value: m.value,
         source: m.source,
         unavailableReason: m.unavailableReason ?? undefined,
       })),
     };
   }

   /**
    * F3 §7 — compute delta between current value and baseline value.
    * Pure function. Returns null delta/pct when baseline metric was unavailable
    * (caller emits "first measurement is today's value" narration).
    */
   export interface MetricDelta {
     slug: BaselineMetricSlug;
     baselineValue: number | null;
     currentValue: number;
     delta: number | null;
     pct: number | null;
     unavailableAtBaseline: boolean;
   }

   export function computeDelta(
     baselineSnapshot: BaselineSnapshot | null,
     currentMetrics: Array<{ slug: BaselineMetricSlug; numeric: number }>,
   ): MetricDelta[] {
     return currentMetrics.map((cur) => {
       const b = baselineSnapshot?.metrics.find((m) => m.slug === cur.slug);
       if (!b || !b.value || b.source === 'unavailable') {
         return {
           slug: cur.slug,
           baselineValue: null,
           currentValue: cur.numeric,
           delta: null,
           pct: null,
           unavailableAtBaseline: true,
         };
       }
       const delta = cur.numeric - b.value.numeric;
       const pct = b.value.numeric === 0 ? null : (delta / b.value.numeric) * 100;
       return {
         slug: cur.slug,
         baselineValue: b.value.numeric,
         currentValue: cur.numeric,
         delta,
         pct,
         unavailableAtBaseline: false,
       };
     });
   }
   ```

2. Modify `server/services/intelligenceSkillExecutor.ts` `executeGeneratePortfolioReport` (around line 636). After collecting `accountHealthData`, add a per-account baseline delta loop. For each account whose `subaccount_id` is non-null:

   ```ts
   // F3 §7 — baseline delta narration.
   const baselineDeltasBySubaccount: Map<string, MetricDelta[]> = new Map();
   for (const account of accounts) {
     if (!account.subaccountId) continue;
     const baseline = await getBaselineForSubaccount(context.organisationId, account.subaccountId);
     if (!baseline) {
       baselineDeltasBySubaccount.set(account.subaccountId, []);
       continue;
     }
     // Read current values from canonical_metrics for the same slugs.
     const current = await canonicalDataService.getCurrentMetricsForAccount(principal, account.id);
     const currentNumeric = current
       .filter((m) => isBaselineMetricSlug(m.slug))
       .map((m) => ({ slug: m.slug as BaselineMetricSlug, numeric: Number(m.currentValue) }));
     baselineDeltasBySubaccount.set(account.subaccountId, computeDelta(baseline, currentNumeric));
   }
   ```

   Add a `sinceOnboarding` field per account in the returned report payload:

   ```ts
   accountsRequiringAttention: declining.map(a => ({
     // ...existing fields...
     sinceOnboarding: a.subaccountId ? baselineDeltasBySubaccount.get(a.subaccountId) ?? [] : null,
   })),
   ```

   The Reporting Agent's narration template renders these deltas as "Pipeline +$63k (+32%); leads +47 (+19%)" — implement in the existing report-rendering pipeline (locate via `Grep` for the report formatter; if narration is downstream of this skill, the JSON shape above is the contract and the template is updated separately — confirm at build start).

   Imports to add at the top:

   ```ts
   import { getBaselineForSubaccount, computeDelta, type MetricDelta } from './reportingAgent/baselineHelper.js';
   import { isBaselineMetricSlug, type BaselineMetricSlug } from '../../shared/constants/baselineMetrics.js';
   ```

   Confirm `canonicalDataService.getCurrentMetricsForAccount` exists or use the equivalent existing helper.

3. Author `server/services/reportingAgent/__tests__/baselineHelper.test.ts`:
   - `computeDelta` with full baseline (all 5 v1 metrics canonical) → 5 deltas with non-null values.
   - `computeDelta` with partial baseline (3 captured, 2 unavailable) → 5 results; 2 have `unavailableAtBaseline: true, baselineValue: null`.
   - `computeDelta` when baseline is null → all entries `unavailableAtBaseline: true`.
   - `computeDelta` when baseline value is 0 → `pct: null` (division-by-zero guard).
   - `computeDelta` when current value < baseline → negative delta + negative pct.
   - `getBaselineForSubaccount` with no captured baseline (status='pending' or 'failed') → null.
   - `getBaselineForSubaccount` with `status='reset'` → null (reset rows excluded by the `IN ('captured','manual')` filter).
   - `getBaselineForSubaccount` with `status='captured'` + 5 metric rows → snapshot with metrics array of length 5.
   - `getBaselineForSubaccount` with `status='manual'` (operator-set) → snapshot returned (manual is a valid retrieval state).

**Tests:** as in step 3.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/reportingAgent/__tests__/baselineHelper.test.ts`

**Commit:** `feat(baseline): reporting agent baseline helper + portfolio report delta narration`

---

## Chunk 6 — Closeout: capability docs + manual verification + progress note

**Goal:** Hand-verify the end-to-end flow against a fresh sub-account. Update `docs/capabilities.md` to describe the baseline + delta narration. Update `docs/clientpulse-dev-spec.md` Item 1. Close out `tasks/builds/baseline-capture/progress.md`. Append closing entry to `KNOWLEDGE.md`.

**Phase:** 6

**Files:**
- modify: `docs/capabilities.md`
- modify: `docs/clientpulse-dev-spec.md`
- modify: `tasks/builds/baseline-capture/progress.md`
- modify: `KNOWLEDGE.md`

**Steps:**

1. Manual verification:
   - Create a fresh sub-account with a GHL connector.
   - Wait for two successful poll cycles (or trigger manually if polling is paused in dev — verify `connector_configs.successful_poll_count_total >= 2` and `first_qualifying_poll_at` >= 1h ago).
   - Confirm `subaccount_baselines` row exists with `status='pending'` (created at sub-account creation).
   - Confirm subscriber transitions to capture: row goes `pending → capturing → captured`.
   - Inspect `subaccount_baseline_metrics`: 11 rows (5 canonical + 6 unavailable).
   - Open admin subaccount detail page; observe `<BaselineStatusBadge>` shows "Baseline captured".
   - Verify Reporting Agent's portfolio report includes "Since onboarding" delta sections.
   - Trigger admin reset; confirm prior row → `status='reset'` and new pending row with `baseline_version=2`.

2. `docs/capabilities.md`:
   - Add a Reporting capability entry describing baseline + delta narration. Vendor-neutral, present-tense for shipped capability. NO em-dashes; use commas/colons.
   - Example: "When a sub-account becomes ready (one connected integration with two stable poll cycles), Automation OS captures a baseline snapshot of opening-state metrics. The Reporting Agent uses this baseline to narrate change since onboarding in portfolio reports, with honest gaps for metrics not yet available."

3. `docs/clientpulse-dev-spec.md`:
   - Locate Item 1 (baseline capture). Mark it as addressed by F3 with a pointer to `docs/baseline-capture-spec.md` and the migration numbers (0278, 0279, 0280).

4. `tasks/builds/baseline-capture/progress.md`:
   - Chunk-by-chunk closeout: chunk number, completion date, commit SHA, PR link.
   - Note any deviations from this plan and why.
   - Note any deferred items in `## Deferred Items` (for example: if the integration test in Chunk 3C couldn't run via `npx tsx` and deferred to CI).

5. `KNOWLEDGE.md` — append a single closing entry:
   > **F3 Baseline Capture (2026-05-XX).** Migrations 0278/0279/0280 introduced `subaccount_baselines` (per-subaccount opening-state snapshot) and `subaccount_baseline_metrics` (per-metric values) plus full RLS. The partial UNIQUE index on `subaccount_baselines(subaccount_id) WHERE status <> 'reset'` enforces the §10 invariant "exactly one active baseline per sub-account" — admin reset transitions the prior row to `status='reset'` and inserts a new `pending` with `baseline_version+1`, all in one transaction. Single-writer rule: `captureBaselineService` is the only writer of `subaccount_baselines.status` after the initial `pending` insert. Reporting Agent's portfolio report includes "Since onboarding" delta narration via `getBaselineForSubaccount`.

**Tests:** None added in chunk 6 (closeout). Manual verification is the gate; CI runs the full suite on the PR.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

**Commit:** `docs(baseline): capabilities + clientpulse spec + KNOWLEDGE close-out F3`

---

## Risks and mitigations

### R1 — Readiness condition too strict

The "≥2 of 4 core metrics non-null" gate may be too high for sub-accounts with sparse early activity (a brand-new agency with one client and three contacts).

- **Mitigation:** the spec's `confidence` field already covers this — when fewer slugs return canonical, the row captures with `confidence='partial'`. Operators can recover via `<ManualBaselineForm>`. If even 2 of 4 is too strict in production, lower the threshold to 1 + `confidence='estimated'` in a follow-up PR; the fix is one constant in `baselineReadinessService.evaluate`.

### R2 — Readiness condition too lax — capture before settle

The 1h settle window may not be enough for slow-back-filling integrations.

- **Mitigation:** Chunk 2A test asserts the boundary (59 min vs 60 min). If production data shows premature capture, the window is one constant change. Cron fallback re-evaluates daily — even if the first capture is partial, the operator sees the partial state and can edit manually OR admin-reset to retry once data has settled.

### R3 — `connector_configs.successful_poll_count_total` race on retry

If the polling service retries (pg-boss) and the counter has already been incremented, the count could drift higher than the number of distinct logical syncs. Per the existing `pollRunId` contract in `connectorPollingService.ts`, retries reuse the same `pollRunId` — so a retry of a successful sync should not double-bump.

- **Mitigation:** Chunk 2B step 2 places the counter bump INSIDE the `if (syncStatus === 'success')` block which runs once per logical sync. pg-boss retries on transport-level failure happen before the `syncStatus` is computed, so the counter sees only logical-success increments. Document the invariant in a comment at the bump site.
- **Residual:** if a logical sync succeeds and crashes between the counter UPDATE and the `lastSyncStatus` update, on next pg-boss attempt the same logical sync runs again; the counter bumps a second time. This drift is bounded (1-2 over the entire connector lifetime). Acceptable for a "≥2 polls" threshold.

### R4 — Single-writer static check is grep-based

The Chunk 3C invariant 3 grep can be defeated by deeper indirection. Realistic threat: low — no developer reviewing this codebase would intentionally bypass; the check catches the easy mistakes.

- **Mitigation (tightened):** Chunk 3C invariant 3 now greps three patterns — raw SQL writes, direct Drizzle calls, AND the trailing `subaccountBaselines)` paren form. The third pattern catches the trivial alias case (`const sb = subaccountBaselines; tx.update(sb)` is still a miss; `tx.update(subaccountBaselines)` is caught even when the prefix isn't `db.`). Read sites (`select().from(subaccountBaselines)`) are explicitly filtered out to keep the signal high. Pair with a DEVELOPMENT_GUIDELINES note (Chunk 6 docs): "writes to subaccount_baselines must go through captureBaselineService."
- **Residual:** deep indirection (e.g. dynamic table-name dispatch, function-returning-table-reference) still defeats the static check. If that pattern ever appears, the runtime invariant — exactly one row per sub-account, idempotent retry — still holds at the DB level via the partial UNIQUE index and the ON CONFLICT writes.

### R5 — Manual entry abuse — operator inflates baseline

An operator could set unrealistic baseline values to inflate later "delta" narration in client-facing reports.

- **Mitigation:** §6 validation (`numeric ≥ 0`, `lead_count ≤ all-time-high`) is a guardrail. Audit trail: every manual write emits `baseline.manual.applied` with `user_id` and `metrics_overridden[]`. Reporting Agent narration includes `source` ('manual' | 'mixed' | 'auto'); reports rendered against a manual baseline carry an inline disclaimer (template extension; out of scope for this plan but documented in Chunk 5 step 2 commit message as a follow-up).

### R6 — Admin reset destroys history (regression risk)

If a future PR adds `ON DELETE CASCADE` from `subaccounts → subaccount_baselines` differently (or someone changes the reset transaction to `DELETE` instead of `UPDATE … SET status='reset'`), history is lost.

- **Mitigation:** Chunk 3C invariant 5 asserts that after reset, the prior row exists with `status='reset' AND admin_reset_reason IS NOT NULL`. Any future change to the reset path will fail this test. CI enforces.

### R7 — Schema drift on parallel branches

F1 has merged. F2 (sub-account-optimiser Phases 1-4) is independent of F3 — F2 phase 0 already shipped. No conflict expected, but a defensive rebase before opening F3's PR is prudent.

- **Mitigation:** before Chunk 1A, `git fetch && git rebase main`. If F2 lands a new migration ahead of F3, re-allocate F3's migration numbers. Per executor notes: pre-flight migration check at every schema phase.

### R8 — `revenue` slug mismatch between F3 readers and existing GHL/Stripe ingestion (RESOLVED — build-blocking pre-check)

The reader in Chunk 3B step 4 assumes `metric_slug='revenue'` in `canonical_metric_history`. If the existing ingestion writes a different slug, the reader returns `unavailable / no_data_yet` and the baseline stays in `partial` indefinitely.

- **Resolution:** promoted from soft-risk to **build-blocking pre-check** in Chunk 3B step 0. The executor MUST grep `canonicalDataService.ts` and integration adapters for the actual revenue slug before authoring the reader. The decision tree (slug found / slug differs / no slug at all) is fully specified, and step 7 of the same chunk re-asserts the gate so the executor cannot silently skip it. No "default assumption" path is permitted.
- **Residual:** none if the pre-check is run. If somehow skipped, the reader still degrades safely to `unavailable / no_data_yet / retryable` and surfaces a permanently-partial baseline that the operator can recover via `<ManualBaselineForm>`.

### R9 — `successful_poll_count_total` initial value for pre-F3 connectors

Connectors that exist on main before F3 deploys have `successful_poll_count_total=0` and `first_qualifying_poll_at=null` (the migration default). On their next successful poll, the counter goes 0 → 1 and `first_qualifying_poll_at` is set to "now". The subaccount won't qualify for capture for at least 1 more poll cycle + 1h settle.

- **Mitigation:** acceptable behaviour — the post-F3 first-eligibility window is bounded by one poll interval (default 60min) + 1h. Document in Chunk 6 progress note. Optionally, the migration could backfill from `connector_configs.last_sync_status='success'` snapshots; rejected as scope creep — natural settle is fine.

### R10 — Frontend forms are non-verifiable work

Per CLAUDE.md `Verifiability heuristic`, the manual-entry form's UX (validation timing, error display, currency dropdown placement) is non-verifiable agent work.

- **Mitigation:** Chunk 4A and 4B should NOT be subagent-driven overnight. Sit with the form, click through, iterate visually before opening the PR.

### R11 — Slow per-metric reader stalls capture

A canonical_metrics scan against a large org or a downstream-DB hiccup could keep one reader hanging well past a reasonable budget, blocking sibling readers and the entire capture.

- **Mitigation:** each reader call in `captureBaselineService.run` is wrapped in `withTimeout(reader(...), 5_000)` (Chunk 3A). Timeout is classified as `api_failure / retryable` so the cron retries with backoff. Sibling readers continue independently. The new `duration_ms` telemetry on terminal events (architecture note §13) surfaces slow readers in dashboards before they become user-visible delay.

### R12 — Manual override race against auto capture

Between the manual route's pre-check (`baseline.status !== 'capturing'`) and the final UPDATE, the auto path could acquire the lock — leaving the manual write half-applied.

- **Mitigation:** the final UPDATE in `runManual` predicates on `status <> 'capturing'` and uses RETURNING; zero rows means the auto path won the race, and the route surfaces 409 to the operator. The metric upserts themselves are idempotent (PK + ON CONFLICT), so a partial pre-empt leaves no orphaned writes — the auto path overwrites them on its own ON CONFLICT pass. Tested in Chunk 3C invariant 4.

### R13 — Wall-clock drift in readiness comparisons

The settle-window check (`now() - first_qualifying_poll_at >= 1h`) was previously evaluated in JS via `Date.now() - earliest.getTime()`. Application servers in different time zones / with NTP drift could give different answers for the same row.

- **Mitigation (resolved):** comparison pushed entirely into Postgres (`sql\`(... is not null and now() - ... >= interval '1 hour')\``) — application code receives a boolean. DB-time invariant §6 strengthened: zero `Date.now()` calls anywhere in the F3 capture surface. Static grep enforced in Chunk 3C invariant 6.

---

## Self-consistency pass — coverage check against spec §10 Done definition

| §10 functional outcome | Covered by chunk(s) | Asserted by |
|---|---|---|
| New sub-account creates a `pending` baseline row at creation | 2A (markBaselinePending + route hook) | Chunk 2A test (insert idempotency); manual verification in Chunk 6 |
| Readiness condition transitions `pending → ready` on second poll + 1h settle (or daily fallback) | 2A (readiness service), 2B (subscriber + cron) | `baselineReadinessService.test.ts` boundary cases |
| Capture job writes baseline metric rows for all available canonical metrics | 3A (capture service), 3B (per-metric readers) | `captureBaselineIntegration.test.ts` (Chunk 3C) |
| Retry classifies retryable vs non-retryable correctly; non-retryable transitions straight to `failed` without consuming budget | 1C (classifier), 3A (aggregator) | `baselineRetryClassifierPure.test.ts` |
| Failed baselines surface for manual entry | 4A (`<ManualBaselineForm>` CTA wired on status='failed') | Manual verification in Chunk 6 |
| Manual entry round-trips correctly (writes individual metric rows, updates source + confidence) | 3A (`runManual`), 4A (route + form) | Chunk 3C invariant 4 |
| Admin reset preserves history (creates new with version+1, doesn't delete old) | 3A (`adminReset` transaction), 1A (UNIQUE index) | Chunk 3C invariant 1b + 5 |
| Reporting Agent's portfolio report includes "Since onboarding" delta sections | 5 (helper + skill extension) | `baselineHelper.test.ts` |
| All 9 telemetry events from §6a emit at correct state transitions | 2B (registry), 2B/3A/4A (emit sites) | Compile-time event-name registry; `captureBaselineIntegration.test.ts` event capture |

| §10 hard invariant | Covered by chunk(s) | Test assertion |
|---|---|---|
| Exactly one active baseline per sub-account | 1A (partial UNIQUE index), 3A (admin reset transaction) | `baselineInvariants.test.ts` invariants 1, 1b, 1c |
| Idempotent retry — calling `run` twice produces same row state | 3A (lock acquire + ON CONFLICT) | `baselineInvariants.test.ts` invariant 2 |
| Single-writer rule honoured (grep-based static check) | 3A (one writer service), 2A (one initial insert site) | `baselineInvariants.test.ts` invariant 3 |
| Manual override never conflicts with auto capture | 3A (capturing-status guard + 409) | `baselineInvariants.test.ts` invariant 4 |
| Admin reset never destroys history | 3A (adminReset is UPDATE+INSERT, not DELETE) | `baselineInvariants.test.ts` invariant 5 |
| All timestamps via Postgres `now()` (grep-based) | 1A (column defaults), 3A/3B (sql\`now()\` in writers) | `baselineInvariants.test.ts` invariant 6 |

Every §10 functional outcome and hard invariant is mapped to at least one chunk and one assertion. Goals align with implementation. The single-writer rule is asserted both at runtime (one service throws on improper state) and at static-check time (grep over `server/`).

---

## File inventory cross-check vs spec §9

Spec §9 lists these files; this plan covers each:

### Server

| Spec §9 file | Plan chunk | Notes |
|---|---|---|
| `server/db/schema/subaccountBaselines.ts` | 1A | New |
| `server/db/schema/subaccountBaselineMetrics.ts` | 1A | New |
| `server/db/rlsProtectedTables.ts` | 1B | Two entries appended (note: actual path is `server/config/rlsProtectedTables.ts`) |
| `server/db/canonicalDictionary.ts` | 1B | Two entries appended (note: actual path is `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`) |
| `server/services/baselineReadinessService.ts` | 2A | New |
| `server/services/captureBaselineService.ts` | 3A | New |
| `server/services/baselineMetricReaders/*.ts` | 3A (registry), 3B (5 readers + populated registry) | One file per available v1 metric |
| `server/services/connectorPollingService.ts` | 2B | Event emit + counter bumps |
| `server/services/subaccountOnboardingService.ts` | 2A | ADD `markBaselinePending` (do not modify F1 methods) |
| `server/services/reportingAgent/baselineHelper.ts` | 5 | New |
| `server/routes/subaccounts.ts` | 2A | Hook insert (manual-entry route is in `server/routes/baselines.ts`) |
| `server/routes/admin/baselineReset.ts` | 4A | Mounted at `/api/admin/subaccounts/:subaccountId/baseline/reset` inside `server/routes/baselines.ts` rather than a sibling file (route file is small enough to share) |
| `server/jobs/captureBaselineJob.ts` | 3A | New |
| `server/jobs/evaluateAllPendingBaselines.ts` | 2B | New |
| `server/lib/tracing.ts` | 2B | 9 §6a events + `connector.sync.complete` |

### Shared

| Spec §9 file | Plan chunk | Notes |
|---|---|---|
| `shared/schemas/subaccount.ts` (extend) | 1B | EXTEND F1's existing file with `subaccountSettingsSchema` + `resolveBaselineOptIn`; do NOT modify F1's `baselineArtefactsStatusSchema` |
| `shared/constants/baselineMetrics.ts` | 1B | New — v1 slug list + units |

### Client

| Spec §9 file | Plan chunk | Notes |
|---|---|---|
| `client/src/components/baseline/ManualBaselineForm.tsx` | 4A | New (sibling of F1's `EditArtefactDrawer.tsx`) |
| `client/src/components/baseline/BaselineStatusBadge.tsx` | 4A | New (sibling of F1's `BaselineArtefactsStatusBadge.tsx` — different concept) |
| `client/src/components/baseline/AdminBaselineResetButton.tsx` | 4A | New |
| `client/src/pages/SubaccountDetailPage.tsx` | 4B | The actual file is `client/src/pages/AdminSubaccountDetailPage.tsx` — spec §9 used the conceptual name; the plan targets the real one |

### Tests

| Spec §9 test file | Plan chunk |
|---|---|
| `server/services/__tests__/baselineReadinessService.test.ts` | 2A |
| `server/services/__tests__/captureBaselineService.test.ts` | 3A (`captureBaselineServicePure.test.ts`) + 3C (`captureBaselineIntegration.test.ts`) — split into pure + integration |
| `server/services/__tests__/baselineMetricReaders.test.ts` | 3B |
| `server/services/reportingAgent/__tests__/baselineHelper.test.ts` | 5 |
| `server/services/__tests__/baselineInvariants.test.ts` | 3C |

Additional test files this plan introduces beyond spec §9 (all pure, all run via `npx tsx`):
- `server/services/__tests__/baselineStateMachinePure.test.ts` (Chunk 1C)
- `server/services/__tests__/baselineRetryClassifierPure.test.ts` (Chunk 1C)
- `shared/constants/__tests__/baselineMetrics.test.ts` (Chunk 1C)
- `shared/schemas/__tests__/subaccountSettings.test.ts` (Chunk 1C)
- `server/services/__tests__/baselineSubscriberPure.test.ts` (Chunk 2B)

### Docs (Chunk 6 closeout)

| Spec §9 doc | Plan chunk |
|---|---|
| `docs/capabilities.md` | 6 |
| `docs/clientpulse-dev-spec.md` | 6 |

Spec §9 deferred items: none. The §10 done definition is fully covered.

---

## Deferred Items

None at plan time. If any of the following surface during implementation, document in `tasks/builds/baseline-capture/progress.md` under `## Deferred Items` rather than expanding this plan:

- The `revenue` slug mismatch in Chunk 3B — if the actual slug differs from `revenue`, document the canonical name and adjust the reader.
- The `canonicalDataService.getCurrentMetricsForAccount` helper in Chunk 5 step 2 — if no existing helper has that exact shape, document the substitute used.
- Reporting Agent narration template extension — Chunk 5 step 2 lays the data shape; the rendering template lives in a downstream prompt-assembly path. If the template changes need broader review, document and route to a follow-up PR.
- Inline disclaimer for manual-source baselines in client-facing reports — out of scope for F3 v1 but flagged in Risk R5.

---

## Sign-off

Plan ready for execution on Sonnet via `superpowers:subagent-driven-development`. Each chunk is independently buildable; chunks 4A and 4B ship together in one PR per the executor-notes rule. Chunk 3C contains the §10 hard-invariant tests — these tests are AUTHORED in this build and have NOT been run yet at plan time.
