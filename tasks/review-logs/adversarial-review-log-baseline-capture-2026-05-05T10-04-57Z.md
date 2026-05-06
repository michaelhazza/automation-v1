# Adversarial Review Log

**Feature:** F3 Baseline Capture
**Branch:** claude/baseline-capture (HEAD `6e9bbdce` at review time; AR-1 + AR-2 fixed in `ca2c81ee`)
**Worktree:** C:\Files\Projects\automation-v1.baseline-capture\
**Reviewed:** 2026-05-05T10:04:57Z (review run); fixes applied 2026-05-05T20:02:43+10:00
**Reviewer:** adversarial-reviewer (claude-sonnet-4-6)
**Caller:** main session (re-running the §5.1.2 review pass after spec-conformance + pr-reviewer cycles)

**Verdict at review time:** HOLES_FOUND (1 likely-hole, 1 worth-confirming)
**Verdict after fixes (`ca2c81ee`):** ALL CLOSED. Static check Invariant 9 added to guard AR-1 from regression.

## Sections

- Files reviewed
- 1. RLS / Tenant Isolation
- 2. Auth & Permissions
- 3. Race Conditions
- 4. Injection
- 5. Resource Abuse
- 6. Cross-Tenant Data Leakage
- Additional observations (out-of-scope)
- Resolution summary

---

## Files reviewed

- `migrations/0280_subaccount_baselines.sql`
- `migrations/0281_subaccount_baseline_metrics.sql`
- `migrations/0282_baseline_rls_and_dictionary.sql`
- `server/routes/baselines.ts`
- `server/services/captureBaselineService.ts`
- `server/jobs/captureBaselineJob.ts`
- `server/jobs/evaluateAllPendingBaselines.ts`
- `server/services/baselineSubscriberService.ts`
- `server/services/baselineReadinessService.ts`
- `server/services/baselineRetryClassifierPure.ts`
- `server/services/baselineSubscriberPure.ts`
- `server/services/reportingAgent/baselineHelper.ts`
- `server/services/baselineMetricReaders/{registry,getLeadCount,getPipelineValue,getRevenueLast30d,getConversationEngagement,getOpenOpportunityCount}.ts`
- `server/services/subaccountOnboardingService.ts` (markBaselinePending only)
- `server/routes/subaccounts.ts` (markBaselinePending call site)
- `shared/schemas/baselineManualForm.ts`
- `shared/constants/baselineMetrics.ts`
- `server/config/rlsProtectedTables.ts`
- `server/db/schema/{subaccountBaselines,subaccountBaselineMetrics}.ts`
- `server/middleware/auth.ts`
- `server/lib/{orgScopedDb,adminDbConnection}.ts`
- `server/instrumentation.ts`
- `server/services/queueService.ts` (job registration)
- `server/lib/asyncHandler.ts`
- `client/src/components/baseline/AdminBaselineResetButton.tsx`
- `server/services/__tests__/baselineInvariants.test.ts`

---

## 1. RLS / Tenant Isolation

No findings. Both tables have ENABLE + FORCE ROW LEVEL SECURITY in migration 0282. The `subaccount_baselines` policy uses the canonical `organisation_id = current_setting('app.organisation_id', true)::uuid` pattern with null-guard. The `subaccount_baseline_metrics` policy correctly FK-walks to `subaccount_baselines` for its tenant check (no `organisation_id` column on the child table). Both policies carry a WITH CHECK clause. Both tables are registered in `server/config/rlsProtectedTables.ts:1044-1055`. All service-layer reads route through `getOrgScopedDb()` which requires an active `withOrgTx` context — enforced at layer A (throws `missing_org_context` if no ALS slot). The `adminReset` path correctly uses `withAdminConnection` + `SET LOCAL ROLE admin_role` for the cross-org lookup. No `req.user.organisationId` found in the baselines route; `req.orgId` is used throughout. The GET baseline query explicitly filters `status <> 'reset'`. `getBaselineForSubaccount` uses `inArray(status, ['captured','manual'])` which implicitly excludes `reset` rows. No `deletedAt` column exists; `status='reset'` is the soft-delete equivalent and is consistently filtered.

---

## 2. Auth & Permissions

