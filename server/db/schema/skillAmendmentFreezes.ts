import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import type { FreezeScope, FreezeType } from '../../../shared/types/skillAmendments.js';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';

// ---------------------------------------------------------------------------
// Skill Amendment Freezes — operator or system holds on amendment pipeline activity.
// Active while thawed_at IS NULL. UNIQUE NULLS NOT DISTINCT on (org_id, scope, scope_id, freeze_type)
// WHERE thawed_at IS NULL handles org-level rows where scope_id IS NULL (PostgreSQL 15+).
// Closed-Loop Skill Improvement spec §7.8 (migration 0370).
// ---------------------------------------------------------------------------

export const skillAmendmentFreezes = pgTable(
  'skill_amendment_freezes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organisations.id),
    // nullable: org-level freezes have NULL subaccount_id
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().$type<FreezeScope>(),
    // nullable: scope='org' rows have NULL scope_id
    scopeId: uuid('scope_id'),
    freezeType: text('freeze_type').notNull().$type<FreezeType>(),
    reason: text('reason').notNull(),
    // nullable: system freezes have NULL created_by_user_id
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    // active while thawed_at IS NULL
    thawedAt: timestamp('thawed_at', { withTimezone: true }),
    thawedByUserId: uuid('thawed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('skill_amendment_freezes_org_idx').on(table.orgId),
    // UNIQUE NULLS NOT DISTINCT partial index (WHERE thawed_at IS NULL) is expressed
    // as a raw CREATE UNIQUE INDEX in the migration (no Drizzle helper for NULLS NOT DISTINCT).
  }),
);

export type SkillAmendmentFreeze = typeof skillAmendmentFreezes.$inferSelect;
export type NewSkillAmendmentFreeze = typeof skillAmendmentFreezes.$inferInsert;
