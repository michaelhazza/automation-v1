import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { playbookRuns } from './playbookRuns';

// ---------------------------------------------------------------------------
// Subaccount Onboarding State — completion tracking per (subaccount, slug)
//
// Phase G / spec §10.3 (G10.3). Written by `playbookRunService` on terminal
// transitions for onboarding runs (isOnboardingRun = true). The Onboarding
// tab (§9.3) reads this table for status + last-run metadata without scanning
// `playbook_runs`.
//
// 'not_started' is implicit — a missing row means the slug has never run.
// ---------------------------------------------------------------------------

export type SubaccountOnboardingStatus = 'in_progress' | 'completed' | 'failed';

export const subaccountOnboardingState = pgTable(
  'subaccount_onboarding_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    playbookSlug: text('playbook_slug').notNull(),
    status: text('status').notNull().$type<SubaccountOnboardingStatus>(),
    lastRunId: uuid('last_run_id').references(() => playbookRuns.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountSlugUniq: uniqueIndex('subaccount_onboarding_state_subaccount_slug_uniq').on(
      table.subaccountId,
      table.playbookSlug,
    ),
    orgSlugStatusIdx: index('subaccount_onboarding_state_org_idx').on(
      table.organisationId,
      table.playbookSlug,
      table.status,
    ),
  }),
);

export type SubaccountOnboardingState = typeof subaccountOnboardingState.$inferSelect;
export type NewSubaccountOnboardingState = typeof subaccountOnboardingState.$inferInsert;
