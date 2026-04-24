import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { users } from './users';
import type { FlowDefinition, FlowRunStatus, FlowCheckpoint } from '../../types/flow';

// ---------------------------------------------------------------------------
// Flow Runs — one row per workflow execution (Flows pattern).
// Schema matches migration 0037_phase1c_memory_and_workflows.sql
// Renamed from workflow_runs via migration 0219.
// ---------------------------------------------------------------------------

export const flowRuns = pgTable(
  'flow_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id),

    /** Frozen snapshot of the FlowDefinition at run-start time. */
    workflowDefinition: jsonb('workflow_definition').notNull().$type<FlowDefinition>(),
    workflowName: text('workflow_name').notNull().default(''),
    workflowVersion: text('workflow_version').notNull().default('1.0.0'),

    status: text('status').notNull().$type<FlowRunStatus>().default('running'),

    /** Index into workflowDefinition.steps pointing at the active step. */
    currentStepIndex: integer('current_step_index').notNull().default(0),

    /**
     * Accumulated outputs keyed by stepId.
     * Merged into the payload of downstream steps at execution time.
     */
    stepOutputs: jsonb('step_outputs').notNull().$type<Record<string, unknown>>().default({}),

    /**
     * LangGraph-style checkpoint — written after each step completes.
     * Allows deterministic resume after process restart or HITL pause.
     */
    checkpoint: jsonb('checkpoint').$type<FlowCheckpoint>(),

    /** Optional: the user who triggered this workflow. */
    triggeredBy: uuid('triggered_by').references(() => users.id),

    /** Populated when status = 'failed'. */
    errorMessage: text('error_message'),

    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('idx_flow_runs_org').on(table.organisationId, table.status),
    subaccountIdx: index('idx_flow_runs_subaccount').on(table.subaccountId, table.status),
  }),
);

export type FlowRun = typeof flowRuns.$inferSelect;
export type NewFlowRun = typeof flowRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Flow Step Outputs — append-only log of step results.
// Renamed from workflow_step_outputs via migration 0219.
// ---------------------------------------------------------------------------

export const flowStepOutputs = pgTable(
  'flow_step_outputs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flowRunId: uuid('flow_run_id').notNull().references(() => flowRuns.id),

    stepId: text('step_id').notNull(),
    stepIndex: integer('step_index').notNull(),

    /** The agent run that executed this step (if applicable). */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),

    output: jsonb('output'),
    /** 'completed' | 'failed' | 'skipped' */
    status: text('status').notNull().$type<'completed' | 'failed' | 'skipped'>().default('completed'),
    errorMessage: text('error_message'),

    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    runIdx: index('idx_flow_step_outputs_run').on(table.flowRunId, table.stepIndex),
  }),
);

export type FlowStepOutput = typeof flowStepOutputs.$inferSelect;
export type NewFlowStepOutput = typeof flowStepOutputs.$inferInsert;
