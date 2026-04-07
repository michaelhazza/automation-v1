import { pgTable, uuid, text, integer, bigint, jsonb, numeric, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';

// ---------------------------------------------------------------------------
// iee_runs — Integrated Execution Environment runs
//
// Spec: docs/iee-development-spec.md §2.1.1, §11 (cost), §12.7 (heartbeat),
//       §13.2 (reservation column).
//
// One row per IEE job (browser_task or dev_task), end-to-end. The main app
// inserts the row at enqueue time; the worker updates status/result.
//
// NAMING NOTE: Spec text uses `execution_runs` but we use `iee_runs` here to
// avoid confusion with the existing `executions` table (workflow process
// executions). The two are unrelated concepts.
//
// COST UNIT NOTE: Costs are stored as integer cents to match the existing
// llm_requests / cost_aggregates / budget_reservations convention. The spec
// text uses USD numeric for clarity but the implementation aligns to cents.
// ---------------------------------------------------------------------------

export const ieeRuns = pgTable(
  'iee_runs',
  {
    id:               uuid('id').defaultRandom().primaryKey(),

    // Parent agent run that triggered this execution. The agent run is parked
    // on a pending_iee state until the worker writes the terminal row.
    agentRunId:       uuid('agent_run_id').references(() => agentRuns.id),

    // Attribution
    organisationId:   uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:     uuid('subaccount_id').references(() => subaccounts.id),
    agentId:          uuid('agent_id').notNull().references(() => agents.id),

    // Discriminator: which executor handles this run
    type:             text('type').notNull().$type<'browser' | 'dev'>(),
    // Forward-compatible mode field — v1 only ever uses 'browser' or 'dev'
    mode:             text('mode').notNull().$type<'api' | 'browser' | 'dev'>(),

    // Lifecycle
    status:           text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed'>(),

    // Idempotency — DB-level uniqueness, partial on deletedAt to allow soft-delete + reinsert
    idempotencyKey:   text('idempotency_key').notNull(),

    // Trace context
    correlationId:    text('correlation_id').notNull(),

    // Task definition (mirrors the job payload's `task` field)
    goal:             text('goal').notNull(),
    task:             jsonb('task').notNull(),

    // Worker liveness — spec §12.7 / §13.3
    workerInstanceId: text('worker_instance_id'),
    lastHeartbeatAt:  timestamp('last_heartbeat_at', { withTimezone: true }),

    // Reviewer round 3 — set when the worker successfully publishes the
    // 'iee-run-completed' pg-boss event after a terminal status write. NULL
    // means the event has not been emitted (yet, or because the publish
    // failed). The cleanup job retries nulls so the agent-resume hook is
    // never silently lost.
    eventEmittedAt:  timestamp('event_emitted_at', { withTimezone: true }),

    // Timing
    startedAt:        timestamp('started_at', { withTimezone: true }),
    completedAt:      timestamp('completed_at', { withTimezone: true }),

    // Outcome
    failureReason:    text('failure_reason').$type<'timeout' | 'step_limit_reached' | 'execution_error' | 'environment_error' | 'auth_failure' | 'budget_exceeded' | 'unknown'>(),
    resultSummary:    jsonb('result_summary'),
    stepCount:        integer('step_count').notNull().default(0),

    // Cost — denormalised at completion. Spec §11.3.2 / §11.7.
    // Stored as cents to match llm_requests / cost_aggregates convention.
    llmCostCents:     integer('llm_cost_cents').notNull().default(0),
    llmCallCount:     integer('llm_call_count').notNull().default(0),
    runtimeWallMs:    integer('runtime_wall_ms'),
    runtimeCpuMs:     integer('runtime_cpu_ms'),
    runtimePeakRssBytes: bigint('runtime_peak_rss_bytes', { mode: 'number' }),
    runtimeCostCents: integer('runtime_cost_cents').notNull().default(0),
    totalCostCents:   integer('total_cost_cents').notNull().default(0),

    // Soft-delete + bookkeeping
    createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt:        timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // §2.2 — DB-level idempotency, partial so soft-delete allows reinsert
    idempotencyKeyUniqIdx: uniqueIndex('iee_runs_idempotency_key_unique_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.deletedAt} IS NULL`),
    orgStatusIdx:    index('iee_runs_org_status_idx').on(table.organisationId, table.status),
    orgCreatedIdx:   index('iee_runs_org_created_idx').on(table.organisationId, table.createdAt),
    agentIdx:        index('iee_runs_agent_idx').on(table.agentId),
    agentRunIdx:     index('iee_runs_agent_run_idx').on(table.agentRunId),
    correlationIdx:  index('iee_runs_correlation_idx').on(table.correlationId),
    subaccountIdx:   index('iee_runs_subaccount_idx').on(table.subaccountId),
    // §13.3 — heartbeat reconciliation scan
    heartbeatIdx:    index('iee_runs_heartbeat_idx').on(table.status, table.lastHeartbeatAt),
  }),
);

export type IeeRun = typeof ieeRuns.$inferSelect;
export type NewIeeRun = typeof ieeRuns.$inferInsert;
