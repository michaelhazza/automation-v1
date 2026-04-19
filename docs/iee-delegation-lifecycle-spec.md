# IEE Delegation Lifecycle — Phase 0 Implementation Spec

_Date: 2026-04-18_
_Branch: `claude/openclaw-worker-mode-VnjQT`_
_Sequence: Phase 0 of the OpenClaw Strategy roadmap (`docs/openclaw-strategic-analysis.md`). Must complete before Phase 1 (substrate adapter) begins._

---

## Contents

- [Problem statement](#problem-statement)
- [Current state (grounded in code)](#current-state-grounded-in-code)
- [Design](#design)
  - [State model](#state-model)
  - [Event flow](#event-flow)
  - [Components affected](#components-affected)
- [Implementation steps](#implementation-steps)
  - [Step 1 — Schema and type changes](#step-1--schema-and-type-changes)
  - [Step 2 — Replace synthetic completion in agentExecutionService](#step-2--replace-synthetic-completion-in-agentexecutionservice)
  - [Step 3 — Implement `iee-run-completed` handler on the main app](#step-3--implement-iee-run-completed-handler-on-the-main-app)
  - [Step 4 — Reconciliation job](#step-4--reconciliation-job)
  - [Step 5 — Cost and summary rollup onto parent run](#step-5--cost-and-summary-rollup-onto-parent-run)
  - [Step 6 — WebSocket progress bridge (stretch in this phase)](#step-6--websocket-progress-bridge-stretch-in-this-phase)
  - [Step 7 — Telemetry and UI surfacing](#step-7--telemetry-and-ui-surfacing)
  - [Step 8 — Cancellation handling](#step-8--cancellation-handling)
- [Tests](#tests)
- [Acceptance criteria](#acceptance-criteria)
- [Risks and open questions](#risks-and-open-questions)
- [Out of scope](#out-of-scope)
- [Appendix A — Status mapping table](#appendix-a--status-mapping-table)
- [Appendix B — File inventory](#appendix-b--file-inventory)

---

## Problem statement

When an agent run is delegated to the IEE (Integrated Execution Environment) worker — i.e. `executionMode` is `iee_browser` or `iee_dev` — the parent `agent_runs` row is marked **`completed`** the moment the IEE job is enqueued, while actual execution continues out-of-band on the worker. Users see "complete" while the work is still pending, running, or about to fail. This is the v1 IEE behaviour and it is the single biggest reliability liability in the platform.

The fix: the parent `agent_runs` row must remain in a **non-terminal delegated state** until the IEE worker reaches a terminal state (or reconciliation deems the delegation lost), at which point the parent's terminal status is derived from the IEE row.

This work is the precondition for OpenClaw Worker Mode and every other delegated-execution backend. Building OpenClaw on top of the current synthetic-completion behaviour means OpenClaw is born with the same trust failure at higher cost-relevance.

---

## Current state (grounded in code)

### The bug, exactly

`server/services/agentExecutionService.ts` lines 881–920 build a synthetic `loopResult` immediately after enqueueing the IEE job:

```ts
const enqueueResult = await enqueueIEETask({ ... });
loopResult = {
  summary: `IEE ${expectedType} task enqueued (ieeRunId=${enqueueResult.ieeRunId}...)`,
  toolCallsLog: [{ type: 'iee_handoff', ieeRunId: ..., mode: effectiveMode }],
  totalToolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  tasksCreated: 0,
  tasksUpdated: 0,
  deliverablesCreated: 0,
  finalStatus: 'completed',  // <-- this is the bug
};
```

`server/services/agentExecutionService.ts` lines 1133–1147 then commit that `finalStatus` to `agent_runs`:

```ts
await db.update(agentRuns).set({
  status: finalStatus,         // 'completed' from synthetic loopResult
  ...
  completedAt: new Date(),
  ...
}).where(eq(agentRuns.id, run.id));
```

### What's already in place (and good)

- **`iee_runs` table is rich** (`server/db/schema/ieeRuns.ts` lines 26–138): tracks `status`, `lastHeartbeatAt`, `eventEmittedAt`, `failureReason`, `resultSummary`, full cost columns (`llmCostCents`, `runtimeCostCents`, `totalCostCents`), `stepCount`, runtime metrics. The data model for delegated execution is already complete.
- **Worker writes terminal state correctly** (`worker/src/persistence/runs.ts` lines 90–150): `finalizeRun()` atomically updates `iee_runs.status`, releases the budget reservation, and emits an `iee-run-completed` pg-boss event.
- **The `iee-run-completed` job is registered** in `server/config/jobConfig.ts` (lines 304–311) with `idempotencyStrategy: 'one-shot'`, retry limit 3, DLQ.
- **`event_emitted_at` column on `iee_runs`** (migration `0071`) tracks successful event emission, with a partial index on `(status, completed_at) WHERE event_emitted_at IS NULL` for cleanup-job scans.
- **Heartbeat detection scaffolding exists**: `iee_runs.lastHeartbeatAt` plus index on `(status, last_heartbeat_at) WHERE deleted_at IS NULL`.

### The critical gap

**No handler is registered on the main app for the `iee-run-completed` event.** The worker emits it; nothing consumes it. This is the missing piece that connects worker-side terminal state back to the parent `agent_runs` row.

### Other gaps

- Zero test coverage on the IEE delegation path.
- `agent_runs.status` enum (text field) does not include any "delegated" / "awaiting-backend" value — currently every run lands on a terminal state directly from the loop result.
- Worker progress (per-step events) is not bridged to the WebSocket layer; clients listening to `agent-run:${runId}` see no activity between handoff and synthetic completion.
- No reconciliation path for: (a) terminal `iee_runs` whose event was never emitted, (b) terminal `iee_runs` whose event fired but parent `agent_runs` did not transition, (c) `iee_runs` stuck in `running` with stale heartbeat (worker died).

---

## Design

### State model

The cleanest separation is: **`agent_runs.status` describes the agent run's overall lifecycle. The backend's lifecycle lives on the backend's row.** This keeps `agent_runs` backend-agnostic and ready for OpenClaw, future runtimes, and the Phase 1 `ExecutionBackend` adapter pattern.

We introduce **one** new non-terminal value on `agent_runs.status`:

| New value | Meaning |
|---|---|
| `delegated` | Agent run has been handed off to a delegated execution backend (currently IEE; future: OpenClaw managed/external). The parent run is waiting. Detail (pending vs running vs step count) lives on the backend's row (`iee_runs` today). |

We do **not** add `delegated_pending` / `delegated_running` / `delegated_failed` / `delegated_completed` directly onto `agent_runs.status` — Codex's earlier recommendation was conceptual. Mirroring backend states onto the parent enum couples the parent table to a specific backend and forces every future backend to extend the enum. Instead:

- `iee_runs.status` already covers `pending` / `running` / `completed` / `failed` — that's the delegation detail.
- `agent_runs.status = 'delegated'` while delegation is in flight.
- On terminal IEE state, `agent_runs.status` transitions to one of the existing terminal values via the mapping in [Appendix A](#appendix-a--status-mapping-table).

### Event flow

```
Main app                              Worker                          DB
--------                              ------                          --
agentExecutionService
  routes to iee_*
    enqueueIEETask()                                     -->  insert iee_runs (pending)
    update agent_runs                                    -->  agent_runs.status = 'delegated'
    return (no synthetic completion)
                                      pg-boss picks up
                                      markRunning()      -->  iee_runs.status = 'running'
                                      executor loops
                                        (heartbeats)     -->  iee_runs.lastHeartbeatAt
                                      finalizeRun()      -->  iee_runs.status = terminal
                                                              budget_reservations.committed
                                      emit pg-boss event
                                        'iee-run-completed'
ieeRunCompletedHandler
  receives event
    load iee_runs row
    load agent_runs row (FK on iee_runs.agentRunId)
    map iee terminal -> agent terminal
    update agent_runs                                    -->  agent_runs.status = terminal,
                                                              completedAt, summary, costs
    mark iee_runs.eventEmittedAt = now()                 -->  prevents reconciliation re-fire
    emit WebSocket 'agent:run:completed'
```

If the event is lost (DLQ exhausted, handler crash) or never fires (worker died), the **reconciliation job** picks up the orphan and performs the same transition.

### Components affected

| Layer | File / module | Change |
|---|---|---|
| Schema | `server/db/schema/agentRuns.ts` | Extend `status` TS union with `'delegated'`. No SQL migration needed (text column, no DB-level enum constraint). |
| Service | `server/services/agentExecutionService.ts` | Replace synthetic `loopResult` for IEE branches; transition agent run to `delegated` and return without finalisation. |
| Job handler | `server/jobs/ieeRunCompletedHandler.ts` (new) | Consume `iee-run-completed` event; perform terminal mapping and parent update. |
| Job registration | `server/jobs/index.ts` | Register the new handler. |
| Reconciliation | `server/jobs/ieeCleanupOrphansJob.ts` (existing job, currently empty / partial) | Implement orphan scan and recovery. |
| Service | `server/services/agentRunFinalizationService.ts` (new, factored out) | Shared logic to transition `agent_runs` to terminal from an `iee_runs` row. Used by both the event handler and the reconciliation job. |
| Telemetry | `server/services/ieeUsageService.ts` | Surface `delegated` count alongside existing aggregations. |
| WebSocket | `server/websocket/emitters.ts` (existing) | Emit `agent:run:delegated` and `agent:run:progressed` events. |
| Tests | `server/services/__tests__/agentRunFinalizationServicePure.test.ts` (new) plus integration tests | Cover mapping + orphan recovery + idempotency. |

---

## Implementation steps

### Step 1 — Schema and type changes

1. **Extend `agent_runs.status` TS union** in `server/db/schema/agentRuns.ts`:

   ```ts
   status: text('status').notNull().default('pending').$type<
     | 'pending' | 'running' | 'delegated'   // <-- new
     | 'completed' | 'failed' | 'timeout'
     | 'cancelled' | 'loop_detected' | 'budget_exceeded'
     | 'awaiting_clarification' | 'waiting_on_clarification'
     | 'completed_with_uncertainty'
   >()
   ```

   No SQL migration required (column is `text` with no DB-level CHECK constraint per `agentRuns.ts` line 85). Validate by running `npm run db:generate` and confirming no diff is produced.

2. **Extend `iee_runs.failureReason` TS union** in `server/db/schema/ieeRuns.ts` to add `'worker_terminated'` (per decision 1). No SQL migration required. Full updated union:

   ```ts
   failureReason: text('failure_reason').$type<
     | 'timeout' | 'step_limit_reached' | 'execution_error'
     | 'environment_error' | 'auth_failure' | 'budget_exceeded'
     | 'connector_timeout' | 'rate_limited' | 'data_incomplete'
     | 'internal_error' | 'worker_terminated'  // <-- new
     | 'unknown'
   >()
   ```

3. **Extend `iee_runs.status` TS union** to include `'cancelled'` (used by Step 8 cancellation path). No SQL migration required.

4. **No other changes to `iee_runs` schema** — it already has every column required.

5. **Sanity check**: `grep` for any code that lists known `agent_runs.status` values explicitly (filter dropdowns, validation schemas, status-to-display-label mappings). Update those to include `delegated`. Likely locations: `client/src/lib/agentRunStatus.ts` (or similar), permission filters, run-list page filter UI.

### Step 2 — Replace synthetic completion in agentExecutionService

In `server/services/agentExecutionService.ts`, **remove the synthetic `loopResult`** for IEE branches (current lines 881–920) and **return early** with the parent run already transitioned to `delegated`.

Concrete shape:

```ts
if (effectiveMode === 'iee_browser' || effectiveMode === 'iee_dev') {
  if (!request.ieeTask) {
    throw { statusCode: 400, message: 'ieeTask is required when executionMode is iee_browser/iee_dev', errorCode: 'IEE_TASK_REQUIRED' };
  }
  const expectedType = effectiveMode === 'iee_browser' ? 'browser' : 'dev';
  if (request.ieeTask.type !== expectedType) {
    throw { statusCode: 400, message: `executionMode ${effectiveMode} requires ieeTask.type=${expectedType}`, errorCode: 'IEE_TASK_TYPE_MISMATCH' };
  }

  const { enqueueIEETask } = await import('./ieeExecutionService.js');
  const enqueueResult = await enqueueIEETask({
    task: request.ieeTask as Parameters<typeof enqueueIEETask>[0]['task'],
    organisationId: request.organisationId,
    subaccountId: request.subaccountId ?? null,
    agentId: request.agentId,
    agentRunId: run.id,
    correlationId: run.id,
  });

  // Transition parent run to delegated state. Do NOT set completedAt.
  // Do NOT call the standard finalisation block below.
  await db.update(agentRuns).set({
    status: 'delegated',
    summary: `Delegated to IEE ${expectedType} (ieeRunId=${enqueueResult.ieeRunId}${enqueueResult.deduplicated ? ', deduplicated' : ''})`,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(agentRuns.id, run.id));

  emitAgentRunUpdate(run.id, 'agent:run:delegated', {
    ieeRunId: enqueueResult.ieeRunId,
    mode: effectiveMode,
    deduplicated: enqueueResult.deduplicated,
  });

  return {
    runId: run.id,
    status: 'delegated',
    ieeRunId: enqueueResult.ieeRunId,
    deduplicated: enqueueResult.deduplicated,
  };
}
```

Then **bypass the normal finalisation block** (lines 1133–1147 today). Either return early as above, or wrap the finalisation block in `if (effectiveMode !== 'iee_browser' && effectiveMode !== 'iee_dev') { ... }`. Early return is cleaner and avoids touching the existing finalisation logic for non-IEE paths.

The route-level response shape changes for IEE callers — they now receive `{ status: 'delegated', ieeRunId, deduplicated }` instead of a fully-populated terminal result. Audit callers of `executeAgentRun` and update their response handling. Likely callers: route handlers under `server/routes/agentRuns.ts`, `server/routes/iee.ts`, and any internal agent-to-agent invocation paths.

### Step 3 — Implement `iee-run-completed` handler on the main app

Create `server/jobs/ieeRunCompletedHandler.ts`:

```ts
import type PgBoss from 'pg-boss';
import { db } from '../db/index.js';
import { ieeRuns } from '../db/schema/ieeRuns.js';
import { eq } from 'drizzle-orm';
import { finaliseAgentRunFromIeeRun } from '../services/agentRunFinalizationService.js';
import { logger } from '../lib/logger.js';

export const QUEUE = 'iee-run-completed';

interface IeeRunCompletedPayload {
  ieeRunId: string;
  organisationId: string;
  agentRunId: string | null;
  status: 'completed' | 'failed';
  failureReason?: string | null;
}

export async function registerIeeRunCompletedHandler(boss: PgBoss): Promise<void> {
  await boss.work<IeeRunCompletedPayload>(
    QUEUE,
    { teamSize: 4, teamConcurrency: 1 },
    async (job) => {
      const { ieeRunId } = job.data;

      // Re-load the iee_runs row from DB rather than trusting payload —
      // the row is the source of truth, the event payload is a hint.
      const [ieeRun] = await db.select().from(ieeRuns).where(eq(ieeRuns.id, ieeRunId)).limit(1);
      if (!ieeRun) {
        logger.warn({ ieeRunId }, 'iee-run-completed for unknown iee_run; ignoring');
        return;
      }

      if (!ieeRun.agentRunId) {
        // Standalone IEE run with no parent agent_run — nothing to finalise.
        // Still mark eventEmittedAt to prevent reconciliation re-fire.
        await db.update(ieeRuns)
          .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
          .where(eq(ieeRuns.id, ieeRunId));
        return;
      }

      await finaliseAgentRunFromIeeRun(ieeRun);
    },
  );
}
```

Register in `server/jobs/index.ts` alongside the existing IEE handlers.

Create the shared service `server/services/agentRunFinalizationService.ts`:

```ts
export async function finaliseAgentRunFromIeeRun(ieeRun: IeeRun): Promise<void> {
  // Idempotency: if eventEmittedAt is already set AND parent agent_run is
  // already terminal, this is a duplicate fire — return.
  // Otherwise: derive parent terminal status and update both rows atomically.

  await db.transaction(async (tx) => {
    if (!ieeRun.agentRunId) return;

    const [parent] = await tx.select().from(agentRuns)
      .where(eq(agentRuns.id, ieeRun.agentRunId))
      .for('update')   // row-level lock — prevents reconciliation race
      .limit(1);

    if (!parent) {
      logger.warn({ ieeRunId: ieeRun.id, agentRunId: ieeRun.agentRunId },
        'iee_run references missing agent_run; marking eventEmittedAt and returning');
      await tx.update(ieeRuns)
        .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
        .where(eq(ieeRuns.id, ieeRun.id));
      return;
    }

    // Idempotent: parent already terminal AND iee event already marked.
    if (parent.status !== 'delegated' && ieeRun.eventEmittedAt) return;

    const terminalStatus = mapIeeStatusToAgentRunStatus(ieeRun.status, ieeRun.failureReason);
    const summary = buildSummaryFromIeeRun(ieeRun);
    const startedAt = parent.startedAt ?? ieeRun.startedAt ?? parent.createdAt;
    const completedAt = ieeRun.completedAt ?? new Date();
    const durationMs = completedAt.getTime() - new Date(startedAt).getTime();

    // Roll up token counts from llm_requests attributable to this iee_run.
    const [tokenTotals] = await tx.select({
      inputTokens: sql<number>`COALESCE(SUM(input_tokens), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(output_tokens), 0)::int`,
      totalTokens: sql<number>`COALESCE(SUM(total_tokens), 0)::int`,
      totalToolCalls: sql<number>`COALESCE(SUM(tool_call_count), 0)::int`,
    }).from(llmRequests).where(eq(llmRequests.ieeRunId, ieeRun.id));

    await tx.update(agentRuns).set({
      status: terminalStatus,
      summary,
      completedAt,
      durationMs,
      inputTokens: tokenTotals.inputTokens,
      outputTokens: tokenTotals.outputTokens,
      totalTokens: tokenTotals.totalTokens,
      totalToolCalls: tokenTotals.totalToolCalls,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, parent.id));

    await tx.update(ieeRuns)
      .set({ eventEmittedAt: new Date(), updatedAt: new Date() })
      .where(eq(ieeRuns.id, ieeRun.id));
  });

  emitAgentRunUpdate(ieeRun.agentRunId, 'agent:run:completed', {
    ieeRunId: ieeRun.id,
    finalStatus: mapIeeStatusToAgentRunStatus(ieeRun.status, ieeRun.failureReason),
    failureReason: ieeRun.failureReason,
  });
}
```

Mapping function lives in the same file — see [Appendix A](#appendix-a--status-mapping-table) for the full table.

### Step 4 — Reconciliation job

The `iee-cleanup-orphans` job already exists in `server/config/jobConfig.ts` (lines 280–286) but its handler is either empty or partial. Implement it as a periodic cron (every 60 seconds) covering three orphan classes:

**Class 1 — Terminal `iee_runs` whose event was never emitted** (worker crashed between `finalizeRun()` and event emission, or pg-boss enqueue failed):

```ts
// Uses existing partial index: (status, completed_at) WHERE event_emitted_at IS NULL
const orphans = await db.select().from(ieeRuns)
  .where(and(
    inArray(ieeRuns.status, ['completed', 'failed']),
    isNull(ieeRuns.eventEmittedAt),
    isNull(ieeRuns.deletedAt),
    lt(ieeRuns.completedAt, sql`now() - interval '60 seconds'`),  // grace window
  ))
  .limit(100);

for (const ieeRun of orphans) {
  await finaliseAgentRunFromIeeRun(ieeRun);  // same path as event handler
}
```

**Class 2 — `agent_runs` stuck in `delegated` whose linked `iee_runs` is terminal** (event handler crashed, DLQ exhausted, etc.):

```ts
const stuck = await db.select({
  agentRun: agentRuns,
  ieeRun: ieeRuns,
}).from(agentRuns)
  .innerJoin(ieeRuns, eq(ieeRuns.agentRunId, agentRuns.id))
  .where(and(
    eq(agentRuns.status, 'delegated'),
    inArray(ieeRuns.status, ['completed', 'failed']),
    isNull(ieeRuns.deletedAt),
    lt(agentRuns.updatedAt, sql`now() - interval '120 seconds'`),
  ))
  .limit(100);

for (const { ieeRun } of stuck) {
  await finaliseAgentRunFromIeeRun(ieeRun);
}
```

**Class 3 — `iee_runs` stuck in `running` with stale heartbeat** (worker died mid-execution):

```ts
// Uses existing index: (status, last_heartbeat_at) WHERE deleted_at IS NULL
const HEARTBEAT_STALE_SECONDS = 180; // worker heartbeats every 30s; 6x grace
const dead = await db.select().from(ieeRuns)
  .where(and(
    eq(ieeRuns.status, 'running'),
    isNull(ieeRuns.deletedAt),
    or(
      isNull(ieeRuns.lastHeartbeatAt),
      lt(ieeRuns.lastHeartbeatAt, sql`now() - interval '${HEARTBEAT_STALE_SECONDS} seconds'`),
    ),
    // Plus a floor on startedAt to avoid racing newly-claimed jobs
    lt(ieeRuns.startedAt, sql`now() - interval '${HEARTBEAT_STALE_SECONDS} seconds'`),
  ))
  .limit(50);

for (const ieeRun of dead) {
  await db.update(ieeRuns).set({
    status: 'failed',
    failureReason: 'internal_error',
    completedAt: new Date(),
    updatedAt: new Date(),
    resultSummary: { reason: 'worker_heartbeat_stale', detectedAt: new Date().toISOString() },
  }).where(eq(ieeRuns.id, ieeRun.id));

  // Re-load post-update so finalisation sees terminal state
  const [updated] = await db.select().from(ieeRuns).where(eq(ieeRuns.id, ieeRun.id)).limit(1);
  if (updated) await finaliseAgentRunFromIeeRun(updated);
}
```

**Job registration**: in `server/jobs/index.ts`, schedule `iee-cleanup-orphans` to fire every 60s. Use pg-boss's `schedule()` API. Idempotency strategy is already `'fifo'` per `jobConfig.ts`.

**Observability**: every reconciliation pass emits a structured log line with counts per class. Counts > 0 are warnings (something failed); sustained non-zero counts trigger alert (see Step 7).

### Step 5 — Cost and summary rollup onto parent run

The synthetic completion currently sets `inputTokens`, `outputTokens`, `totalTokens`, `totalToolCalls`, `tasksCreated`, `tasksUpdated`, `deliverablesCreated` to `0` on the parent `agent_runs`. For real terminal mapping:

- **`summary`**: derive from `iee_runs.resultSummary` if present, else use a templated fallback (`"IEE ${type} task ${status}: ${failureReason ?? 'ok'}"`). Keep under 500 chars; truncate with ellipsis if longer.
- **`durationMs`**: `completedAt - startedAt` (compute in finalisation service).
- **Token and tool-call rollup (Phase 0 core, per decision 2)**: inside `finaliseAgentRunFromIeeRun`, aggregate `SUM(input_tokens), SUM(output_tokens), SUM(total_tokens), SUM(tool_call_count)` from `llm_requests WHERE iee_run_id = ?` and write onto the parent. One query per terminal transition. Rationale: existing UI/API surfaces that read `agent_runs.{inputTokens, outputTokens, totalTokens, totalToolCalls}` would otherwise show `0` for every IEE-delegated run — a visible regression. Rollup is cheaper than patching every read site to JOIN into `llm_requests`.
- **`tasksCreated` / `tasksUpdated` / `deliverablesCreated`**: IEE runs do not currently produce these signals. Leave at 0. If IEE workflows start producing them, extend `iee_runs.resultSummary` to carry the counts and roll up here.

**Cost-attribution principle**: total cost lives on `iee_runs.totalCostCents` and is queryable per-agent-run via the join `agent_runs → iee_runs → llm_requests`. Do **not** duplicate cost columns onto `agent_runs` — single source of truth. Usage views should JOIN for cost, but tokens are rolled up for API/UI compatibility.

### Step 6 — Progress visibility during delegation

Per decision 3: **full WebSocket streaming is split into a follow-up ticket. Phase 0 ships a lightweight polling substitute** so users are not staring at a silent "Delegated" status during a 30-second run.

**Phase 0 inclusion — progress polling endpoint:**

1. Add `GET /api/iee/runs/:ieeRunId/progress` in `server/routes/iee.ts`. Tenant-scoped (org + subaccount checked). Returns:

   ```ts
   {
     ieeRunId: string;
     status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
     stepCount: number;
     lastHeartbeatAt: string | null;      // ISO
     heartbeatAgeSeconds: number | null;  // now - lastHeartbeatAt
     startedAt: string | null;
     completedAt: string | null;
     failureReason: string | null;
   }
   ```

2. Client-side, on the agent-run detail page, when `agent_runs.status = 'delegated'`, poll this endpoint every 3 seconds. Render `Step ${stepCount} · Last heartbeat ${heartbeatAgeSeconds}s ago`. Stop polling when parent transitions to terminal (detected via existing WebSocket `agent:run:completed` event).

3. No new pg-boss channel, no worker-side changes. Cost: one SELECT per polling tick per in-flight delegated run. Cheap — primary-key lookup.

**Follow-up ticket (not Phase 0) — true WebSocket streaming:**

- Worker emits `iee-step-progressed` pg-boss events from `runHandler.ts` after each step persists.
- `server/jobs/ieeStepProgressedHandler.ts` consumes events and emits `agent:run:progressed` to the `agent-run:${agentRunId}` WebSocket room.
- Client replaces polling with WebSocket subscription.
- Volume sanity: typical IEE browser run is 5–50 steps; at 10 concurrent runs that's 50–500 events/minute through pg-boss. Within budget.

This follow-up should land within one sprint of Phase 0 — not deferred to Phase 1+.

### Step 7 — Telemetry and UI surfacing

**Usage Explorer (`server/services/ieeUsageService.ts`)**:

- Add `delegated` to the status distribution surface (currently only counts terminal states from `iee_runs`; should also count parent `agent_runs.status = 'delegated'` for visibility into in-flight delegation backlog).
- Add a "stuck delegated" metric: count of `agent_runs.status = 'delegated'` where `updatedAt < now() - interval '5 minutes'`. Surfaces as a health signal in admin views.

**Run detail view (`client/src/pages/AgentRunDetailPage.tsx` or equivalent)**:

- Render `delegated` status with explicit visual treatment (e.g. spinner + "Delegated to IEE worker" label).
- Surface `iee_runs.lastHeartbeatAt` age — "Last heartbeat: 12s ago" — when status is `delegated`.
- On terminal transition, render `iee_runs.resultSummary` and `failureReason` if present.

**Alerting**:

- Reconciliation Class 1 (event-emission failures): warn at >5 events/hour.
- Reconciliation Class 2 (handler/DLQ failures): warn at >5 events/hour.
- Reconciliation Class 3 (worker death): warn at any non-zero count over a 15-minute window.
- **DLQ depth (per decision 4)**: warn when `iee-run-completed__dlq` depth > 0 sustained over 5 minutes. This is an observability signal, not an auto-recovery trigger — reconciliation is the sole recovery path. DLQ entries indicate the handler itself is broken; replaying would just re-DLQ.
- All four emitted as structured log events (`level: warn`, `category: 'iee-reconciliation'`). Hook into existing log-aggregation alert routing — no new infrastructure required.

### Step 8 — Cancellation handling

When a user cancels an `agent_runs` row that is in `delegated` state:

1. The route handler (likely `server/routes/agentRuns.ts`) writes `agent_runs.status = 'cancelled'`, `completedAt = now()`.
2. **In the same transaction**, write `iee_runs.status = 'cancelled'` (new IEE status value — extend `iee_runs.status` TS union: `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`). No SQL migration needed (text column).
3. Worker's per-step loop checks `iee_runs.status` before each step. If it sees `'cancelled'`, it exits cleanly with no further side effects, calls `finalizeRun()` with terminal status `cancelled`, and releases the budget reservation.
4. The `iee-run-completed` event still fires; the handler sees `agent_runs.status = 'cancelled'` (already terminal) and is a no-op. Idempotency holds.

**Worker-side check location**: `worker/src/handlers/runHandler.ts` step loop. Add a single SELECT before each step (cheap — primary key lookup).

If the worker is genuinely hung (no step boundary), cancellation falls through to the heartbeat-stale path (reconciliation Class 3) within `HEARTBEAT_STALE_SECONDS`. Acceptable for Phase 0.

**Published cancellation SLA (per decision 5):** *"Cancellation completes at the next step boundary (typically 5–30 seconds) or via heartbeat-stale reconciliation (maximum 180 seconds)."* Document this in the API reference and in the UI confirmation dialog. Worker-process SIGTERM cancellation is explicitly out of scope for Phase 0 — pg-boss runs `IEE_*_CONCURRENCY > 1` concurrent jobs in one process, so a process-level signal would kill peers. Sub-second cancel requires per-task container isolation, which is a separate architectural initiative with its own benefits (security isolation, resource limits, blast-radius containment) and should not be bolted onto Phase 0.

---

## Tests

Use the project convention: pure-logic tests in `*Pure.test.ts` (no DB), integration tests against a test Postgres.

### Pure tests — `agentRunFinalizationServicePure.test.ts` (new)

- `mapIeeStatusToAgentRunStatus` covers every cell of the [Appendix A](#appendix-a--status-mapping-table) table.
- `buildSummaryFromIeeRun` truncates at 500 chars; falls back to template when `resultSummary` is null.
- Idempotency guard: when called with an `iee_run` whose `eventEmittedAt` is set AND parent `agent_runs.status` is already terminal, returns without DB writes.

### Integration tests — `agentRunDelegationFlow.test.ts` (new)

Run against a test Postgres + an in-process pg-boss instance. Cover the lifecycle end to end:

1. **Happy path**: enqueue an IEE browser run → assert parent `agent_runs.status = 'delegated'`, no `completedAt` → simulate worker writing `iee_runs.status = 'completed'` and emitting `iee-run-completed` → assert handler fires, parent transitions to `completed`, `completedAt` populated, summary derived from `iee_runs.resultSummary`, `eventEmittedAt` set.
2. **Token rollup**: seed `llm_requests` rows with known token counts linked to the `iee_run` → complete the run → assert parent `agent_runs.{inputTokens, outputTokens, totalTokens, totalToolCalls}` equal the sums.
3. **Failure path — timeout**: worker writes `iee_runs.status = 'failed', failureReason = 'timeout'` → assert parent transitions to `timeout`.
4. **Failure path — worker_terminated**: worker writes `iee_runs.status = 'failed', failureReason = 'worker_terminated'` → assert parent transitions to `failed` (not `cancelled` — decision 1 boundary).
5. **Budget-exceeded path**: `failureReason = 'budget_exceeded'` → parent transitions to `budget_exceeded`.
6. **Reconciliation Class 1**: write a terminal `iee_runs` row directly (skip event emit) → run reconciliation → assert parent transitions, `eventEmittedAt` set.
7. **Reconciliation Class 2**: terminal `iee_runs` with `eventEmittedAt` set, parent stuck in `delegated` (simulating handler crash post-DB-write) → run reconciliation → assert parent transitions correctly.
8. **Reconciliation Class 3 (worker death)**: `iee_runs.status = 'running'` with stale `lastHeartbeatAt` → run reconciliation → assert `iee_runs` transitions to `failed/internal_error`, parent transitions to `failed`.
9. **Idempotency**: call `finaliseAgentRunFromIeeRun` twice for the same `iee_run` → second call is a no-op (no double-update, no double WebSocket emit).
10. **Cancellation (user-initiated)**: cancel an `agent_runs` while delegated → `iee_runs.status` becomes `cancelled` → worker's next-step check returns no-op → terminal event fires → handler sees parent already terminal, is a no-op.
11. **Progress endpoint**: `GET /api/iee/runs/:ieeRunId/progress` while `status = 'running'` returns expected shape including `heartbeatAgeSeconds`. Verify tenant scoping (cross-org request returns 404, not data leak).
12. **Deduplication**: two enqueues with the same `idempotencyKey` → only one `iee_runs` row created → `enqueueResult.deduplicated = true`. (Tests existing behaviour, regression guard.)

### Manual smoke test

Run end-to-end on Docker Desktop locally:

1. Start main app + worker container.
2. Trigger an IEE browser task via API.
3. Open the agent-run detail page in the browser; assert it shows "Delegated" with a live heartbeat timer.
4. Wait for completion; assert UI transitions to terminal status with summary populated.
5. Trigger a deliberately-failing task (invalid URL); assert `failed` status with `failureReason` surfaced.

### Verification commands per CLAUDE.md

After implementation:

- `npm run lint` (auto-fix up to 3 attempts)
- `npm run typecheck`
- `npm test -- agentRunFinalizationServicePure agentRunDelegationFlow` (new suites must pass)
- `npm run db:generate` (must produce no diff if schema migration is unchanged)

---

## Acceptance criteria

The work is **only** complete when every assertion below holds:

1. **No synthetic completion**: `grep -n "finalStatus: 'completed'" server/services/agentExecutionService.ts` returns zero matches inside the IEE branch.
2. **Parent transitions to `delegated`**: a fresh IEE-routed agent run, observed immediately after `executeAgentRun` returns, has `agent_runs.status = 'delegated'`, `completedAt IS NULL`.
3. **Parent reaches terminal only after worker terminal**: in integration test #1, between worker enqueue and worker completion, parent stays `delegated`. After worker `finalizeRun()` + event handler, parent reaches `completed` within 5 seconds.
4. **Mapping correctness**: every cell of [Appendix A](#appendix-a--status-mapping-table) is exercised by a passing test.
5. **Reconciliation recovers all three orphan classes**: integration tests #4, #5, #6 pass. Reconciliation completes within one cron tick (60s) in each case.
6. **Idempotency**: handler + reconciliation path can both fire for the same `iee_run` with no double-write, no double-WebSocket emit (test #7).
7. **Cancellation works**: test #8 passes. UI cancellation observed locally completes within `HEARTBEAT_STALE_SECONDS` even if worker is hung.
8. **Telemetry surfaces `delegated` count**: `GET /api/iee/usage/system` returns a non-zero `delegated` count when an in-flight delegation exists.
9. **No regression on non-IEE paths**: existing API, headless, claude-code execution tests still pass; no behavioural change observed.
10. **Docs updated**: this spec, plus `architecture.md`'s execution-mode section, plus `docs/openclaw-strategic-analysis.md` Phase 0 reference all describe the new lifecycle accurately.

---

## Risks and open questions

### Risks

- **Caller contract change**: the route response for IEE-routed agent runs now returns `{ status: 'delegated', ieeRunId }` instead of a fully-populated terminal result. Any client that synchronously waits for completion in the same request breaks. Mitigation: audit callers in Step 2; document the contract change in the route OpenAPI spec; add a transitional `?await=true` query parameter that polls server-side for terminal state if any caller genuinely needs synchronous behaviour. **This is the most likely source of regressions.**
- **In-flight runs at deploy time**: agent runs that are already mid-handoff when the new code deploys will see partial behaviour. Mitigation: deploy is safe because (a) the new schema is additive, (b) the old synthetic path is removed atomically, (c) any pre-existing `completed` agent_runs with `iee_runs` still running are left alone — they're a one-time anomaly absorbed by reconciliation telemetry rather than corrected backwards.
- **pg-boss event delivery latency**: under load, `iee-run-completed` may take several seconds to deliver. Acceptable; reconciliation guarantees eventual convergence within 60–120 seconds in the worst case.
- **Heartbeat false positives**: if worker GC pauses or DB connection blips delay a heartbeat, reconciliation Class 3 may incorrectly fail a still-running run. Mitigation: 6x grace window (`HEARTBEAT_STALE_SECONDS = 180` vs 30s heartbeat cadence); plus a lower-bound on `startedAt` to avoid racing fresh runs.

### Decisions locked (2026-04-18)

The following five questions were raised during spec drafting and resolved before implementation begins. Recorded here for traceability.

1. **Worker-originated cancellation mapping** — `'cancelled'` on `agent_runs` is reserved for user-initiated cancellation. Worker-originated stoppage (shutdown drain, container eviction, orphan detection) maps to `'failed'` with `failureReason = 'worker_terminated'`. New TS union value added to `iee_runs.failureReason`; mapping row added to Appendix A.
2. **Token rollup** — included in Phase 0 core (Step 5). One extra SELECT per terminal transition; prevents visible regression in existing UI surfaces that read `agent_runs.{inputTokens, outputTokens, totalTokens, totalToolCalls}`.
3. **WebSocket progress bridge** — full streaming split into a follow-up ticket. Phase 0 ships a lightweight polling substitute (`GET /api/iee/runs/:ieeRunId/progress`) to prevent silent "Delegated" status confusion. Follow-up streaming ticket lands within one sprint of Phase 0.
4. **DLQ handling** — observability only. Reconciliation is the sole recovery path; the orphan scan finds terminal `iee_runs` with `eventEmittedAt IS NULL` regardless of whether the event DLQ'd or never fired. DLQ depth > 0 sustained over 5 minutes triggers alert but does not auto-recover.
5. **Cancellation latency** — accepted at next-step-boundary (typical 5–30s) or heartbeat-stale reconciliation (max 180s). Published as explicit SLA. Hard cancel via SIGTERM deferred; it requires per-task container isolation (separate initiative) because pg-boss concurrent workers share a process.

---

## Out of scope

These are deliberately deferred. Each is called out so that scope creep into Phase 0 is rejected with a pointer.

- **`ExecutionBackend` adapter contract** — Phase 1. This spec deliberately keeps the IEE branch in `agentExecutionService` rather than refactoring to an adapter. Doing both at once couples a refactor to a behaviour fix and makes the diff much harder to review.
- **OpenClaw worker** — Phase 1+. Out of scope until the lifecycle pattern is proven with IEE.
- **Routing policy + visibility page** — Phase 2.
- **Budget-governed fallback + cost transparency surface** — Phase 3.
- **Thin Mode / progressive abstraction** — Phase 4.
- **External worker (customer-hosted OpenClaw)** — Phase 5.
- **Backfilling cost / token attribution onto historical pre-fix `agent_runs`** — accept the one-time anomaly. Reconciliation telemetry surfaces it; we do not retroactively rewrite history.
- **Replacing pg-boss with a different queue / streaming substrate** — pg-boss is fine for the volume in question.

---

## Appendix A — Status mapping table

`iee_runs` terminal state → `agent_runs` terminal state:

| `iee_runs.status` | `iee_runs.failureReason` | `agent_runs.status` | Notes |
|---|---|---|---|
| `completed` | (any) | `completed` | Happy path. |
| `cancelled` | (any) | `cancelled` | User-initiated cancellation. New IEE status added in Step 8. |
| `failed` | `worker_terminated` | `failed` | **Worker-originated stoppage** (shutdown drain, container eviction, orphan detection). Distinct from user cancel per decision 1. New `failureReason` value. |
| `failed` | `timeout` | `timeout` | Maps to existing parent enum value. |
| `failed` | `budget_exceeded` | `budget_exceeded` | Maps to existing parent enum value. |
| `failed` | `step_limit_reached` | `loop_detected` | Closest existing parent semantic. |
| `failed` | `auth_failure` | `failed` | Generic terminal; `failureReason` carried in summary. |
| `failed` | `connector_timeout` | `failed` | Same. |
| `failed` | `rate_limited` | `failed` | Same. |
| `failed` | `data_incomplete` | `failed` | Same. |
| `failed` | `execution_error` | `failed` | Same. |
| `failed` | `environment_error` | `failed` | Same. |
| `failed` | `internal_error` | `failed` | Includes the heartbeat-stale path from reconciliation Class 3. |
| `failed` | `unknown` / `null` | `failed` | Defensive default. |

Mapping function shape:

```ts
function mapIeeStatusToAgentRunStatus(
  ieeStatus: 'completed' | 'failed' | 'cancelled',
  failureReason: string | null,
): 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' {
  if (ieeStatus === 'completed') return 'completed';
  if (ieeStatus === 'cancelled') return 'cancelled';
  switch (failureReason) {
    case 'timeout':            return 'timeout';
    case 'budget_exceeded':    return 'budget_exceeded';
    case 'step_limit_reached': return 'loop_detected';
    default:                   return 'failed';
  }
}
```

---

## Appendix B — File inventory

Files this spec touches. Use this as the diff scope check before opening a PR.

**Modified:**
- `server/db/schema/agentRuns.ts` (extend status union)
- `server/db/schema/ieeRuns.ts` (extend status union for `cancelled`; extend failureReason union for `worker_terminated`)
- `server/services/agentExecutionService.ts` (replace synthetic completion)
- `server/services/ieeUsageService.ts` (surface `delegated` count + stuck metric)
- `server/routes/iee.ts` (add progress polling endpoint)
- `server/jobs/index.ts` (register new handler + cron)
- `server/routes/agentRuns.ts` (cancellation handler writes to both rows)
- `worker/src/handlers/runHandler.ts` (per-step cancel check; emit `worker_terminated` on shutdown drain)
- `architecture.md` (execution-mode section)
- `docs/openclaw-strategic-analysis.md` (mark Phase 0 complete on landing)
- `client/src/lib/agentRunStatus.ts` or equivalent (add `delegated` label/colour)
- `client/src/pages/AgentRunDetailPage.tsx` or equivalent (delegated UI treatment, progress polling)

**Created:**
- `server/jobs/ieeRunCompletedHandler.ts` (event handler)
- `server/services/agentRunFinalizationService.ts` (shared finalisation logic + status mapping)
- `server/services/__tests__/agentRunFinalizationServicePure.test.ts` (pure tests)
- `server/services/__tests__/agentRunDelegationFlow.test.ts` (integration tests)

**Deleted:** none.

**Migrations:** none. All schema changes are TS-union extensions on existing `text` columns; `npm run db:generate` should produce no diff.