No findings. GET baseline: `authenticate` + `requireOrgPermission(SUBACCOUNTS_VIEW)` + `resolveSubaccount`. POST manual: `authenticate` + `requireOrgPermission(SUBACCOUNTS_EDIT)` + `resolveSubaccount`. POST admin reset: `authenticate` + `requireSystemAdmin` (no `resolveSubaccount` — intentional; sysadmin targets any subaccount and the service resolves org internally). No webhook handlers in this feature. Client `AdminBaselineResetButton` returns null for non-sysadmin users (UI gate) but the real gate is server-side `requireSystemAdmin`. No permission check based on request body. No Zod-validated body value is ever used in place of `req.orgId` for scoping.

---

## 3. Race Conditions

**AR-1 (likely-hole) — Manual metric upserts commit on 409 due to HTTP transaction model.** RESOLVED in `ca2c81ee`.

- **File:line:** `server/services/captureBaselineService.ts:283-341` (metric upserts at 286-301, status update guard at 326-338); `server/middleware/auth.ts:106-140` (transaction lifecycle).
- **Attack scenario:** Two concurrent requests: (A) auto-capture pg-boss job, (B) user POST to `/baseline/manual`. Timeline: (1) B reads baseline `status='pending'` — passes the early guard at line 251. (2) A's UPDATE at line 62 commits, setting `status='capturing'`. (3) B's metric upserts at lines 286-301 execute and are queued for commit in B's Postgres transaction. (4) B's final status UPDATE at lines 326-338 (`WHERE status <> 'capturing'`) returns 0 rows. (5) `asyncHandler` catches the 409 throw, calls `res.status(409).json(...)`. (6) `res.finish` fires, resolving the `withOrgTx` promise. (7) `db.transaction()` in `authenticate` commits — B's metric upserts from step 3 are now in the database as `source='manual'`. (8) A continues its capture, executing its own ON CONFLICT DO UPDATE for the same metric slugs and overwriting B's committed rows. Net state: metrics transiently contain manual values during A's capture window. If A subsequently fails (transitions to `status='failed'` or back to `status='ready'`), the subaccount_baseline_metrics rows retain the committed manual values even though the user received a 409, and the baseline status never reached `status='manual'`. This creates an inconsistency: `status='ready'` or `status='failed'` with `source='manual'` metric rows. The spec designates `captureBaselineService.run` as the single writer for auto-capture metric rows; manual entry leaking into the metrics table during an auto-capture window violates this invariant.
- **Resolution (`ca2c81ee`):** Restructured `runManual` into 6 explicit steps with an **atomic claim** ahead of all writes:
  1. Read baseline (existence check).
  2. Lead-count cap (read-only).
  3. **ATOMIC CLAIM** — `UPDATE subaccount_baselines SET status='manual' WHERE id=$1 AND status NOT IN ('capturing','reset') RETURNING id`. Zero rows → 409 BEFORE any writes. Once non-zero, the row is locked out of auto-capture's lock predicate (`status IN ('pending','ready')`).
  4. Metric upserts (safe — auto-capture cannot acquire the row).
  5. Recompute source + confidence.
  6. Final UPDATE for source/confidence/capturedAt (no race guard needed).
- **Regression guard:** New Invariant 9 in `baselineInvariants.test.ts` asserts (via static AST-style read of the runManual method body) that the atomic UPDATE setting `status: 'manual'` with `WHERE status NOT IN ('capturing', 'reset')` appears BEFORE the `INSERT INTO subaccount_baseline_metrics` SQL.

---

## 4. Injection

No confirmed or likely holes.

The `sql` template tag is used throughout for all raw SQL. All interpolated values are Drizzle-parameterized (passed as `$N` bind parameters), never string-concatenated. The `backoffMin` string concatenation (`${backoffMin} || ' minutes'`) uses a number from a hardcoded constant array — not user-supplied. All POST body inputs pass through Zod validation before reaching service code. The `reason` field in `adminResetSchema` is bounded to 500 chars. No path traversal surfaces. No outbound SSRF surfaces. No user-controlled regex. The metric `value` column is constructed server-side from typed, Zod-validated inputs — no user-supplied raw JSON is accepted.

---

## 5. Resource Abuse

**AR-2 (worth-confirming) — `evaluateAllPendingBaselines` candidate scan has no LIMIT.** RESOLVED in `ca2c81ee`.

