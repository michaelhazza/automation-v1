import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { users } from './users';
import type { WorkflowScope } from './workflowRuns';

// ---------------------------------------------------------------------------
// System Workflow Templates — platform-shipped, read-only via API
// ---------------------------------------------------------------------------

export const systemWorkflowTemplates = pgTable(
  'system_workflow_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // Added migration 0171 (§13.3). Declares whether this template runs at
    // subaccount or org scope. Historical rows default to 'subaccount'.
    scope: text('scope').notNull().default('subaccount').$type<WorkflowScope>(),
    latestVersion: integer('latest_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    slugIdx: index('system_workflow_templates_slug_idx')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type SystemWorkflowTemplate = typeof systemWorkflowTemplates.$inferSelect;
export type NewSystemWorkflowTemplate = typeof systemWorkflowTemplates.$inferInsert;

// ---------------------------------------------------------------------------
// System Workflow Template Versions — immutable system version snapshots
// ---------------------------------------------------------------------------

export const systemWorkflowTemplateVersions = pgTable(
  'system_workflow_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    systemTemplateId: uuid('system_template_id')
      .notNull()
      .references(() => systemWorkflowTemplates.id),
    version: integer('version').notNull(),
    definitionJson: jsonb('definition_json').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueVersion: uniqueIndex('system_workflow_template_versions_unique_idx').on(
      table.systemTemplateId,
      table.version
    ),
  })
);

export type SystemWorkflowTemplateVersion = typeof systemWorkflowTemplateVersions.$inferSelect;
export type NewSystemWorkflowTemplateVersion = typeof systemWorkflowTemplateVersions.$inferInsert;

// ---------------------------------------------------------------------------
// Org Workflow Templates — org-owned, may fork from a system template
// ---------------------------------------------------------------------------

export const workflowTemplates = pgTable(
  'workflow_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    forkedFromSystemId: uuid('forked_from_system_id').references(
      () => systemWorkflowTemplates.id
    ),
    forkedFromVersion: integer('forked_from_version'),
    latestVersion: integer('latest_version').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    // Phase 1.5 — parameterization layer column. Empty in Phase 1.
    paramsJson: jsonb('params_json').notNull().default({}).$type<Record<string, unknown>>(),
    // Workflows V1 (migration 0270, spec §3.1) — cost/time ceiling defaults
    costCeilingCents: integer('cost_ceiling_cents').notNull().default(500),
    wallClockCapSeconds: integer('wall_clock_cap_seconds').notNull().default(3600),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('workflow_templates_org_slug_unique_idx')
      .on(table.organisationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    orgIdx: index('workflow_templates_org_idx')
      .on(table.organisationId)
      .where(sql`${table.deletedAt} IS NULL`),
    forkedFromIdx: index('workflow_templates_forked_from_idx').on(table.forkedFromSystemId),
  })
);

export type WorkflowTemplate = typeof workflowTemplates.$inferSelect;
export type NewWorkflowTemplate = typeof workflowTemplates.$inferInsert;

// ---------------------------------------------------------------------------
// Org Workflow Template Versions — immutable org version snapshots
// ---------------------------------------------------------------------------

export const workflowTemplateVersions = pgTable(
  'workflow_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    version: integer('version').notNull(),
    definitionJson: jsonb('definition_json').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id),
    // Workflows V1 (migration 0270)
    publishNotes: text('publish_notes'),
  },
  (table) => ({
    uniqueVersion: uniqueIndex('workflow_template_versions_unique_idx').on(
      table.templateId,
      table.version
    ),
  })
);

export type WorkflowTemplateVersion = typeof workflowTemplateVersions.$inferSelect;
export type NewWorkflowTemplateVersion = typeof workflowTemplateVersions.$inferInsert;
