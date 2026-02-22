import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { workflowEngines } from './workflowEngines';
import { taskCategories } from './taskCategories';
import { subaccounts } from './subaccounts';
import { subaccountCategories } from './subaccountCategories';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    workflowEngineId: uuid('workflow_engine_id')
      .notNull()
      .references(() => workflowEngines.id),
    // Org-level category (for admin organisation of tasks)
    orgCategoryId: uuid('org_category_id')
      .references(() => taskCategories.id),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'inactive'>(),
    // Relative webhook path on the engine (full URL = engine.baseUrl + webhookPath)
    webhookPath: text('webhook_path').notNull(),
    inputSchema: text('input_schema'),
    outputSchema: text('output_schema'),
    // Subaccount-native tasks: subaccountId is set; org tasks: subaccountId is null
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    // Subaccount category for native subaccount tasks (only set when subaccountId is set)
    subaccountCategoryId: uuid('subaccount_category_id')
      .references(() => subaccountCategories.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgStatusIdx: index('tasks_org_status_idx').on(table.organisationId, table.status),
    orgCategoryStatusIdx: index('tasks_org_cat_status_idx').on(table.organisationId, table.orgCategoryId, table.status),
    engineIdx: index('tasks_engine_idx').on(table.workflowEngineId),
    orgIdIdx: index('tasks_org_id_idx').on(table.organisationId),
    orgCategoryIdx: index('tasks_org_category_idx').on(table.orgCategoryId),
    subaccountIdx: index('tasks_subaccount_idx').on(table.subaccountId),
    statusIdx: index('tasks_status_idx').on(table.status),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
