# Development Spec: pg-boss Hardening + Zod Validation Rollout

**Date:** 2025-04-05
**Priority:** High
**Status:** Final Draft
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
- No retry classification — transient errors (network timeout) and permanent errors (validation, missing entity) treated identically
- No failure visibility beyond DLQ — no counters, no alerting on flapping jobs

### Job Inventory with Proposed Configuration

#### Tier 1 — Agent Execution (highest impact, user-facing)

| Job | Queue Name | Current Config | Proposed Config |
|-----|-----------|---------------|-----------------|
| Agent scheduled run | `agent-scheduled-run` | None | retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 300, singletonKey per agent+schedule tick |
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
    deadLetter: 'agent-scheduled-run__dlq',
  },
  'agent-org-scheduled-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-org-scheduled-run__dlq',
  },
  'agent-handoff-run': {
    retryLimit: 1,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 180,
    deadLetter: 'agent-handoff-run__dlq',
  },
  'agent-triggered-run': {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'agent-triggered-run__dlq',
  },
  'execution-run': {
    retryLimit: 1,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'execution-run__dlq',
  },
  'workflow-resume': {
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'workflow-resume__dlq',
  },

  // ── Tier 2: Financial ───────────────────────────────────────────
  'llm-aggregate-update': {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
    deadLetter: 'llm-aggregate-update__dlq',
  },
  'llm-reconcile-reservations': {
    expireInSeconds: 90,
  },
  'llm-monthly-invoices': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: 'llm-monthly-invoices__dlq',
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

/** Type-safe config accessor — prevents undefined lookups */
export function getJobConfig(name: JobName) {
  return JOB_CONFIG[name];
}
```

**Naming convention:** DLQ queues use `${queueName}__dlq` suffix. Only Tier 1 and Tier 2 jobs with retries get DLQs. Tier 3 maintenance jobs don't need them — they self-heal on next schedule tick.

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
import { getJobConfig } from '../config/jobConfig.js';

// Before:
await boss.send('agent-scheduled-run', payload);

// After:
await boss.send('agent-scheduled-run', payload, getJobConfig('agent-scheduled-run'));
```

**For `work()` calls** — apply concurrency from env:

```typescript
import { env } from '../lib/env.js';

// Before:
await boss.work('agent-scheduled-run', handler);

// After:
await boss.work('agent-scheduled-run', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, handler);
```

**Concurrency model intent:**
- `teamSize` = number of parallel workers polling the queue (controlled by `QUEUE_CONCURRENCY` env var, default: 5)
- `teamConcurrency` = max jobs each worker processes simultaneously (always 1 — our handlers are not designed for concurrent execution within a single worker)
- For I/O-heavy maintenance jobs (file cleanup, aggregation), `teamConcurrency: 2` may be safe but is not the initial default

**Files to modify:**
- `server/services/agentScheduleService.ts` — 5 `work()` calls, 2+ `send()` calls
- `server/services/queueService.ts` — 5 `work()` calls, 2 `send()` calls
- `server/services/routerJobService.ts` — 4 `work()` calls, 1 `send()` call
- `server/services/paymentReconciliationJob.ts` — 1 `work()` call
- `server/services/pageIntegrationWorker.ts` — 1 `work()` call, 1 `send()` call (already configured)

#### Step 4: Add retry classification, handler timeouts, and idempotency guards

##### 4a: Retryable vs non-retryable errors

Not all errors should be retried. Retrying a validation error or missing entity wastes cycles and adds noise.

**Create** `server/lib/jobErrors.ts`:

```typescript
// server/lib/jobErrors.ts

/** Errors that should NOT be retried — fail immediately to DLQ */
const NON_RETRYABLE_CODES = new Set([
  400, // validation error
  401, // auth error
  403, // permission error
  404, // missing entity
  409, // conflict / duplicate
  422, // unprocessable
]);

export function isNonRetryable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    return NON_RETRYABLE_CODES.has((err as { statusCode: number }).statusCode);
  }
  return false;
}

/** Type-safe retry count accessor — avoids (job as any).retrycount */
export function getRetryCount(job: { retrycount?: number } & Record<string, unknown>): number {
  return job.retrycount ?? 0;
}

/** Wrap a handler with a timeout — prevents hung LLM calls or stuck API requests from starving workers */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job handler timed out after ${ms}ms`)), ms),
    ),
  ]);
}
```

##### 4b: Handler timeout wrapping

`expireInSeconds` only controls job lifecycle in pg-boss — it does NOT stop long-running code inside a handler. A hung LLM call or stuck API request will block a worker indefinitely.

**Wrap all handlers with `withTimeout`:**

```typescript
// Timeout should be slightly less than expireInSeconds to allow clean failure
const HANDLER_TIMEOUT_MS = (getJobConfig('agent-scheduled-run').expireInSeconds - 30) * 1000;

