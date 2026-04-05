# Development Spec: Workflow Observability + Semantic Search / RAG Improvements

**Date:** 2026-04-05
**Status:** Implementation Spec
**Branch:** `claude/research-workflow-engines-gIb33`
**Classification:** Significant (multi-domain, new patterns, UI additions)

---

## Decision Summary

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Workflow engine migration (Temporal/Inngest) | **No** | pg-boss handles 14+ job types reliably; migration cost high for uncertain benefit; "just Postgres" is a feature |
| Workflow observability | **Yes -- build** | Biggest gap in current stack; data already exists in agentRuns/workflowRuns, just no UI |
| RAG improvements (4 phases) | **Yes -- build** | Clear, measurable retrieval improvements; no new infrastructure; builds on existing pgvector |

---

## Scope Overview

Two workstreams, six deliverables:

### Workstream A: Workflow Observability

| ID | Feature | New Pages | New API Routes | Schema Changes | Effort |
|----|---------|-----------|---------------|----------------|--------|
| A1 | Trace Chain View (multi-run handoff/sub-agent visualization) | Enhance `RunTraceViewerPage` | 1 new endpoint | None (uses existing parentRunId/handoffDepth) | Medium |
| A2 | Job Queue Health Dashboard | 1 new page: `JobQueueDashboardPage` | 2 new endpoints | None (queries pg-boss tables) | Medium |
| A3 | Declarative Job Configuration | None | None | None (refactor only) | Low |

### Workstream B: Semantic Search / RAG

| ID | Feature | New Pages | New API Routes | Schema Changes | Effort |
|----|---------|-----------|---------------|----------------|--------|
| B1 | Contextual Retrieval | None | None | 1 new column | Medium |
| B2 | Hybrid Search (RRF) | Enhance `WorkspaceMemoryPage` | None | 1 new column + index + trigger | Medium |
| B3 | Cross-Encoder Reranking | None | None | None | Low |
| B4 | Query Expansion (HyDE) | None | None | None | Low |

### UI Additions Summary

| Page | Change Type | What |
|------|-------------|------|
| `RunTraceViewerPage` | Enhance | Add trace chain sidebar, parent/child navigation, chain timeline |
| `JobQueueDashboardPage` | New page | Queue health metrics, DLQ inspector, job search |
| `WorkspaceMemoryPage` | Enhance | Add search diagnostics tab, hybrid search toggle, retrieval quality indicators |
| `DashboardPage` | Enhance | Add queue health summary card, memory health summary card |
| Sidebar navigation | Enhance | Add Job Queue link under admin section |

---

## Architecture Constraints

All changes must follow these existing patterns (from `architecture.md` and `CLAUDE.md`):

**Server:**
- Routes call services only -- never access `db` directly
- `asyncHandler` wraps every async handler
- Service errors throw as `{ statusCode, message, errorCode? }`
- `resolveSubaccount(subaccountId, orgId)` in every `:subaccountId` route
- Auth middleware: `authenticate` first, then permission guards
- Org scoping: filter by `organisationId` using `req.orgId`
- Schema changes via Drizzle migrations only

**Client:**
- Lazy loading via `React.lazy()` with `Suspense` + `PageLoader` fallback
- Permissions-driven UI gated by role checks
- Real-time updates via `useSocket` / `useSocketRoom`
- Custom SVG charts (no external chart library)
- Tailwind CSS for styling

**Queue system:**
- pg-boss singleton via `server/lib/pgBossInstance.ts`
- Job config centralised in `server/config/jobConfig.ts`
- Tiered retry policies (Tier 1: agent execution, Tier 2: financial, Tier 3: maintenance)
- DLQ pattern with `__dlq` suffix per queue

---

## Execution Order

```
Phase 1 (parallel):  B1 Contextual Retrieval  +  B2 Hybrid Search
Phase 2:             A1 Trace Chain View
Phase 3:             A2 Job Queue Dashboard  +  A3 Declarative Config
Phase 4:             B3 Reranking  +  B4 HyDE
```

B1+B2 first because they deliver the highest measurable impact. A1 next because trace data already exists. A2+A3 and B3+B4 are refinements.

---

## Dependencies

```
B1 (Contextual Retrieval)  ──→  B3 (Reranking uses B1's improved embeddings)
B2 (Hybrid Search)         ──→  B3 (Reranking over-retrieves from hybrid results)
B3 (Reranking)             ──→  B4 (HyDE addresses remaining short-query gap)
A1 (Trace Chain)           ──→  A2 (Dashboard can link to trace chains)
A3 (Declarative Config)    ──  independent, can ship anytime
```

---

## Feature A1: Trace Chain View

### Problem

The existing `RunTraceViewerPage` (`client/src/pages/RunTraceViewerPage.tsx`, 380 lines) shows excellent single-run detail -- status, duration, tokens, tool calls timeline, system prompt snapshot, memory state, error details. But it has no awareness of run relationships.

When an agent schedules a handoff (depth 1 -> 2 -> 3), or spawns sub-agents, or triggers a subtask wakeup that fires the orchestrator, each run is an isolated view. There is no way to see:
- The full chain of runs that constitute a workflow
- Which run triggered which
- Where in the chain a failure occurred
- Total cost/tokens/duration across the chain

The data already exists in `agent_runs`:
- `parentRunId` (UUID FK) -- direct parent in handoff chain
- `handoffDepth` (int) -- depth in handoff sequence
- `parentSpawnRunId` (UUID FK) -- parent that spawned a sub-agent
- `isSubAgent` (boolean) -- whether this run is a sub-agent
- `runSource` (enum: `scheduler|manual|trigger|handoff|sub_agent|system`)

### Solution

Enhance `RunTraceViewerPage` with a trace chain panel that reconstructs and visualises the full execution tree.

### Server Changes

#### New endpoint: `GET /api/agent-runs/:runId/chain`

**File:** `server/routes/agentRuns.ts`
**Auth:** `authenticate`, org-scoped (filter by `req.orgId`)

**Service method:** `agentActivityService.getRunChain(runId, orgId)`

**Logic:**
1. Load the target run
2. Walk UP: follow `parentRunId` recursively to find the root run (max 10 hops, safety bound)
3. Walk DOWN from root: query all runs where `parentRunId` or `parentSpawnRunId` equals any run in the chain
4. Return flat array of chain runs, each with:

```typescript
interface ChainRun {
  id: string;
  parentRunId: string | null;
  parentSpawnRunId: string | null;
  isSubAgent: boolean;
  handoffDepth: number;
  runSource: string;
  runType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded';
  agentName: string;        // joined from agents table
  subaccountName: string;   // joined from subaccounts table
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalToolCalls: number | null;
  errorMessage: string | null;
  triggerContext: object | null;
}
```

**Query strategy:** Two queries max:
1. Recursive CTE walking `parentRunId` up to root
2. Single query: `WHERE parentRunId IN (:chainIds) OR parentSpawnRunId IN (:chainIds)` to get all descendants

**Index note:** Both `parentRunId` and `parentSpawnRunId` already have B-tree indexes (`agent_runs_parent_run_id_idx`, `agent_runs_parent_spawn_run_id_idx`) in the schema. No migration needed -- chain traversal is index-backed.

**Graph integrity safeguards:**

The upward/downward traversal must handle corrupted data gracefully:

```typescript
const visited = new Set<string>();
const MAX_CHAIN_NODES = 50;  // hard cap on total nodes

async function walkUp(runId: string): Promise<string[]> {
  const chain: string[] = [];
  let current = runId;

  while (current && chain.length < MAX_CHAIN_NODES) {
    if (visited.has(current)) break;  // cycle guard
    visited.add(current);
    chain.unshift(current);

    const run = await getRun(current);
    if (!run || !run.parentRunId) break;
    current = run.parentRunId;
  }

  return chain;
}
```

The response includes metadata about chain completeness:

```typescript
interface ChainResponse {
  runs: ChainRun[];
  metadata: {
    rootRunId: string;
    totalNodes: number;
    isComplete: boolean;     // false if truncated or missing parents
    truncated: boolean;
    truncationReason?: 'cycle' | 'depth_limit' | 'missing_parent';
  };
}
```

This prevents silent corruption in the UI -- the sidebar can show a warning badge when `isComplete: false`.

**Performance:** Chain depth is bounded by `MAX_HANDOFF_DEPTH = 5` and sub-agent spawns are typically 1-2 levels. Total chain size should be < 20 runs. Hard cap at 50 nodes prevents runaway traversals. No pagination needed.

