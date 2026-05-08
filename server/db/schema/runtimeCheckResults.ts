import { pgTable, uuid, text, integer, boolean, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { agentExecutionEvents } from './agentExecutionEvents';

// ---------------------------------------------------------------------------
// Runtime Check Results — per-step verification verdicts (migration 0289)
// Trust & Verification Layer spec §6.2, §7, §10.1
// Tenant-isolated via canonical org-isolation RLS policy.
// ---------------------------------------------------------------------------

export const runtimeCheckResults = pgTable(
  'runtime_check_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    eventId: uuid('event_id')
      .references(() => agentExecutionEvents.id),
    sequenceNumber: integer('sequence_number').notNull(),
    skillSlug: text('skill_slug').notNull(),
    // Reserved for future retry support (spec F3)
    attemptNumber: integer('attempt_number').notNull().default(1),
    state: text('state').notNull().$type<'pass' | 'fail' | 'inconclusive' | 'pending' | 'not_applicable'>(),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text').notNull(),
    impact: text('impact').notNull().$type<'blocking' | 'informational'>(),
    suggestedFix: text('suggested_fix'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
    blastRadius: text('blast_radius').notNull().$type<'self' | 'tenant' | 'external'>(),
    reversible: boolean('reversible').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('runtime_check_results_org_idx').on(table.organisationId),
    runIdx: index('runtime_check_results_run_idx').on(table.runId),
    // Idempotency constraint — prevents duplicate verdicts on retry (§10.1)
    runSeqSkillAttemptUniq: unique('runtime_check_results_run_seq_skill_attempt_uniq')
      .on(table.runId, table.sequenceNumber, table.skillSlug, table.attemptNumber),
  })
);

export type RuntimeCheckResult = typeof runtimeCheckResults.$inferSelect;
export type NewRuntimeCheckResult = typeof runtimeCheckResults.$inferInsert;
