# IEE-on-e2b Rollout

> **Migration complete 2026-05-17.** The standalone IEE worker process has been retired; production IEE workloads now execute inside e2b sandboxes orchestrated from the main server. The cost-rollup cron moved into `server/jobs/ieeCostRollupDailyJob.ts`. See `tasks/builds/iee-worker-retirement/spec.md` for the cleanup record. Sections below remain useful as an architectural decision record for the migration.

This document describes the first-launch criteria, dogfood gate, rollout-approval mechanic, alarm thresholds, and post-launch cost-report cadence for the IEE browser feature on e2b sandboxes.

## First-launch criteria

> **Blocked today.** This first-launch checklist is gated by IEE-DEF-7 (production network policy), IEE-DEF-4 (CI sandbox-template build pipeline + real `PUBLISHED_VERSION` digest), IEE-DEF-5 (real Playwright executor in the harness), and the e2b SDK install (SANDBOX-DEF-EGRESS-MECH). Until those land, the iee-browser PR is **schema + settings + dispatch seam + scaffold only** — not production browser execution. The criteria below describe the post-wiring state.

Before the first subaccount is approved for rollout, confirm:

1. CI passes on the `claude/migrate-browser-e2b-snI99` branch (lint, typecheck, build, all static gates including `verify-no-do-references.sh`).
2. Manual smoke test: create an `iee_browser` task and confirm the e2b sandbox provisions and the run finalises with a cost row in `llm_requests` (`source_type='sandbox_compute'`). The `browser_warm_sessions` table records a row **only when a warm session is leased**: the dispatcher decides `warm_leased` vs `cold_start` at task start, and only `warm_leased` writes a row (lifecycle `available → leased → terminated`). Cold-start tasks launch a fresh sandbox without touching `browser_warm_sessions` — smoke validation against this table is conditional on the warm pool being non-empty for that subaccount. Empty warm pool at first-task time is normal.
3. `subaccount_iee_browser_settings` row created for the dogfood subaccount with `status='on'` and `rollout_approved=true` via the admin rollout route (`POST /api/admin/iee-browser/rollout-approval/:subaccountId`).

## Dogfood gate

Rollout is operator-gated per subaccount. The `rollout_approved` flag on `subaccount_iee_browser_settings` is the gate. The admin UI tab (Operator > IEE browser) surfaces the status field; the system-admin rollout route controls the approval flag separately.

- Start with one internal (dogfood) subaccount.
- Monitor `iee_browser.task_cost_anomaly` and `iee_browser.subaccount_cost_anomaly` incidents for 7 days.
- If no cost-anomaly incidents fire and task success rate is acceptable, expand rollout.

## Alarm thresholds (defaults)

| Alarm | Default ceiling | Configurable |
|---|---|---|
| Per-task cost | $1.00 (100 cents) | Yes -- `perTaskCostCeilingCents` in Operator settings |
| Per-subaccount daily cost | $5.00 (500 cents) | Yes -- `perSubaccountDailyCostCeilingCents` in Operator settings |

Alarms are recorded as incidents (`recordIncident()`) with idempotency keys that prevent duplicate fires for the same task or the same subaccount-day-ceiling combination.

## Post-launch cost-report cadence

- **Month 1 (2026-06-12):** Complete `tasks/builds/iee-browser-on-e2b/cost-report-month-1.md` from observed production traffic.
- Subsequent months: ad-hoc review of the incident log and `llm_requests` rollup until a formal reporting cadence is established.

## Rollback

If a critical bug is found post-launch:

1. Set `status='off'` or `rollout_approved=false` on affected `subaccount_iee_browser_settings` rows via the admin route. New tasks will not dispatch to e2b.
2. In-flight tasks will complete or fail on their current sandbox. No mid-flight interruption.
3. For a full substrate rollback, revert the `claude/migrate-browser-e2b-snI99` merge commit (the DO retirement commit `e3a001be` is the one-way door; reverting the merge restores the deleted worker files).
