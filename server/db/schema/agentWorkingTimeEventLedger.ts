import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { agentExecutionEvents } from './agentExecutionEvents';
import { organisations } from './organisations';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// agent_working_time_event_ledger — idempotency ledger for working-time
// event folding into agent_working_time_rollups. One row per event that
// has been applied. Prevents double-counting on retry.
// Migration 0295. Spec: tasks/builds/agent-workspace/spec.md §9.
// ---------------------------------------------------------------------------

export const agentWorkingTimeEventLedger = pgTable(
  'agent_working_time_event_ledger',
  {
    eventId:         uuid('event_id').primaryKey().references(() => agentExecutionEvents.id),
    organisationId:  uuid('organisation_id').notNull().references(() => organisations.id),
    agentId:         uuid('agent_id').notNull().references(() => agents.id),
    appliedAt:       timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index('agent_working_time_event_ledger_agent_idx').on(table.agentId, table.appliedAt),
  }),
);

export type AgentWorkingTimeEventLedger = typeof agentWorkingTimeEventLedger.$inferSelect;
export type NewAgentWorkingTimeEventLedger = typeof agentWorkingTimeEventLedger.$inferInsert;
