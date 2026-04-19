import { pgTable, uuid, text, integer, jsonb, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { ieeRuns } from './ieeRuns';
import type { FailureReason } from '../../../shared/iee/failureReason';

// ---------------------------------------------------------------------------
// iee_steps — one row per iteration of the IEE execution loop.
//
// Spec: docs/iee-development-spec.md §2.1.2.
//
// Append-only during the run. Cascade-deleted with the parent ieeRun.
// No soft delete: steps are owned by their run.
// ---------------------------------------------------------------------------

export const ieeSteps = pgTable(
  'iee_steps',
  {
    id:              uuid('id').defaultRandom().primaryKey(),
    ieeRunId:        uuid('iee_run_id').notNull().references(() => ieeRuns.id, { onDelete: 'cascade' }),
    // Denormalised for tenant-scoped queries without an extra join.
    organisationId:  uuid('organisation_id').notNull().references(() => organisations.id),

    stepNumber:      integer('step_number').notNull(),
    actionType:      text('action_type').notNull(),
    input:           jsonb('input').notNull(),
    output:          jsonb('output'),
    success:         boolean('success').notNull(),
    // References the shared FailureReason enum directly so step-level
    // failure classification stays in lockstep with the run-level
    // iee_runs.failureReason. Previously an inline subset lived here and
    // drifted when new failure reasons were added (scope_violation,
    // decision_*, worker_terminated), causing type errors when writers
    // tried to assign a wider FailureReason to this narrower column.
    failureReason:   text('failure_reason').$type<FailureReason>(),
    durationMs:      integer('duration_ms'),

    createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Prevents duplicate step writes if the worker retries
    runStepUniqIdx:  uniqueIndex('iee_steps_run_step_unique_idx').on(table.ieeRunId, table.stepNumber),
    orgCreatedIdx:   index('iee_steps_org_created_idx').on(table.organisationId, table.createdAt),
    runIdx:          index('iee_steps_run_idx').on(table.ieeRunId),
  }),
);

export type IeeStep = typeof ieeSteps.$inferSelect;
export type NewIeeStep = typeof ieeSteps.$inferInsert;