await withTimeout(handler(job), HANDLER_TIMEOUT_MS);
```

Timeout values per tier:
- Tier 1 (agent execution): `expireInSeconds - 30` seconds (e.g., 270s for 300s expiry)
- Tier 2 (financial): `expireInSeconds - 10` seconds
- Tier 3 (maintenance): `expireInSeconds - 30` seconds

##### 4c: Idempotency invariant

**All job handlers must be idempotent.** If a job partially executes, throws, then retries, it must not produce duplicate side effects.

For Tier 1 + Tier 2 jobs, use existing idempotency mechanisms:
- **Execution runs:** Check `execution.status` before re-processing — if already `completed`, skip
- **LLM aggregate updates:** Already use idempotency keys on `llm_requests` table
- **Agent runs:** Check `agentRun.status` — if already `completed` or `failed`, skip
- **Payment reconciliation:** Already double-checks before inserts

**Pattern for handlers that need explicit guards:**

```typescript
// At top of handler:
const existing = await getExecutionStatus(job.data.executionId);
if (existing === 'completed' || existing === 'failed') {
  logger.info('job_already_processed', { queue: queueName, jobId: job.id });
  return; // safe to return here — job completed successfully (was already done)
}
```

##### 4d: Full worker pattern

**Apply in every worker handler:**

```typescript
import { isNonRetryable, getRetryCount, withTimeout } from '../lib/jobErrors.js';
import { logger } from '../lib/logger.js';

await boss.work('agent-scheduled-run', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job) => {
  const retryCount = getRetryCount(job);
  if (retryCount > 0) {
    logger.warn('job_retry', { queue: 'agent-scheduled-run', jobId: job.id, retryCount });
  }

  try {
    await withTimeout(handler(job), 270_000); // 270s timeout for 300s expiry
  } catch (err) {
    if (isNonRetryable(err)) {
      logger.warn('job_non_retryable_failure', {
        queue: 'agent-scheduled-run',
        jobId: job.id,
        error: String(err),
      });
      await boss.fail(job.id); // mark as failed → routes to DLQ, skips retries
      return;
    }
    throw err; // transient error — let pg-boss retry
  }
});
```

**Critical:** Use `boss.fail(job.id)` for non-retryable errors, NOT `return`. Returning without error marks the job as **success**, which loses DLQ routing and corrupts failure metrics.

#### Step 5: Add DLQ monitor with structured logging and correlation context

**Create** `server/services/dlqMonitorService.ts` — uses the existing structured `logger` (not raw `console.error`). Includes correlation context (orgId, agentId) for debuggability.

```typescript
// server/services/dlqMonitorService.ts
import PgBoss from 'pg-boss';
import { logger } from '../lib/logger.js';

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
  for (const dlqName of DLQ_QUEUES) {
    const sourceQueue = dlqName.replace('__dlq', '');
    await boss.work(dlqName, { teamSize: 2, teamConcurrency: 1 }, async (job) => {
      const payload = job.data as Record<string, unknown>;
      logger.error('job_dlq', {
        queue: sourceQueue,
        jobId: job.id,
        // Correlation context for debugging
        organisationId: payload.organisationId,
        agentId: payload.agentId,
        subaccountId: payload.subaccountId,
        // Job metadata
        payload,
      });
      // Future: emit WebSocket event to admin dashboard
      // Future: write to dedicated DLQ audit table
    });
  }
}
```

#### Step 6: Add singleton keys with schedule-tick scoping

Prevent duplicate scheduled runs, but **avoid global dedup** that could skip legitimate executions when a job runs longer than its interval.

**Key design:** Use the schedule tick identifier when available (from pg-boss schedule payload), fall back to time-bucket.

```typescript
// Prefer schedule tick from payload (deterministic, aligns with scheduler)
// Fall back to minute-bucket for non-scheduled jobs

