# LLM In-Flight Real-Time Tracker — Spec

**Status:** Merged to main via PR #161 on 2026-04-21. Post-merge hardening landed on branch `claude/build-llm-inflight-tracker-m3l2x` across three independent review rounds (pr-reviewer, dual-reviewer, final reviewer pass) — captured in §12 Round 4. This spec document now reflects the fully-implemented state including post-merge hardening; further changes will land as amendments tied to the deferred items in `tasks/llm-inflight-deferred-items-brief.md`.
**Author:** Main session.
**Date:** 2026-04-20.
**Last revised:** 2026-04-21 — Round 4 (post-build hardening) folded in: client-side `stateVersion` monotonic mirror guard, overflow check scoped to `countActive()` rather than `slots.size`, Redis-fanout overflow drops silently instead of evict-and-republish, noop-check precedes eviction in `add()`, `updateLedgerLink()` ledger-link rehydration for retryable-error-only failure chains, 100 ms client buffer extended to full-fetch lifetime during snapshot GET.
**Branch when built:** `claude/build-llm-inflight-tracker-m3l2x` — merged to main 2026-04-21 (PR #161).
**Predecessor:** `tasks/llm-observability-ledger-generalisation-spec.md` — completed 2026-04-20. That spec generalised the completed-call ledger (`llm_requests`) for all consumers. This spec extends observability to **in-flight calls** — the gap between dispatch and completion.
**Follow-up:** `tasks/llm-inflight-deferred-items-brief.md` — briefs the eight deferred items from §9 with per-item problem statements, minimal viable shapes, key files, and tripwires for future sessions.

---

## Table of contents

1. Problem statement
2. Goal
3. Primitives search (existing reuse)
4. Execution model
   - 4.1 Lifecycle
   - 4.2 Runtime key
   - 4.3 Entry state machine (server + client-side mirror)
   - 4.4 Broadcast + multi-instance fanout (bounded memory, overflow hardening)
   - 4.5 Stale-entry sweep
   - 4.6 Ledger-link rehydration (Round 4)
5. Contracts
6. Files to change
7. Permissions / RLS
8. Phase sequencing
9. Deferred Items (briefed in `tasks/llm-inflight-deferred-items-brief.md`)
10. Testing posture
11. Self-consistency check
12. Resolved during spec review (rounds 1–4)

---

## 1. Problem statement

The System P&L page at `/system/llm-pnl` auto-refreshes every 60s and only shows calls **after** they return (success, error, or timeout). During a long skill-analyzer run (or any reasoning-model call up to the 600s cap), the admin has no way to see that a call is currently in flight, how long it's been running, which caller initiated it, or against which provider/model. The 2026-04-20 timeout-hardening work raised the ceiling to 600s — which makes this gap worse, not better.

**Non-goals.** Token-level streaming progress (see Deferred). Per-agent-run "here's my current step" view — that already exists on the run-trace page. Merging the two surfaces is out of scope.

---

## 2. Goal

A system-admin-only in-flight registry that:

1. Shows every LLM call currently dispatched but not yet resolved.
2. Updates in real time via WebSocket (no polling).
3. Captures the same attribution fields as the ledger (`sourceType`, `sourceId`, `featureTag`, org, subaccount, provider, model).
4. Reconciles automatically against the ledger row when the call completes (so the UI transitions the row from "live" to "landed" without a refresh).
5. Does **not** touch the `llm_requests` table — the append-only invariant is preserved.

---

## 3. Primitives search (existing reuse)

| Proposing | Reuse target | Why not invent |
|---|---|---|
| Interception point for every LLM call | `server/services/llmRouter.ts` — single chokepoint, already instrumented for ledger writes | Static gate `verify-no-direct-adapter-calls.sh` + runtime `assertCalledFromRouter()` guarantee this is the only path. |
| Real-time push to client | Socket.IO rooms via `server/websocket/` + `client/src/hooks/useSocket.ts` | Existing pattern (run-trace viewer, clarification inbox, ClientPulse dashboard all use it). |
| System-admin gate | `requireSystemAdmin` middleware already applied to all 8 `/api/admin/llm-pnl/*` routes | Same gate pattern. Extended to a new socket room `system:llm-inflight`. |
| Auto-abort on 600s cap | `callWithTimeout` (`llmRouterTimeoutPure.ts`) + merged `AbortSignal` — lands 2026-04-20 | Emits start/finish boundaries cleanly — perfect hook for registry add/remove. |
| Redis (for multi-instance broadcast) | Redis connection already present via pg-boss queue stack | Reuse — no new dependency. |

No new primitive invented. Every piece of this is a small extension of an existing one.

---

## 4. Execution model

**In-memory registry, WebSocket push, Redis pub/sub for multi-instance.**

### 4.1 Lifecycle — registry represents real outbound calls only

`registry.add()` fires **after** (a) provider selected, (b) budget reserved (or reservation-skipped for system/analyzer), and **immediately before** the `providerAdapter.call()` dispatch. It fires **inside** the provider-retry loop, not outside it. Pre-dispatch terminal states (`budget_blocked`, `rate_limited`, `provider_not_configured`-before-any-attempt) never produce a registry entry — they go straight to the ledger-blocked path unchanged.

`registry.remove()` fires in the `finally` block that wraps the adapter call + ledger upsert. Every registry entry has exactly one matching `remove()`.

This closes the "flicker" race from the spec-review feedback (item 2): an admin never sees a row appear and vanish instantly for a call that never dispatched.

### 4.2 Runtime key — unique per attempt, not per idempotency key

A single `idempotencyKey` can produce multiple concurrent in-flight entries when the retry-fallback loop re-attempts (same logical call, different attempt). The registry is therefore keyed by a `runtimeKey` — `${idempotencyKey}:${attempt}:${startedAt}`.

- `attempt` matches the counter already tracked by `attemptNumber` in the ledger.
- `startedAt` is included to close a crash-restart edge case raised in spec-review round 2: if a process crashes mid-retry-loop and a restarted retry loop resets its `attempt` counter from 1, we would otherwise collide with a prior in-memory entry on another instance. `startedAt` guarantees uniqueness without relying on monotonic `attempt` across crashes.
- `idempotencyKey` remains carried on the entry for UI grouping and for reconciliation against the eventual ledger row.

### 4.3 Entry state machine — monotonic, tolerant of reordered events

Each registry slot carries `state: 'active' | 'removed'`, the original `startedAt`, and a `stateVersion: 1 | 2` — `1` for `active`, `2` for `removed`. Every socket and Redis event carries its `stateVersion`. The registry enforces monotonic transitions keyed by `(startedAt, stateVersion)`:

- `add()` — no-op if a slot for this `runtimeKey` already exists. Emits `inflight.add_noop_already_exists` at `debug` level.
- `remove()` — no-op if the slot is already `'removed'` or missing; otherwise `'active' → 'removed'` and `stateVersion: 1 → 2`. Emits `inflight.remove_noop_already_removed` or `inflight.remove_noop_missing_key` at `debug` level with `{ runtimeKey, source: 'local' | 'redis' }`.
- Incoming Redis event — ignored if **either**:
  - `incoming.startedAt < existing.startedAt` (stale runtimeKey we've already rotated through), or
  - `incoming.startedAt === existing.startedAt && incoming.stateVersion < existing.stateVersion` (same-timestamp reorder: a late `add` arriving after `remove` has already won).
  Emits `inflight.event_stale_ignored` at `debug` level with both timestamps + both versions.

The same-timestamp reorder case closes a subtle race surfaced in spec-review round 3: under Redis fanout + coarse clock granularity an `add → remove → delayed add` sequence with identical `startedAt` could otherwise allow the delayed add to resurrect a removed entry. The `stateVersion` ladder (monotonic-only transitions: `0 → 1 → 2`) makes that resurrection impossible — a lower version never wins against a higher one regardless of arrival order.

The no-op logs are normal during steady-state (local + Redis double-delivery) — they only become actionable when their rate spikes, which is the exact signal you want for diagnosing fanout loops.

This eliminates the out-of-order flicker class from spec-review round 1 feedback item 1, covers the "no-op removal guard reason" ask from round 2 feedback item 6, and closes the same-`startedAt` reorder hole from round 3 feedback item 1.

**Client-side mirror of the monotonic guard (Round 4).** The client implements the same `stateVersion` ladder in `client/src/components/system-pnl/PnlInFlightTable.tsx` via a bounded `stateVersionByKeyRef: Map<runtimeKey, 1 | 2>` (256-entry LRU, matching the `recentlyRemovedRef` sibling). `applyAddEntry` rejects any incoming `added` event whose `stateVersion` is not strictly greater than the stored value; `applyRemoveEntry` stamps version 2 unconditionally so duplicate removes for the same runtimeKey still merge ledger-link fields (see §4.6). The snapshot fetch seeds version 1 for every returned entry so a buffered `added` event arriving mid-fetch can't double-insert after the snapshot render.

The client guard is strictly belt-and-braces — the server already refuses to emit a lower-version event for a given `(runtimeKey, startedAt)` tuple. The client mirror catches the residual cases: (a) a stale replay slipping past socket-layer dedup, (b) a delayed `added` arriving after its `removed` has aged out of the bounded `recentlyRemovedRef` set but while the runtimeKey is still within the `stateVersionByKeyRef` window. Defence in depth across both bounded sets keeps the resurrection class closed for the entire practical event horizon.

### 4.4 Broadcast + multi-instance fanout

`server/services/llmInflightRegistry.ts` maintains a per-process `Map<runtimeKey, { entry: InFlightEntry, state: EntryState }>` + emits socket events to room `system:llm-inflight`.

When `REDIS_URL` is set (production default), the registry publishes add/remove events on Redis channel `llm-inflight`. Each instance subscribes and merges remote events into its own map **through the same state-machine rules** before rebroadcasting locally. Net result: a system admin connected to any instance sees every in-flight call across the fleet.

**Event de-duplication on the wire.** Every socket payload carries `eventId = ${runtimeKey}:${type}` (`type ∈ { added, removed }`). Clients maintain a small LRU of seen `eventId`s (~256 entries) and drop duplicates, so a reconnect or a client bridged to two instances won't double-render.

**Redis partition tolerance.** If the Redis subscriber disconnects and reconnects mid-flight, the registry **does not** replay historical events on reconnect — it simply resumes live subscription. Clients recover cross-fleet consistency via the snapshot endpoint (§5) on their own reconnect, not via a server-side event replay. Replay would re-introduce the flicker/duplicate class the state machine exists to prevent, and would require per-event persistence (which the registry explicitly does not have). This is the intentional trade-off: a brief Redis partition shows a stale local-only view on each partitioned instance until Redis recovers; the snapshot endpoint provides the authoritative read.

**Hard memory cap with LRU overflow eviction.** The per-process map is capped at `MAX_INFLIGHT_ENTRIES = 5_000`. On add, if the map is at cap, the oldest entry (by `startedAt`) is force-evicted:

- Local eviction emits `InFlightRemoval` with `terminalStatus: 'evicted_overflow'` and an `evictionContext: { activeCount, capacity }` field to the socket room and to Redis. The context lets an operator immediately distinguish real overload (`activeCount === capacity && steady growth`) from a Redis-down + sweep-delayed leak (`activeCount === capacity && no corresponding dispatch spike`) without digging logs.
- Evictions are logged at `warn` level with the evicted `runtimeKey` + `evictionContext` — in steady state the cap is 100× headroom over expected concurrency, so any eviction is a real signal.

Without this cap, a pathological Redis-down + sweep-delayed combo could accumulate entries unbounded. With it, the worst case is a bounded memory footprint + a visible overflow signal.

**Three hardening rules on the overflow path (Round 4).** The simple description above hides three invariants that pr-reviewer and dual-reviewer each pinned as real bugs in the initial build:

1. **Noop-before-eviction ordering.** `add()` runs the `applyAdd` state-machine check *first*, and only runs the overflow-eviction branch when the incoming runtimeKey is a genuine new entry. Evicting first and then discovering the add was a no-op (e.g. a race from Redis fanout, or a caller that bypassed the router-side `assert(!registry.has(runtimeKey))` guard via the prod `console.error` fallback) would silently evict an unrelated active entry and emit a spurious `evicted_overflow` event to every admin. The ordering makes the noop path a literal no-op — no eviction, no emission.
2. **Overflow predicate uses `countActive()`, not `slots.size`.** `remove()` keeps victim slots in the map as `state: 'removed'` for a 30-second retention window (so late duplicate add/remove events are caught by the state-machine guard rather than accepted as fresh). If the overflow predicate counted those retained slots, a high-churn workload would trigger premature eviction of still-active entries even when the live count was well below capacity. Scoping the predicate to active-only slots — at the cost of allowing the map to grow to at most 2× capacity transiently — keeps live-entry eviction gated on genuine live-entry pressure.
3. **Redis-fanout overflow drops silently.** When an `apply_add` arrives from a remote instance and the local map is at capacity, the local instance does NOT evict-and-republish. A republished `evicted_overflow` event would echo back to the origin instance, flip an active call to "evicted" from its owner's perspective, and render its real completion a noop. Instead the local add is dropped silently with a debug log; the origin instance remains the single source of truth for its own calls. The local admin connected to the remote instance temporarily under-reports by the dropped entry, which is acceptable — the snapshot endpoint (§5) provides authoritative recovery on demand.

**Active-count gauge.** Every add/remove emits `llm.inflight.active_count` via the existing `createEvent` pattern, carrying:

- `activeCount: number` — current local map size.
- `byCallSite: { app: number; worker: number }` — per-`callSite` breakdown.
- `byProvider: Record<string, number>` — per-provider breakdown (e.g. `{ anthropic: 3, openai: 7 }`).

The breakdowns make it trivial to spot stuck workers (`byCallSite.worker` climbs while `byCallSite.app` stays flat) or provider-specific hangs (one provider's count climbs while others drain). Downstream alerting is an ops concern layered on top of the gauge, not built in this spec.

### 4.5 Stale-entry sweep — deadline-based, not elapsed-based

Each entry records a `deadlineAt = startedAt + timeoutMs + 30_000` at add-time. A safety-net timer fires every `60_000 ± 5_000` ms (the jitter prevents multi-instance sweep-storm synchronisation) and removes entries where `now > deadlineAt`, emitting `terminalStatus: 'swept_stale'` with `reason: 'deadline_exceeded'`.

In practice any deadline-exceeded entry is overwhelmingly a process crash between `registry.add()` and the `finally`-block `registry.remove()`. The router's own `callWithTimeout` (`llmRouterTimeoutPure.ts`) would have aborted the provider call at `timeoutMs` — the extra 30s buffer past that is precisely the window where only a crash can leave the entry alive. We surface `'deadline_exceeded'` as the reason rather than labelling it `'crash_orphaned'` because the sweep cannot positively prove a crash; the operational inference is the right place to draw that conclusion. The reason field leaves room for future sweep causes without a status-enum migration.

Capturing the deadline at add-time makes the sweep robust to `PROVIDER_CALL_TIMEOUT_MS` changes mid-run and to small clock drift across instances. Sweep removals are logged at `warn` with the runtimeKey so a crash loop is detectable from logs alone.

### 4.6 Ledger-link rehydration for retryable-error-only failure chains (Round 4)

The §4.1 lifecycle assumes the final attempt's `remove()` carries the ledger row id — the outer failure-path ledger write runs first, then `remove()` fires with `ledgerRowId` + `ledgerCommittedAt` populated. That contract holds for the common cases (success; non-retryable terminal failure) but breaks for one specific retry shape: **every attempt fails with a retryable error**.

In that shape, the router's inner retry-loop catch removes each attempt's entry mid-loop (so the registry doesn't accumulate ghosts during backoff sleeps) with `ledgerRowId: null` — the ledger row hasn't been written yet, there's no id to link. When all providers exhaust their retries, `currentRuntimeKey` is null (last iteration's catch cleared it), and the outer failure path writes the ledger row but has no live registry entry to remove. The UI's "Recently landed" strip shows a row with `terminalStatus='error'` but no `[ledger]` button — the operator has no one-click navigation to the ledger detail for that failure.

**Rehydration mechanic.** The router captures a `lastRemovedAttempt: { runtimeKey, idempotencyKey, attempt, startedAt, terminalStatus }` handle in the inner catch whenever it removes an attempt with `ledgerRowId: null`. After the outer failure-path ledger write returns the row id via `.returning({ id: llmRequests.id })`, the router calls `inflightRegistry.updateLedgerLink()` — a purpose-built method that emits a second `removed` socket event for the same runtimeKey with the ledger fields populated. The client's `applyRemoveEntry` merges the populated fields over the earlier `null` values on the `recentlyLanded` map entry, and the `[ledger]` button appears.

**Contract boundaries on `updateLedgerLink()`.** The method is deliberately narrow:

- It emits *only* when the runtimeKey has already been removed via the normal state-machine path — it does not add, does not change the map, does not publish to Redis (the origin instance already fanned out the first removal), and does not bump `stateVersion` (stays at 2).
- The emitted event uses an eventId suffix `:ledger-link` so dedup caches don't swallow it as a duplicate of the original removal.
- The client merge is "once linked, stay linked" — if the original removal arrived with a populated `ledgerRowId` and a later rehydration event carries `null`, the populated value is preserved. This protects against stray replays after the real link has already been delivered.
- It is **not a general-purpose second terminal transition**. The state machine (§4.3) remains the single source of truth for `active(1) → removed(2)`. The header comment on `updateLedgerLink()` in the registry calls this out explicitly with a "DO NOT call this" list covering the misuse vectors a future contributor might reach for (changing `terminalStatus`, updating non-ledger fields, calling more than once, fixing a wrong-runtimeKey removal).

**Why a second event and not a state-machine redesign?** Three alternatives were considered and rejected:

1. *Keep `currentRuntimeKey` alive across retries and remove once at the end.* Requires look-ahead into "is there a next eligible provider" which depends on cooldown state and model mapping — not cleanly computable at the inner-catch decision point. Creates transient registry ghosts between providers.
2. *Detect "final attempt" inside the inner catch and defer removal.* Same look-ahead problem, plus it couples the inner-loop logic to the outer-loop termination conditions.
3. *Never remove in the inner catch; only remove once at the end with terminal classification.* Leaves orphaned runtime keys alive during backoff sleeps, inflating the registry's apparent live count for the sweep and active-count gauge — defeats the single-entry-per-attempt design.

The rehydration approach keeps the inner-catch removal ghost-free, preserves single-entry semantics, and confines the post-hoc linkage to a single narrow method with an explicit contract. The alternative designs push complexity into the hot path; the rehydration approach pushes it to a cold path that fires once per terminal-failure `routeCall` — a better tradeoff.

## 5. Contracts

### `InFlightEntry` (TypeScript + socket payload)

```ts
interface InFlightEntry {
  runtimeKey: string;              // `${idempotencyKey}:${attempt}:${startedAt}` — unique across crash-restarts
  idempotencyKey: string;          // same key the ledger will use on completion
  attempt: number;                 // 1-indexed, matches ledger.attemptNumber
  startedAt: string;               // ISO 8601 UTC — monotonicity anchor for reorder-safety + runtimeKey component
  stateVersion: 1;                 // 1=active on add; removal emissions carry 2 (see InFlightRemoval)
  deadlineAt: string;              // ISO 8601 UTC — startedAt + timeoutMs + deadlineBufferMs
  deadlineBufferMs: number;        // the buffer past timeoutMs before sweep fires (default 30_000)
  label: string;                   // `${provider}/${model}` — for at-a-glance UI
  provider: string;
  model: string;
  sourceType: 'agent_run' | 'process_execution' | 'system' | 'iee' | 'analyzer';
  sourceId: string | null;         // polymorphic FK — same semantics as llm_requests.source_id
  featureTag: string;              // kebab-case — 'skill-analyzer-classify' etc.
  organisationId: string | null;   // nullable for pure-system calls with no org attribution
  subaccountId: string | null;
  runId: string | null;            // agent_runs.id — when sourceType='agent_run'
  executionId: string | null;      // executions.id — when sourceType='process_execution'
  ieeRunId: string | null;         // iee_runs.id — when sourceType='iee'
  callSite: 'app' | 'worker';      // display-only — never branched on in server logic
  timeoutMs: number;               // the cap this call is running under (usually 600_000)
}
```

`callSite` is display-only — a tag for UI filtering. No server-side code branches on it. If we later need finer taxonomy we can enrich freely without a contract migration.

`deadlineBufferMs` is explicit on the entry (round-3 feedback item 5) so the UI can surface "this call is 30s past its provider timeout but still in-flight — sweep pending" without needing to hardcode the buffer value. Keeps debugging self-contained in the UI payload.

Producer: `llmRouter.routeCall()` via `llmInflightRegistry.add()`.
Consumer: (a) socket room `system:llm-inflight` event `llm-inflight:added`, (b) admin API `GET /api/admin/llm-pnl/in-flight` (snapshot endpoint for first paint).

### `InFlightRemoval` (socket payload on completion)

```ts
interface InFlightRemoval {
  runtimeKey: string;              // matches the InFlightEntry being removed
  idempotencyKey: string;          // for UI grouping across attempts
  attempt: number;
  stateVersion: 2;                 // always 2 — removal is the terminal transition from active(1)
  terminalStatus: 'success' | 'error' | 'timeout' | 'aborted_by_caller'
                | 'client_disconnected' | 'parse_failure'
                | 'provider_unavailable' | 'provider_not_configured'
                | 'partial' | 'swept_stale' | 'evicted_overflow';
  sweepReason: 'deadline_exceeded' | null;  // non-null only when terminalStatus='swept_stale'
  evictionContext: { activeCount: number; capacity: number } | null;  // non-null only when terminalStatus='evicted_overflow'
  completedAt: string;             // ISO 8601 UTC
  durationMs: number;
  ledgerRowId: string | null;      // null when terminalStatus causes no ledger insert
  ledgerCommittedAt: string | null;// ISO 8601 — filled iff ledger insert/upsert succeeded
}
```

`terminalStatus` omits `budget_blocked` and `rate_limited` — those are pre-dispatch, so no registry entry ever existed to be removed. It adds:

- `swept_stale` — entry exceeded `deadlineAt` and was reaped by the §4.5 sweep. `sweepReason='deadline_exceeded'` is the one reason shipped in v1 — the field leaves room for future sweep causes without a status-enum migration.
- `evicted_overflow` — entry was force-evicted under the §4.4 `MAX_INFLIGHT_ENTRIES=5_000` cap. `evictionContext: { activeCount, capacity }` is populated so an operator can distinguish real overload from a Redis-partition + sweep-lag leak at a glance.

`stateVersion` on the wire (round-3 feedback item 1) makes every event self-describing for the client's monotonic guard: a reorder can't resurrect a removed entry because the `stateVersion: 2` payload beats any delayed `stateVersion: 1` for the same `(runtimeKey, startedAt)`.

`ledgerCommittedAt` addresses spec-review feedback item 7: the UI now has a positive signal that the ledger row is queryable. When `ledgerRowId != null && ledgerCommittedAt != null`, the row is readable. When `ledgerRowId != null && ledgerCommittedAt == null` (should be rare — the router usually awaits the insert before emitting), the client falls back to a 1–2 second retry loop before giving up.

### Socket event envelope — dedup on the wire

Every emitted socket event carries `eventId = ${runtimeKey}:${type}` where `type ∈ { added, removed }`. Clients de-duplicate by `eventId` via a small LRU (~256) so reconnect replay and multi-instance bridging can't double-render a row.

**Ledger-link rehydration event (Round 4).** The rehydration emission from §4.6 shares the `removed` type but carries an extended eventId `${runtimeKey}:removed:ledger-link`. The suffix keeps dedup caches from swallowing it as a duplicate of the original removal. Client merge semantics: `applyRemoveEntry` stamps `stateVersion: 2` unconditionally and overwrites the `recentlyLanded` entry with populated ledger fields, preserving any already-populated values from the original removal ("once linked, stay linked"). The `setEntries(prev.filter(...))` call inside `applyRemoveEntry` is idempotent — filtering an already-filtered array is a cheap no-op.

### Admin snapshot endpoint

`GET /api/admin/llm-pnl/in-flight?limit=500` → `{ entries: InFlightEntry[], generatedAt: string, capped: boolean }`.

- Hard cap: **500** entries (reviewer round-1 feedback item 5). `capped: true` when the live count exceeded the cap.
- Sort: `startedAt DESC, runtimeKey DESC` — primary by newest-first, secondary by runtimeKey to guarantee stable ordering under load when multiple entries share a millisecond (round-2 feedback item 5). Without the tie-breaker, two snapshot fetches in the same second can return the same rows in different orders and the UI flickers.
- Used for first paint and for reconnect resync. Crucially, this is also the **authoritative read after a Redis partition** — clients recover cross-fleet consistency via snapshot fetch on their own reconnect, not via server-side event replay (see §4.4).
- Gated by `authenticate + requireSystemAdmin` in the existing `server/routes/systemPnl.ts` router.

`limit` is accepted as a query param (1–500) so an admin can intentionally narrow the snapshot during a reconnect storm; values above the hard cap are clamped silently.

**Client-side consistency window.** On first paint / reconnect the client fetches the snapshot and subscribes to the socket room, but incoming socket events are **buffered** before merge. The buffer is held open for the full lifetime of the snapshot GET — `bufferingUntilRef = Number.MAX_SAFE_INTEGER` at fetch start, reset to `Date.now() + 100 ms` in the `finally` block — then drained once the snapshot render catches up. This closes two flicker classes:

1. **Fetch-completion race.** A `remove` event arriving between "snapshot GET returned" and "React rendered the snapshot" could make a row appear and instantly disappear. The 100 ms post-fetch window lets the snapshot render first, then drains the buffer through the same state machine as live events.
2. **Long-fetch race (Round 4).** If the snapshot GET takes longer than 100 ms (cold start, load), events arriving during the fetch would otherwise merge *before* the snapshot render completes — so `setEntries(data.entries...)` overwrites them. Holding the buffer open for the full fetch lifetime eliminates that race at the cost of briefly queueing events during slow fetches.

No server change — the buffer lives in `PnlInFlightTable.tsx` (§6). Snapshot-seeding of the `stateVersionByKeyRef` map (§4.3) complements the buffer by guaranteeing a buffered `added` event for an already-snapshotted runtimeKey is rejected at drain time.

---

## 6. Files to change

| File | Change |
|---|---|
| `server/services/llmInflightRegistry.ts` | **New** — per-process `Map<runtimeKey, { entry, state }>` + Redis pub/sub + socket broadcast. Enforces the §4.3 state machine at every add/remove/subscribe boundary. Exposes `has(runtimeKey): boolean` for the router-side pre-add invariant assert (see llmRouter.ts row below). Overflow path uses `countActive()` rather than `slots.size` (§4.4 hardening rule 2); Redis-fanout overflow drops silently rather than evict-and-republish (§4.4 hardening rule 3). Exposes `updateLedgerLink()` for the §4.6 rehydration contract. |
| `server/services/llmInflightRegistryPure.ts` | **New** — pure logic: entry-shape builder, `runtimeKey` derivation (`idempotencyKey:attempt:startedAt`), `deadlineAt` calc, terminal-status → `ledgerRowId`-expected mapping, state-machine transition rules, LRU overflow selection (oldest `startedAt` wins eviction), snapshot sort comparator. Testable without Redis/socket. |
| `server/config/limits.ts` | **Modify** — add `MAX_INFLIGHT_ENTRIES = 5_000` + `INFLIGHT_SWEEP_INTERVAL_MS = 60_000` + `INFLIGHT_SWEEP_JITTER_MS = 5_000` + `INFLIGHT_DEADLINE_BUFFER_MS = 30_000` + `INFLIGHT_SNAPSHOT_HARD_CAP = 500`. Keeps tunables alongside existing limits rather than scattering them. |
| `server/services/llmRouter.ts` | **Modify** — call `registry.add()` **inside the provider-retry loop, after budget reservation, immediately before `providerAdapter.call()`**; call `registry.remove()` in the `finally` block adjacent to the ledger write, with `ledgerCommittedAt` set to the post-insert timestamp. Pre-dispatch terminal paths (`budget_blocked`, `rate_limited`) must **not** add. **Pre-add invariant**: assert `!registry.has(runtimeKey)` immediately before `registry.add()` — catches accidental double-add from future refactors at the call site rather than swallowing it as a registry-layer no-op. Registry-layer no-ops stay silent for Redis fanout races; router-layer double-add is a programmer bug and must fail fast in dev (assert behind `process.env.NODE_ENV !== 'production'` so we don't crash prod on a hot-path anomaly — instead log at `error`). Tracks `lastRemovedAttempt` across retryable-error catches for §4.6 rehydration; failure path calls `inflightRegistry.updateLedgerLink()` when `currentRuntimeKey` is null but `lastRemovedAttempt` is set. Captures ledger row id via `.returning({ id: llmRequests.id })` on both success and failure inserts. |
| `server/routes/systemPnl.ts` | **Modify** — add `GET /api/admin/llm-pnl/in-flight?limit=500` snapshot endpoint. Hard cap 500, sorted `startedAt DESC`, `capped: boolean` flag. Intentionally does NOT use the `wrap({ data, meta })` helper used by other P&L routes — the in-flight response is its own envelope shape (`{ entries, generatedAt, capped }`) per §5. |
| `server/websocket/rooms.ts` | **Modify** — new handler `join:system-llm-inflight` that rejects non-system-admin sockets and joins the `system:llm-inflight` room. Companion `leave:system-llm-inflight` handler. |
| `server/services/__tests__/llmInflightRegistryPure.test.ts` | **New** — 27 pure tests: runtimeKey derivation, state-machine transitions (add→active, add-while-active = no-op, remove→removed, remove-while-removed = no-op, stale-startedAt event ignored), deadline calc, snapshot cap + sort, LRU selection, stateVersion monotonic guard, active-count gauge payload shape, sweep selection, noop-at-capacity boundary test (Round 4 — pinning the noop-before-eviction ordering at the pure-layer level). |
| `server/index.ts` | **Modify** — `llmInflightRegistry.init()` in boot sequence after `initWebSocket`; `llmInflightRegistry.shutdown()` in graceful-shutdown handler between Socket.IO close and pg-boss stop. |
| `server/lib/tracing.ts` | **Modify** — add `'llm.inflight.active_count'` to the `EVENT_NAMES` tuple for the §4.4 gauge emission. |
| `client/src/pages/SystemPnlPage.tsx` | **Modify** — new first tab **In-Flight**, renders live table from socket events + snapshot fetch. Local `eventId` LRU for dedup. Client-side 1–2s retry on ledger-row fetch when `ledgerCommittedAt == null`. Passes `onOpenDetail={setSelectedCallId}` into the table so the `[ledger]` button in the "Recently landed" strip opens the existing `PnlCallDetailDrawer`. |
| `client/src/components/system-pnl/PnlInFlightTable.tsx` | **New** — live table component. Client-local elapsed-time ticking (setInterval 1s, not socket spam). Socket-event buffer held open for full-fetch lifetime + 100 ms after fetch resolution before merging with the snapshot (§5 consistency window). Bounded `recentlyRemovedRef: Set<runtimeKey>` (256 entries) + `stateVersionByKeyRef: Map<runtimeKey, 1\|2>` (256 entries) implement the client-side monotonic guard (§4.3). `onOpenDetail?: (ledgerRowId) => void` prop wires the `[ledger]` link to the parent page's call-detail drawer. UI surfaces `deadlineBufferMs` so entries past `startedAt + timeoutMs` but before `deadlineAt` are visibly labelled "past timeout — sweep pending" rather than looking like a stuck happy-path call. |
| `shared/types/systemPnl.ts` | **Modify** — export `InFlightEntry`, `InFlightRemoval`, `InFlightEventEnvelope<T>`, `InFlightSnapshotResponse`, `InFlightActiveCountPayload`, `InFlightSourceType`, `InFlightTerminalStatus`, `InFlightSweepReason`, `InFlightEvictionContext`. |
| `architecture.md` | **Modify** — add "LLM in-flight registry" subsection under the LLM router contract. |
| `docs/capabilities.md` | **Modify** — add bullet under "LLM Spend Observability": real-time in-flight tracker for system admins. |
| `tasks/pr-review-log-llm-inflight-tracker-2026-04-20T00-00-00Z.md` | **New** (persistence artefact) — pr-reviewer log per CLAUDE.md review-log convention. |
| `tasks/dual-review-log-llm-inflight-tracker-2026-04-21T01-13-02Z.md` | **New** (persistence artefact) — dual-reviewer 3-iteration log. |
| `tasks/llm-inflight-deferred-items-brief.md` | **New** (follow-up artefact) — per-item briefs for the eight §9 deferred items, so future sessions can jump straight into draft specs. |

No migration. No schema change. No new table.

---

## 7. Permissions / RLS

No new table → no RLS policy needed. All surface is system-admin:

- Snapshot endpoint: `authenticate + requireSystemAdmin`.
- Socket room: the `join:system-llm-inflight` handler checks `socket.data.user.isSystemAdmin === true` before joining; rejects silently otherwise (same pattern as `join:subaccount` UUID validation — no error disclosure).
- In-flight entries include cross-tenant attribution fields — this is acceptable because the viewer is a system admin by construction. Non-admin sockets never see these events.

---

## 8. Phase sequencing

Single-phase build. No dependency graph to police.

1. Add registry service + pure file + tests.
2. Wire router add/remove calls.
3. Add snapshot endpoint + socket room.
4. Build UI tab + table.
5. Doc updates.

Each step is independently mergeable — a partial merge (service + router, no UI) leaves the system functional with registry entries accruing and no consumers yet.

## 9. Deferred Items

- **Token-level streaming progress.** Providers that support SSE streaming (Anthropic messages API, OpenAI responses API) could emit incremental token events the UI renders as a live progress bar. Requires the router to opt into streaming mode and buffer tokens, which is a non-trivial change to the adapter contract. Deferred because the primary use case — "is this call stuck?" — is answered by start-time + elapsed-ms alone.
- **Historical in-flight archive.** Writing in-flight entries to a short-TTL table for forensic replay. Deferred until we hit an incident where the registry disappeared before we could debug.
- **Per-caller detail drawer mid-flight.** Clicking a live row to see the prompt/completion-so-far. Requires payload capture at dispatch time. Deferred — most debugging is possible from the ledger row once the call lands.
- **Mobile/responsive layout for the In-Flight tab.** Desktop-first. Deferred.
- **Queueing-delay visibility (`queuedAt`).** Surface the gap between "caller invoked `routeCall`" and "adapter dispatch" — useful for catching pre-dispatch contention (budget-reservation lock wait, provider-cooldown bounce chain). Not required for v1; the in-flight window already covers the dispatch→completion band that matters most.
- **Partial-external-success protection — provisional ledger row.** *Committed follow-up spec — scoped separately from this tracker because it's a ledger-write contract change, not an observability change.* Gap: `providerAdapter.call()` succeeds (provider has billed) → `db.insert(llmRequests)` fails (DB blip) → caller retries with same `idempotencyKey` → success-row check misses → provider re-dispatched → double-bill, with no ledger trace of the first success. Spec-review round 2 pushed back on deferring this purely on "narrow window" grounds — and the pushback is correct: this is direct financial risk, not ergonomics.

  **Minimal-viable design to pin in the follow-up spec** (not implemented here):

  1. Extend the `llm_requests.status` enum with a provisional value — preferred name `'started'` (append-only semantics preserved: the first write is an append, the second is an upsert that *replaces* the started row with a terminal row keyed by `idempotencyKey`).
  2. Write the `'started'` row in the same transaction that reserves budget, **before** `providerAdapter.call()`. Row carries `idempotencyKey`, `runtimeKey`, `provider`, `model`, `startedAt`, everything needed for a forensic "we called this provider" record.
  3. On provider success, upsert via the existing `onConflictDoUpdate({ target: idempotencyKey, where: status != 'success' })` path — 'started' is an error-like state for the dedup check, so a successful retry cleanly overwrites it (same mechanic already used for error → success transitions).
  4. On provider failure, the existing failure-path upsert already writes the terminal row — nothing new to wire.
  5. Retry semantics: a caller that retries under the same `idempotencyKey` after a provider-success + DB-insert-failure sees a `'started'` row in the pre-dispatch check. The check treats `'started'` as "in-flight, do not re-dispatch — return cached partial response or surface a reconciliation-required error". The exact return contract is the open question for the follow-up spec.

  **Interaction with this tracker**: the in-memory registry becomes a **low-latency cache in front of the provisional `'started'` row**, not a parallel surface. The registry still handles sub-second UI updates; the row handles durability and cross-retry dedup. No redesign of the tracker is needed to accommodate the follow-up — the runtimeKey, idempotencyKey, and ledgerRowId fields already carry the needed reconciliation handles.

  **Why deferred from this spec despite the financial risk**: scope separation. This spec is a focused observability change with zero schema impact. The provisional-row fix is a schema migration + ledger-write pattern change + retry-contract change — an independent spec deserves independent review and its own phased rollout. Bundling them doubles the surface area this spec asks a reviewer to approve and slows the tracker's ship for a change the tracker doesn't depend on. The follow-up spec is tracked in `tasks/llm-observability-ledger-generalisation-spec.md §17` and will block its own merge on the dual-bill risk, not this tracker's merge.
- **Idempotency-key versioning (`v1:` prefix).** Both `buildActionIdempotencyKey` (`server/services/actionService.ts`) and `llmRouter`'s `idempotencyKey` derivation are content-hashes of inputs. If the canonicalisation contract ever changes — new field added, nested-key sort tweaked, null-vs-absent policy adjusted — dedup silently breaks across the deploy boundary: old rows hash one way, new calls hash another, so a retry looks like a fresh call. A fixed `v1:` prefix (tracked via a constant + included in the hash input) makes this explicit: a version bump forces new keys and a deliberate migration decision rather than an invisible drift. Deferred because the current canonicalisation is pinned by `actionServiceCanonicalisationPure.test.ts` with known-good fixtures — any breaking change trips those tests. But the prefix is cheap future-proofing worth adopting before the first real canonicalisation change lands.

---

## 10. Testing posture

Per `docs/spec-context.md`:

- **Pure tests only** in `llmInflightRegistryPure.test.ts`:
  - `runtimeKey` derivation: `${idempotencyKey}:${attempt}:${startedAt}`. Two entries with the same `(idempotencyKey, attempt)` but different `startedAt` (crash-restart case) produce different runtimeKeys and do not collide.
  - `deadlineAt` calc: `startedAt + timeoutMs + 30_000` — invariant across every `timeoutMs` value.
  - State-machine transitions: `add→active` (first call), `add-while-active` (no-op, no socket emission, logs `add_noop_already_exists`), `remove→removed`, `remove-while-removed` (no-op, no socket emission, logs `remove_noop_already_removed`), `remove-missing-key` (no-op, logs `remove_noop_missing_key`).
  - Stale-event filter: incoming event with `startedAt < existing.startedAt` is ignored (logs `event_stale_ignored`).
  - Terminal-status → `ledgerRowId`-expected mapping: `success`/`error`/`timeout`/`aborted_by_caller`/`client_disconnected`/`parse_failure`/`provider_unavailable`/`provider_not_configured`/`partial` all expect a ledger row; `swept_stale` and `evicted_overflow` do not.
  - Snapshot cap + stable sort: capping at 500 preserves the newest-first window; `capped` flag set correctly when > 500 live; secondary sort by `runtimeKey DESC` keeps identical-`startedAt` entries in stable order across repeated snapshots.
  - LRU overflow selection: when the map is at `MAX_INFLIGHT_ENTRIES` and add is called, the entry with the smallest `startedAt` is selected for eviction; the evicted entry produces an `InFlightRemoval` with `terminalStatus: 'evicted_overflow'` and `evictionContext: { activeCount, capacity }` populated.
  - `eventId` shape: `${runtimeKey}:${type}` — unique across (runtimeKey, type) pairs.
  - Sweep emission carries `sweepReason: 'deadline_exceeded'` when `terminalStatus='swept_stale'`, `null` otherwise; `evictionContext` is non-null iff `terminalStatus='evicted_overflow'`.
  - `stateVersion` monotonic guard: same-`startedAt` reorder cases — a delayed `stateVersion: 1` add event arriving after a `stateVersion: 2` remove has already won is ignored; the guard accepts `(startedAt ↑)` OR `(startedAt ==, stateVersion ↑)` and rejects everything else.
  - Active-count gauge payload shape: `{ activeCount, byCallSite: { app, worker }, byProvider: Record<string, number> }` — sums match `activeCount`; provider keys match entries' `provider` field.
- **Static gates**: the existing `verify-no-direct-adapter-calls.sh` already guarantees the router is the only interception point — no new gate needed.
- **No frontend tests, no API contract tests, no E2E** — per `testing_posture: static_gates_primary` / `frontend_tests: none_for_now`.

Smoke-test posture for reviewer (manual, not a CI gate): run a long skill-analyzer job, open `/system/llm-pnl` → In-Flight tab, confirm row appears within 100ms of dispatch and disappears on completion with ledger row linked.

---

## 11. Self-consistency check

- Goals (§2) match implementation (§4–§6): in-memory registry, socket push, no ledger mutation — all three wired consistently.
- Every "must" / "guarantees" has a named mechanism:
  - Append-only ledger preserved → no writes from this spec (ledger is read-only from the registry's perspective).
  - Cross-tenant attribution safe → socket room gated by `isSystemAdmin` on the `join:system-llm-inflight` handler.
  - No orphaned entries → deadline-based sweep with jitter (`deadlineAt = startedAt + timeoutMs + 30s`; sweep every `60s ± 5s`) + `swept_stale` terminal status with `sweepReason='deadline_exceeded'`.
  - No flicker / false positives → post-dispatch-only `add()`, monotonic state machine, stale-event filter, eventId dedup on the client, stable snapshot secondary sort.
  - Concurrent retries + crash-restarts don't collide → registry keyed by `runtimeKey = idempotencyKey:attempt:startedAt`.
  - UI reconciliation against the ledger → `ledgerCommittedAt` on removal events + a bounded client-side retry fallback.
  - Snapshot doesn't blow the wire → hard cap 500, sorted `startedAt DESC, runtimeKey DESC`, `capped` flag for UI honesty.
  - Registry can't grow unbounded under degraded conditions → `MAX_INFLIGHT_ENTRIES=5_000` hard cap + LRU overflow eviction with `evicted_overflow` terminal status + `evictionContext` payload as a visible ops signal (distinguishes overload from leak).
  - Programmer-bug double-add caught at source → router-layer `assert(!registry.has(runtimeKey))` pre-add invariant (dev assert + prod error log).
  - Redis partition is survivable → no event replay on reconnect; clients recover via authoritative snapshot fetch.
  - Same-timestamp reorder can't resurrect a removed entry → `stateVersion` ladder (`active=1 → removed=2`) on every event; monotonic acceptance rule `(startedAt ↑)` OR `(startedAt ==, stateVersion ↑)`.
  - UI doesn't flicker on snapshot + live-event race → client buffers socket events 100 ms on mount/reconnect before merging with snapshot.
  - UI can explain "why is this still in-flight after timeout?" → `deadlineBufferMs` explicit on the entry, labelled "past timeout — sweep pending" by the client between `startedAt+timeoutMs` and `deadlineAt`.
  - Operational visibility into steady-state anomalies → structured no-op logs (`add_noop_already_exists`, `remove_noop_already_removed`, `remove_noop_missing_key`, `event_stale_ignored`) + `llm.inflight.active_count` gauge tagged by `callSite` and `provider` (spots stuck workers + provider-specific hangs without digging).
  - Client-side monotonic guarantee matches the server's (Round 4) → `stateVersionByKeyRef` mirror on the client (256-entry LRU) + snapshot-seeding of version 1 on mount. Belt-and-braces over the 256-entry `recentlyRemovedRef` set.
  - Noop add under capacity pressure can't corrupt live state (Round 4) → `applyAdd` check runs before the overflow-eviction branch in `add()`; eviction only fires for genuine new entries. Pinned by pure test at the state-machine layer.
  - Removed-slot retention can't cause premature active-entry eviction (Round 4) → overflow predicate uses `countActive()`, not `slots.size`. The map can hold up to 2× capacity transiently; the *live* count is bounded at exactly `MAX_INFLIGHT_ENTRIES`.
  - Redis fanout can't echo false evictions back to the origin (Round 4) → remote-add overflow drops silently; origin instance remains the single source of truth for its own calls.
  - Retryable-error-only failure chains still link the ledger row (Round 4) → router captures `lastRemovedAttempt`; failure path calls `inflightRegistry.updateLedgerLink()` for post-hoc ledger linkage. Client merge preserves "once linked, stay linked" semantics.
  - Long snapshot GET doesn't allow premature event merge (Round 4) → buffer held open for full fetch lifetime (`Number.MAX_SAFE_INTEGER`), reset in `finally`.
- Non-functional claims consistent with execution model: real-time push = socket, not polling; multi-instance consistency = Redis pub/sub + state-machine-guarded merge, not DB reads; bounded memory = hard cap + LRU eviction, not hope.

---

## 12. Resolved during spec review

### Round 1 (2026-04-20)

Reviewer ran a 10-point pass on the initial draft. Items incorporated directly into §4–§6, §10:

| # | Reviewer concern | Resolution |
|---|---|---|
| 1 | Exactly-once removal across instances | §4.3 state machine + §4.4 eventId dedup |
| 2 | Race: add before pre-dispatch failures | §4.1 — add fires post-budget, pre-adapter-call; pre-dispatch terminals never add |
| 3 | Idempotency key collision on concurrent retries | §4.2 runtimeKey = `${idempotencyKey}:${attempt}` (strengthened in round 2) |
| 4 | Naive stale sweep | §4.5 deadline-based sweep + distinct `swept_stale` terminal status |
| 5 | No snapshot cap / backpressure | §5 snapshot endpoint: hard 500 cap, sorted `startedAt DESC`, `capped` flag |
| 6 | Redis fanout duplication | §4.4 eventId dedup via client LRU |
| 7 | UI reconciliation gap vs ledger | §5 `ledgerCommittedAt` on `InFlightRemoval` + documented client fallback |
| 8 | Elapsed time field | No server change — §6 confirms client-local 1s tick, not socket spam |
| 9 | Queueing-delay visibility (`queuedAt`) | Deferred (§9) — high-value but not v1 |
| 10 | `callSite` enum too coarse | §5 documents as display-only; no logic branches on it |

Original open questions, answered by reviewer:

- **Stale-sweep threshold.** Use `deadlineAt = startedAt + timeoutMs + 30s` captured at add-time. No env var. Resolved in §4.5.
- **Snapshot cap.** Implement now: 500 rows, newest-first. Resolved in §5.
- **Default tab.** Keep current default — P&L is primarily financial; in-flight is diagnostic. Left unchanged in §6.

### Round 2 (2026-04-20)

Reviewer ran a second pass flagging edge-case hardening + observability completeness. Nothing architectural; all localised contract tightening. Items incorporated:

| # | Reviewer concern | Resolution |
|---|---|---|
| 1 | Dedupe visibility at semantic level | §4.3 structured no-op logs (`add_noop_already_exists`, `remove_noop_already_removed`, `remove_noop_missing_key`, `event_stale_ignored`) — covers both items 1 and 6 |
| 2 | Registry memory bound under degraded conditions | §4.4 `MAX_INFLIGHT_ENTRIES=5_000` + LRU overflow eviction + new `evicted_overflow` terminal status |
| 3 | Crash-vs-timeout distinction | §4.5 simplified: single `swept_stale` status + `sweepReason='deadline_exceeded'` field; operational inference draws the crash conclusion rather than labelling it in the status. (Reviewer's two-pass sweep couldn't work mechanically — entry is gone after first sweep.) |
| 4 | runtimeKey crash-restart collision | §4.2 strengthened: `runtimeKey = idempotencyKey:attempt:startedAt` |
| 5 | Snapshot stable-ordering under concurrency | §5 secondary sort `runtimeKey DESC` |
| 6 | No-op removal guard reason | Covered by §4.3 structured logs (merged with item 1) |
| 7 | Router-side pre-add invariant | §6 llmRouter.ts row: `assert(!registry.has(runtimeKey))` at the router call site, behind NODE_ENV guard — catches programmer bugs without crashing prod |
| 8 | Active-count gauge | §4.4 `llm.inflight.active_count` via existing `createEvent` pattern |
| 9 | Sweep jitter to avoid sync storms | §4.5 `60_000 ± 5_000` ms |
| 10 | Redis partition behaviour | §4.4 explicit: no event replay on reconnect; snapshot is the authoritative recovery read |

**Partial-external-success protection — pushback accepted with scope separation.** Reviewer argued this is direct financial risk, not ergonomics, and "logs + in-flight tracker" is insufficient. §9 upgraded from "deferred" to "committed follow-up spec" with the minimal-viable design pinned (provisional `status='started'` row + existing `onConflictDoUpdate` upsert path). Kept out of this spec's scope because it's a ledger-write contract change + schema migration + retry-contract change — an independent concern that deserves independent review. Tracked in `tasks/llm-observability-ledger-generalisation-spec.md §17` so it won't be forgotten.

### Round 3 (2026-04-20) — approved for build

Reviewer signed off ("Ready for build") after round 2 and flagged 5 final polish items worth applying. All 5 accepted — each closes a genuine operational/UX gap with a small contract addition:

| # | Reviewer concern | Resolution |
|---|---|---|
| 1 | Same-`startedAt` reorder could resurrect a removed entry | §4.3 `stateVersion` ladder (1=active, 2=removed) on entries + every event; monotonic acceptance rule `(startedAt ↑) OR (startedAt ==, stateVersion ↑)` |
| 2 | `evicted_overflow` couldn't distinguish overload from leak | §4.4 + §5 `evictionContext: { activeCount, capacity }` on every eviction emission |
| 3 | Active-count gauge too coarse to spot stuck workers / provider hangs | §4.4 gauge tagged with `byCallSite: { app, worker }` + `byProvider: Record<string, number>` |
| 4 | Snapshot + live-event race could flicker on mount/reconnect | §5 + §6 client-side 100 ms socket-event buffer before merging with snapshot |
| 5 | `deadlineBufferMs` invisible to UI made "past timeout but not swept" confusing | §5 entry carries `deadlineBufferMs` explicitly; §6 UI labels the pre-sweep window |

**Reviewer's closing framing** (kept for posterity):
> This spec shows a clear shift from feature design → to failure-mode engineering.

The round-3 additions preserve that framing — each one is specifically about making degraded-state behaviour legible to an operator under pressure, not about adding happy-path features.

### Round 4 (2026-04-20 → 2026-04-21) — post-build hardening

Three independent review passes ran against the implementation after round-3 sign-off, each finding real bugs or legitimate gaps. Fixes landed on branch `claude/build-llm-inflight-tracker-m3l2x` with the feature merged via PR #161 on 2026-04-21. Review logs persisted at `tasks/pr-review-log-llm-inflight-tracker-2026-04-20T00-00-00Z.md` and `tasks/dual-review-log-llm-inflight-tracker-2026-04-21T01-13-02Z.md` per CLAUDE.md convention.

**Pass 4a — `pr-reviewer` (1 blocking + 3 strong + 5 non-blocking):**

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | Blocking | Overflow eviction fired before the noop-already-exists check in `add()` — a double-add at capacity (e.g. stale Redis race, or prod `console.error` fallback path after dev assert) would evict an unrelated entry + emit a spurious `evicted_overflow` event | §4.4 hardening rule 1 — noop check moved before overflow branch. Pinned by new pure test `add() boundary — noop_already_exists must short-circuit BEFORE overflow eviction`. |
| 2 | Strong | Client's `applyAddEntry` only checked `entries` array presence, not stateVersion — a delayed add arriving after its remove had aged out of the 256-entry `recentlyRemovedRef` could resurrect a landed row | §4.3 client-side mirror guard — `stateVersionByKeyRef: Map<runtimeKey, 1\|2>` with strict monotonic check in `applyAddEntry`. Snapshot seeds version 1 for all returned entries. |
| 3 | Strong | No pure test for the noop-at-capacity boundary case (the very condition that triggered blocking #1) | Added boundary test explicitly pinning the ordering contract at the pure-layer level. |
| 4 | Non-blocking | `attempt` counter reset per-provider in fallback chain gives admins a confusing "#1 → #2 → #1" sequence | Documented as UX gap in the spec and in a code comment at the call site; follow-up item #4 in `tasks/llm-inflight-deferred-items-brief.md` covers the fix (add `globalAttemptSequence`). |
| 5 | Non-blocking | `bufferingUntilRef` set to fetch-start + 1s rather than held for full fetch lifetime | Replaced with `Number.MAX_SAFE_INTEGER` during fetch, reset in `finally`. See §5 consistency window. |

**Pass 4b — `dual-reviewer` (3 iterations, 3 accepted, 3 rejected):**

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | P1 | Overflow check used `slots.size` which counted 30s-retained removed slots, causing premature eviction of still-active entries under high churn | §4.4 hardening rule 2 — predicate scoped to `countActive()`. |
| 2 | P2 | Redis-fanout overflow path called `evictVictim()` which `remove()`-d and republished the eviction back to Redis — the origin instance received its own victim back as a remove event, flipping its active call to "evicted" | §4.4 hardening rule 3 — remote-add overflow drops silently with a debug log instead of evicting. |
| 3 | P2 | "Recently landed" `[ledger]` link was a `<a href="#call-${id}">` anchor that changed `location.hash` but didn't open the call-detail drawer | Replaced with `<button onClick>` wired through new `onOpenDetail?: (ledgerRowId) => void` prop on `PnlInFlightTable`. `SystemPnlPage` passes `setSelectedCallId`. |
| 4 | P2 | *Rejected.* Removed-slot retention map growth under churn — reviewer flagged `countActive()` alone doesn't bound total map size, only live count | Intentional design — 30s retention is explicitly documented at the `scheduleSlotPrune` call site. Active-count cap is the correct bound for what the operator observes. |
| 5 | P2 | *Rejected.* Last retryable failure removes with `ledgerRowId: null` because inner-catch clears `currentRuntimeKey` before the ledger row is written | Initially rejected as out-of-scope; re-raised and accepted in Pass 4c below. |
| 6 | P3 | *Rejected.* Same-millisecond fallback attempts could in principle share a runtimeKey | Pre-existing documented UX gap; not a correctness issue because `idempotencyKey` varies by `provider+model` (derivation at `llmRouter.ts:121-147`). Not re-litigated. |

**Pass 4c — final reviewer (2 high-priority + 1 optional, all accepted):**

| # | Priority | Finding | Resolution |
|---|---|---|---|
| 1 | High | Client `stateVersion` guard missing — spec §4.3 describes the server side but the client has no explicit monotonic check | Implemented as Pass 4a item 2 above. Reviewer re-confirmed acceptance in final pass. |
| 2 | High | Noop-add precedes eviction | Confirmed already addressed in Pass 4a item 1. |
| 3 | Optional | Retryable-error-only failure chains leave "Recently landed" without a `[ledger]` button | §4.6 ledger-link rehydration — new `inflightRegistry.updateLedgerLink()` method + router `lastRemovedAttempt` capture. This reverses the Pass 4b item 5 rejection on reviewer re-evaluation: the original rejection rationale ("out of scope, requires look-ahead") was correct for the proposed inner-loop fix; the rehydration approach confines the change to a cold path. |

**Pass 4d — final reviewer cleanup (non-blocking, accepted):**

The reviewer's last pass flagged that `updateLedgerLink()`'s narrow-use-case contract was documented only in the call-site comment; future contributors could plausibly reach for it as a general "update a removed event" escape hatch. Fix: expanded the registry-layer method header with a header warning, an explicit "DO NOT call this" misuse list (change non-ledger fields, mutate terminalStatus after remove, call more than once, fix wrong-runtimeKey removals), and guidance that richer semantics should go in a new method with its own contract. Comment-only change; no behaviour change.

**Overall Round 4 reviewer framing** (final pass, kept for posterity):
> You've built this correctly at a systems level: clean separation of concerns, correct lifecycle hooks, production-aware constraints, thoughtful UI reconciliation. [...] One of those rare cases where correctness is tight, edge cases are explicitly handled, tradeoffs are conscious and documented. You're not carrying hidden debt into main.

Round 4 extended the round-3 "feature design → failure-mode engineering" framing into post-build hardening territory. Every accepted finding closed a real race or legibility gap; every rejected finding was rejected with explicit rationale pinned either in the spec or in a code comment. The spec is now a living record of the implemented state, not just the intent.
