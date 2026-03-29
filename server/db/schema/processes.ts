import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
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
      .references(() => organisations.id),
    workflowEngineId: uuid('workflow_engine_id')
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
    // Three-level scope: system (no org), organisation, or subaccount
    scope: text('scope').notNull().default('organisation').$type<'system' | 'organisation' | 'subaccount'>(),
    // JSON Schema for per-subaccount configuration (distinct from per-execution input_schema)
    configSchema: text('config_schema'),
    // Default config values — can be overridden per subaccount link
    defaultConfig: jsonb('default_config'),
    // Connection slots required by this process (e.g. [{ key: "gmail_account", provider: "gmail", required: true }])
    requiredConnections: jsonb('required_connections').$type<Array<{ key: string; provider: string; required: boolean }>>(),
    // false for system processes — downstream cannot modify
    isEditable: boolean('is_editable').notNull().default(true),
    // Points to the upstream process this was cloned from
    parentProcessId: uuid('parent_process_id'),
    // Living link to a system process — org admin sees name/description only;
    // webhookPath, requiredConnections, and engine config are sourced from the system process at runtime
    systemProcessId: uuid('system_process_id'),
    // True when created via "link system process" — restricts what org admin can edit
    isSystemManaged: boolean('is_system_managed').notNull().default(false),
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
    scopeStatusIdx: index('processes_scope_status_idx').on(table.scope, table.status),
    parentProcessIdx: index('processes_parent_process_idx').on(table.parentProcessId),
    systemProcessIdx: index('processes_system_process_idx').on(table.systemProcessId),
  })
);

export type Process = typeof processes.$inferSelect;
export type NewProcess = typeof processes.$inferInsert;
