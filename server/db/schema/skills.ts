import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Skills — reusable capability definitions attached to agents
// Built-in skills (organisationId = null) are system-level.
// Custom skills have an organisationId and are org-scoped.
// ---------------------------------------------------------------------------

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // null = system/built-in skill, set = org-level custom skill
    organisationId: uuid('organisation_id')
      .references(() => organisations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    // 'built_in' = platform-provided, 'custom' = org-created
    skillType: text('skill_type').notNull().default('built_in').$type<'built_in' | 'custom'>(),
    // The Anthropic tool definition (name, description, input_schema)
    definition: jsonb('definition').notNull(),
    // Markdown instructions injected into the agent's system prompt when this skill is active
    instructions: text('instructions'),
    // Extended methodology document — structured workflow phases, decision trees,
    // quality criteria, and common mistakes. Injected after instructions for richer guidance.
    methodology: text('methodology'),
    isActive: boolean('is_active').notNull().default(true),
    // Whether the full skill body (instructions, methodology, definition) is
    // visible to lower tiers (subaccounts that link to an org agent using this
    // skill). Name + description are ALWAYS visible — that's how the agent
    // runtime knows the skill exists. This flag only gates the human-readable
    // body and the "Manage Skill" page. Defaults to false. Spec v3.4 §3 / T6.
    contentsVisible: boolean('contents_visible').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('skills_org_idx').on(table.organisationId),
    slugIdx: uniqueIndex('skills_slug_org_idx').on(table.organisationId, table.slug),
    typeIdx: index('skills_type_idx').on(table.skillType),
  })
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
