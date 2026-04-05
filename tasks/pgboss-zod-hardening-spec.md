# Development Spec: pg-boss Hardening + Zod Validation Rollout

**Date:** 2025-04-05
**Priority:** High
**Status:** Draft
**Scope:** System reliability (pg-boss) + data integrity (Zod)

---

## Part 1: pg-boss Hardening — System Reliability Backbone

### Current State

The system runs **16 distinct job types** across 5 independent pg-boss instances (each service lazy-loads its own). Only **1 of 16 jobs** (`page-integration`) has proper retry/backoff/expiration config. The rest silently drop on failure.

**Instances (each creates a separate DB connection):**
1. `agentScheduleService.ts` — agent scheduled/triggered/handoff runs, stale cleanup
2. `pageIntegrationWorker.ts` — page integration jobs (the only well-configured one)
3. `paymentReconciliationJob.ts` — payment reconciliation
4. `routerJobService.ts` — LLM cost aggregation, reconciliation, invoices
5. `queueService.ts` — execution runs, workflow resume, maintenance tasks

**Critical gaps:**
- `QUEUE_CONCURRENCY` env var (default: 5) is defined in `env.ts:27` but **never applied** to any job
- No dead letter queue on any job type
- No singleton/deduplication via pg-boss options (only 2 jobs use app-level idempotency keys)
- No expiration/timeout on 15 of 16 job types
- Failed agent runs (scheduled, triggered, handoff) are logged and silently dropped

### Job Inventory with Proposed Configuration

#### Tier 1 — Agent Execution (highest impact, user-facing)

| Job | Queue Name | Current Config | Proposed Config |
|-----|-----------|---------------|-----------------|
| Agent scheduled run | `agent-scheduled-run` | None | retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 300, singletonKey per agent+schedule |
| Agent org-scheduled run | `agent-org-scheduled-run` | App-level idempotency key | retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 300 (keep app-level key) |
| Agent handoff run | `agent-handoff-run` | None | retryLimit: 1, retryDelay: 5, retryBackoff: true, expireInSeconds: 180 |
| Agent triggered run | `agent-triggered-run` | None | retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 300 |
| Execution run | `execution-run` | Internal 3x retry with backoff | expireInSeconds: 600, retryLimit: 1 (pg-boss level, on top of internal retry) |
| Workflow resume | `workflow-resume` | None | retryLimit: 2, retryDelay: 5, retryBackoff: true, expireInSeconds: 300 |

#### Tier 2 — Financial / Billing (data integrity critical)

| Job | Queue Name | Current Config | Proposed Config |
|-----|-----------|---------------|-----------------|
| LLM aggregate update | `llm-aggregate-update` | App-level idempotency key | retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 60 |
| LLM reconcile reservations | `llm-reconcile-reservations` | None (scheduled) | expireInSeconds: 90 |
| LLM monthly invoices | `llm-monthly-invoices` | None (scheduled) | retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 600 |
| Payment reconciliation | `payment-reconciliation` | None (scheduled) | expireInSeconds: 300 |

#### Tier 3 — Maintenance (lower urgency, self-healing)

| Job | Queue Name | Current Config | Proposed Config |
|-----|-----------|---------------|-----------------|
| Stale run cleanup | `stale-run-cleanup` | None | expireInSeconds: 240 |
| Cleanup execution files | `maintenance:cleanup-execution-files` | None | expireInSeconds: 300 |
| Cleanup budget reservations | `maintenance:cleanup-budget-reservations` | None | expireInSeconds: 120 |
| Memory decay | `maintenance:memory-decay` | None | expireInSeconds: 600 |
| LLM clean old aggregates | `llm-clean-old-aggregates` | None | expireInSeconds: 120 |
| Page integration | `page-integration` | retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 120 | **No change needed** |

### Implementation Plan

#### Step 1: Centralise pg-boss configuration

**Create** `server/config/jobConfig.ts` — single source of truth for all job queue configuration.