#### New endpoint: `GET /api/agent-runs/:runId/related-workflows`

**File:** `server/routes/agentRuns.ts`

**Logic:** If any run in the chain has an associated `workflow_run` (via `workflow_step_outputs.agentRunId`), return the workflow run metadata (status, currentStepIndex, checkpoint state). This connects HITL workflow pause/resume to the trace view.

```typescript
interface RelatedWorkflow {
  workflowRunId: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  checkpoint: object | null;
  startedAt: string | null;
  completedAt: string | null;
}
```

### Client Changes

#### Enhanced `RunTraceViewerPage`

**File:** `client/src/pages/RunTraceViewerPage.tsx`

**Layout change:** Add a collapsible left sidebar (280px) for the chain view. The existing run detail becomes the main content area. Clicking a run in the chain loads its detail.

**New components:**

**`TraceChainSidebar`** (new file: `client/src/components/TraceChainSidebar.tsx`)

```
┌─────────────────────────────────────────────┐
│ Trace Chain                          [collapse] │
│                                                  │
│ Total: 4 runs · 12.4s · 8,421 tokens            │
│ Critical path: 10.6s (longest sequential chain)  │
│                                                  │
│ ● Scheduler trigger                    10:04:02  │
│ ├─ ✓ Lead Qualifier (depth 0)    3.2s   2,100t  │
│ │  └─ ✓ Sub: Data Enricher      1.8s   1,200t  │
│ ├─ ✓ Handoff: Outreach (depth 1) 4.1s  3,100t  │
│ └─ ✗ Handoff: Closer (depth 2)   3.3s  2,021t  │
│       └─ Error: Budget exceeded                  │
│                                                  │
│ ─── Workflow: Order Pipeline ───                 │
│ Step 3/5 · Paused (awaiting approval)            │
└─────────────────────────────────────────────┘
```

Visual elements:
- Tree structure using CSS border-left lines with indentation per depth
- Status icons: `✓` completed (green), `✗` failed (red), `◐` running (blue pulse), `○` pending (grey), `⏸` paused (amber)
- Currently selected run highlighted with indigo background
- Aggregate stats at top: total runs, total duration, total tokens, critical path duration
- **Critical path duration:** The longest sequential chain through the tree (sum of durations along the path from root to deepest leaf, excluding parallel sub-agents). This shows the real wall-clock bottleneck -- parallel sub-agents inflate total duration but don't affect critical path. Computed client-side from the chain data.
- Workflow section at bottom (only shown if related workflows exist)
- Click any run to load its detail in the main panel (client-side navigation, no page reload)

**`TraceChainTimeline`** (new file: `client/src/components/TraceChainTimeline.tsx`)

Horizontal Gantt-style bar chart showing temporal overlap of runs:

```
Lead Qualifier   |████████░░░░░░░░░░░░|
  Data Enricher  |░░░░████░░░░░░░░░░░░|
Outreach Agent   |░░░░░░░░██████████░░|
Closer Agent     |░░░░░░░░░░░░░████✗░░|
                  0s        5s       10s
```

- Custom SVG (follows existing chart pattern in `ActivityCharts.tsx`)
- Bars coloured by status (green/red/blue/grey)
- Hover tooltip: run name, duration, tokens, status
- Failure point marked with `✗`
- Only rendered when chain has 2+ runs

**Real-time updates:**
- When viewing a chain with `running` status runs, join WebSocket room `agent-run:{runId}` for each active run
- Update status/duration/tokens in real-time as runs progress
- Use existing `useSocketRoom` pattern from `AgentChatPage`

### Verification

