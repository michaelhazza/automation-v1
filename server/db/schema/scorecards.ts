import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Scorecards — evaluation rubrics scoped to system / org / subaccount.
// Trust & Verification Layer spec §6.3, §7, §12.1 (migration 0290).
//
// System-scope rows (organisation_id IS NULL) are readable cross-tenant via
// the widened SELECT policy but are never writable from an org-context session.
// Service layer must filter scope before returning to callers.
// ---------------------------------------------------------------------------

export interface QualityCheck {
  slug: string;
  name: string;
  description?: string;
  weight?: number;
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
