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

  // F11 — whether this skill produces side-effects at runtime (Riley §6.4).
  // Default true (safe) — treat unmigrated rows as side-effecting, forcing
  // review under Explore Mode. Backfilled from markdown frontmatter at seed time.
  sideEffects: boolean('side_effects').notNull().default(true),

  isActive: boolean('is_active').notNull().default(true),

  // Three-state visibility cascade: 'none' hides from agents entirely,
  // 'basic' exposes name+description only, 'full' exposes the whole skill.
  // Orthogonal to isActive; both must be true for a skill to be visible.
  visibility: text('visibility').notNull().default('none'),

  // Registry key that pairs this row with a TypeScript handler in skillExecutor.ts.
  // Invariant: handlerKey = slug (enforced at write time by createSystemSkill and
  // at boot time by validateSystemSkillHandlers). UNIQUE constraint matches the
  // invariant. See docs/skill-analyzer-v2-spec.md §5.5.
  handlerKey: text('handler_key').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('system_skills_slug_idx').on(table.slug),
  activeIdx: index('system_skills_active_idx').on(table.isActive),
  handlerKeyIdx: uniqueIndex('system_skills_handler_key_idx').on(table.handlerKey),
}));

// visibility is constrained to 'none' | 'basic' | 'full' at the application layer —
// see SkillVisibility type in systemSkillService.ts and the createSystemSkill /
// updateSystemSkill validators. The column stays `text` in the schema (matching the
// codebase's convention of light schema-level constraints + app-layer enforcement).

export type SystemSkill = typeof systemSkills.$inferSelect;
export type NewSystemSkill = typeof systemSkills.$inferInsert;
