# LLM In-Flight Real-Time Tracker — Spec

**Status:** Approved for build — spec-review round 3 sign-off (2026-04-20).
**Author:** Main session.
**Date:** 2026-04-20.
**Last revised:** 2026-04-20 — round 3 polish folded in (§12 round 3 table): `stateVersion` monotonic guard, `evictionContext` on overflow emissions, active-count gauge tagged by `callSite` + `provider`, client-side 100 ms snapshot-consistency buffer, `deadlineBufferMs` exposed on entries for UI clarity.
**Branch when built:** new branch — do not bundle with `claude/build-llm-observability-ledger-iiTcC`.
**Predecessor:** `tasks/llm-observability-ledger-generalisation-spec.md` — completed 2026-04-20. That spec generalised the completed-call ledger (`llm_requests`) for all consumers. This spec extends observability to **in-flight calls** — the gap between dispatch and completion.

---

## Table of contents

1. Problem statement
2. Goal
3. Primitives search (existing reuse)
4. Execution model
5. Contracts
6. Files to change
7. Permissions / RLS
8. Phase sequencing
9. Deferred Items
10. Testing posture
11. Self-consistency check
12. Resolved during spec review

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

### 4.4 Broadcast + multi-instance fanout

`server/services/llmInflightRegistry.ts` maintains a per-process `Map<runtimeKey, { entry: InFlightEntry, state: EntryState }>` + emits socket events to room `system:llm-inflight`.

When `REDIS_URL` is set (production default), the registry publishes add/remove events on Redis channel `llm-inflight`. Each instance subscribes and merges remote events into its own map **through the same state-machine rules** before rebroadcasting locally. Net result: a system admin connected to any instance sees every in-flight call across the fleet.

**Event de-duplication on the wire.** Every socket payload carries `eventId = ${runtimeKey}:${type}` (`type ∈ { added, removed }`). Clients maintain a small LRU of seen `eventId`s (~256 entries) and drop duplicates, so a reconnect or a client bridged to two instances won't double-render.

**Redis partition tolerance.** If the Redis subscriber disconnects and reconnects mid-flight, the registry **does not** replay historical events on reconnect — it simply resumes live subscription. Clients recover cross-fleet consistency via the snapshot endpoint (§5) on their own reconnect, not via a server-side event replay. Replay would re-introduce the flicker/duplicate class the state machine exists to prevent, and would require per-event persistence (which the registry explicitly does not have). This is the intentional trade-off: a brief Redis partition shows a stale local-only view on each partitioned instance until Redis recovers; the snapshot endpoint provides the authoritative read.

**Hard memory cap with LRU overflow eviction.** The per-process map is capped at `MAX_INFLIGHT_ENTRIES = 5_000`. On add, if the map is at cap, the oldest entry (by `startedAt`) is force-evicted:

- Local eviction emits `InFlightRemoval` with `terminalStatus: 'evicted_overflow'` and an `evictionContext: { activeCount, capacity }` field to the socket room and to Redis. The context lets an operator immediately distinguish real overload (`activeCount === capacity && steady growth`) from a Redis-down + sweep-delayed leak (`activeCount === capacity && no corresponding dispatch spike`) without digging logs.
- Evictions are logged at `warn` level with the evicted `runtimeKey` + `evictionContext` — in steady state the cap is 100× headroom over expected concurrency, so any eviction is a real signal.

Without this cap, a pathological Redis-down + sweep-delayed combo could accumulate entries unbounded. With it, the worst case is a bounded memory footprint + a visible overflow signal.

**Active-count gauge.** Every add/remove emits `llm.inflight.active_count` via the existing `createEvent` pattern, carrying:

- `activeCount: number` — current local map size.
- `byCallSite: { app: number; worker: number }` — per-`callSite` breakdown.
- `byProvider: Record<string, number>` — per-provider breakdown (e.g. `{ anthropic: 3, openai: 7 }`).

