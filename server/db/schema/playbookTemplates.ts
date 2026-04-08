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

// ---------------------------------------------------------------------------
// System Playbook Templates — platform-shipped, read-only via API
// ---------------------------------------------------------------------------

export const systemPlaybookTemplates = pgTable(
  'system_playbook_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    latestVersion: integer('latest_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    slugIdx: index('system_playbook_templates_slug_idx')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type SystemPlaybookTemplate = typeof systemPlaybookTemplates.$inferSelect;
export type NewSystemPlaybookTemplate = typeof systemPlaybookTemplates.$inferInsert;

// ---------------------------------------------------------------------------
// System Playbook Template Versions — immutable system version snapshots
// ---------------------------------------------------------------------------

export const systemPlaybookTemplateVersions = pgTable(
  'system_playbook_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    systemTemplateId: uuid('system_template_id')
      .notNull()
      .references(() => systemPlaybookTemplates.id),
    version: integer('version').notNull(),
    definitionJson: jsonb('definition_json').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueVersion: uniqueIndex('system_playbook_template_versions_unique_idx').on(
      table.systemTemplateId,
      table.version
    ),
  })
);

export type SystemPlaybookTemplateVersion = typeof systemPlaybookTemplateVersions.$inferSelect;
export type NewSystemPlaybookTemplateVersion = typeof systemPlaybookTemplateVersions.$inferInsert;

// ---------------------------------------------------------------------------
// Org Playbook Templates — org-owned, may fork from a system template
// ---------------------------------------------------------------------------

export const playbookTemplates = pgTable(
  'playbook_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    forkedFromSystemId: uuid('forked_from_system_id').references(
      () => systemPlaybookTemplates.id
    ),
    forkedFromVersion: integer('forked_from_version'),
    latestVersion: integer('latest_version').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    // Phase 1.5 — parameterization layer column. Empty in Phase 1.
    paramsJson: jsonb('params_json').notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('playbook_templates_org_slug_unique_idx')
      .on(table.organisationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    orgIdx: index('playbook_templates_org_idx')
      .on(table.organisationId)
      .where(sql`${table.deletedAt} IS NULL`),
    forkedFromIdx: index('playbook_templates_forked_from_idx').on(table.forkedFromSystemId),
  })
);

export type PlaybookTemplate = typeof playbookTemplates.$inferSelect;
export type NewPlaybookTemplate = typeof playbookTemplates.$inferInsert;

// ---------------------------------------------------------------------------
// Org Playbook Template Versions — immutable org version snapshots
// ---------------------------------------------------------------------------

export const playbookTemplateVersions = pgTable(
  'playbook_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => playbookTemplates.id),
    version: integer('version').notNull(),
    definitionJson: jsonb('definition_json').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id),
  },
  (table) => ({
    uniqueVersion: uniqueIndex('playbook_template_versions_unique_idx').on(
      table.templateId,
      table.version
    ),
  })
);

export type PlaybookTemplateVersion = typeof playbookTemplateVersions.$inferSelect;
export type NewPlaybookTemplateVersion = typeof playbookTemplateVersions.$inferInsert;
