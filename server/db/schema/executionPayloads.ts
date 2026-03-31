import { pgTable, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { executions } from './executions';

// ---------------------------------------------------------------------------
// Execution Payloads — large blob data extracted from executions (H-5)
// Keeps executions lean; payloads are only fetched when needed for audit.
// ---------------------------------------------------------------------------

export const executionPayloads = pgTable(
  'execution_payloads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .unique()
      .references(() => executions.id, { onDelete: 'cascade' }),
    // Snapshot of the process definition used (for replay/debug)
    processSnapshot: jsonb('process_snapshot'),
    // Full payload we sent to the workflow engine
    outboundPayload: jsonb('outbound_payload'),
    // Raw callback payload received from the workflow engine
    callbackPayload: jsonb('callback_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    executionIdx: index('execution_payloads_execution_idx').on(table.executionId),
  })
);

export type ExecutionPayload = typeof executionPayloads.$inferSelect;
export type NewExecutionPayload = typeof executionPayloads.$inferInsert;
