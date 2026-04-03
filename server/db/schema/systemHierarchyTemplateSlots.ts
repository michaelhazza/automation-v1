import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { systemHierarchyTemplates } from './systemHierarchyTemplates';
import { systemAgents } from './systemAgents';

// ---------------------------------------------------------------------------
// System Hierarchy Template Slots — agent positions within a system template
// ---------------------------------------------------------------------------

export const systemHierarchyTemplateSlots = pgTable(
  'system_hierarchy_template_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => systemHierarchyTemplates.id, { onDelete: 'cascade' }),

    // Set if matched to a system agent on import
    systemAgentId: uuid('system_agent_id')
      .references(() => systemAgents.id),

    // Normalised slug (lowercase kebab-case, collision-suffixed)
    blueprintSlug: text('blueprint_slug').notNull(),

    // Original slug from Paperclip manifest
    paperclipSlug: text('paperclip_slug'),

    // Blueprint data
    blueprintName: text('blueprint_name'),
    blueprintDescription: text('blueprint_description'),
    blueprintIcon: text('blueprint_icon'),
    blueprintRole: text('blueprint_role'),
    blueprintTitle: text('blueprint_title'),
    blueprintCapabilities: text('blueprint_capabilities'),
    blueprintMasterPrompt: text('blueprint_master_prompt'),
    blueprintModelProvider: text('blueprint_model_provider'),
    blueprintModelId: text('blueprint_model_id'),

    // Hierarchy within template (self-referencing)
    parentSlotId: uuid('parent_slot_id'),

    // Phase 4: Per-slot skill enablement and execution scope
    skillEnablementMap: jsonb('skill_enablement_map').$type<Record<string, boolean>>(),
    executionScope: text('execution_scope').$type<'subaccount' | 'org'>(),

    // Display order among siblings
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    templateIdx: index('system_hierarchy_template_slots_template_idx').on(table.templateId),
    parentIdx: index('system_hierarchy_template_slots_parent_idx').on(table.parentSlotId),
    slugIdx: index('system_hierarchy_template_slots_slug_idx').on(table.templateId, table.blueprintSlug),
  })
);

export type SystemHierarchyTemplateSlot = typeof systemHierarchyTemplateSlots.$inferSelect;
export type NewSystemHierarchyTemplateSlot = typeof systemHierarchyTemplateSlots.$inferInsert;
