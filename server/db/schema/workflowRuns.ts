import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { workflowTemplateVersions } from './workflowTemplates';
import type { GateResolutionReason } from '../../../shared/types/workflowStepGate.js';

// ---------------------------------------------------------------------------
// Workflow Runs — execution instances against a single subaccount
// ---------------------------------------------------------------------------

export type WorkflowRunMode = 'auto' | 'supervised' | 'background' | 'bulk';

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'partial';

// Workflow run scope (migration 0171, §13.3). `subaccount` is the historical
// default — `subaccount_id` is always populated. `org` runs operate across the
// entire organisation; `subaccount_id` is null and the CHECK constraint
// `workflow_runs_scope_subaccount_consistency_chk` enforces the invariant.
export type WorkflowScope = 'subaccount' | 'org';

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    // Nullable as of migration 0171 — org-scope runs have no subaccount.
    // The scope column + CHECK constraint enforce the invariant.
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    scope: text('scope').notNull().default('subaccount').$type<WorkflowScope>(),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => workflowTemplateVersions.id),
    // Sprint 4 P3.1 — execution mode: auto (default), supervised, background, bulk
    runMode: text('run_mode').notNull().default('auto').$type<WorkflowRunMode>(),
    // F6 — Riley safety posture (explore = review all side-effecting steps;
    // execute = auto-dispatch). Orthogonal to run_mode.
    safetyMode: text('safety_mode').notNull().default('explore').$type<'explore' | 'execute'>(),
    status: text('status').notNull().default('pending').$type<WorkflowRunStatus>(),
    contextJson: jsonb('context_json').notNull().default({}).$type<Record<string, unknown>>(),
    contextSizeBytes: integer('context_size_bytes').notNull().default(0),
    replayMode: boolean('replay_mode').notNull().default(false),
    retainIndefinitely: boolean('retain_indefinitely').notNull().default(false),
    // Sprint 4 P3.1 — bulk parent/child relationship
    parentRunId: uuid('parent_run_id').references((): any => workflowRuns.id),
    targetSubaccountId: uuid('target_subaccount_id').references(() => subaccounts.id),
    startedByUserId: uuid('started_by_user_id').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    failedDueToStepId: text('failed_due_to_step_id'),
    // Workflows V1 — cost/time ceiling (migration 0270, spec §3.1)
    effectiveCostCeilingCents: integer('effective_cost_ceiling_cents'),
    effectiveWallClockCapSeconds: integer('effective_wall_clock_cap_seconds'),
    extensionCount: integer('extension_count').notNull().default(0),
    costAccumulatorCents: integer('cost_accumulator_cents').notNull().default(0),
    degradationReason: text('degradation_reason'),
    // Phase E — onboarding-Workflows-spec §9.2 / §9.3 / §9.4.
    // Drives the portal card visibility toggle and the admin Onboarding tab.
    isPortalVisible: boolean('is_portal_visible').notNull().default(false),
    isOnboardingRun: boolean('is_onboarding_run').notNull().default(false),
    // Denormalised slug (resolved from the locked template version) so the
    // §9.3 Onboarding tab can filter runs by slug without joining through
    // the template-version lineage.
    workflowSlug: text('workflow_slug'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgStatusIdx: index('workflow_runs_org_status_idx').on(table.organisationId, table.status),
    subaccountStatusIdx: index('workflow_runs_subaccount_status_idx').on(
      table.subaccountId,
      table.status
    ),
    templateVersionIdx: index('workflow_runs_template_version_idx').on(table.templateVersionId),
    // Workflows V1 (migration 0270)
    statusPausedIdx: index('workflow_runs_status_paused_idx')
      .on(table.id)
      .where(sql`${table.status} = 'paused'`),
    statusUpdatedIdx: index('workflow_runs_status_updated_idx').on(table.status, table.updatedAt),
    // Workflows V1 (migration 0270) — accumulator never goes negative
    costAccumulatorNonneg: check(
      'workflow_runs_cost_accumulator_nonneg',
      sql`${table.costAccumulatorCents} >= 0`,
    ),
  })
);

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Workflow Run Event Sequences — per-run monotonic counter for WS envelope
// ---------------------------------------------------------------------------

export const workflowRunEventSequences = pgTable('workflow_run_event_sequences', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => workflowRuns.id, { onDelete: 'cascade' }),
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
});

export type WorkflowRunEventSequence = typeof workflowRunEventSequences.$inferSelect;

