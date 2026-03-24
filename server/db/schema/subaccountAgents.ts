import { pgTable, uuid, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

export const subaccountAgents = pgTable(
  'subaccount_agents',
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
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('subaccount_agents_org_idx').on(table.organisationId),
    subaccountIdx: index('subaccount_agents_subaccount_idx').on(table.subaccountId),
    agentIdx: index('subaccount_agents_agent_idx').on(table.agentId),
    uniqueIdx: uniqueIndex('subaccount_agents_unique_idx').on(table.subaccountId, table.agentId),
  })
);

export type SubaccountAgent = typeof subaccountAgents.$inferSelect;
export type NewSubaccountAgent = typeof subaccountAgents.$inferInsert;
