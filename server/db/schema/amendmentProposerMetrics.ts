import { pgTable, uuid, text, integer, date, timestamp, unique } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Amendment Proposer Metrics — system-scoped per-model quality telemetry.
// NO RLS — this table is system-scoped, never tenant-bound (§7.5 + §14).
// Closed-Loop Skill Improvement spec §7.5 (migration 0370).
// ---------------------------------------------------------------------------

export const amendmentProposerMetrics = pgTable(
  'amendment_proposer_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposerModelVersion: text('proposer_model_version').notNull(),
    periodStart: date('period_start').notNull(),
    proposalCount: integer('proposal_count').notNull().default(0),
    peerReviewDropCount: integer('peer_review_drop_count').notNull().default(0),
    rejectCount: integer('reject_count').notNull().default(0),
    rollbackCount: integer('rollback_count').notNull().default(0),
    regressionFailureAfterAcceptCount: integer('regression_failure_after_accept_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // UNIQUE required for UPSERT semantics in Chunk 4
    modelPeriodUniq: unique('amendment_proposer_metrics_model_period_uniq').on(
      table.proposerModelVersion,
      table.periodStart,
    ),
  }),
);

export type AmendmentProposerMetric = typeof amendmentProposerMetrics.$inferSelect;
export type NewAmendmentProposerMetric = typeof amendmentProposerMetrics.$inferInsert;