- [ ] Chain endpoint returns correct tree for handoff chain (depth 0 -> 1 -> 2)
- [ ] Chain endpoint returns correct tree for sub-agent spawns
- [ ] Chain endpoint handles orphaned runs (parentRunId points to deleted run) -- returns `isComplete: false, truncationReason: 'missing_parent'`
- [ ] Chain endpoint detects cycles (corrupted parentRunId loop) -- returns `truncationReason: 'cycle'`
- [ ] Chain endpoint enforces 50-node hard cap -- returns `truncated: true, truncationReason: 'depth_limit'`
- [ ] Chain endpoint respects org scoping (cannot view other org's runs)
- [ ] Sidebar renders tree with correct indentation and status icons
- [ ] Clicking a run in sidebar loads its detail without page reload
- [ ] Timeline SVG renders correct temporal positioning
- [ ] Real-time updates work for in-progress chains
- [ ] Related workflows section appears when HITL workflow is linked
- [ ] Performance: chain endpoint < 50ms for typical chains (< 20 runs)

---

## Feature A2: Job Queue Health Dashboard

### Problem

pg-boss stores complete job state in Postgres tables, but we have no visibility into queue health beyond structured logs and DLQ monitoring. When jobs back up, fail silently, or hit DLQ, the only way to investigate is querying pg-boss tables directly.

The existing `SystemTaskQueuePage` handles manual task management, not queue observability. There is no view showing: queue depths, processing rates, retry rates, DLQ accumulation, or job search.

### Solution

New admin page showing real-time queue health metrics with DLQ inspection and job search.

### Server Changes

#### New service: `server/services/jobQueueHealthService.ts`

**Methods:**

**`getQueueSummaries(orgId?: string)`**

Queries pg-boss internal tables to return per-queue health:

```typescript
interface QueueSummary {
  queue: string;
  tier: 'agent_execution' | 'financial' | 'maintenance';
  active: number;       // currently being processed
  pending: number;      // waiting for a worker
  completed: number;    // last 24h
  failed: number;       // last 24h
  dlqDepth: number;     // total in DLQ queue
  avgDurationMs: number | null;  // last 24h completed
  retryRate: number;    // % of completed that required retries (last 24h)
  oldestPendingAge: number | null;  // ms since oldest pending job created
}
```

**Live counts** (active, pending, DLQ depth): Use pg-boss's `getQueueSize()` -- these are cheap and always current.

**Historical aggregates** (completed, failed, avg duration, retry rate): Querying the raw `pgboss.job` table for 24h aggregates will become expensive under load. Use a rolling aggregates table instead:

**Migration:** `migrations/0056_job_queue_stats.sql`

```sql
CREATE TABLE job_queue_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 5,  -- 5-minute buckets
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  UNIQUE(queue, window_start)
);

CREATE INDEX idx_job_queue_stats_queue_window
  ON job_queue_stats (queue, window_start DESC);
```

**Write-time aggregation:** Add a lightweight hook in `createWorker()` that increments the current 5-minute bucket on job completion/failure:

```typescript
// In createWorker(), after handler completes:
await upsertQueueStat(options.queue, {
  completed: success ? 1 : 0,
  failed: success ? 0 : 1,
  retried: retryCount > 0 ? 1 : 0,
  durationMs,
});
```

**Dashboard reads from `job_queue_stats`**, not raw pg-boss tables. Sum buckets for the last 24h (288 rows per queue). This is a constant-time query regardless of job volume.

**Cleanup:** Add a maintenance job to prune stats older than 7 days (runs daily with existing maintenance tier).

**`getDlqJobs(queue: string, limit: number, offset: number)`**

Returns paginated DLQ entries for a specific queue:

```typescript
interface DlqJob {
  id: string;
  queue: string;        // source queue (strip __dlq suffix)
  createdAt: string;
  completedAt: string;  // when it landed in DLQ
  data: object;         // job payload (truncated to 5KB for display)
  orgId: string | null;
  agentId: string | null;
  subaccountId: string | null;
  errorSummary: string | null;  // extracted from data if available
}
```

**`searchJobs(filters: JobSearchFilters)`**

Search across all queues with filters:

```typescript
interface JobSearchFilters {
  queue?: string;
  state?: 'created' | 'active' | 'completed' | 'failed';
  orgId?: string;
  agentId?: string;
  since?: string;       // ISO timestamp
  until?: string;       // ISO timestamp
  limit: number;        // default 50, max 200
  offset: number;
}
```

#### New routes: `server/routes/jobQueue.ts`

**Auth:** All endpoints require `authenticate` + `requireSystemAdmin`

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/api/system/job-queues` | `getQueueSummaries()` |
| `GET` | `/api/system/job-queues/:queue/dlq` | `getDlqJobs(queue, limit, offset)` |
| `GET` | `/api/system/job-queues/search` | `searchJobs(filters)` |

Route file follows existing pattern: `asyncHandler`, no direct DB access, thin wrapper around service.

### Client Changes

#### New page: `client/src/pages/JobQueueDashboardPage.tsx`

**Route:** `/system/job-queues`
**Guard:** `SystemAdminGuard`
**Lazy import** in `App.tsx`

**Layout (three sections):**

**Section 1: Queue Health Cards**

Grid of cards (one per queue), grouped by tier with tier headers:

```
── Agent Execution ──────────────────────────────────────────

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ agent-scheduled-run  │  │ agent-handoff-run    │  │ agent-triggered-run  │
│                      │  │                      │  │                      │
│ Pending: 3           │  │ Pending: 0           │  │ Pending: 1           │
│ Active:  2           │  │ Active:  1           │  │ Active:  0           │
│ Failed (24h): 5      │  │ Failed (24h): 0      │  │ Failed (24h): 2      │
│ DLQ: 2 ⚠            │  │ DLQ: 0               │  │ DLQ: 0               │
│ Avg: 4.2s            │  │ Avg: 2.1s            │  │ Avg: 3.8s            │
│ Retry rate: 8%       │  │ Retry rate: 0%       │  │ Retry rate: 12%      │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘

── Financial ────────────────────────────────────────────────
...
── Maintenance ──────────────────────────────────────────────
...
```

- Cards use colour-coded borders: green (healthy), amber (DLQ > 0 or retry rate > 15%), red (pending > 10 or failed > 20)
- DLQ count shown with warning icon when > 0
- Click card to filter job search to that queue

**Section 2: DLQ Inspector**

Expandable panel showing DLQ jobs for a selected queue:

```
┌──────────────────────────────────────────────────────────────────┐
│ DLQ: agent-scheduled-run (2 jobs)                    [Clear All] │
│                                                                   │
│ ┌─ Job abc123 · 2h ago ─────────────────────────────────────┐   │
│ │ Org: Acme Corp · Agent: Lead Qualifier · Sub: Client A     │   │
│ │ Error: Run terminated: no activity detected                │   │
│ │ [View Payload]  [View Run Trace]  [Retry]                  │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│ ┌─ Job def456 · 5h ago ─────────────────────────────────────┐   │
│ │ Org: Beta Inc · Agent: Outreach · Sub: Client B            │   │
│ │ Error: Budget exceeded                                     │   │
│ │ [View Payload]  [View Run Trace]  [Retry]                  │   │
│ └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

- Payload shown in collapsible JSON viewer (truncated to 5KB)
- "View Run Trace" links to `RunTraceViewerPage` if run ID is in payload
- "Retry" re-enqueues the job to the source queue with idempotency safeguards:
  - Confirmation dialog with warning: "Retrying may cause duplicate side effects if the original job partially completed. Proceed?"
  - If the job payload contains an `idempotencyKey`, check whether a completed job with that key already exists before re-enqueuing
  - If a matching completed job is found, show an additional warning: "A job with this idempotency key already completed. Retry anyway?"
  - **Soft lock on repeated failures:** If the same job has been retried from DLQ more than 2 times (track via a `dlq_retry_count` field in the job payload), disable the retry button and show "Max retries exhausted -- manual investigation required". This prevents retry hammering on fundamentally broken jobs.
- Pagination: 20 per page

**Section 3: Job Search**

Filter bar + results table:

```
Queue: [all ▼]  State: [all ▼]  Since: [____]  Until: [____]  [Search]

| Queue                  | State     | Created         | Duration | Org          | Agent           |
|------------------------|-----------|-----------------|----------|--------------|-----------------|
| agent-scheduled-run    | completed | 10:04:02 today  | 4.2s     | Acme Corp    | Lead Qualifier  |
| agent-handoff-run      | failed    | 10:04:06 today  | 3.3s     | Acme Corp    | Closer          |
| llm-aggregate-update   | completed | 10:05:01 today  | 0.1s     | Beta Inc     | --              |
```

- Sortable columns (click header)
- Click row to expand job detail (payload, error, retry count)
- Link to run trace when applicable
- 50 results per page with offset pagination

#### Sidebar navigation update

**File:** `client/src/components/Layout.tsx`

Add "Job Queues" link under System Admin section, between "Activity" and "Task Queue":
- Icon: queue/stack icon (custom SVG)
- Path: `/system/job-queues`
- Visible only to system_admin role

#### Dashboard summary card

**File:** `client/src/pages/DashboardPage.tsx`

Add a small "Queue Health" card (system admin only) showing:
- Total pending jobs across all queues
- Total DLQ depth
- Colour: green/amber/red based on thresholds

### Auto-refresh

- Queue summaries poll every 30 seconds (or WebSocket push if we add queue events later)
- DLQ and search results are on-demand (manual refresh button)

### Verification

- [ ] Queue summaries return correct counts for all 14 queues
- [ ] DLQ inspector shows jobs with correct source queue attribution
- [ ] Job search filters by queue, state, and date range correctly
- [ ] Retry from DLQ re-enqueues to correct source queue
- [ ] System admin guard prevents non-admin access
- [ ] Dashboard summary card shows correct aggregate counts
- [ ] Auto-refresh updates queue cards every 30s
- [ ] Performance: queue summaries endpoint < 100ms

---

## Feature A3: Declarative Job Configuration

### Problem

`server/config/jobConfig.ts` already centralises job configuration (retry counts, backoff, expiration, DLQ mapping), but each worker registration in `agentScheduleService.ts` and `queueService.ts` still manually wires retry logic, timeout wrapping, error classification, and DLQ routing. This leads to boilerplate duplication across 14+ queue handlers.

### Solution

Extract a `createWorker()` utility that reads from `jobConfig.ts` and automatically applies the configured retry policy, timeout, error classification, and DLQ routing.

### Server Changes

#### New utility: `server/lib/createWorker.ts`

```typescript
import { getJobConfig } from '../config/jobConfig.js';
import { withTimeout } from './jobErrors.js';
import { isNonRetryable, isTimeoutError, getRetryCount } from './jobErrors.js';

interface WorkerOptions<T> {
  queue: string;
  handler: (job: PgBoss.Job<T>) => Promise<void>;
  boss: PgBoss;
  logger: Logger;
  concurrency?: number;  // override from env default
}

export function createWorker<T>(options: WorkerOptions<T>) {
  const config = getJobConfig(options.queue);

  return options.boss.work<T>(
    options.queue,
    {
      teamSize: options.concurrency ?? parseInt(process.env.QUEUE_CONCURRENCY ?? '2'),
      teamConcurrency: 1,
    },
    async (job) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        options.logger.warn('job_retry', { queue: options.queue, jobId: job.id, retryCount });
      }

      try {
        await withTimeout(
          () => options.handler(job),
          config.timeoutMs
        );
      } catch (err: any) {
        if (isNonRetryable(err)) {
          options.logger.error('job_non_retryable', { queue: options.queue, jobId: job.id, error: err.message });
          await options.boss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          options.logger.error('job_timeout', { queue: options.queue, jobId: job.id, timeoutMs: config.timeoutMs });
        }
        throw err; // pg-boss handles retry/DLQ
      }
    }
  );
}
```

#### Refactor existing workers

Replace manual retry/timeout/error-classification boilerplate in:
- `server/services/agentScheduleService.ts` (5 workers)
- `server/services/queueService.ts` (3 workers)

Each worker registration reduces from ~30 lines to ~5 lines:

```typescript
// Before (30 lines of boilerplate per worker)
boss.work(QUEUE, { teamSize, teamConcurrency: 1 }, async (job) => {
  const retryCount = getRetryCount(job);
  if (retryCount > 0) logger.warn(...);
  try {
    await withTimeout(async () => { /* handler */ }, 270_000);
  } catch (err) {
    if (isNonRetryable(err)) { await boss.fail(job.id); return; }
    if (isTimeoutError(err)) { logger.error(...); }
    throw err;
  }
});

// After (5 lines)
createWorker({
  queue: QUEUE,
  boss,
  logger,
  handler: async (job) => { /* handler only */ },
});
```

#### Enhanced `jobConfig.ts`

Add `timeoutMs` to each job config entry (currently timeout is set per-worker, not in config):

```typescript
// Add to each job config
'agent-scheduled-run': {
  retryLimit: 2,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 300,
  timeoutMs: 270_000,    // NEW: worker timeout
  deadLetter: 'agent-scheduled-run__dlq',
},
```

### Verification

- [ ] All existing workers use `createWorker()` with identical behaviour
- [ ] Retry policies, timeouts, DLQ routing unchanged (no behaviour change)
- [ ] `npm test` passes with no regressions
- [ ] New worker registration requires only queue name + handler function
- [ ] jobConfig.ts is the single source of truth for all job parameters

---

## Feature B1: Contextual Retrieval

### Problem

When memory entries are extracted from agent runs, they are embedded as isolated facts:

> "Client prefers weekly email updates on Tuesdays"

The embedding captures the semantic meaning but lacks context about where this insight came from, what agent discovered it, or what task it relates to. This means the embedding for "client prefers weekly updates" won't surface when searching for "communication preferences for the onboarding workflow."

Anthropic's research on contextual retrieval shows that prepending a short context sentence to chunks before embedding improves retrieval accuracy by 5-7 percentage points with zero per-query overhead.

### Solution

Before generating embeddings for new memory entries, generate a contextual prefix using the agent run's full context, then embed `context + content` instead of just `content`.

### Server Changes

#### New column: `embedding_context`

**Migration:** `migrations/0054_contextual_retrieval.sql`

```sql
ALTER TABLE workspace_memory_entries
  ADD COLUMN embedding_context TEXT;

ALTER TABLE org_memory_entries
  ADD COLUMN embedding_context TEXT;
```

This stores the generated context prefix so we can re-embed without re-generating context. Nullable -- existing entries will have `NULL` until backfilled.

#### Schema update: `server/db/schema/workspaceMemories.ts`

Add `embeddingContext` column to `workspaceMemoryEntries`:

```typescript
embeddingContext: text('embedding_context'),
```

Same for `server/db/schema/orgMemories.ts`.

#### Modified: `server/services/workspaceMemoryService.ts`

**In `extractRunInsights()` (around line 161):**

After the LLM extracts insights and before embedding, add a context generation step:

```typescript
async function generateEmbeddingContexts(
  entries: ExtractedEntry[],
  runSummary: string,
  agentName: string,
  taskTitle: string | null
): Promise<Map<string, string>> {
  // Batch all entries in a single LLM call for efficiency
  const prompt = `You are generating short context prefixes for memory entries to improve search retrieval.

Agent: ${agentName}
Task: ${taskTitle ?? 'General'}
Run Summary: ${runSummary}

For each memory entry below, write a 1-2 sentence context that situates the entry within the broader context of this agent run. The context should help retrieval by mentioning the agent, task, domain, and any relevant keywords not in the entry itself.

Entries:
${entries.map((e, i) => `${i + 1}. [${e.entryType}] ${e.content}`).join('\n')}

Respond with a JSON array of context strings, one per entry. Each context should be under 100 words.`;

  // Single LLM call, use prompt caching for runSummary
  const result = await llmRouter.chat({ ... });
  // Parse JSON array, return Map<entryIndex, context>
}
```

**Key design decisions:**
- Single LLM call per batch (not per entry) -- cost efficient
- Context stored in `embedding_context` column for reproducibility
- Embedding input becomes: `${context}\n\n${content}`
- The `content` column is NOT modified -- agents see the original text
- **Decoupled from ingestion path** -- context generation must NOT block memory insertion

**Two-phase write pattern (critical for production reliability):**

Context generation adds an LLM dependency to the ingestion path. If this fails or slows down, the entire memory system backs up. Instead, use a two-phase write:

```
Phase 1 (synchronous, in extractRunInsights):
  → Insert memory entry immediately
  → Generate embedding from content-only (as today)
  → Memory is searchable immediately

Phase 2 (async job, non-blocking):
  → Enqueue 'memory-context-enrichment' job per batch
  → Job generates contexts via LLM
  → Job updates embedding_context column
  → Job re-generates embeddings with context prefix
  → If job fails, entry remains searchable with content-only embedding
```

```typescript
// In extractRunInsights(), after inserting entries:
// Job-level dedup key prevents duplicate enrichment during ingestion spikes
const jobKey = `ctx-enrich:${insertedIds.sort().join(',')}`;
await pgBossSend('memory-context-enrichment', {
  entryIds: insertedIds,
  runSummary,
  agentName,
  taskTitle,
}, { singletonKey: jobKey });
```

**New job: `memory-context-enrichment`**

Add to `server/config/jobConfig.ts`:

```typescript
'memory-context-enrichment': {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 120,
  timeoutMs: 90_000,
},
```

**Backpressure protection:** Ingestion spikes can flood this queue and hit LLM rate limits. Add concurrency cap:

```typescript
// In worker registration -- limit to 3 concurrent enrichment jobs
// This bounds LLM API pressure regardless of ingestion rate
createWorker({
  queue: 'memory-context-enrichment',
  boss,
  logger,
  concurrency: 3,  // hard cap: max 3 concurrent enrichment jobs
```

Worker registered in `queueService.ts` (or `agentScheduleService.ts`):

```typescript
createWorker({
  queue: 'memory-context-enrichment',
  boss,
  logger,
  concurrency: 3,
  handler: async (job) => {
    const { entryIds, runSummary, agentName, taskTitle } = job.data;
    const entries = await loadEntries(entryIds);
    const contexts = await generateEmbeddingContexts(entries, runSummary, agentName, taskTitle);

    for (const [entryId, context] of contexts) {
      const entry = entries.find(e => e.id === entryId);

      // Idempotency guard: skip entries already enriched (handles retries + duplicate jobs)
      if (entry.embeddingContext) continue;

      const embeddingInput = `${context}\n\n${entry.content}`;

      // Guard: cap embedding input size
      const trimmedInput = embeddingInput.slice(0, MAX_EMBEDDING_INPUT_CHARS);

      const embedding = await generateEmbedding(trimmedInput);

      // Conditional update: only write if still NULL (race condition guard)
      await db.update(workspaceMemoryEntries)
        .set({ embeddingContext: context, embedding: formatVectorLiteral(embedding) })
        .where(and(
          eq(workspaceMemoryEntries.id, entryId),
          isNull(workspaceMemoryEntries.embeddingContext)  // CAS guard
        ));
    }
  },
});
```

This gives: zero ingestion latency impact, retryability, isolation from LLM failures.

**Embedding input size guard:**

Concatenating context + content can produce unexpectedly long inputs. Add a hard cap:

```typescript
// In server/config/limits.ts
export const MAX_EMBEDDING_INPUT_CHARS = 2000;  // Cap before sending to embedding API
```

The existing `generateEmbedding()` already slices to 8192 chars, but 2000 is a tighter bound that prevents inconsistent embeddings from overly long inputs. If `context + content` exceeds 2000 chars, trim the context (not the content).

#### Backfill job: `server/jobs/contextualRetrievalBackfillJob.ts`

One-time job to generate contexts and re-embed existing entries:

```typescript
// Process in batches of 50 entries
// For each batch:
//   1. Load entries with their associated run summaries (via agentRuns join)
//   2. Generate contexts via LLM
//   3. Update embedding_context column
//   4. Re-generate embeddings with context prefix
//   5. Update embedding column
// Rate limit: 10 batches/minute to avoid LLM API throttling
// Idempotent: skip entries where embedding_context IS NOT NULL
```

Register as a one-time pg-boss job, triggered manually from admin or via API.

#### Apply same pattern to org memory

Mirror changes in `server/services/orgMemoryService.ts` for `writeEntry()`.

### Verification

- [ ] New entries get embedding_context generated before embedding
- [ ] Embedding input is `context + content`, not just content
- [ ] Content column unchanged (agents see original text)
- [ ] Graceful degradation when context generation fails
- [ ] Backfill job processes existing entries in batches without timeout
- [ ] Backfill is idempotent (skips already-contextualised entries)
- [ ] Org memory entries also get contextual retrieval
- [ ] `npm run typecheck` passes with new column
- [ ] Migration applies cleanly

---

## Feature B2: Hybrid Search (Reciprocal Rank Fusion)

### Problem

Memory retrieval currently uses vector-only search with a combined scoring formula (60% cosine + 25% quality + 15% recency). This misses exact keyword matches -- if a memory entry contains "Stripe API key rotation" and the query is "Stripe API key", the vector similarity may rank it lower than a semantically similar but lexically different entry.

Research shows pure vector search achieves ~62% retrieval precision; adding keyword search with RRF fusion improves it to ~84%.

BM25 via wink-bm25-text-search exists but is only used for tool discovery (`server/tools/meta/searchTools.ts`), not memory retrieval. It runs in-memory, is rebuilt on restart, and cannot participate in SQL queries.

### Solution

Add Postgres full-text search (tsvector/tsquery) to workspace memory entries and combine with pgvector cosine similarity using Reciprocal Rank Fusion (RRF) in a single SQL query.

### Server Changes

#### Migration: `migrations/0055_hybrid_search.sql`

```sql
-- Add tsvector column with auto-update trigger
ALTER TABLE workspace_memory_entries
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;

CREATE INDEX idx_workspace_memory_entries_tsv
  ON workspace_memory_entries USING GIN (tsv);

-- Same for org memory
ALTER TABLE org_memory_entries
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;

CREATE INDEX idx_org_memory_entries_tsv
  ON org_memory_entries USING GIN (tsv);
```

Using `GENERATED ALWAYS AS ... STORED` means no application-side trigger management. Postgres auto-populates on INSERT/UPDATE. Existing rows are backfilled automatically by the ALTER.

#### Schema update: `server/db/schema/workspaceMemories.ts`

```typescript
// tsvector is managed by Postgres generated column; Drizzle treats it as read-only
// No need to define it in the insert schema, but expose for raw SQL queries
```

Note: Drizzle ORM does not natively support `tsvector` type. The column is managed entirely in SQL. The hybrid search query will use raw SQL via `db.execute()`.

#### Modified: `server/services/workspaceMemoryService.ts`

**Replace `getRelevantMemories()` (around line 399) with hybrid search:**

```typescript
async function getRelevantMemories(
  workspaceId: string,
  queryEmbedding: number[],
  queryText: string,        // NEW: raw text for full-text search
  options: {
    taskSlug?: string;
    qualityThreshold?: number;
    limit?: number;
  }
): Promise<MemoryResult[]> {
  const {
    taskSlug,
    qualityThreshold = 0.5,
    limit = VECTOR_SEARCH_LIMIT,  // 5
  } = options;

  const overRetrieveLimit = limit * 4;  // Retrieve 20 from each source for RRF

  // Guard: check if queryText produces a valid tsquery (stopword-only queries produce empty tsquery)
  // If empty, skip fulltext CTE entirely and use semantic-only retrieval
  const tsqueryCheck = await db.execute(
    sql`SELECT plainto_tsquery('english', ${queryText})::text AS q`
  );
  const hasValidTsquery = tsqueryCheck.rows[0]?.q && tsqueryCheck.rows[0].q !== '';

  // Hard cap on query duration to prevent slow queries blocking the request thread.
  // SET LOCAL scopes to the current transaction only.
  await db.execute(sql`SET LOCAL statement_timeout = '200ms'`);

  const result = await db.execute(sql`
    WITH semantic AS (
      SELECT
        id, content, entry_type, quality_score, created_at, last_accessed_at,
        (embedding <=> ${formatVectorLiteral(queryEmbedding)}::vector) AS cosine_dist,
        ROW_NUMBER() OVER (
          ORDER BY embedding <=> ${formatVectorLiteral(queryEmbedding)}::vector
        ) AS rank
      FROM workspace_memory_entries
      WHERE workspace_id = ${workspaceId}
        AND embedding IS NOT NULL
        AND quality_score >= ${qualityThreshold}
        AND (task_slug = ${taskSlug} OR task_slug IS NULL)
        AND created_at >= NOW() - INTERVAL '${VECTOR_SEARCH_RECENCY_DAYS} days'
      ORDER BY embedding <=> ${formatVectorLiteral(queryEmbedding)}::vector
      LIMIT ${overRetrieveLimit}
    ),
    -- Skip fulltext CTE if tsquery is empty (stopword-only queries like "the a an")
    -- Use conditional query building: if !hasValidTsquery, omit this CTE entirely
    fulltext AS (
      SELECT
        id, content, entry_type, quality_score, created_at, last_accessed_at,
        ts_rank_cd(tsv, plainto_tsquery('english', ${queryText})) AS ft_score,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', ${queryText})) DESC
        ) AS rank
      FROM workspace_memory_entries
      WHERE workspace_id = ${workspaceId}
        AND tsv @@ plainto_tsquery('english', ${queryText})
        AND quality_score >= ${qualityThreshold}
        AND (task_slug = ${taskSlug} OR task_slug IS NULL)
        AND created_at >= NOW() - INTERVAL '${VECTOR_SEARCH_RECENCY_DAYS} days'
      ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', ${queryText})) DESC
      LIMIT ${overRetrieveLimit}
    ),
    -- Use UNION ALL + GROUP BY instead of FULL OUTER JOIN for simpler execution plan
    -- and better scaling beyond 1k rows (avoids null merging, easier for planner)
    rrf_scores AS (
      SELECT id, 1.0 / (60 + rank) AS rrf_component FROM semantic
      UNION ALL
      SELECT id, 1.0 / (60 + rank) AS rrf_component FROM fulltext
    ),
    fused AS (
      SELECT
        r.id,
        SUM(r.rrf_component) AS rrf_score,
        COUNT(*) AS source_count  -- 2 = found by both pipelines
      FROM rrf_scores r
      GROUP BY r.id
    )
    SELECT
      f.id, cp.content, cp.entry_type, cp.quality_score, cp.created_at,
      f.rrf_score,
      f.source_count,
      -- Combined score: RRF (70%) + quality (15%) + recency (15%)
      f.rrf_score * 0.70
        + COALESCE(cp.quality_score, 0.5) * 0.15
        + (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - GREATEST(
            cp.created_at,
            COALESCE(cp.last_accessed_at, cp.created_at)
          ))) / 86400.0 / 30.0)) * 0.15 AS combined_score
    FROM fused f
    JOIN candidate_pool cp ON cp.id = f.id
    WHERE f.rrf_score >= ${RRF_MIN_SCORE}  -- floor: drop low-quality tail results
    ORDER BY combined_score DESC
    LIMIT ${limit}
  `);

  // Safety fallback: if RRF_MIN_SCORE filtering removed all results, fall back to
  // top semantic-only results rather than returning empty memory context
  if (result.rows.length === 0) {
    logger.warn('rrf_empty_after_filter', { workspaceId, queryLength: queryText.length });
    const fallback = await db.execute(sql`
      SELECT id, content, entry_type, quality_score, created_at,
        (embedding <=> ${formatVectorLiteral(queryEmbedding)}::vector) AS cosine_dist
      FROM candidate_pool
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${formatVectorLiteral(queryEmbedding)}::vector
      LIMIT ${limit}
    `);
    return fallback.rows.map(row => ({
      id: row.id, content: row.content, entryType: row.entry_type,
      rrf_score: null, combined_score: null, source_count: 0, confidence: 'low' as const,
    }));
  }

  return result.rows.map(row => ({
    id: row.id,
    content: row.content,
    entryType: row.entry_type,
    rrf_score: row.rrf_score,
    combined_score: row.combined_score,
    source_count: row.source_count,
    // Retrieval confidence based on source overlap (useful for agent decisioning)
    confidence: row.source_count >= 2 ? 'high'       // found by both pipelines
              : row.rrf_score > 0.01  ? 'medium'     // found by one with decent score
              :                         'low',
  }));
}
```

