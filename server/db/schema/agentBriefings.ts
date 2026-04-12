import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Agent Briefings — compact cross-run summary per agent-subaccount pair
// Phase 2D: Auto-generated, injected into prompt for instant orientation
// ---------------------------------------------------------------------------

export const agentBriefings = pgTable(
  'agent_briefings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),

    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    sourceRunIds: sql<string[]>`uuid[]`.notNull().default(sql`'{}'`),
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueBriefing: uniqueIndex('agent_briefings_unique').on(
      table.organisationId,
      table.subaccountId,
      table.agentId,
    ),
  })
);

export type AgentBriefing = typeof agentBriefings.$inferSelect;
export type NewAgentBriefing = typeof agentBriefings.$inferInsert;
