# Home Dashboard Reactivity — Technical Specification

> **Source brief:** `tasks/builds/home-dashboard-reactivity/brief.md`
> **Branch:** `create-views`
> **Status:** Draft — pending `spec-reviewer`

---

## Table of contents

1. [Goal and scope](#1-goal-and-scope)
2. [Not in scope](#2-not-in-scope)
3. [Files to create / modify](#3-files-to-create--modify)
4. [Event-to-block mapping contract](#4-event-to-block-mapping-contract)
5. [Server emitter additions](#5-server-emitter-additions)
6. [Block versioning and ordering](#6-block-versioning-and-ordering)
7. [Consistency groups](#7-consistency-groups)
8. [Reconnect handling](#8-reconnect-handling)
9. [FreshnessIndicator component contract](#9-freshnessindicator-component-contract)
10. [QueueHealthSummary live-update](#10-queuehealthsummary-live-update)
11. [ClientPulseDashboardPage emitter gap](#11-clientpulsedashboardpage-emitter-gap)
12. [Layout reservation — Piece 3](#12-layout-reservation--piece-3)
13. [Test plan](#13-test-plan)
14. [Deferred items](#14-deferred-items)
15. [Pre-review checklist](#15-pre-review-checklist)

---

## 1. Goal and scope

**Goal.** Wire the home `DashboardPage` for event-driven, block-level live updates and ship a reusable `<FreshnessIndicator>` component, eliminating the reactivity inconsistency between the home page and the rest of the product.

**Design principle (reusable across Phase 2).**
> Every dashboard-style surface must reflect underlying system reactivity. If it can change, it must visibly change.

### 1.1 In-scope deliverables

| # | Deliverable |
|---|---|
| P1 | Block-level live updates on `DashboardPage` driven by WebSocket events |
| P1 | `<FreshnessIndicator>` component — placed below the home greeting |
| P1 | Server-side org-level emitters (new `dashboard.*` events to `org:${orgId}`) |
| P1 | `serverTimestamp` field on the four watched API endpoints (ordering support) |
| P1 | `QueueHealthSummary` live-update (system-admin-only block, identical behaviour) |
| P1 | Close `ClientPulseDashboardPage` emitter gap (`dashboard:update` event now emitted) |
| P1 | Layout slot reserved in `DashboardPage` for Piece 3 (empty, rendered as `null`) |

### 1.2 Success criteria (from brief)

- Operator leaves home page open; pending-approval count and recent activity update without a refresh.
- Freshness indicator visibly moves and pulses, communicating currency.
- No regression in initial load time — snapshot loads as fast as today.
- No visible inconsistency between related data blocks during updates (metric and list always agree).
- Side-by-side: home dashboard feels as alive as `ClientPulseDashboardPage`.

### 1.3 Implementation constraints (locked at brief level — non-negotiable)

1. Block-level refetch only. No full-dashboard reload on socket events.
2. Deterministic event → block mapping. Every event has a declared destination set; nothing is generic.
3. Consistency groups: blocks sharing underlying data refetch together in a single update transaction.
4. Latest-data-wins per block using server-provided `serverTimestamp` on API responses.
5. Idempotent updates — same event processed twice must not corrupt state.
6. No new state management library.
7. No global socket abstraction.
8. Pulse animation debounced ≥ 1.5 s.
9. System admins receive identical live-update behaviour.
10. Event coverage is declared, not implicit — every new dashboard-relevant server emitter must list its target blocks.

---

## 2. Not in scope

The following are explicitly excluded from this build. Proposing any of these during implementation is a scope violation.

| Out-of-scope item | Reason |
|---|---|
| Generalised "Views" framework / widget registry / layout engine | Page-specific composition is working |
| Client portal redesign | Phase 2 |
| System-admin dashboard build | Covered by existing pages + `QueueHealthSummary` |
| MCP server integration | Separate track |
| New state management library | Deliberately not in this codebase |
| Global event bus / global socket abstraction | Per-block subscription is the deliberate model |
| Piece 3 content (operational metrics blocks) | Deferred; layout slot only |
| Toast notifications on dashboard updates | Replaced by `<FreshnessIndicator>` pulse |
| Polling | Not polling — event-driven invalidation only |
| Performance baselines / load testing | Deferred until production |
| Frontend / API contract / E2E tests | `spec-context.md` posture: `none_for_now` |

---

## 3. Files to create / modify

### 3.1 New files

| File | Responsibility |
|---|---|
| `client/src/components/dashboard/FreshnessIndicator.tsx` | Reusable freshness indicator component (§9) |
| `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx` | Layout reservation for Piece 3 — renders `null`, documents the reserved slot |
| `client/src/components/dashboard/QueueHealthSummary.tsx` | Extracted from `DashboardPage.tsx` local scope; adds `refreshToken` prop for live-update (§10) |

### 3.2 Modified files — client

| File | What changes |
|---|---|
| `client/src/pages/DashboardPage.tsx` | Add socket subscriptions; block-level refetch logic; per-block version tracking; `<FreshnessIndicator>` integration; layout slot for Piece 3; `refreshToken` prop wiring to `<UnifiedActivityFeed>` |
| `client/src/components/UnifiedActivityFeed.tsx` | Add `refreshToken?: number` prop — when the value changes, the feed re-fetches. Also add `expectedTimestamp?: string` prop (§6.5) — when the feed's internal fetch returns a `serverTimestamp` older than `expectedTimestamp`, the response is discarded so the feed and the stats card stay version-aligned within the Activity group. |

### 3.3 Modified files — server

| File | What changes |
|---|---|
| `server/routes/reviewItems.ts` | Add `emitOrgUpdate` call alongside existing `emitSubaccountUpdate` after approval/rejection (§5.1) |
| `server/services/agentRunFinalizationService.ts` | Add `emitOrgUpdate` call after agent run completes (§5.2) |
| `server/services/workflowEngineService.ts` | Add `emitOrgUpdate` call on workflow run status events (§5.3) |
| `server/routes/clientpulse.ts` _(or whichever route mutates health state)_ | Add `emitOrgUpdate` for `dashboard.client.health.changed` + existing `dashboard:update` wire-up (§5.4 + §11) |
| `server/routes/pulse.ts` | Add `serverTimestamp` to `/api/pulse/attention` response (§6.1) |
| `server/routes/agentActivity.ts` | Add `serverTimestamp` to `/api/agent-activity/stats` response (§6.1) |
| `server/routes/clientpulse.ts` | Add `serverTimestamp` to `/api/clientpulse/health-summary` response (§6.1) |
| `server/routes/activity.ts` | Add `serverTimestamp` to `/api/activity` response (§6.1) |
| `server/routes/system.ts` | Add `serverTimestamp` to `/api/system/job-queues` response (§6.1) |

> **File inventory rule:** Any implementation-time discovery of an additional file that must change must be added to this table before the PR is opened. Missing entry = `file-inventory-drift` finding in review.

### 3.4 Existing primitives reused (no changes)

| Primitive | Used for |
|---|---|
| `client/src/hooks/useSocket.ts` — `useSocket(event, callback)` | Subscribing to org-level dashboard events (org room is auto-joined on connect) |
| `client/src/hooks/useSocket.ts` — `useSocketRoom(roomType, roomId, events, onReconnectSync?)` | Joining the `system:sysadmin` room for `dashboard.queue.changed` (§10.2) — null `roomId` is the non-sysadmin gate |
| `client/src/hooks/useSocket.ts` — `useSocketConnected()` | Detecting WebSocket reconnect |
| `server/websocket/emitters.ts` — `emitOrgUpdate(orgId, event, data)` | Emitting dashboard events to `org:${orgId}` room |
| `server/websocket/emitters.ts` — `emitToSysadmin(event, entityId, data)` | Emitting queue events to `system:sysadmin` room |

No new emitter helpers. No new socket rooms. No new hooks beyond the component-level changes above.

---

## 4. Event-to-block mapping contract

This table is the **exhaustive, authoritative contract** for which socket events update which blocks. Anything not in this table does not trigger a refetch. Adding a new entry requires updating this table and the corresponding server emitter in §5.

### 4.1 Wire-level event names (normalization decision)

The brief flagged that existing emitters use inconsistent naming conventions. This spec introduces a set of **new org-level events** in `domain.entity.action` format. Existing subaccount-level events (`review:item_updated`, `live:agent_completed`, `Workflow:run:status`) are **not renamed** — they are used by other subscribers and are out of scope. The home dashboard subscribes only to the new `dashboard.*` events on the `org:${orgId}` room (auto-joined on connect for every authenticated socket).

### 4.2 Event-to-block mapping table

| Wire event | Room | Emitter origin | Consistency group | Blocks that refetch | Refetch endpoints |
|---|---|---|---|---|---|
| `dashboard.approval.changed` | `org:${orgId}` | `reviewItems.ts` (after approve/reject) | Approvals | `MetricCard(Pending Approval)` + `PendingApprovalCard` list | `GET /api/pulse/attention` |
| `dashboard.activity.updated` | `org:${orgId}` | `agentRunFinalizationService.ts` (run completed) + `workflowEngineService.ts` (terminal status) | Activity | `UnifiedActivityFeed` + `MetricCard(Runs 7d)` | `GET /api/activity` + `GET /api/agent-activity/stats` |
| `dashboard.client.health.changed` | `org:${orgId}` | ClientPulse health recalculation path (§5.4) | Client-health | `MetricCard(Clients Needing Attention)` + `WorkspaceFeatureCard(ClientPulse)` | `GET /api/clientpulse/health-summary` |
| `dashboard.queue.changed` | `system:sysadmin` | Job queue mutation path (§5.5) | Queue-health | `QueueHealthSummary` | `GET /api/system/job-queues` |

> **Pre-merge coverage check:** Before the PR is opened, run `grep -r "emitOrgUpdate.*'dashboard\." server/` and verify every matching call appears in the table above. Any call not in this table is a `file-inventory-drift` finding in review.

> **Event ordering guarantee — none assumed.** No ordering guarantee is assumed across events. Two events emitted close together (e.g. `dashboard.approval.changed` followed immediately by `dashboard.activity.updated`) may arrive at the client in any order. The `serverTimestamp`-based `applyIfNewer` guard (§6.2) handles any ordering correctly — stale arrivals are silently discarded.

> **`EVENT_TO_GROUP` constant in `DashboardPage`:** To prevent drift between this table and the implementation, `DashboardPage.tsx` defines a local `EVENT_TO_GROUP` constant mapping each wire event to its refetch function:
> ```typescript
> const EVENT_TO_GROUP = {
>   'dashboard.approval.changed': refetchApprovals,
>   'dashboard.activity.updated': refetchActivity,
>   'dashboard.client.health.changed': refetchClientHealth,
>   'dashboard.queue.changed': refetchQueue, // system admin only
> } as const;
> ```
> This is not a framework — it is a single-file guardrail so any new entry in the table above forces a corresponding entry in `EVENT_TO_GROUP` (and vice versa). The `useSocket` subscriptions iterate this constant to register handlers.

### 4.3 Event payload contracts

All events emitted through the existing `emitOrgUpdate` / `emitToSysadmin` helpers are automatically wrapped in the standard envelope:

```typescript
// Envelope shape (emitters.ts — produced automatically, do not reproduce manually)
interface EventEnvelope {
  eventId: string;    // UUID, used for client-side dedup (useSocket LRU)
  type: string;       // = wire event name
  entityId: string;   // meaningful entity for the event (see per-event below)
  timestamp: string;  // ISO-8601, server time
  payload: Record<string, unknown>;
}
```

**`dashboard.approval.changed`**

```typescript
// entityId = orgId
// payload:
{
  action: 'approved' | 'rejected' | 'new';
  subaccountId: string | null;
}
```

**`dashboard.activity.updated`**

```typescript
// entityId = orgId
// payload (agent run):
{
  source: 'agent_run';
  runId: string;
  finalStatus: string;
}
// payload (workflow run):
{
  source: 'workflow_run';
  runId: string;
  status: string;
}
```

**`dashboard.client.health.changed`**

```typescript
// entityId = orgId
// payload:
{
  totalClients: number;
  healthy: number;
  attention: number;
  atRisk: number;
}
```

> The dashboard does not consume the payload for data — it uses the event only as an **invalidation signal** that triggers a refetch. Payload fields above are informational and may be used for future optimistic updates; the source of truth is always the refetch response.
>
> **Payload-not-trusted rule (global):** This principle applies to every dashboard block in this spec. No block uses event payload fields to update its displayed state. The payload is informational only and may be used for future optimistic updates. The API response is always the source of truth.
>
> **No optimistic UI:** No dashboard block performs optimistic updates. All displayed state is derived exclusively from refetch responses. Payload data is never written to component state.

**`dashboard.queue.changed`**

```typescript
// entityId = 'system'
// payload:
{
  pendingDelta: number;   // signed int, informational only
}
```

### 4.4 Idempotency posture (per constraint §1.3-5)

- Each `useSocket` subscription is wrapped by the existing `useSocket` dedup mechanism (LRU set of `eventId`, max 500). Re-delivery of the same `eventId` is silently dropped before the callback fires.
- The callback itself calls a refetch function. Multiple refetch triggers for the same group while a refetch is in flight are coalesced by the per-group inflight + pending refs (§6.3): the in-flight fetch resolves, then a single trailing refetch fires if any triggers arrived during the in-flight window.
- These two layers together ensure same-event-twice produces at most one in-flight refetch plus one trailing refetch — never an unbounded queue, never a silent drop of the freshest server state.

> **`eventId` uniqueness scope:** The `eventId` dedup LRU (max 500) assumes IDs are globally unique across rooms and event types — not per-room or per-event-type. UUID v4 generation by the emitter (`buildEnvelope` calls `crypto.randomUUID()`) satisfies this assumption.

---

## 5. Server emitter additions

All new emits use the existing `emitOrgUpdate` and `emitToSysadmin` helpers from `server/websocket/emitters.ts`. No new helper functions are introduced.

> **Signature note:** Confirmed against `server/websocket/emitters.ts`:
> - `emitOrgUpdate(orgId: string, event: string, data: Record<string, unknown>)` — 3 args. The wrapper internally calls `emitToRoom('org:${orgId}', event, orgId, data)`, so `entityId` is always `orgId` for org-scoped emits and is set automatically.
> - `emitToSysadmin(event: string, entityId: string, data: Record<string, unknown>)` — 3 args. `entityId` is the meaningful resource the event refers to (e.g. `'system'` for queue-wide events).
>
> Code examples below use these exact signatures. The `entityId` for `emitOrgUpdate` is implicit (the wrapper supplies `orgId`); the `payload` `data` object carries any per-event identifiers (`subaccountId`, `runId`, etc.).

### 5.1 `dashboard.approval.changed` — `server/routes/reviewItems.ts`

**Trigger:** After a successful approve or reject on a review item.

**Existing code** (lines ~176 and ~224):
```typescript
if (subaccountId) emitSubaccountUpdate(subaccountId, 'review:item_updated', { action: 'approved' });
```

**Add alongside** (do not replace — the subaccount emit must stay for existing subscribers):
```typescript
emitOrgUpdate(orgId, 'dashboard.approval.changed', {
  action: 'approved', // or 'rejected'
  subaccountId: subaccountId ?? null,
});
```

`orgId` is available from the authenticated session (`req.session.orgId` or equivalent). Confirm the variable name at implementation time — it is already used elsewhere in this route.

**`action: 'new'`** path: if a new review item is created (e.g. an agent submits a new approval request), also emit `dashboard.approval.changed` with `action: 'new'` at that creation point. Implementation must locate the item-creation path in this route (or the relevant service) and add the emit. This is in scope.

### 5.2 `dashboard.activity.updated` — `server/services/agentRunFinalizationService.ts`

**Trigger:** When a run reaches a terminal state (success, failed, cancelled).

**Existing code** (line ~375):
```typescript
emitAgentRunUpdate(ieeRun.agentRunId, 'agent:run:completed', {
  ieeRunId: ieeRun.id,
  finalStatus: resolvedStatus,
  failureReason: ieeRun.failureReason ?? null,
});
```

**Add alongside** (only for non-sub-agent runs — guard: `!parentIsSubAgent`):
```typescript
if (!parentIsSubAgent) {
  emitOrgUpdate(orgId, 'dashboard.activity.updated', {
    source: 'agent_run',
    runId: ieeRun.agentRunId,
    finalStatus: resolvedStatus,
  });
}
```

Sub-agent runs (internal orchestration) do not represent user-visible activity on the home dashboard and must not trigger a feed refresh.

> **`parentIsSubAgent` definition:** This boolean is derived from the existing sub-agent detection logic already present in `agentRunFinalizationService.ts`. Confirm the exact field or method used at implementation time — do not recompute it independently. The same check that governs whether a run's results roll up to a parent agent is the correct gate for this emit.

`orgId` is resolvable from `parentAgentId` or `ieeRun` — confirm the lookup at implementation time using the same pattern as the existing subaccount lookup in this function.

### 5.3 `dashboard.activity.updated` — `server/services/workflowEngineService.ts`

**Trigger:** When a workflow run reaches a terminal state (`completed`, `failed`, `cancelled`). Do **not** emit on intermediate states (`running`, `step_completed`) — these are not meaningful for the activity feed refresh.

**Existing emit** (lines ~763 and ~875):
```typescript
await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', { status: finalStatus, ... });
```

**Add after the terminal-status emit** (check `finalStatus` is in `['completed', 'failed', 'cancelled']`):
```typescript
if (['completed', 'failed', 'cancelled'].includes(finalStatus)) {
  emitOrgUpdate(run.orgId, 'dashboard.activity.updated', {
    source: 'workflow_run',
    runId,
    status: finalStatus,
  });
}
```

`run.orgId` — confirm field name at implementation time; the run record is already loaded in this function.

### 5.4 `dashboard.client.health.changed` — ClientPulse health recalculation path

**Trigger:** Whenever the aggregate health summary for an org changes. The exact trigger location must be confirmed during implementation — expected candidates are:
- The route or service that saves/updates a ClientPulse report
- The scheduled job that recalculates health scores

**Implementation note:** Grep for `clientpulse/health-summary` route handler and trace backwards to the mutation path. The emit goes in the mutation path, not the read path.

**Emit:**
```typescript
emitOrgUpdate(orgId, 'dashboard.client.health.changed', {
  totalClients,
  healthy,
  attention,
  atRisk,
});
```

Values come from the recalculated summary — use the same values being persisted, not a secondary re-read.

### 5.5 `dashboard.queue.changed` — system job queue mutation path

**Trigger:** When job queue depth changes materially (new jobs enqueued, jobs completed, DLQ entries added).

**Emit via sysadmin room:**
```typescript
emitToSysadmin('dashboard.queue.changed', 'system', { pendingDelta });
```

**Scope limitation:** This emit is best-effort — it is acceptable for the `QueueHealthSummary` to occasionally show briefly stale data if the queue mutation path is not easily instrumented. Maximum staleness is bounded by the next reconnect refetch cycle (§8), which re-fetches all groups including queue health. If the queue mutation path is not straightforward to identify within the time budget, this emitter may be deferred to a follow-up; document this as a known gap if so.

---

## 6. Block versioning and ordering

### 6.1 `serverTimestamp` on API responses

To support latest-data-wins ordering (brief §5, constraint 4), each watched endpoint wraps its response in a `serverTimestamp` envelope:

**Shape:**
```typescript
// All four watched endpoints return this wrapper
interface TimestampedResponse<T> {
  data: T;
  serverTimestamp: string; // ISO-8601, set by the server at response time: new Date().toISOString()
}
```

> **UTC invariant:** All `serverTimestamp` values are UTC ISO-8601 strings. `new Date().toISOString()` always produces UTC (the trailing `Z`). Client-side `Date` comparisons in `applyIfNewer` rely on lexicographic ordering of the UTC string — no timezone conversion is applied, and none is required.

> **Generation invariant:** `serverTimestamp` MUST be generated after all data reads for the response have completed and immediately before response serialization begins. Generating it before the query (e.g. at route entry, or as middleware) is incorrect — it would produce timestamps that precede the data they version, breaking ordering guarantees under load. The correct pattern: complete the data fetch, then construct the response with `serverTimestamp: new Date().toISOString()` as the final step.

**Endpoints to modify** (server route handlers):

| Endpoint | Current response shape | New response shape |
|---|---|---|
| `GET /api/pulse/attention` | `{ lanes: [...], total: number }` | `{ data: { lanes: [...], total: number }, serverTimestamp: string }` |
| `GET /api/agent-activity/stats` | `{ count: number, ... }` | `{ data: { count: number, ... }, serverTimestamp: string }` |
| `GET /api/clientpulse/health-summary` | `{ totalClients: number, healthy: number, ... }` | `{ data: { totalClients: number, ... }, serverTimestamp: string }` |
| `GET /api/activity` | `ActivityItem[]` | `{ data: ActivityItem[], serverTimestamp: string }` |
| `GET /api/system/job-queues` | `Array<{ pending, dlqDepth, failed }>` | `{ data: Array<{ pending, dlqDepth, failed }>, serverTimestamp: string }` |

> **Breaking change notice — explicit constraints:** All five endpoints change their response envelope. The following constraints are mandatory:
>
> (a) **All consumers updated in the same PR.** Every consumer of each modified endpoint MUST be located via grep and updated in this PR. No follow-up PR is acceptable.
>
> (b) **Grep commands** to enumerate consumers — run each and update every match:
> ```bash
> grep -rn "/api/activity" client/src server/ --include="*.ts" --include="*.tsx"
> grep -rn "/api/pulse/attention" client/src server/ --include="*.ts" --include="*.tsx"
> grep -rn "/api/agent-activity/stats" client/src server/ --include="*.ts" --include="*.tsx"
> grep -rn "/api/clientpulse/health-summary" client/src server/ --include="*.ts" --include="*.tsx"
> grep -rn "/api/system/job-queues" client/src server/ --include="*.ts" --include="*.tsx"
> ```
>
> (c) **No dual-format fallback.** The old envelope shape MUST NOT be supported alongside the new one. A consumer that previously read `res.lanes` now reads `res.data.lanes`, and the old path is removed — not branched on.
>
> (d) **No partial rollout.** All five endpoints ship in the same PR. Splitting the envelope rollout across multiple PRs creates a window where some consumers see the new shape and others see the old, defeating the ordering guarantee.

### 6.2 Per-block version tracking in DashboardPage

`DashboardPage` maintains a `latestTimestamp` ref per consistency group (not per block, since blocks in a group always fetch together):

```typescript
// One ref per consistency group
const approvalsTs = useRef<string>('');
const activityTs = useRef<string>('');
const clientHealthTs = useRef<string>('');
const queueTs = useRef<string>(''); // system admin only
```

On every successful refetch, the version is checked before applying:

```typescript
function applyIfNewer(
  currentTs: React.MutableRefObject<string>,
  incomingTs: string,
  apply: () => void
): void {
  if (incomingTs > currentTs.current) {
    currentTs.current = incomingTs;
    apply();
  }
  // else: discard stale response silently
}
```

ISO-8601 string comparison is lexicographically monotonic and correct for this purpose (no library needed).

> **Equal timestamp behaviour:** Strict `>` is intentional — equal timestamps are treated as non-newer and the callback is not invoked. Two responses with the same `serverTimestamp` represent equivalent snapshots; applying the second would cause a redundant re-render without changing state. Do not change this to `>=`.

**Source-of-truth precedence:** The `serverTimestamp` from the API response is the sole version discriminator. Local state (`useState` values), socket event timestamps, and client-generated timestamps are never used as version comparators.

### 6.3 In-flight guard (coalescing for rapid events)

Each consistency group tracks whether a refetch is currently in flight, and whether another refetch was requested while in flight:

```typescript
const approvalsInflight = useRef(false);
const approvalsPending = useRef(false);
const activityInflight = useRef(false);
const activityPending = useRef(false);
const clientHealthInflight = useRef(false);
const clientHealthPending = useRef(false);
const queueInflight = useRef(false); // system admin only
const queuePending = useRef(false);
```

Refetch function pattern (same shape for all groups) — coalesce, do not drop:

```typescript
async function refetchApprovals() {
  if (approvalsInflight.current) {
    // Another refetch already running — coalesce: mark pending, let the
    // current fetch resolve, then fire one more refetch in `finally`.
    approvalsPending.current = true;
    return;
  }
  approvalsInflight.current = true;
  try {
    const res = await api.get<TimestampedResponse<AttentionData>>('/api/pulse/attention');
    applyIfNewer(approvalsTs, res.data.serverTimestamp, () => {
      setAttention(res.data.data);
    });
  } finally {
    approvalsInflight.current = false;
    if (approvalsPending.current) {
      approvalsPending.current = false;
      // Fire one trailing refetch to capture any state change that arrived
      // while the previous fetch was in flight.
      refetchApprovals();
    }
  }
}
```

This ensures that rapid-fire events (multiple approvals in quick succession) result in at most **one in-flight refetch plus one trailing refetch** — never an unbounded queue, never a silent drop. The trailing refetch closes the reconnect-window race where a state change occurs after the in-flight fetch's snapshot but before the next user-driven event.

> **Why coalesce instead of drop:** A pure drop-if-in-flight strategy can lose the freshest server state when an event arrives in the narrow window between the in-flight fetch's read and its response. Coalescing guarantees that every event triggers at least one refetch that began *after* the event was emitted, which is the correctness condition the freshness guarantee depends on.

### 6.4 Failure posture (refetch errors)

If a refetch throws (network error, 5xx, parsing failure) or returns a non-2xx response, the group's `applyIfNewer` callback MUST NOT be called. The `lastUpdatedAt` timestamp MUST NOT be updated. This prevents the "stuck but looks fresh" failure mode where the indicator pulses to "updated just now" while the underlying data has not in fact updated.

Pattern (applies to every `refetch*()` function):

```typescript
async function refetchApprovals() {
  if (approvalsInflight.current) {
    approvalsPending.current = true;
    return;
  }
  approvalsInflight.current = true;
  try {
    const res = await api.get<TimestampedResponse<AttentionData>>('/api/pulse/attention');
    // Only on success — applyIfNewer + freshness update happen inside the callback
    applyIfNewer(approvalsTs, res.data.serverTimestamp, () => {
      setAttention(res.data.data);
      markFresh(new Date()); // see §7.4 — only fires on successful refetch
    });
  } catch (err) {
    // Failure: do NOT update applyIfNewer state, do NOT update lastUpdatedAt.
    // Freshness indicator will continue to age, signalling staleness to the operator.
    console.error('[DashboardPage] refetchApprovals failed:', err);
  } finally {
    approvalsInflight.current = false;
    if (approvalsPending.current) {
      approvalsPending.current = false;
      refetchApprovals();
    }
  }
}
```

The `console.error` is the minimum failure-visibility floor; no toast, no banner — the aging `<FreshnessIndicator>` is the operator-facing staleness signal.

### 6.5 Activity feed dedup rule

`UnifiedActivityFeed` is append-only. When triggered by `dashboard.activity.updated`, it refetches `/api/activity` and receives the latest N items. The feed must not produce duplicate rows or reorder existing rows.

**Mechanism:** The feed component maintains its internal item list by ID. On refetch:
1. New items (IDs not currently in the list) are prepended.
2. Updated items (same ID, newer `updatedAt`) replace the existing row in-place.
3. Items already in the list with equal or older `updatedAt` are discarded.

**`refreshToken` prop:** `DashboardPage` increments a `refreshToken` counter on `dashboard.activity.updated` events. `UnifiedActivityFeed` adds a `refreshToken?: number` prop; a `useEffect` with `refreshToken` as a dependency triggers the internal refetch. This avoids exposing a ref-based imperative `refresh()` handle.

**`expectedTimestamp` prop (Activity group atomicity):** `UnifiedActivityFeed` also accepts an optional `expectedTimestamp?: string` prop. When provided and the feed's internal fetch returns a `serverTimestamp < expectedTimestamp`, the feed discards the response (does not update its rendered rows). This pins the feed and the stats `MetricCard(Runs 7d)` to the same activity-group version: both refresh to a state at least as fresh as the group's `activityTs`, or neither does.

```typescript
// In DashboardPage
const [activityRefreshToken, setActivityRefreshToken] = useState(0);

// In refetchActivity (§7.2): pass activityTs.current as expectedTimestamp so the
// feed's internal fetch is gated on the same version the group just established.
<UnifiedActivityFeed
  orgId={orgId}
  limit={20}
  refreshToken={activityRefreshToken}
  expectedTimestamp={activityTs.current}
/>
```

---

## 7. Consistency groups

Blocks that derive from the same underlying data must update together or not at all. Partial application is a bug, not an optimisation (brief §5 constraint 3).

### 7.1 Group definitions

| Group | Members | Single endpoint | Trigger event |
|---|---|---|---|
| **Approvals** | `MetricCard(Pending Approval)` + `PendingApprovalCard` list | `GET /api/pulse/attention` | `dashboard.approval.changed` |
| **Activity** | `UnifiedActivityFeed` + `MetricCard(Runs 7d)` | `GET /api/activity` + `GET /api/agent-activity/stats` | `dashboard.activity.updated` |
| **Client-health** | `MetricCard(Clients Needing Attention)` + `WorkspaceFeatureCard(ClientPulse)` summary text | `GET /api/clientpulse/health-summary` | `dashboard.client.health.changed` |
| **Queue-health** | `QueueHealthSummary` | `GET /api/system/job-queues` | `dashboard.queue.changed` |

### 7.2 "Together or not at all" mechanism

Each group shares a single `refetch*()` function. Both (or all) state setters within a group are called **synchronously within the same `applyIfNewer` callback** before React has a chance to re-render:

```typescript
// Approvals group example — see §6.3 for the full coalescing pattern + §6.4 for failure handling
async function refetchApprovals() {
  if (approvalsInflight.current) {
    approvalsPending.current = true;
    return;
  }
  approvalsInflight.current = true;
  try {
    const res = await api.get<TimestampedResponse<AttentionData>>('/api/pulse/attention');
    applyIfNewer(approvalsTs, res.data.serverTimestamp, () => {
      // Both setters called synchronously — React batches these into one render
      setAttention(res.data.data);
      // MetricCard value is derived from attention.total directly — no separate setter needed
    });
  } catch (err) {
    console.error('[DashboardPage] refetchApprovals failed:', err);
  } finally {
    approvalsInflight.current = false;
    if (approvalsPending.current) {
      approvalsPending.current = false;
      refetchApprovals();
    }
  }
}
```

For the Activity group, two separate endpoints feed two blocks. Both fetches are issued in parallel; the group is applied only when **both** responses arrive, using `Promise.all`. The coalescing pattern from §6.3 applies — a refetch arriving while one is in flight sets `activityPending.current = true` and is fired from `finally`:

```typescript
async function refetchActivity() {
  if (activityInflight.current) {
    activityPending.current = true;
    return;
  }
  activityInflight.current = true;
  try {
    const [feedRes, statsRes] = await Promise.all([
      api.get<TimestampedResponse<ActivityItem[]>>('/api/activity'),
      api.get<TimestampedResponse<ActivityStats>>('/api/agent-activity/stats'),
    ]);
    // Use the OLDER of the two timestamps as the group version. min(), not max():
    // both datasets must be at least this fresh before applying. Picking max would
    // let a stale dataset slip in alongside a newer one, breaking group atomicity.
    const groupTs = feedRes.data.serverTimestamp < statsRes.data.serverTimestamp
      ? feedRes.data.serverTimestamp
      : statsRes.data.serverTimestamp;
    applyIfNewer(activityTs, groupTs, () => {
      setActivityStats(statsRes.data.data);
      setActivityRefreshToken(t => t + 1); // signals UnifiedActivityFeed to re-fetch internally
      // The feed receives `expectedTimestamp={activityTs.current}` (now updated to
      // groupTs) and will discard any internal fetch result older than that — see §6.5.
    });
  } catch (err) {
    console.error('[DashboardPage] refetchActivity failed:', err);
  } finally {
    activityInflight.current = false;
    if (activityPending.current) {
      activityPending.current = false;
      refetchActivity();
    }
  }
}
```

> **Activity group atomicity:** The stats card and the feed are version-aligned via the `expectedTimestamp` prop (§6.5). When `refetchActivity` updates `activityTs` to `groupTs`, the feed's next internal fetch must return `serverTimestamp ≥ groupTs` or the result is discarded. This guarantees the user never sees the stats card and the feed reflecting different points in time within the Activity group.

> **Dual-fetch failure behaviour:** `Promise.all` rejects if either `/api/activity` or `/api/agent-activity/stats` fails. The `catch` block handles this — neither `applyIfNewer` nor `markFresh` is called. No partial update is applied. This is the correct failure mode: the Activity group is either fully updated or not updated at all. Do not "optimise" this into individual try/catches with partial applies — that would break group atomicity.

### 7.3 `WorkspaceFeatureCard(ClientPulse)` update

`WorkspaceFeatureCard` accepts a `summary` prop of type `React.ReactNode`. In `DashboardPage`, the summary is computed from the health state:

```typescript
// Existing pattern (no change to WorkspaceFeatureCard component):
<WorkspaceFeatureCard
  title="ClientPulse"
  href="/clientpulse"
  summary={health ? `${health.attention + health.atRisk} client(s) need attention` : '—'}
/>
```

When `refetchClientHealth()` calls `setHealth(newData)`, React re-renders `DashboardPage` with the updated `summary` prop. No changes to `WorkspaceFeatureCard` are needed.

### 7.4 FreshnessIndicator integration with groups

Every successful group refetch (any consistency group, including reconnect refetch) updates the `<FreshnessIndicator>` via a `markFresh(ts: Date)` helper. This call is added inside each `applyIfNewer` callback so freshness updates only fire on successful, non-stale responses (per §6.4):

```typescript
applyIfNewer(approvalsTs, res.data.serverTimestamp, () => {
  setAttention(res.data.data);
  markFresh(new Date()); // freshness indicator update
});
```

> **Batched freshness updates:** When two or more groups update simultaneously (e.g. on reconnect, when `refetchAll()` triggers all four groups in parallel), naive `setLastUpdatedAt(new Date())` calls trigger redundant renders and may flicker the pulse animation. To prevent this, freshness updates flow through a `useCallback`-stable `markFresh(ts)` helper that only calls `setLastUpdatedAt(ts)` if `ts > lastUpdatedAtRef.current`:
>
> ```typescript
> const lastUpdatedAtRef = useRef<Date>(new Date());
> const markFresh = useCallback((ts: Date) => {
>   if (ts > lastUpdatedAtRef.current) {
>     lastUpdatedAtRef.current = ts;
>     setLastUpdatedAt(ts);
>   }
> }, []);
> ```
>
> Within `refetchAll()` and any per-tick batch (multiple `applyIfNewer` callbacks resolving in the same React render cycle), capture `const now = new Date()` once before invoking the group refetches and pass that single `Date` value through to `markFresh(now)` — this guarantees one `setLastUpdatedAt` call per batch, not one per group.

---

## 8. Reconnect handling

### 8.1 Requirement (from brief §6)

When the WebSocket disconnects and reconnects:
1. Refetch all blocks once — block-level (per the granularity rule), not a full-page reload.
2. Suppress duplicate refetches if reconnect fires multiple times within a short window.
3. Reset `<FreshnessIndicator>` to "updated just now" state on successful reconnect refetch.

### 8.2 Implementation

`useSocketConnected()` (already exported from `useSocket.ts`) returns `true` when connected, `false` when disconnected. Track the previous state to detect the connected→disconnected→connected transition:

```typescript
const connected = useSocketConnected();
const prevConnected = useRef<boolean | null>(null);
const reconnectDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  const wasConnected = prevConnected.current;
  prevConnected.current = connected;

  // Only act on false→true transition (reconnect), not the initial mount
  if (wasConnected === false && connected === true) {
    // Debounce: suppress rapid reconnect cycles (e.g. brief network blip + immediate recovery)
    if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
    reconnectDebounce.current = setTimeout(() => {
      refetchAll();
    }, RECONNECT_DEBOUNCE_MS);
  }
}, [connected]);
```

**`RECONNECT_DEBOUNCE_MS = 500`** — suppress duplicate reconnect refetches within a 500 ms window. Value is a named constant at the top of the file.

**`refetchAll()`** calls all group refetch functions:
```typescript
function refetchAll() {
  refetchApprovals();
  refetchActivity();
  refetchClientHealth();
  if (isSystemAdmin) refetchQueue();
}
```

Since each `refetch*` function has its own in-flight guard, calling them all simultaneously is safe — they execute in parallel as independent HTTP calls. If a reconnect-triggered refetch arrives while a previous refetch is already in-flight for that group, the coalescing logic in §6.3 guarantees a trailing refetch executes after the in-flight one resolves — no reconnect state is lost even under rapid network instability.

### 8.3 Initial mount

`prevConnected.current` starts as `null`. The first render sets it to the current connection state without triggering a reconnect refetch. The normal mount `useEffect` handles initial data load (unchanged from current `DashboardPage` behaviour).

### 8.4 FreshnessIndicator on reconnect

After `refetchAll()` completes each successful sub-refetch, the group's `applyIfNewer` callback calls `markFresh(new Date())` (see §7.4). The freshness indicator therefore updates to "updated just now" as soon as any group refetch succeeds — no special reconnect code needed in the indicator. The `markFresh` dedup ensures a single `setLastUpdatedAt` call when multiple group refetches resolve in the same render cycle.

---

## 9. FreshnessIndicator component contract

### 9.1 API

```typescript
// client/src/components/dashboard/FreshnessIndicator.tsx
interface FreshnessIndicatorProps {
  lastUpdatedAt: Date;
}

export function FreshnessIndicator({ lastUpdatedAt }: FreshnessIndicatorProps): JSX.Element
```

Single prop. The component owns:
- "X ago" timestamp formatting and live-tick increment.
- The debounced pulse animation on prop change.

The parent (`DashboardPage`) owns `lastUpdatedAt` state and passes it in on every successful block refetch.

### 9.2 Timestamp formatting

| Time since update | Display |
|---|---|
| < 10 s | "updated just now" |
| 10 s – 60 s | "updated Xs ago" |
| 1 min – 60 min | "updated Xm ago" |
| > 60 min | "updated Xh ago" |

The component updates the displayed text every 5 seconds using `setInterval` inside a `useEffect`. Cleanup clears the interval on unmount.

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setDisplayText(formatAge(lastUpdatedAt));
  }, 5_000);
  return () => clearInterval(interval);
}, [lastUpdatedAt]); // re-starts timer on each update
```

`formatAge` is a pure function (no side effects) colocated in the same file. It is the unit-testable entry point for this component.

### 9.3 Pulse animation

When `lastUpdatedAt` prop changes, the component applies a CSS class `freshness-pulse` for `PULSE_DURATION_MS = 600` ms, then removes it. The pulse is debounced: if `lastUpdatedAt` changes again while the pulse is active (or within the debounce window), the timer resets — only one pulse fires per debounce window.

**Debounce window: 1500 ms** (per brief §3 Piece 2 constraint).

```typescript
const pulseDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  // Clear any pending debounce
  if (pulseDebounce.current) clearTimeout(pulseDebounce.current);

  // Arm the pulse
  pulseDebounce.current = setTimeout(() => {
    setPulsing(true);
    setTimeout(() => setPulsing(false), PULSE_DURATION_MS);
  }, PULSE_DEBOUNCE_MS); // PULSE_DEBOUNCE_MS = 1500

  return () => {
    if (pulseDebounce.current) clearTimeout(pulseDebounce.current);
  };
}, [lastUpdatedAt]);
```

Named constants at top of file:
```typescript
const PULSE_DEBOUNCE_MS = 1_500;
const PULSE_DURATION_MS = 600;
```

### 9.4 Visual spec

- Small text, muted colour (e.g. `text-muted-foreground text-xs`).
- Pulse animation: brief brightness / opacity flash. CSS class `freshness-pulse` defined in the component or global stylesheet — use CSS `@keyframes` or Tailwind `animate-*` per existing codebase convention.
- No icon, no badge, no toast.
- Placed directly below the home greeting (`<h1>` heading) in `DashboardPage`.

### 9.5 Initial value in DashboardPage

`lastUpdatedAt` is initialised from the initial page load:

```typescript
const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(() => new Date());
```

On mount, `DashboardPage` fetches all blocks in parallel (unchanged behaviour). As each group resolves successfully, it calls `markFresh(new Date())` (§7.4), which routes through the dedup helper to `setLastUpdatedAt`. The indicator therefore shows a near-accurate "updated X ago" immediately after initial load with no special handling.

---

## 10. QueueHealthSummary live-update

### 10.1 Current state

`QueueHealthSummary` is a local function component defined inside `DashboardPage.tsx` (lines ~237–271). It fetches `/api/system/job-queues` once on mount and renders totals. It is only rendered for system-admin users.

### 10.2 Changes required

1. **Refactor to standalone file.** Extract `QueueHealthSummary` to `client/src/components/dashboard/QueueHealthSummary.tsx`. This is required because the component needs its own `refreshToken` prop and the parent needs to call `setQueueRefreshToken` — a local component function cannot be invoked from parent scope cleanly. Add the new file to §3 file inventory.

2. **Add `refreshToken` prop** (same pattern as `UnifiedActivityFeed`):
   ```typescript
   interface QueueHealthSummaryProps {
     refreshToken?: number;
   }
   ```

3. **Subscribe to `dashboard.queue.changed`** in `DashboardPage`:
   ```typescript
   const [queueRefreshToken, setQueueRefreshToken] = useState(0);

   useSocket('dashboard.queue.changed', useCallback(() => {
     setQueueRefreshToken(t => t + 1);
   }, []));
   ```

4. **`dashboard.queue.changed` is received via `system:sysadmin` room.** The sysadmin room requires an explicit join via `useSocketRoom` (the room gate validates `system_admin` role server-side). Always call the hook unconditionally and pass `null` as the `roomId` for non-sysadmin users — the hook's `useEffect` early-returns when `roomId` is null (verified in `client/src/hooks/useSocket.ts`):
   ```typescript
   useSocketRoom(
     'sysadmin',
     isSystemAdmin ? 'system' : null,
     {
       'dashboard.queue.changed': () => setQueueRefreshToken(t => t + 1),
     },
     refetchQueue, // onReconnectSync — re-fetch on socket reconnect
   );
   ```
   > **Hook signature note:** The third argument is `Record<string, (data: unknown) => void>` — an event-name-to-handler map, not an array of event names. The fourth argument is the optional `onReconnectSync` callback. The null-roomId early-return is the gate — no conditional hook call is needed, which keeps React's hook ordering rules satisfied for both sysadmin and non-sysadmin renders.

5. **Apply version tracking** using `queueTs` ref — same `applyIfNewer` pattern as other groups.

### 10.3 File inventory update

Add to §3.1:
- Create: `client/src/components/dashboard/QueueHealthSummary.tsx`

---

## 11. ClientPulseDashboardPage emitter gap

### 11.1 Background

`ClientPulseDashboardPage` already subscribes to `dashboard:update`:
```typescript
useSocket('dashboard:update', useCallback((data: unknown) => {
  const update = data as Partial<HealthSummary>;
  setHealth((prev) => prev ? { ...prev, ...update } : prev);
  toast.success('Dashboard updated with latest data');
}, []));
```

The server has never emitted this event (confirmed: no grep matches). This is dead client code that goes live as part of this build.

### 11.2 Changes required

1. **Remove the toast call.** Per brief §6 (toast spam mitigation): toast is replaced by the `<FreshnessIndicator>` pattern. The update handler becomes:
   ```typescript
   useSocket('dashboard:update', useCallback((data: unknown) => {
     const update = data as Partial<HealthSummary>;
     setHealth((prev) => prev ? { ...prev, ...update } : prev);
   }, []));
   ```

2. **Add `dashboard:update` server emit** in the ClientPulse health recalculation path (same location as `dashboard.client.health.changed` from §5.4):
   ```typescript
   // Emit both events from the same location
   emitOrgUpdate(orgId, 'dashboard.client.health.changed', healthSummary);
   emitOrgUpdate(orgId, 'dashboard:update', healthSummary);
   ```
   The `dashboard:update` payload must match the `Partial<HealthSummary>` shape that `ClientPulseDashboardPage` merges into state. Use the same health summary object.

3. **No `FreshnessIndicator` added to `ClientPulseDashboardPage`** in this build — that page is not in scope for UI polish here. The toast removal is the only UI change on that page.

### 11.3 `dashboard:update` vs `dashboard.client.health.changed` co-existence

Both events fire from the same server location with the same payload. They serve different consumers:
- `dashboard:update` → `ClientPulseDashboardPage` (merges partial health state)
- `dashboard.client.health.changed` → `DashboardPage` (triggers Client-health group refetch)

This is intentional. The two consumers have different update semantics (merge-in-place vs. invalidate-and-refetch) that justify separate event names.

---

## 12. Layout reservation — Piece 3

### 12.1 Requirement

Reserve a layout slot in `DashboardPage` for a future "Operational metrics" section positioned between "Pending your approval" and "Your workspaces." The slot is empty in this build — it renders nothing. It must be preserved through this PR so that Piece 3 can be slotted in without a layout redesign.

### 12.2 Implementation

Create `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx`:

```typescript
// Piece 3 layout reservation — renders nothing until operational metrics are built
export function OperationalMetricsPlaceholder(): null {
  return null;
}
```

In `DashboardPage.tsx`, insert at the correct position in the JSX:

```tsx
{/* Pending your approval section */}
{ /* ... existing approval cards ... */ }

{/* [LAYOUT-RESERVED: Piece 3 — Operational metrics] */}
<OperationalMetricsPlaceholder />

{/* Your workspaces section */}
{ /* ... existing workspace cards ... */ }
```

The import and the JSX line together make the reserved slot visible to future implementers without any UI impact.

---

## 13. Test plan

Testing posture: `static_gates_primary`, `runtime_tests: pure_function_only`, `frontend_tests: none_for_now`. No React component tests, no API contract tests, no E2E tests.

The following pure functions are testable with `npx tsx` test files per the existing convention.

### 13.1 `formatAge` (FreshnessIndicator)

**File:** `client/src/components/dashboard/__tests__/freshnessIndicator.test.ts`

Test cases:

| Input (seconds ago) | Expected output |
|---|---|
| 0 | "updated just now" |
| 5 | "updated just now" |
| 10 | "updated 10s ago" |
| 59 | "updated 59s ago" |
| 60 | "updated 1m ago" |
| 90 | "updated 1m ago" |
| 3599 | "updated 59m ago" |
| 3600 | "updated 1h ago" |
| 7200 | "updated 2h ago" |

### 13.2 `applyIfNewer` (ordering and version tracking)

**File:** `client/src/pages/__tests__/dashboardVersioning.test.ts`

Test cases:

| Scenario | `currentTs` | `incomingTs` | Expected |
|---|---|---|---|
| Newer response arrives | `"2026-04-27T10:00:00.000Z"` | `"2026-04-27T10:00:01.000Z"` | `apply()` called, `currentTs` updated |
| Older response arrives (stale) | `"2026-04-27T10:00:01.000Z"` | `"2026-04-27T10:00:00.000Z"` | `apply()` not called, `currentTs` unchanged |
| Equal timestamp (duplicate) | `"2026-04-27T10:00:00.000Z"` | `"2026-04-27T10:00:00.000Z"` | `apply()` not called (equal = not newer) |
| Empty initial state | `""` | `"2026-04-27T10:00:00.000Z"` | `apply()` called (any timestamp beats empty) |

### 13.3 Activity feed dedup logic

If `UnifiedActivityFeed` implements its merge logic as a pure function (recommended), test it:

**File:** `client/src/components/__tests__/activityFeedMerge.test.ts`

Test cases:

| Scenario | Expected |
|---|---|
| New item not in list | Prepended at top |
| Same item ID, newer `updatedAt` | Replaces existing row in-place |
| Same item ID, equal `updatedAt` | Existing row unchanged |
| Same item ID, older `updatedAt` (stale response) | Existing row unchanged |
| Two refetch responses with overlapping IDs | No duplicates in final list |

### 13.4 Reconnect debounce logic

If the debounce logic is extracted as a pure function (e.g. `shouldTriggerReconnectRefetch(prevConnected, connected)`), test:

| `prevConnected` | `connected` | Expected |
|---|---|---|
| `null` (initial mount) | `true` | No reconnect trigger (initial load, not a reconnect) |
| `true` | `false` | No trigger (disconnect, not reconnect) |
| `false` | `true` | Trigger reconnect refetch |
| `true` | `true` | No trigger (no state change) |

---

## 14. Deferred items

- **Piece 3 — Operational metrics blocks.** Phase 1 ships the layout slot (`OperationalMetricsPlaceholder`) only. The blocks themselves (cross-client spend, workflow/playbook health rollup) are out of scope for this build. Reason: mixing it with Pieces 1 and 2 muddies the success criteria — perception parity vs. product expansion are different bets.

- **`FreshnessIndicator` on `ClientPulseDashboardPage`.** The indicator is introduced on the home dashboard only. Propagating it to ClientPulse and future portal/subaccount dashboards is a Phase 2 activity.

- **`dashboard.queue.changed` emitter.** If the job queue mutation path is not straightforward to instrument within the time budget, this emitter may be deferred. `QueueHealthSummary` will still live-update on reconnect refetch. If deferred, document as a known gap in the PR description.

- **Subaccount and client portal dashboard reactivity.** The design principle established here ("every dashboard-style surface must reflect underlying system reactivity") applies to those surfaces, but the implementation is Phase 2.

- **`FreshnessIndicator` propagation to Phase 2 dashboards.** The component is designed as a reusable drop-in (`<FreshnessIndicator lastUpdatedAt={Date} />`) specifically to make Phase 2 propagation low-friction.

- **Activity feed dedup as a standalone pure function.** The merge logic is scoped to `UnifiedActivityFeed` in this build. If it warrants extraction to a shared utility, that refactor is deferred.

---

## 15. Pre-review checklist

Self-consistency pass run per `docs/spec-authoring-checklist.md`. Results below.

### Section 0 — Verify present state

No deferred items from `tasks/todo.md` are referenced. Greenfield spec — Section 0 not applicable.

### Section 1 — Existing primitives search

| Proposed new thing | Existing primitive | Decision |
|---|---|---|
| Socket subscription on `DashboardPage` | `useSocket` / `useSocketConnected` from `client/src/hooks/useSocket.ts` | **Reuse** — no new hook needed |
| Org-room WebSocket emit | `emitOrgUpdate` from `server/websocket/emitters.ts` | **Reuse** — no new emitter function |
| Sysadmin-room emit | `emitToSysadmin` from `server/websocket/emitters.ts` | **Reuse** |
| `FreshnessIndicator` | No existing freshness/timestamp component found | **New** — no equivalent exists in the component library |
| `QueueHealthSummary` | Exists as a local function in `DashboardPage.tsx` | **Extract** — move to standalone file to enable `refreshToken` prop |
| `OperationalMetricsPlaceholder` | No layout-reservation pattern exists | **New** — trivial, justified by Piece 3 layout-reserve requirement |

No new tables, routes, services, jobs, or state management introduced.

### Section 2 — File inventory lock

All files referenced in prose are in §3. Confirmed:
- `FreshnessIndicator.tsx` — §3.1 ✓
- `OperationalMetricsPlaceholder.tsx` — §3.1 ✓
- `QueueHealthSummary.tsx` — §3.1 ✓
- `DashboardPage.tsx` — §3.2 ✓
- `UnifiedActivityFeed.tsx` — §3.2 ✓
- All server files — §3.3 ✓

### Section 3 — Contracts

All data shapes that cross a boundary are pinned in §4.3 and §6.1:
- Event payload contracts: §4.3
- `TimestampedResponse<T>` envelope: §6.1
- `formatAge` input/output: §13.1
- `applyIfNewer` signature: §6.2

Source-of-truth precedence declared in §6.2: `serverTimestamp` from API response is the sole version discriminator.

### Section 4 — Permissions / RLS

No new tables, columns, or tenant-scoped data introduced. No RLS changes required. WebSocket rooms use existing authentication and role gates (org-room auto-joined on auth; sysadmin room requires `system_admin` role — both unchanged). No new HTTP routes.

### Section 5 — Execution model

All updates are **inline / synchronous** on the client: socket event → callback → refetch → state setter. No new pg-boss jobs. No new prompt partitions. Server emitters fire inline alongside existing emitters — no async queuing.

### Section 6 — Phase sequencing

Single-phase build. No backward dependencies. All new server emitters are additive (new `emitOrgUpdate` calls alongside existing emitters — no removal). All new client subscriptions are additive.

### Section 7 — Deferred items

`## Deferred items` section exists (§14). All items using the words "deferred", "Phase 2", or "out of scope" in prose are captured in §14. ✓

### Section 8 — Self-consistency

- **Goals ↔ Implementation match.** §1.2 success criteria each have a corresponding implementation section.
- **Every constraint in §1.3 has a named mechanism:**
  - Block-level refetch → §4 event table + §6.3 coalescing inflight/pending refs
  - Deterministic mapping → §4.2 exhaustive table + `EVENT_TO_GROUP` constant
  - Consistency groups → §7.2 `Promise.all` + synchronous state setters + §6.5 `expectedTimestamp` for activity-group atomicity
  - Latest-data-wins → §6.2 `applyIfNewer` + `serverTimestamp` (UTC + post-read generation invariant)
  - Idempotency → §4.4 two-layer dedup (eventId LRU + per-group coalescing)
  - Failure handling → §6.4 (no `applyIfNewer`, no `markFresh` on failure — indicator ages to signal staleness)
  - No new state library → §3.4 (not introduced)
  - No global socket abstraction → §3.4 (not introduced)
  - Pulse debounced ≥1.5s → §9.3 `PULSE_DEBOUNCE_MS = 1_500`
  - Sysadmin identical behaviour → §10
  - Event coverage declared → §4.2 table mandate
- No contradictions found.

### Section 9 — Testing posture

Test plan (§13) contains only pure-function tests (`formatAge`, `applyIfNewer`, feed dedup, reconnect transition). No React component tests, no API contract tests, no E2E tests. Consistent with `spec-context.md` posture. ✓

### Section 10 — Execution-safety contracts

This spec introduces no new database writes, no new state machines, no new pg-boss jobs, and no new unique constraints. The changes are:
- New WebSocket emit calls (fire-and-forget, no ack, no retry contract needed)
- New client-side `useSocket` subscriptions (existing dedup mechanism handles re-delivery)
- `serverTimestamp` added to API responses (read-only change to response shape)

No idempotency posture, retry classification, concurrency guard, terminal event, or unique constraint mapping is required — none of the §10 triggers apply.

---

**Verdict:** Spec is internally consistent and ready for `spec-reviewer`.