**Scoring weight change:**

| Component | Old Weight | New Weight | Rationale |
|-----------|-----------|-----------|-----------|
| Semantic similarity | 60% | -- (absorbed into RRF) | RRF handles fusion |
| Keyword match | 0% | -- (absorbed into RRF) | RRF handles fusion |
| RRF fusion score | N/A | 70% | Combines both signals |
| Quality score | 25% | 15% | Still important but RRF carries more signal |
| Recency decay | 15% | 15% | Unchanged |

**Note:** The similarity threshold (`VECTOR_SIMILARITY_THRESHOLD = 0.75`) is removed for RRF-based retrieval. RRF scores are not on a 0-1 cosine scale, so the old threshold doesn't apply. Instead, we rely on the `LIMIT` to control result count.

**Scaling safeguard: candidate pool hard cap**

The FULL OUTER JOIN on two ranked sets with window functions will become a bottleneck as workspaces grow beyond 1,000 entries. Add a pre-filter candidate pool before the semantic and fulltext CTEs:

```sql
WITH candidate_pool AS (
  SELECT id, content, entry_type, quality_score, created_at, embedding, tsv
  FROM workspace_memory_entries
  WHERE workspace_id = ${workspaceId}
    AND quality_score >= ${qualityThreshold}
    AND (task_slug = ${taskSlug} OR task_slug IS NULL)
    AND created_at >= NOW() - INTERVAL '${VECTOR_SEARCH_RECENCY_DAYS} days'
  ORDER BY created_at DESC
  LIMIT ${MAX_MEMORY_SCAN}  -- hard cap: 1000 rows
),
semantic AS (
  SELECT ... FROM candidate_pool WHERE embedding IS NOT NULL ...
),
fulltext AS (
  SELECT ... FROM candidate_pool WHERE tsv @@ ... ...
),
...
```