```typescript
// server/config/jobConfig.ts

export const JOB_CONFIG = {
  // ── Tier 1: Agent execution ─────────────────────────────────────
  'agent-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  'agent-org-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  'agent-handoff-run': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 180,
  },
  'agent-triggered-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
  },
  'execution-run': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  'workflow-resume': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 300,
  },

  // ── Tier 2: Financial ───────────────────────────────────────────
  'llm-aggregate-update': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
  },
  'llm-reconcile-reservations': {
    expireInSeconds: 90,
  },
  'llm-monthly-invoices': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
  },
  'payment-reconciliation': {
    expireInSeconds: 300,
  },

  // ── Tier 3: Maintenance ─────────────────────────────────────────
  'stale-run-cleanup': {
    expireInSeconds: 240,
  },
  'maintenance:cleanup-execution-files': {
    expireInSeconds: 300,
  },
  'maintenance:cleanup-budget-reservations': {
    expireInSeconds: 120,
  },
  'maintenance:memory-decay': {
    expireInSeconds: 600,
  },
  'llm-clean-old-aggregates': {
    expireInSeconds: 120,
  },
} as const;

export type JobName = keyof typeof JOB_CONFIG;
```

#### Step 2: Centralise pg-boss instance management

**Problem:** 5 independent pg-boss instances = 5 separate DB connections + no shared lifecycle.

**Create** `server/lib/pgBossInstance.ts` — singleton pg-boss instance shared across all services.

```typescript
// server/lib/pgBossInstance.ts
import PgBoss from 'pg-boss';
import { env } from './env.js';

let instance: PgBoss | null = null;

export async function getPgBoss(): Promise<PgBoss> {
  if (instance) return instance;
  instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    retentionDays: 7,          // keep completed jobs for debugging
    archiveCompletedAfterSeconds: 43200, // archive after 12h
    deleteAfterDays: 14,       // hard delete after 14d
    monitorStateIntervalSeconds: 30,
  });
  await instance.start();
  return instance;
}

export async function stopPgBoss(): Promise<void> {
  if (instance) {
    await instance.stop({ graceful: true, timeout: 10000 });
    instance = null;
  }
}
```

**Migrate** each service (`agentScheduleService.ts`, `routerJobService.ts`, `queueService.ts`, `paymentReconciliationJob.ts`, `pageIntegrationWorker.ts`) to import from `pgBossInstance.ts` instead of creating their own instance.

#### Step 3: Apply job config at send() and work() sites

**For `send()` calls** — spread job config into send options:

```typescript
import { JOB_CONFIG } from '../config/jobConfig.js';

// Before:
await boss.send('agent-scheduled-run', payload);

// After:
await boss.send('agent-scheduled-run', payload, JOB_CONFIG['agent-scheduled-run']);
```

**For `work()` calls** — apply concurrency from env:

```typescript
import { env } from '../lib/env.js';

// Before:
await boss.work('agent-scheduled-run', handler);

// After:
await boss.work('agent-scheduled-run', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, handler);
```

**Files to modify:**
- `server/services/agentScheduleService.ts` — 5 `work()` calls, 2+ `send()` calls
- `server/services/queueService.ts` — 5 `work()` calls, 2 `send()` calls
- `server/services/routerJobService.ts` — 4 `work()` calls, 1 `send()` call
- `server/services/paymentReconciliationJob.ts` — 1 `work()` call
- `server/services/pageIntegrationWorker.ts` — 1 `work()` call, 1 `send()` call (already configured)

#### Step 4: Add dead letter queue handling

pg-boss supports dead letter queues via the `deadLetter` option on `send()`. When a job exhausts retries, it gets moved to a DLQ.

**Add DLQ queue name convention:** `${queueName}__dlq`

```typescript
// In JOB_CONFIG, add deadLetter to Tier 1 and Tier 2 jobs:
'agent-scheduled-run': {
  retryLimit: 2,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 300,
  deadLetter: 'agent-scheduled-run__dlq',
},
```

**Add a DLQ monitor** — a single worker that logs/alerts on DLQ arrivals:

```typescript
// server/services/dlqMonitorService.ts
const DLQ_QUEUES = [
  'agent-scheduled-run__dlq',
  'agent-org-scheduled-run__dlq',
  'agent-handoff-run__dlq',
  'agent-triggered-run__dlq',
  'execution-run__dlq',
  'workflow-resume__dlq',
  'llm-aggregate-update__dlq',
  'llm-monthly-invoices__dlq',
];

export async function startDlqMonitor(boss: PgBoss) {
  for (const queue of DLQ_QUEUES) {
    await boss.work(queue, async (job) => {
      console.error(`[DLQ] Job failed permanently`, {
        queue: queue.replace('__dlq', ''),
        jobId: job.id,
        data: job.data,
        // Emit WebSocket event to admin dashboard
      });
      // Future: emit to monitoring/alerting system
    });
  }
}
```

#### Step 5: Add singleton keys for idempotent scheduled jobs

Prevent duplicate scheduled runs when pg-boss schedule fires before previous run completes:

```typescript
// agent-scheduled-run — singleton per subaccountAgent + schedule tick
await boss.send('agent-scheduled-run', payload, {
  ...JOB_CONFIG['agent-scheduled-run'],
  singletonKey: `scheduled:${payload.subaccountAgentId}`,
});

// agent-triggered-run — singleton per trigger event
await boss.send('agent-triggered-run', payload, {
  ...JOB_CONFIG['agent-triggered-run'],
  singletonKey: `triggered:${payload.subaccountAgentId}:${payload.triggerId}`,
});
```

#### Step 6: Graceful shutdown update

Update `server/index.ts` shutdown to use the centralised instance:

```typescript
import { stopPgBoss } from './lib/pgBossInstance.js';

// In shutdown handler:
await stopPgBoss();
```

### Verification

- [ ] All 16 job types have explicit config in `jobConfig.ts`
- [ ] Single pg-boss instance shared across all services
- [ ] `QUEUE_CONCURRENCY` env var applied to all `work()` calls
- [ ] Tier 1 + Tier 2 jobs have dead letter queues
- [ ] Singleton keys prevent duplicate scheduled/triggered runs
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (existing job-related tests)
- [ ] Manual test: kill a job mid-execution → verify retry fires
- [ ] Manual test: exhaust retries → verify DLQ entry created

---

## Part 2: Zod Validation Rollout — Data Integrity + Security

### Current State

- `validateBody()` and `validateQuery()` middleware exist in `server/middleware/validate.ts` — **fully functional but used by 0 of 335 route handlers**
- All validation is inline manual checks (`if (!name) return 400`) — inconsistent, incomplete, no type coercion
- ~64% of route handlers have **no validation at all**
- Zod is used effectively for env validation (`env.ts`) and LLM context validation (`llmRouter.ts`)
- No `.refine()`, `.transform()`, or discriminated union usage anywhere

### Strategy

**Do NOT create all 335 schemas at once.** Prioritise by risk:

1. **Public routes** (no auth) — highest attack surface
2. **Write routes** (POST/PUT/PATCH/DELETE) — data mutation risk
3. **Admin/system routes** — privilege escalation risk
4. **Read routes with query params** — injection/type confusion risk

### Schema Organisation

**Create** `server/schemas/` directory with one file per route domain:

```
server/schemas/
├── auth.ts           # login, register, invite, password reset
├── agents.ts         # agent CRUD, config
├── tasks.ts          # task CRUD, status transitions
├── projects.ts       # project CRUD
├── processes.ts      # process CRUD, connections
├── subaccounts.ts    # subaccount CRUD
├── users.ts          # user management, roles
├── organisations.ts  # org settings
├── skills.ts         # skill CRUD
├── executions.ts     # execution triggers, queries
├── files.ts          # file upload params
├── pages.ts          # page builder, templates
├── public.ts         # form submissions, tracking
├── common.ts         # shared schemas (pagination, UUID params, etc.)
└── index.ts          # re-exports
```

### Implementation Plan

#### Step 1: Define shared/common schemas

