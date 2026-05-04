# Baseline Capture at Sub-Account Onboarding — Dev Spec

**Status:** DRAFT — pending `spec-reviewer`. **GHL Module C OAuth blocker resolved via PR #254 (merged 2026-05-03); F3 is now unblocked.**
**Last reviewed against main:** 2026-05-04 (post-merge of Workflows v1 Phase 2 / PR #258)
**Build slug:** `baseline-capture`
**Branch:** `claude/baseline-capture`
**Migrations claimed:** `0278`, `0279`, `0280` (was `0268-0270`; reallocated after main consumed those numbers — Module C took 0268 + 0269, Workflows v1 took 0270, agentic commerce took 0271, then 0272-0276 for related work)
**Concurrent peers:** F1 `subaccount-artefacts` (migration `0277` — must land first because both extend `subaccountOnboardingService.ts` and `subaccounts` table area), F2 `subaccount-optimiser` (Phase 0 / migration 0267 SHIPPED on main; Phases 1-4 pending — fully independent)
**Related code:** `server/services/canonicalDataService.ts`, `server/services/connectorPollingService.ts`, `server/services/intelligenceSkillExecutor.ts`, `server/adapters/ghlAdapter.ts`, `server/services/subaccountOnboardingService.ts`, `server/routes/subaccounts.ts`, `server/db/schema/canonicalMetrics.ts`, `server/db/schema/connectorLocationTokens.ts` (NEW post-Module-C), `client/src/pages/SubaccountDetailPage.tsx`
**Related specs:** `docs/clientpulse-dev-spec.md`, `docs/clientpulse-ghl-dev-brief.md`, `docs/clientpulse-soft-launch-blockers-brief.md`, `docs/canonical-data-platform-p1-p2-p3-impl.md`, `docs/ghl-module-c-oauth-spec.md` (upstream — now shipped)

---

## Goal

When a new sub-account becomes ready (defined: at least one connected integration has produced ≥2 stable polls' worth of canonical data), capture an immutable baseline snapshot of its operating metrics. The Reporting Agent uses this baseline to narrate month-over-month delta later.

## Non-goals

- Not a recurring snapshot. Baseline is a single point-in-time capture per sub-account, with admin-gated reset for re-baselining.
- Not full historical backfill. Baseline = T0 only. The full time series lives in `canonical_metric_history` (already shipped).
- Not a manual-entry-only tool. Manual entry is the fallback for unsupported integrations.

## Sections

- §1 What's already shipped (decision context)
- §2 Capturable metrics for v1
- §3 Storage model — new tables 0268-0270
- §4 Readiness condition + capture trigger
- §5 Capture flow + retry logic
- §6 Manual-entry path
- §7 Reporting Agent integration (delta semantics)
- §8 Build chunks
  - Phase 1 — Schema (3 tables, migrations 0278-0280)
  - Phase 2 — Readiness condition + sync-complete event
  - Phase 3 — Capture service + retry/failure handling
  - Phase 4 — Manual entry UI + admin reset
  - Phase 5 — Reporting Agent delta integration
  - Phase 6 — Verification
- §9 Files touched
- §10 Done definition
- §11 Dependencies + GHL OAuth caveat
- §12 Risks
- §13 Concurrent-build hygiene

---

## §1 What's already shipped (decision context)

| Component | Status | File |
|-----------|--------|------|
| `canonical_metrics` (latest snapshots) | Shipped, actively written | `server/db/schema/canonicalMetrics.ts:15-56`; `canonicalDataService.ts:442-465` |
| `canonical_metric_history` (append-only) | Shipped, actively written | `canonicalMetrics.ts:62-102`; `canonicalDataService.ts:466-486` |
| GHL adapter ingestion (contacts, opportunities, conversations, payments) | Shipped, real `axios` calls | `server/adapters/ghlAdapter.ts:130-226` |
| Connector polling | Shipped | `server/services/connectorPollingService.ts` |
| Health snapshot writes (`client_pulse_health_snapshots`) | Shipped, actively written | `intelligenceSkillExecutor.ts:372` (migration 0173) |
| Churn assessment writes (`client_pulse_churn_assessments`) | Shipped, actively written | `intelligenceSkillExecutor.ts:584` (migration 0174) |
| Sub-account creation hook (`autoStartOwedOnboardingWorkflows`) | Shipped | `server/routes/subaccounts.ts:121-150` — repurposable as the baseline capture trigger insertion point |
| GHL Module C OAuth (agency-level) | **SHIPPED via PR #254** | `server/routes/ghl.ts` is now production. Agency-level OAuth + sub-account auto-enrol + per-location token cache (`connector_location_tokens`, migration 0269) all live on main. F3 baseline capture works at-scale across every location auto-enrolled by Module C. |
| `system_monitor_baselines` | Shipped — but **infrastructure-only** (latency p50/p95/p99), unrelated to client business baselines | `server/db/schema/systemMonitorBaselines.ts` |

What's NOT shipped that this spec needs:
- A baseline snapshot table with write-once + admin-reset semantics
- A "first sync complete + ready" event hook
- A readiness condition evaluator
- A manual entry UI for the failure / unsupported-integration case
- Reporting Agent delta computation against baseline

## §2 Capturable metrics for v1

Based on which integrations actually ingest data today.

| Metric | Source | Status | Unit |
|--------|--------|--------|------|
| Pipeline value | GHL opportunities | ✅ Capturable today | currency cents |
| Open opportunity count | GHL opportunities | ✅ | count |
| Lead/contact count | GHL contacts | ✅ | count |
| Conversation engagement (last-30d count) | GHL conversations | ✅ | count |
| Revenue (last-30d Stripe payments) | Stripe partial adapter | ✅ | currency cents |
| GMB rank | Google Business Profile | ❌ no adapter | n/a |
| Review count + avg rating | Google Business Profile | ❌ no adapter | n/a |
| Email/SMS volume + deliverability | Mailgun/Twilio | ❌ no adapters | n/a |
| MRR | Stripe (formula) | ⚠️ partial — Stripe adapter reads payments but no MRR formula | currency cents |
| Customer count | Stripe customers list | ⚠️ partial | count |
| Churn rate | Stripe (derived) | ⚠️ requires history; v1 captures point-in-time customer count and computes churn from delta later | percent |

For each unsupported metric, baseline records a "not captured — integration not connected" entry rather than missing the row entirely. This drives the manual-entry UI (§6) and the Reporting Agent's "what we know vs. what we don't" narration.

Configurable per sub-account via `subaccount_settings.baseline_metrics_opt_in[]` — agency operator can disable specific metrics if not relevant to that client.

## §3 Storage model — new tables 0278-0280

### Migration 0278 — `subaccount_baselines`

```sql
CREATE TABLE subaccount_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
  baseline_version INTEGER NOT NULL DEFAULT 1,  -- bumps on admin-reset; preserves history
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'capturing', 'captured', 'failed', 'manual', 'reset')),
  capture_attempt_count SMALLINT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,                  -- set on every retry; backoff anchor
  ready_at TIMESTAMPTZ,                          -- when readiness condition was first met
  captured_at TIMESTAMPTZ,                       -- immutable once set; set during capture transition
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'mixed')) DEFAULT 'auto',
  confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'estimated', 'partial')) DEFAULT 'partial',
  failure_reason TEXT,                           -- terminal-failure category (see §5.4 retry classification)
  admin_reset_reason TEXT,
  reset_at TIMESTAMPTZ,
  reset_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency invariant: only ONE active (non-reset) baseline per (subaccount, version).
-- A reset bumps baseline_version and writes a new row; the prior row's status transitions to 'reset'.
-- This UNIQUE prevents duplicate writes across the four-writer surface (subscriber, fallback job,
-- retry, manual entry) — see §5.2 single-writer rule.
CREATE UNIQUE INDEX subaccount_baselines_active_uniq
  ON subaccount_baselines(subaccount_id, baseline_version)
  WHERE status <> 'reset';

CREATE INDEX subaccount_baselines_status_idx ON subaccount_baselines(organisation_id, status);
CREATE INDEX subaccount_baselines_pending_retry_idx
  ON subaccount_baselines(last_attempt_at)
  WHERE status IN ('ready', 'failed') AND capture_attempt_count > 0;
```

**Timestamp invariant.** Every TIMESTAMPTZ in this schema is set by Postgres `now()` / `transaction_timestamp()` — never by application-level `Date.now()`. This guarantees deterministic ordering for month-over-month comparisons, retry anchoring, and reporting-agent delta narration. Enforce in services: every INSERT / UPDATE that sets a timestamp column SHOULD use `sql\`now()\`` (Drizzle) or omit the field and rely on the column default.

### Migration 0279 — `subaccount_baseline_metrics`

```sql
CREATE TABLE subaccount_baseline_metrics (
  baseline_id UUID NOT NULL REFERENCES subaccount_baselines(id) ON DELETE CASCADE,
  metric_slug TEXT NOT NULL,
  value JSONB NOT NULL,                    -- { numeric: 47000, currency: 'USD', unit: 'cents' }
  source TEXT NOT NULL CHECK (source IN ('canonical_metric', 'manual', 'unavailable')),
  unavailable_reason TEXT,                 -- e.g. 'integration_not_connected', 'api_failure', 'no_data_yet'
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (baseline_id, metric_slug)   -- one row per (baseline, metric) — idempotent re-capture overwrites
);
```

**Idempotent metric writes.** The PK on `(baseline_id, metric_slug)` means re-capture for the same baseline writes via `ON CONFLICT (baseline_id, metric_slug) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, captured_at = now()`. Re-running capture for a `ready` baseline never produces duplicates.

### Migration 0280 — RLS + canonical dictionary

- Add `subaccount_baselines` and `subaccount_baseline_metrics` to `rlsProtectedTables.ts`
- Add policies via migration extension (per `0245_all_tenant_tables_rls.sql` pattern)
- Add canonicalDictionary entries

## §4 Readiness condition + capture trigger

### Condition

A sub-account is "ready" when ALL of the following are true. The definition is deterministic and persistence-backed — no in-memory state, no implicit "stability windows" that don't survive a restart.

1. **≥1 active connector**: at least one row in `connector_configs` with `status='active'` linked to the sub-account.
2. **≥2 successful poll cycles**: count of rows in `connector_poll_history` (or equivalent existing audit; **resolve canonical source at build start** — the table that records polling outcomes is referenced by `connectorPollingService`) where `subaccount_id = ? AND outcome = 'success' AND completed_at >= now() - interval '7 days'` is `>= 2`.
3. **Settle window elapsed**: `(now() - earliest_qualifying_poll_completed_at) >= interval '1 hour'`. This is the deterministic, restart-safe replacement for the looser word "stable" — it gives connector backoffs / partial syncs time to converge before the first capture, without requiring any new persistence layer.
4. **≥2 of 4 core metrics non-null**: of `pipeline_value`, `lead_count`, `conversation_engagement`, `revenue` slugs in `canonical_metrics`, at least 2 have non-null `currentValue`.

`baselineReadinessService.evaluate(subaccountId): Promise<ReadinessResult>` is a pure read over those four sources. Never mutates state. Returns `{ ready: boolean, missing: string[], reason?: string, qualifying_poll_count: number, earliest_qualifying_poll_at: Date | null }`. Idempotent — calling it 1× or 100× per sub-account produces the same answer until the underlying data changes.

### Trigger model — signal vs writer

Multiple paths can OBSERVE that a sub-account became ready. Only ONE service WRITES baselines — see §5.2 single-writer rule. Trigger paths emit signals; they do not write.

1. **Event-driven signal** — `connectorPollingService` emits `connector.sync.complete` on every successful poll. Subscriber `onSyncCompleteEvaluateReadiness(subaccountId)` calls `baselineReadinessService.evaluate`. If the result is `{ ready: true }` AND the existing row's `status='pending'`, the subscriber enqueues a `captureBaselineJob` with the sub-account ID. The subscriber NEVER writes to `subaccount_baselines` directly.

2. **Cron fallback signal** — daily pg-boss job `evaluateAllPendingBaselines` iterates `subaccount_baselines` rows with `status='pending'` (and optionally `status='ready'` whose `last_attempt_at` indicates retry is due — see §5.4), calls `baselineReadinessService.evaluate`, and enqueues `captureBaselineJob` for any that newly qualify or are due for retry. Same single-writer constraint: the job enqueues, it does not write.

3. **Manual override** — operator-driven write through `<ManualBaselineForm>` (§6). Goes through the same `captureBaselineService` entrypoint with a `source='manual'` flag — no separate write path.

### Why not at sub-account creation

Integrations need time to settle, polls need time to land. The settle window (≥1h since the first qualifying poll) makes this explicit. A new sub-account row in `subaccount_baselines` is created with `status='pending'` and `baseline_version=1` from the existing `autoStartOwedOnboardingWorkflows` hook in `server/routes/subaccounts.ts:121-150`. That insert is itself idempotent: the UNIQUE index from §3 prevents a duplicate `pending` row even if onboarding fires twice.

## §5 Capture flow + retry logic

### §5.1 State machine

```
pending → (readiness met)        → ready
ready   → (capture job picks up) → capturing
capturing → success              → captured
capturing → retryable failure    → ready  (capture_attempt_count++, last_attempt_at=now())
capturing → non-retryable / 3rd retryable failure → failed
ready (status='captured', operator opens form) → captured (source='mixed' or 'manual')
captured → (admin reset)         → reset; new row written with baseline_version+1, status='pending'
```

The `capturing` status is intentional — it makes the in-flight state visible in DB and prevents two retry workers from picking up the same baseline simultaneously (the worker takes the row via `UPDATE … SET status='capturing' WHERE id=? AND status='ready' RETURNING *`; only one update wins).

### §5.2 Single-writer rule (invariant)

**`captureBaselineService` is the only service that writes to `subaccount_baselines` after the initial `pending` row insert.** Every other surface emits signals only.

| Surface | What it does | What it MUST NOT do |
|---|---|---|
| `subaccountOnboardingService` (creation hook) | INSERTs the initial `pending` row with `baseline_version=1` | UPDATE / DELETE existing rows |
| `connectorPollingService` event subscriber | Calls `baselineReadinessService.evaluate`; on `ready` enqueues `captureBaselineJob` | Write to `subaccount_baselines` directly |
| `evaluateAllPendingBaselines` cron | Same as above for the fallback path | Write directly |
| `<ManualBaselineForm>` POST endpoint | Calls `captureBaselineService.runManual(subaccountId, metricInputs, userId)` | Write directly to either table |
| `<AdminBaselineResetButton>` POST endpoint | Calls `captureBaselineService.adminReset(subaccountId, reason, userId)` | Write directly |

This eliminates the four-writer race the reviewer flagged. Concentrating all writes in one service is what makes the idempotency guarantees in §3 enforceable.

### §5.3 Capture sequence (`captureBaselineService.run(subaccountId)`)

The entrypoint is also the only retry entry point. The job runner calls it with the sub-account ID; the service handles state transitions internally.

1. **Acquire `capturing` lock**: `UPDATE subaccount_baselines SET status='capturing', last_attempt_at=now() WHERE subaccount_id=? AND status='ready' AND baseline_version = (SELECT MAX(baseline_version) FROM subaccount_baselines WHERE subaccount_id=? AND status <> 'reset') RETURNING id`. Zero rows affected → another worker picked it up; exit cleanly (no error).
2. **Read opted-in metric set** from `subaccount_settings.baseline_metrics_opt_in[]` (default = full v1 set).
3. **Read source data per metric** via the per-metric reader (`getPipelineValue`, `getLeadCount`, etc.). Each reader returns `{ value, source, unavailable_reason? }` where `source ∈ {'canonical_metric', 'unavailable'}` and `unavailable_reason` describes the gap (`integration_not_connected`, `api_failure`, `no_data_yet`).
4. **Upsert metric rows** in one transaction: `INSERT INTO subaccount_baseline_metrics (...) VALUES (...) ON CONFLICT (baseline_id, metric_slug) DO UPDATE SET value=EXCLUDED.value, source=EXCLUDED.source, captured_at=now()`. Idempotent re-write per §3.
5. **Decide final state**:
   - `>= 2` metrics with `source='canonical_metric'` → success: `UPDATE … SET status='captured', captured_at=now(), confidence=<computed>`. `confidence='confirmed'` if all opted-in slugs returned canonical values, else `partial`.
   - `< 2` canonical metrics → retryable failure (treat as `no_data_yet` even if some slugs returned `unavailable`). Apply §5.4 classification.
6. **Emit telemetry events** per §8 audit contract.

### §5.4 Retry classification (replaces "3 attempts exhausted")

Errors are classified at the per-metric reader boundary. Aggregate classification at the service boundary determines the next state.

| Class | Examples (per-metric) | Retry? | Next state |
|---|---|---|---|
| **Retryable** | HTTP 5xx, 429, network timeouts, `no_data_yet` while polls are still arriving, transient DB serialisation conflicts | Yes — exponential backoff: 1h, 4h, 24h | `ready` (cron fallback re-picks at next eligible window) |
| **Non-retryable** | HTTP 4xx (other than 429), schema mismatch on canonical metric shape, `integration_not_connected`, opted-in metric with no reader implementation | No | `failed` immediately; `failure_reason` set to category |
| **Soft-success** | Some metrics retryable, ≥2 already captured | n/a — already success | `captured` with `confidence='partial'` |

Retry budget: maximum **3 attempts** for retryable failures (per the original spec intent). After the 3rd retryable failure, transition to `failed` with `failure_reason='retry_budget_exhausted'`. Backoff anchor is `last_attempt_at` (column added in §3 migration 0278). The `evaluateAllPendingBaselines` cron picks up rows where `status IN ('ready', 'failed') AND capture_attempt_count > 0 AND last_attempt_at <= now() - <backoff_window>`.

Non-retryable errors transition straight to `failed` without consuming retry budget — so a sub-account whose connector isn't installed never burns 3 retries before surfacing for manual entry.

`<ManualBaselineForm>` is the recovery path for any `failed` baseline regardless of failure category.

## §6 Manual-entry path

UI on `/subaccounts/:id` overview page:
- If `baseline.status='failed'` or `baseline.status='captured'` with `confidence='partial'` → show "Set baseline manually" CTA
- `<ManualBaselineForm>` lists every metric in v1 set with current value (if captured) and an editable input
- Validation: no negative values; lead count ≤ all-time-high seen in history; required currency unit
- Save: writes individual metric rows with `source='manual'`, transitions baseline to `source='mixed'` (if some auto + some manual) or `source='manual'`, updates `confidence` accordingly
- Admin reset: `<AdminBaselineResetButton>` (sysadmin only) — writes `admin_reset_reason`, transitions status to `reset`, creates new baseline row in `pending`. Old baseline is preserved (history). Used when an agency operator wants to re-baseline mid-engagement.

## §6a Audit + event logging contract

Every transition emits a structured event via `tracing.ts`. Required for debuggability — when a baseline ends up `failed` or shows unexpected delta in a report, these events are the audit trail.

| Event name | Emitted from | Required fields |
|---|---|---|
| `baseline.capture.triggered` | subscriber, fallback cron, manual endpoint | `subaccount_id`, `baseline_id`, `source` ∈ `{'subscriber','fallback','manual','admin_reset'}` |
| `baseline.capture.started` | `captureBaselineService.run` (after `capturing` lock acquired) | `subaccount_id`, `baseline_id`, `attempt_number`, `version` |
| `baseline.metric.captured` | per-metric reader success | `subaccount_id`, `baseline_id`, `metric_slug`, `source='canonical_metric'`, `value_summary` |
| `baseline.metric.unavailable` | per-metric reader fall-through | `subaccount_id`, `baseline_id`, `metric_slug`, `unavailable_reason`, `error_class` ∈ `{'retryable','non_retryable'}` |
| `baseline.capture.succeeded` | end of `run` on success | `subaccount_id`, `baseline_id`, `confidence`, `metrics_captured_count`, `metrics_unavailable_count` |
| `baseline.capture.retry_scheduled` | retryable failure path | `subaccount_id`, `baseline_id`, `attempt_number`, `next_attempt_at`, `failure_reasons[]` |
| `baseline.capture.failed` | non-retryable OR retry budget exhausted | `subaccount_id`, `baseline_id`, `failure_reason`, `final_attempt_count` |
| `baseline.manual.applied` | `<ManualBaselineForm>` POST | `subaccount_id`, `baseline_id`, `user_id`, `metrics_overridden[]` |
| `baseline.admin_reset` | `<AdminBaselineResetButton>` POST | `subaccount_id`, `prior_baseline_id`, `new_baseline_id`, `prior_version`, `new_version`, `user_id`, `reason` |

The `tracing.ts` event registry must be extended with all 9 names. Each event is a one-liner: emit at the state transition, no batching, no conditional emission.

## §7 Reporting Agent integration (delta semantics)

The Reporting Agent's portfolio report skill currently reads current-state metrics from `canonical_metrics`. To narrate delta, add:

- New skill helper: `getBaselineForSubaccount(subaccountId): Promise<BaselineSnapshot | null>`
- For each metric in the report, compute `delta = current - baseline.value` and `pct = (delta / baseline.value) * 100`
- Report templates extend with delta sections: "Since onboarding (Apr 18): pipeline +$63k (+32%); leads +47 (+19%)"
- Honest about gaps: if a metric was `unavailable` at baseline, narrate "we don't have a starting point for X — first measurement is today's value"

No new schema; just a service helper + report template extension.

---

## §8 Build chunks

### Phase 1 — Schema (~3h)

- [ ] Author migrations 0278 (`subaccount_baselines` per §3 — including `baseline_version`, `last_attempt_at`, `capturing` status, partial UNIQUE index on `(subaccount_id, baseline_version) WHERE status <> 'reset'`, retry-anchor index), 0279 (`subaccount_baseline_metrics` with PK on `(baseline_id, metric_slug)` — supports `ON CONFLICT … DO UPDATE` idempotent writes), 0280 (RLS + canonical dictionary). All paired with `.down.sql`. **Confirm next-free migration number at build start** — main may have moved further.
- [ ] Add Drizzle schemas `server/db/schema/subaccountBaselines.ts`, `server/db/schema/subaccountBaselineMetrics.ts`.
- [ ] Register both in `rlsProtectedTables.ts` and `canonicalDictionary.ts`.
- [ ] Add `baseline_metrics_opt_in` key to `subaccount_settings` zod schema (defaults to full v1 metric set).
- [ ] Pure validator unit tests for status state-machine (incl. `capturing`), source enum, confidence enum, retry-classification mapping, idempotency-key uniqueness (1 file, ~14 cases).

### Phase 2 — Readiness condition + sync-complete event (~5h)

- [ ] Author `server/services/baselineReadinessService.ts` exporting `evaluate(subaccountId): Promise<{ready, missing, reason}>`. Pure function over canonical metrics + connector state.
- [ ] Modify `server/routes/subaccounts.ts:121-150` (existing onboarding hook): also create a `subaccount_baselines` row with `status='pending'`.
- [ ] Add `connector.sync.complete` event emit to `server/services/connectorPollingService.ts` after each successful poll cycle.
- [ ] Subscriber `evaluateBaselineReadiness(subaccountId)` — runs readiness; on `pending → ready` transition, enqueues capture job and updates `ready_at`.
- [ ] pg-boss daily fallback job `evaluateAllPendingBaselines` — iterates `pending` rows, re-evaluates.
- [ ] Pure tests for readiness evaluator (8+ cases: 0 connectors, 1 connector + 1 poll, 1 connector + 2 polls + insufficient metrics, etc.).

### Phase 3 — Capture service + retry/failure handling (~5h)

- [ ] Author `server/services/captureBaselineService.ts` per §5 flow.
- [ ] Each metric in v1 set has a metric reader: `getPipelineValue(subaccountId)`, `getLeadCount(...)`, etc. Pure-ish — query canonical_metrics + last-30d-history.
- [ ] State transitions emit telemetry events.
- [ ] Retry: pg-boss job reschedules in 24h on partial failure; max 3 attempts; transition to `failed` after.
- [ ] On `captured`, write notification entry (in-app) for agency operator — "Baseline captured for X. Open Reporting Agent to see day-one state."
- [ ] Integration test: seeded sub-account with fixture canonical_metrics → run capture → assert all metric rows + status transition + telemetry emit.

### Phase 4 — Manual entry UI + admin reset (~4h)

- [ ] `<ManualBaselineForm>` on `/subaccounts/:id` overview. Lists v1 metrics + current values + editable inputs.
- [ ] Validation per §6 (no negatives, lead count cap, currency unit required).
- [ ] `POST /api/subaccounts/:id/baseline/manual` — writes individual metric rows with `source='manual'`, recomputes baseline `source` and `confidence`.
- [ ] `<AdminBaselineResetButton>` (sysadmin gated) with reason input. `POST /api/admin/subaccounts/:id/baseline/reset`.
- [ ] `<BaselineStatusBadge>` on subaccount detail page (pending / ready / captured / failed / manual / reset).

### Phase 5 — Reporting Agent delta integration (~3h)

- [ ] `getBaselineForSubaccount(subaccountId)` helper in `server/services/reportingAgent/baselineHelper.ts`.
- [ ] Extend `generate_portfolio_report` skill to compute delta per metric and include "since onboarding" section.
- [ ] Honest-gap narration: if metric was unavailable at baseline, narrate "first measurement is today's value".
- [ ] Pure tests: 6+ cases (full baseline; partial baseline; reset baseline; no baseline yet; baseline newer than last poll; etc.).

### Phase 6 — Verification (~2h)

- [ ] `npm run lint`, `npm run typecheck` clean.
- [ ] All unit + integration tests pass.
- [ ] Manual: create test sub-account with GHL connection (using whatever per-sub-account OAuth path exists today), wait 2 polls, observe capture, verify Reporting Agent narrates delta.
- [ ] Update `docs/capabilities.md` § Reporting — describe baseline + delta narration.
- [ ] Update `docs/clientpulse-dev-spec.md` to mark Item 1 (baseline capture) as addressed.
- [ ] Update `tasks/builds/baseline-capture/progress.md` with closeout.

---

## §9 Files touched

### Server
- `server/db/schema/subaccountBaselines.ts` (new)
- `server/db/schema/subaccountBaselineMetrics.ts` (new)
- `server/db/rlsProtectedTables.ts` (entries)
- `server/db/canonicalDictionary.ts` (entries)
- `server/services/baselineReadinessService.ts` (new)
- `server/services/captureBaselineService.ts` (new)
- `server/services/baselineMetricReaders/*.ts` (one per v1 metric)
- `server/services/connectorPollingService.ts` (event emit)
- `server/services/subaccountOnboardingService.ts` (create pending baseline row)
- `server/services/reportingAgent/baselineHelper.ts` (new)
- `server/routes/subaccounts.ts` (manual entry endpoint)
- `server/routes/admin/baselineReset.ts` (new)
- `server/jobs/captureBaselineJob.ts` (new)
- `server/jobs/evaluateAllPendingBaselines.ts` (new)
- `server/lib/tracing.ts` (9 new event names per §6a audit + event logging contract)

### Shared
- `shared/schemas/subaccount.ts` (extend with `baseline_metrics_opt_in`)
- `shared/constants/baselineMetrics.ts` (v1 metric slug list + units)

### Client
- `client/src/components/baseline/ManualBaselineForm.tsx` (new)
- `client/src/components/baseline/BaselineStatusBadge.tsx` (new)
- `client/src/components/baseline/AdminBaselineResetButton.tsx` (new, sysadmin-gated)
- `client/src/pages/SubaccountDetailPage.tsx` (badge + form wiring)

### Tests
- `server/services/__tests__/baselineReadinessService.test.ts` — readiness combinations, settle-window edge cases (just-under, just-over the 1h gate), missing-poll-history fallback
- `server/services/__tests__/captureBaselineService.test.ts` — happy path, retry classification (retryable / non-retryable), exhaustion to `failed`, idempotent re-run, `capturing` lock contention, single-writer assertion (concurrent subscriber + cron simulation)
- `server/services/__tests__/baselineMetricReaders.test.ts` — per-metric readers + their failure classifications
- `server/services/reportingAgent/__tests__/baselineHelper.test.ts`
- `server/services/__tests__/baselineInvariants.test.ts` — the §10 hard invariants: UNIQUE-index enforcement, admin-reset-preserves-history, manual + auto concurrent never duplicates, `Date.now()` static check (grep-based)

### Docs (Phase 6 closeout)
- `docs/capabilities.md`, `docs/clientpulse-dev-spec.md` (mark addressed)

## §10 Done definition

Functional outcomes:
- A new sub-account creates a `pending` baseline row at creation.
- Readiness condition transitions `pending → ready` on second successful poll cycle PLUS the ≥1h settle window (or daily fallback).
- Capture job writes baseline metric rows for all available canonical metrics.
- Retry logic classifies retryable vs non-retryable failures correctly; non-retryable transitions straight to `failed` without consuming retry budget.
- Failed baselines surface for manual entry.
- Manual entry round-trips correctly (writes individual metric rows, updates `source` + `confidence`).
- Admin reset preserves history (creates new baseline with `baseline_version+1`, doesn't delete old).
- Reporting Agent's portfolio report includes "Since onboarding" delta sections.
- All 9 telemetry events from §6a emit at the correct state transitions.

Hard invariants (asserted by tests):
- **Exactly one active baseline per sub-account.** UNIQUE index on `(subaccount_id, baseline_version) WHERE status <> 'reset'` is enforced; integration test seeds two concurrent `pending` inserts and asserts the second fails with constraint violation.
- **Idempotent retry.** Calling `captureBaselineService.run` twice for the same `ready` baseline produces the same row state and the same metric rows; `subaccount_baseline_metrics` count is unchanged on the second call (tested via fixture).
- **Single-writer rule honoured.** No code path other than `captureBaselineService` writes to `subaccount_baselines` after the initial `pending` insert. Asserted via grep / static check in CI; integration test asserts that simulating the subscriber and the cron in parallel never produces duplicate rows.
- **Manual override never conflicts with auto capture.** When `<ManualBaselineForm>` POSTs while a `capturing` lock is held, the manual write blocks until the auto path completes (or fails), then runs as `runManual` against the same baseline_id. Asserted via integration test simulating concurrent auto + manual.
- **Admin reset never destroys history.** Test asserts that after reset, the prior baseline row exists with `status='reset'` AND a new row exists with `baseline_version+1` AND `status='pending'`.
- **All timestamps use Postgres `now()`.** Static check (grep for `Date.now()` in `server/services/captureBaselineService.ts`, `baselineMetricReaders/`, `baselineReadinessService.ts`) returns zero hits in CI.

## §11 Dependencies

**Soft dependency:** F1 `subaccount-artefacts` must land first because both modify `subaccounts` table area (F1 adds `baseline_artefacts_status` JSONB; F3 doesn't touch this column but adds `baseline_metrics_opt_in` to `subaccount_settings` JSONB). Coordinate via merge order — F1 first.

**Upstream — GHL Module C OAuth (RESOLVED):**
- Status: **SHIPPED on main 2026-05-03 via PR #254** (`docs/ghl-module-c-oauth-spec.md`).
- Agency-level OAuth + sub-account auto-enrol via `INSTALL` webhook + per-location token cache (`connector_location_tokens`) all live in production.
- For agencies installing the app, every sub-account underneath is auto-enrolled and gains a connector record automatically. F3 baseline capture works at scale from day 1 — no per-sub-account manual onboarding required.
- For sub-accounts that pre-existed Module C with their own per-sub-account OAuth (via `server/routes/oauthIntegrations.ts`), baseline capture continues to work as it would have under the original spec.

**Out of scope upstream:** None of the v1 metrics depend on Mailgun/Twilio/Google Business Profile — those are out of scope and recorded as `unavailable`. No additional integrations need to be built for v1.

## §12 Risks

- **Readiness condition too strict** — metric coverage may be sparser than the "≥2 of 4" threshold suggests for some sub-accounts. Mitigate: lower threshold to ≥1 with explicit `confidence='partial'` flag rather than blocking capture.
- **Readiness condition too lax** — may capture baseline before data has settled. Mitigate: 2-poll-cycle requirement is explicit; test against fixtures with single-cycle anomalies.
- **Manual entry abuse** — operator could set unrealistic baseline to inflate later "delta". Mitigate: validation caps + audit trail (`source='manual'`, captured-by user_id) + report disclaimer when baseline is manual.
- **Admin reset history loss** — if reset deletes old baseline, history is lost. Mitigate: spec requires preserving old row, only creating new pending baseline.
- **Schema drift on parallel branches** — F1 also touches `subaccounts` table area. Coordinate migrations: F1 = `0277` first, then F3 = `0278-0280`. If F1 slips, F3 can land first, but its `baseline_metrics_opt_in` settings key uses a JSONB column F1 doesn't conflict with.
- ~~**GHL Module C delay** — without agency OAuth, scale is gated. Mitigate: ship baseline plumbing now, coverage scales when Module C lands.~~ **RESOLVED — Module C shipped via PR #254 (2026-05-03). F3 now ships at scale from day 1 for any agency installing the app.**

## §13 Concurrent-build hygiene

- Migrations `0278`, `0279`, `0280` reserved here (was `0268-0270`; reallocated after main consumed through `0276`). **Confirm next-free at build start** — main may move further. Do not use elsewhere once claimed.
- Branch `claude/baseline-capture`. Worktree at `../automation-v1.baseline-capture`.
- Progress lives in `tasks/builds/baseline-capture/progress.md`.
- Touches `connectorPollingService.ts` event emit — F2 doesn't touch; F1 doesn't touch; safe.
- Touches `subaccountOnboardingService.ts` for `pending` row creation — F1 also touches this file (`markArtefactCaptured`). Coordinate by adding methods, not modifying existing ones; merge order F1 → F3.
- Touches `subaccount_settings` JSONB key `baseline_metrics_opt_in` — F1 uses different key (`baseline_artefacts_status` on `subaccounts` table directly, not in settings). No collision.
- F3 must land after F1 if both are in flight simultaneously, OR F3 lands first and F1 rebases on top. Pick one — recommend F1 first (smaller scope, less surface area).
- F2 Phase 0 ALREADY SHIPPED on main; Phases 1-4 of F2 are fully independent of F3 and can run in parallel without coordination.
- GHL Module C agency OAuth (was the prior hard upstream blocker for F3 at-scale coverage) shipped on main via PR #254. F3 now ships at scale from day 1.