Use `GREATEST(created_at, last_accessed_at)` for ordering instead of just `created_at` -- this aligns with the memory drift protection and keeps frequently-accessed knowledge alive, not just recent inserts:

```sql
  ORDER BY GREATEST(created_at, COALESCE(last_accessed_at, created_at)) DESC
  LIMIT ${MAX_MEMORY_SCAN}
```

This ensures:
- Both sub-queries operate on the same bounded set (no divergent scans)
- Total rows scanned per query is capped regardless of workspace size
- Ordering favours both recent AND frequently-accessed entries (not just recency)

Add to `server/config/limits.ts`:

```typescript
export const MAX_MEMORY_SCAN = 1000;  // Hard cap on candidate pool for hybrid search
```

#### Update `getMemoryForPrompt()` (around line 454)

Pass `queryText` alongside `queryEmbedding`, with size guard:

```typescript
// Guard: cap query text size for plainto_tsquery safety (prevents very long inputs
// and potential performance degradation in full-text parsing)
const queryText = taskContext.slice(0, 500);

const memories = await getRelevantMemories(
  workspaceId,
  embedding,
  queryText,  // NEW: pass capped text for full-text search
  { taskSlug, qualityThreshold, limit }
);
```

#### Apply same pattern to org memory

Mirror the hybrid search in `server/services/orgMemoryService.ts`.

