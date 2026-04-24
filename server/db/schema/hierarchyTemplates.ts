import { pgTable, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm'; // used for partial index WHERE clauses
import { organisations } from './organisations';
import { systemHierarchyTemplates } from './systemHierarchyTemplates';

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

    // When sourceType === 'from_system', links this org template back to its
    // source system template so the "refresh config" upsert path can find it.
    systemTemplateId: uuid('system_template_id').references(() => systemHierarchyTemplates.id),

    // Raw Paperclip manifest stored for reference
    paperclipManifest: jsonb('paperclip_manifest'),

    // SHA-256 hash of the manifest JSON for idempotency / duplicate detection
    manifestHash: text('manifest_hash'),
    // Version of the parser that produced this import (for reproducibility)
    parserVersion: text('parser_version'),

    // Phase 4: Configuration template extension
    appliedConnectorConfigId: uuid('applied_connector_config_id'),
    // Session 1 (migration 0180) — renamed from `operational_config`. One-time
    // informational snapshot copied from systemHierarchyTemplates.operationalDefaults
    // when this blueprint is adopted. NOT a runtime source. The runtime source is
    // organisations.operational_config_override (deep-merged with system defaults
    // at read time). See spec §2 / contract (h).
    operationalConfigSeed: jsonb('operational_config_seed').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('hierarchy_templates_org_idx').on(table.organisationId),
    // Unique name per org, soft-delete-aware
    orgNameUniq: uniqueIndex('hierarchy_templates_org_name_unique_idx')
      .on(table.organisationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type HierarchyTemplate = typeof hierarchyTemplates.$inferSelect;
export type NewHierarchyTemplate = typeof hierarchyTemplates.$inferInsert;
