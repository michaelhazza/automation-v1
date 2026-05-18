import { pgTable, uuid, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { agentRuns } from './agentRuns';
import { systemSkills } from './systemSkills';
import { skills } from './skills';

// ---------------------------------------------------------------------------
// Skill Amendment Run Snapshot — immutable record of amendment set applied per run.
// UNIQUE NULLS NOT DISTINCT on (run_id, system_skill_id, org_skill_id) requires PostgreSQL 15+.
// Closed-Loop Skill Improvement spec §7.7 (migration 0370).
// ---------------------------------------------------------------------------

export const skillAmendmentRunSnapshot = pgTable(
  'skill_amendment_run_snapshot',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    systemSkillId: uuid('system_skill_id').references(() => systemSkills.id, { onDelete: 'set null' }),
    orgSkillId: uuid('org_skill_id').references(() => skills.id, { onDelete: 'set null' }),
    resolverVersion: text('resolver_version').notNull(),
    amendmentVersionSetHash: text('amendment_version_set_hash').notNull(),
    composedBody: text('composed_body').notNull(),
    composedBodyHash: text('composed_body_hash').notNull(),
    // uuid[] columns: Drizzle uses sql-typed array columns
    includedAmendmentIds: uuid('included_amendment_ids').array().notNull().default(sql`'{}'`),
    excludedAmendmentIds: uuid('excluded_amendment_ids').array().notNull().default(sql`'{}'`),
    composedSizeChars: integer('composed_size_chars').notNull(),
    truncated: boolean('truncated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIdx: index('skill_amendment_run_snapshot_run_idx').on(table.runId),
    // UNIQUE NULLS NOT DISTINCT on (run_id, system_skill_id, org_skill_id) is expressed
    // as a raw CREATE UNIQUE INDEX in the migration (Drizzle has no built-in NULLS NOT DISTINCT helper).
  }),
);

export type SkillAmendmentRunSnapshot = typeof skillAmendmentRunSnapshot.$inferSelect;
export type NewSkillAmendmentRunSnapshot = typeof skillAmendmentRunSnapshot.$inferInsert;
