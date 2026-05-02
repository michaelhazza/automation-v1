# Baseline Capture at Sub-Account Onboarding — Dev Spec

**Status:** DRAFT
**Build slug:** `baseline-capture`
**Branch:** `claude/baseline-capture`
**Migrations claimed:** `0268`, `0269`, `0270`
**Concurrent peers:** F1 `subaccount-artefacts` (0266), F2 `subaccount-optimiser` (0267)
**Related code:** `server/services/canonicalDataService.ts`, `server/services/connectorPollingService.ts`, `server/services/intelligenceSkillExecutor.ts`, `server/adapters/ghlAdapter.ts`, `server/services/subaccountOnboardingService.ts`, `server/routes/subaccounts.ts`, `server/db/schema/canonicalMetrics.ts`, `client/src/pages/SubaccountDetailPage.tsx`
**Related specs:** `docs/clientpulse-dev-spec.md`, `docs/clientpulse-ghl-dev-brief.md`, `docs/clientpulse-soft-launch-blockers-brief.md`, `docs/canonical-data-platform-p1-p2-p3-impl.md`
**Hard upstream:** GHL Module C OAuth must be functional for an integration to capture data; without it, baselines work only for sub-accounts that already have an active per-sub-account OAuth connection.

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
  - Phase 1 — Schema (3 tables)
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
| GHL Module C OAuth (agency-level) | **STUBBED** | `server/routes/ghl.ts:1-75` — placeholder routes, callback TODO not implemented |
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

## §3 Storage model — new tables 0268-0270

### Migration 0268 — `subaccount_baselines`

```sql
CREATE TABLE subaccount_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL UNIQUE,  -- one baseline per sub-account
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'captured', 'failed', 'manual', 'reset')),
  capture_attempt_count SMALLINT NOT NULL DEFAULT 0,
  ready_at TIMESTAMPTZ,         -- when readiness condition was first met
  captured_at TIMESTAMPTZ,      -- immutable once set; set during capture transition
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'mixed')) DEFAULT 'auto',
  confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'estimated', 'partial')) DEFAULT 'partial',
  failure_reason TEXT,
  admin_reset_reason TEXT,
  reset_at TIMESTAMPTZ,
  reset_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX subaccount_baselines_status_idx ON subaccount_baselines(organisation_id, status);
```

### Migration 0269 — `subaccount_baseline_metrics`

```sql
CREATE TABLE subaccount_baseline_metrics (
  baseline_id UUID NOT NULL REFERENCES subaccount_baselines(id) ON DELETE CASCADE,
  metric_slug TEXT NOT NULL,
  value JSONB NOT NULL,                    -- { numeric: 47000, currency: 'USD', unit: 'cents' }
  source TEXT NOT NULL CHECK (source IN ('canonical_metric', 'manual', 'unavailable')),
  unavailable_reason TEXT,                 -- e.g. 'integration_not_connected', 'api_failure', 'no_data_yet'
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (baseline_id, metric_slug)
);
```

### Migration 0270 — RLS + canonical dictionary

- Add `subaccount_baselines` and `subaccount_baseline_metrics` to `rlsProtectedTables.ts`
- Add policies via migration extension (per `0245_all_tenant_tables_rls.sql` pattern)
- Add canonicalDictionary entries

## §4 Readiness condition + capture trigger

### Condition (per `clientpulse-soft-launch-blockers-brief.md` Item 1)

A sub-account is "ready" when ALL of the following are true:
- ≥1 active connector (GHL or Stripe — minimum requirement)
- The connector has completed ≥2 successful poll cycles
- At least 2 of: pipeline_value, lead_count, conversation_engagement, revenue have non-null values

Readiness is evaluated by `baselineReadinessService.evaluate(subaccountId)`. Returns `{ ready: boolean, missing: string[], reason?: string }`.

### Trigger model

Two trigger paths:

1. **Event-driven** — `connectorPollingService` emits `connector.sync.complete` event on every successful poll. A subscriber `evaluateBaselineReadiness(subaccountId)` runs the readiness condition. If transitioning from `pending` → `ready`, enqueue `captureBaseline` job.