- **File:line:** `server/jobs/evaluateAllPendingBaselines.ts:25-36`.
- **What raised the flag:** The cross-org admin scan `SELECT ... FROM subaccount_baselines WHERE status = 'pending' OR (status = 'ready' AND ...)` had no `LIMIT` clause. On a large instance with thousands of pending/retry-eligible rows, this would return an unbounded result set into Node.js memory. The job then opens one `db.transaction()` per candidate in a sequential loop with a `baselineReadinessService.evaluate()` call each — four DB round-trips per candidate. At 10,000 candidates that is 40,000 DB queries in a single job execution window.
- **Attack scenario (speculative):** Not directly attacker-controlled (requires many pending baselines, which only arise organically). However, a high-velocity onboarding burst combined with the daily cron would produce a job that runs for the full timeout, holding a DB connection for the admin scan and opening/closing thousands of short transactions. Performance concern more than a security hole, but at scale could starve the DB connection pool.
- **Mitigating factor at review time:** Job runs once daily at 06:00, `teamSize: 1, teamConcurrency: 1`. The `singletonKey: baseline:${baselineId}` in `enqueueCaptureBaselineJob` prevents duplicate capture enqueues.
- **Resolution (`ca2c81ee`):** Added `ORDER BY created_at ASC LIMIT 1000`. FIFO fairness prevents starvation. Next daily run picks up remainder.

Other resource-abuse surfaces examined and found clean:
- Capture job retry budget: hard cap at 3 attempts; `isRetryBudgetExhausted` correctly transitions to `status='failed'`.
- Per-metric timeout: 5-second `withTimeout` wrapper (captureBaselineService.ts:94-98).
- pg-boss `singletonKey: baseline:${baselineId}` with `singletonHours: 1` prevents duplicate capture jobs.
- `manualBaselineFormSchema` has `z.array(...).min(1)` but no `.max()`. Slug enum bounded to 11 valid values; ON CONFLICT DO UPDATE handles duplicates idempotently. Worst case: 11 × N duplicate entries per request — bounded by body parser limits and only accessible to SUBACCOUNTS_EDIT users acting on their own subaccounts.

---

## 6. Cross-Tenant Data Leakage

No findings. All service reads use `getOrgScopedDb()` which resolves the ALS `withOrgTx` context set by `authenticate`. The `subaccount_baseline_metrics` FK-walk policy prevents cross-org access even if a caller supplies a foreign `baseline_id`. Metric readers all pass both `organisationId` and `subaccountId` to their queries and join via `canonical_accounts.organisation_id`. The `baselineHelper.ts` `getBaselineForSubaccount` is org-scoped and orders by `baseline_version DESC LIMIT 1`. No shared caches keyed by non-tenant data. `createEvent` telemetry payloads include `subaccount_id` and `baseline_id` but not cross-tenant identifiers.

---

## Additional observations (out-of-scope; not findings)

- `shared/schemas/baselineManualForm.ts:10` — `z.number().nonnegative()` has no `.max()`. For `pipeline_value` and `revenue_last_30d` (unit=cents), values up to `1e308` are accepted. **Action:** none. Spec does not pin upper bounds; only accessible to SUBACCOUNTS_EDIT users acting on their own subaccount. Data-quality concern, not security.
- `shared/schemas/baselineManualForm.ts:11` — `currency: z.string().length(3)` does not validate against ISO-4217 codes. **Action:** none. Spec wording is "3-char currency code"; current schema matches. Minor data quality.
- `server/jobs/evaluateAllPendingBaselines.ts:36` — retry-eligibility filter uses `last_attempt_at <= now() - interval ...` rather than `next_attempt_at`. Both are set together by `captureBaselineService.run`, so consistent for normal flow. **Action:** none. Low-risk; would only diverge if `next_attempt_at` was manually updated by an admin tool.

---

## Resolution summary

| Finding | Severity | Status | Resolved in commit |
|---|---|---|---|
| AR-1 — runManual race (HTTP-tx commits on 409) | likely-hole | RESOLVED | `ca2c81ee` |
| AR-2 — evaluateAllPendingBaselines unbounded scan | worth-confirming | RESOLVED | `ca2c81ee` |
| Numeric upper bounds | observation | OUT_OF_SCOPE | n/a |
| ISO-4217 currency validation | observation | OUT_OF_SCOPE | n/a |
| `next_attempt_at` vs `last_attempt_at` | observation | OUT_OF_SCOPE | n/a |

Static checks added (regression guards):
- Invariant 9 in `server/services/__tests__/baselineInvariants.test.ts` — runManual atomic-claim ordering.
