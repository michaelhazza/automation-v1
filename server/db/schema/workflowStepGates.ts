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
import { organisations } from './organisations';
import { workflowRuns } from './workflowRuns';
import type { SeenPayload, SeenConfidence } from '../../../shared/types/workflowStepGate.js';

// ---------------------------------------------------------------------------
// Workflow Step Gates — per-step approval / ask gate records (Workflows V1)
// Migration: 0268_workflows_v1_additive_schema.sql
// ---------------------------------------------------------------------------

export type WorkflowStepGateKind = 'approval' | 'ask';

export type WorkflowStepGateResolutionReason =
  | 'approved'
  | 'rejected'
  | 'submitted'
  | 'skipped'
  | 'run_terminated';

export const workflowStepGates = pgTable(
  'workflow_step_gates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowRunId: uuid('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    gateKind: text('gate_kind').notNull().$type<WorkflowStepGateKind>(),
    seenPayload: jsonb('seen_payload').$type<SeenPayload | null>(),
    seenConfidence: jsonb('seen_confidence').$type<SeenConfidence | null>(),
    approverPoolSnapshot: jsonb('approver_pool_snapshot').$type<string[] | null>(),
    isCriticalSynthesised: boolean('is_critical_synthesised').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionReason: text('resolution_reason').$type<WorkflowStepGateResolutionReason | null>(),
    // Self-reference: no Drizzle-level FK to avoid circular reference issues
    supersededByGateId: uuid('superseded_by_gate_id'),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
  },
  (table) => ({
    runStepUniqIdx: uniqueIndex('workflow_step_gates_run_step_uniq_idx').on(
      table.workflowRunId,
      table.stepId
    ),
    runResolvedIdx: index('workflow_step_gates_run_resolved_idx').on(
      table.workflowRunId,
      table.resolvedAt
    ),
  })
);

export type WorkflowStepGate = typeof workflowStepGates.$inferSelect;
export type NewWorkflowStepGate = typeof workflowStepGates.$inferInsert;
