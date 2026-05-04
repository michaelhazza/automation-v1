import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { workflowRuns } from './workflowRuns';
import type { SeenPayload, SeenConfidence, ApproverPoolSnapshot, GateKind, GateResolutionReason } from '../../../shared/types/workflowStepGate.js';

// ---------------------------------------------------------------------------
// Workflow Step Gates — per-step approval/ask gate records
// Migration 0270. Spec: docs/workflows-dev-spec.md §3.
// ---------------------------------------------------------------------------

export const workflowStepGates = pgTable(
  'workflow_step_gates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    gateKind: text('gate_kind').notNull().$type<GateKind>(),
    seenPayload: jsonb('seen_payload').$type<SeenPayload | null>(),
    seenConfidence: jsonb('seen_confidence').$type<SeenConfidence | null>(),
    approverPoolSnapshot: jsonb('approver_pool_snapshot').$type<ApproverPoolSnapshot | null>(),
    isCriticalSynthesised: boolean('is_critical_synthesised').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionReason: text('resolution_reason').$type<GateResolutionReason | null>(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
  },
  (table) => ({
    runStepUniq: uniqueIndex('workflow_step_gates_run_step_uniq_idx').on(
      table.workflowRunId,
      table.stepId
    ),
    runResolvedIdx: index('workflow_step_gates_run_resolved_idx')
      .on(table.workflowRunId)
      .where(sql`${table.resolvedAt} IS NULL`),
  })
);

export type WorkflowStepGateRow = typeof workflowStepGates.$inferSelect;
export type NewWorkflowStepGateRow = typeof workflowStepGates.$inferInsert;
