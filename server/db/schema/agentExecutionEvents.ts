import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
// Note: uniqueIndex is used for taskSeqUniqueIdx below; runSeqUnique is a partial
// index (WHERE run_id IS NOT NULL) since migration 0270.
import { sql } from 'drizzle-orm';
import { agentRuns } from './agentRuns';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Agent Execution Events — durable typed per-run execution log.
// Migration 0192. Spec: tasks/live-agent-execution-log-spec.md §5.1.
// ---------------------------------------------------------------------------

export const agentExecutionEvents = pgTable(
  'agent_execution_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Nullable since migration 0270: task-scoped events (pause/resume/stop/pool-refresh)
    // have no agent_run context. DB check constraint enforces that at least one of
    // (run_id, task_id) is set. See migration 0270_workflows_v1_event_run_id_nullable.sql.
    runId: uuid('run_id')
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    // Allocated atomically from agent_runs.next_event_seq. 1-indexed.
    // NULL when run_id is NULL (task-only events have no agent_run sequence).
    sequenceNumber: integer('sequence_number'),

    // Discriminated-union key. Validated against the TS union in
    // shared/types/agentExecutionLog.ts at write time.
    eventType: text('event_type').notNull(),

    eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).defaultNow().notNull(),

    // Computed at emission from agent_runs.started_at — the client never
    // recomputes. Non-negative; clock-skew case clamps to 0.
    // For task-only events (run_id NULL), this is always 0.
    durationSinceRunStartMs: integer('duration_since_run_start_ms').notNull(),

    // Debug tag for the emission origin (service file name).
    sourceService: text('source_service').notNull(),

    // Event-specific payload. Discriminated by eventType. Does NOT contain
    // permissionMask — that is computed at read time from the caller's
    // current permissions (spec §4.1a).
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),

    // Linked-entity pointer. Null-together semantics enforced by the
    // service (not DB CHECK in P1). linked_entity_id references the
    // entity's own PK — see shared/types/agentExecutionLog.ts
    // LinkedEntityType for the taxonomy.
    linkedEntityType: text('linked_entity_type'),
    linkedEntityId: uuid('linked_entity_id'),

    // Workflows V1 — task-scoped event pointers (migration 0268)
    taskId: uuid('task_id'),
    taskSequence: bigint('task_sequence', { mode: 'number' }),
    eventOrigin: text('event_origin'),
    eventSubsequence: integer('event_subsequence').default(0),
    eventSchemaVersion: integer('event_schema_version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Migration 0270 replaced the original unconditional index (0192) with a partial
    // index that only covers run-scoped rows (WHERE run_id IS NOT NULL). Task-only
    // events (run_id NULL) are excluded from this index.
    runSeqUnique: index('agent_execution_events_run_seq_idx')
      .on(table.runId, table.sequenceNumber)
      .where(sql`${table.runId} IS NOT NULL`),
    orgCreatedIdx: index('agent_execution_events_org_created_idx').on(
      table.organisationId,
      table.createdAt,
    ),
    linkedEntityIdx: index('agent_execution_events_linked_entity_idx')
      .on(table.linkedEntityType, table.linkedEntityId)
      .where(sql`${table.linkedEntityType} IS NOT NULL`),
    // Workflows V1 — task-scoped unique index (partial, migration 0268)
    taskSeqUniqueIdx: uniqueIndex('agent_execution_events_task_seq_idx')
      .on(table.taskId, table.taskSequence, table.eventSubsequence)
      .where(sql`${table.taskId} IS NOT NULL`),
    runTaskSeqIdx: index('agent_execution_events_run_task_seq_idx')
      .on(table.runId, table.taskSequence)
      .where(sql`${table.taskId} IS NOT NULL`),
  }),
);

export type AgentExecutionEventRow = typeof agentExecutionEvents.$inferSelect;
export type NewAgentExecutionEventRow = typeof agentExecutionEvents.$inferInsert;
