import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { workflowRuns } from './workflowRuns';

/**
 * Mid-conversation progress snapshot for the 9-step onboarding arc (§8.6 S5).
 * Null when no resume state has been captured (e.g. pre-conversation or after
 * markReady).
 */
export interface OnboardingResumeState {
  /** 1-indexed current step in the 9-step arc. */
  currentStep: number;
  /** Answers collected so far, keyed by ConfigQuestion.id. */
  answers: Record<string, unknown>;
  /** Procedural flags for the non-question steps (identity confirmed, portal mode set, etc.). */
  proceduralFlags?: Record<string, boolean>;
  /** ISO timestamp of the most recent update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Subaccount Onboarding State — completion tracking per (subaccount, slug)
//
// Phase G / spec §10.3 (G10.3). Written by `WorkflowRunService` on terminal
// transitions for onboarding runs (isOnboardingRun = true). The Onboarding
// tab (§9.3) reads this table for status + last-run metadata without scanning
// `workflow_runs`.
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
    workflowSlug: text('workflow_slug').notNull(),
    status: text('status').notNull().$type<SubaccountOnboardingStatus>(),
    lastRunId: uuid('last_run_id').references(() => workflowRuns.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Mid-conversation progress for resume-from-step (migration 0135, S5). */
    resumeState: jsonb('resume_state').$type<OnboardingResumeState | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountSlugUniq: uniqueIndex('subaccount_onboarding_state_subaccount_slug_uniq').on(
      table.subaccountId,
      table.workflowSlug,
    ),
    orgSlugStatusIdx: index('subaccount_onboarding_state_org_idx').on(
      table.organisationId,
      table.workflowSlug,
      table.status,
    ),
  }),
);

export type SubaccountOnboardingState = typeof subaccountOnboardingState.$inferSelect;
export type NewSubaccountOnboardingState = typeof subaccountOnboardingState.$inferInsert;
