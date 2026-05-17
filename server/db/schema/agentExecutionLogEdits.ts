import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { users } from './users';

// ---------------------------------------------------------------------------
// Agent Execution Log Edits — edit attribution trail for Phase 2 audit log
// Migration: 0367_agent_execution_log_edits.sql
// ---------------------------------------------------------------------------

export const agentExecutionLogEdits = pgTable(
  'agent_execution_log_edits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }).defaultNow().notNull(),
    editedByUserId: uuid('edited_by_user_id')
      .notNull()
      .references(() => users.id),
    editSummary: text('edit_summary').notNull(),
    beforeSnapshot: jsonb('before_snapshot'),
    afterSnapshot: jsonb('after_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('agent_execution_log_edits_run_idx').on(table.runId, table.editedAt),
    entityIdx: index('agent_execution_log_edits_entity_idx').on(
      table.entityType,
      table.entityId,
      table.editedAt,
    ),
  }),
);

export type AgentExecutionLogEdit = typeof agentExecutionLogEdits.$inferSelect;
export type NewAgentExecutionLogEdit = typeof agentExecutionLogEdits.$inferInsert;
