# LLM In-Flight Real-Time Tracker — Spec

**Status:** Draft — not yet reviewed.
**Author:** Main session.
**Date:** 2026-04-20.
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
12. Open questions for reviewer

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

- **Inline / synchronous** on the hot path: `llmRouter.routeCall()` emits `registryAdd(entry)` before dispatch and `registryRemove(id)` on terminal state (success / error / timeout / abort / parse-failure). No DB writes. No job rows.
- **Broadcast** via `server/services/llmInflightRegistry.ts` — maintains a per-process `Map<idempotencyKey, InFlightEntry>` + emits socket events to room `system:llm-inflight`.
- **Multi-instance**: when `REDIS_URL` is set (already the production default), the registry also publishes add/remove events on Redis channel `llm-inflight`. Each instance subscribes and merges remote events into its own map before rebroadcasting locally. Net result: a system admin connected to any instance sees every in-flight call across the fleet.
- **Stale-entry sweep**: every 60s a safety-net timer removes entries older than `PROVIDER_CALL_TIMEOUT_MS + 30_000` (currently 630s). Prevents orphaned entries if a process crashes between dispatch and ledger-write. Entries removed by the sweep are logged at `warn` level so we can detect a crash loop.

## 5. Contracts

### `InFlightEntry` (TypeScript + socket payload)

```ts
interface InFlightEntry {
  idempotencyKey: string;          // same key the ledger will use on completion
  startedAt: string;               // ISO 8601 UTC
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
  callSite: 'app' | 'worker';
  timeoutMs: number;               // the cap this call is running under (usually 600_000)
}
```

Producer: `llmRouter.routeCall()` via `llmInflightRegistry.add()`.
Consumer: (a) socket room `system:llm-inflight` event `llm-inflight:added`, (b) admin API `GET /api/admin/llm-pnl/in-flight` (snapshot endpoint for first paint).

### `InFlightRemoval` (socket payload on completion)

```ts
interface InFlightRemoval {
  idempotencyKey: string;
  terminalStatus: 'success' | 'error' | 'timeout' | 'aborted_by_caller'
                | 'client_disconnected' | 'parse_failure' | 'budget_blocked'
                | 'rate_limited' | 'provider_unavailable' | 'provider_not_configured'
                | 'partial';
  completedAt: string;             // ISO 8601 UTC
  durationMs: number;
  ledgerRowId: string | null;      // null when terminalStatus causes no ledger insert
}
```

Emitted on socket event `llm-inflight:removed`. Null `ledgerRowId` is possible for statuses that pre-empt the ledger write (e.g. `budget_blocked` before dispatch) — the UI treats those as "terminated, no billable row".

### Admin snapshot endpoint

`GET /api/admin/llm-pnl/in-flight` → `{ entries: InFlightEntry[], generatedAt: string }`. Used for first paint and for reconnect resync. Route gated by `authenticate + requireSystemAdmin` in the existing `server/routes/systemPnl.ts` router.

---

## 6. Files to change

| File | Change |
|---|---|
| `server/services/llmInflightRegistry.ts` | **New** — per-process `Map` + Redis pub/sub + socket broadcast. |
| `server/services/llmInflightRegistryPure.ts` | **New** — pure entry-shape builder + stale-sweep threshold calc (testable without Redis/socket). |
| `server/services/llmRouter.ts` | **Modify** — call `registry.add()` before dispatch; `registry.remove()` inside the finally block adjacent to the ledger write. |
| `server/routes/systemPnl.ts` | **Modify** — add `GET /api/admin/llm-pnl/in-flight` snapshot endpoint. |
| `server/websocket/rooms.ts` | **Modify** — new handler `join:system-llm-inflight` that rejects non-system-admin sockets and joins the `system:llm-inflight` room. |
| `server/services/__tests__/llmInflightRegistryPure.test.ts` | **New** — pure tests for entry builder + stale threshold. |
| `client/src/pages/SystemPnlPage.tsx` | **Modify** — new first tab **In-Flight**, renders live table from socket events + snapshot fetch. |
| `client/src/components/system-pnl/PnlInFlightTable.tsx` | **New** — live table component. |
| `shared/types/systemPnl.ts` | **Modify** — export `InFlightEntry` and `InFlightRemoval`. |
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

---

## 10. Testing posture

Per `docs/spec-context.md`:

- **Pure tests only**: `llmInflightRegistryPure.ts` — entry builder shape, stale-sweep threshold math, terminal-status classification (which statuses trigger `ledgerRowId: null`).
- **Static gates**: the existing `verify-no-direct-adapter-calls.sh` already guarantees the router is the only interception point — no new gate needed.
- **No frontend tests, no API contract tests, no E2E** — per `testing_posture: static_gates_primary` / `frontend_tests: none_for_now`.

Smoke-test posture for reviewer (manual, not a CI gate): run a long skill-analyzer job, open `/system/llm-pnl` → In-Flight tab, confirm row appears within 100ms of dispatch and disappears on completion with ledger row linked.

---

## 11. Self-consistency check

- Goals (§2) match implementation (§4–§6): in-memory registry, socket push, no ledger mutation — all three are wired consistently.
- Every "must" / "guarantees" has a named mechanism: (a) append-only ledger preserved (no writes from this spec), (b) cross-tenant attribution safe (socket room gated by `isSystemAdmin`), (c) no orphaned entries (stale-sweep at `timeoutMs + 30s`).
- Non-functional claims consistent with execution model: real-time push = socket, not polling; multi-instance consistency = Redis pub/sub, not DB reads.

---

## 12. Open questions for reviewer

1. Should the stale-sweep threshold be `PROVIDER_CALL_TIMEOUT_MS + 30s` (currently 630s), or should it be a dedicated env var? I've leaned on the timeout cap because any in-flight call that exceeds it is by definition bugged.
2. The snapshot endpoint returns all in-flight entries across the fleet. On a large deployment this could be thousands of rows — is a hard cap (e.g. 500 most-recent) worth adding pre-emptively, or deferred until we have evidence of the size?
3. Should the "In-Flight" tab become the default tab on the P&L page, or stay second to the current default? I've left current default in place, but argument for switching: the only reason to open the page urgently is to diagnose a stuck call.
