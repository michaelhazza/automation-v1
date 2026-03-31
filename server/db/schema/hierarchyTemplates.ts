import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Hierarchy Templates — org-scoped reusable agent organisation blueprints
// ---------------------------------------------------------------------------

export const hierarchyTemplates = pgTable(
  'hierarchy_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),

    name: text('name').notNull(),
    description: text('description'),

    // One per org; pre-selected at subaccount creation
    isDefaultForSubaccount: boolean('is_default_for_subaccount').notNull().default(false),

    // Incremented on every update
    version: integer('version').notNull().default(1),

    // 'manual' | 'paperclip_import' | 'from_system'
    sourceType: text('source_type').notNull().default('manual').$type<'manual' | 'paperclip_import' | 'from_system'>(),

    // Raw Paperclip manifest stored for reference
    paperclipManifest: jsonb('paperclip_manifest'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    orgIdx: index('hierarchy_templates_org_idx').on(table.organisationId),
    orgNameIdx: index('hierarchy_templates_org_name_idx').on(table.organisationId, table.name),
  })
);

export type HierarchyTemplate = typeof hierarchyTemplates.$inferSelect;
export type NewHierarchyTemplate = typeof hierarchyTemplates.$inferInsert;
