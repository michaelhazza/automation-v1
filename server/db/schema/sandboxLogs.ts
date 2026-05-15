import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts.js';

// ---------------------------------------------------------------------------
// sandbox_logs — redacted per-line log rows (spec §20.8).
// Locked at chatgpt-spec-review Round 1 (previously SANDBOX-DEF-LOG-SCHEMA).
// One row per harvested log line. Idempotent on (sandbox_execution_id, log_stream, sequence).
// Retention: 90 days (spec §17.3). Pruned by sandboxLogsPruneJob.
// ---------------------------------------------------------------------------

export const sandboxLogs = pgTable(
  'sandbox_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sandboxExecutionId: uuid('sandbox_execution_id').notNull(),
    organisationId: uuid('organisation_id').notNull(),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull(),

    // Log stream classification
    logStream: text('log_stream').notNull().$type<'stdout' | 'stderr'>(),

    // Per-(execution, stream) ordered sequence; allocated at harvest write time
    sequence: integer('sequence').notNull(),

    // Redacted log line text (spec §8.4 step 5, §20.8)
    line: text('line').notNull(),

    // Timestamps
    // Time the log line was emitted inside the sandbox
    emittedAt: timestamp('emitted_at', { withTimezone: true }).notNull(),
    // Time the row landed (defaultNow so the DB sets it)
    persistedAt: timestamp('persisted_at', { withTimezone: true }).defaultNow().notNull(),

    // Soft-delete flag (spec §17.4) — set false when parent run is soft-deleted
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => ({
    // DB-level idempotency — harvest re-runs are no-ops at the line level (spec §20.8)
    executionStreamSequenceUniq: uniqueIndex('sandbox_logs_execution_stream_sequence_uniq')
      .on(table.sandboxExecutionId, table.logStream, table.sequence),
    orgPersistedAtIdx: index('sandbox_logs_org_persisted_at_idx').on(table.organisationId, table.persistedAt),
    // Covered by the unique index; declared separately for clarity in EXPLAIN plans
    executionStreamSeqAscIdx: index('sandbox_logs_execution_stream_seq_asc_idx')
      .on(table.sandboxExecutionId, table.logStream, table.sequence),
    runIdIdx: index('sandbox_logs_run_id_idx').on(table.runId),
  }),
);

export type SandboxLog = typeof sandboxLogs.$inferSelect;
export type NewSandboxLog = typeof sandboxLogs.$inferInsert;
