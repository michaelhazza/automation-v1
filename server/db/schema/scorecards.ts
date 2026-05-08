import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Scorecards — evaluation rubrics scoped to system / org / subaccount.
// Trust & Verification Layer spec §6.3, §7, §12.1 (migration 0297).
//
// System-scope rows (organisation_id IS NULL) are readable cross-tenant via
// the widened SELECT policy but are never writable from an org-context session.
// Service layer must filter scope before returning to callers.
// ---------------------------------------------------------------------------

export interface QualityCheck {
  slug: string;
  name: string;
  description?: string;
  /**
   * Pass mark on the 0..1 scale. The judge runner maps observedScore to
   * verdict via `observedScore >= passMark` (Trust & Verification Layer
   * spec §6.3, §6.5). UI displays as a percentage. Optional at the type
   * level so legacy rows pre-rename still load; service layer falls back
   * to DEFAULT_PASS_MARK when undefined.
   */
  passMark?: number;
  /**
   * When false, the check is skipped — the judge runner does NOT enqueue a
   * job for it, no row is written to scorecard_judgements, and the check
   * does not count toward the scorecard's pass/fail rollup. Defaults to
   * true (treated as enabled when the field is missing on legacy rows).
   * Spec §6.3.
   */
  enabled?: boolean;
}

export const scorecards = pgTable(
  'scorecards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').references(() => organisations.id),  // NULL = system scope
    scopeType: text('scope_type').notNull().$type<'system' | 'org' | 'subaccount'>(),
    scopeId: uuid('scope_id'),  // NULL for system scope
    name: text('name').notNull(),
    description: text('description'),
    qualityChecks: jsonb('quality_checks').notNull().default([]).$type<QualityCheck[]>(),
    shareWithSubaccounts: boolean('share_with_subaccounts').notNull().default(false),
    judgeModelId: text('judge_model_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('scorecards_org_idx').on(table.organisationId),
    scopeIdx: index('scorecards_scope_idx').on(table.scopeType, table.scopeId),
    // Partial unique: one active name per scope (excluding soft-deleted rows)
    scopeNameUniq: uniqueIndex('scorecards_scope_name_uniq')
      .on(table.scopeType, table.scopeId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  })
);

export type Scorecard = typeof scorecards.$inferSelect;
export type NewScorecard = typeof scorecards.$inferInsert;
