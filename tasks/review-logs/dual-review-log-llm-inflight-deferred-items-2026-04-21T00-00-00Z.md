# Dual Review Log — llm-inflight-deferred-items

**Files reviewed:**
- `server/services/llmRouter.ts`
- `server/services/llmRouterIdempotencyPure.ts`
- `server/lib/idempotencyVersion.ts`
- `server/lib/reconciliationRequiredError.ts`
- `server/jobs/llmStartedRowSweepJob.ts`
- `server/jobs/llmStartedRowSweepJobPure.ts`
- `server/services/llmInflightRegistry.ts`
- `server/services/llmInflightPayloadStore.ts`
- `server/services/providers/types.ts`
- `server/db/schema/llmInflightHistory.ts`
- `server/db/schema/llmRequests.ts`
- `migrations/0190_llm_requests_started_status.sql`
- `migrations/0191_llm_inflight_history.sql`
- `server/routes/systemPnl.ts`
- `client/src/components/system-pnl/PnlInFlightTable.tsx`
- `client/src/components/system-pnl/PnlInFlightPayloadDrawer.tsx`
- `server/services/__tests__/systemPnlServicePure.test.ts`

**Iterations run:** 3/3
**Timestamp:** 2026-04-21T00:00:00Z

---

## Iteration 1

### Findings from Codex

**[REJECT]** `server/routes/systemPnl.ts:165` — Payload store is process-local; mirrored rows return 410 in multi-instance deployments.
Reason: This is the documented design. The payload store header and the spec both explicitly specify local-in-memory, single-instance operation. The feature handles 410 gracefully with a user-friendly message directing to the ledger link. A Redis payload-replication or sticky-session fix is out of scope infrastructure work. The deferred-items brief does not scope multi-instance payload sharing. The 410 path is an intentional UX graceful-degradation, not a regression.

**[ACCEPT]** `server/services/llmInflightPayloadStore.ts:46-47` — Payload size cap only measures `JSON.stringify(snapshot.messages)`, not the full snapshot. A call with a small messages array but a large system prompt or tool schema bypasses the 200 KB guard.
Reason: Real correctness bug. The cap exists to protect against heap growth; measuring only one field of the stored object defeats that protection. Fix: measure `JSON.stringify(snapshot)` to cover the full stored footprint.

**[ACCEPT]** `client/src/components/system-pnl/PnlInFlightPayloadDrawer.tsx:50-51` — No stale-fetch guard. If the admin clicks row A then row B quickly, A's slower response can overwrite B's drawer contents.
Reason: Classic React async state race. Real UX correctness bug. Fix: AbortController on cleanup + `currentRuntimeKey` closure check before calling `setSnapshot`.

**[REJECT]** `server/services/llmInflightRegistry.ts:278` — `emitProgress()` only broadcasts locally, not via Redis.
Reason: Explicitly intentional. The `emitProgress()` docstring says "does NOT write to the historical archive (progress events are transient by design)". Progress events are advisory-only; the authoritative `tokensOut` arrives on the removal event. The P3 rating plus the design doc language confirm this is a known tradeoff, not a bug. P3 severity is too low to accept for a feature explicitly designed this way.

---

## Iteration 2

### Findings from Codex

**[REJECT]** `server/services/llmRouter.ts:474-513` — Provisional `'started'` INSERT runs before `budgetService.checkAndReserve()`. An infra failure in `checkAndReserve` leaves a `'started'` row with no provider call, causing retries to get `ReconciliationRequiredError` until the sweep.
Reason: Codex is arguing against the pr-reviewer's deliberate fix. The pr-reviewer finding #1 specifically moved the INSERT inside the transaction to close the double-bill window. Moving it back post-budget would reopen the exact race the fix exists to prevent. The budget-infra-failure path (throw err at line 587) is a known edge case; the sweep is the designed recovery path for exactly this scenario. The `ReconciliationRequiredError` contract says "may have billed" — the 11-minute recovery window is acceptable for this rare infra failure.

**[ACCEPT]** `client/src/components/system-pnl/PnlInFlightTable.tsx:294-300` — `onProgress` handler reads `env?.payload` but `useSocketRoom` already unwraps the envelope and passes the payload directly. The progress indicator will never update.
Reason: Verified by reading `useSocketRoom` in `client/src/hooks/useSocket.ts`. The hook calls `unwrapEnvelope(data)` and passes `payload` (not the full envelope) to event handlers. The `onProgress` handler receives `InFlightProgress` directly — wrapping it in `{ payload?: InFlightProgress }` means `prog` is always `undefined`. This is a functional regression: the streaming token progress indicator is silently dead.