The breakdowns make it trivial to spot stuck workers (`byCallSite.worker` climbs while `byCallSite.app` stays flat) or provider-specific hangs (one provider's count climbs while others drain). Downstream alerting is an ops concern layered on top of the gauge, not built in this spec.

### 4.5 Stale-entry sweep — deadline-based, not elapsed-based

Each entry records a `deadlineAt = startedAt + timeoutMs + 30_000` at add-time. A safety-net timer fires every `60_000 ± 5_000` ms (the jitter prevents multi-instance sweep-storm synchronisation) and removes entries where `now > deadlineAt`, emitting `terminalStatus: 'swept_stale'` with `reason: 'deadline_exceeded'`.

In practice any deadline-exceeded entry is overwhelmingly a process crash between `registry.add()` and the `finally`-block `registry.remove()`. The router's own `callWithTimeout` (`llmRouterTimeoutPure.ts`) would have aborted the provider call at `timeoutMs` — the extra 30s buffer past that is precisely the window where only a crash can leave the entry alive. We surface `'deadline_exceeded'` as the reason rather than labelling it `'crash_orphaned'` because the sweep cannot positively prove a crash; the operational inference is the right place to draw that conclusion. The reason field leaves room for future sweep causes without a status-enum migration.

Capturing the deadline at add-time makes the sweep robust to `PROVIDER_CALL_TIMEOUT_MS` changes mid-run and to small clock drift across instances. Sweep removals are logged at `warn` with the runtimeKey so a crash loop is detectable from logs alone.

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

### Admin snapshot endpoint

`GET /api/admin/llm-pnl/in-flight?limit=500` → `{ entries: InFlightEntry[], generatedAt: string, capped: boolean }`.

- Hard cap: **500** entries (reviewer round-1 feedback item 5). `capped: true` when the live count exceeded the cap.
- Sort: `startedAt DESC, runtimeKey DESC` — primary by newest-first, secondary by runtimeKey to guarantee stable ordering under load when multiple entries share a millisecond (round-2 feedback item 5). Without the tie-breaker, two snapshot fetches in the same second can return the same rows in different orders and the UI flickers.
- Used for first paint and for reconnect resync. Crucially, this is also the **authoritative read after a Redis partition** — clients recover cross-fleet consistency via snapshot fetch on their own reconnect, not via server-side event replay (see §4.4).
- Gated by `authenticate + requireSystemAdmin` in the existing `server/routes/systemPnl.ts` router.

`limit` is accepted as a query param (1–500) so an admin can intentionally narrow the snapshot during a reconnect storm; values above the hard cap are clamped silently.

**Client-side consistency window.** On first paint / reconnect the client fetches the snapshot and subscribes to the socket room, but incoming socket events are **buffered** for 100 ms before merge. This closes a tiny UX flicker: a `remove` event arriving between "snapshot GET returned" and "React rendered the snapshot" could make a row appear and instantly disappear. The 100 ms buffer lets the snapshot render first, then drains the buffer through the same state machine as live events. No server change — the buffer lives in `PnlInFlightTable.tsx` (§6).

---

## 6. Files to change

| File | Change |
|---|---|
| `server/services/llmInflightRegistry.ts` | **New** — per-process `Map<runtimeKey, { entry, state }>` + Redis pub/sub + socket broadcast. Enforces the §4.3 state machine at every add/remove/subscribe boundary. Exposes `has(runtimeKey): boolean` for the router-side pre-add invariant assert (see llmRouter.ts row below). |
| `server/services/llmInflightRegistryPure.ts` | **New** — pure logic: entry-shape builder, `runtimeKey` derivation (`idempotencyKey:attempt:startedAt`), `deadlineAt` calc, terminal-status → `ledgerRowId`-expected mapping, state-machine transition rules, LRU overflow selection (oldest `startedAt` wins eviction), snapshot sort comparator. Testable without Redis/socket. |
| `server/config/limits.ts` | **Modify** — add `MAX_INFLIGHT_ENTRIES = 5_000` + `INFLIGHT_SWEEP_INTERVAL_MS = 60_000` + `INFLIGHT_SWEEP_JITTER_MS = 5_000` + `INFLIGHT_DEADLINE_BUFFER_MS = 30_000`. Keeps tunables alongside existing limits rather than scattering them. |
| `server/services/llmRouter.ts` | **Modify** — call `registry.add()` **inside the provider-retry loop, after budget reservation, immediately before `providerAdapter.call()`**; call `registry.remove()` in the `finally` block adjacent to the ledger write, with `ledgerCommittedAt` set to the post-insert timestamp. Pre-dispatch terminal paths (`budget_blocked`, `rate_limited`) must **not** add. **Pre-add invariant**: assert `!registry.has(runtimeKey)` immediately before `registry.add()` — catches accidental double-add from future refactors at the call site rather than swallowing it as a registry-layer no-op. Registry-layer no-ops stay silent for Redis fanout races; router-layer double-add is a programmer bug and must fail fast in dev (assert behind `process.env.NODE_ENV !== 'production'` so we don't crash prod on a hot-path anomaly — instead log at `error`). |
| `server/routes/systemPnl.ts` | **Modify** — add `GET /api/admin/llm-pnl/in-flight?limit=500` snapshot endpoint. Hard cap 500, sorted `startedAt DESC`, `capped: boolean` flag. |
| `server/websocket/rooms.ts` | **Modify** — new handler `join:system-llm-inflight` that rejects non-system-admin sockets and joins the `system:llm-inflight` room. |
| `server/services/__tests__/llmInflightRegistryPure.test.ts` | **New** — pure tests: runtimeKey derivation, state-machine transitions (add→active, add-while-active = no-op, remove→removed, remove-while-removed = no-op, stale-startedAt event ignored), deadline calc, snapshot cap + sort. |
| `client/src/pages/SystemPnlPage.tsx` | **Modify** — new first tab **In-Flight**, renders live table from socket events + snapshot fetch. Local `eventId` LRU for dedup. Client-side 1–2s retry on ledger-row fetch when `ledgerCommittedAt == null`. |
| `client/src/components/system-pnl/PnlInFlightTable.tsx` | **New** — live table component. Client-local elapsed-time ticking (setInterval 1s, not socket spam). 100 ms socket-event buffer on mount / reconnect before merging with the snapshot (§5 consistency window). UI surfaces `deadlineBufferMs` so entries past `startedAt + timeoutMs` but before `deadlineAt` are visibly labelled "past timeout — sweep pending" rather than looking like a stuck happy-path call. |
| `shared/types/systemPnl.ts` | **Modify** — export `InFlightEntry`, `InFlightRemoval`, `EntryState`, the socket event envelope type. |
| `architecture.md` | **Modify** — add "LLM in-flight registry" subsection under the LLM router contract. |
| `docs/capabilities.md` | **Modify** — add bullet under "LLM Spend Observability": real-time in-flight tracker for system admins. |

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
