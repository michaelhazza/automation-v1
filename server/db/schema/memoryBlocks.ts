import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Memory Blocks — shared named context blocks attached to multiple agents.
// Spec: docs/improvements-roadmap-spec.md P4.2 (Letta pattern).
// ---------------------------------------------------------------------------

export const memoryBlocks = pgTable(
  'memory_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    name: text('name').notNull(),
    content: text('content').notNull(),
    ownerAgentId: uuid('owner_agent_id')
      .references(() => agents.id),
    isReadOnly: boolean('is_read_only').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgNameIdx: uniqueIndex('memory_blocks_org_name_idx')
      .on(table.organisationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    orgIdx: index('memory_blocks_org_idx').on(table.organisationId),
    subaccountIdx: index('memory_blocks_subaccount_idx')
      .on(table.subaccountId)
      .where(sql`${table.subaccountId} IS NOT NULL`),
  })
);

export type MemoryBlock = typeof memoryBlocks.$inferSelect;
export type NewMemoryBlock = typeof memoryBlocks.$inferInsert;