2. **Cron fallback** — daily job iterates `subaccount_baselines` rows where `status='pending'` and re-evaluates readiness. Catches any sub-account that missed the event-driven path (e.g. event handler failed).

### Why not at sub-account creation

Brief specified the trigger should NOT be at creation — integrations need time to settle, polls need time to land. Readiness gate makes this explicit. A new sub-account row in `subaccount_baselines` is created with `status='pending'` from the existing `autoStartOwedOnboardingWorkflows` hook in `server/routes/subaccounts.ts:121-150`.

## §5 Capture flow + retry logic

```
pending → (readiness met) → ready → (capture job runs) → captured  [success]
                                                       → failed    [3 attempts exhausted]
                                                       → ready     [retry, attempt++]
manual:    captured (admin-set), source='manual'
reset:     admin reset → status returns to 'pending', new baseline row written, history preserved
```

`captureBaselineService.run(subaccountId)`:

1. Read sub-account's connectors + opted-in metrics from `subaccount_settings.baseline_metrics_opt_in[]`
2. For each metric in v1 set:
   - Read latest from `canonical_metrics` if available → write to `subaccount_baseline_metrics` with `source='canonical_metric'`
   - Else write `source='unavailable'` with reason `integration_not_connected` or `no_data_yet`
3. If ≥2 metrics captured successfully: transition baseline to `captured`, set `captured_at`, set `confidence='confirmed'` if all opted-in metrics succeeded, else `partial`
4. If <2 metrics succeed: increment `capture_attempt_count`, schedule retry in 24h
5. After 3 failed attempts: transition to `failed`, surface in UI for manual entry

Each step emits telemetry: `baseline.capture.started`, `baseline.metric.captured`, `baseline.metric.unavailable`, `baseline.capture.completed`, `baseline.capture.failed`.

## §6 Manual-entry path

UI on `/subaccounts/:id` overview page:
- If `baseline.status='failed'` or `baseline.status='captured'` with `confidence='partial'` → show "Set baseline manually" CTA
- `<ManualBaselineForm>` lists every metric in v1 set with current value (if captured) and an editable input
- Validation: no negative values; lead count ≤ all-time-high seen in history; required currency unit
- Save: writes individual metric rows with `source='manual'`, transitions baseline to `source='mixed'` (if some auto + some manual) or `source='manual'`, updates `confidence` accordingly
- Admin reset: `<AdminBaselineResetButton>` (sysadmin only) — writes `admin_reset_reason`, transitions status to `reset`, creates new baseline row in `pending`. Old baseline is preserved (history). Used when an agency operator wants to re-baseline mid-engagement.

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

- [ ] Author migrations 0268 (`subaccount_baselines`), 0269 (`subaccount_baseline_metrics`), 0270 (RLS + canonical dictionary). All paired with `.down.sql`.
- [ ] Add Drizzle schemas `server/db/schema/subaccountBaselines.ts`, `server/db/schema/subaccountBaselineMetrics.ts`.
- [ ] Register both in `rlsProtectedTables.ts` and `canonicalDictionary.ts`.
- [ ] Add `baseline_metrics_opt_in` key to `subaccount_settings` zod schema (defaults to full v1 metric set).
- [ ] Pure validator unit tests for status state-machine, source enum, confidence enum (1 file, ~12 cases).

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
- `server/lib/tracing.ts` (5 new event names)

### Shared
- `shared/schemas/subaccount.ts` (extend with `baseline_metrics_opt_in`)
- `shared/constants/baselineMetrics.ts` (v1 metric slug list + units)

### Client
- `client/src/components/baseline/ManualBaselineForm.tsx` (new)
- `client/src/components/baseline/BaselineStatusBadge.tsx` (new)
- `client/src/components/baseline/AdminBaselineResetButton.tsx` (new, sysadmin-gated)
- `client/src/pages/SubaccountDetailPage.tsx` (badge + form wiring)

### Tests
- `server/services/__tests__/baselineReadinessService.test.ts`
- `server/services/__tests__/captureBaselineService.test.ts`
- `server/services/__tests__/baselineMetricReaders.test.ts`
- `server/services/reportingAgent/__tests__/baselineHelper.test.ts`

