import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Subaccount State Summaries — auto-extracted operational state snapshot
// Phase 3B: Pure data assembly (no LLM), injected into agent prompts
// ---------------------------------------------------------------------------

export const subaccountStateSummaries = pgTable(
  'subaccount_state_summaries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),

    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    taskCounts: jsonb('task_counts').notNull().default('{}'),
    agentRunStats: jsonb('agent_run_stats').notNull().default('{}'),
    healthSummary: text('health_summary'),

    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSummary: uniqueIndex('subaccount_state_summaries_unique').on(
      table.organisationId,
      table.subaccountId,
    ),
  })
);

export type SubaccountStateSummary = typeof subaccountStateSummaries.$inferSelect;
export type NewSubaccountStateSummary = typeof subaccountStateSummaries.$inferInsert;
