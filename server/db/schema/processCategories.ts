import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgNameIdx: index('process_categories_org_name_idx').on(table.organisationId, table.name),
    orgIdIdx: index('process_categories_org_id_idx').on(table.organisationId),
    deletedAtIdx: index('process_categories_deleted_at_idx').on(table.deletedAt),
  })
);

export type ProcessCategory = typeof processCategories.$inferSelect;
export type NewProcessCategory = typeof processCategories.$inferInsert;
