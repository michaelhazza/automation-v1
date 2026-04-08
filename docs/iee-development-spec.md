# AutomationOS – Integrated Execution Environment (IEE)
## Detailed Development Specification

**Status:** Draft v1 — for review before implementation
**Source brief:** `AutomationOS IEE Development Brief` (2026-04)
**Branch:** `claude/automate-video-transcript-workflow-NXXVf`
**Related docs:**
- `docs/execution-contracts.md` (existing action/execution contracts)
- `docs/pgboss-zod-hardening-spec.md` (pg-boss payload validation conventions)
- `tasks/windows-iee-setup-guide.md` (local Windows setup, companion to this spec)

---

## 0. Reading Order

This spec is organised into ten parts. Each part is self-contained enough that it can be read on its own, but they are listed in the order they should be implemented.

| Part | Scope | Depends on |
|---|---|---|
| 1 | Architecture, codebase audit, integration points | — |
| 2 | Data model, migrations, idempotency rules | 1 |
| 3 | Job contracts (pg-boss), payload validation, enqueue path | 1, 2 |
| 4 | Worker service skeleton, bootstrap, tsconfig, Docker | 3 |
| 5 | Execution loop, observation & action schemas, LLM integration | 4 |
| 6 | Browser execution handler (Playwright) | 5 |
| 7 | Dev execution handler (workspace, git, shell) | 5 |
| 8 | Tracing, logging, failure classification | 4–7 |
| 9 | AgentExecutionService routing, action registry integration | 2, 3 |
| 10 | Verification, MVP acceptance, rollout to DigitalOcean | all |

---

## Part 1 — Architecture & Codebase Integration

### 1.1 Guiding principles

1. **Database is the only integration point between app and worker.** No HTTP calls between services. Ever.
2. **Reuse existing infrastructure.** pg-boss, llmRouter, tracing, Drizzle schema conventions, correlationId middleware — all already exist and must be used as-is.
3. **Multi-tenant isolation at the database layer.** Every row, every session, every workspace is scoped by `organisationId`.
4. **Configuration over code.** No hardcoded paths, credentials, or connection strings.
5. **Worker is stateless except for controlled persistence** (browser session volume, ephemeral workspace dir).
6. **Identical code in local and production.** Only env var values change.

### 1.2 Deployment topology

| Component | Local dev | Production |
|---|---|---|
| Main app | Docker Compose (`app` service) | Replit |
| Postgres + pg-boss | Docker Compose (`postgres` service) | Neon (managed) |
| IEE worker | Docker Compose (`worker` service) | DigitalOcean VPS (Docker) |

The main app and worker share **no filesystem** and make **no direct HTTP calls**. They communicate exclusively via pg-boss jobs and shared Postgres tables.

### 1.3 Flow diagram

```
┌─────────────────────────┐              ┌─────────────────────────┐
│ AgentExecutionService   │              │       IEE Worker        │
│ (main app on Replit)    │              │ (DigitalOcean VPS)      │
├─────────────────────────┤              ├─────────────────────────┤
│ routeCall()             │              │ createWorker({          │
│   → detects IEE route   │              │   queue: 'iee-browser'  │
│   → boss.send(          │              │   queue: 'iee-dev'      │
│       'iee-browser',    │              │ })                      │
│       payload)          │              │   → executionLoop()     │
└────────────┬────────────┘              └────────────┬────────────┘
             │                                        │
             │          ┌──────────────────┐          │
             └─────────▶│  Postgres +      │◀─────────┘
                        │  pg-boss queue   │
                        │                  │
                        │  execution_runs  │
                        │  execution_steps │
                        └──────────────────┘
```

### 1.4 Audit findings — existing conventions the IEE must follow

Audited against `/home/user/automation-v1` on the current branch. These are the real paths and patterns the new code must match.

**pg-boss**
- Singleton at `server/lib/pgBossInstance.ts` (`getPgBoss()`, `stopPgBoss()`)
- Job names kebab-case. Defined in `server/config/jobConfig.ts`. DLQ pattern: `queue-name__dlq`
- Handlers registered via `createWorker({ queue, boss, handler, concurrency?, timeoutMs? })` from `server/lib/createWorker.ts`
- Example enqueue: `await boss.send(JOB_AGGREGATE_UPDATE, { idempotencyKey }, getJobConfig('llm-aggregate-update'))` (`server/services/routerJobService.ts:37`)
- **IEE implication:** Add two new entries to `jobConfig.ts`: `'iee-browser-task'` and `'iee-dev-task'`, with DLQ siblings. Worker uses its own pg-boss instance (separate process) but the same queue names.

**LLM router**
- Entry point: `server/services/llmRouter.ts::routeCall(params: RouterCallParams): Promise<ProviderResponse>`
- `RouterCallParams = { messages, system?, tools?, maxTokens?, temperature?, estimatedContextTokens?, context: LLMCallContext }`
- `LLMCallContext` includes `sourceType`, `taskType`, `executionPhase`, `organisationId`, `subaccountId`, `runId`, `agentId`, `correlationId`
- Handles model selection, fallback chain, cost tracking, idempotency key generation, Langfuse generation creation
- **IEE implication:** The worker calls `routeCall()` directly for every execution-loop iteration. **No new LLM abstraction.** A new `executionPhase` value (`'iee.loop.step'`) is added so the router can apply the correct model policy.

**Tracing**
- `server/lib/tracing.ts` — `createSpan(name, metadata)`, `createEvent(name, metadata)`, `finalizeTrace(status)`
- Enforced `SPAN_NAMES` and `EVENT_NAMES` registries. New names must be added to the registry.
- Context via `AsyncLocalStorage` in `server/instrumentation.ts` — `withTrace(trace, runContext, fn)`, `getTraceContext()`
- Naming pattern: `component.operation.phase`
- **IEE implication:** Register new span/event names:
  - Spans: `iee.execution.run`, `iee.execution.step`
  - Events: `iee.execution.start`, `iee.execution.step.complete`, `iee.execution.step.failed`, `iee.execution.complete`, `iee.execution.failed`

**Correlation**
- `server/middleware/correlation.ts` attaches `req.correlationId`. `generateCorrelationId()` produces a 12-char UUID in `server/lib/logger.ts`.
- **IEE implication:** The worker is not an HTTP service. It receives `correlationId` on the job payload and calls `withTrace()` with it at the top of every job handler.

**Schema conventions (Drizzle)**
- Location: `server/db/schema/*.ts` — one file per table, re-exported from an index
- Tables: camelCase in TS, snake_case in SQL, **plural** (`organisations`, `executions`, `actions`)
- Every table has `organisationId: uuid(...).notNull().references(() => organisations.id)` plus an index starting with `organisationId`
- Soft deletes: `deletedAt: timestamp(..., { withTimezone: true })`; unique indexes are filtered `WHERE deletedAt IS NULL`
- Timestamps: `createdAt` / `updatedAt`, `withTimezone: true`, `.defaultNow().notNull()`
- Enums: inline `$type<'a' | 'b'>()` on a `text()` column (not pg enums)
- **IEE implication:** New tables are `executionRuns`, `executionSteps`, `executionArtifacts` (all camelCase TS / snake_case SQL). See Part 2.

**Action registry**
- `server/config/actionRegistry.ts` — `ACTION_REGISTRY: Record<string, ActionDefinition>`
- Categories: `'api' | 'worker' | 'browser' | 'devops' | 'mcp'`
- Each definition has `actionType`, `actionCategory`, `defaultGateLevel`, `parameterSchema`, `retryPolicy`, optional `mcp.annotations`
- **IEE decision:** IEE actions (browser `navigate/click/type/extract/download`, dev `run_command/write_file/read_file/git_clone/git_commit`, terminal `done/failed`) are **internal to the worker** and **not** added to the registry in v1. The registry models tasks the app schedules *for* an agent; IEE actions are LLM-chosen sub-steps within a single execution run and should not be reviewable/gated individually. The unit of gating is the execution run itself (a future `iee_browser_task` / `iee_dev_task` registry entry can be added when gating becomes relevant). **This decision is documented inline in `worker/src/actions/schema.ts`.**

**Directory layout**
```
/
├── server/         (main app — existing)
│   ├── config/
│   ├── db/schema/
│   ├── lib/
│   ├── services/
│   └── ...
├── client/         (React — existing)
├── migrations/     (Drizzle SQL — existing)
├── worker/         (NEW — IEE worker)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          (entry point)
│       ├── bootstrap.ts      (pg-boss + tracing init)
│       ├── handlers/
│       │   ├── browserTask.ts
│       │   └── devTask.ts
│       ├── loop/
│       │   ├── executionLoop.ts
│       │   ├── observation.ts
│       │   └── action.ts
│       ├── browser/
│       │   ├── playwrightContext.ts
│       │   └── actions.ts
│       ├── dev/
│       │   ├── workspace.ts
│       │   ├── git.ts
│       │   └── shell.ts
│       ├── persistence/
│       │   ├── executionRuns.ts
│       │   └── executionSteps.ts
│       ├── llm/
│       │   └── routerClient.ts
│       ├── tracing/
│       │   └── index.ts
│       └── config/
│           └── env.ts
├── shared/         (NEW — cross-process types)
│   └── iee/
│       ├── jobPayload.ts     (zod schemas)
│       ├── actionSchema.ts   (zod schemas)
│       └── observation.ts    (types)
├── docker-compose.yml (UPDATED)
├── .env.example       (UPDATED)
└── docs/iee-development-spec.md  (this document)
```

The `shared/iee/` folder contains **only** zod schemas and TypeScript types that must be imported by both `server/` and `worker/`. Runtime helpers stay inside their owning process. This is the minimum surface area that keeps the enqueue side (app) and the consume side (worker) in lockstep.

**ESM + tsconfig**
- Root `package.json` has `"type": "module"`
- `server/tsconfig.json`: `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"strict": true`, `"target": "ES2020"`, output to `../dist/server`
- Server imports use relative paths (no `@/` alias on server side)
- **IEE implication:** `worker/tsconfig.json` mirrors the server config. Output to `worker/dist`. Worker uses relative imports. The `shared/` folder is imported via relative paths (`../../shared/iee/jobPayload.js`) from both sides.

### 1.5 Non-goals for v1 (from brief, unchanged)

Not implementing: autonomous planning, multi-tab browsers, parallel execution within a job, workspace persistence across jobs, session pooling, multi-agent orchestration inside execution, Docker-in-Docker sandboxing.

---

## Part 2 — Data Model & Migrations

### 2.1 Tables

All three tables live in `server/db/schema/` as new files, following existing conventions (camelCase TS identifiers, snake_case SQL, plural table names, `organisationId` scoping, timezone-aware timestamps, soft delete where appropriate).

#### 2.1.1 `executionRuns` — `server/db/schema/executionRuns.ts`

One row per IEE job, end-to-end. The main app inserts the row at enqueue time; the worker updates status/result. The unit of idempotency.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, `defaultRandom()` | |
| `runId` | `uuid` not null | Correlates to the parent agent run |
| `agentId` | `uuid` not null, FK → `agents.id` | |
| `organisationId` | `uuid` not null, FK → `organisations.id` | Required; every query filters on this |
| `subaccountId` | `uuid` nullable, FK → `subaccounts.id` | Validated via `resolveSubaccount` at enqueue time |
| `type` | `text` not null, `$type<'browser' \| 'dev'>()` | Execution kind |
| `mode` | `text` not null, `$type<'api' \| 'browser' \| 'dev'>()` | Forward-compat (v1 only uses `'browser'` / `'dev'`) |
| `status` | `text` not null, `$type<'pending' \| 'running' \| 'completed' \| 'failed'>()`, default `'pending'` | |
| `correlationId` | `text` not null | Propagated from the enqueuing agent run |
| `idempotencyKey` | `text` not null | **Unique index** — see 2.2 |
| `goal` | `text` not null | Human-readable task goal (also passed in payload) |
| `startedAt` | `timestamp(tz)` nullable | Set by worker on loop start |
| `completedAt` | `timestamp(tz)` nullable | Set by worker at terminal state |
| `failureReason` | `text` nullable, `$type<FailureReason>()` | See Part 8 |
| `resultSummary` | `jsonb` nullable | Shape matches `ResultSummary` in Part 5 |
| `stepCount` | `integer` not null, default `0` | Denormalised for fast listing |
| `createdAt` | `timestamp(tz)` not null, `defaultNow()` | |
| `updatedAt` | `timestamp(tz)` not null, `defaultNow()` | |
| `deletedAt` | `timestamp(tz)` nullable | Soft delete |

Indexes:
- `execution_runs_idempotency_key_unique_idx` — **unique**, on `idempotencyKey`, partial `WHERE deleted_at IS NULL`
- `execution_runs_org_status_idx` — on `(organisationId, status)`
- `execution_runs_run_id_idx` — on `runId` (for lookup by parent agent run)
- `execution_runs_correlation_id_idx` — on `correlationId`

#### 2.1.2 `executionSteps` — `server/db/schema/executionSteps.ts`

One row per iteration of the execution loop. Append-only during the run.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, `defaultRandom()` | |
| `executionRunId` | `uuid` not null, FK → `executionRuns.id` ON DELETE CASCADE | |
| `organisationId` | `uuid` not null | Denormalised for tenant-scoped queries |
| `stepNumber` | `integer` not null | 1-indexed |
| `actionType` | `text` not null | e.g. `'navigate'`, `'run_command'`, `'done'` |
| `input` | `jsonb` not null | Action payload (validated against schema before execute) |
| `output` | `jsonb` nullable | Truncated per Part 8 logging rules |
| `success` | `boolean` not null | |
| `failureReason` | `text` nullable, `$type<FailureReason>()` | Set when `success = false` |
| `durationMs` | `integer` nullable | Wall-clock per step |
| `createdAt` | `timestamp(tz)` not null, `defaultNow()` | Acts as `timestamp` from brief §7.2 |

