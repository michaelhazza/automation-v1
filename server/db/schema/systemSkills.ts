import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// System Skills — platform-level skill definitions (our IP)
// These handle task board interactions and core agent capabilities.
// Never exposed in the org-level skills UI.
// ---------------------------------------------------------------------------

export const systemSkills = pgTable('system_skills', {
  id: uuid('id').defaultRandom().primaryKey(),

  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),

  // The Anthropic tool definition (name, description, input_schema)
  definition: jsonb('definition').notNull(),
  // Markdown instructions injected into the agent's system prompt.
  // Contains all guidance: workflow phases, decision rules, quality criteria.
  instructions: text('instructions'),

  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('system_skills_slug_idx').on(table.slug),
  activeIdx: index('system_skills_active_idx').on(table.isActive),
}));

export type SystemSkill = typeof systemSkills.$inferSelect;
export type NewSystemSkill = typeof systemSkills.$inferInsert;
