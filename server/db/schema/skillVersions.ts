import { pgTable, uuid, text, integer, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

// ---------------------------------------------------------------------------
// skill_versions — Feature 3: Skill Studio
// Immutable version history for skill definitions.
// ---------------------------------------------------------------------------

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    systemSkillId: uuid('system_skill_id'),
    skillId: uuid('skill_id'),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    definition: jsonb('definition').notNull(),
    instructions: text('instructions'),
    // Structured change type: 'create' | 'update' | 'merge' | 'restore' | 'deactivate'
    changeType: text('change_type').notNull().$type<'create' | 'update' | 'merge' | 'restore' | 'deactivate'>(),
    changeSummary: text('change_summary'),
    // Idempotency key for retry-safe version writes (nullable; unique per skill when set)
    idempotencyKey: text('idempotency_key'),
    authoredBy: uuid('authored_by')
      .references(() => users.id, { onDelete: 'set null' }),
    regressionIds: uuid('regression_ids').array(),
    simulationPassCount: integer('simulation_pass_count').notNull().default(0),
    simulationTotalCount: integer('simulation_total_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    systemSkillIdx: index('skill_versions_system_skill_idx').on(table.systemSkillId, table.versionNumber),
    skillIdx: index('skill_versions_skill_idx').on(table.skillId, table.versionNumber),
  }),
);

export type SkillVersion = typeof skillVersions.$inferSelect;
export type NewSkillVersion = typeof skillVersions.$inferInsert;