Indexes:
- Unique `(executionRunId, stepNumber)` — prevents duplicate step writes on retry
- `(organisationId, createdAt)` for tenant-scoped listing

No soft delete: steps are owned by their run and removed by cascade.

#### 2.1.3 `executionArtifacts` — `server/db/schema/executionArtifacts.ts`

Optional per brief §7.3. **Included in v1** — small addition, avoids a follow-up migration. Records any file emitted by a run (browser download, written file, generated report).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `executionRunId` | `uuid` not null, FK → `executionRuns.id` ON DELETE CASCADE | |
| `organisationId` | `uuid` not null | |
| `kind` | `text` not null, `$type<'download' \| 'file' \| 'log'>()` | |
| `path` | `text` not null | Path inside the worker container at capture time |
| `sizeBytes` | `integer` nullable | |
| `mimeType` | `text` nullable | |
| `metadata` | `jsonb` nullable | Free-form (source selector, command, etc.) |
| `createdAt` | `timestamp(tz)` not null, `defaultNow()` | |

Indexes: `(executionRunId)`, `(organisationId, createdAt)`.

> v1 scope: the artifact row records metadata only. We do **not** copy the file contents back to the app in v1. A later phase will add object-storage upload.

### 2.2 Idempotency

The brief (§9) defines the behaviour. Implementation rules:

1. `execution_runs.idempotencyKey` has a **database-level unique index** (partial: `WHERE deleted_at IS NULL`). The app never checks-then-inserts in application code.
2. Insertion uses `INSERT ... ON CONFLICT (idempotency_key) WHERE deleted_at IS NULL DO NOTHING RETURNING *`. If no row is returned, the row already existed — the caller reads it with a follow-up `SELECT`.
3. Behaviour on collision (driven by the existing row's `status`):

| Existing status | Behaviour |
|---|---|
| `completed` | Return existing `resultSummary` immediately. Do **not** enqueue a new pg-boss job. |
| `running` | Return the existing run id. Do not enqueue. The in-flight worker will finish it. |
| `pending` | Return the existing run id. The previously-enqueued job is still in the queue. |
| `failed` | If retry policy allows: soft-delete the old row (set `deletedAt`), then insert a new one and enqueue. Otherwise return the failed row. |

The "retry policy allows" check reuses the existing action retry conventions in `server/config/actionRegistry.ts` — the IEE introduces two retry profiles: `iee-browser-default` and `iee-dev-default`, added to `JOB_CONFIG`.

4. The **worker** also re-checks the row before starting work: if `status !== 'pending'` when the job is received, it logs a warning and acks the job without re-running (defensive guard against pg-boss double-delivery edge cases).

### 2.3 Migrations

- Generated via `npm run db:generate` (Drizzle Kit).
- Single migration file `migrations/NNNN_iee_execution_tables.sql` contains all three tables plus indexes.
- Migration is reviewed manually before being checked in. Drizzle generates it; no hand-written SQL is acceptable outside review.
- Down-migration is not auto-written; we rely on forward-only migrations per existing project practice (confirm with the existing `migrations/` folder — no existing down files).

### 2.4 Shared types

Zod schemas for `FailureReason`, `ResultSummary`, and row shapes live in `shared/iee/types.ts` so both the worker and the app can import them. The Drizzle `$inferSelect` / `$inferInsert` types are re-exported from `server/db/schema/index.ts` as usual.

---

## Part 3 — Job Contracts (pg-boss)

### 3.1 Job names

Added to `server/config/jobConfig.ts`:

```ts
export const JOB_IEE_BROWSER_TASK = 'iee-browser-task' as const;
export const JOB_IEE_DEV_TASK     = 'iee-dev-task' as const;
```

Their DLQ siblings follow the existing pattern: `iee-browser-task__dlq`, `iee-dev-task__dlq`.

`JOB_CONFIG` entries:

```ts
'iee-browser-task': {
  retryLimit: 3,
  retryBackoff: true,
  expireInMinutes: 10,       // hard ceiling; worker enforces MAX_EXECUTION_TIME_MS inside
  retentionDays: 7,
  dlq: 'iee-browser-task__dlq',
},
'iee-dev-task': {
  retryLimit: 2,
  retryBackoff: true,
  expireInMinutes: 10,
  retentionDays: 7,
  dlq: 'iee-dev-task__dlq',
},
```

### 3.2 Payload (zod-validated)

Defined once in `shared/iee/jobPayload.ts` and imported by both sides. Follows `docs/pgboss-zod-hardening-spec.md`.

```ts
import { z } from 'zod';

export const BrowserTaskPayload = z.object({
  type: z.literal('browser'),
  goal: z.string().min(1).max(2000),
  startUrl: z.string().url().optional(),
  sessionKey: z.string().min(1).max(128).optional(), // org- or subaccount-scoped
});

export const DevTaskPayload = z.object({
  type: z.literal('dev'),
  goal: z.string().min(1).max(2000),
  repoUrl: z.string().url().optional(),
  branch: z.string().max(200).optional(),
  commands: z.array(z.string().max(2000)).max(20).optional(),
});

export const IEEJobPayload = z.object({
  organisationId: z.string().uuid(),
  subaccountId: z.string().uuid().nullable(),
  agentId: z.string().uuid(),
  runId: z.string().uuid(),
  executionRunId: z.string().uuid(),           // row already inserted by app
  correlationId: z.string().min(1).max(64),
  idempotencyKey: z.string().min(1).max(128),
  task: z.discriminatedUnion('type', [BrowserTaskPayload, DevTaskPayload]),
});
export type IEEJobPayload = z.infer<typeof IEEJobPayload>;
```

The `executionRunId` field is critical: **the app inserts the `execution_runs` row before enqueueing the job**. The payload carries the id, and the worker updates that exact row. This keeps idempotency atomic at the database (not the queue) layer.

### 3.3 Enqueue path

A new service `server/services/ieeExecutionService.ts` owns enqueueing. It exposes:

```ts
enqueueIEETask(input: {
  task: BrowserTask | DevTask;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  runId: string;
  correlationId: string;
  idempotencyKey: string;
}): Promise<{ executionRunId: string; deduplicated: boolean }>;
```

Flow:
1. Validate `subaccountId` with existing `resolveSubaccount(subaccountId, organisationId)`.
2. Attempt `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`.
3. If nothing returned: `SELECT` the existing row and apply the table in §2.2.
4. If a fresh row was inserted: call `boss.send(JOB_IEE_BROWSER_TASK | JOB_IEE_DEV_TASK, payload, getJobConfig(...))`.
5. Emit `execution.start` event via tracing.
6. Return `{ executionRunId, deduplicated }`.

No retries, no ad-hoc retry policies — pg-boss handles that.

### 3.4 Worker subscription

Inside the worker, one `createWorker({ ... })` per job name. Concurrency is env-driven:

- `IEE_BROWSER_CONCURRENCY` (default `1`) — Playwright is heavy; 1 per worker is safe for v1.
- `IEE_DEV_CONCURRENCY` (default `2`).

`createWorker` is copied/shared from `server/lib/createWorker.ts`. **Decision:** move `createWorker.ts` into `shared/queue/` and re-export from the server so both processes can use the same helper. This is the only runtime helper moved to `shared/`, and it has no dependency on Express or the server DB layer.

---

## Part 4 — Worker Service Skeleton

### 4.1 Package layout

`worker/package.json`:

```jsonc
{
  "name": "automation-os-worker",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "pg-boss": "^10.x",          // match root version exactly
    "pg": "^8.11.0",
    "playwright": "^1.44.0",
    "zod": "^3.23.0",
    "drizzle-orm": "^0.x"        // match root
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^20.0.0",
    "@types/pg": "^8.0.0"
  }
}
```

**Version-pinning rule:** `pg-boss`, `drizzle-orm`, and `zod` MUST match the versions in the root `package.json` exactly. A mismatch will cause runtime incompatibility on the shared database schema and payload parsing. The worker's install step verifies this via a startup check in `bootstrap.ts`.

### 4.2 tsconfig

`worker/tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "sourceMap": true,
    "baseUrl": "."
  },
  "include": ["src/**/*", "../shared/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 4.3 Entry point

`worker/src/index.ts`:

```ts
import { bootstrap } from './bootstrap.js';
import { registerBrowserHandler } from './handlers/browserTask.js';
import { registerDevHandler } from './handlers/devTask.js';

async function main() {
  const { boss, logger, shutdown } = await bootstrap();
  await registerBrowserHandler(boss, logger);
  await registerDevHandler(boss, logger);
  logger.info('iee.worker.started', { pollIntervalMs: process.env.WORKER_POLL_INTERVAL_MS });

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('iee.worker.fatal', err);
  process.exit(1);
});
```

### 4.4 Bootstrap responsibilities

`worker/src/bootstrap.ts`:

1. Load env via `config/env.ts` (zod-validated, see 4.5).
2. Start pg-boss with `DATABASE_URL`, matching the main app's connection settings (SSL mode identical to `server/lib/pgBossInstance.ts`).
3. Initialise the Drizzle client against the same `DATABASE_URL`.
4. Initialise tracing (see Part 8).
5. Run a **compat check**: query `SELECT version()` on Postgres and log; query `pgboss.schema_version()` and compare against root package version; fail fast on mismatch.
6. Register SIGTERM/SIGINT handlers that call `boss.stop({ graceful: true })` and close the pool.
7. Return `{ boss, db, logger, shutdown }`.

### 4.5 Environment configuration

`worker/src/config/env.ts`:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  BROWSER_SESSION_DIR: z.string().default('/var/browser-sessions'),
  WORKSPACE_BASE_DIR: z.string().default('/tmp/workspaces'),
  MAX_STEPS_PER_EXECUTION: z.coerce.number().int().positive().default(25),
  MAX_EXECUTION_TIME_MS: z.coerce.number().int().positive().default(300_000),
  MAX_COMMAND_TIME_MS: z.coerce.number().int().positive().default(30_000),
  MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  IEE_BROWSER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  IEE_DEV_CONCURRENCY: z.coerce.number().int().positive().default(2),
  LLM_ROUTER_MODE: z.enum(['shared', 'http']).default('shared'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = EnvSchema.parse(process.env);
```

**`LLM_ROUTER_MODE` decision:** `shared` (default) means the worker imports and calls `routeCall()` directly from the server codebase (worker bundles the relevant services). This keeps the rule "no HTTP between worker and app" intact — the router is a **library**, not a service. The worker is co-located with a build of the router that talks to Postgres and the LLM providers directly. The worker does not need the main app running to work. `http` is reserved for a future if we ever want the worker to delegate via a hypothetical router HTTP endpoint — not implemented in v1.

### 4.6 Worker Dockerfile

`worker/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS build

WORKDIR /app

# Install shared + worker deps
COPY package*.json ./
COPY worker/package*.json ./worker/
COPY shared ./shared
COPY server/lib ./server/lib
COPY server/services/llmRouter.ts ./server/services/llmRouter.ts
# (Build-time copy list is finalised once router dependencies are fully traced.)

RUN cd worker && npm ci

COPY worker/tsconfig.json ./worker/
COPY worker/src ./worker/src

RUN cd worker && npm run build

# --- Runtime stage ---
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY --from=build /app/worker/dist ./dist
COPY --from=build /app/worker/node_modules ./node_modules
COPY --from=build /app/worker/package.json ./

# Ensure only Chromium is available (reduces image size)
RUN npx playwright install chromium --with-deps

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
```

> Build-time trace of `llmRouter.ts` transitive imports is a build chore called out in Part 10.2. If copying individual files becomes unwieldy, we fall back to a monorepo-style build that compiles the entire `server/` tree and tree-shakes the router.

### 4.7 `.dockerignore`

Identical content for `/.dockerignore` (app build) and `/worker/.dockerignore`:

```
node_modules
.git
.env
.env.*
dist
coverage
*.log
.DS_Store
.vscode
.idea
```

---

## Part 5 — Execution Loop, Observation & Action Schemas, LLM Integration

### 5.1 Loop contract

`worker/src/loop/executionLoop.ts` exports:

```ts
export async function runExecutionLoop(params: {
  run: ExecutionRunRow;
  payload: IEEJobPayload;
  executor: StepExecutor;   // browser or dev
  logger: Logger;
}): Promise<ResultSummary>;
```

Loop pseudocode:

```
mark run as running (UPDATE execution_runs SET status='running', startedAt=now())
emit trace event 'iee.execution.start'
deadline = now() + MAX_EXECUTION_TIME_MS
stepNumber = 0
previousSteps = []

while true:
  stepNumber += 1
  if stepNumber > MAX_STEPS_PER_EXECUTION: fail('step_limit_reached')
  if now() > deadline: fail('timeout')

  observation = await executor.observe()
  action = await llm.decideNextAction({
    goal, observation, previousSteps, stepBudgetRemaining, timeRemaining,
    availableActions
  })
  validateAction(action)   // zod; failure → 'execution_error'

  stepStart = now()
  try:
    result = await executor.execute(action)
    writeStep({ success: true, input: action, output: result, durationMs: ... })
    previousSteps.push(summarise(action, result))

    if action.type === 'done':
      return { success: true, output: action.summary, stepCount, durationMs, artifacts }
    if action.type === 'failed':
      return fail('execution_error', action.reason)
  catch (err):
    writeStep({ success: false, input: action, output: truncateError(err), ... })
    failureReason = classifyError(err)
    if isRetryableWithinLoop(failureReason) and stepBudget > 1: continue
    return fail(failureReason, err.message)
```

