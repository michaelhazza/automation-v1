import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
// `text` is used for the visibility enum column (Drizzle has no native enum
// helper that plays nicely with our migration style; check constraint lives
// in the SQL migration).
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
    // Markdown instructions injected into the agent's system prompt when this skill is active.
    // Contains all guidance: workflow phases, decision rules, quality criteria.
    instructions: text('instructions'),
    isActive: boolean('is_active').notNull().default(true),
    // Three-state cascade visibility for lower tiers (org→subaccount,
    // system→org). 'none' = invisible; 'basic' = name + description only;
    // 'full' = everything (instructions, definition).
    // Defaults to 'none' so skills must be explicitly opted in.
    // Migration 0074 / spec round 4.
    visibility: text('visibility').notNull().default('none').$type<'none' | 'basic' | 'full'>(),
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