**[REJECT]** `server/services/llmInflightRegistry.ts:278` — Redis fanout for progress (repeated from iteration 1).
Reason: Same as iteration 1 rejection. Intentional design.

---

## Iteration 3

### Findings from Codex

**[ACCEPT]** `server/services/llmRouter.ts:516-522` — When `onConflictDoUpdate` rewrites a terminal-error row to `'started'`, the row keeps its original `created_at`. If the original error row is older than `PROVIDER_CALL_TIMEOUT_MS + 60s` (11 minutes), the new `'started'` row is immediately sweep-eligible. The sweep could reap it while the provider call is still in-flight, then a subsequent retry dispatches again — reopening the double-bill window.
Reason: Real correctness bug with clear impact on the safety mechanism this PR implements. Fix: add `createdAt: sql\`now()\`` to the `onConflictDoUpdate` SET clause so the revived row gets a fresh timestamp and is not immediately sweep-eligible.

**[REJECT]** `server/services/llmRouter.ts:583-587` — Infra failure in `checkAndReserve` leaves `'started'` row (P2 restatement of iteration 2 P1 rejection).
Reason: Same as iteration 2. The sweep is the designed recovery path. The 11-minute window is acceptable for rare infra failures.

**[REJECT]** `server/routes/systemPnl.ts:165-172` — Multi-instance payload 410 (repeated from iteration 1).
Reason: Same as iteration 1 rejection. Intentional design.

**[REJECT]** `server/services/llmInflightRegistry.ts:278` — Redis fanout for progress (repeated from iterations 1 and 2).
Reason: Same as prior rejections. Intentional design.

---

## Changes Made

- `server/services/llmInflightPayloadStore.ts` — Changed size gate from `JSON.stringify(snapshot.messages)` to `JSON.stringify(snapshot)` so the 200 KB cap applies to the full stored footprint including `system`, `tools`, and other fields.
- `client/src/components/system-pnl/PnlInFlightPayloadDrawer.tsx` — Added `AbortController` to the fetch `useEffect` so stale responses from a previous row selection are cancelled and ignored; added `currentRuntimeKey` closure check as belt-and-suspenders guard.
- `client/src/components/system-pnl/PnlInFlightTable.tsx` — Fixed `onProgress` handler to treat its argument as `InFlightProgress` directly (not as an envelope wrapper), since `useSocketRoom` already unwraps envelopes before calling handlers. Without this fix the streaming token progress indicator was silently dead.
- `server/services/llmRouter.ts` — Added `createdAt: sql\`now()\`` to the provisional `'started'` INSERT's `onConflictDoUpdate` SET clause so that reviving an old terminal-error row resets the row's age and prevents immediate sweep-eligibility.

## Rejected Recommendations

1. **Multi-instance payload store locality (all 3 iterations)** — The payload store is process-local by design per the deferred-items brief §7. The 410 path is a graceful-degradation with user guidance to the ledger link. Redis payload replication is an infrastructure decision out of scope for this PR.

2. **Redis fanout for progress events (all 3 iterations, P3)** — `emitProgress()` is documented as "broadcast-only, does NOT write to the historical archive (progress events are transient by design)". Token progress is advisory-only; the authoritative count arrives on the removal event. Single-node behavior is correct; multi-instance progress is a known limitation of a P3 advisory feature.

3. **Move provisional INSERT to post-budget (iterations 2 and 3)** — The `'started'` INSERT is inside the idempotency-check transaction specifically to close the double-bill race window (pr-reviewer finding #1). Moving it post-budget reopens that window. The `throw err` path for infra failures in `checkAndReserve` is a known edge case recovered by the sweep within 11 minutes — an acceptable tradeoff for a rare path.

---

**Verdict:** `PR ready. All critical and important issues resolved.` Three correctness bugs found and fixed: payload size cap scope (memory protection), stale fetch guard (UX correctness), progress handler envelope unwrap (functional regression), and provisional row sweep age reset (financial safety). Three categories of recommendations rejected as intentional design decisions (multi-instance payload locality, Redis progress fanout, post-budget INSERT placement).
