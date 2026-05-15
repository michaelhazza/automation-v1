import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, uniqueIndex, smallint } from 'drizzle-orm/pg-core';
import type { ControllerStyle } from '../../../shared/types/controllerStyle.js';
import type { PolicyEnvelopeSnapshot } from '../../../shared/types/policyEnvelope.js';
import { sql } from 'drizzle-orm';
import type { AgentRunHandoffV1 } from '../../services/agentRunHandoffServicePure';
import type { DelegationScope, DelegationDirection } from '../../../shared/types/delegation.js';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { subaccountAgents } from './subaccountAgents';
import { users } from './users';
import { workspaceActors } from './workspaceActors';

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
    // User-owned-agents primitive (migration 0327): copied from agent.ownerUserId at run start.
    // NULL = subaccount-owned run (existing behaviour). Immutable once set.
    ownerUserId: uuid('owner_user_id'),
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
    executionMode: text('execution_mode').notNull().default('api').$type<'api' | 'headless' | 'claude-code' | 'iee_browser' | 'iee_dev' | 'operator_managed'>(),

    // Org vs subaccount execution scope (never inferred from nullable fields)
    executionScope: text('execution_scope').notNull().default('subaccount').$type<'subaccount' | 'org'>(),

    // Controller style for this run — resolved at run creation via controllerStyleResolver.
    // 'native' = standard limits; 'operator' = elevated limits (spec §4.1.5).
    controllerStyle: text('controller_style').notNull().default('native').$type<ControllerStyle>(),

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
      loadingMode?: 'eager' | 'lazy';
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
    // 'delegated' added in IEE Phase 0 (docs/iee-delegation-lifecycle-spec.md)
    // — the run has been handed off to a delegated execution backend (currently
    // IEE; future: OpenClaw). Non-terminal. Detail lives on the backend row
    // (iee_runs). Transitions to a terminal value when the backend reaches its
    // own terminal state, via the registry orchestrator
    // (`agentRunFinalizationService.finaliseAgentRunFromBackend`).
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'delegated' | 'cancelling' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'loop_detected' | 'budget_exceeded' | 'awaiting_clarification' | 'waiting_on_clarification' | 'completed_with_uncertainty' | 'blocked_awaiting_integration' | 'paused_for_chain_continuation' | 'paused_chain_failure' | 'paused_budget_exceeded' | 'paused_wall_clock_exceeded'>(),

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

    // Phase 2 Memory & Briefings — citation tracking (S12) + uncertainty flag (S8)
    // Migration 0137
    citedEntryIds: jsonb('cited_entry_ids').notNull().default([]).$type<string[]>(),
    hadUncertainty: boolean('had_uncertainty').notNull().default(false),

    // B1 — injected workspace_memory_entries per run (migration 0334)
    injectedEntryIds: jsonb('injected_entry_ids').$type<string[] | null>(),

    // Phase 8 / W3c — memory_block provenance trail (migration 0199)
    appliedMemoryBlockIds: jsonb('applied_memory_block_ids').notNull().default([]).$type<string[]>(),
    appliedMemoryBlockCitations: jsonb('applied_memory_block_citations').notNull().default([]).$type<Array<{
      memoryBlockId: string;
      citedSnippet?: string;
      citationScore: number;
    }>>(),

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

    // Configuration Assistant: approved ConfigPlan JSON for plan replayability (migration 0114)
    configPlanJson: jsonb('config_plan_json'),

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

    // Workflows reverse link (migration 0076) — set when this agent run was
    // dispatched by a Workflows step. Engine reads this in onAgentRunCompleted
    // to find the originating step run.
    workflowStepRunId: uuid('workflow_step_run_id'),

    // IEE Phase 0 denormalised reference (migration 0176). When the run
    // is delegated to an IEE worker, agentExecutionService writes the
    // iee_runs.id here at delegation time. Read directly by the run
    // detail API to avoid a read-time JOIN. Non-IEE runs leave this
    // null. No FK constraint — this is a denormalised cache, not an
    // integrity contract.
    ieeRunId: uuid('iee_run_id'),

    // Heartbeat — stale run detection (GSD-2 adoption)
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    lastToolStartedAt: timestamp('last_tool_started_at', { withTimezone: true }),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    // ── Pulse — failure acknowledgment (migration 0160) ──────────────
    failureAcknowledgedAt: timestamp('failure_acknowledged_at', { withTimezone: true }),

    // Feature 2 (Inline Run Now test UX) classifier — when true, the run was
    // fired from an authoring-surface test panel. Excluded from Agency P&L
    // aggregates and from the Scheduled Runs Calendar's cost estimator by
    // default. See docs/routines-response-dev-spec.md §4.4 / §4.7.
    isTestRun: boolean('is_test_run').notNull().default(false),

    // Integration block state — set when the run is paused waiting for an
    // OAuth connection. Cleared on resume or expiry sweep.
    // blockedReason: discriminator; currently only 'integration_required'.
    // integrationResumeToken: sha256 hash of the plaintext bearer token that
    //   unblocks this run. Plaintext lives only in agent_messages.meta.
    // integrationDedupKey: sha256(toolName:runId:blockSequence) — prevents
    //   double-blocking the same tool call on retry.
    blockedReason: text('blocked_reason').$type<'integration_required' | null>(),
    blockedExpiresAt: timestamp('blocked_expires_at', { withTimezone: true }),
    integrationResumeToken: text('integration_resume_token'),
    integrationDedupKey: text('integration_dedup_key'),

    // P3A: Principal model fields (migration 0164)
    principalType: text('principal_type').notNull().default('user').$type<'user' | 'service' | 'delegated'>(),
    principalId: text('principal_id').notNull().default(''),
    actingAsUserId: uuid('acting_as_user_id').references(() => users.id),
    delegationGrantId: uuid('delegation_grant_id'),

    // Live Agent Execution Log (migration 0192). `nextEventSeq` is the
    // atomic per-run counter for agent_execution_events; allocation is a
    // single `UPDATE ... RETURNING next_event_seq` so there's no MAX scan
    // or lock on the events table. `eventLimitReachedEmitted` is the
    // one-shot flag that gates the exactly-once `run.event_limit_reached`
    // signal event — see spec §4.1.
    nextEventSeq: integer('next_event_seq').notNull().default(0),
    eventLimitReachedEmitted: boolean('event_limit_reached_emitted').notNull().default(false),

    // Cached Context Infrastructure (migration 0209) — §5.8
    // bundleSnapshotIds: array of bundle_resolution_snapshots.id for this run
    bundleSnapshotIds: jsonb('bundle_snapshot_ids').$type<string[]>(),
    // variableInputHash: SHA-256 of the dynamic (post-breakpoint) content
    variableInputHash: text('variable_input_hash'),
    // runOutcome: nullable while in-flight; set atomically at terminal write
    runOutcome: text('run_outcome').$type<'completed' | 'degraded' | 'failed'>(),
    softWarnTripped: boolean('soft_warn_tripped').notNull().default(false),
    // degradedReason: diagnostic enum recorded alongside run_outcome='degraded' (§4.6)
    degradedReason: text('degraded_reason').$type<'soft_warn' | 'token_drift' | 'cache_miss'>(),

    // Paperclip Hierarchy — delegation telemetry (migration 0216, renumbered from 0204 post-merge).
    // All four columns are nullable: only populated on runs that participate
    // in a delegation chain. Ships empty; no behaviour change in this chunk.
    // `handoffSourceRunId` self-references `agent_runs.id`; the FK + ON DELETE
    // SET NULL live in the migration (see 0216_agent_runs_delegation_telemetry.sql),
    // NOT here. Declaring `.references(() => agentRuns.id, ...)` in Drizzle
    // creates a circular type inference that bloats agentRuns to `any` once
    // the table has enough columns — same reason `parentRunId` and
    // `parentSpawnRunId` are plain `uuid(...)` declarations above.
    delegationScope: text('delegation_scope').$type<DelegationScope>(),
    hierarchyDepth: smallint('hierarchy_depth'),
    delegationDirection: text('delegation_direction').$type<DelegationDirection>(),
    handoffSourceRunId: uuid('handoff_source_run_id'),

    // System monitoring — carries a request/job tracing ID into incident events
    // so a system incident can be correlated back to the agent run that caused it.
    correlationId: text('correlation_id'),
    actorId: uuid('actor_id').references(() => workspaceActors.id),

    // Policy Envelope snapshot — resolved at run start before any tool/LLM/IEE dispatch (INV-19).
    // NULL = legacy run created before migration 0309. New runs always have this set.
    policyEnvelopeSnapshot: jsonb('policy_envelope_snapshot').$type<PolicyEnvelopeSnapshot | null>(),

    // Execution Backend Adapter Contract (migration 0313) — identifies which
    // backend handled this run and the backend's own task/job identifier.
    // NULL for runs executed before this migration or by backends that do not
    // assign external task IDs. backendId is string | null (not narrowed to
    // ExecutionBackendId) to keep the schema layer independent of contract types.
    backendId: text('backend_id'),
    backendTaskId: text('backend_task_id'),

    // Operator Backend — consecutive chain-link dispatch-start failure counter
    // (migration 0338). Reset to 0 on every successful dispatch. Sole writer
    // is the dispatcher. Spec §3.4 / §3.17 item 1.
    operatorChainFailureCount: integer('operator_chain_failure_count').notNull().default(0),

    // Operator Backend — per-task budget extension accumulator (migration 0341).
    // Written by the extend-budget route (additive, never reset). The dispatcher
    // composes settings_snapshot.per_task_budget_cap_minutes as:
    //   effectiveSettings.per_task_budget_cap_minutes + perTaskBudgetExtensionMinutes
    // so extensions are scoped to this task only and never bleed into the
    // subaccount-wide settings row. Spec §3.17.4.
    perTaskBudgetExtensionMinutes: integer('per_task_budget_extension_minutes').notNull().default(0),

    // Operator Backend — assigned user (migration 0342). Populated at run
    // creation when a human user owns the task. The operator-task action
    // routes (retry-chain-failure, extend-budget) authorise via
    // "assigned user OR manager+" — the column is the data source for the
    // assigned-user branch of that rule. ON DELETE SET NULL keeps run history
    // intact when a user is removed. Spec §6.5b.
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),

    // Soft-delete timestamp (migration 0363, spec §7.6 REQ #35).
    // NULL = active run. Set by agentRunSoftDeleteService; never cleared.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

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
    // Workflows reverse lookup (migration 0076)
    workflowStepRunIdx: index('agent_runs_workflow_step_run_id_idx')
      .on(table.workflowStepRunId)
      .where(sql`${table.workflowStepRunId} IS NOT NULL`),
    // Brain Tree OS adoption P1 (migration 0095) — supports the
    // "latest handoff for this agent" lookup used by getLatestHandoffForAgent
    // and the seedFromPreviousRun read path. Partial so the index stays
    // bounded — only runs that have produced a handoff are indexed.
    latestHandoffIdx: index('agent_runs_latest_handoff_idx')
      .on(table.agentId, table.subaccountId, table.createdAt)
      .where(sql`${table.handoffJson} IS NOT NULL`),
    // P3A: principal model index (migration 0164)
    principalIdx: index('agent_runs_principal_idx')
      .on(table.principalType, table.principalId),
    // IEE Phase 0 denormalised cache + reverse lookup (migration 0176)
    ieeRunIdIdx: index('agent_runs_iee_run_id_idx')
      .on(table.ieeRunId)
      .where(sql`${table.ieeRunId} IS NOT NULL`),
    // IEE Phase 0 — hot path for live-count / dashboard / polling endpoints
    // that filter on status IN ('pending','running','delegated'). A
    // partial btree is much smaller than a general (org, status) index
    // (migration 0176).
    inflightOrgIdx: index('agent_runs_inflight_org_idx')
      .on(table.organisationId)
      .where(sql`${table.status} IN ('pending', 'running', 'delegated')`),
    // Execution Backend Adapter Contract (migration 0313) — lookup by backend
    // and dedup guard for (backend_id, backend_task_id) pairs.
    backendIdIdx: index('agent_runs_backend_id_idx')
      .on(table.backendId)
      .where(sql`${table.backendId} IS NOT NULL`),
    backendTaskUniqueIdx: uniqueIndex('agent_runs_backend_task_unique_idx')
      .on(table.backendId, table.backendTaskId)
      .where(sql`${table.backendTaskId} IS NOT NULL`),
    // User-owned-agents primitive (migration 0327)
    userOwnedIdx: index('agent_runs_user_owned_idx')
      .on(table.organisationId, table.ownerUserId, table.startedAt)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    // Soft-delete lookup (migration 0363, spec §7.6 REQ #35). Partial so
    // the index covers only deleted rows — keeps it small.
    deletedAtIdx: index('agent_runs_deleted_at_idx')
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NOT NULL`),
  })
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