Any early return writes the terminal row update (`status`, `completedAt`, `failureReason`, `resultSummary`, `stepCount`).

### 5.2 StepExecutor interface

```ts
export interface StepExecutor {
  mode: 'browser' | 'dev';
  availableActions: readonly ExecutionAction['type'][];
  observe(): Promise<Observation>;
  execute(action: ExecutionAction): Promise<ActionResult>;
  dispose(): Promise<void>;
}
```

`BrowserStepExecutor` (Part 6) and `DevStepExecutor` (Part 7) both implement this. The loop does not know or care which it has.

### 5.3 Observation schema

Enforced exactly as in the brief §5.6. One zod schema in `shared/iee/observation.ts`:

```ts
export const Observation = z.object({
  url: z.string().url().optional(),
  pageText: z.string().max(8000).optional(),
  clickableElements: z.array(z.string().max(300)).max(80).optional(),
  inputs: z.array(z.string().max(300)).max(80).optional(),
  files: z.array(z.string().max(500)).max(100).optional(),
  lastCommandOutput: z.string().max(4000).optional(),
  lastCommandExitCode: z.number().int().optional(),
  lastActionResult: z.string().max(1000).optional(),
});
```

**Hard caps are enforced on the executor side**, not the LLM prompt. `pageText` is truncated with a centre-ellipsis (`"<start>...<end>"`) so both the top and tail of the page survive. `clickableElements` is limited to the first 80 in DOM order; the LLM is told in the system prompt that the list may be truncated and it can ask the executor for a different page region via an extraction action.

### 5.4 Action schema

Exactly as in the brief §5.7, encoded in `shared/iee/actionSchema.ts` as a discriminated union:

```ts
export const ExecutionAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'),    url: z.string().url() }),
  z.object({ type: z.literal('click'),       selector: z.string().min(1).max(500) }),
  z.object({ type: z.literal('type'),        selector: z.string().min(1).max(500), text: z.string().max(4000) }),
  z.object({ type: z.literal('extract'),     query: z.string().min(1).max(1000) }),
  z.object({ type: z.literal('download'),    selector: z.string().min(1).max(500) }),
  z.object({ type: z.literal('run_command'), command: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('write_file'),  path: z.string().min(1).max(1000), content: z.string().max(200_000) }),
  z.object({ type: z.literal('read_file'),   path: z.string().min(1).max(1000) }),
  z.object({ type: z.literal('git_clone'),   repoUrl: z.string().url(), branch: z.string().max(200).optional() }),
  z.object({ type: z.literal('git_commit'),  message: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('done'),        summary: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('failed'),      reason: z.string().min(1).max(1000) }),
]);
```

The `availableActions` set on each executor restricts this union per mode. If the LLM returns a `run_command` in a browser execution, the worker rejects it as `execution_error` without running it.

**`done` and `failed` are the only terminal actions.** Every other path out is enforced externally (step limit, timeout).

### 5.5 LLM integration

`worker/src/llm/routerClient.ts` is a thin wrapper that:

1. Imports `routeCall` from the bundled `server/services/llmRouter.js`.
2. Builds a `RouterCallParams` object with:
   - `system`: the IEE system prompt (see 5.6)
   - `messages`: a single user message containing the structured state
   - `tools`: **none** — the action is returned as strict JSON, not via tool calls, because we want a single uniform decoder for all providers the router may pick
   - `context`: `{ sourceType: 'iee', taskType: run.type, executionPhase: 'iee.loop.step', organisationId, subaccountId, runId, agentId, correlationId }`
3. Parses `response.content` as JSON, then validates against the `ExecutionAction` zod schema.
4. On parse failure, retries **once** with a repair message appended ("Your previous response was not valid JSON matching the action schema. Error: …"). A second failure classifies as `execution_error`.
5. All cost tracking, model selection, Langfuse generation creation — delegated entirely to the router.

**Why strict JSON instead of tool calls?** Tool calls add a provider-specific surface and couple the worker to a specific model family's tool-use format. A single JSON shape is simpler and the router can still pick any provider underneath.

### 5.6 System prompt (template)

Stored in `worker/src/loop/systemPrompt.ts` as a constant template. Variables: `{goal}`, `{availableActions}`, `{stepBudget}`, `{timeBudgetMs}`.

Key rules in the prompt (paraphrased for spec):

1. You are executing a controlled loop. Return exactly one JSON object matching the action schema.
2. Available action types are `{availableActions}`. Any other type is rejected.
3. After every step you will see a new observation. Plan one step at a time.
4. End the loop with `done` when the goal is complete, or `failed` with a reason if you cannot proceed.
5. Do not reference actions you have already taken unless the observation shows they failed or their effect was undone.
6. Hard budgets: `{stepBudget}` steps remaining, `{timeBudgetMs}`ms remaining.
7. Return ONLY the JSON object. No prose, no markdown fences, no commentary.

The full text lives in code and is version-controlled with the spec.

---

## Part 6 — Browser Execution Handler

### 6.1 Files

- `worker/src/handlers/browserTask.ts` — pg-boss subscription
- `worker/src/browser/playwrightContext.ts` — persistent context lifecycle
- `worker/src/browser/executor.ts` — `BrowserStepExecutor` implementation
- `worker/src/browser/observe.ts` — DOM extraction → `Observation`

### 6.2 Persistent context

Playwright is launched via `chromium.launchPersistentContext(userDataDir, options)`. The `userDataDir` is computed deterministically:

```
${BROWSER_SESSION_DIR}/${organisationId}/${sessionKey ?? 'default'}
```

Rules:
1. `sessionKey` is **scoped per organisation**. The directory layout guarantees no cross-tenant access — a path traversal attempt in `sessionKey` is rejected by a regex check (`/^[a-zA-Z0-9_-]{1,128}$/`).
2. If a `subaccountId` is present, the effective key is `${subaccountId}:${sessionKey ?? 'default'}` so subaccounts get isolated sessions even within the same org.
3. The directory is created with mode `0700` on first use.
4. One context per job. Contexts are **not pooled** in v1 (concurrency = 1 per worker).
5. Launch options: `headless: true`, `acceptDownloads: true`, `viewport: { width: 1280, height: 800 }`, `downloadsPath: ${WORKSPACE_BASE_DIR}/${runId}/downloads`.

### 6.3 Action implementations

