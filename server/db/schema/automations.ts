import { pgTable, uuid, text, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { automationEngines } from './automationEngines';
import { automationCategories } from './automationCategories';
import { subaccounts } from './subaccounts';
import { subaccountCategories } from './subaccountCategories';

export const automations = pgTable(
  'automations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .references(() => organisations.id),
    workflowEngineId: uuid('workflow_engine_id')
      .references(() => automationEngines.id),
    // Org-level category (for admin organisation of automations)
    orgCategoryId: uuid('org_category_id')
      .references(() => automationCategories.id),
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
    // Connection slots required by this automation (e.g. [{ key: "gmail_account", provider: "gmail", required: true }])
    requiredConnections: jsonb('required_connections').$type<Array<{ key: string; provider: string; required: boolean }>>(),
    // false for system automations — downstream cannot modify
    isEditable: boolean('is_editable').notNull().default(true),
    // Points to the upstream automation this was cloned from
    parentProcessId: uuid('parent_process_id'),
    // Living link to a system automation — org admin sees name/description only
    systemProcessId: uuid('system_process_id'),
    // True when created via "link system automation" — restricts what org admin can edit
    isSystemManaged: boolean('is_system_managed').notNull().default(false),
    // Subaccount-native automations: subaccountId is set; org automations: subaccountId is null
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    // Subaccount category for native subaccount automations (only set when subaccountId is set)
    subaccountCategoryId: uuid('subaccount_category_id')
      .references(() => subaccountCategories.id),
    // §5.4a capability-contract columns (added by migration 0220)
    sideEffects: text('side_effects').notNull().default('unknown').$type<'read_only' | 'mutating' | 'unknown'>(),
    idempotent: boolean('idempotent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('automations_org_status_idx').on(table.organisationId, table.status),
    orgCategoryStatusIdx: index('automations_org_cat_status_idx').on(table.organisationId, table.orgCategoryId, table.status),
    engineIdx: index('automations_engine_idx').on(table.workflowEngineId),
    orgIdIdx: index('automations_org_id_idx').on(table.organisationId),
    orgCategoryIdx: index('automations_org_category_idx').on(table.orgCategoryId),
    subaccountIdx: index('automations_subaccount_idx').on(table.subaccountId),
    statusIdx: index('automations_status_idx').on(table.status),
    scopeStatusIdx: index('automations_scope_status_idx').on(table.scope, table.status),
    parentAutomationIdx: index('automations_parent_automation_idx').on(table.parentProcessId),
    systemAutomationIdx: index('automations_system_automation_idx').on(table.systemProcessId),
    // Prevent routing collisions — unique webhook path per engine (partial, excludes deleted)
    engineWebhookUniq: uniqueIndex('automations_engine_webhook_unique_idx')
      .on(table.workflowEngineId, table.webhookPath)
      .where(sql`${table.workflowEngineId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  })
);

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;
