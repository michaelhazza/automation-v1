import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

export const processCategories = pgTable(
  'process_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    description: text('description'),
    colour: text('colour'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdIdx: index('process_categories_org_id_idx').on(table.organisationId),
    deletedAtIdx: index('process_categories_deleted_at_idx').on(table.deletedAt),
    // M-7: unique name per org, soft-delete-aware
    orgNameUniq: uniqueIndex('process_categories_org_name_unique_idx')
      .on(table.organisationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type ProcessCategory = typeof processCategories.$inferSelect;
export type NewProcessCategory = typeof processCategories.$inferInsert;