#### Update limits config

**File:** `server/config/limits.ts`

```typescript
// Replace VECTOR_SIMILARITY_THRESHOLD with RRF-based config
export const RRF_OVER_RETRIEVE_MULTIPLIER = 4;  // Retrieve 4x limit from each source
export const RRF_K = 60;                         // RRF constant
export const RRF_MIN_SCORE = 0.005;              // Floor: drop results below this RRF score
export const MAX_MEMORY_SCAN = 1000;             // Hard cap on candidate pool

// Scoring weights -- configurable per retrieval context
export const RRF_WEIGHTS = {
  general:  { rrf: 0.70, quality: 0.15, recency: 0.15 },
  factual:  { rrf: 0.80, quality: 0.15, recency: 0.05 },  // Prioritise relevance over freshness
  temporal: { rrf: 0.50, quality: 0.10, recency: 0.40 },  // Prioritise recent entries
} as const;

export type RetrievalProfile = keyof typeof RRF_WEIGHTS;
```

**Retrieval profile selection:** The `getMemoryForPrompt()` function selects a profile based on available context:

- `'temporal'` when the task context contains time-related terms ("latest", "recent", "last week", "today")
- `'factual'` when the query is longer (> 200 chars) and specific
- `'general'` as the default

This future-proofs the weighting system without adding complexity now. Profiles are selected by a simple heuristic, not ML.

### Client Changes

#### Enhanced `WorkspaceMemoryPage`

**File:** `client/src/pages/WorkspaceMemoryPage.tsx`

**New tab: "Search Diagnostics"**

Add a fourth tab alongside Summary / Entries / Board Summary:

```
[Summary] [Entries] [Board Summary] [Search Diagnostics]
```

The Search Diagnostics tab lets users test memory retrieval quality:

```
┌──────────────────────────────────────────────────────────────┐
│ Search Diagnostics                                            │
│                                                                │
│ Test Query: [_________________________________] [Search]       │
│                                                                │
│ Results (5):                                                   │
│                                                                │
│ ┌─ Score: 0.89 ──────────────────────────────────────────┐   │
│ │ [preference] Client prefers weekly email updates        │   │
│ │ Semantic: ★★★★☆  Keyword: ★★★☆☆  Quality: 0.82        │   │
│ │ Created: 3 days ago · Accessed: 5 times                 │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                                │
│ ┌─ Score: 0.74 ──────────────────────────────────────────┐   │
│ │ [decision] Set up Stripe billing on quarterly cycle     │   │
│ │ Semantic: ★★★☆☆  Keyword: ★★☆☆☆  Quality: 0.78        │   │
│ │ Created: 12 days ago · Accessed: 2 times                │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                                │
│ Stats: Semantic matches: 4 · Keyword matches: 3 · Fused: 5   │
│ Query latency: 12ms                                            │
└──────────────────────────────────────────────────────────────┘
```

**New API endpoint for search diagnostics:**

`POST /api/subaccounts/:subaccountId/workspace-memory/search-test`

**Auth:** `authenticate` + subaccount permission check
**Body:** `{ query: string }`
**Response:** Array of results with breakdown scores (semantic rank, keyword rank, RRF score, quality, recency, combined)

This endpoint is for diagnostics only -- it returns detailed scoring breakdown that the production `getMemoryForPrompt()` does not expose.

### Verification

- [ ] Generated tsvector column auto-populates on existing and new rows
- [ ] GIN index created successfully
- [ ] Hybrid query returns results from both semantic and keyword matches
- [ ] RRF fusion correctly ranks entries that appear in both result sets higher
- [ ] Quality and recency weights still influence ranking
- [ ] Search diagnostics tab shows breakdown scores
- [ ] Org memory also uses hybrid search
- [ ] Performance: hybrid query < 20ms for typical workspace (< 1000 entries)
- [ ] Fallback: if embedding is null (generation failed), entry can still be found via keyword search
- [ ] Migration applies cleanly on existing data
- [ ] `npm run typecheck` passes
- [ ] `npm run db:generate` produces correct migration diff

---

## Feature B3: Cross-Encoder Reranking

### Problem

After B1 (contextual retrieval) and B2 (hybrid search), retrieval quality will be substantially improved. However, the initial retrieval stage (HNSW index scan + tsvector match) uses fast but approximate methods. A cross-encoder reranker can refine the top candidates with much higher precision by scoring each query-document pair jointly rather than independently.

Cross-encoder reranking improves RAG accuracy by ~40% and reduces hallucinations by 10-25% in published benchmarks.

### Solution

Add an optional reranking step between retrieval and result return. Over-retrieve candidates from hybrid search, then rerank to the final result count.

### Server Changes

#### New module: `server/lib/reranker.ts`

```typescript
interface RerankResult {
  id: string;
  score: number;        // reranker confidence 0-1
  originalRank: number; // position in pre-rerank list
}

interface RerankerConfig {
  provider: 'cohere' | 'flashrank' | 'none';
  model?: string;
  apiKey?: string;
  topN: number;         // return top N after reranking
}

export async function rerank(
  query: string,
  documents: Array<{ id: string; content: string }>,
  config: RerankerConfig
): Promise<RerankResult[]> {
  if (config.provider === 'none' || documents.length <= config.topN) {
    // No reranking needed -- return as-is with position-based scores
    return documents.map((doc, i) => ({
      id: doc.id,
      score: 1 - (i / documents.length),
      originalRank: i,
    }));
  }

  if (config.provider === 'cohere') {
    // POST https://api.cohere.com/v2/rerank
    // model: 'rerank-v3.5'
    // query, documents, top_n, return_documents: false
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANKER_TIMEOUT_MS);  // 500ms default

    try {
      const response = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model ?? 'rerank-v3.5',
          query,
          documents: documents.map(d => d.content),
          top_n: config.topN,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const data = await response.json();
    return data.results.map((r: any) => ({
      id: documents[r.index].id,
      score: r.relevance_score,
      originalRank: r.index,
    }));
  }

  // FlashRank: self-hosted option (future)
  // For now, fall back to no reranking
  return documents.map((doc, i) => ({
    id: doc.id,
    score: 1 - (i / documents.length),
    originalRank: i,
  }));
}
```

#### Configuration

**File:** `server/config/limits.ts`

```typescript
// Reranking (Phase B3)
export const RERANKER_PROVIDER = process.env.RERANKER_PROVIDER ?? 'none';  // 'cohere' | 'none'
export const RERANKER_MODEL = process.env.RERANKER_MODEL ?? 'rerank-v3.5';
export const RERANKER_TOP_N = 5;           // Final result count after reranking
export const RERANKER_CANDIDATE_COUNT = 20; // Over-retrieve this many from hybrid search
export const RERANKER_TIMEOUT_MS = 500;    // Abort reranker if slower than this
export const RERANKER_MAX_CALLS_PER_RUN = 3;  // Budget guard: max rerank calls per agent run
```

