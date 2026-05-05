# Progress: Baseline Capture at Sub-Account Onboarding

**Spec:** `docs/baseline-capture-spec.md`
**Plan:** `tasks/builds/baseline-capture/plan.md`
**Branch:** `claude/baseline-capture`
**Worktree:** `../automation-v1.baseline-capture`
**Migrations claimed:** `0278` (subaccount_baselines), `0279` (subaccount_baseline_metrics), `0280` (RLS + canonical dictionary)
**Status:** REVIEW COMPLETE — all 12 chunks built, spec-conformance + pr-reviewer run, all blocking findings fixed 2026-05-05. Migrations re-allocated to 0280/0281/0282 (0278/0279 were taken by oauth-state and task-events; high-water at plan time was 0279, not 0277 as initially stated).

## Upstream dependencies

| Dependency | Status |
|---|---|
| F1 `subaccount-artefacts` (migration 0277) | **MERGED — PR #263, 2026-05-05** |
| GHL Module C OAuth (`connector_location_tokens`) | **SHIPPED — PR #254, 2026-05-03** |
| F2 `subaccount-optimiser` | Fully independent — no coordination needed |

## Phases

| Phase | Chunks | Status | Notes |
|-------|--------|--------|-------|
| Phase 1 — Schema (3 tables) | 1A, 1B, 1C | COMPLETE | Migrations 0280/0281/0282 (re-allocated). |
| Phase 2 — Readiness + sync-complete event | 2A, 2B | COMPLETE | Event emit + subscriber + daily fallback. |
| Phase 3 — Capture service + retry/failure | 3A, 3B, 3C | COMPLETE | Per-metric readers + state machine + retry job + invariant tests. |
| Phase 4 — Manual entry UI + admin reset | 4A, 4B | COMPLETE | Form + validation + sysadmin reset flow + page wiring. |
| Phase 5 — Reporting Agent delta | 5 | COMPLETE | Helper + portfolio report extension. |
| Phase 6 — Verification + doc sync | 6 | COMPLETE | Lint, typecheck, docs updated. |
| Review pipeline | spec-conformance + pr-reviewer | COMPLETE | All blocking findings fixed (see decisions log). |

## Decisions log

- **Migration re-allocation:** Plan reserved 0278/0279/0280. At execution start, 0278 (oauth_state_pending_run) and 0279 (task_events) were already taken. Re-allocated to 0280/0281/0282 per user instruction.
- **Pure-file extraction pattern:** `baselineReadinessPure.ts`, `baselineSubscriberPure.ts` created alongside their service counterparts so pure functions can be Vitest-tested without triggering env validation from the DB import chain.
- **`getOrgScopedDb` vs bare `db`:** Route-invoked services use `getOrgScopedDb`; pg-boss job handlers set up their own `db.transaction + set_config + withOrgTx` block (per `evaluateAllPendingBaselines.ts` pattern) so `getOrgScopedDb` works inside; cross-org admin sweeps use `withAdminConnection`. `captureBaselineJobHandler` uses this pattern. `adminReset` opens its own `db.transaction` with explicit `set_config` because sysadmin routes don't carry target-org ALS context.
- **`captureBaselineService` DB access:** All methods now use `getOrgScopedDb` (run + runManual) or self-contained `db.transaction + set_config` (adminReset). Bare `db` was the original design assumption for pg-boss handlers but was incorrect: `FORCE ROW LEVEL SECURITY` requires `app.organisation_id` even on the app-role pool.
- **Metric readers:** All five readers under `baselineMetricReaders/` changed from bare `db.` to `getOrgScopedDb()`. They run inside the `captureBaselineJob.ts`-scoped `withOrgTx` block.
- **Revenue slug:** `revenue_last_30d` confirmed. No existing Stripe ingestion writes rows for it yet; reader returns `unavailable/no_data_yet/retryable` (correct steady state until Stripe adapter lands).
- **GET active-baseline filter:** Added `status <> 'reset'` filter so the GET endpoint always returns the current active baseline, not the oldest historical row.
- **Subscriber call awaited:** `connectorPollingService` now awaits `baselineSubscriberService.onSyncCompleteEvaluateReadiness` (B6 fix) to avoid silently losing org ALS context on fire-and-forget.
- **connectorPollingService poll counter:** Changed from bare `db.execute` to `getOrgScopedDb().execute` with explicit `organisation_id` filter (B5 fix).

## Blockers

None.

## Out of scope (filed for later)

- Mailgun/Twilio/Google Business Profile metrics (no adapters; record as `unavailable`)
- MRR formula (Stripe adapter reads payments; deferred until proper subscription model)
- Recurring re-baseline (admin reset only for v1)
- Historical backfill (v1 = T0 only; full history lives in canonical_metric_history)
- REQ #24: `lead_count ≤ all-time-high` server-side cap (spec doesn't pin historical-source table; deferred to tasks/todo.md)
- B7 (race window in runManual — acceptable for v1; no concurrent capture typical in practice)
- B8 (1-metric opt-in → permanent fail; design decision pending)

## Deferred items from development

### Chunk 3C — Integration tests (captureBaselineIntegration.test.ts)

`server/services/__tests__/captureBaselineIntegration.test.ts` was created as a `describe.skip` block.

**Reason:** No integration test scaffolding exists in this repo (no `createTestDb` helper, no `TEST_DATABASE_URL` convention, no test env file). All seven integration-level invariant assertions are documented as `it.todo` entries inside the skip block.

**To run locally once a test DB exists:**
```bash
DATABASE_URL=<test_db_url> npx vitest run server/services/__tests__/captureBaselineIntegration.test.ts
```
