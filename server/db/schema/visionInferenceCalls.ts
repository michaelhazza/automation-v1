import { pgTable, uuid, text, integer, bigint, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { ieeRuns } from './ieeRuns';

// ---------------------------------------------------------------------------
// vision_inference_calls — per-call ledger for browser vision grounding.
//
// Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md
//   §8.5 row shape, §9 RLS checklist, §12.6 unique constraint, §10 rollup model.
//
// Idempotent harvest key: (iee_run_id, step_index, call_index). Inserts use
// ON CONFLICT DO NOTHING.
//
// Append-only — no deleted_at; matches llm_requests precedent.
// ---------------------------------------------------------------------------

export const visionInferenceCalls = pgTable(
  'vision_inference_calls',
  {
    id:              uuid('id').defaultRandom().primaryKey(),
    organisationId:  uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:    uuid('subaccount_id').references(() => subaccounts.id),
    runId:           uuid('run_id').notNull().references(() => agentRuns.id),
    ieeRunId:        uuid('iee_run_id').notNull().references(() => ieeRuns.id),
    modelId:         text('model_id').notNull(),
    costCents:       integer('cost_cents').notNull().default(0),
    latencyMs:       integer('latency_ms').notNull(),
    imageSizeBytes:  bigint('image_size_bytes', { mode: 'number' }).notNull(),
    actionType:      text('action_type').notNull(),
    fallbackTrigger: boolean('fallback_trigger').notNull().default(false),
    stepIndex:       integer('step_index').notNull(),
    callIndex:       integer('call_index').notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ieeRunStepCallUniq: uniqueIndex('vision_inference_calls_iee_run_step_call_uniq')
      .on(table.ieeRunId, table.stepIndex, table.callIndex),
    orgCreatedIdx:      index('vision_inference_calls_org_created_idx')
      .on(table.organisationId, table.createdAt),
    runIdx:             index('vision_inference_calls_run_idx').on(table.runId),
  }),
);

export type VisionInferenceCall = typeof visionInferenceCalls.$inferSelect;
export type NewVisionInferenceCall = typeof visionInferenceCalls.$inferInsert;
