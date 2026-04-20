# LLM In-Flight Real-Time Tracker — Spec

**Status:** Draft — spec-review round 1 complete (2026-04-20). Ready for build.
**Author:** Main session.
**Date:** 2026-04-20.
**Last revised:** 2026-04-20 — 10-point reviewer pass folded in (§12); deferred items extended with partial-success protection + idempotency-key versioning (§9).
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

A single `idempotencyKey` can produce multiple concurrent in-flight entries when the retry-fallback loop re-attempts (same logical call, different attempt). The registry is therefore keyed by a `runtimeKey` — `${idempotencyKey}:${attempt}` where `attempt` is the same counter already tracked by `attemptNumber` in the ledger. `idempotencyKey` remains carried on the entry for UI grouping and for reconciliation against the eventual ledger row.

### 4.3 Entry state machine — monotonic, tolerant of reordered events

Each registry slot carries `state: 'active' | 'removed'` plus the original `startedAt`. The registry enforces monotonic transitions:

- `add()` — no-op if a slot for this `runtimeKey` already exists (local dispatch beat Redis fanout of its own event, or vice versa).
- `remove()` — no-op if the slot is already `'removed'`; otherwise `'active' → 'removed'`.
- Incoming Redis event — ignored if `incoming.startedAt < existing.startedAt` (late event for a stale runtimeKey we've already rotated through).

This eliminates the out-of-order flicker class from spec-review feedback item 1.

### 4.4 Broadcast + multi-instance fanout

`server/services/llmInflightRegistry.ts` maintains a per-process `Map<runtimeKey, { entry: InFlightEntry, state: EntryState }>` + emits socket events to room `system:llm-inflight`.

When `REDIS_URL` is set (production default), the registry publishes add/remove events on Redis channel `llm-inflight`. Each instance subscribes and merges remote events into its own map **through the same state-machine rules** before rebroadcasting locally. Net result: a system admin connected to any instance sees every in-flight call across the fleet.

**Event de-duplication on the wire.** Every socket payload carries `eventId = ${runtimeKey}:${type}` (`type ∈ { added, removed }`). Clients maintain a small LRU of seen `eventId`s (~256 entries) and drop duplicates, so a reconnect or a client bridged to two instances won't double-render.

### 4.5 Stale-entry sweep — deadline-based, not elapsed-based

Each entry records a `deadlineAt = startedAt + timeoutMs + 30_000` at add-time. Every 60s the sweep removes entries where `now > deadlineAt`, emitting `terminalStatus: 'swept_stale'` so the client can distinguish orphaned-by-crash from any other terminal state. Capturing the deadline at add-time makes the sweep robust to `PROVIDER_CALL_TIMEOUT_MS` changes mid-run and to small clock drift across instances. Sweep removals are logged at `warn` with the runtimeKey so a crash loop is detectable from logs alone.

## 5. Contracts

### `InFlightEntry` (TypeScript + socket payload)

```ts
interface InFlightEntry {
  runtimeKey: string;              // `${idempotencyKey}:${attempt}` — unique per attempt
  idempotencyKey: string;          // same key the ledger will use on completion
  attempt: number;                 // 1-indexed, matches ledger.attemptNumber
  startedAt: string;               // ISO 8601 UTC — monotonicity anchor for reorder-safety
  deadlineAt: string;              // ISO 8601 UTC — startedAt + timeoutMs + 30s sweep buffer
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

Producer: `llmRouter.routeCall()` via `llmInflightRegistry.add()`.
Consumer: (a) socket room `system:llm-inflight` event `llm-inflight:added`, (b) admin API `GET /api/admin/llm-pnl/in-flight` (snapshot endpoint for first paint).

### `InFlightRemoval` (socket payload on completion)

```ts
interface InFlightRemoval {
  runtimeKey: string;              // matches the InFlightEntry being removed
  idempotencyKey: string;          // for UI grouping across attempts
  attempt: number;
  terminalStatus: 'success' | 'error' | 'timeout' | 'aborted_by_caller'
                | 'client_disconnected' | 'parse_failure'
                | 'provider_unavailable' | 'provider_not_configured'
                | 'partial' | 'swept_stale';
  completedAt: string;             // ISO 8601 UTC
  durationMs: number;
  ledgerRowId: string | null;      // null when terminalStatus causes no ledger insert
  ledgerCommittedAt: string | null;// ISO 8601 — filled iff ledger insert/upsert succeeded
}
```

`terminalStatus` omits `budget_blocked` and `rate_limited` — those are pre-dispatch, so no registry entry ever existed to be removed. It adds `swept_stale` for entries the safety-net timer reaped.

`ledgerCommittedAt` addresses spec-review feedback item 7: the UI now has a positive signal that the ledger row is queryable. When `ledgerRowId != null && ledgerCommittedAt != null`, the row is readable. When `ledgerRowId != null && ledgerCommittedAt == null` (should be rare — the router usually awaits the insert before emitting), the client falls back to a 1–2 second retry loop before giving up.

### Socket event envelope — dedup on the wire

Every emitted socket event carries `eventId = ${runtimeKey}:${type}` where `type ∈ { added, removed }`. Clients de-duplicate by `eventId` via a small LRU (~256) so reconnect replay and multi-instance bridging can't double-render a row.

### Admin snapshot endpoint

`GET /api/admin/llm-pnl/in-flight?limit=500` → `{ entries: InFlightEntry[], generatedAt: string, capped: boolean }`.

- Hard cap: **500** entries (reviewer feedback item 5). `capped: true` when the live count exceeded the cap.
- Sort: `startedAt DESC` (newest first) — matches what admins actually want to see under fire.
- Used for first paint and for reconnect resync.
- Gated by `authenticate + requireSystemAdmin` in the existing `server/routes/systemPnl.ts` router.

`limit` is accepted as a query param (1–500) so an admin can intentionally narrow the snapshot during a reconnect storm; values above the hard cap are clamped silently.

---

## 6. Files to change

| File | Change |
|---|---|
| `server/services/llmInflightRegistry.ts` | **New** — per-process `Map<runtimeKey, { entry, state }>` + Redis pub/sub + socket broadcast. Enforces the §4.3 state machine at every add/remove/subscribe boundary. |
| `server/services/llmInflightRegistryPure.ts` | **New** — pure logic: entry-shape builder, `runtimeKey` derivation (`idempotencyKey:attempt`), `deadlineAt` calc, terminal-status → `ledgerRowId`-expected mapping, state-machine transition rules. Testable without Redis/socket. |
| `server/services/llmRouter.ts` | **Modify** — call `registry.add()` **inside the provider-retry loop, after budget reservation, immediately before `providerAdapter.call()`**; call `registry.remove()` in the `finally` block adjacent to the ledger write, with `ledgerCommittedAt` set to the post-insert timestamp. Pre-dispatch terminal paths (`budget_blocked`, `rate_limited`) must **not** add. |
| `server/routes/systemPnl.ts` | **Modify** — add `GET /api/admin/llm-pnl/in-flight?limit=500` snapshot endpoint. Hard cap 500, sorted `startedAt DESC`, `capped: boolean` flag. |
| `server/websocket/rooms.ts` | **Modify** — new handler `join:system-llm-inflight` that rejects non-system-admin sockets and joins the `system:llm-inflight` room. |
| `server/services/__tests__/llmInflightRegistryPure.test.ts` | **New** — pure tests: runtimeKey derivation, state-machine transitions (add→active, add-while-active = no-op, remove→removed, remove-while-removed = no-op, stale-startedAt event ignored), deadline calc, snapshot cap + sort. |
| `client/src/pages/SystemPnlPage.tsx` | **Modify** — new first tab **In-Flight**, renders live table from socket events + snapshot fetch. Local `eventId` LRU for dedup. Client-side 1–2s retry on ledger-row fetch when `ledgerCommittedAt == null`. |
| `client/src/components/system-pnl/PnlInFlightTable.tsx` | **New** — live table component. Client-local elapsed-time ticking (setInterval 1s, not socket spam). |
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
- **Partial-external-success protection — provisional in-flight ledger row.** Gap identified in the pre-merge review of the observability branch: `providerAdapter.call()` succeeds (provider has billed) → `db.insert(llmRequests)` fails (DB blip) → caller retries with the same `idempotencyKey` → success-row check misses → provider is called a second time under a new attempt → double-bill, with no trace in the ledger of the first success. Current mitigations: (a) pre-insert structured log captures `providerRequestId`, so an operator can reconcile manually; (b) this very tracker captures start+end in memory. The durable fix is a provisional `status='in_flight'` ledger row written **before** the provider call and upserted to the final status afterward — so retries see the in-flight row and refuse to re-dispatch. Deferred because (i) it requires rethinking the append-only invariant (status would transition `in_flight → terminal`), (ii) the current double-bill window is narrow (DB-insert failure is rare and bounded-cost), and (iii) this in-flight registry partially covers the forensic need. If we adopt it, the tracker's in-memory map becomes the cache in front of the provisional row rather than a parallel surface.
- **Idempotency-key versioning (`v1:` prefix).** Both `buildActionIdempotencyKey` (`server/services/actionService.ts`) and `llmRouter`'s `idempotencyKey` derivation are content-hashes of inputs. If the canonicalisation contract ever changes — new field added, nested-key sort tweaked, null-vs-absent policy adjusted — dedup silently breaks across the deploy boundary: old rows hash one way, new calls hash another, so a retry looks like a fresh call. A fixed `v1:` prefix (tracked via a constant + included in the hash input) makes this explicit: a version bump forces new keys and a deliberate migration decision rather than an invisible drift. Deferred because the current canonicalisation is pinned by `actionServiceCanonicalisationPure.test.ts` with known-good fixtures — any breaking change trips those tests. But the prefix is cheap future-proofing worth adopting before the first real canonicalisation change lands.

---

## 10. Testing posture

Per `docs/spec-context.md`:

- **Pure tests only** in `llmInflightRegistryPure.test.ts`:
  - `runtimeKey` derivation: `idempotencyKey:attempt` for `attempt ∈ {1, 2, 3, ...}`; collisions across `(key, attempt)` pairs never occur.
  - `deadlineAt` calc: `startedAt + timeoutMs + 30_000` — invariant across every `timeoutMs` value.
  - State-machine transitions: `add→active` (first call), `add-while-active` (no-op, no socket emission), `remove→removed`, `remove-while-removed` (no-op, no socket emission).
  - Stale-event filter: incoming event with `startedAt < existing.startedAt` is ignored (out-of-order Redis fanout).
  - Terminal-status → `ledgerRowId`-expected mapping: `success`/`error`/`timeout`/`aborted_by_caller`/`client_disconnected`/`parse_failure`/`provider_unavailable`/`provider_not_configured`/`partial` all expect a ledger row; `swept_stale` does not.
  - Snapshot cap + sort: capping at 500 preserves the newest-first window; `capped` flag set correctly when > 500 live.
  - `eventId` shape: `${runtimeKey}:${type}` — unique across (runtimeKey, type) pairs.
- **Static gates**: the existing `verify-no-direct-adapter-calls.sh` already guarantees the router is the only interception point — no new gate needed.
- **No frontend tests, no API contract tests, no E2E** — per `testing_posture: static_gates_primary` / `frontend_tests: none_for_now`.

Smoke-test posture for reviewer (manual, not a CI gate): run a long skill-analyzer job, open `/system/llm-pnl` → In-Flight tab, confirm row appears within 100ms of dispatch and disappears on completion with ledger row linked.

---

## 11. Self-consistency check

- Goals (§2) match implementation (§4–§6): in-memory registry, socket push, no ledger mutation — all three wired consistently.
- Every "must" / "guarantees" has a named mechanism:
  - Append-only ledger preserved → no writes from this spec (ledger is read-only from the registry's perspective).
  - Cross-tenant attribution safe → socket room gated by `isSystemAdmin` on the `join:system-llm-inflight` handler.
  - No orphaned entries → deadline-based sweep (`deadlineAt = startedAt + timeoutMs + 30s`) with distinct `swept_stale` terminal status for observability.
  - No flicker / false positives → post-dispatch-only `add()`, monotonic state machine, stale-event filter, eventId dedup on the client.
  - Concurrent retries don't collide → registry keyed by `runtimeKey = idempotencyKey:attempt`, not `idempotencyKey` alone.
  - UI reconciliation against the ledger → `ledgerCommittedAt` on removal events + a bounded client-side retry fallback.
  - Snapshot doesn't blow the wire → hard cap 500, sorted newest-first, `capped` flag for UI honesty.
- Non-functional claims consistent with execution model: real-time push = socket, not polling; multi-instance consistency = Redis pub/sub + state-machine-guarded merge, not DB reads.

---

## 12. Resolved during spec review (2026-04-20)

Reviewer ran a 10-point pass on the draft. Items incorporated directly into §4–§6, §10 above:

| # | Reviewer concern | Resolution |
|---|---|---|
| 1 | Exactly-once removal across instances | §4.3 state machine + §4.4 eventId dedup |
| 2 | Race: add before pre-dispatch failures | §4.1 — add fires post-budget, pre-adapter-call; pre-dispatch terminals never add |
| 3 | Idempotency key collision on concurrent retries | §4.2 runtimeKey = `${idempotencyKey}:${attempt}` |
| 4 | Naive stale sweep | §4.5 deadline-based sweep + distinct `swept_stale` terminal status |
| 5 | No snapshot cap / backpressure | §5 snapshot endpoint: hard 500 cap, sorted `startedAt DESC`, `capped` flag |
| 6 | Redis fanout duplication | §4.4 eventId dedup via client LRU |
| 7 | UI reconciliation gap vs ledger | §5 `ledgerCommittedAt` on `InFlightRemoval` + documented client fallback |
| 8 | Elapsed time field | No server change — §6 confirms client-local 1s tick, not socket spam |
| 9 | Queueing-delay visibility (`queuedAt`) | Deferred (§9) — high-value but not v1 |
| 10 | `callSite` enum too coarse | §5 documents as display-only; no logic branches on it |

### Original open questions — answered by reviewer

- **Stale-sweep threshold.** Use `deadlineAt = startedAt + timeoutMs + 30s` captured at add-time. No env var. Resolved in §4.5.
- **Snapshot cap.** Implement now: 500 rows, newest-first. Resolved in §5.
- **Default tab.** Keep current default — P&L is primarily financial; in-flight is diagnostic. Left unchanged in §6.