**Environment variables:**
- `RERANKER_PROVIDER` -- `'cohere'` or `'none'` (default: `'none'` -- feature is off until explicitly enabled)
- `RERANKER_API_KEY` -- Cohere API key (only needed when provider is `'cohere'`)
- `RERANKER_MODEL` -- Model name (default: `'rerank-v3.5'`)

#### Modified: `server/services/workspaceMemoryService.ts`

**In `getRelevantMemories()`:**

After the hybrid search query returns `RERANKER_CANDIDATE_COUNT` results, pass them through the reranker:

```typescript
// 1. Hybrid search returns 20 candidates
const candidates = await hybridSearch(workspaceId, queryEmbedding, queryText, {
  ...options,
  limit: RERANKER_CANDIDATE_COUNT,
});

// 2. Rerank to top 5
const reranked = await rerank(
  queryText,
  candidates.map(c => ({ id: c.id, content: c.content })),
  {
    provider: RERANKER_PROVIDER,
    model: RERANKER_MODEL,
    apiKey: process.env.RERANKER_API_KEY,
    topN: RERANKER_TOP_N,
  }
);

// 3. Map back to full results, preserving reranker scores
// Use Map for O(1) lookup instead of O(N) find per candidate
const scoreMap = new Map(reranked.map(r => [r.id, r.score]));
const results = candidates
  .filter(c => scoreMap.has(c.id))
  .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
```

**Graceful degradation:** If the reranker API call fails (timeout, rate limit, API error), fall back to the hybrid search results without reranking. Log the failure but don't block the agent run.

**Budget guard:** Track rerank calls per agent run via a simple counter on the execution context. If `RERANKER_MAX_CALLS_PER_RUN` (default 3) is exceeded, skip reranking for remaining retrievals in that run. This prevents silent cost creep on runs that make many memory lookups. Ties into the existing token budget system conceptually -- the reranker has its own call budget per run.

### Verification

- [ ] Reranking disabled by default (RERANKER_PROVIDER='none')
- [ ] When enabled, over-retrieves 20 candidates and reranks to 5
- [ ] Cohere API called correctly with query + documents
- [ ] Graceful fallback when reranker API fails
- [ ] Search diagnostics tab shows reranker scores when enabled
- [ ] No latency impact when reranking is disabled
- [ ] Latency < 500ms when reranking is enabled (including API call)

---

## Feature B4: Query Expansion (HyDE)

### Problem

When agent task context is short or vague (e.g., "check client status"), the embedding produced is generic and retrieves broad, low-relevance memories. The `MIN_QUERY_CONTEXT_LENGTH = 20` gate prevents the worst cases, but queries between 20-100 characters still produce mediocre embeddings.

HyDE (Hypothetical Document Embeddings) generates a hypothetical answer to the query, then embeds that instead. This bridges the gap between terse queries and detailed memory entries.

### Solution

For short queries (below a configurable threshold), generate a hypothetical memory entry via LLM, embed that, and use it for semantic search alongside the original query text for keyword search.

### Server Changes

#### Modified: `server/services/workspaceMemoryService.ts`

**In `getMemoryForPrompt()` (around line 454):**

```typescript
const HYDE_THRESHOLD = 100; // characters

let embeddingInput = taskContext;

if (taskContext.length < HYDE_THRESHOLD && taskContext.length >= MIN_QUERY_CONTEXT_LENGTH) {
  try {
    // Cache HyDE results to avoid spamming LLM on repetitive queries
    // ("check status", "follow up", etc.)
    const cacheKey = `hyde:${createHash('sha256').update(taskContext + agentName).digest('hex').slice(0, 16)}`;
    const cached = hydeCache.get(cacheKey);

    if (cached) {
      embeddingInput = cached;
    } else {
      const hypothetical = await generateHypotheticalMemory(taskContext, agentName);
      if (hypothetical) {
        embeddingInput = hypothetical;
        hydeCache.set(cacheKey, hypothetical);
      }
    }
  } catch (err) {
    // Fall back to original query -- HyDE is a best-effort optimisation
    logger.warn('hyde_generation_failed', { error: err.message });
  }
}

const embedding = await generateEmbedding(embeddingInput);

// Note: queryText for full-text search still uses original taskContext (not HyDE output)
// This ensures keyword matching works on the actual query terms
const memories = await getRelevantMemories(workspaceId, embedding, taskContext, options);
```

**New function:**

```typescript
async function generateHypotheticalMemory(
  query: string,
  agentName: string
): Promise<string | null> {
  const prompt = `You are a workspace memory system for an AI agent named "${agentName}".

Given this short task context, generate a hypothetical memory entry (2-3 sentences) that would be relevant and useful. Include specific details, names, and terminology that a real memory entry might contain.

Task context: "${query}"

Respond with only the hypothetical memory entry, nothing else.`;

  const result = await llmRouter.chat({
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5-20251001',  // Fast, cheap model for HyDE
    maxTokens: 200,
  });

  return result?.content?.[0]?.text ?? null;
}
```

**Key design decisions:**
- Use Haiku for HyDE generation (fast, cheap -- ~$0.0001 per call)
- Only trigger for queries between 20-100 characters (short but valid)
- Original query text still used for keyword search (tsvector match)
- Only the embedding is replaced with the HyDE output
- Graceful degradation on failure
- **In-memory cache with TTL** to avoid repeated LLM calls for identical/similar queries

**HyDE cache:**

```typescript
// Simple TTL cache -- bounded size, auto-expiry
// Module-level in workspaceMemoryService.ts
const hydeCache = new Map<string, { value: string; expiresAt: number }>();
const HYDE_CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes
const HYDE_CACHE_MAX_SIZE = 200;

// LRU-style TTL cache: get promotes to end, eviction removes from front
function hydeCacheGet(key: string): string | undefined {
  const entry = hydeCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { hydeCache.delete(key); return undefined; }
  // LRU: move to end by re-inserting (Map preserves insertion order)
  hydeCache.delete(key);
  hydeCache.set(key, entry);
  return entry.value;
}

function hydeCacheSet(key: string, value: string): void {
  // Evict LRU entry (first in Map) when at capacity
  if (hydeCache.size >= HYDE_CACHE_MAX_SIZE) {
    const firstKey = hydeCache.keys().next().value;
    if (firstKey) hydeCache.delete(firstKey);
  }
  hydeCache.set(key, { value, expiresAt: Date.now() + HYDE_CACHE_TTL_MS });
}
```

**Multi-instance note:** This cache is per-process/per-instance. In a multi-instance deployment, duplicate LLM calls will occur across nodes for the same query. This is acceptable at current scale -- HyDE calls are cheap (Haiku) and infrequent (only short queries). If this becomes a problem at scale, promote to Redis or a shared cache layer.

#### Configuration

**File:** `server/config/limits.ts`

```typescript
// Query Expansion - HyDE (Phase B4)
export const HYDE_THRESHOLD = 100;           // chars -- queries shorter than this get HyDE
export const HYDE_MODEL = 'claude-haiku-4-5-20251001';
export const HYDE_MAX_TOKENS = 200;
```

### Verification

- [ ] HyDE only triggers for queries between MIN_QUERY_CONTEXT_LENGTH (20) and HYDE_THRESHOLD (100)
- [ ] Queries >= 100 chars skip HyDE entirely
- [ ] HyDE uses Haiku (fast, cheap model)
- [ ] Original query text used for keyword search (not HyDE output)
- [ ] Graceful fallback when HyDE generation fails
- [ ] Latency overhead < 500ms when HyDE triggers
- [ ] Search diagnostics tab indicates when HyDE was used

---

## UI Enhancements: Dashboard Cards

### DashboardPage Memory Health Card

**File:** `client/src/pages/DashboardPage.tsx`

Add a "Memory Health" card (visible to all users with subaccount access):

```
┌───────────────────────────┐
│ Memory Health              │
│                            │
│ Entries: 142               │
│ With embeddings: 138 (97%) │
│ Avg quality: 0.72          │
│ Last summary: 2h ago       │
└───────────────────────────┘
```

**API:** Uses existing workspace memory stats (extend `getStats()` if needed).