```typescript
// server/schemas/common.ts
import { z } from 'zod';

// ── Reusable field types ──────────────────────────────────────────
export const uuidParam = z.string().uuid();
export const orgIdHeader = z.string().uuid();

// ── Pagination ────────────────────────────────────────────────────
export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().max(200).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

// ── ID params ─────────────────────────────────────────────────────
export const subaccountIdParam = z.object({
  subaccountId: uuidParam,
});
```

#### Step 2: Public routes (highest priority — no auth protection)

**Files:** `server/routes/public/formSubmission.ts`, `pageTracking.ts`, `pagePreview.ts`, `pageServing.ts`
**Also:** `server/routes/webhooks.ts`, `githubWebhook.ts`

These routes accept external input with no authentication. Schemas are mandatory.

```typescript
// server/schemas/public.ts
import { z } from 'zod';

export const formSubmissionBody = z.object({
  fields: z.record(z.string(), z.unknown()),
  pageId: z.string().uuid(),
  metadata: z.object({
    userAgent: z.string().max(500).optional(),
    referrer: z.string().url().max(2000).optional(),
    ip: z.string().optional(),
  }).optional(),
});

export const pageTrackingBody = z.object({
  pageId: z.string().uuid(),
  event: z.string().max(100),
  data: z.record(z.string(), z.unknown()).optional(),
});
```

#### Step 3: Auth routes

**File:** `server/routes/auth.ts` — login, register, invite acceptance, password reset

```typescript
// server/schemas/auth.ts
import { z } from 'zod';

export const loginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(500),
  organisationSlug: z.string().max(100).optional(),
});

export const registerBody = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(500),
  organisationName: z.string().min(1).max(255),
  organisationSlug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
});

export const acceptInviteBody = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(500),
});

export const forgotPasswordBody = z.object({
  email: z.string().email().max(255),
});

export const resetPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(500),
});
```

#### Step 4: Core write routes (POST/PUT/PATCH/DELETE)

Work through route files in order of data sensitivity. For each file:

1. Read the route handler to understand expected fields
2. Define schema in corresponding `server/schemas/*.ts` file
3. Wire `validateBody(schema)` into the route middleware chain
4. Remove inline manual validation that the schema now covers
5. Run `npm run typecheck` after each file

**Priority order for write routes:**

| Priority | Route File | Handlers | Risk Level |
|----------|-----------|----------|------------|
| 1 | `auth.ts` | 6 | Credential handling |
| 2 | `users.ts` | 8 | User management, role assignment |
| 3 | `organisations.ts` | ~5 | Org settings, billing |
| 4 | `agents.ts` | 18 | Agent config affects execution |
| 5 | `subaccountAgents.ts` | ~8 | Agent-workspace binding |
| 6 | `tasks.ts` | 11 | Task CRUD |
| 7 | `processes.ts` | 11 | Process definitions |
| 8 | `projects.ts` | 5 | Project CRUD |
| 9 | `skills.ts` | ~6 | Skill definitions |
| 10 | `executions.ts` | 5 | Execution triggers |
| 11 | `subaccounts.ts` | ~5 | Workspace CRUD |
| 12 | `scheduledTasks.ts` | ~4 | Schedule config |
| 13 | `agentTriggers.ts` | ~4 | Trigger definitions |
| 14 | `permissionSets.ts` | ~4 | Permission management |
| 15 | `files.ts` | ~3 | File upload params |
| 16 | `pageRoutes.ts` / `pageProjects.ts` | ~8 | Page builder |
| 17 | `boardConfig.ts` / `boardTemplates.ts` | ~4 | Board config |
| 18 | `categories.ts` | ~3 | Category CRUD |
| 19 | `orgAgentConfigs.ts` | ~4 | Org-level agent config |
| 20 | `workspaceMemory.ts` / `orgMemory.ts` | ~6 | Memory management |
| 21 | Remaining route files | ~20 | Lower risk |

#### Step 5: Read routes with query parameters

