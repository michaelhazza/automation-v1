import { pgTable, uuid, date, bigint, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// agent_working_time_rollups — per-day per-agent working time aggregates.
// Composite PK: (organisation_id, agent_id, bucket_date).
// Migration 0295. Spec: tasks/builds/agent-workspace/spec.md §9.
// ---------------------------------------------------------------------------

export const agentWorkingTimeRollups = pgTable(
  'agent_working_time_rollups',
  {
    organisationId:      uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:        uuid('subaccount_id').references(() => subaccounts.id),
    agentId:             uuid('agent_id').notNull().references(() => agents.id),
    bucketDate:          date('bucket_date').notNull(),
    workingTimeSeconds:  bigint('working_time_seconds', { mode: 'number' }).notNull().default(0),
    successfulRuns:      integer('successful_runs').notNull().default(0),
    failedRuns:          integer('failed_runs').notNull().default(0),
    partialRuns:         integer('partial_runs').notNull().default(0),
    totalRunCount:       integer('total_run_count').notNull().default(0),
    updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organisationId, table.agentId, table.bucketDate] }),
  }),
);

export type AgentWorkingTimeRollup = typeof agentWorkingTimeRollups.$inferSelect;
export type NewAgentWorkingTimeRollup = typeof agentWorkingTimeRollups.$inferInsert;