**Colour coding:**
- Green: > 90% embedding coverage and avg quality > 0.6
- Amber: 70-90% embedding coverage or avg quality 0.4-0.6
- Red: < 70% embedding coverage or avg quality < 0.4

### DashboardPage Queue Health Card

Already specified in A2. System admin only.

---

## Measurement Plan

### Baseline (Before Any Changes)

Before starting implementation, capture baseline metrics:

1. **Manual retrieval evaluation** -- For 50 recent agent runs with task context:
   - Run `getRelevantMemories()` with the task context
   - Manually rate each result as relevant/irrelevant
   - Calculate precision@5 (relevant results / 5)

2. **Query latency** -- Log p50/p95/p99 for `getRelevantMemories()` over 7 days

3. **Memory utilisation** -- For 50 runs, check if agent referenced any retrieved memories in its response

### Per-Phase Measurement

After each phase ships, re-run the same evaluation:

| Metric | Baseline Target | After B1+B2 | After B3 | After B4 |
|--------|----------------|-------------|----------|----------|
| Precision@5 | Establish | +15-25% | +5-10% | +5% (short queries only) |
| Query latency p95 | Establish | < 25ms | < 500ms | < 800ms (conditional) |
| Memory utilisation | Establish | Increase | Stable | Increase |

### Automated Monitoring

Add structured log events for ongoing tracking. **This is critical for tuning** -- without per-retrieval breakdowns, you cannot diagnose why a query returned poor results.

**Retrieval breakdown event (emit on every memory retrieval):**

```typescript
logger.info('memory_retrieval', {
  workspaceId,
  queryLength: taskContext.length,
  retrievalProfile: 'general' | 'factual' | 'temporal',
  hydeUsed: boolean,
  rerankingUsed: boolean,
  semanticCandidates: number,   // how many results from vector search
  keywordCandidates: number,    // how many results from full-text search
  overlapCount: number,         // how many appeared in both (validates fusion value)
  fusedResults: number,
  topScore: number,
  bottomScore: number,          // score of worst returned result
  latencyMs: number,
  latencyBreakdown: {
    hydeMs: number | null,      // null if HyDE not used
    embeddingMs: number,
    hybridQueryMs: number,
    rerankMs: number | null,    // null if reranker disabled
  },
});
```

**Per-result source attribution (emit per result in debug mode):**

```typescript
logger.debug('memory_retrieval_result', {
  workspaceId,
  entryId: string,
  semanticRank: number | null,  // null if only found via keyword
  keywordRank: number | null,   // null if only found via semantic
  rrfScore: number,
  qualityScore: number,
  recencyScore: number,
  combinedScore: number,
  source: 'semantic_only' | 'keyword_only' | 'both',  // which pipeline found it
  hasEmbeddingContext: boolean,  // whether contextual retrieval was applied
});
```

The `source` field is essential for understanding whether the hybrid search investment is paying off. If > 80% of results come from `semantic_only`, keyword search isn't adding value and weights need adjustment.

**Context enrichment event:**

```typescript
logger.info('memory_context_enrichment', {
  workspaceId,
  batchSize: number,
  successCount: number,
  failureCount: number,
  avgContextLength: number,
  latencyMs: number,
});
```

This enables dashboarding retrieval quality over time without manual evaluation.

---

## File Impact Summary

### New Files

| File | Feature | Type |
|------|---------|------|
| `server/lib/createWorker.ts` | A3 | Utility |
| `server/lib/reranker.ts` | B3 | Module |
| `server/services/jobQueueHealthService.ts` | A2 | Service |
| `server/routes/jobQueue.ts` | A2 | Route |
| `server/jobs/contextualRetrievalBackfillJob.ts` | B1 | Job |
| `client/src/pages/JobQueueDashboardPage.tsx` | A2 | Page |
| `client/src/components/TraceChainSidebar.tsx` | A1 | Component |
| `client/src/components/TraceChainTimeline.tsx` | A1 | Component |
| `migrations/0054_contextual_retrieval.sql` | B1 | Migration |
| `migrations/0055_hybrid_search.sql` | B2 | Migration |
| `migrations/0056_job_queue_stats.sql` | A2 | Migration |

### Modified Files

| File | Features | Changes |
|------|----------|---------|
| `server/services/workspaceMemoryService.ts` | B1, B2, B3, B4 | Context generation, hybrid search query, reranking, HyDE |
| `server/services/orgMemoryService.ts` | B1, B2 | Context generation, hybrid search |
| `server/services/agentActivityService.ts` | A1 | getRunChain(), getRelatedWorkflows() |
| `server/services/agentScheduleService.ts` | A3 | Use createWorker() |
| `server/services/queueService.ts` | A3 | Use createWorker() |
| `server/config/jobConfig.ts` | A3 | Add timeoutMs per queue |
| `server/config/limits.ts` | B2, B3, B4 | RRF weights, reranker config, HyDE threshold |
| `server/lib/embeddings.ts` | B1 | Accept context-prefixed input |
| `server/db/schema/workspaceMemories.ts` | B1 | embeddingContext column |
| `server/db/schema/orgMemories.ts` | B1 | embeddingContext column |
| `server/routes/agentRuns.ts` | A1 | Chain and related-workflows endpoints |
| `server/routes/workspaceMemory.ts` | B2 | Search diagnostics endpoint |
| `client/src/App.tsx` | A2 | Lazy import + route for JobQueueDashboardPage |
| `client/src/pages/RunTraceViewerPage.tsx` | A1 | Chain sidebar and timeline integration |
| `client/src/pages/WorkspaceMemoryPage.tsx` | B2 | Search diagnostics tab |
| `client/src/pages/DashboardPage.tsx` | A2, B2 | Queue health + memory health cards |
| `client/src/components/Layout.tsx` | A2 | Sidebar nav link |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| LLM cost increase from contextual retrieval (B1) | Use prompt caching; batch entries per run; one-time ingestion cost only |
| Hybrid search query performance regression | Generated tsvector column is indexed; RRF CTE is two fast sub-queries; benchmark at < 20ms |
| Reranker API latency/reliability (B3) | Feature-flagged off by default; graceful fallback on failure |
| HyDE adding latency to every short query (B4) | Only triggers for 20-100 char queries; uses Haiku (fast); conditional |
| pg-boss internal table schema changes | Query pg-boss tables via documented API where possible; pin pg-boss version |
| Migration on large existing datasets | tsvector GENERATED column backfills automatically; contextual retrieval backfill is batched and idempotent |
| Memory drift (stale entries dominating results) | Access-based boosting + existing decay job mitigate; see cross-cutting concern below |

---

## Cross-Cutting Concern: Memory Drift Protection

Improving retrieval quality (B1-B4) risks amplifying a latent problem: well-worded but stale entries can dominate results because they have high quality scores and strong embeddings, even when they're no longer accurate.

The existing memory decay job (`memoryDecayJob.ts`) prunes entries older than 90 days with quality < 0.3 and access count < 3. This handles the bottom of the barrel but doesn't address "good but outdated" entries.

**Mitigation (implement alongside B2):**

1. **Access-based recency boost:** The `lastAccessedAt` field already tracks when an entry was last retrieved. Incorporate it into the combined score alongside `createdAt`:

```typescript
// In the hybrid search query, add access recency as a signal:
// An entry accessed 2 days ago is more likely still relevant than one last accessed 60 days ago
const accessRecencyScore = lastAccessedAt
  ? 1.0 / (1.0 + daysSince(lastAccessedAt) / 30.0)
  : 0.0;  // never accessed = no boost
```

This doesn't add weight -- it's folded into the existing recency component: use `MAX(createdAt, lastAccessedAt)` instead of just `createdAt` for the recency decay calculation. Entries that keep getting retrieved stay fresh; entries that haven't been retrieved in months naturally decay.

2. **Surfacing drift in the UI:** On the WorkspaceMemoryPage Entries tab, add a "Stale" badge (amber) for entries that:
   - Were created > 60 days ago
   - Have quality score > 0.5 (so they're not already pruning candidates)
   - Have access count < 2 (not being retrieved)

This gives users visibility into entries that might need manual review without automating deletion of potentially valuable long-term knowledge.

---

## Out of Scope

- Adding ChromaDB, Pinecone, or any external vector DB
- Replacing wink-bm25 for tool discovery (it works fine for that use case)
- Learnable/adaptive scoring weights
- Real-time workflow trace streaming (future enhancement)
- Cross-service distributed tracing (OpenTelemetry)
- pg-workflows or DBOS adoption (revisit if durable execution needs grow)
