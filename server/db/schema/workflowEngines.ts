import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';

export const workflowEngines = pgTable(
  'workflow_engines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .references(() => organisations.id),
    name: text('name').notNull(),
    engineType: text('engine_type').notNull().$type<'n8n' | 'ghl' | 'make' | 'zapier' | 'custom_webhook'>(),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key'),
    status: text('status').notNull().default('inactive').$type<'active' | 'inactive'>(),
    // Three-level scope: system (no org), organisation, or subaccount
    scope: text('scope').notNull().default('organisation').$type<'system' | 'organisation' | 'subaccount'>(),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    // Per-engine HMAC secret for signing outbound requests and verifying callbacks
    hmacSecret: text('hmac_secret').notNull(),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: text('last_test_status'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('workflow_engines_org_status_idx').on(table.organisationId, table.status),
    orgIdIdx: index('workflow_engines_org_id_idx').on(table.organisationId),
    statusIdx: index('workflow_engines_status_idx').on(table.status),
    scopeStatusIdx: index('workflow_engines_scope_status_idx').on(table.scope, table.status),
    subaccountIdx: index('workflow_engines_subaccount_idx').on(table.subaccountId),
  })
);

export type WorkflowEngine = typeof workflowEngines.$inferSelect;
export type NewWorkflowEngine = typeof workflowEngines.$inferInsert;
