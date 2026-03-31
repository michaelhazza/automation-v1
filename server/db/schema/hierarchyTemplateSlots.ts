import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { hierarchyTemplates } from './hierarchyTemplates';
import { systemAgents } from './systemAgents';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Hierarchy Template Slots — individual agent positions within a template
// ---------------------------------------------------------------------------

export const hierarchyTemplateSlots = pgTable(
  'hierarchy_template_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => hierarchyTemplates.id, { onDelete: 'cascade' }),

    // Set if matched to a system agent on import
    systemAgentId: uuid('system_agent_id')
      .references(() => systemAgents.id),

    // Set if matched to an existing org agent on import
    agentId: uuid('agent_id')
      .references(() => agents.id),

    // Final normalised slug (lowercase kebab-case, collision-suffixed).
    // Used as the matching key on all future apply operations.
    blueprintSlug: text('blueprint_slug'),

    // Original slug from Paperclip manifest, preserved for reference only.
    // Never used for matching.
    paperclipSlug: text('paperclip_slug'),

    // Blueprint data (for unmatched agents)
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

    // Display order among siblings
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    templateIdx: index('hierarchy_template_slots_template_idx').on(table.templateId),
    parentIdx: index('hierarchy_template_slots_parent_idx').on(table.parentSlotId),
    blueprintSlugIdx: index('hierarchy_template_slots_blueprint_slug_idx').on(table.templateId, table.blueprintSlug),
  })
);

export type HierarchyTemplateSlot = typeof hierarchyTemplateSlots.$inferSelect;
export type NewHierarchyTemplateSlot = typeof hierarchyTemplateSlots.$inferInsert;
