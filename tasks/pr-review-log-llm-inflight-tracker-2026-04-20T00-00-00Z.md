# PR Review Log

**Files reviewed:**
- `tasks/llm-inflight-realtime-tracker-spec.md` (spec reference)
- `server/services/llmInflightRegistryPure.ts` (new)
- `server/services/llmInflightRegistry.ts` (new)
- `server/services/__tests__/llmInflightRegistryPure.test.ts` (new)
- `server/services/llmRouter.ts` (modified — registry wiring)
- `server/routes/systemPnl.ts` (modified — in-flight snapshot endpoint)
- `server/websocket/rooms.ts` (modified — system-llm-inflight room)
- `server/config/limits.ts` (modified — new tunables)
- `server/index.ts` (modified — init/shutdown)
- `server/lib/tracing.ts` (modified — EVENT_NAMES)
- `shared/types/systemPnl.ts` (modified — in-flight types)
- `client/src/components/system-pnl/PnlInFlightTable.tsx` (new)
- `client/src/pages/SystemPnlPage.tsx` (modified — view toggle)
- `architecture.md` (modified)

**Timestamp:** 2026-04-20T00:00:00Z

---

## Blocking Issues

### 1. Eviction fires before the noop-already-exists check — spurious victim eviction under double-add-at-capacity

**File:** `server/services/llmInflightRegistry.ts`, lines 110–124

```ts
// Overflow check — evict oldest before adding the new entry.
if (slots.size >= MAX_INFLIGHT_ENTRIES) {
  const victim = selectEvictionVictim(slots.values());
  if (victim) {
    evictVictim(victim);   // ← fires unconditionally
  }
}

const outcome = applyAdd({ entry, existing: slots.get(entry.runtimeKey) });
if (outcome.kind === 'noop_already_exists') {   // ← check happens AFTER eviction
  ...
  return entry.runtimeKey;
}
```

When the map is at `MAX_INFLIGHT_ENTRIES` and `add()` is called with a `runtimeKey` that already exists (noop path), the code evicts a legitimate oldest entry, emits a spurious `terminalStatus: 'evicted_overflow'` removal event to the socket room and Redis, and then quietly returns without inserting anything. An unrelated in-flight call is falsely reported as "evicted" to every connected admin and every other instance via Redis fanout.

**Spec contract:** §4.3 says `add()` is a no-op if a slot for this runtimeKey already exists. §4.4 says eviction fires "on add" to make room for the **new** entry. There is no "new" entry in the noop case.

In normal operation this path is guarded by the router-side pre-add invariant assert (which throws in dev, logs in prod). But the prod `console.error` path does not prevent the call from reaching `add()` — it continues to this eviction bug. Any prod anomaly that triggers the double-add log (stale Redis fanout race, future refactor) will simultaneously corrupt the in-flight view by evicting an unrelated entry.

**Fix:** Reverse the check order. Perform the noop check first; only run the overflow eviction if the add is genuinely new.

---

## Strong Recommendations

### 2. Client-side add-after-remove resurrection gap — stateVersion guard not implemented on the client

**File:** `client/src/components/system-pnl/PnlInFlightTable.tsx`, lines 72–79

`applyAddEntry` checks only whether the runtimeKey is already present in the `entries` array. A `remove` event filters the entry out of `entries`. A subsequent delayed `add` would pass this check and re-insert the row even though the call already completed.

The server-side state machine prevents this via `stateVersion`, but the client has no equivalent guard for the "removed and purged from local state, then add arrives" case. The socket LRU dedup (`DEDUP_MAX_SIZE = 500`) is the defence in practice, but once the `added` eventId ages out of that 500-entry set the resurrection is possible.

**Recommended fix:** Track recently-removed runtimeKeys in a small bounded set (e.g. 256 entries) alongside `recentlyLanded`. Before calling `applyAddEntry`, check if the runtimeKey is in that set and skip the add if so.

### 3. Missing pure test — overflow eviction skipped on noop-add at capacity

**File:** `server/services/__tests__/llmInflightRegistryPure.test.ts`

There is no test covering the boundary case where `slots.size >= MAX_INFLIGHT_ENTRIES` but the incoming `add` is for a runtimeKey already present. This is exactly the scenario that triggers the Blocking issue above.

### 4. `attempt` counter passed to registry is per-provider, not per-function-call — mismatch with spec's guarantee

**File:** `server/services/llmRouter.ts`, line 566–573

Spec §4.2 says "`attempt` matches the counter already tracked by `attemptNumber` in the ledger." The inner loop `for (let attempt = 1; ...)` resets to 1 for each provider in the fallback chain — but so does the ledger's `attemptNumber`. They are consistent with each other. However, the admin UI sees `attempt=1` for two different providers in sequence with no visible indication that provider A's attempt 1 already failed.

This is not a correctness bug (runtimeKeys are unique) — it is a UX gap. Worth documenting in a code comment. No code change required for this PR.

### 5. `bufferingUntilRef` extended to 1s during fetch — deviation from spec's stated 100ms

**File:** `client/src/components/system-pnl/PnlInFlightTable.tsx`, line 117

The spec consistently states "100 ms socket-event buffer." The implementation extends to 1000ms while the snapshot fetch is pending, then resets to 100ms after the fetch resolves. This is a safe deviation (more conservative) — document as a deliberate deviation in the component comment.

---

## Non-Blocking Improvements

### 6. Client dedup LRU size is 500, spec says ~256

No bug — 500 is more conservative. Update the spec comment or the code comment so they agree.

### 7. Snapshot endpoint does not use the `wrap()` helper used by all other P&L routes

Intentional and matches the spec contract exactly — the in-flight response is its own envelope with `generatedAt` inline. A code comment on the route explaining why `wrap()` is not used would help the next reader.

### 8. `evictVictim` computes `countActive()` before calling `remove()` — `activeCount` in the evictionContext includes the victim

Actually the correct signal for the operator: "I saw 5000 active entries and had to evict one to make room." Document the intent in a comment.

### 9. `scheduleSlotPrune` uses `window.setTimeout` in the client but `setTimeout` on server — misnaming non-issue

Correct in both environments.

### 10. Dead path: `currentRuntimeKey` may be null at the final-failure removal block

The `if` guard is correct but the comment above doesn't acknowledge the null case. A one-line comment noting "null when all retries were retryable-error-removed by the inner loop" would close future-reader confusion.

---

## Verdict

One blocking issue: the eviction-before-noop-check ordering in `llmInflightRegistry.ts:add()` causes spurious `evicted_overflow` events when a double-add hits an at-capacity map. Fix by moving the noop check before the overflow eviction guard, and add a pure test for the boundary case.
