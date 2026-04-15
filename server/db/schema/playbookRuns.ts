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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { playbookTemplateVersions } from './playbookTemplates';

// ---------------------------------------------------------------------------
// Playbook Runs — execution instances against a single subaccount
// ---------------------------------------------------------------------------

export type PlaybookRunMode = 'auto' | 'supervised' | 'background' | 'bulk';

export type PlaybookRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'partial';

export const playbookRuns = pgTable(
  'playbook_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => playbookTemplateVersions.id),
    // Sprint 4 P3.1 — execution mode: auto (default), supervised, background, bulk
    runMode: text('run_mode').notNull().default('auto').$type<PlaybookRunMode>(),
    status: text('status').notNull().default('pending').$type<PlaybookRunStatus>(),
    contextJson: jsonb('context_json').notNull().default({}).$type<Record<string, unknown>>(),
    contextSizeBytes: integer('context_size_bytes').notNull().default(0),
    replayMode: boolean('replay_mode').notNull().default(false),
    retainIndefinitely: boolean('retain_indefinitely').notNull().default(false),
    // Sprint 4 P3.1 — bulk parent/child relationship
    parentRunId: uuid('parent_run_id').references((): any => playbookRuns.id),
    targetSubaccountId: uuid('target_subaccount_id').references(() => subaccounts.id),
    startedByUserId: uuid('started_by_user_id').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: text('error'),
    failedDueToStepId: text('failed_due_to_step_id'),
    // Phase E — onboarding-playbooks-spec §9.2 / §9.3 / §9.4.
    // Drives the portal card visibility toggle and the admin Onboarding tab.
    isPortalVisible: boolean('is_portal_visible').notNull().default(false),
    isOnboardingRun: boolean('is_onboarding_run').notNull().default(false),
    // Denormalised slug (resolved from the locked template version) so the
    // §9.3 Onboarding tab can filter runs by slug without joining through
    // the template-version lineage.
    playbookSlug: text('playbook_slug'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgStatusIdx: index('playbook_runs_org_status_idx').on(table.organisationId, table.status),
    subaccountStatusIdx: index('playbook_runs_subaccount_status_idx').on(
      table.subaccountId,
      table.status
    ),
    templateVersionIdx: index('playbook_runs_template_version_idx').on(table.templateVersionId),
  })
);

export type PlaybookRun = typeof playbookRuns.$inferSelect;
export type NewPlaybookRun = typeof playbookRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Playbook Run Event Sequences — per-run monotonic counter for WS envelope
// ---------------------------------------------------------------------------

export const playbookRunEventSequences = pgTable('playbook_run_event_sequences', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => playbookRuns.id, { onDelete: 'cascade' }),
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(0),
});

export type PlaybookRunEventSequence = typeof playbookRunEventSequences.$inferSelect;

// ---------------------------------------------------------------------------
// Playbook Step Runs — per-step execution records
// ---------------------------------------------------------------------------

export type PlaybookStepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional'
  | 'agent_decision'
  | 'action_call';

export type PlaybookStepRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'invalidated';

export type PlaybookSideEffectType = 'none' | 'idempotent' | 'reversible' | 'irreversible';

export const playbookStepRuns = pgTable(
  'playbook_step_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => playbookRuns.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    stepType: text('step_type').notNull().$type<PlaybookStepType>(),
    status: text('status').notNull().default('pending').$type<PlaybookStepRunStatus>(),
    sideEffectType: text('side_effect_type').notNull().$type<PlaybookSideEffectType>(),
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
    runStatusIdx: index('playbook_step_runs_run_id_status_idx').on(table.runId, table.status),
    agentRunIdx: index('playbook_step_runs_agent_run_id_idx')
      .on(table.agentRunId)
      .where(sql`${table.agentRunId} IS NOT NULL`),
    runStepLiveUnique: uniqueIndex('playbook_step_runs_run_step_live_unique_idx')
      .on(table.runId, table.stepId)
      .where(sql`${table.status} NOT IN ('invalidated', 'failed')`),
  })
);

export type PlaybookStepRun = typeof playbookStepRuns.$inferSelect;
export type NewPlaybookStepRun = typeof playbookStepRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Playbook Step Reviews — HITL approval gate records
// ---------------------------------------------------------------------------

export type PlaybookStepReviewDecision = 'pending' | 'approved' | 'rejected' | 'edited';

export const playbookStepReviews = pgTable(
  'playbook_step_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stepRunId: uuid('step_run_id')
      .notNull()
      .references(() => playbookStepRuns.id, { onDelete: 'cascade' }),
    reviewItemId: uuid('review_item_id'),
    decision: text('decision').notNull().default('pending').$type<PlaybookStepReviewDecision>(),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stepRunIdx: index('playbook_step_reviews_step_run_idx').on(table.stepRunId),
  })
);

export type PlaybookStepReview = typeof playbookStepReviews.$inferSelect;
export type NewPlaybookStepReview = typeof playbookStepReviews.$inferInsert;

// ---------------------------------------------------------------------------
// Playbook Studio Sessions — chat authoring sessions for Phase 1 Studio
// ---------------------------------------------------------------------------

export type PlaybookStudioValidationState = 'unvalidated' | 'valid' | 'invalid';

export const playbookStudioSessions = pgTable(
  'playbook_studio_sessions',
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
      .$type<PlaybookStudioValidationState>(),
    prUrl: text('pr_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('playbook_studio_sessions_user_idx').on(table.createdByUserId),
  })
);

export type PlaybookStudioSession = typeof playbookStudioSessions.$inferSelect;
export type NewPlaybookStudioSession = typeof playbookStudioSessions.$inferInsert;
