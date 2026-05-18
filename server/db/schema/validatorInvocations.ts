import { pgTable, uuid, text, integer, boolean, jsonb, numeric, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { scorecardJudgements } from './scorecardJudgements';

// ---------------------------------------------------------------------------
// validator_invocations — append-only audit ledger for every validator call.
// system-scoped: no organisation_id; the only tenant pointer is verdict_id FK
// to scorecard_judgements (which IS tenant-isolated via RLS).
// Evidence stored here is redacted per spec §6.6.
// Deterministic-validators spec §5.3 (migration 0379).
// ---------------------------------------------------------------------------

export const validatorInvocations = pgTable(
  'validator_invocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    verdictId: uuid('verdict_id').notNull().references(() => scorecardJudgements.id, { onDelete: 'cascade' }),
    validatorSlug: text('validator_slug').notNull(),
    validatorVersion: text('validator_version').notNull(),
    evaluationMethod: text('evaluation_method').notNull()
      .$type<'deterministic' | 'deterministic_external' | 'hybrid_deterministic_fail' | 'hybrid_semantic' | 'semantic' | 'inconclusive' | 'hybrid_precondition_pass'>(),
    latencyMs: integer('latency_ms').notNull(),
    externalCallCount: integer('external_call_count').notNull().default(0),
    resultPassed: boolean('result_passed').notNull(),
    resultScore: numeric('result_score', { precision: 4, scale: 3 }),
    evidenceJson: jsonb('evidence_json'),
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugCreatedIdx: index('validator_invocations_slug_created_idx').on(table.validatorSlug, table.createdAt),
    verdictIdx: index('validator_invocations_verdict_idx').on(table.verdictId),
    evaluationMethodCheck: check(
      'validator_invocations_evaluation_method_check',
      sql`${table.evaluationMethod} IN ('deterministic','deterministic_external','hybrid_deterministic_fail','hybrid_semantic','semantic','inconclusive','hybrid_precondition_pass')`
    ),
  })
);

export type ValidatorInvocationRow = typeof validatorInvocations.$inferSelect;
export type NewValidatorInvocation = typeof validatorInvocations.$inferInsert;