Add `validateQuery()` for routes that accept filtering/pagination/search params. Use `paginationQuery` from common schemas as a base and extend per-route.

**Example pattern:**
```typescript
// In route file:
import { validateQuery } from '../middleware/validate.js';
import { paginationQuery } from '../schemas/common.js';

const taskListQuery = paginationQuery.extend({
  status: z.enum(['todo', 'in_progress', 'done', 'blocked']).optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

router.get(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  validateQuery(taskListQuery),
  asyncHandler(async (req, res) => { ... })
);
```

#### Step 6: Wire schemas into route middleware

**Pattern for each route — before:**
```typescript
router.post('/api/agents', authenticate, requireOrgPermission(...), asyncHandler(async (req, res) => {
  const { name, masterPrompt } = req.body;
  if (!name || !masterPrompt) {
    res.status(400).json({ error: 'Validation failed', details: 'name and masterPrompt are required' });
    return;
  }
  // ...
}));
```

**After:**
```typescript
import { validateBody } from '../middleware/validate.js';
import { createAgentBody } from '../schemas/agents.js';

router.post('/api/agents', authenticate, requireOrgPermission(...), validateBody(createAgentBody), asyncHandler(async (req, res) => {
  const { name, masterPrompt } = req.body;
  // No inline validation needed — schema enforces required fields + types
  // ...
}));
```

### Key Design Decisions

1. **Schemas live in `server/schemas/`, not inline in routes** — keeps routes clean, schemas reusable, and testable independently.

2. **`validateBody` replaces `req.body` with parsed data** — this means coerced types (e.g., `z.coerce.number()`) work transparently. The handler receives typed, validated data.

3. **Don't over-schema GET routes** — only add `validateQuery` where query params affect DB queries or business logic. Simple ID-based GETs don't need it.

4. **Keep inline validation for service-layer checks** — Zod validates shape/type at the boundary. Business logic validation (e.g., "this agent belongs to this org") stays in services.

5. **Use `.max()` on all string fields** — prevents memory abuse from oversized payloads. Set reasonable limits based on DB column sizes.

6. **Sanitize before schema where needed** — `sanitize-html` runs before Zod for fields that accept HTML content (e.g., page builder content).

### Verification

- [ ] `server/schemas/` directory created with domain-specific schema files
- [ ] All public routes have `validateBody` / `validateQuery`
- [ ] All auth routes have `validateBody`
- [ ] All POST/PUT/PATCH routes on priority list have `validateBody`
- [ ] Inline manual validation removed where schema covers it
- [ ] `npm run typecheck` passes after each batch
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Manual test: send malformed body to validated route → get 400 with structured error
- [ ] Manual test: send oversized string → get 400

---

## Execution Order

### Phase 1: pg-boss foundation (do first — fewer files, higher reliability impact)
1. Create `server/config/jobConfig.ts`
2. Create `server/lib/pgBossInstance.ts`
3. Migrate services to shared instance
4. Apply job config to all `send()` calls
5. Apply `QUEUE_CONCURRENCY` to all `work()` calls
6. Add DLQ config + monitor
7. Add singleton keys
8. Update graceful shutdown
9. Verify

### Phase 2: Zod validation (do second — more files, incremental rollout)
1. Create `server/schemas/common.ts`
2. Schema + wire public routes
3. Schema + wire auth routes
4. Schema + wire core write routes (batches of 3-4 files at a time)
5. Schema + wire query validation for list endpoints
6. Clean up redundant inline validation
7. Verify

### Estimated Scope
- **pg-boss:** ~8 files modified, 2 new files created
- **Zod:** ~56 route files modified, ~15 new schema files created
- **Risk:** Low — additive changes, no breaking API contracts. Retry config adds resilience. Validation adds strictness but returns clear 400 errors.

---

## Out of Scope

- Langfuse deep instrumentation (separate development thread)
- Drizzle relation definitions (medium priority, separate spec)
- MCP client capability (medium priority, separate spec)
- New pg-boss features (job archiving UI, metrics dashboard)
- Response validation (Zod on outbound — not needed yet)
