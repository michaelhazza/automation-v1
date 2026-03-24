import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { workflowEngines } from './workflowEngines';
import { processCategories } from './processCategories';
import { subaccounts } from './subaccounts';
import { subaccountCategories } from './subaccountCategories';

export const processes = pgTable(
  'processes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    workflowEngineId: uuid('workflow_engine_id')
      .notNull()
      .references(() => workflowEngines.id),
    // Org-level category (for admin organisation of processes)
    orgCategoryId: uuid('org_category_id')
      .references(() => processCategories.id),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft').$type<'draft' | 'active' | 'inactive'>(),
    // Relative webhook path on the engine (full URL = engine.baseUrl + webhookPath)
    webhookPath: text('webhook_path').notNull(),
    inputSchema: text('input_schema'),
    outputSchema: text('output_schema'),
    // Subaccount-native processes: subaccountId is set; org processes: subaccountId is null
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    // Subaccount category for native subaccount processes (only set when subaccountId is set)
    subaccountCategoryId: uuid('subaccount_category_id')
      .references(() => subaccountCategories.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgStatusIdx: index('processes_org_status_idx').on(table.organisationId, table.status),
    orgCategoryStatusIdx: index('processes_org_cat_status_idx').on(table.organisationId, table.orgCategoryId, table.status),
    engineIdx: index('processes_engine_idx').on(table.workflowEngineId),
    orgIdIdx: index('processes_org_id_idx').on(table.organisationId),
    orgCategoryIdx: index('processes_org_category_idx').on(table.orgCategoryId),
    subaccountIdx: index('processes_subaccount_idx').on(table.subaccountId),
    statusIdx: index('processes_status_idx').on(table.status),
  })
);

export type Process = typeof processes.$inferSelect;
export type NewProcess = typeof processes.$inferInsert;
