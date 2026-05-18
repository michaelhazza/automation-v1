import { pgTable, uuid, text, real, integer, timestamp, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { agentRuns } from './agentRuns';
import { scorecards } from './scorecards';

// ---------------------------------------------------------------------------
// Scorecard Judgements — per-(run, scorecard, quality-check, trigger) verdicts.
// Trust & Verification Layer spec §6.5, §7, §10.6 (migration 0299).
//
// Five F1 snapshot fields preserve rubric state at judgement time so that
// historical verdicts remain auditable even when the scorecard is later edited.
// Tenant-isolated via canonical org-isolation RLS policy.
// ---------------------------------------------------------------------------

export const scorecardJudgements = pgTable(
  'scorecard_judgements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    runId: uuid('run_id').notNull().references(() => agentRuns.id),
    scorecardId: uuid('scorecard_id').notNull().references(() => scorecards.id),
    qualityCheckSlug: text('quality_check_slug').notNull(),
    triggerSource: text('trigger_source')
      .notNull()
      .$type<'sampled' | 'forced' | 'bench'>(),

    // Verdict
    verdict: text('verdict').notNull().$type<'pass' | 'fail' | 'inconclusive'>(),
    score: real('score'),  // 0.0–1.0; NULL when inconclusive
    reasoning: text('reasoning'),

    // F1 snapshot fields — rubric state at judgement time
    snapshotScorecardName: text('snapshot_scorecard_name').notNull(),
    snapshotQualityCheckName: text('snapshot_quality_check_name').notNull(),
    snapshotQualityCheckDesc: text('snapshot_quality_check_desc'),
    snapshotJudgeModelId: text('snapshot_judge_model_id').notNull(),
    snapshotRubricVersion: integer('snapshot_rubric_version').notNull().default(1),

    judgedAt: timestamp('judged_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    // Verdict provenance — deterministic-validators spec §5 (migration 0379)
    evaluationMethod: text('evaluation_method').notNull().default('semantic')
      .$type<'deterministic' | 'deterministic_external' | 'hybrid_deterministic_fail' | 'hybrid_semantic' | 'semantic' | 'inconclusive'>(),
    validatorSlug: text('validator_slug'),
    validatorVersion: text('validator_version'),
  },
  (table) => ({
    orgIdx: index('scorecard_judgements_org_idx').on(table.organisationId),
    runIdx: index('scorecard_judgements_run_idx').on(table.runId),
    scorecardIdx: index('scorecard_judgements_scorecard_idx').on(table.scorecardId),
    // Idempotency — one judgement per (run, scorecard, quality-check, trigger)
    runScorecardCheckTriggerUniq: unique('scorecard_judgements_run_scorecard_check_trigger_uniq')
      .on(table.runId, table.scorecardId, table.qualityCheckSlug, table.triggerSource),
    evaluationMethodCheck: check(
      'scorecard_judgements_evaluation_method_check',
      sql`${table.evaluationMethod} IN ('deterministic','deterministic_external','hybrid_deterministic_fail','hybrid_semantic','semantic','inconclusive')`
    ),
  })
);

export type ScorecardJudgement = typeof scorecardJudgements.$inferSelect;
export type NewScorecardJudgement = typeof scorecardJudgements.$inferInsert;
