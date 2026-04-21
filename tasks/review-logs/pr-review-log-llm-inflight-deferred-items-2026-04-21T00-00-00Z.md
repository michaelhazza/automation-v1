# PR Review Log — llm-inflight-deferred-items

**Files reviewed:**
- `server/lib/idempotencyVersion.ts`
- `server/services/llmRouterIdempotencyPure.ts`
- `server/services/llmRouter.ts`
- `server/lib/reconciliationRequiredError.ts`
- `server/jobs/llmStartedRowSweepJob.ts`
- `server/jobs/llmStartedRowSweepJobPure.ts`
- `server/services/llmInflightRegistry.ts`
- `server/services/llmInflightPayloadStore.ts`
- `server/routes/systemPnl.ts`
- `server/db/schema/llmInflightHistory.ts`
- `server/db/schema/llmRequests.ts`
- `migrations/0190_llm_requests_started_status.sql`
- `migrations/0191_llm_inflight_history.sql`
- `server/services/providers/types.ts`
- `client/src/components/system-pnl/PnlInFlightTable.tsx`
- `client/src/components/system-pnl/PnlInFlightPayloadDrawer.tsx`
- `tasks/llm-inflight-deferred-items-brief.md` (authoritative spec)

**Review timestamp:** 2026-04-21T00:00:00Z

---

## Blocking Issues

### 1. §1 Race condition: provisional 'started' INSERT is outside the idempotency-check transaction

**File:** `server/services/llmRouter.ts`, lines 419–614.

The idempotency-check transaction (line 419) issues `SELECT ... FOR UPDATE` and checks for `status === 'started'`. That transaction commits at line 455. The provisional `'started'` INSERT happens OUTSIDE the transaction at line 577 with `.onConflictDoNothing()`.

In Postgres, `SELECT FOR UPDATE` only locks existing rows. When no row exists, two concurrent first-calls for the same `idempotencyKey` both enter the transaction, both find no row, both commit — and then proceed independently past line 614 to dispatch to the provider. The second INSERT is silently dropped by `onConflictDoNothing`, but both callers have already made the provider call. This is the exact double-bill scenario §1 exists to prevent.

**Fix.** Move the provisional INSERT inside the `db.transaction` block. A concurrent second caller hits the unique-constraint conflict, blocks until the first transaction commits, then its own `SELECT FOR UPDATE` returns the `'started'` row and triggers the `ReconciliationRequiredError` branch.

---

### 2. §1 Tripwire unmet: no test pinning `'started'` exclusion from cost aggregates

**File:** `server/services/__tests__/systemPnlServicePure.test.ts`

The brief §1 explicitly says: "`cost_aggregates` must ignore `'started'` rows. Pinned by test in `systemPnlServicePure.test.ts`." No such test exists.

**Fix.** Add a pure test: given rows with `status IN ('success', 'started', 'error')`, only the `success` row contributes to `costWithMarginCents`.

---

### 3. §5 Streaming: `iterable.done` becomes an unhandled rejected Promise when `for await` throws

**File:** `server/services/llmRouter.ts`, lines 779–806.

If the `for await` loop exits via exception, `iterable.done` remains allocated as an unobserved rejected Promise — Node.js emits `UnhandledPromiseRejection`. No adapter implements `stream()` yet so this is latent, but the contract is baked in.

**Fix.** In the catch block, call `iterable.done?.catch(() => {})` before rethrowing when streaming was in use.

---

## Strong Recommendations

### 4. §1 Failure-path `onConflictDoUpdate` set clause is missing `marginMultiplier` and `fixedFeeCents`

**File:** `server/services/llmRouter.ts`, lines 1008–1024.

The success-path set clause explicitly includes these fields; the failure-path set clause omits them. Harmless today (both paths write the same values), but future per-attempt margin recalculation would silently leave stale provisional-row values on the failure path.

**Fix.** Add `marginMultiplier` and `fixedFeeCents` to the failure set clause for structural symmetry.

---

### 5. §3/§8 Mobile card view omits streaming token progress

**File:** `client/src/components/system-pnl/PnlInFlightTable.tsx`, lines 503–580.

Desktop table renders `prog.tokensSoFar` inline with Elapsed; mobile card view omits it. Brief §8 tripwire: "Don't hide columns on mobile without a way to reveal them."

**Fix.** Render the token counter on the mobile Elapsed cell too.

---

### 6. §1 Missing integration-level test for `'started'` row → ReconciliationRequiredError path

Pure error-class tests pin the error shape. No test exercises `routeCall` itself with a `'started'` row in the DB. Without it, a refactor adding an early-return branch above the `'started'` check could silently remove protection and pass all existing tests.

---

## Non-Blocking Improvements

### 7. History cleanup job uses plain `db` — asymmetry with sweep job's `withAdminConnection` is uncommented

**File:** `server/jobs/llmInflightHistoryCleanupJob.ts`, line 31. Asymmetry is correct but unexplained.

### 8. `existingRuntimeKey: null` in `ReconciliationRequiredError` is honest but callers lose UI-link capability

The `'started'` row doesn't store `runtimeKey` — that's an in-memory registry concept. Worth documenting on the error class.

---

## Verdict

BLOCKED. Fix finding #1 (move the provisional INSERT inside the `db.transaction` block), add the aggregation-exclusion test (#2), and silence the `iterable.done` dangling rejection on streaming error (#3) before marking done.
