import { pgTable, uuid, text, real, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { users } from './users';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// Bench Runs + Bench Results — operator-triggered model comparison.
// Trust & Verification Layer spec §6.6, §7, §12.2 (migration 0300).
// Migration 0296 adds: approved_model_id, summary, 'partial' state.
// Migration 0297 adds: 'awaiting_confirm' and 'awaiting_approval' states.
//
// State machine:
//   awaiting_confirm → running → awaiting_approval → completed
//                             → partial (some samples failed)
//                             → failed  (catastrophic)
//   any non-terminal → cancelled
//
// bench_runs: the job record (state machine above).
// bench_results: per-candidate per-sample outcome rows.
// Both tables are tenant-isolated via canonical org-isolation RLS policy.
// ---------------------------------------------------------------------------

export interface BenchSummary {
  recommendedModelId: string | null;
  reason: string;
}

export const benchRuns = pgTable(
  'bench_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    triggeredByUserId: uuid('triggered_by_user_id').notNull().references(() => users.id),
    targetAgentId: uuid('target_agent_id').references(() => agents.id),
    targetSkillSlug: text('target_skill_slug'),
    state: text('state')
      .notNull()
      .default('awaiting_confirm')
      .$type<'pending' | 'awaiting_confirm' | 'running' | 'awaiting_approval' | 'completed' | 'partial' | 'failed' | 'cancelled'>(),
    candidateModelIds: jsonb('candidate_model_ids').notNull().default([]).$type<string[]>(),
    sampleCount: integer('sample_count').notNull().default(10),
    estimatedCostCents: integer('estimated_cost_cents'),
    actualCostCents: integer('actual_cost_cents'),
    approvedModelId: text('approved_model_id'),  // 0296: set during F5 approve
    summary: jsonb('summary').$type<BenchSummary>(),  // 0296: written by benchExecuteJob
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('bench_runs_org_idx').on(table.organisationId),
    userIdx: index('bench_runs_user_idx').on(table.triggeredByUserId),
    // Idempotency: one bench per user+target per minute
    userTargetMinuteUniq: unique('bench_runs_user_target_minute_uniq')
      .on(table.triggeredByUserId, table.targetAgentId, table.targetSkillSlug),
  })
);

export const benchResults = pgTable(
  'bench_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    benchRunId: uuid('bench_run_id').notNull().references(() => benchRuns.id),
    candidateModelId: text('candidate_model_id').notNull(),
    sampleIndex: integer('sample_index').notNull(),
    verdict: text('verdict').$type<'pass' | 'fail' | 'inconclusive' | 'error'>(),
    score: real('score'),
    reasoning: text('reasoning'),
    latencyMs: integer('latency_ms'),
    costCents: integer('cost_cents'),
    rawOutput: text('raw_output'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('bench_results_org_idx').on(table.organisationId),
    benchRunIdx: index('bench_results_bench_run_idx').on(table.benchRunId),
    runModelSampleUniq: unique('bench_results_run_model_sample_uniq')
      .on(table.benchRunId, table.candidateModelId, table.sampleIndex),
  })
);

export type BenchRun = typeof benchRuns.$inferSelect;
export type NewBenchRun = typeof benchRuns.$inferInsert;
export type BenchResult = typeof benchResults.$inferSelect;
export type NewBenchResult = typeof benchResults.$inferInsert;