| Action | Implementation |
|---|---|
| `navigate` | `page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })` |
| `click` | `page.locator(selector).first().click({ timeout: 10000 })` |
| `type` | `page.locator(selector).first().fill(text, { timeout: 10000 })` |
| `extract` | LLM-assisted: capture observation, then return the relevant region. The `query` field is recorded; the executor returns the current observation slice matching the query. (Heavy extraction is the LLM's job at the next step.) |
| `download` | Wrap click in `page.waitForEvent('download', { timeout: 30000 })`, save to downloads dir, write `executionArtifacts` row, return `{ path, sizeBytes }` |

Selector convention: prefer Playwright's text/role selectors (`text=Sign in`, `role=button[name="Submit"]`) — the system prompt instructs the LLM to use them.

### 6.4 Observation builder (`observe.ts`)

```ts
export async function buildObservation(page: Page, lastResult?: string): Promise<Observation> {
  const url = page.url();
  const pageText = await page.evaluate(() => document.body?.innerText ?? '');
  const clickable = await page.$$eval(
    'a, button, [role="button"], input[type="submit"]',
    (els) => els.map((e) => (e as HTMLElement).innerText?.trim() || (e as HTMLElement).getAttribute('aria-label') || '').filter(Boolean).slice(0, 80)
  );
  const inputs = await page.$$eval(
    'input, textarea, select',
    (els) => els.map((e) => (e as HTMLInputElement).name || (e as HTMLInputElement).id || (e as HTMLInputElement).placeholder || '').filter(Boolean).slice(0, 80)
  );
  return Observation.parse({
    url,
    pageText: truncateMiddle(pageText, 8000),
    clickableElements: clickable,
    inputs,
    lastActionResult: lastResult,
  });
}
```

### 6.5 Cleanup

- On loop termination (success or failure), `executor.dispose()` closes the page and the context.
- The `userDataDir` is **not** deleted — that's the persistent session.
- The `downloads` subdirectory is preserved only if at least one `executionArtifacts` row references files in it; otherwise removed.

### 6.6 Failure mapping (browser-specific)

| Source | `failureReason` |
|---|---|
| `page.goto` timeout | `environment_error` |
| Selector not found / click timeout | `execution_error` (LLM picked a wrong selector — recoverable next step) |
| Login wall detected (heuristic: redirect to known login URL pattern) | `auth_failure` |
| Browser crash | `environment_error` |
| Schema validation failure on action | `execution_error` |

---

## Part 7 — Dev Execution Handler

### 7.1 Files

- `worker/src/handlers/devTask.ts` — pg-boss subscription
- `worker/src/dev/workspace.ts` — workspace lifecycle
- `worker/src/dev/git.ts` — clone, commit
- `worker/src/dev/shell.ts` — `run_command`, `read_file`, `write_file`
- `worker/src/dev/executor.ts` — `DevStepExecutor`

### 7.2 Workspace

```
${WORKSPACE_BASE_DIR}/${runId}
```

- Created at the start of every job (`mkdir -p`, mode `0700`).
- **Always destroyed** at the end of the job (success or failure) via `fs.rm(dir, { recursive: true, force: true })` in a `try/finally`.
- The directory name is the `runId` (UUID), guaranteeing collision freedom.
- A symlink `current` is **not** created — there is no shared state between jobs in v1.

### 7.3 Path safety

Every `read_file` / `write_file` path is normalised and validated:

```ts
function resolveSafePath(workspaceDir: string, candidate: string): string {
  const resolved = path.resolve(workspaceDir, candidate);
  const rel = path.relative(workspaceDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SafetyError('path_outside_workspace');
  }
  return resolved;
}
```

`SafetyError` maps to `failureReason = 'execution_error'`. The validation runs **before** any filesystem call. Symlinks inside the workspace are dereferenced and re-checked against the workspace root after each write to detect symlink-escape attempts.

### 7.4 Command execution

`run_command` is implemented with `child_process.spawn`, never `exec`/`execSync`:

```ts
const child = spawn('/bin/sh', ['-lc', command], {
  cwd: workspaceDir,
  env: sanitisedEnv,    // see 7.5
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
});
```

Rules:
1. `cwd` is **always** the workspace dir. Never inherits from the parent process.
2. Wall-clock timeout per command = `MAX_COMMAND_TIME_MS` (default 30s). On timeout, the worker sends `SIGTERM`, waits 2s, then `SIGKILL`. Failure reason: `timeout`.
3. stdout and stderr are captured into ring buffers capped at 64 KiB each. Anything beyond is discarded with a `[truncated]` marker.
4. The exit code is returned with the result. Non-zero exit is recorded as `success: false` but does **not** auto-fail the loop — the LLM may decide to recover.
5. Background processes are forbidden by command-string inspection: any command containing unquoted `&` (other than `&&`/`&>`), `nohup`, `disown`, `setsid` is rejected as `execution_error` before spawn.
6. Denylist (rejected pre-spawn): commands starting with `sudo`, `su `, `rm -rf /`, `rm -rf /*`, `mkfs`, `dd if=`, `:(){`, `chown -R /`, `chmod -R / `, anything touching `/etc`, `/var`, `/root`, `/home/<other>`. The denylist is conservative and lives in `worker/src/dev/denylist.ts`.

### 7.5 Sanitised environment

The subprocess receives a minimal env:

```ts
const sanitisedEnv = {
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: workspaceDir,
  LANG: 'C.UTF-8',
  CI: 'true',
  // Plus any allowlisted vars from a per-org config (deferred — empty in v1)
};
```

`DATABASE_URL`, LLM API keys, and the worker's own secrets are **never** passed to subprocesses.

### 7.6 Git

- `git_clone`: `git clone --depth 1 [--branch <branch>] <repoUrl> <workspaceDir>/repo`. The repo URL must use `https://`. SSH URLs and `file://` are rejected.
- `git_commit`: runs in `<workspaceDir>/repo`. Author/email come from env (`IEE_GIT_AUTHOR_NAME`, `IEE_GIT_AUTHOR_EMAIL`, both with sane defaults). Push is **not** in v1 — commits stay local and are surfaced via `executionArtifacts` (a patch file is captured).
- Credentials for private repos are deferred to v2 (will use a per-org credential store).

### 7.7 Observation builder (dev)

```ts
async function buildDevObservation(workspaceDir: string, last: { output?: string; exitCode?: number }): Promise<Observation> {
  const files = await listFiles(workspaceDir, { maxDepth: 3, max: 100 });
  return Observation.parse({
    files,
    lastCommandOutput: last.output ? truncateMiddle(last.output, 4000) : undefined,
    lastCommandExitCode: last.exitCode,
  });
}
```

### 7.8 Failure mapping (dev-specific)

| Source | `failureReason` |
|---|---|
| Path outside workspace | `execution_error` |
| Denylisted command | `execution_error` |
| Command timeout | `timeout` |
| `git clone` network failure | `environment_error` |
| Disk full | `environment_error` |
| Unknown spawn error | `unknown` |

---

## Part 8 — Tracing, Logging & Failure Classification

### 8.1 Trace registry additions

Add to `server/lib/tracing.ts` (these names are imported by the worker via the shared module):

```ts
export const SPAN_NAMES = {
  ...existing,
  IEE_EXECUTION_RUN:  'iee.execution.run',
  IEE_EXECUTION_STEP: 'iee.execution.step',
} as const;

export const EVENT_NAMES = {
  ...existing,
  IEE_EXECUTION_START:         'iee.execution.start',
  IEE_EXECUTION_STEP_COMPLETE: 'iee.execution.step.complete',
  IEE_EXECUTION_STEP_FAILED:   'iee.execution.step.failed',
  IEE_EXECUTION_COMPLETE:      'iee.execution.complete',
  IEE_EXECUTION_FAILED:        'iee.execution.failed',
} as const;
```

### 8.2 Trace context propagation

The worker job handler is wrapped in `withTrace()`:

```ts
await withTrace(
  { correlationId: payload.correlationId },
  { runId: payload.runId, orgId: payload.organisationId, subaccountId: payload.subaccountId, agentId: payload.agentId },
  async () => runExecutionLoop(...)
);
```

Inside `withTrace`, every `createSpan` and `createEvent` automatically picks up the correlation/run context. The LLM router receives the same context via `LLMCallContext`, so router calls inside the loop are linked back to the parent span without manual stitching.

Span structure:

```
iee.execution.run                        (one per job)
├── iee.execution.step  (step 1)
│     └── llm.router.call               (router opens its own span)
├── iee.execution.step  (step 2)
│     └── llm.router.call
└── ...
```

### 8.3 Structured logging

Logger: a thin wrapper around `console` matching the existing `server/lib/logger.ts` shape (JSON one line per event, fields: `ts`, `level`, `msg`, `correlationId`, `runId`, `organisationId`, plus event-specific keys).

Required log lines (mirrors brief §13):

| Event | Log key | Fields |
|---|---|---|
| Job received | `iee.job.received` | `jobId`, `type`, `organisationId`, `runId`, `idempotencyKey` |
| Step start | `iee.step.start` | `stepNumber`, `actionType`, `inputSummary` (≤200 char) |
| Step complete | `iee.step.complete` | `stepNumber`, `success`, `outputSummary` (≤200 char), `durationMs` |
| Step failure | `iee.step.failed` | `stepNumber`, `failureReason`, `errorMessage` (≤500 char) |
| Execution complete | `iee.execution.complete` | `runId`, `stepCount`, `totalDurationMs`, `success` |
| Execution failed | `iee.execution.failed` | `runId`, `failureReason`, `lastStepNumber` |
| Worker start | `iee.worker.started` | `databaseHost` (host only, never full URL), `pollIntervalMs`, `concurrency` |

**Banned from logs:** full Playwright HTML, full command stdout, secrets, full DATABASE_URL. Truncate via the existing `truncateMiddle()` helper at 500 characters where these would otherwise appear.

### 8.4 Failure classification

`worker/src/loop/failureClassification.ts`:

```ts
export type FailureReason =
  | 'timeout'
  | 'step_limit_reached'
  | 'execution_error'
  | 'environment_error'
  | 'auth_failure'
  | 'unknown';

export function classifyError(err: unknown): FailureReason {
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof StepLimitError) return 'step_limit_reached';
  if (err instanceof SafetyError || err instanceof SchemaValidationError) return 'execution_error';
  if (err instanceof AuthRedirectError) return 'auth_failure';
  if (isEnvironmentError(err)) return 'environment_error';
  return 'unknown';
}
```

Rules:
1. The classifier is the **only** place that maps error types to `FailureReason`. Handlers throw typed errors; they never set `failureReason` directly.
2. Raw stack traces are **never** stored in the database. They are logged once at `iee.step.failed` and discarded.
3. The `resultSummary.output` may include a single short string explaining the failure for downstream agents, capped at 500 characters.

### 8.5 DLQ behaviour

A job that exhausts pg-boss retries lands in `iee-browser-task__dlq` / `iee-dev-task__dlq`. The DLQ is monitored by the existing job-monitoring infrastructure (no new monitor in v1). When a job hits the DLQ, the worker has already written `status='failed'` to the corresponding `execution_runs` row, so the queue and the table stay consistent.

---

## Part 9 — AgentExecutionService Routing & Action Registry

### 9.1 Routing detection

`server/services/agentExecutionService.ts` is extended with a small detection step. It does **not** intercept the existing `routeCall` flow — the IEE is a parallel execution path triggered by an explicit signal on the agent's task definition.

v1 detection rule (intentionally simple, explicit):

1. The agent's task descriptor (already passed to `agentExecutionService`) gains an optional `executionMode: 'api' | 'browser' | 'dev'` field. Default `'api'` (existing behaviour).
2. If `executionMode` is `'browser'` or `'dev'`, the service calls `ieeExecutionService.enqueueIEETask(...)` (Part 3.3) instead of running the standard tool/LLM dispatch loop.
3. The agent run is parked in `pending_iee` state. When the worker writes the terminal `execution_runs` row, an existing post-processor (the same one that handles long-running async tools today — to be confirmed during implementation) resumes the agent lifecycle and feeds `resultSummary` back as the next observation.
4. If no resume hook exists yet, a small `executionRunCompletionWatcher` is added — a pg-boss worker subscribed to `iee-execution-completed` job name, which the IEE worker fires after writing the terminal row. The main app handles that job and resumes the agent.

> **Open question for review:** confirm whether an async-tool resume mechanism already exists in `agentExecutionService`. If yes, reuse it. If no, the `executionRunCompletionWatcher` above is the fallback. This is the only ambiguous architectural decision in the spec; flagged for confirmation before implementation.

### 9.2 Idempotency key derivation

The `idempotencyKey` for an IEE task is derived (not random) so that retries of the same agent step do not double-execute:

```
sha256(
  organisationId + ':' +
  runId + ':' +
  agentId + ':' +
  taskHash         // stable hash of {type, goal, startUrl|repoUrl, branch, sessionKey}
)
```

This matches the pattern already used in `llmRouter.ts` for cost-record idempotency. The result is a 64-char hex string fitting the `idempotencyKey` column constraint.

### 9.3 Action registry decision (formal)

**Decision:** IEE execution-run sub-actions (`navigate`, `click`, `run_command`, etc.) are **not** registered in `server/config/actionRegistry.ts`.

**Rationale:**
- The action registry is the contract for tasks the platform schedules **on behalf of** an agent — the gating, parameter validation, and retry policy are applied at the registry level.
- IEE sub-actions are LLM-chosen mid-execution and should not be individually gateable. The reviewable unit is the **execution run** (the goal), not each click.
- v1 keeps the registry surface unchanged. A future addition of two registry entries — `iee_browser_task` and `iee_dev_task` — at the *task* level (not the sub-action level) is anticipated when gating becomes a requirement.

**Where this is documented in code:**
- `worker/src/actions/schema.ts` — top-of-file comment with rationale and a pointer back to this section.
- `server/config/actionRegistry.ts` — short comment near the bottom noting that IEE actions are intentionally absent and explaining when to add them.

### 9.4 Multi-tenant guard rails

The `enqueueIEETask` service:
1. Calls `resolveSubaccount(subaccountId, organisationId)` (existing helper) before insert. Mismatched subaccounts throw a `403`-equivalent service error.
2. Sets `organisationId` on every row (`execution_runs`, `execution_steps`, `execution_artifacts`).
3. The worker re-validates `organisationId` on every step write — a row whose `executionRunId` does not match the original `organisationId` is a hard error and aborts the job.

### 9.5 Files modified

| File | Change |
|---|---|
| `server/services/agentExecutionService.ts` | Add IEE routing branch |
| `server/services/ieeExecutionService.ts` | NEW — enqueue + idempotent insert |
| `server/config/jobConfig.ts` | Add `iee-browser-task`, `iee-dev-task` (+ DLQs) |
| `server/config/actionRegistry.ts` | Comment-only change (doc pointer) |
| `server/db/schema/executionRuns.ts` | NEW |
| `server/db/schema/executionSteps.ts` | NEW |
| `server/db/schema/executionArtifacts.ts` | NEW |
| `server/db/schema/index.ts` | Re-export new tables |
| `server/lib/tracing.ts` | Add new SPAN_NAMES / EVENT_NAMES |
| `migrations/NNNN_iee_execution_tables.sql` | NEW (Drizzle-generated) |

---

## Part 10 — Verification, MVP Acceptance & DigitalOcean Rollout

### 10.1 Verification commands

Per `CLAUDE.md` verification table:

| Trigger | Command | Where |
|---|---|---|
| Any TS change in worker | `cd worker && npm run typecheck` | worker/ |
| Any TS change in server | `npm run typecheck` | repo root |
| Schema change | `npm run db:generate` then review the migration file | repo root |
| Any code change | `npm run lint` | repo root |
| Logic change in server/ | `npm test` (or specific suite) | repo root |
| Worker logic change | `cd worker && npm test` (vitest, added in v1) | worker/ |
| Compose changes | `docker compose config` (validate) then `docker compose up --build` | repo root |

### 10.2 Build chore: tracing router imports for the worker

Before the worker Dockerfile copy list is finalised, run:

```bash
npx madge --extensions ts server/services/llmRouter.ts --json > /tmp/router-deps.json
```

The output is the exact set of files the worker must include in its build context. This is captured as a script `worker/scripts/trace-router-deps.mjs` that runs as part of `npm run build` and fails the build if a new transitive dependency appears outside an allowlist (so the Dockerfile copy list is kept honest).

### 10.3 Smoke tests (first run)

After `docker compose up --build -d`:

1. **Postgres health** — `docker compose exec postgres pg_isready` returns OK.
2. **Worker startup** — `docker compose logs worker | grep iee.worker.started` produces a single JSON line including `pollIntervalMs` and `concurrency`.
3. **Schema present** — `docker compose exec postgres psql -U postgres -d automation_os -c '\d execution_runs'` shows the table.
4. **End-to-end browser** — manual enqueue (via a small script `worker/scripts/enqueue-test-browser.mjs`) of a `goal: "open https://example.com and extract the page title"`. Expect: `execution_runs.status = 'completed'`, `resultSummary.success = true`, at least 2 steps written.
5. **End-to-end dev** — manual enqueue of a `goal: "git_clone <public repo>; read README.md; done"`. Expect: workspace created, cloned, file read, workspace destroyed after.
6. **Idempotency** — re-enqueue the same payload twice. Expect: only one row inserted, second call returns `deduplicated: true`.
7. **Crash survival** — `docker compose kill worker` mid-run. `docker compose start worker`. The job is redelivered by pg-boss; the worker either resumes (if `pending`) or aborts cleanly (if previous attempt set `running`). No corruption.

### 10.4 MVP acceptance checklist (mirrors brief §16)

- [ ] Browser job navigates and extracts data, writes structured result
- [ ] Dev job clones, modifies, runs a command, writes result
- [ ] correlationId propagation visible in tracing for every execution
- [ ] organisationId scoping enforced at the database (verified by a deliberate cross-tenant test that must fail)
- [ ] idempotencyKey uniqueness enforced at the index level (verified by a duplicate-insert test)
- [ ] Worker survives crash + restart (verified per 10.3 §7)
- [ ] `docker compose up` brings all three services online cleanly
- [ ] Same code base, only `DATABASE_URL` and path vars changed, runs against external Postgres

### 10.5 DigitalOcean VPS rollout

Once local acceptance passes:

1. **Provision VPS** — Ubuntu 22.04 LTS, minimum 4 GB RAM (Playwright is hungry), 2 vCPU, 40 GB SSD.
2. **Install Docker + Compose** — official `get-docker.sh` install. Add user to `docker` group. Verify `docker compose version` ≥ v2.
3. **Create Neon project** — copy the connection string with `?sslmode=require`. Run the app's `db:push` once from a developer machine to apply migrations against Neon.
4. **Deploy worker** — `git clone` the repo onto the VPS into `/opt/automation-os`. Create `/opt/automation-os/.env` with **only** the worker variables (the VPS does not run the app). Required:
   ```
   DATABASE_URL=postgresql://...neon...?sslmode=require
   BROWSER_SESSION_DIR=/var/browser-sessions
   WORKSPACE_BASE_DIR=/var/workspaces
   MAX_STEPS_PER_EXECUTION=25
   MAX_EXECUTION_TIME_MS=300000
   MAX_COMMAND_TIME_MS=30000
   MAX_RETRIES=3
   WORKER_POLL_INTERVAL_MS=1000
   IEE_BROWSER_CONCURRENCY=1
   IEE_DEV_CONCURRENCY=2
   ```
5. **Compose file for VPS** — a slimmed `docker-compose.vps.yml` that defines **only** the `worker` service (no `app`, no `postgres`). Same `worker_sessions` named volume. `restart: unless-stopped`.
6. **Boot** — `docker compose -f docker-compose.vps.yml up -d --build`. Tail `docker compose logs worker -f`.
7. **Configure Replit** — set the same `DATABASE_URL` in Replit Secrets, point at the Neon connection. Replit's app enqueues; the VPS worker consumes. No Replit-side code changes.
8. **Firewall** — VPS only needs **outbound** HTTPS (LLM providers, target sites, GitHub clones) and **outbound** Postgres (Neon). No inbound ports. Confirm `ufw` blocks all inbound.
9. **Backups** — Neon handles Postgres snapshots. The VPS has no stateful data except the `worker_sessions` volume; back this up via a nightly `tar.gz` to S3 or DO Spaces if browser-session loss is unacceptable.
10. **Monitoring** — log shipping is out of scope for v1; `docker compose logs --since 1h worker` is the v1 incident-response tool. Add a structured log shipper (e.g. Vector → Loki) in v2.

### 10.6 Rollback plan

If the IEE worker introduces issues in production:
1. `docker compose -f docker-compose.vps.yml down` on the VPS — worker stops consuming, jobs queue up in pg-boss safely.
2. Set a feature flag in the app (`IEE_ENABLED=false`) — `agentExecutionService` falls back to ignoring `executionMode='browser'|'dev'` and surfaces a clear "IEE disabled" error.
3. The new tables are additive — no rollback migration needed. Dropping them is safe but unnecessary.

---

## Appendix A — Open questions for review

1. **Async-tool resume hook** (Part 9.1): Does `agentExecutionService` already have a mechanism to resume an agent run from an external job-completion event? If yes, name and reuse it. If no, build the `executionRunCompletionWatcher` fallback.
2. **Existing pg-boss version**: Confirm the worker pins the exact same `pg-boss` major version as the root `package.json`.
3. **Tracing helper export shape**: Confirm `withTrace` and `createSpan` are exported in a way the worker can import without pulling in Express. May need a small `server/lib/tracing/core.ts` extraction.
4. **Drizzle client init in the worker**: Confirm whether the worker should reuse the same `server/db/client.ts` factory or build its own minimal one. Recommendation: minimal own factory with the same connection options.

## Appendix B — Out of scope (deferred)

- Multi-tab browser sessions
- Object-storage upload of artifacts (only metadata in v1)
- Per-org credential vault for git/site auth
- Sandbox isolation beyond denylist (Firejail / gVisor / DinD)
- Workspace persistence across jobs
- Parallel sub-steps within a single execution
- HTTP-mode LLM router (`LLM_ROUTER_MODE=http`)
- Action gating at the run-level (registry entries `iee_browser_task` / `iee_dev_task`)

---

## Part 11 — Cost Attribution (LLM + Runtime)

> Added in revision 2 in response to review feedback. Cost attribution is treated as a first-class concern, not a v2 afterthought, because the IEE is the first AutomationOS surface that meaningfully consumes infrastructure cost outside the LLM bill.

### 11.1 Two cost streams

| Stream | Source | Granularity | How it's captured |
|---|---|---|---|
| **LLM cost** | `routeCall()` per loop step | Per LLM call | Existing `llmRequests` table via the router (no IEE work needed) |
| **Runtime cost** | Worker container wall-clock | Per execution run | New `executionRuns.runtimeCost` columns + a usage-rollup job |

These are tracked separately and joined at reporting time. Runtime cost is the new piece.

### 11.2 LLM cost (already solved by the router)

The IEE introduces **zero new LLM cost-tracking code**. Because the worker calls `routeCall()` with full `LLMCallContext` (`organisationId`, `subaccountId`, `runId`, `agentId`, `correlationId`, `executionPhase: 'iee.loop.step'`), every loop step's LLM cost lands in the existing `llmRequests` table tagged with the IEE run.

To produce a per-run LLM total:

```sql
SELECT execution_run_id, SUM(cost_usd) AS llm_cost_usd, COUNT(*) AS llm_call_count
FROM llm_requests
WHERE source_type = 'iee'
GROUP BY execution_run_id;
```

(Schema column names will match the existing `llmRequests` shape — `source_type` and `execution_run_id` are added if not already present. Audit step in implementation: confirm `llmRequests` already carries a per-run correlation column. If not, add `executionRunId UUID NULL` to it as part of the IEE migration.)

A cached `executionRuns.llmCostUsd` is **denormalised** at run completion so list views don't need a join.

### 11.3 Runtime cost (new)

The worker's CPU/RAM time is real money on the DigitalOcean VPS. We attribute it per run.

#### 11.3.1 What we measure

Two things, both cheap:

1. **Wall-clock duration** — `completedAt - startedAt`, already on `executionRuns`.
2. **CPU+RAM-seconds** — sampled from `/proc/self/stat` and `/proc/self/status` at run start and end. Difference gives `cpuSeconds` and peak `rssBytes`.

For v1 we do **not** use cgroup-level accounting (it requires container-level access we'd rather not grant). The in-process numbers are accurate enough for charge-back at this stage.

#### 11.3.2 New columns on `executionRuns`

| Column | Type | Notes |
|---|---|---|
| `llmCostUsd` | `numeric(10,4)` nullable | Denormalised LLM total at completion |
| `llmCallCount` | `integer` not null, default 0 | |
| `runtimeWallMs` | `integer` nullable | Same as `completedAt - startedAt`, denormalised |
| `runtimeCpuMs` | `integer` nullable | From `process.cpuUsage()` delta (user + system) |
| `runtimePeakRssBytes` | `bigint` nullable | Peak RSS observed during run |
| `runtimeCostUsd` | `numeric(10,4)` nullable | Computed at completion — see 11.3.4 |
| `totalCostUsd` | `numeric(10,4)` nullable | `llmCostUsd + runtimeCostUsd` (generated column or app-computed) |

These are written **once** at the terminal status update (success or failure) so the worker doesn't pay an UPDATE per step.

#### 11.3.3 How the worker measures

```ts
// At run start
const cpuStart = process.cpuUsage();
const wallStart = Date.now();
let peakRss = process.memoryUsage().rss;

// Sampled cheaply at the end of every step
peakRss = Math.max(peakRss, process.memoryUsage().rss);

// At run completion
const cpuEnd = process.cpuUsage(cpuStart); // delta
const runtimeCpuMs = Math.round((cpuEnd.user + cpuEnd.system) / 1000);
const runtimeWallMs = Date.now() - wallStart;
```

This is in-process and ignores the cost of other concurrent jobs in the same worker. With `IEE_BROWSER_CONCURRENCY=1` and `IEE_DEV_CONCURRENCY=2` the error is small. The number is "good enough for charge-back," not "good enough for billing customers per millisecond."

#### 11.3.4 Pricing model (config-driven)

A new config file `server/config/runtimeCostConfig.ts`:

```ts
export const RUNTIME_COST_CONFIG = {
  // USD per CPU-second of worker time. Tunable per environment.
  // Local dev defaults to 0 so test runs don't show fake cost.
  cpuUsdPerSecond:    Number(process.env.IEE_COST_CPU_USD_PER_SEC    ?? '0'),
  // USD per GB-hour of RSS (rolled forward from VPS plan)
  memoryUsdPerGbHour: Number(process.env.IEE_COST_MEM_USD_PER_GB_HR  ?? '0'),
  // Flat fee per run to amortise idle/baseline VPS cost
  flatUsdPerRun:      Number(process.env.IEE_COST_FLAT_USD_PER_RUN   ?? '0'),
} as const;

export function computeRuntimeCostUsd(s: {
  cpuMs: number; wallMs: number; peakRssBytes: number;
}): number {
  const cpuSec  = s.cpuMs / 1000;
  const memGbHr = (s.peakRssBytes / 1024 ** 3) * (s.wallMs / 3_600_000);
  return (
    cpuSec  * RUNTIME_COST_CONFIG.cpuUsdPerSecond +
    memGbHr * RUNTIME_COST_CONFIG.memoryUsdPerGbHour +
    RUNTIME_COST_CONFIG.flatUsdPerRun
  );
}
```

Concrete defaults (production VPS):

- DO Premium 4 GB / 2 vCPU droplet ≈ $24/month ≈ $0.000009/CPU-second amortised, but in practice we use a chargeable rate that **2× the raw infra cost** so the platform recovers headroom for idle, backups, monitoring.
- Suggested production env values: `IEE_COST_CPU_USD_PER_SEC=0.00002`, `IEE_COST_MEM_USD_PER_GB_HR=0.04`, `IEE_COST_FLAT_USD_PER_RUN=0.001`.
- Local dev: all three default to `0` — local runs should never pollute reporting with fake numbers.

These rates are **not** baked into code. They live in env (so the VPS, Replit, and local dev each set their own) and in `runtimeCostConfig.ts` only as parsing logic.

#### 11.3.5 Daily rollup

A new pg-boss scheduled job `iee-cost-rollup-daily` (registered in `jobConfig.ts`, scheduled via existing scheduler infra) does:

```sql
INSERT INTO usage_rollups (organisation_id, day, source, llm_cost_usd, runtime_cost_usd, run_count)
SELECT
  organisation_id,
  date_trunc('day', completed_at) AS day,
  'iee',
  SUM(llm_cost_usd),
  SUM(runtime_cost_usd),
  COUNT(*)
FROM execution_runs
WHERE completed_at >= now() - interval '2 days'
  AND deleted_at IS NULL
GROUP BY 1, 2
ON CONFLICT (organisation_id, day, source) DO UPDATE
SET llm_cost_usd     = EXCLUDED.llm_cost_usd,
    runtime_cost_usd = EXCLUDED.runtime_cost_usd,
    run_count        = EXCLUDED.run_count;
```

The `usage_rollups` table is created as part of the IEE migration (or reused if an equivalent already exists — audit step). Reporting/billing reads from this table, never from `execution_runs` directly, so the live row stays cheap to update.

#### 11.3.6 Org-level budget guardrail

The existing `budgetGuardrail` processor (referenced in `server/processors/`) gains an IEE branch:

- Before `enqueueIEETask` accepts a job, it queries `usage_rollups` for the org's current-period cost (LLM + runtime, IEE only).
- If the org is over its budget, the enqueue is rejected with `failureReason: 'environment_error'` (or a new `'budget_exceeded'` if we extend the enum — recommended).
- The rejection writes a `pending` → `failed` row immediately so the agent run doesn't silently stall.

This needs **one new `FailureReason`**: `'budget_exceeded'`. Added to the enum in §10/§8.4.

### 11.4 What we deliberately do NOT track in v1

- Per-step CPU breakdown (cost is run-level only)
- Network egress bytes (DO charges flat-ish; not worth instrumenting)
- Disk I/O (negligible)
- LLM token-by-token live streaming attribution (router rolls up at request end)
- Cross-run amortisation of base VPS cost in real-time (the `flatUsdPerRun` is the v1 stand-in)

### 11.5 Integration with existing usage & billing

> Added in revision 3. IEE cost is **not** a parallel system. It plugs into the existing usage/billing surfaces at the data, service, API, and UI layers. A new line item ("IEE execution") joins existing line items ("LLM", others) in every place the user already sees cost.

#### 11.5.1 Audit (binding pre-implementation step)

Before writing any cost code, the implementer audits the current usage/billing system and records findings inline in `server/services/billingService.ts` (or wherever the existing service lives). Specifically:

- Existing usage table(s): name, columns, the `source` enum (or equivalent discriminator).
- Existing rollup cadence and job name.
- Existing per-org / per-subaccount budget enforcement entry point.
- Existing UI components: org billing page, subaccount billing page, system admin billing page.
- Existing API endpoints: `/api/billing/...`, `/api/orgs/:id/usage`, `/api/subaccounts/:id/usage`, etc.

The IEE plugs into these. **No new parallel billing tables, services, endpoints, or UI components are created** unless the audit confirms an equivalent does not exist.

#### 11.5.2 Data layer

- The `source` enum on the existing usage/rollup table gains the value `'iee'`. If the table currently splits LLM cost from other costs, the IEE writes to **both** the LLM line (via the existing router path — already handled) and a new runtime line tagged `'iee_runtime'`.
- If no `source` discriminator exists, one is added in the same migration as the IEE tables. The migration is reviewed before merge.
- Per-row scoping fields on usage rows already exist: `organisationId` (required), `subaccountId` (nullable). The IEE rollup writes both.

#### 11.5.3 Service layer

A single service method is the contract for "give me IEE cost":

```ts
// server/services/ieeUsageService.ts (NEW)
getIEECost(scope: {
  level: 'system' | 'organisation' | 'subaccount';
  organisationId?: string;       // required for 'organisation' and 'subaccount'
  subaccountId?: string;         // required for 'subaccount'
  from: Date;
  to: Date;
  groupBy?: 'day' | 'agent' | 'run';
}): Promise<IEECostBreakdown[]>;
```

Returns rows shaped:

```ts
interface IEECostBreakdown {
  bucket: string;             // ISO day, agent id, or run id depending on groupBy
  llmCostUsd: number;
  runtimeCostUsd: number;
  totalCostUsd: number;
  runCount: number;
  llmCallCount: number;
}
```

Permission rules (enforced at the service, not the route):

| Caller role | Allowed `level` | Org filter |
|---|---|---|
| System admin | `system`, `organisation`, `subaccount` | any org / any subaccount |
| Org admin | `organisation`, `subaccount` | their own org only; any subaccount within their org |
| Subaccount admin | `subaccount` | their own subaccount only |
| Other roles | none | — |

The existing permission middleware (`/api/my-permissions` model) is reused. New permission keys: `billing.iee.view.system`, `billing.iee.view.org`, `billing.iee.view.subaccount`. These map cleanly into the existing permission registry — **no new permission system**.

#### 11.5.4 API endpoints

Additive endpoints, mounted alongside existing billing routes (audit confirms exact prefix during implementation — likely `/api/billing/...`):

| Endpoint | Permission | Returns |
|---|---|---|
| `GET /api/billing/iee/system?from=&to=&groupBy=` | `billing.iee.view.system` | System-wide IEE cost |
| `GET /api/orgs/:orgId/billing/iee?from=&to=&groupBy=` | `billing.iee.view.org` (org-scoped) | Org IEE cost |
| `GET /api/subaccounts/:subaccountId/billing/iee?from=&to=&groupBy=` | `billing.iee.view.subaccount` (subaccount-scoped) | Subaccount IEE cost |
| `GET /api/executions/:runId/cost` | existing run-view permission | Single-run breakdown (LLM + runtime) |

All endpoints route through the existing `asyncHandler`, `authenticate`, and `resolveSubaccount(subaccountId, orgId)` patterns. Per-route org scoping is mandatory (CLAUDE.md rule).

#### 11.5.5 UI layer — three admin levels

The IEE cost is visible at every admin level the platform already exposes. **The same React components** that today render LLM cost are extended (not duplicated) to render IEE cost as an additional series/line/column.

| Level | Existing page | Change |
|---|---|---|
| **System admin** | System billing dashboard | Add "IEE execution" series to the cost breakdown chart and an "IEE" column to the per-org table. Add a drill-down list of recent IEE runs across all orgs (link to existing run detail). |
| **Org admin** | Org billing page (`/orgs/:id/billing`) | Add "IEE execution" series. Add a per-subaccount breakdown row showing IEE cost. Add a per-agent breakdown showing top IEE-spending agents. |
| **Subaccount admin** | Subaccount billing page (`/subaccounts/:id/billing`) | Add "IEE execution" series. Add a per-agent breakdown showing IEE-spending agents inside this subaccount. |
| **Run detail** | Existing execution / agent run detail page | New "Cost" panel showing `llmCostUsd`, `runtimeCostUsd`, `totalCostUsd`, step count, LLM call count. Visible to anyone who can see the run. |

UI implementation rules:

1. **No new top-level pages** for IEE billing. IEE is a *line item* on every existing billing surface, not a separate billing area. Users see the platform's total cost in one place, with IEE as one row.
2. The existing chart component is extended to accept multiple cost series (`llm`, `iee_runtime`, etc.). If it already supports this via the `source` enum from §11.5.2, no component change is needed beyond passing the new source through.
3. Date range, filtering, and CSV export already exist on these pages and automatically inherit IEE data.
4. The run-detail "Cost" panel reads from `executionRuns.llmCostUsd` / `runtimeCostUsd` / `totalCostUsd` directly — no API call beyond the existing run fetch.
5. Permissions gate visibility component-side via the existing `useMyPermissions()` hook (or equivalent) — the same hook that gates the existing billing pages.

#### 11.5.6 Billing/invoicing

If the existing billing system invoices customers monthly from the rollup table, IEE cost flows into invoices automatically once it's in the rollup with the right `source`. **No invoicing logic is duplicated.** Invoice line items render with the existing template; the new line label is "Integrated Execution Environment".

If the platform uses a third-party billing provider (Stripe metered billing, etc.) the implementer audits how LLM usage is reported today and uses the same path for IEE (likely a new metric ID). This is a wiring task, not new code.

#### 11.5.7 Real-time visibility

Per-run cost is visible **immediately** at run completion because it's denormalised onto `executionRuns`. Org/subaccount totals update at the next `iee-cost-rollup-daily` run, with an additional "current period (live)" view that sums uncommitted runs from `executionRuns` directly for the current day. The live view is bounded to "today" so the query stays cheap.

#### 11.5.8 Budget enforcement at all three levels

The existing budget guardrail (Part 11.3.6) is extended to support thresholds at each level:

- **System level:** a global IEE-cost ceiling per day (env-driven, prevents runaway across all orgs).
- **Org level:** per-org monthly budget configured in the existing org settings.
- **Subaccount level:** per-subaccount monthly budget configured in the existing subaccount settings.

`enqueueIEETask` checks all three in order (subaccount → org → system) and rejects with `failureReason: 'budget_exceeded'` at the first breach. The rejected run is written to `executionRuns` with `status='failed'` so it surfaces in the same UI views and the same alerting that already exist for billing breaches.

#### 11.5.9 Notifications

The existing billing notification channels (email, in-app, webhook — whichever exist) are reused: when an org or subaccount crosses 80% / 100% of its IEE budget, the existing notifier fires with the new "IEE execution" source. No new notifier code; only a new source string passed in.

### 11.6 v1 deferral list (cost-related)

- Per-step cost breakdown in the UI (run-level only)
- Real-time websocket push of cost as a run executes (rely on poll/refresh for v1)
- Cost forecasting and anomaly detection

### 11.7 Per-task cost drill-down (run detail)

> Added in revision 4 in response to follow-up: confirm that LLM costs and compute costs are visible *separately* on a single task, and that LLM costs incurred on the main-app side are distinguishable from LLM costs incurred inside the worker.

#### 11.7.1 The two LLM call sites

Both the main app and the worker call `routeCall()`. Without a discriminator they would land in `llmRequests` indistinguishably. To make the run-detail breakdown meaningful, the router context gains a `callSite` field:

```ts
// Extension to LLMCallContext (server/services/llmRouter.ts)
type CallSite = 'app' | 'worker';

interface LLMCallContext {
  // ...existing fields...
  callSite: CallSite;            // NEW — required
  executionRunId?: string;       // NEW — set when callSite = 'worker', or
                                 //       when an app-side call is part of an IEE run
}
```

Implementation rules:

1. Existing app-side callers default to `callSite: 'app'` via a wrapper — no caller code changes beyond a single helper update.
2. The worker's `routerClient.ts` always sets `callSite: 'worker'` and `executionRunId`.
3. The `llmRequests` table gains two columns: `call_site text not null default 'app'` and `execution_run_id uuid null` (indexed). Migration is part of the IEE migration set.
4. The `llmRequests.execution_run_id` index is partial (`WHERE execution_run_id IS NOT NULL`) to keep it cheap.

This means **every LLM call associated with an IEE run is queryable by run id, with the call site preserved.** An agent that does some preparatory LLM work in the app, then enqueues an IEE task, will show **both** rows of LLM cost on the same run-detail page, clearly separated.

#### 11.7.2 Run-detail Cost panel — exact contents

The Cost panel on the existing execution/agent-run detail page renders:

```
┌─ Cost ─────────────────────────────────────────────────────┐
│                                                            │
│  Total                                  $0.0421            │
│  ├─ LLM (app side)         3 calls      $0.0098            │
│  ├─ LLM (worker side)     12 calls      $0.0287            │
│  └─ Compute (worker)      48s wall      $0.0036            │
│                          12.4 CPU-s                        │
│                          312 MB peak                       │
│                                                            │
│  Steps: 12   Duration: 48s                                 │
│                                                            │
│  [ View LLM call breakdown ▾ ]                             │
└────────────────────────────────────────────────────────────┘
```

Data sources:
- **LLM (app side)** — `SUM(cost_usd), COUNT(*) FROM llm_requests WHERE execution_run_id = $1 AND call_site = 'app'`
- **LLM (worker side)** — `SUM(cost_usd), COUNT(*) FROM llm_requests WHERE execution_run_id = $1 AND call_site = 'worker'`
- **Compute (worker)** — `runtimeCostUsd`, `runtimeWallMs`, `runtimeCpuMs`, `runtimePeakRssBytes` from `executionRuns` (denormalised at completion)
- **Total** — `totalCostUsd` from `executionRuns` (sum of all three)

> Important: `executionRuns.llmCostUsd` is the **sum of both call sites** for that run, so the displayed total reconciles. The split is computed by joining `llm_requests` on demand for the panel; the denormalised columns are still the source of truth for rollup tables.

Expanding **View LLM call breakdown** reveals a per-call list (timestamp, call site, model, prompt tokens, completion tokens, cost). This reuses the existing LLM-call detail component if one exists; otherwise it's a small new table component. Audit step during implementation.

API endpoint:

```
GET /api/executions/:runId/cost
→ {
    total: { usd, ... },
    llm: {
      app:    { usd, callCount },
      worker: { usd, callCount },
    },
    compute: {
      usd, wallMs, cpuMs, peakRssBytes,
    },
    steps: number,
    durationMs: number,
  }

GET /api/executions/:runId/cost/llm-calls?limit=50&offset=0
→ paginated llm_requests rows for this run
```

Permissions: anyone who can see the run can see its cost panel. This reuses the existing run-view permission check — no new permission key for the panel itself.

#### 11.7.3 What this guarantees

The user's question — *"Can we see LLM costs on the server side, plus compute costs and LLM costs on the worker side, separately?"* — answer: **yes, on the run-detail page, in a single panel, with three distinct lines (app LLM / worker LLM / worker compute) and a reconciled total.** Confirmed.

### 11.8 Aggregated Usage Explorer page

> Added in revision 4 in response to follow-up: a single dedicated usage/cost page reused across system, organisation, and subaccount scopes, with proper filters, search, sort, and pagination.

#### 11.8.1 Single page, three scopes

One React route, mounted at three different URLs:

| Scope | Route | Required permission |
|---|---|---|
| System | `/admin/usage` | `billing.iee.view.system` |
| Organisation | `/orgs/:orgId/usage` | `billing.iee.view.org` (org-scoped) |
| Subaccount | `/subaccounts/:subaccountId/usage` | `billing.iee.view.subaccount` |

The page is a single component `UsageExplorer.tsx` parameterised by scope. Layout, filters, sort, search, export — all identical across scopes. Only the data the user can see changes (enforced server-side).

This is *additional* to the line-item additions on existing billing dashboards (§11.5.5). Those remain — the dashboard gives an at-a-glance view; the Usage Explorer is the deep-dive surface.

#### 11.8.2 Page layout

```
┌─ Usage Explorer ───────────────────────────────────────────┐
│  Scope: [Org: Acme ▾]                          [Export ⬇] │
│                                                            │
│  ┌─ Filters ─────────────────────────────────────────────┐ │
│  │ Date range:  [Last 30 days ▾]   From [    ] To [    ]│ │
│  │ Source:      [☑ LLM (app)] [☑ LLM (worker)] [☑ Comp]│ │
│  │ Subaccount:  [All ▾]    Agent: [All ▾]               │ │
│  │ Status:      [All ▾]    Type: [browser/dev/api ▾]    │ │
│  │ Min cost:    [    ]     Search: [goal contains... ]  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  Summary cards:                                            │
│   Total: $X     LLM-app: $A     LLM-worker: $B            │
│   Compute: $C   Runs: N         Avg/run: $X/N             │
│                                                            │
│  ┌─ Cost over time chart (stacked: app/worker/compute) ──┐│
│  └───────────────────────────────────────────────────────┘│
│                                                            │
│  ┌─ Runs table ─────────────────────────────────────────┐ │
│  │ Started ↓ │ Agent │ Type │ Status │ Steps │ LLM-app │ │
│  │           │       │      │        │       │ LLM-wkr │ │
│  │           │       │      │        │       │ Compute │ │
│  │           │       │      │        │       │ Total ↓ │ │
│  │  [pageable, sortable, click row → run detail]        │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

#### 11.8.3 Filters (all combinable)

| Filter | Type | Notes |
|---|---|---|
| Date range | preset (today / 7d / 30d / 90d / MTD / custom) | Server enforces a 1-year max window |
| Cost source | multi-select: `llm_app`, `llm_worker`, `compute` | At least one must be selected |
| Subaccount | dropdown | Visible only at system + org scopes; auto-bound at subaccount scope |
| Agent | dropdown (multi-select) | Filtered to agents in the current scope |
| Status | multi-select: `pending`, `running`, `completed`, `failed` | |
| Execution type | multi-select: `browser`, `dev`, `api` | |
| Failure reason | multi-select | Visible only when `failed` status is selected |
| Min cost | number input (USD) | Hides runs below threshold |
| Goal search | text input | Server-side `ILIKE` on `executionRuns.goal`, debounced 300ms client-side |
| Run id | text input | Exact match jump |

All filters are URL query parameters so views are linkable and shareable.

#### 11.8.4 Sorting + pagination

- Sort columns: `startedAt` (default DESC), `totalCostUsd`, `llmCostUsd`, `runtimeCostUsd`, `stepCount`, `durationMs`. Click column header to toggle asc/desc.
- Pagination: cursor-based (the existing pattern in `server/routes/`). Default page size 50, max 200. Page size selectable by the user.
- "Load more" infinite scroll OR classic pager — match the existing pattern in the rest of the admin UI (audit step). Don't invent a new pagination style.

#### 11.8.5 Export

CSV and JSON export buttons. Export respects the active filters. Server enforces a 50,000-row export ceiling (export of larger sets requires the existing async-export job pattern, if one exists — audit). Filename: `iee-usage-{scope}-{from}-{to}.csv`.

#### 11.8.6 API endpoint

A single endpoint backs the page:

```
GET /api/usage/iee?
   scope=system|organisation|subaccount
   &organisationId=<uuid>          (required for organisation/subaccount)
   &subaccountId=<uuid>            (required for subaccount)
   &from=<iso>&to=<iso>
   &sources=llm_app,llm_worker,compute
   &agentIds=<uuid>,<uuid>
   &subaccountIds=<uuid>,<uuid>    (system/org scope only)
   &statuses=completed,failed
   &types=browser,dev
   &failureReasons=timeout,...
   &minCostUsd=0.01
   &search=<text>
   &sort=startedAt|totalCostUsd|...
   &order=asc|desc
   &cursor=<opaque>
   &limit=50

→ {
    summary: {
       total: { usd, runCount },
       llmApp:    { usd, callCount },
       llmWorker: { usd, callCount },
       compute:   { usd, cpuMs, wallMs },
    },
    series: [                           // for the chart
       { day: '2026-04-01', llmApp, llmWorker, compute }, ...
    ],
    rows: [
       { id, startedAt, agentId, agentName, type, status,
         stepCount, durationMs, llmAppUsd, llmWorkerUsd,
         computeUsd, totalUsd, failureReason }, ...
    ],
    nextCursor: <opaque|null>,
  }
```

The endpoint is permission-gated by scope:
- System scope → `billing.iee.view.system`
- Organisation scope → `billing.iee.view.org` AND `organisationId` matches caller's org (system admin bypasses)
- Subaccount scope → `billing.iee.view.subaccount` AND `resolveSubaccount(subaccountId, orgId)` succeeds

The service method behind it is the existing `ieeUsageService.getIEECost(...)` extended with filter/sort/pagination params, OR a new `ieeUsageService.queryUsage(...)` if the existing signature gets too wide. Implementation choice during build.

#### 11.8.7 Performance

- Summary card numbers come from `usage_rollups` when the date range aligns with day boundaries; otherwise from a live aggregate over `execution_runs`.
- The runs table query is bounded by an index on `(organisation_id, started_at DESC)` already required by §2.1.1.
- Server-side cap: any single query touching > 100,000 `execution_runs` rows returns a 400 with "narrow your filters" — prevents accidental denial of service from a date range covering years.
- The chart series is downsampled server-side to ≤ 90 buckets regardless of date range (day → week → month bucketing automatic).

#### 11.8.8 Navigation placement

The Usage Explorer is reachable from the **left navigation** at every scope, **not** from Settings. Treat it as a first-class top-level destination.

| Scope | Nav location | Label | Icon |
|---|---|---|---|
| System admin | System admin left nav, top-level item | "Usage" | line/bar chart icon (match existing nav iconography) |
| Organisation | Organisation left nav, top-level item | "Usage" | same icon |
| Subaccount | Subaccount left nav, top-level item | "Usage" | same icon |

Rules:

1. **Top-level item, not nested under Settings or Billing.** It is its own entry. If the existing nav has a "Billing" group, "Usage" sits as a sibling, not a child.
2. **Visibility is permission-gated** via the existing nav permission mechanism: each entry only renders when the user holds the corresponding `billing.iee.view.{system|org|subaccount}` permission. Users without permission do not see the item at all.
3. **Active state** uses the existing nav active-state styling. Route matching is on the page route prefix (`/admin/usage`, `/orgs/:orgId/usage`, `/subaccounts/:subaccountId/usage`).
4. **Order in the nav:** placed near the bottom of the primary nav group, above any administrative/settings items, so it sits in the "operational data" cluster (Runs, Agents, Usage) rather than the "configuration" cluster.
5. **No duplicate entry under Settings.** If a user reaches Settings → Billing today, that page keeps the line-item additions from §11.5.5 and gains a "View detailed usage →" link that deep-links to the Usage Explorer for the current scope. The link is convenience-only; the canonical entry point is the left nav.
6. The nav entries are added in the same files that already define the nav for each scope (audit step during implementation — likely `client/src/components/nav/SystemNav.tsx`, `OrgNav.tsx`, `SubaccountNav.tsx` or equivalent). No new nav primitives.

#### 11.8.9 What this guarantees

The user's question — *"Aggregated billing page viewable at subaccount/org/system level, with filters, ordering, search — is that included?"* — answer: **yes, as a single Usage Explorer page mounted at three URLs with scope-scoped permissions, full filter/search/sort/export, and a unified API endpoint.** Confirmed.

### 11.9 Updated audit checklist (revision 4)

In addition to §11.5.1 audit items, before implementation the builder must also confirm:

- [ ] Whether `llmRequests` already has a `call_site` or equivalent column. If yes, reuse. If no, add via the IEE migration.
- [ ] Whether `llmRequests` already has an `executionRunId` / `runId` correlation column. If yes, confirm shape. If no, add.
- [ ] Existing pagination pattern in admin tables (cursor vs. offset). Match it in the Usage Explorer.
- [ ] Existing export pattern (sync download vs. async job). Match it.
- [ ] Existing chart/series component(s). Reuse, don't reinvent.
- [ ] Existing filter UI primitives (date pickers, multi-selects). Reuse.

---

## Part 12 — Risk Tightening (review feedback)

> Added in revision 2. Each subsection corresponds to a specific risk raised in review and lists the exact spec changes that mitigate it. Builders should treat these as binding.

### 12.1 LLM JSON brittleness — never hang the loop

Supersedes Part 5.5 §4. Final rules:

1. The router response is JSON-parsed and zod-validated.
2. **First failure** (parse or validation): one retry with a repair prompt appended.
3. **Second failure**: the worker synthesises a `{ type: 'failed', reason: 'llm_invalid_json' }` action **on the LLM's behalf** and treats it as a normal terminal `failed` action. The loop terminates cleanly with `failureReason: 'execution_error'` and a `resultSummary.output` of `"LLM failed to produce a valid action after 2 attempts"`.
4. The loop **must never** loop on parse errors. Two strikes and out.
5. Hard rule, restated in code as a comment in `executionLoop.ts`: *"The execution loop has exactly four exit paths: `done`, `failed` (real or synthesised), step limit, timeout. There is no fifth."*

### 12.2 Browser selector fallback

Supersedes Part 6.3 (`click` and `type` rows). Final behaviour:

```
1. Try the LLM-supplied selector with a 5s timeout
2. On failure, if the selector looks like a CSS/role/text selector,
   try once more with the same selector wrapped in Playwright's
   text-fallback heuristic:
     - if selector starts with "text=" → unchanged
     - else → also try `text="${innerTextOfTarget}"` if the LLM
       provided a `fallbackText` field, OR
     - try `:has-text("${selector}")` as a last resort
3. If both fail, record the step as failed (recoverable next loop)
   with an `output.hint` of "selector_not_found; LLM should retry
   with text= or role= form"
```

The action schema is extended (additive, no breaking change) to allow an optional `fallbackText` on `click` and `type`:

```ts
{ type: 'click', selector: string, fallbackText?: string }
{ type: 'type',  selector: string, text: string, fallbackText?: string }
```

The system prompt is updated to instruct the LLM to populate `fallbackText` whenever possible.

### 12.3 Workspace + browser-session disk growth

A new periodic job `iee-cleanup-orphans` (pg-boss scheduled, every 6 hours):

1. Scans `${WORKSPACE_BASE_DIR}` for directories whose name (UUID) does not appear in `execution_runs` with `status IN ('pending','running')`. Deletes anything older than 1 hour.
2. Scans `${BROWSER_SESSION_DIR}` and reports (does NOT delete) sessions older than `IEE_SESSION_TTL_DAYS` (default 30, env-driven). Deletion of stale sessions is **opt-in** via `IEE_SESSION_AUTO_PRUNE=true` (default `false` in v1) because losing an authenticated session has user-visible consequences.
3. Logs every deletion with `iee.cleanup.orphan_removed` so we can audit.

The cleanup job is registered alongside the cost rollup in `jobConfig.ts`.

### 12.4 Browser session lifecycle (explicit deferral)

Beyond the orphan-scan above, **active session lifecycle management** (TTL on healthy sessions, automatic re-auth, session pooling, multi-account session switching) is **explicitly deferred to v2**. Documented here so it isn't forgotten.

### 12.5 Worker build dependency on `llmRouter.ts`

Reinforces Part 4.6 / 10.2:

1. `npx madge` runs as a **build-time check** in `worker/scripts/trace-router-deps.mjs`. The script writes the dep list to `worker/.router-deps.lock.json`. If the live dep set diverges from the lock file, the build fails with a clear message.
2. **Escape hatch:** if the dep graph becomes unmanageable (rule of thumb: more than 30 transitive files outside `server/lib` and `server/services`), the worker switches to building the entire `server/` tree with `tsc` and importing the compiled router from `dist/server/services/llmRouter.js`. The Dockerfile gets a second build stage that runs the full server build. The rest of the worker is unaffected.
3. The escape hatch is **a deliberate fallback, not a "later" item** — it's documented and the second-stage Dockerfile lives in the repo as `worker/Dockerfile.fullserver`, ungated. Switching is one line in `docker-compose.yml`.

### 12.6 Implicit per-run LLM call cap

Restated for clarity:

> The execution loop calls the LLM at most once per step. Step count is hard-capped by `MAX_STEPS_PER_EXECUTION`. Therefore the maximum number of LLM calls per execution run is exactly `MAX_STEPS_PER_EXECUTION + 1` (the `+1` accounts for the single repair retry on a JSON failure). There is no path where the loop calls the LLM more than this.

This guarantees a hard ceiling on per-run LLM cost regardless of LLM behaviour.

### 12.7 Graceful degradation — no run is left in `running`

Hard invariant added to Part 5.1:

> Every execution loop is wrapped in `try { … } finally { … }`. The `finally` block guarantees a terminal status write to `execution_runs`. If the worker process is killed mid-step (SIGKILL, OOM), the `pending → running → completed/failed` state machine is reconciled by the worker's startup scan: any `running` row whose worker is no longer alive (detected via a `workerInstanceId` column with a heartbeat) is moved to `failed` with `failureReason: 'environment_error'` on next worker start.

This adds two more columns to `executionRuns`:

| Column | Type | Notes |
|---|---|---|
| `workerInstanceId` | `text` nullable | UUID per worker process; set on `running` |
| `lastHeartbeatAt` | `timestamp(tz)` nullable | Updated by worker every 10s while a job runs |

A worker startup scan on boot reconciles abandoned `running` rows whose `lastHeartbeatAt` is older than 60s and whose `workerInstanceId` is not the current worker.

### 12.8 Result summary additions

`ResultSummary` (Part 5) gains:

```ts
interface ResultSummary {
  success: boolean
  output?: any
  artifacts?: string[]
  stepCount: number
  durationMs: number
  confidence?: number       // 0..1, set by 'done' action when LLM provides one (optional)
  llmCostUsd?: number       // copied from executionRuns at completion
  runtimeCostUsd?: number
}
```

The `done` action gains an optional `confidence` field:

```ts
{ type: 'done', summary: string, confidence?: number /* 0..1 */ }
```

Forward-compatible: agents that ignore the field continue to work.

### 12.9 Step history compression

The history passed to the LLM at each step is **summarised**, not raw:

- For each previous step, the LLM sees `{ stepNumber, actionType, success, summary }` where `summary` is a ≤200-char string built by the executor (browser: "navigated to <url>", "clicked <selector>"; dev: "ran `<cmd>` exit=<code>").
- Raw step inputs/outputs are **not** included in the LLM context — they are persisted to `execution_steps` for audit but not echoed back.
- This keeps the prompt size O(stepNumber × 200 chars) instead of O(stepNumber × full payload).

### 12.10 Failure-state invariants (single source of truth)

A short list, treat as binding:

1. No `execution_runs` row may be left in `running` after the worker that owned it dies.
2. No execution may exit the loop without a `failureReason` set when `status = 'failed'`.
3. No path inside a worker subprocess may write outside its workspace.
4. No log line may contain a secret, full DATABASE_URL, or full Playwright HTML.
5. No LLM call may occur without a valid `LLMCallContext` carrying `organisationId`.
6. No new `execution_runs` row may be inserted with a duplicate `idempotencyKey` (enforced at index level — application code does not check first).
7. The execution loop has exactly four exit paths (Part 12.1).

---

## Part 13 — Robustness Hardening (rev 6)

> Added in revision 6 in response to a second round of review. Six small but binding changes that close real failure modes in the design as previously written. None of these are speculative; each maps to a concrete way the system would otherwise drift, race, or silently corrupt.

### 13.1 `executionRunId` enforcement at the router boundary

**Risk:** Cost attribution depends on every IEE-originated LLM call carrying `executionRunId`. A single forgotten path silently breaks per-run cost reporting and the §11.7 drill-down panel.

**Fix — two layers:**

1. **Router-level guard** in `server/services/llmRouter.ts::routeCall`:

   ```ts
   if (params.context.sourceType === 'iee' && !params.context.executionRunId) {
     throw new Error('llmRouter: executionRunId is required when sourceType="iee"');
   }
   if (params.context.callSite === 'worker' && !params.context.executionRunId) {
     throw new Error('llmRouter: executionRunId is required when callSite="worker"');
   }
   ```

   This is the **only** place the rule lives. Callers cannot accidentally bypass it.

2. **Database CHECK constraint** on `llmRequests`, added in the IEE migration:

   ```sql
   ALTER TABLE llm_requests
     ADD CONSTRAINT llm_requests_iee_requires_run_id
     CHECK (source_type <> 'iee' OR execution_run_id IS NOT NULL);
   ```

   Belt and braces. Even if a future code path forgets the router guard (e.g. raw insert from a migration script), the database refuses the row.

The combination guarantees that **any LLM cost row tagged `iee` is queryable by `executionRunId`** — which is the integrity invariant the §11.7 drill-down depends on.

### 13.2 Budget reservation (race-condition fix)

**Risk:** §11.5.8 budget guardrail checks `actual <= limit` at enqueue time. Ten jobs enqueued in the same second all see "actual is fine" and all run, blowing the budget.

**Fix — soft reservation pattern:**

1. New column on `executionRuns`:

   | Column | Type | Notes |
   |---|---|---|
   | `reservedCostUsd` | `numeric(10,4)` not null, default `0` | Set at enqueue, cleared at completion |

2. **Estimation at enqueue:**

   ```ts
   // server/services/ieeUsageService.ts
   function estimateCostUsd(task: BrowserTask | DevTask): number {
     const avgLlmCostPerStep = 0.005;   // tunable, env-driven (IEE_AVG_LLM_COST_PER_STEP)
     const avgRuntimeCostPerRun = 0.002;
     return MAX_STEPS_PER_EXECUTION * avgLlmCostPerStep + avgRuntimeCostPerRun;
   }
   ```

   The averages live in `runtimeCostConfig.ts` alongside the runtime pricing model. They are conservative — better to over-reserve and reject a job than to under-reserve and silently overspend.

3. **Budget check (revised):**

   ```ts
   const usedUsd     = await sumActualCostForPeriod(orgId, period);
   const reservedUsd = await sumReservedCostForPeriod(orgId, period);
   const estimated   = estimateCostUsd(task);
   if (usedUsd + reservedUsd + estimated > limitUsd) {
     throw budgetExceeded();
   }
   ```

   This check is wrapped in the same transaction as the `INSERT INTO execution_runs ... reservedCostUsd = $estimated` so the reservation is visible to the next enqueue attempt immediately. Postgres serialisable isolation is **not** required — the read-then-insert is acceptable because the worst case is a single over-shoot of one estimate-sized job, not unbounded blow-out.

4. **At run completion:**

   ```sql
   UPDATE execution_runs
     SET status = $status,
         llm_cost_usd = $llm,
         runtime_cost_usd = $runtime,
         total_cost_usd = $total,
         reserved_cost_usd = 0   -- release reservation
     WHERE id = $runId;
   ```

   Reservation is released atomically with the actual cost write.

5. **Stale reservation cleanup:** The existing `iee-cleanup-orphans` job (§12.3) is extended to also zero out `reservedCostUsd` for any row whose status is terminal (`completed` / `failed`) but still has a non-zero reservation — a defensive cleanup for crash scenarios.

### 13.3 Heartbeat in a separate interval loop

**Risk:** §12.7 specified a 10s heartbeat with a 60s death threshold. If a Playwright `page.goto` blocks the event loop for >60s on a slow page, the worker would falsely declare itself dead and fail otherwise-healthy runs.

**Fix:**

1. Heartbeat is driven by `setInterval`, **not** by step boundaries:

   ```ts
   // worker/src/loop/heartbeat.ts
   export function startHeartbeat(executionRunId: string, db: Db): () => void {
     const interval = setInterval(async () => {
       await db.execute(sql`
         UPDATE execution_runs
            SET last_heartbeat_at = now()
          WHERE id = ${executionRunId}
       `);
     }, 10_000);
     interval.unref();
     return () => clearInterval(interval);
   }
   ```

2. The heartbeat lives on the **Node.js timer loop**, which fires even while the worker is awaiting an async Playwright call. It only stalls if the entire process is hung — which is exactly when we *do* want to fail it over.

3. The death threshold stays at 60s. The reconciliation scan (worker boot) still moves abandoned `running` rows to `failed` with `failureReason: 'environment_error'` if `now() - lastHeartbeatAt > 60s` AND `workerInstanceId != currentWorkerInstanceId`.

4. The heartbeat handle is started in the loop's `try` block and **always** cleared in the `finally` block, paired with the terminal status write.

### 13.4 System-prompt anti-stagnation rule

**Risk:** Long-running loops where the LLM keeps trying minor variations of the same failed action without progress — burning steps and budget.

**Fix — additive rule in the system prompt** (no schema or code change):

> "After every step, briefly assess whether the last action moved you closer to the goal. If three consecutive steps have produced no observable progress (no new information, no state change toward the goal), choose a fundamentally different strategy on the next step or call `failed` with a clear reason. Do not repeat near-identical actions."

The worker does **not** enforce this programmatically — that would require LLM-side reasoning the worker can't easily inspect. The rule lives in the prompt and is reinforced by the budgeted loop ceiling (`MAX_STEPS_PER_EXECUTION` is the hard backstop).

The system prompt template in `worker/src/loop/systemPrompt.ts` is updated. No code change beyond that string.

### 13.5 Dev command execution hardening

**Risk:** §7.4 denylist blocks literal patterns like `sudo` and `rm -rf /`, but shell parsing allows trivial evasions: `echo rm -rf / | sh`, `$(rm -rf /)`, backticks, etc.

**Fix — three layers:**

1. **Reject command-substitution syntax pre-spawn.** The denylist gains reject patterns:

   ```ts
   // worker/src/dev/denylist.ts
   const REJECT_PATTERNS = [
     /\$\(/,         // $( command substitution
     /`/,            // backtick command substitution
     /<\(/,          // process substitution
     /\beval\b/,     // eval
     /\bexec\s/,     // exec replacement of shell
     // ...existing literal denylist...
   ];
   ```

2. **Wrap commands in a hardened shell invocation:**

   ```ts
   spawn('bash', [
     '-lc',
     'set -euo pipefail; ' + command,
   ], {
     cwd: workspaceDir,
     env: sanitisedEnv,
     stdio: ['ignore', 'pipe', 'pipe'],
   });
   ```

   `set -euo pipefail` makes failures loud and pipelines safer. `bash` (not `/bin/sh`) is required for `pipefail`. The Playwright base image includes bash.

3. **The denylist is a defence-in-depth layer, not the primary safety net.** The primary safety net remains the workspace path validation (§7.3) — even if a command escapes the denylist, it cannot write outside its workspace because the workspace path resolver runs **before** any filesystem call originating from a worker action, and the subprocess inherits the workspace as its `cwd` and has no privilege to modify host paths via the sanitised PATH and dropped HOME.

> v1 explicitly does **not** sandbox the subprocess (no Firejail, no gVisor, no Docker-in-Docker — see §15). The combination of denylist + path validation + sanitised env + workspace cwd is the v1 safety boundary. Sandbox isolation is in the v2 backlog.

### 13.6 Playwright session corruption recovery

**Risk:** Persistent contexts can become corrupted (broken cookies, half-written storage state) and permanently break a session for an organisation.

**Fix — auto-recovery with single retry:**

1. The browser executor tracks per-context launch failures in a small in-memory map keyed by `userDataDir`.
2. **First failure** to launch a persistent context: classify as `environment_error`, mark the session dir as "suspect" in memory, fail the run.
3. **Second consecutive failure** for the same `userDataDir` across different runs (within the same worker process): the executor:
   - Renames the session dir to `${userDataDir}.corrupt.${timestamp}` (preserves it for forensics, doesn't lose it forever)
   - Creates a fresh empty `userDataDir` and launches into that
   - Logs `iee.browser.session_recreated` with the dir, the suspect marker, and a reason
   - The current run proceeds with the fresh session
4. The corrupt-session backups are subject to the same cleanup job (§12.3) extended to remove `*.corrupt.*` directories older than 30 days.
5. **Why two failures, not one:** a single failure could be a transient network/CDN problem. Two consecutive failures across runs strongly indicate session-level corruption.

This is in-memory and per-worker — it does **not** require new database state. A worker restart resets the suspect tracking, which is acceptable: the worst case is one extra failed run before the recovery kicks in.

### 13.6.1 Tightening notes (rev 7)

Three small additions on top of §13.2, §13.3, and §7.4 — closing the last micro-gaps without new architecture.

**a) Reserved-cost leak cleanup (extends §13.2 + §12.3).** The `iee-cleanup-orphans` job gains a third sweep:

```sql
UPDATE execution_runs
   SET reserved_cost_usd = 0,
       status = 'failed',
       failure_reason = 'environment_error',
       completed_at = now()
 WHERE status = 'pending'
   AND reserved_cost_usd > 0
   AND created_at < now() - interval '15 minutes'
   AND deleted_at IS NULL;
```

15 minutes is well above the worst-case enqueue→pickup latency (`expireInMinutes` is 10 in `JOB_CONFIG`) but short enough that a stuck reservation cannot quietly gnaw at an org's budget. The threshold lives in `IEE_RESERVATION_TTL_MINUTES` (env, default `15`).

**b) Heartbeat write-coalescing (extends §13.3).** The heartbeat interval already fires every 10s, but the `UPDATE` is guarded so writes only happen if the in-process `lastHeartbeatWrittenAt` is older than the interval minus a small jitter:

```ts
const HEARTBEAT_INTERVAL_MS = 10_000;
let lastWritten = 0;
const interval = setInterval(async () => {
  const now = Date.now();
  if (now - lastWritten < HEARTBEAT_INTERVAL_MS - 500) return;
  lastWritten = now;
  await db.execute(sql`UPDATE execution_runs SET last_heartbeat_at = now() WHERE id = ${runId}`);
}, HEARTBEAT_INTERVAL_MS);
interval.unref();
```

This caps DB write rate at ~6 writes/min/run regardless of timer drift or future code paths that might call the heartbeat opportunistically. Batching across runs is **not** added in v1 — at the planned concurrency (1 browser + 2 dev per worker) the write volume is trivial.

**c) Per-command audit log (extends §7.4).** Every dev `run_command` step writes a structured log line in addition to the `execution_steps` row, intended for live debugging:

```ts
logger.info('iee.dev.command', {
  executionRunId,
  stepNumber,
  command: truncate(command, 500),
  exitCode,
  durationMs,
  stdout: truncateMiddle(stdout, 1500),
  stderr: truncateMiddle(stderr, 1500),
});
```

Total payload capped at ~4 KB per line. The full (un-truncated within the 64 KiB ring buffer cap) stdout/stderr already lives on the `execution_steps.output` row for forensic review; the log line is the fast-path debugging surface. Same banned-content rules from §8.3 apply — no secrets, no full HTML.

### 13.7 Schema additions summary (rev 6)

Single migration adds:

| Table | Change |
|---|---|
| `executionRuns` | `reservedCostUsd numeric(10,4) not null default 0` |
| `llmRequests` | `call_site text not null default 'app'` (rev 4 — restated) |
| `llmRequests` | `execution_run_id uuid null` (rev 4 — restated) |
| `llmRequests` | `CHECK (source_type <> 'iee' OR execution_run_id IS NOT NULL)` (rev 6) |

No other schema changes from rev 4/5.

### 13.8 What rev 6 does NOT add

Deliberately not introducing:

- A `step_progress` field tracked in the DB (the anti-stagnation rule lives in the prompt only)
- Sandbox isolation for dev subprocesses (Firejail / gVisor / DinD remain in v2)
- Per-org session-corruption tracking (in-memory per worker is sufficient for v1)
- A "kill switch" to remotely abort a running execution (deferred — pg-boss cancel + worker SIGTERM is the v1 escape valve)

These are noted so a future reviewer doesn't think they were missed.

---

## Appendix C — Spec revisions

| Rev | Date | Notes |
|---|---|---|
| 1 | 2026-04-07 | Initial draft from dev brief |
| 2 | 2026-04-07 | Added Part 11 (cost attribution — LLM + runtime) and Part 12 (risk tightening from review feedback). Added `workerInstanceId` / `lastHeartbeatAt` / cost columns to `executionRuns`. Added `'budget_exceeded'` to FailureReason. Added `iee-cleanup-orphans` and `iee-cost-rollup-daily` scheduled jobs. |
| 3 | 2026-04-07 | Replaced Part 11.5 with full integration into the existing usage/billing system: shared `source` enum on rollup table, `ieeUsageService` with system/org/subaccount scoping, additive API endpoints, IEE as a line item on existing system/org/subaccount billing UIs (not new pages), three-level budget enforcement, reuse of existing notification channels and invoicing path. |
| 4 | 2026-04-07 | Added §11.7 (per-task drill-down with three separate cost lines: app LLM, worker LLM, worker compute — backed by new `call_site` and `execution_run_id` columns on `llmRequests`) and §11.8 (Usage Explorer page — single React component mounted at three scope URLs with full filters, search, sort, pagination, export, and a unified API endpoint). |
| 5 | 2026-04-07 | §11.8.8: Usage Explorer is a top-level **left-nav** entry at every scope (system / org / subaccount), permission-gated, not nested under Settings. Settings → Billing keeps a convenience deep-link to it. |
| 6 | 2026-04-07 | Part 13 robustness hardening: router-level + DB CHECK enforcement of `executionRunId` for IEE LLM calls; budget reservation column `reservedCostUsd` to fix the enqueue-time race; heartbeat moved to a `setInterval` loop independent of step execution; system-prompt anti-stagnation rule (3-step no-progress → change strategy or `failed`); dev command hardening (reject `$(`, backticks, process substitution, `eval`; wrap in `bash -c "set -euo pipefail; ..."`); Playwright session corruption auto-recovery on second consecutive failure. |
| 7 | 2026-04-07 | §13.6.1 micro-tightening: reserved-cost leak sweep added to `iee-cleanup-orphans` (15 min TTL via `IEE_RESERVATION_TTL_MINUTES`); heartbeat write coalescing guard so DB writes are capped at one per interval; per-command audit log line `iee.dev.command` for fast-path debugging of dev runs. Windows guide: 60-second sanity check (§7.0) and first-build CPU/RAM expectations note. |