function getSingletonKey(prefix: string, agentId: string, payload: Record<string, unknown>): string {
  if (payload.scheduledAt) {
    return `${prefix}:${agentId}:${payload.scheduledAt}`;
  }
  // Fallback: floor to nearest minute
  const now = new Date();
  const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth()).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}T${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}`;
  return `${prefix}:${agentId}:${bucket}`;
}

// agent-scheduled-run — singleton per agent + schedule tick
await boss.send('agent-scheduled-run', payload, {
  ...getJobConfig('agent-scheduled-run'),
  singletonKey: getSingletonKey('scheduled', payload.subaccountAgentId, payload),
});

// agent-triggered-run — singleton per agent + trigger + tick
await boss.send('agent-triggered-run', payload, {
  ...getJobConfig('agent-triggered-run'),
  singletonKey: `triggered:${payload.subaccountAgentId}:${payload.triggerId}:${getSingletonKey('t', payload.subaccountAgentId, payload)}`,
});
```

This ensures: same agent can't be double-triggered within the same schedule tick, but the next tick creates a fresh singleton key.

#### Step 7: Add failure visibility — retry logging

Beyond DLQ, log every retry attempt to catch flapping jobs before they exhaust retries. This feeds into existing structured logging — alerting thresholds can be added later via log aggregation rules without code changes.

Already shown in Step 4 worker pattern:
```typescript
const retryCount = getRetryCount(job);
if (retryCount > 0) {
  logger.warn('job_retry', { queue: queueName, jobId: job.id, retryCount });
}
```

#### Step 8: Startup sequencing and graceful shutdown

**Startup order matters.** DLQ monitor must start after pg-boss is ready. Add explicitly to `server/index.ts` startup:

```typescript
import { getPgBoss, stopPgBoss } from './lib/pgBossInstance.js';
import { startDlqMonitor } from './services/dlqMonitorService.js';

// In startup sequence:
const boss = await getPgBoss();
await startDlqMonitor(boss);
// Then register all queue workers...
```

**Graceful shutdown** — update `server/index.ts` shutdown handler:

```typescript
// In shutdown handler:
await stopPgBoss();
```

### Verification

- [ ] All 16 job types have explicit config in `jobConfig.ts`
- [ ] Single pg-boss instance shared across all services
- [ ] `QUEUE_CONCURRENCY` env var applied to all `work()` calls
- [ ] Concurrency model documented: `teamSize` = workers, `teamConcurrency` = 1
- [ ] Tier 1 + Tier 2 jobs have dead letter queues
- [ ] Singleton keys with schedule-tick scoping prevent duplicate scheduled/triggered runs
- [ ] Non-retryable errors use `boss.fail()` — NOT return (which marks as success)
- [ ] All DLQ logs include correlation context (orgId, agentId, subaccountId)
- [ ] All DLQ and retry events use structured `logger` (not `console.error`)
- [ ] Retry attempts logged with `job_retry` event for flap detection
- [ ] `getRetryCount()` helper used instead of `(job as any).retrycount`
- [ ] All Tier 1 + Tier 2 handlers wrapped with `withTimeout()` (timeout < expireInSeconds)
- [ ] All Tier 1 + Tier 2 handlers are idempotent (check status before re-processing)
- [ ] DLQ monitor started after pg-boss in startup sequence
- [ ] DLQ monitor has concurrency (`teamSize: 2`)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Manual test: kill a job mid-execution → verify retry fires
- [ ] Manual test: exhaust retries → verify DLQ entry created with structured log + correlation
- [ ] Manual test: throw 404 in handler → verify `boss.fail()` called, no retry, DLQ entry

---

## Part 2: Zod Validation Rollout — Data Integrity + Security

### Current State

- `validateBody()` and `validateQuery()` middleware exist in `server/middleware/validate.ts` — **fully functional but used by 0 of 335 route handlers**
- All validation is inline manual checks (`if (!name) return 400`) — inconsistent, incomplete, no type coercion
- ~64% of route handlers have **no validation at all**
- Zod is used effectively for env validation (`env.ts`) and LLM context validation (`llmRouter.ts`)
- No `.refine()`, `.transform()`, or discriminated union usage anywhere
- Error response shape is inconsistent — some routes return `{ error, details }`, others throw `{ statusCode, message }`

