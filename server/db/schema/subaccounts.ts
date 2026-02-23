import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

export const subaccounts = pgTable(
  'subaccounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active').$type<'active' | 'suspended' | 'inactive'>(),
    settings: jsonb('settings'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('subaccounts_org_idx').on(table.organisationId),
    orgStatusIdx: index('subaccounts_org_status_idx').on(table.organisationId, table.status),
    slugUniqueIdx: uniqueIndex('subaccounts_slug_unique_idx')
      .on(table.organisationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Subaccount = typeof subaccounts.$inferSelect;
export type NewSubaccount = typeof subaccounts.$inferInsert;
