import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';

export const taskCategories = pgTable(
  'task_categories',
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
    orgNameIdx: index('task_categories_org_name_idx').on(table.organisationId, table.name),
    orgIdIdx: index('task_categories_org_id_idx').on(table.organisationId),
    deletedAtIdx: index('task_categories_deleted_at_idx').on(table.deletedAt),
  })
);

export type TaskCategory = typeof taskCategories.$inferSelect;
export type NewTaskCategory = typeof taskCategories.$inferInsert;