### Strategy

**Do NOT create all 335 schemas at once.** Prioritise by risk:

1. **Public routes** (no auth) — highest attack surface
2. **Write routes** (POST/PUT/PATCH/DELETE) — data mutation risk
3. **Admin/system routes** — privilege escalation risk
4. **Read routes with query params** — injection/type confusion risk

### Rollout Safety: Warn-Then-Enforce Mode

**Problem:** Switching from no validation to strict validation will reject requests that previously passed. Frontend or integrations may break.

**Solution:** Add a `mode` option to the validation middleware for phased rollout:

```typescript
// server/middleware/validate.ts — updated

type ValidationMode = 'enforce' | 'warn';

export const validateBody = <T extends ZodTypeAny>(schema: T, mode: ValidationMode = 'enforce') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      if (mode === 'warn') {
        logger.warn('validation_warn', {
          path: req.path,
          method: req.method,
          errors: result.error.flatten(),
        });
        next(); // pass through — log only
        return;
      }
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
};
```

**Rollout phases:**
1. Deploy all schemas in `warn` mode → monitor logs for unexpected rejections
2. Fix any frontend/integration issues surfaced by warnings
3. Switch to `enforce` mode (default) per route batch

### Standardised Error Response Shape

All validation errors return a consistent structure:

```json
{
  "error": "Validation failed",
  "details": {
    "name": ["Required"],
    "email": ["Invalid email"]
  }
}
```

This uses Zod's `flatten().fieldErrors` format — field names as keys, arrays of error messages as values. Frontend can map these directly to form fields.

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

**Conventions:**
- Each schema file exports inferred TypeScript types: `export type XInput = z.infer<typeof xBody>;`
- Every entity with CRUD gets a formalised pair: `createXBody` + `updateXBody = createXBody.partial().refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided' })`
- Use `.strict()` on public endpoints (reject unexpected fields). Internal routes use default behaviour (strip unknown fields).
- Use `.max()` on all string fields to prevent memory abuse. Set limits based on DB column sizes.

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

These routes accept external input with no authentication. Schemas are mandatory — deploy in `enforce` mode immediately.

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
}).strict();

export type FormSubmissionInput = z.infer<typeof formSubmissionBody>;

export const pageTrackingBody = z.object({
  pageId: z.string().uuid(),
  event: z.string().max(100),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type PageTrackingInput = z.infer<typeof pageTrackingBody>;
```

#### Step 3: Auth routes

**File:** `server/routes/auth.ts` — deploy in `enforce` mode (auth payloads are well-defined).

```typescript
// server/schemas/auth.ts
import { z } from 'zod';

export const loginBody = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(500),
  organisationSlug: z.string().max(100).optional(),
});
export type LoginInput = z.infer<typeof loginBody>;

export const registerBody = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(500),
  organisationName: z.string().min(1).max(255),
  organisationSlug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
});
export type RegisterInput = z.infer<typeof registerBody>;

export const acceptInviteBody = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(500),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteBody>;

