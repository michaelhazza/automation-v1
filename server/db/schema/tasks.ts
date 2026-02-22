import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { workflowEngines } from './workflowEngines';
import { taskCategories } from './taskCategories';

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
    categoryId: uuid('category_id')
      .references(() => taskCategories.id),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'inactive'>(),
    endpointUrl: text('endpoint_url').notNull(),
    httpMethod: text('http_method').notNull().$type<'GET' | 'POST' | 'PUT' | 'PATCH'>(),
    inputGuidance: text('input_guidance'),
    expectedOutput: text('expected_output'),
    timeoutSeconds: integer('timeout_seconds').notNull().default(300),
    engineType: text('engine_type').notNull().$type<'n8n' | 'ghl' | 'make' | 'zapier' | 'custom_webhook'>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgStatusIdx: index('tasks_org_status_idx').on(table.organisationId, table.status),
    orgCategoryStatusIdx: index('tasks_org_cat_status_idx').on(table.organisationId, table.categoryId, table.status),
    engineIdx: index('tasks_engine_idx').on(table.workflowEngineId),
    orgIdIdx: index('tasks_org_id_idx').on(table.organisationId),
    categoryIdx: index('tasks_category_idx').on(table.categoryId),
    statusIdx: index('tasks_status_idx').on(table.status),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
