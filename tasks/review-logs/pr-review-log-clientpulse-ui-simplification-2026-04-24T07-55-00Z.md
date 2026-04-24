# PR Review Log — feat/clientpulse-ui-simplification

**Reviewed:** 2026-04-24T07:55:00Z
**Branch:** feat/clientpulse-ui-simplification vs main
**Scope:** 57 files (~5,500 / ~700 lines). 8-phase ClientPulse UI simplification — backend idempotent approve/reject + resolvedUrl + activity additive fields + high-risk endpoint + drilldown pendingIntervention + eventCount; shared hooks/utilities (telemetry.ts, formatDuration.ts, resolvePulseDetailUrl.ts, usePendingIntervention.ts); Home DashboardPage redesign + PendingApprovalCard + WorkspaceFeatureCard + UnifiedActivityFeed; ClientPulseDashboardPage simplification + SparklineChart + NeedsAttentionRow + ClientPulseClientsListPage; feature trims (PendingHero, drilldown ?intent, Settings 5-tab); route surgery (PulsePage deleted, App.tsx "/"→DashboardPage, /admin/pulse redirects, Layout.tsx nav); run meta bar on AgentRunLivePage.
**Spec conformance:** CONFORMANT (per `tasks/review-logs/spec-conformance-log-clientpulse-ui-simplification-2026-04-24T07-09-46Z.md`).

---

## Contents

- Blocking Issues (B1–B3)
- Strong Recommendations (S1–S7)
- Non-Blocking Improvements (N1–N8)
- Verdict

---

## Blocking Issues (must fix before merge)

### B1. Duplicate `export function addNullAdditiveFields` — server fails to compile AND will not run

**File:** `server/services/activityServicePure.ts` lines 54-68 and 110-124.

The same function is declared and exported twice in the same module, with identical signature and identical body:

```ts
// Line 54:
export function addNullAdditiveFields(): { triggeredByUserId: null; ... } { ... }
// Line 110 (again):
export function addNullAdditiveFields(): { triggeredByUserId: null; ... } { ... }
```

**Impact:**
- `tsc -p server/tsconfig.json` (npm run `build:server`) will fail with **TS2393 "Duplicate function implementation"** and TS2300 "Cannot redeclare block-scoped variable `addNullAdditiveFields`".
- `tsx`/Node runtime will throw `SyntaxError: Identifier 'addNullAdditiveFields' has already been declared` at module load → **the server never starts** because `activityServicePure.ts` is imported transitively by `activityService.ts` → `routes/activity.ts` → `routes/index.ts`.
- `npm run test:unit` will also fail at the same parse step (the unit test file `server/services/__tests__/activityService.test.ts` line 14 imports this symbol).

`spec-conformance` passed because it verifies spec items, not compile status. Any developer who runs `npm run dev` or `npm run build` on this branch will immediately hit this.

**Fix:** Delete the second declaration (lines 104-124, including the preceding duplicate JSDoc comment block). Keep the first copy (lines 48-68) in its original position above the sort helpers.

---

### B2. `/api/review-items/:id/reject` returns a non-standard error envelope

**File:** `server/routes/reviewItems.ts` lines 193-198.

```ts
if (!comment || String(comment).trim().length === 0) {
  res.status(400).json({
    error: 'A comment is required when rejecting an action.',
    code: 'COMMENT_REQUIRED',
  });
  return;
}
```

The project's error envelope convention (per `server/lib/asyncHandler.ts`) is `{ error: { code, message }, correlationId }`. This handler emits a bare string for `error` and a top-level `code` instead. Two consequences:

- Clients that parse `err.response.data.error.code` / `.message` — the pattern used by the new `usePendingInterventionPure.ts` (lines 43-50) — will silently fall through to the generic `extractMessage` branch and surface a useless "Request failed with status code 400" toast instead of the specific "A comment is required" message.
- Inconsistent with every other 4xx in this branch (e.g. `clientpulseReports.ts` lines 105, 115 use `{ errorCode, message }` top-level but at least have a `message` field).

**Recommendation:** Throw instead of write — `throw { statusCode: 400, message: 'A comment is required when rejecting an action.', errorCode: 'COMMENT_REQUIRED' }` — which lets `asyncHandler` format it consistently with every other error on the branch. Alternatively, inline `res.status(400).json({ error: { code: 'COMMENT_REQUIRED', message: '…' }, correlationId: req.correlationId })`.

Note: this likely pre-dates this PR's changes (pattern was used in the prior reject handler), but the PR touched the same handler and the new client hook depends on the error-code extraction path, so the mismatch is now visibly exposed — worth fixing in the same change.

---

### B3. Unvalidated cursor `limit` / `windowDays` query params (medium severity, but blocking because of silent misbehaviour)

**Files:**
- `server/routes/clientpulseReports.ts` lines 95-96 (`limit` from `/api/clientpulse/high-risk`)
- `server/routes/clientpulseDrilldown.ts` lines 54, 73 (`windowDays`, `limit`)

`Number.parseInt(String(req.query.limit ?? '7'), 10)` is applied and checked for `isFinite && > 0`. That's fine for numeric junk, but:

- `limit=0` falls through to the default (7) silently. Caller may expect an empty page.
- `limit=-5` → `isFinite(-5) && -5 > 0` is false → default 7. Silent clamp.
- `limit=999999` → passes the finite/positive check and is then clamped to `MAX_LIMIT (25)` inside `applyPagination`. Clamp happens twice, once silently.
- `windowDays=-30` → `isFinite(-30)` → true → `-30` is forwarded as-is to `new Date(Date.now() - (-30)*...)` → **future date** → drilldown silently returns 0 band transitions.