// ---------------------------------------------------------------------------
// Workflow Step Runs — per-step execution records
// ---------------------------------------------------------------------------

export type WorkflowStepType =
  // V1 user-facing ("four A's") names — used in Studio-authored templates.
  | 'agent'
  | 'action'
  | 'ask'
  // Engine / legacy names — used in system templates and pre-V1 forks.
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional'
  | 'agent_decision'
  | 'action_call'
  | 'invoke_automation';

export type WorkflowStepRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'invalidated';

export type WorkflowSideEffectType = 'none' | 'idempotent' | 'reversible' | 'irreversible';

export const workflowStepRuns = pgTable(
  'workflow_step_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    stepType: text('step_type').notNull().$type<WorkflowStepType>(),
    status: text('status').notNull().default('pending').$type<WorkflowStepRunStatus>(),
    sideEffectType: text('side_effect_type').notNull().$type<WorkflowSideEffectType>(),
    dependsOn: jsonb('depends_on').notNull().default([]).$type<string[]>(),
    inputJson: jsonb('input_json').$type<Record<string, unknown> | null>(),
    inputHash: text('input_hash'),
    outputJson: jsonb('output_json').$type<Record<string, unknown> | null>(),
    outputHash: text('output_hash'),
    outputInlineRefId: uuid('output_inline_ref_id'),
    qualityScore: smallint('quality_score'),
    evaluationMeta: jsonb('evaluation_meta').$type<Record<string, unknown> | null>(),
    agentRunId: uuid('agent_run_id'),
    attempt: integer('attempt').notNull().default(1),
    version: integer('version').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runStatusIdx: index('workflow_step_runs_run_id_status_idx').on(table.runId, table.status),
    agentRunIdx: index('workflow_step_runs_agent_run_id_idx')
      .on(table.agentRunId)
      .where(sql`${table.agentRunId} IS NOT NULL`),
    runStepLiveUnique: uniqueIndex('workflow_step_runs_run_step_live_unique_idx')
      .on(table.runId, table.stepId)
      .where(sql`${table.status} NOT IN ('invalidated', 'failed')`),
  })
);

export type WorkflowStepRun = typeof workflowStepRuns.$inferSelect;
export type NewWorkflowStepRun = typeof workflowStepRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Workflow Step Reviews — HITL approval gate records
// ---------------------------------------------------------------------------

export type WorkflowStepReviewDecision = 'pending' | 'approved' | 'rejected' | 'edited';

export const workflowStepReviews = pgTable(
  'workflow_step_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stepRunId: uuid('step_run_id')
      .notNull()
      .references(() => workflowStepRuns.id, { onDelete: 'cascade' }),
    reviewItemId: uuid('review_item_id'),
    decision: text('decision').notNull().default('pending').$type<WorkflowStepReviewDecision>(),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Workflows V1 (migration 0270)
    gateId: uuid('gate_id'),
    decisionReason: text('decision_reason'),
    resolutionReason: text('resolution_reason').$type<GateResolutionReason | null>(),
  },
  (table) => ({
    stepRunIdx: index('workflow_step_reviews_step_run_idx').on(table.stepRunId),
    // Unique: one decision per (gate, deciding user) for non-null deciders
    gateUserUniqIdx: uniqueIndex('workflow_step_reviews_gate_user_uniq_idx')
      .on(table.gateId, table.decidedByUserId)
      .where(sql`${table.decidedByUserId} IS NOT NULL`),
  })
);

export type WorkflowStepReview = typeof workflowStepReviews.$inferSelect;
export type NewWorkflowStepReview = typeof workflowStepReviews.$inferInsert;

// ---------------------------------------------------------------------------
// Workflow Studio Sessions — chat authoring sessions for Phase 1 Studio
// ---------------------------------------------------------------------------

export type WorkflowStudioValidationState = 'unvalidated' | 'valid' | 'invalid';

export const workflowStudioSessions = pgTable(
  'workflow_studio_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    agentRunId: uuid('agent_run_id'),
    candidateFileContents: text('candidate_file_contents').notNull().default(''),
    candidateValidationState: text('candidate_validation_state')
      .notNull()
      .default('unvalidated')
      .$type<WorkflowStudioValidationState>(),
    prUrl: text('pr_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('workflow_studio_sessions_user_idx').on(table.createdByUserId),
  })
);

export type WorkflowStudioSession = typeof workflowStudioSessions.$inferSelect;
export type NewWorkflowStudioSession = typeof workflowStudioSessions.$inferInsert;
