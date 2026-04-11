import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AgentRunHandoffV1 } from '../../services/agentRunHandoffServicePure';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { subaccountAgents } from './subaccountAgents';

// ---------------------------------------------------------------------------
// Agent Runs — logs of autonomous agent executions
// ---------------------------------------------------------------------------

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    subaccountAgentId: uuid('subaccount_agent_id')
      .references(() => subaccountAgents.id),

    // Idempotency — prevents duplicate runs on retry
    idempotencyKey: text('idempotency_key'),

    // How this run was initiated
    runType: text('run_type').notNull().$type<'scheduled' | 'manual' | 'triggered'>(),
    // 'iee_browser' / 'iee_dev' added rev 6 §9.1 — these route the run through
    // the Integrated Execution Environment (server/services/ieeExecutionService.ts)
    // instead of the standard API/headless tool dispatch.
    executionMode: text('execution_mode').notNull().default('api').$type<'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev'>(),

    // Org vs subaccount execution scope (never inferred from nullable fields)
    executionScope: text('execution_scope').notNull().default('subaccount').$type<'subaccount' | 'org'>(),

    // How the run was sourced — explicit for observability and segmentation
    runSource: text('run_source').$type<'scheduler' | 'manual' | 'trigger' | 'handoff' | 'sub_agent' | 'system'>(),

    // Run result classification (success/partial/failed)
    runResultStatus: text('run_result_status').$type<'success' | 'partial' | 'failed'>(),

    // Config snapshot for reproducibility and drift detection
    configSnapshot: jsonb('config_snapshot'),
    configHash: text('config_hash'),
    resolvedSkillSlugs: jsonb('resolved_skill_slugs').$type<string[]>(),
    resolvedLimits: jsonb('resolved_limits'),

    // Mutable run-scoped metadata bucket. Distinct from configSnapshot,
    // which is immutable and reflects the start-of-run resolved config.
    // Used for write-during-run state like Slack post dedup hashes,
    // fingerprint write tracking, etc. Spec v3.4 §5.5.1 / T11.
    runMetadata: jsonb('run_metadata').notNull().default({}).$type<Record<string, unknown>>(),

    // Snapshot of the context data sources considered for this run, captured
    // by loadRunContextData at run-start time. Frozen after the run starts
    // (except for an optional post-render `truncated: true` safety-net flip).
    // Used by the run detail UI Context Sources panel for debugging.
    // Migration 0078. See docs/cascading-context-data-sources-spec.md §7.5.
    contextSourcesSnapshot: jsonb('context_sources_snapshot').$type<Array<{
      id: string;
      scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
      name: string;
      description: string | null;
      contentType: string;
      loadingMode: 'eager' | 'lazy';
      sizeBytes: number;
      tokenCount: number;
      fetchOk: boolean;
      orderIndex: number;
      includedInPrompt: boolean;
      truncated: boolean;
      suppressedByOverride: boolean;
      suppressedBy?: string;
      exclusionReason: 'budget_exceeded' | 'override_suppressed' | 'lazy_not_rendered' | null;
    }>>(),

    // Status tracking
    // Sprint 5 P4.1: added 'awaiting_clarification' for ask_clarifying_question
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' | 'awaiting_clarification'>(),

    // Context & config
    triggerContext: jsonb('trigger_context'), // what initiated the run
    taskId: uuid('task_id'), // if working on a specific board task
    projectId: uuid('project_id'), // cost attribution — set at run creation, never backfilled
    // systemPromptSnapshot and toolCallsLog moved to agent_run_snapshots (H-5 blob extraction)
    skillsUsed: jsonb('skills_used'), // array of skill slugs available for this run

    totalToolCalls: integer('total_tool_calls').notNull().default(0),

    // Token tracking
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    tokenBudget: integer('token_budget').notNull().default(30000),

    // Error tracking
    errorMessage: text('error_message'),
    errorDetail: jsonb('error_detail'),

    // Impact counters
    tasksCreated: integer('tasks_created').notNull().default(0),
    tasksUpdated: integer('tasks_updated').notNull().default(0),
    deliverablesCreated: integer('deliverables_created').notNull().default(0),

    // Replayability: memory state captured at run start
    memoryStateAtStart: text('memory_state_at_start'),

    // Summary of what the agent did (generated by the agent in its final response)
    summary: text('summary'),

    // Sprint 5 P4.3: Plan emitted during the planning prelude for complex runs.
    planJson: jsonb('plan_json'),

    // Brain Tree OS adoption P1 (migration 0095) — structured handoff document
    // produced when the run reaches a terminal state. The shape is versioned;
    // see AgentRunHandoffV1 in server/services/agentRunHandoffServicePure.ts.
    // Reads must tolerate null (legacy runs) and unknown future fields.
    handoffJson: jsonb('handoff_json').$type<AgentRunHandoffV1 | null>(),

    // Context tracking
    systemPromptTokens: integer('system_prompt_tokens').notNull().default(0),

    // Handoff tracking
    handoffDepth: integer('handoff_depth').notNull().default(0),
    parentRunId: uuid('parent_run_id'),

    // Sub-agent tracking — M-10: proper boolean (was integer 0/1)
    isSubAgent: boolean('is_sub_agent').notNull().default(false),
    parentSpawnRunId: uuid('parent_spawn_run_id'),

    // Playbooks reverse link (migration 0076) — set when this agent run was
    // dispatched by a Playbooks step. Engine reads this in onAgentRunCompleted
    // to find the originating step run.
    playbookStepRunId: uuid('playbook_step_run_id'),

    // Heartbeat — stale run detection (GSD-2 adoption)
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    lastToolStartedAt: timestamp('last_tool_started_at', { withTimezone: true }),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('agent_runs_org_idx').on(table.organisationId),
    subaccountIdx: index('agent_runs_subaccount_idx').on(table.subaccountId),
    agentIdx: index('agent_runs_agent_idx').on(table.agentId),
    statusIdx: index('agent_runs_status_idx').on(table.status),
    orgStatusIdx: index('agent_runs_org_status_idx').on(table.organisationId, table.status),
    subaccountStatusIdx: index('agent_runs_subaccount_status_idx').on(table.subaccountId, table.status),
    createdAtIdx: index('agent_runs_created_at_idx').on(table.createdAt),
    subaccountAgentIdx: index('agent_runs_subaccount_agent_idx').on(table.subaccountAgentId),
    // M-4/M-16: missing indexes on FK columns
    taskIdIdx: index('agent_runs_task_id_idx').on(table.taskId),
    parentRunIdIdx: index('agent_runs_parent_run_id_idx').on(table.parentRunId),
    parentSpawnRunIdIdx: index('agent_runs_parent_spawn_run_id_idx').on(table.parentSpawnRunId),
    idempotencyKeyIdx: uniqueIndex('agent_runs_idempotency_key_idx').on(table.idempotencyKey),
    // Stale run cleanup query
    staleRunIdx: index('agent_runs_stale_run_idx').on(table.status, table.lastActivityAt),
    // Playbooks reverse lookup (migration 0076)
    playbookStepRunIdx: index('agent_runs_playbook_step_run_id_idx')
      .on(table.playbookStepRunId)
      .where(sql`${table.playbookStepRunId} IS NOT NULL`),
  })
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
