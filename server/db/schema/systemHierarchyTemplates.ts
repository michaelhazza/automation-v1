import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// System Hierarchy Templates — platform-level company template library
// Imported from Paperclip at system admin level, visible to all orgs.
// ---------------------------------------------------------------------------

export const systemHierarchyTemplates = pgTable(
  'system_hierarchy_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    name: text('name').notNull(),
    description: text('description'),

    // 'manual' | 'paperclip_import'
    sourceType: text('source_type').notNull().default('paperclip_import').$type<'manual' | 'paperclip_import'>(),

    // Raw Paperclip manifest stored for reference
    paperclipManifest: jsonb('paperclip_manifest'),

    // Quick reference count of agents in the template
    agentCount: integer('agent_count').notNull().default(0),

    // Only published templates are visible to orgs
    isPublished: boolean('is_published').notNull().default(true),

    // Incremented on every update
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    publishedIdx: index('system_hierarchy_templates_published_idx').on(table.isPublished),
  })
);

export type SystemHierarchyTemplate = typeof systemHierarchyTemplates.$inferSelect;
export type NewSystemHierarchyTemplate = typeof systemHierarchyTemplates.$inferInsert;