### Docs (Phase 6 closeout)
- `docs/capabilities.md`, `docs/clientpulse-dev-spec.md` (mark addressed)

## §10 Done definition

- A new sub-account creates a `pending` baseline row at creation.
- Readiness condition transitions `pending → ready` on second successful poll cycle (or daily fallback).
- Capture job writes baseline metric rows for all available canonical metrics.
- Retry logic exhausts cleanly; failed baselines surface for manual entry.
- Manual entry round-trips correctly (writes individual metric rows, updates `source` + `confidence`).
- Admin reset preserves history (creates new baseline, doesn't delete old).
- Reporting Agent's portfolio report includes "Since onboarding" delta sections.
- Telemetry events emit at each state transition.

## §11 Dependencies + GHL OAuth caveat

**Soft dependency:** F1 `subaccount-artefacts` must land first because both modify `subaccounts` table area (F1 adds `baseline_artefacts_status` JSONB; F3 doesn't touch this column but adds `baseline_metrics_opt_in` to `subaccount_settings` JSONB). Coordinate via merge order — F1 first.

**Hard upstream caveat — GHL Module C OAuth:**
- The GHL adapter ingestion is real (`ghlAdapter.ts:130-226` makes real `axios.get` calls).
- However, `server/routes/ghl.ts` is **stubbed** — agency-level OAuth callback is a TODO (line 61), `/locations` returns `[]`.
- For sub-accounts where a per-sub-account OAuth has been completed via `server/routes/oauthIntegrations.ts`, baseline capture works today.
- For agencies onboarding many sub-accounts at once via the agency-level OAuth, baseline capture is gated until Module C ships.
- This spec ships the baseline plumbing regardless; coverage scales when Module C lands. File "GHL Module C OAuth completion" as a separate Significant task — not in this spec's scope.

**Hard upstream:** None of the v1 metrics depend on Mailgun/Twilio/Google Business Profile — those are out of scope and recorded as `unavailable`. No additional integrations need to be built for v1.

## §12 Risks

- **Readiness condition too strict** — metric coverage may be sparser than the "≥2 of 4" threshold suggests for some sub-accounts. Mitigate: lower threshold to ≥1 with explicit `confidence='partial'` flag rather than blocking capture.
- **Readiness condition too lax** — may capture baseline before data has settled. Mitigate: 2-poll-cycle requirement is explicit; test against fixtures with single-cycle anomalies.
- **Manual entry abuse** — operator could set unrealistic baseline to inflate later "delta". Mitigate: validation caps + audit trail (`source='manual'`, captured-by user_id) + report disclaimer when baseline is manual.
- **Admin reset history loss** — if reset deletes old baseline, history is lost. Mitigate: spec requires preserving old row, only creating new pending baseline.
- **Schema drift on parallel branches** — F1 also touches `subaccounts` table area. Coordinate migrations: F1 = 0266 first, then F3 = 0268-0270. If F1 slips, F3 can land first, but its `baseline_metrics_opt_in` settings key uses the same JSONB column F1 doesn't conflict with.
- **GHL Module C delay** — without agency OAuth, scale is gated. Mitigate: ship baseline plumbing now, coverage scales when Module C lands.

## §13 Concurrent-build hygiene

- Migrations `0268`, `0269`, `0270` reserved here. Do not use elsewhere.
- Branch `claude/baseline-capture`. Worktree at `../automation-v1.baseline-capture`.
- Progress lives in `tasks/builds/baseline-capture/progress.md`.
- Touches `connectorPollingService.ts` event emit — F2 doesn't touch; F1 doesn't touch; safe.
- Touches `subaccountOnboardingService.ts` for `pending` row creation — F1 also touches this file (`markArtefactCaptured`). Coordinate by adding methods, not modifying existing ones; merge order F1 → F3.
- Touches `subaccount_settings` JSONB key `baseline_metrics_opt_in` — F1 uses different key (`baseline_artefacts_status` on `subaccounts` table directly, not in settings). No collision.
- F3 must land after F1 if both are in flight simultaneously, OR F3 lands first and F1 rebases on top. Pick one — recommend F1 first (smaller scope, less surface area).