export const forgotPasswordBody = z.object({
  email: z.string().email().max(255),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordBody>;

export const resetPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(500),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;
```

#### Step 4: Core write routes (POST/PUT/PATCH/DELETE)

Work through route files in order of data sensitivity. For each file:

1. Read the route handler to understand expected fields
2. Define `createXBody` schema in corresponding `server/schemas/*.ts` file
3. Define `updateXBody = createXBody.partial().refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided' })` for PATCH routes
4. Export inferred types: `export type XInput = z.infer<typeof xBody>;`
5. Wire `validateBody(schema, 'warn')` into the route middleware chain
6. Remove inline manual validation that the schema now covers
7. Run `npm run typecheck` after each file

**Priority order for write routes:**

| Priority | Route File | Handlers | Risk Level | Initial Mode |
|----------|-----------|----------|------------|-------------|
| 1 | `auth.ts` | 6 | Credential handling | enforce |
| 2 | `users.ts` | 8 | User management, role assignment | warn → enforce |
| 3 | `organisations.ts` | ~5 | Org settings, billing | warn → enforce |
| 4 | `agents.ts` | 18 | Agent config affects execution | warn → enforce |
| 5 | `subaccountAgents.ts` | ~8 | Agent-workspace binding | warn → enforce |
| 6 | `tasks.ts` | 11 | Task CRUD | warn → enforce |
| 7 | `processes.ts` | 11 | Process definitions | warn → enforce |
| 8 | `projects.ts` | 5 | Project CRUD | warn → enforce |
| 9 | `skills.ts` | ~6 | Skill definitions | warn → enforce |
| 10 | `executions.ts` | 5 | Execution triggers | warn → enforce |
| 11 | `subaccounts.ts` | ~5 | Workspace CRUD | warn → enforce |
| 12 | `scheduledTasks.ts` | ~4 | Schedule config | warn → enforce |
| 13 | `agentTriggers.ts` | ~4 | Trigger definitions | warn → enforce |
| 14 | `permissionSets.ts` | ~4 | Permission management | warn → enforce |
| 15 | `files.ts` | ~3 | File upload params | warn → enforce |
| 16 | `pageRoutes.ts` / `pageProjects.ts` | ~8 | Page builder | warn → enforce |
| 17 | `boardConfig.ts` / `boardTemplates.ts` | ~4 | Board config | warn → enforce |
| 18 | `categories.ts` | ~3 | Category CRUD | warn → enforce |
| 19 | `orgAgentConfigs.ts` | ~4 | Org-level agent config | warn → enforce |
| 20 | `workspaceMemory.ts` / `orgMemory.ts` | ~6 | Memory management | warn → enforce |
| 21 | Remaining route files | ~20 | Lower risk | warn → enforce |

#### Step 5: Read routes with query parameters

Add `validateQuery()` for routes that accept filtering/pagination/search params:

```typescript
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

**Before:**
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
import { createAgentBody, type CreateAgentInput } from '../schemas/agents.js';

router.post('/api/agents', authenticate, requireOrgPermission(...), validateBody(createAgentBody), asyncHandler(async (req, res) => {
  const { name, masterPrompt } = req.body as CreateAgentInput;
  // No inline validation needed — schema enforces required fields + types
  // ...
}));
```

### Sanitisation Order Rule

**Mandatory ordering for routes that accept HTML content:**

```
Raw input → sanitize-html → Zod schema → Business logic
```

`sanitize-html` runs as middleware **before** `validateBody()`, so Zod validates the cleaned output. Never validate raw HTML then sanitise after.

For routes that don't accept HTML: `Raw input → Zod schema → Business logic`.

### Key Design Decisions

1. **Schemas live in `server/schemas/`, not inline in routes** — keeps routes clean, schemas reusable, testable independently.
2. **`validateBody` replaces `req.body` with parsed data** — coerced types work transparently.
3. **Export inferred types from every schema** — `export type XInput = z.infer<typeof xBody>` eliminates type drift between route and service.
4. **Formalised PATCH pattern** — every entity: `createXBody` + `updateXBody = createXBody.partial().refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided' })`. Prevents requiring fields on update that were required on create. The `.refine()` guard rejects empty `{}` payloads that would be valid under `.partial()` but result in no-op updates.
5. **Don't over-schema GET routes** — only add `validateQuery` where query params affect DB queries or business logic.
6. **Keep inline validation for service-layer checks** — Zod validates shape/type at the boundary. Business logic validation stays in services.
7. **`.strict()` on public endpoints only** — prevent payload stuffing. Internal routes use default (strip unknown fields).
8. **Warn-then-enforce rollout** — non-auth, non-public routes start in `warn` mode. Monitor logs, then switch.

### Verification

- [ ] `server/schemas/` directory created with domain-specific schema files
- [ ] Every schema exports inferred TypeScript type
- [ ] Every entity with CRUD has `createXBody` + `updateXBody` with `.partial().refine()` (rejects empty `{}`)
- [ ] All public routes have `validateBody` in `enforce` mode with `.strict()`
- [ ] All auth routes have `validateBody` in `enforce` mode
- [ ] All POST/PUT/PATCH routes on priority list have `validateBody`
- [ ] Inline manual validation removed where schema now covers it
- [ ] Standardised error shape: `{ error: "Validation failed", details: { field: ["message"] } }`
- [ ] Sanitisation order correct: sanitize-html before Zod where HTML accepted
- [ ] `npm run typecheck` passes after each batch
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Manual test: send malformed body → get 400 with structured field errors
- [ ] Manual test: send oversized string → get 400
- [ ] Manual test: `warn` mode logs validation issues but passes request through
- [ ] Manual test: extra fields rejected on public `.strict()` routes

---

## Execution Order

### Phase 1: pg-boss foundation (do first — fewer files, higher reliability impact)
1. Create `server/config/jobConfig.ts` with all 16 job configs + DLQ names + `getJobConfig()` helper
2. Create `server/lib/pgBossInstance.ts` singleton
3. Create `server/lib/jobErrors.ts` with `isNonRetryable()` + `getRetryCount()` helpers
4. Migrate all 5 services to shared pg-boss instance
5. Apply job config to all `send()` calls via `getJobConfig()`
6. Apply `QUEUE_CONCURRENCY` to all `work()` calls (`teamSize: N, teamConcurrency: 1`)
7. Add retry classification (non-retryable → `boss.fail()`) to all workers
8. Add retry-attempt logging (`job_retry` event) to all workers
9. Create `server/services/dlqMonitorService.ts` with structured logging + correlation context
10. Add singleton keys with schedule-tick scoping to scheduled + triggered jobs
11. Update graceful shutdown in `server/index.ts`
12. Verify (typecheck, tests, manual DLQ/retry tests)

### Phase 2: Zod validation (do second — more files, incremental rollout)
1. Update `server/middleware/validate.ts` with `warn`/`enforce` mode support + standardised error shape
2. Create `server/schemas/common.ts` with shared types
3. Create schema + wire public routes in `enforce` mode with `.strict()`
4. Create schema + wire auth routes in `enforce` mode
5. Create schema + wire core write routes in `warn` mode (batches of 3-4 files)
6. Formalise PATCH pattern: `updateXBody = createXBody.partial()` for every entity
7. Monitor `validation_warn` logs — fix any frontend/integration mismatches
8. Switch validated routes from `warn` → `enforce`
9. Add `validateQuery` for list endpoints with query params
10. Clean up redundant inline validation
11. Export inferred types, update service signatures where beneficial
12. Verify (typecheck, lint, tests, manual 400 response tests)

### Estimated Scope

- **pg-boss:** ~8 files modified, 4 new files (`jobConfig.ts`, `pgBossInstance.ts`, `jobErrors.ts`, `dlqMonitorService.ts`)
- **Zod:** ~56 route files modified, ~15 new schema files, 1 middleware file updated

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Zod rejects previously-accepted requests | Medium | High | Warn mode rollout — log before enforcing |
| Singleton keys too aggressive — skip legitimate runs | Low | High | Schedule-tick scoping (not global dedup) |
| Retry storms on transient provider outages | Low | Medium | `isNonRetryable()` filter + max 2-3 retries + expiration |
| Non-retryable handler marks job as success instead of failure | Low | High | Use `boss.fail()` — explicitly documented as critical pattern |
| Existing DB data doesn't conform to new schemas | Low | Low | Schemas validate inbound only. Use `.partial()` for PATCH. |
| Multiple pg-boss instances during migration | Low | Low | Migrate all services in one PR. Instance is lazy — created once. |

### Migration Strategy for Existing Data

Zod validation applies at the **API boundary only** — validates inbound requests, not existing DB rows. Awareness during implementation:

- **PATCH routes:** Use `createXBody.partial()` so all fields become optional. Existing records without a field can be updated without sending every field.
- **Enum tightening:** If a schema restricts to specific enum values, ensure no existing records have values outside that set before the field appears in update forms.
- **No data migration needed** — this is additive input validation, not a data model change.

---

## Out of Scope

- Langfuse deep instrumentation (separate development thread)
- Drizzle relation definitions (medium priority, separate spec)
- MCP client capability (medium priority, separate spec)
- New pg-boss features (job archiving UI, metrics dashboard, admin DLQ viewer)
- Response validation (Zod on outbound — not needed yet)
- pg-boss monitoring alerts (thresholds/paging) — log events are the foundation; alerting rules come after
- `validateParams()` / `validateHeaders()` — params validated by route matching + `resolveSubaccount()`, headers by auth middleware
- Zod schema unit tests — schemas validated implicitly via route tests; dedicated tests are optional follow-up
