# Spec Conformance Log — baseline-capture

**Spec:** `docs/baseline-capture-spec.md`
**Spec commit at check:** `12c38cdc`
**Branch:** `claude/baseline-capture`
**Base:** `12c38cdc` (merge-base with main; all build work is uncommitted on the branch)
**Scope:** all-of-spec (caller confirmed all 12 implementation chunks complete)
**Changed-code set:** 50 files (14 modified + 36 untracked, including subdirectories)
**Run at:** 2026-05-05T05:36:34Z

---

## Summary

- Requirements extracted:     38
- PASS:                       34
- MECHANICAL_GAP → fixed:     1
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1 (REQ #15 sub-clause — see verdicts table)

> `AMBIGUOUS` reported separately for diagnostic visibility; both directional and ambiguous route to `tasks/todo.md`.

**Verdict:** NON_CONFORMANT (2 blocking gaps — see deferred items in `tasks/todo.md` § "Deferred from spec-conformance review — baseline-capture (2026-05-05)")

---

## Sections

- Requirements extracted (full checklist with verdicts)
- Mechanical fixes applied
- Directional / ambiguous gaps (routed to tasks/todo.md)
- Files modified by this run
- Notes on test gaps and grep weakness
- Next step

---

## Requirements extracted (full checklist)

### §3 Schema — `subaccount_baselines` (migration 0280, was spec-claimed 0278)

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 1 | §3 / §8 P1 | `subaccount_baselines` table with all 16 columns + status/source/confidence CHECK constraints | PASS | `migrations/0280_subaccount_baselines.sql:3-26`; `server/db/schema/subaccountBaselines.ts:11-41`. Schema includes one extra column (`next_attempt_at`) which is documented in-file as a §5.4 derivation — beneficial extension, not a violation. |
| 2 | §3 | Partial UNIQUE index on `(subaccount_id) WHERE status <> 'reset'` | PASS | `migrations/0280_subaccount_baselines.sql:33-35` |
| 3 | §3 | `subaccount_baselines_status_idx` on `(organisation_id, status)` | PASS | `migrations/0280_subaccount_baselines.sql:37-38` |
| 4 | §3 | Retry pickup index on `last_attempt_at WHERE status='ready' AND capture_attempt_count > 0` | PASS | `migrations/0280_subaccount_baselines.sql:42-44` |

### §3 Schema — `subaccount_baseline_metrics` (migration 0281, was spec-claimed 0279)

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 5 | §3 | `subaccount_baseline_metrics` table with FK CASCADE, JSONB value, source CHECK, PK on (baseline_id, metric_slug) | PASS | `migrations/0281_subaccount_baseline_metrics.sql:3-11`; `server/db/schema/subaccountBaselineMetrics.ts:13-27` |

### §3 Schema — RLS + canonical dictionary (migration 0282, was spec-claimed 0280)

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 6 | §3 | RLS enabled + FORCE on both tables; tenant-isolation policies; entries in `rlsProtectedTables.ts` | PASS | `migrations/0282_baseline_rls_and_dictionary.sql:1-42`; `server/config/rlsProtectedTables.ts:1045-1052`; child table justified in `scripts/rls-not-applicable-allowlist.txt:89` (FK-walked policy) |
| 7 | §3 | canonicalDictionary entries for both tables | PASS | `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts:697-763` (rich entries with anti-pattern guidance) |

### §2 — Opt-in setting + v1 metric registry

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 8 | §2 / §8 P1 | `baseline_metrics_opt_in[]` zod key on subaccount_settings; defaults to ALL_METRIC_SLUGS when absent | PASS | `shared/schemas/subaccount.ts:98-113` (`subaccountSettingsSchema` + `resolveBaselineOptIn` helper) |
| 9 | §9 Shared | `shared/constants/baselineMetrics.ts` with v1 metric slug list + units | PASS | `shared/constants/baselineMetrics.ts` (V1_BASELINE_METRICS, ALL_METRIC_SLUGS, AVAILABLE_METRIC_SLUGS, isBaselineMetricSlug, metricMeta) |

### §4 — Readiness condition + sync-complete trigger

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 10 | §4 / §8 P2 | `baselineReadinessService.evaluate(subaccountId): Promise<{ready, missing, reason}>` | PASS | `server/services/baselineReadinessService.ts` + pure extract `baselineReadinessPure.ts`. Signature also takes `organisationId` for org-scoped DB; conformant to spec intent. |
| 11 | §4 | All 4 readiness conditions: ≥1 active connector; ≥2 successful polls; ≥1h settle window; ≥2 of 4 core metrics non-null | PASS | `baselineReadinessPure.ts:44-79` evaluates `active_connector`, `successful_polls_min_2`, `settle_window_1h`, `canonical_metrics_min_2`. Settle window is Postgres-evaluated (DB clock, not Node clock) per §6 invariant. |
| 12 | §4 | Pure read; never mutates state; idempotent | PASS | Service performs only `select`s; pure module has no I/O. |
| 13 | §4 / §8 P2 | Initial `pending` row inserted at sub-account creation with `baseline_version=1` | PASS | `server/routes/subaccounts.ts:153` calls `subaccountOnboardingService.markBaselinePending`; service implementation at `subaccountOnboardingService.ts:752-769` swallows 23505 to remain idempotent. |
| 14 | §4 / §8 P2 | `connector.sync.complete` event emitted after each successful poll cycle | PASS | `server/services/connectorPollingService.ts:300-305`; event registered in `server/lib/tracing.ts:97`. |
| 15 | §4 / §8 P2 | Subscriber runs readiness; on `pending → ready`, enqueues capture job (and updates `ready_at`) | PASS (with note) | `baselineSubscriberService.onSyncCompleteEvaluateReadiness` enqueues correctly. The "updates `ready_at`" sub-clause from §8 Phase 2 is OUT_OF_SCOPE in the subscriber per §5.2 single-writer rule (subscribers MUST NOT write directly); `ready_at` is set instead inside `captureBaselineService` via `COALESCE(ready_at, now())` on success transition. The §8 Phase 2 wording is in tension with §5.2 — the implementation correctly favours the §5.2 invariant. |
| 16 | §4 / §8 P2 / §9 | `evaluateAllPendingBaselines` daily fallback iterates pending + retry-eligible rows and enqueues capture | PASS | `server/jobs/evaluateAllPendingBaselines.ts:15-74`; scheduled at `0 6 * * *` in `server/services/queueService.ts:1378`. Retry eligibility predicate matches §5.4 backoff windows (1h/4h/24h). |

### §5 — Capture service, state machine, retry logic

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 17 | §5 / §8 P3 / §9 | `captureBaselineService.ts` exists with §5 flow | PASS | `server/services/captureBaselineService.ts:24-349` (`run`, `runManual`, `adminReset`) |
| 18 | §5.3 | Capture sequence steps: locking UPDATE…WHERE status IN ('pending','ready') RETURNING; opt-in read; per-metric dispatch; idempotent ON CONFLICT upsert; final-state decision (success ≥2 canonical, partial vs confirmed; non-retryable→failed; retryable→ready+backoff) | PASS | `captureBaselineService.run` lines 25-203 implement all steps; `aggregateOutcome` in `baselineRetryClassifierPure.ts` decides confidence; ON CONFLICT (baseline_id, metric_slug) DO UPDATE at lines 134-143 |
| 19 | §5.4 | Retry classification: retryable (5xx/429/timeouts/no_data_yet/db_serialisation_conflict/api_failure) → backoff 1h/4h/24h up to 3 attempts then `failed`; non-retryable (4xx/schema mismatch/integration_not_connected/reader_not_implemented) → `failed` immediately without consuming retry budget | PASS | `baselineRetryClassifierPure.ts:16-23` classifies; `nextBackoffMinutes` = [60, 240, 1440]; `isRetryBudgetExhausted` at attempt ≥ 3; non-retryable bypasses budget per `aggregateOutcome` line 63-64 |
| 20 | §5.2 / §10 | Single-writer rule: only `captureBaselineService` writes to `subaccount_baselines` after the initial pending insert; manual/reset endpoints MUST call `runManual`/`adminReset` not write directly | **DIRECTIONAL_GAP** | `server/routes/baselines.ts:138-141, 178-186` performs direct `tx.update(subaccountBaselines)` and `db.update(subaccountBaselines)` instead of delegating to `captureBaselineService.runManual`/`adminReset`. Both service methods exist (`captureBaselineService.ts:210-348`) but are unreachable. Knock-on impacts include missing `baseline.manual.applied` / `baseline.admin_reset` events, missing transactional version-bump on admin reset (REQ #27), missing `capturing`-lock guard on manual flow, and divergent confidence-recompute logic. The `baselineInvariants.test.ts` invariant-3 grep is single-line and does not catch chained Drizzle `tx\n.update(subaccountBaselines)`. Routed to `tasks/todo.md` with full knock-on list. |
| 21 | §3 / §10 inv 6 | Static check: `Date.now()` returns zero hits in `captureBaselineService.ts`, `baselineMetricReaders/`, `baselineReadinessService.ts` | **MECHANICAL_GAP → FIXED** | One hit at `server/services/baselineMetricReaders/getRevenueLast30d.ts:23` (`new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)`). Replaced with Postgres-side `sql\`${canonicalMetricHistory.computedAt} >= now() - interval '30 days'\``. Re-grep across all 3 paths returns zero hits. |
| 22 | §5.3 / §9 | One reader per v1 available metric: `getPipelineValue`, `getOpenOpportunityCount`, `getLeadCount`, `getConversationEngagement`, `getRevenueLast30d` | PASS | `server/services/baselineMetricReaders/` has all 5 + `registry.ts` + `UNAVAILABLE_INTEGRATION_NOT_CONNECTED` for `unavailable_default` slugs. Each reader returns the §5.3 contract. |

### §6 — Manual entry + admin reset

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 23 | §6 / §9 Client | `<ManualBaselineForm>` lists v1 metrics with current values + editable inputs | PASS | `client/src/components/baseline/ManualBaselineForm.tsx` |
| 24 | §6 / §8 P4 | Validation: no negatives; lead count ≤ all-time-high; required currency unit | **DIRECTIONAL_GAP** | Server schema (`shared/schemas/baselineManualForm.ts`) only enforces `nonnegative()`. No lead-count cap; currency optional unconditionally. Client-side `min="0"` is not enforcement. Spec doesn't pin the historical-source table or window for the cap → directional. Routed to `tasks/todo.md`. |
| 25 | §6 / §8 P4 | `POST /api/subaccounts/:id/baseline/manual` writes individual metric rows with `source='manual'`, recomputes baseline `source` (mixed if some auto + some manual, else manual) and `confidence` | PASS | `server/routes/baselines.ts:70-146`. (Implementation uses direct DB writes — that's the REQ #20 directional gap, not a missing endpoint.) |
| 26 | §6 / §9 Client | `<AdminBaselineResetButton>` sysadmin gated with reason input | PASS | `client/src/components/baseline/AdminBaselineResetButton.tsx:21` (`if (user.role !== 'system_admin') return null;`); route uses `requireSystemAdmin` middleware (`baselines.ts:155`). |
| 27 | §6 / §10 | Admin reset runs as a single transaction: UPDATE prior SET status='reset' THEN INSERT new with baseline_version+1 + status='pending'. Old baseline preserved. | **DIRECTIONAL_GAP** (subsumed by REQ #20) | `server/routes/baselines.ts:178-186` only marks the prior row `reset` and does not insert the successor. The `captureBaselineService.adminReset` method already implements the correct transaction (`captureBaselineService.ts:296-348`) — just not called by the route. Closing REQ #20 closes this. |
| 28 | §9 Client / §8 P4 | `<BaselineStatusBadge>` on subaccount detail page (pending/ready/captured/failed/manual/reset) | PASS | `client/src/components/baseline/BaselineStatusBadge.tsx` (color + label maps). |
| 29 | §8 P4 | Page wiring on `SubaccountDetailPage` (this build = `AdminSubaccountDetailPage.tsx`): badge + form + reset button | PASS | `client/src/pages/AdminSubaccountDetailPage.tsx:11-13` imports; `:222` badge; `:533-554` form + reset gated on baseline status. |

### §6a — Audit + event logging contract

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 30 | §6a | All 9 baseline event names registered in `tracing.ts` EVENT_NAMES (plus `connector.sync.complete` from §4) | PASS | `server/lib/tracing.ts:96-106`: connector.sync.complete, baseline.capture.triggered, baseline.capture.started, baseline.metric.captured, baseline.metric.unavailable, baseline.capture.succeeded, baseline.capture.retry_scheduled, baseline.capture.failed, baseline.manual.applied, baseline.admin_reset. |
| 31 | §6a | Each event emitted at correct transition with required fields (notably: `baseline.manual.applied` carries `metrics_overridden[]`; `baseline.admin_reset` carries prior/new ids, version, user_id, reason) | PARTIAL → DIRECTIONAL (subsumed by REQ #20) | `captureBaselineService.run/runManual/adminReset` emit all events with required fields. However, `routes/baselines.ts` never calls runManual or adminReset, so `baseline.manual.applied` and `baseline.admin_reset` are unreachable in production today. Closing REQ #20 closes this. |

### §7 — Reporting Agent delta integration

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 32 | §7 / §8 P5 / §9 | `getBaselineForSubaccount(subaccountId)` helper in `baselineHelper.ts` | PASS | `server/services/reportingAgent/baselineHelper.ts:26-60`; companion `computeDelta` for pure delta calculation. |
| 33 | §7 / §8 P5 | Extend `generate_portfolio_report` skill to compute delta per metric and include "since onboarding" section | PASS | `server/services/intelligenceSkillExecutor.ts:8` imports; lines 655, 666-674, 706, 719 wire `sinceOnboarding` into the report payload for each account that has a baseline. |
| 34 | §7 | Honest-gap narration: if metric was `unavailable` at baseline, narrate "first measurement is today's value" | PASS (data layer) | `computeDelta` returns `unavailableAtBaseline: true` and null delta/pct for missing baseline metrics, enabling the template to narrate honestly. Whether the natural-language template wording matches the spec phrase is a soft correctness check — the data shape supports it. |

### §10 / §9 Tests — Hard-invariant coverage

| # | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 35 | §10 / §9 Tests | `baselineInvariants.test.ts` exercises UNIQUE-index, admin-reset-preserves-history, manual-vs-auto concurrency, Date.now() static check | PASS (with caveat) | `server/services/__tests__/baselineInvariants.test.ts` exercises invariants 1, 3, 5, 6, 7. DB-backed parts (invariant 1 unique-index assertion, invariant 4 metric concurrency, invariant 5 row preservation, invariant 7 NULL semantics) are documented as `it.todo` in `captureBaselineIntegration.test.ts:19-27` and skipped pending DATABASE_URL fixtures — a pre-existing repo gap noted in the test header. The invariant-3 grep is single-line and so doesn't catch the REQ #20 violation; the invariant-6 grep only checks service files (the spec also names `baselineMetricReaders/`, but the test list is narrower). Both noted in deferred items / Notes section. |
| 36 | §9 Tests | `baselineMetricReaders.test.ts` covers per-metric readers + failure classifications | PASS | `server/services/__tests__/baselineMetricReaders.test.ts` exercises transformXxxRows for 3 readers + verifies AVAILABLE_METRIC_SLUGS coverage in `METRIC_READERS`. |
| 37 | §9 Tests | `baselineReadinessService.test.ts` covers readiness combinations + settle-window edge cases | PASS | `server/services/__tests__/baselineReadinessService.test.ts` drives `evaluateReadiness` directly with canned rows; covers 0-connectors, 2-polls, settle on/off, 2-of-4 metric variants. |
| 38 | §9 Tests | `baselineHelper.test.ts` (reportingAgent) covers delta computation cases | PASS | `server/services/reportingAgent/__tests__/baselineHelper.test.ts` exercises `computeDelta` with full / partial / unavailable / no-baseline inputs. |

---

## Mechanical fixes applied

[FIXED] REQ #21 — `Date.now()` removed from `baselineMetricReaders/getRevenueLast30d.ts`
  File: `server/services/baselineMetricReaders/getRevenueLast30d.ts`
  Lines: 1, 22-34 (and a small comment update in §10 reference text)
  Spec quote: *"Static check (grep for `Date.now()` in `server/services/captureBaselineService.ts`, `baselineMetricReaders/`, `baselineReadinessService.ts`) returns zero hits in CI."*
  Change: replaced JS-side `new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)` filter with Postgres-side `sql\`${canonicalMetricHistory.computedAt} >= now() - interval '30 days'\``; switched the import from `gte` to `sql`. The 30-day window is now anchored on the DB clock per the §3/§10 timestamp invariant. Verified with grep across all 3 spec-named paths — zero hits remain.

Re-verification: `npm run lint` returns 0 errors (868 pre-existing warnings); `npm run typecheck` passes both tsconfigs.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

See `tasks/todo.md` § "Deferred from spec-conformance review — baseline-capture (2026-05-05)":

- REQ #20 — `routes/baselines.ts` bypasses §5.2 single-writer rule; manual + admin-reset endpoints write directly to `subaccount_baselines` instead of calling `captureBaselineService.runManual` / `.adminReset`. Subsumes REQ #27 (admin-reset transactional pattern + `baseline_version` bump) and REQ #31 (missing `baseline.manual.applied` / `baseline.admin_reset` event emissions in production). Knock-on list of 7 sub-issues enumerated in the deferred entry, including `new Date()` use for `capturedAt` / `resetAt` which violates the §3 timestamp invariant and will disappear when the route delegates to the service.
- REQ #24 — Manual entry validation does not enforce the `lead_count ≤ all-time-high` cap server-side, and currency-unit requirement is not coupled to slug unit. Spec doesn't pin the historical-source table for the cap → directional.

---

## Files modified by this run

- `server/services/baselineMetricReaders/getRevenueLast30d.ts` (mechanical fix for REQ #21)
- `tasks/todo.md` (appended "Deferred from spec-conformance review — baseline-capture (2026-05-05)" section with 2 directional items)
- `tasks/review-logs/spec-conformance-log-baseline-capture-2026-05-05T05-36-34Z.md` (this log)

---

## Notes on test gaps and grep weakness

Two observations the conformance run surfaced about the test surface itself — recorded for future hardening, not as additional REQs:

1. **`baselineInvariants.test.ts` invariant-3 grep is single-line.** The pattern `tx\.(insert|update|delete)\(subaccountBaselines\)` will not catch chained Drizzle calls written as `tx\n.update(subaccountBaselines)`. The current REQ #20 violation in `routes/baselines.ts:138-141` is invisible to the gate. Strengthening the gate is part of the suggested fix in the deferred item.

2. **`baselineInvariants.test.ts` invariant-6 file list narrower than spec.** The test grep covers `captureBaselineService.ts`, `baselineReadinessService.ts`, `baselineReadinessPure.ts`, `baselineSubscriberService.ts`, `baselineSubscriberPure.ts`, `captureBaselineJob.ts`, `evaluateAllPendingBaselines.ts`. The spec §10 invariant list names *"`captureBaselineService.ts`, `baselineMetricReaders/`, `baselineReadinessService.ts`"*. The `baselineMetricReaders/` directory is missing from the test file list — which is what allowed `getRevenueLast30d.ts:23`'s `Date.now()` to slip past the gate. After the mechanical fix in this run, the tree is clean again, but the test file list should be widened to include `baselineMetricReaders/` so a future regression is caught automatically.

3. **`captureBaselineIntegration.test.ts` is currently `describe.skip`.** All DB-backed integration assertions for invariants 1, 4, 5, 7 are `it.todo` placeholders, gated on a `DATABASE_URL` test convention that doesn't exist in this repo. The progress note in the test header acknowledges the gap. Not a spec-conformance violation per se (the spec calls for tests but doesn't pin test infrastructure), but worth surfacing — the §10 hard-invariant guarantees rest on these unit/grep stand-ins until the integration suite is reachable.

These notes are diagnostic, not blocking; no separate `tasks/todo.md` entry created — they are folded into the suggested approach for REQ #20.

---

## Next step

NON_CONFORMANT — 2 directional gaps must be addressed by the main session before `pr-reviewer`:

1. **REQ #20** is the high-impact one. Until the route delegates to `captureBaselineService.runManual` / `.adminReset`, the §5.2 single-writer rule, the §6 admin-reset history-preservation invariant, and the §6a `baseline.manual.applied` / `baseline.admin_reset` telemetry are all violated in production. Strongly recommend resolving before merge.
2. **REQ #24** lead-count-cap is a smaller follow-up that can be deferred if needed; it requires confirming the historical-source table and window with the spec author.

After the mechanical fix in this run, the §10 timestamp invariant grep is clean; the rest of the implementation conforms tightly to the spec at the schema, service, event-registration, reporting-agent, and test layers.

Re-running `pr-reviewer` after addressing the two deferred items is recommended. `npm run lint` (0 errors, 868 pre-existing warnings) and `npm run typecheck` both pass on the post-fix tree.