**Fix:** Reject non-positive or unreasonable values at the route edge with a 400 `{ statusCode: 400, message: 'limit must be between 1 and 100' }` (or equivalent). Pattern already exists in the same handler for `band` (lines 103-107) — apply it consistently for numeric params.

---

## Strong Recommendations

### S1. `EXTRACT(WEEK FROM ...)` sorts wrong across year boundaries — sparkline data misordered in early January

**File:** `server/services/clientPulseHighRiskService.ts` lines 267, 274.

```sql
SELECT ..., EXTRACT(WEEK FROM hs.observed_at)::int AS week_bucket
...
GROUP BY hs.subaccount_id, week_bucket
ORDER BY hs.subaccount_id, week_bucket ASC
```

`EXTRACT(WEEK ...)` returns ISO week number **without year**. When the 28-day window spans a year boundary (last ~2 weeks of December and first ~2 weeks of January), rows come back ordered as `1, 2, 52, 53` — with the oldest data appearing last in the sparkline, producing a visually-incorrect trend line for two weeks of the year.

**Fix:** Use `DATE_TRUNC('week', hs.observed_at)` as the bucket (orders correctly across year boundaries and also returns a timestamp the client can use for tooltips if ever needed).

**Missing test (Given/When/Then):**
> Given a subaccount with health snapshots on 2025-12-22, 2025-12-29, 2026-01-05, 2026-01-12
> When `getPrioritisedClients` is invoked with `NOW()` frozen to 2026-01-15
> Then `sparklineWeekly` contains 4 values in chronological order (oldest first: Dec 22 bucket, Dec 29 bucket, Jan 5 bucket, Jan 12 bucket).

### S2. Fallback cursor secret warning fires on every request when `PULSE_CURSOR_SECRET` is unset

**File:** `server/services/clientPulseHighRiskService.ts` lines 162-169.

`getCursorSecret` is called from inside `applyPagination`, which runs on every `/api/clientpulse/high-risk` request. With the env var unset (dev / local), every request logs a WARN, polluting logs. Consider a one-shot process-level warning (module-init check + cached flag) or a startup assertion in production. Not blocking — cosmetic — but the current noise trains operators to ignore the warning entirely.

### S3. `DashboardPage` error states are silent — `/api/pulse/attention`, `/api/clientpulse/health-summary`, `/api/agent-activity/stats`, `/api/agents` all silently return `null` on failure

**File:** `client/src/pages/DashboardPage.tsx` lines 34-46. **File:** `client/src/pages/ClientPulseDashboardPage.tsx` lines 57-71.

Every fetch in the dashboard `Promise.all` swallows errors with `console.error` and returns a null data shape. On a real 500, the dashboard looks identical to the empty state. Track `hasError` per source; surface an inline banner when any critical source fails.

### S4. `DashboardPage` telemetry fires *before* navigation, even if the user backs out

**File:** `client/src/pages/DashboardPage.tsx` lines 62-65. Event names (`pending_card_approved`) imply the action happened, but the button only navigates. Rename to `pending_card_approve_clicked` / `pending_card_reject_clicked` or move the fire site into the actual approve/reject success handler on the drilldown page.

### S5. `UnifiedActivityFeed` receives `orgId` prop but never uses it — stale API

**File:** `client/src/components/UnifiedActivityFeed.tsx` line 229 (`orgId: _orgId`). Remove the prop or use it for telemetry tagging.

### S6. No test coverage for the idempotent approve/reject on `reviewService.ts` (backend contract)

The new pre-check-then-transaction pattern in `approveItem` / `rejectItem` has race-handling (`idempotent_race` branch), but the integration path is not covered. Spec §6.2.1 GWTs are not exercised.

### S7. `ClientPulseDashboardPage` socket merge: partial server payload overwrites known state

**File:** `client/src/pages/ClientPulseDashboardPage.tsx` lines 74-79. Validate keys against `HealthSummary`'s known set before merging; only toast when at least one relevant field changed.

---

## Non-Blocking Improvements

### N1. Greeting hour computed once at render — stale past midnight/noon/17:00

### N2. `formatLastAction` produces "create_task · 0d ago" for today — awkward copy

### N3. `NeedsAttentionRow` shows `↑0 / 7d` when delta is 0 — visually louder than necessary

### N4. `PendingApprovalCard` has three unconditionally-rendered buttons when `isDisabled` — could split into empty-state variant

### N5. `WorkspaceFeatureCard` CTA arrow always rendered — noted only

### N6. `resolvePulseDetailUrl.ts` WARN on every call — intentional per JSDoc, fine

### N7. `clientPulseHighRiskService.getPrioritisedClients` — 6 sequential DB round-trips, could parallelise after `subIds` known

### N8. Minor duplication between client `resolvePulseDetailUrl.ts` and server `pulseService._resolveUrlForItem` — prefix shapes differ slightly (`run` vs `failed_run`, `health` vs `health_finding`)

---

## Verdict

**BLOCK — B1 is a hard build failure.** The duplicate `addNullAdditiveFields` export makes the server fail to start and the TypeScript build fail. B2 and B3 are lower-severity but both touch request/response contracts that the new client hooks and dashboard depend on. S1 is a correctness bug that only manifests across year boundaries but will produce visually-wrong sparklines for ~2 weeks of the year.

Fix B1, B2, B3, and S1 in-session, re-run `npm run build:server` + `npm run build:client` + the unit tests, then the branch is ready to merge. S2–S7 and N1–N8 can be logged to `tasks/todo.md` and picked up post-merge — none of them block PR creation.
