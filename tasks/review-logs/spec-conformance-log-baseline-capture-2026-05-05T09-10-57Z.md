# Spec Conformance Log — baseline-capture (re-run)

**Spec:** `docs/baseline-capture-spec.md`
**Spec commit at check:** `12c38cdc` (unchanged since prior run)
**Branch:** `claude/baseline-capture`
**Base:** `12c38cdc` (merge-base with main; full implementation now lives on the branch in two commits)
**Scope:** all-of-spec (caller confirmed re-verification of full requirements list; all 12 implementation chunks complete and committed)
**Changed-code set:** 58 files (committed across `5e6616b4` + `0f66f252`)
**Run at:** 2026-05-05T09:10:57Z
**Prior run:** `tasks/review-logs/spec-conformance-log-baseline-capture-2026-05-05T05-36-34Z.md` (NON_CONFORMANT, 2 directional gaps)

---

## Summary

- Requirements extracted:     38
- PASS:                       38
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT

The 2 directional gaps from the prior run (REQ #20 single-writer rule and REQ #24 manual-entry validation) were closed by the development session before this re-run. The full 38-item checklist is now PASS. No new mechanical fixes required and no new directional gaps surfaced.

---

## Sections

- What changed since the prior run
- Re-verification of REQ #20 (§5.2 single-writer rule)
- Re-verification of REQ #24 (manual-entry validation)
- Re-verification of REQ #27 + REQ #31 (subsumed by #20)
- Spot-check of the rest of the checklist (regression-only)
- Files modified by this run
- Next step

---

## What changed since the prior run

The prior log (`spec-conformance-log-baseline-capture-2026-05-05T05-36-34Z.md`) was authored against an uncommitted working tree and recorded NON_CONFORMANT with 2 directional gaps (#20, #24) plus subsumed sub-issues (#27, #31). The development session has since:

1. **Committed `5e6616b4`** (`feat(baseline-capture): F3 opening-state baseline capture at sub-account onboarding`). Contains the full implementation surface — including the corrected `routes/baselines.ts` that delegates manual + admin-reset to `captureBaselineService.runManual` / `.adminReset`, and the hardened `baselineInvariants.test.ts` with both an SQL-level grep and a multi-line Drizzle-aware grep.
2. **Committed `0f66f252`** (`fix(baseline-capture): close REQ #24 — manual entry validation gaps`). Adds:
   - `shared/schemas/baselineManualForm.ts` superRefine: any `cents`-unit slug submitted without a 3-char ISO-4217 currency code is rejected with issue path `currency`.
   - `server/services/captureBaselineService.ts` `runManual`: SELECT MAX(value::numeric) FROM canonical_metric_history INNER JOIN canonical_accounts before the metric upsert loop; throws `{ statusCode: 400, errorCode: 'LEAD_COUNT_EXCEEDS_HISTORICAL_HIGH' }` when the manual lead_count exceeds the historical max. No-op when no history exists yet.
   - `shared/schemas/__tests__/baselineManualForm.test.ts` (14 cases).
3. **Updated `tasks/todo.md`** — REQ #20 + REQ #24 entries marked `[x]` with closure notes pointing at the resolving commits.

The schema, migrations, RLS configuration, tracing event registry, capture-service core flow, readiness service, subscriber, fallback cron, metric readers, reporting-agent helper, manual / reset / badge components, and the rest of the implementation surface are unchanged versus the source tree the prior log verified — REQs #1-19, #22-23, #25-26, #28-30, #32-38 remain PASS for the same evidence the prior log cited.

---

## Re-verification of REQ #20 — §5.2 single-writer rule (was DIRECTIONAL_GAP) → PASS

`server/routes/baselines.ts` was rewritten in `5e6616b4`:

- **Manual entry handler** (`POST /api/subaccounts/:subaccountId/baseline/manual`, lines 80-108): parses body via `manualBaselineFormSchema.safeParse`, calls `captureBaselineService.runManual({ organisationId: req.orgId!, subaccountId, userId: req.user!.id, metricInputs: parsed.data.metrics })`. Errors with `statusCode` are mapped via `handleServiceError`. No direct write to either baseline table.
- **Admin reset handler** (`POST /api/admin/subaccounts/:subaccountId/baseline/reset`, lines 116-156): parses body, looks up `organisationId` from `subaccountBaselines` (sysadmin routes bypass org-scoped middleware), calls `captureBaselineService.adminReset({ organisationId, subaccountId, userId: req.user!.id, reason: parsed.data.reason })`. No direct write.

The `baselineInvariants.test.ts` invariant 3 now has both:
- SQL-level grep: `(INSERT INTO subaccount_baselines|UPDATE subaccount_baselines)` excluding `__tests__/`.
- Drizzle-level grep: `\.(insert|update|delete)\(subaccountBaselines` excluding `__tests__/`. **This catches multiline chained calls** of the form `tx\n.update(subaccountBaselines)` — which was the gap the prior single-line grep missed.

`SINGLE_WRITER_ALLOWED = ['server/services/captureBaselineService.ts', 'server/services/subaccountOnboardingService.ts']`. Both grep variants pass on the current tree.

Confirmed via `npx vitest run server/services/__tests__/baselineInvariants.test.ts` — 7 tests pass including both single-writer assertions.

---

## Re-verification of REQ #24 — Manual entry validation (was DIRECTIONAL_GAP) → PASS

Two-part fix landed in `0f66f252`:

- **Currency required for cents-unit metrics.** `shared/schemas/baselineManualForm.ts:13-22` adds `.superRefine` to `manualMetricInputSchema`: when `metricMeta(slug).unit === 'cents'`, an absent or empty `currency` produces a custom Zod issue at path `currency` with message `currency is required for metric '<slug>' (unit=cents)`. Path identifies which metric failed in array submissions.
- **Lead count cap.** `server/services/captureBaselineService.ts:251-277` (`runManual`): when the input array contains a `lead_count` entry, runs `SELECT MAX(value::numeric)::text AS high FROM canonical_metric_history cmh INNER JOIN canonical_accounts ca ON ca.id = cmh.account_id WHERE ca.organisation_id = ? AND ca.subaccount_id = ? AND cmh.metric_slug = 'lead_count'`. If the manual numeric exceeds the historical max, throws `{ statusCode: 400, errorCode: 'LEAD_COUNT_EXCEEDS_HISTORICAL_HIGH', message: 'lead_count (X) exceeds historical maximum (Y)' }`. Lookup is org-scoped via `getOrgScopedDb` (RLS app.organisation_id GUC in effect). Returns silently / no-op when no history exists, so subaccounts with no canonical observations yet are not blocked — matches the §6 "lead count ≤ all-time-high seen in history" wording without arbitrary lower bounds when history is empty.

The 14-case schema test (`shared/schemas/__tests__/baselineManualForm.test.ts`) covers cents-without-currency reject, cents-with-currency accept, count-without-currency accept, percent-without-currency accept, negative reject, zero accept, 2-char and 4-char currency reject, form-level empty-array reject, mixed-types accept, invalid-bubbles-up-from-array reject. `npx vitest run` — 14/14 pass.

The `nonnegative()` guard on `numeric` in `manualMetricInputSchema` covers the "no negative values" clause of §6.

---

## Re-verification of REQ #27 + REQ #31 (subsumed by #20) → PASS

**REQ #27 — admin-reset transactional pattern.** `captureBaselineService.adminReset` (lines 350-404) opens its own `db.transaction`, runs `SELECT set_config('app.organisation_id', ..., true)` to satisfy the FORCE RLS GUC, selects the prior baseline (excluding `status='reset'`), updates it to `status='reset'` with `reset_at=now()` / `reset_by_user_id` / `admin_reset_reason`, then inserts a new row with `baseline_version+1` and `status='pending'`. Both UPDATE+INSERT are in the same transaction. Emits `baseline.admin_reset` with prior/new ids, prior/new versions, user_id, reason. With REQ #20 closed, the §10 invariant *"after reset, the prior baseline row exists with `status='reset'` AND a new row exists with `baseline_version+1` AND `status='pending'`"* is now reachable in production.

**REQ #31 — `baseline.manual.applied` / `baseline.admin_reset` events.** `captureBaselineService.runManual:337-342` emits `baseline.manual.applied` with `subaccount_id`, `baseline_id`, `user_id`, `metrics_overridden[]` (collected from the upsert loop). `captureBaselineService.adminReset:392-400` emits `baseline.admin_reset` with `subaccount_id`, `prior_baseline_id`, `new_baseline_id`, `prior_version`, `new_version`, `user_id`, `reason`. Both event names are registered in `server/lib/tracing.ts` (per REQ #30, unchanged). With the route now delegating to these methods, both events emit on the corresponding HTTP transitions.

---

## Spot-check of the rest of the checklist (regression-only)

The remaining 34 REQs were verified PASS in the prior run against the same source tree. Spot-check confirms no regression:

- **Schema (REQ #1-7):** migrations 0280/0281/0282 + Drizzle schemas + RLS protected-table registration + canonicalDictionary entries unchanged in `5e6616b4`/`0f66f252`. `npx vitest run server/services/__tests__/baselineInvariants.test.ts` invariants 1 (UNIQUE index + WHERE clause + RLS policy) pass.
- **Opt-in setting + metric registry (REQ #8-9):** `shared/schemas/subaccount.ts` and `shared/constants/baselineMetrics.ts` unchanged.
- **Readiness service + trigger (REQ #10-16):** `baselineReadinessService.ts`, `baselineReadinessPure.ts`, `subaccountOnboardingService.markBaselinePending`, `connectorPollingService.ts` event emit, `baselineSubscriberService.ts`, `evaluateAllPendingBaselines.ts`, `queueService.ts` cron schedule — all unchanged.
- **Capture service core (REQ #17-19):** `captureBaselineService.run` flow (lines 25-221) and `baselineRetryClassifierPure.ts` retry classification unchanged. `0f66f252` only adds the lead-count cap inside `runManual` (lines 251-277); the main capture flow (`run`) is untouched.
- **Date.now() invariant (REQ #21):** Re-grep across `captureBaselineService.ts`, `baselineMetricReaders/`, `baselineReadinessService.ts` returns zero hits. `npx vitest run` — invariant 6 passes (632ms; widened to include `baselineMetricReaders/` directory after the prior run's mechanical fix).
- **Metric readers (REQ #22):** `baselineMetricReaders/registry.ts` and the 5 implemented readers + UNAVAILABLE_INTEGRATION_NOT_CONNECTED unchanged since `5e6616b4`.
- **Manual entry + admin reset UI (REQ #23, #25, #26, #28, #29):** `<ManualBaselineForm>`, `<AdminBaselineResetButton>` (sysadmin gated), `<BaselineStatusBadge>`, `AdminSubaccountDetailPage` wiring all unchanged. The route handlers at `routes/baselines.ts` are different (now delegating per REQ #20) but the surfaces themselves still wire correctly.
- **Tracing registry (REQ #30):** `server/lib/tracing.ts` unchanged — all 9 baseline events + `connector.sync.complete` registered.
- **Reporting agent (REQ #32-34):** `baselineHelper.ts` + `intelligenceSkillExecutor.ts` portfolio-report wiring unchanged.
- **Test surface (REQ #35-38):** `baselineInvariants.test.ts` is hardened (multi-line Drizzle grep + `baselineMetricReaders/` directory in invariant 6 file list) versus the prior run's diagnostic notes — both pre-existing weaknesses are closed. `baselineMetricReaders.test.ts`, `baselineReadinessService.test.ts`, `baselineHelper.test.ts` unchanged.

`npm run lint` — 0 errors, 868 pre-existing warnings (unchanged). `npm run typecheck` — clean.

---

## Files modified by this run

- `tasks/review-logs/spec-conformance-log-baseline-capture-2026-05-05T09-10-57Z.md` (this log)

No mechanical fixes applied. No `tasks/todo.md` entries appended (zero deferred items). The prior run's `tasks/todo.md` "Deferred from spec-conformance review — baseline-capture (2026-05-05)" section already shows both items resolved with closure notes; no further bookkeeping needed.

---

## Next step

CONFORMANT — proceed to `pr-reviewer`. The spec is fully implemented and verified.

`pr-reviewer` should run on the full branch (`12c38cdc...0f66f252` = both commits). No changed-code-set expansion happened during this conformance run, so `pr-reviewer`'s scope is the same set the prior run looked at.

After `pr-reviewer`, the recommended sequence per `CLAUDE.md` § *Review pipeline (mandatory order)* is:
- (Optional) `dual-reviewer` if Codex is available locally and the user explicitly asks.
- (Optional) `adversarial-reviewer` if the diff matches the security surface (this branch touches RLS-protected tables, tenant isolation via `getOrgScopedDb`, and a sysadmin-only admin-reset path — likely qualifies).
