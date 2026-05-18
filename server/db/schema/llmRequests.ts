import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { agentRuns } from './agentRuns';
import { executions } from './executions';
import { ieeRuns } from './ieeRuns';
import { operatorRuns } from './operatorRuns';
import { browserWarmSessions } from './browserWarmSessions';

// ---------------------------------------------------------------------------
// llm_requests — append-only financial ledger
// Every single LLM call produces exactly one row. Never update, never delete.
//
// Rev §6 (LLM observability generalisation, migration 0185):
//   - `sourceId` (polymorphic FK, no RI) + `featureTag` (kebab-case identifier)
//     let non-agent consumers (skill analyzer, future background jobs) plug in
//     without adding a typed FK per consumer.
//   - `parseFailureRawExcerpt` (≤2 KB) captures truncated LLM responses on
//     post-processor schema failures so parse bugs are debuggable from our own
//     data instead of the Anthropic console.
//   - `abortReason` distinguishes caller-timeout from user-cancel on
//     AbortController-initiated aborts.
//   - `executionPhase` is now nullable — required for agent_run/process_execution/iee
//     rows, NULL for system/analyzer rows. Enforced by DB CHECK constraint
//     (see migration 0185).
// ---------------------------------------------------------------------------

export const llmRequests = pgTable(
  'llm_requests',
  {
    id:             uuid('id').defaultRandom().primaryKey(),

    // Idempotency — exactly-once billing + execution
    idempotencyKey: text('idempotency_key').unique().notNull(),

    // Attribution
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:   uuid('subaccount_id').references(() => subaccounts.id),
    userId:         uuid('user_id').references(() => users.id),
    // sourceType no longer has a default — every insert path must set it
    // explicitly so the attribution CHECK constraint in migration 0185 can't
    // be satisfied by accident.
    sourceType:     text('source_type').notNull(),
    // 'agent_run' | 'process_execution' | 'system' | 'iee' | 'analyzer' | 'sandbox_compute' | 'sandbox_compute_correction'
    runId:          uuid('run_id').references(() => agentRuns.id),
    executionId:    uuid('execution_id').references(() => executions.id),
    // IEE attribution — added in rev 6/§13.1. When sourceType='iee', this MUST be set.
    // Enforced by:
    //   1. Router-level guard in server/services/llmRouter.ts
    //   2. DB CHECK constraint llm_requests_iee_requires_run_id (see migration)
    ieeRunId:       uuid('iee_run_id').references(() => ieeRuns.id),
    // Polymorphic FK — populated when sourceType IN ('system','analyzer').
    // No referential integrity constraint (would need to reference multiple tables).
    // For sourceType='analyzer', points to skill_analyzer_jobs.id.
    sourceId:       uuid('source_id'),
    // Feature identifier — kebab-case, e.g. 'skill-analyzer-classify',
    // 'workspace-memory-compile'. Consumed by P&L dashboards and cost-attribution.
    // Defaults to 'unknown' so the column can be NOT NULL without breaking legacy
    // inserts; the router logs a warning when it sees the default in non-test code.
    featureTag:     text('feature_tag').notNull().default('unknown'),
    // Spec §11.7.1 — distinguishes LLM calls made on the main app side from
    // those made by the IEE worker side, so the run-detail Cost panel can
    // split LLM cost between app and worker for the same run. After the
    // worker-substrate retirement (iee-browser-on-e2b migration), browser
    // sandbox costs are written by app-side services; the `iee-browser-warm-pool`
    // value tags warm-session idle-cost rows specifically (browserWarmPool).
    callSite:       text('call_site').notNull().default('app').$type<'app' | 'worker' | 'iee-browser-warm-pool'>(),
    agentName:      text('agent_name'),
    taskType:       text('task_type').notNull().default('general'),

    // Provider
    provider:           text('provider').notNull().default('anthropic'),
    model:              text('model').notNull(),
    providerRequestId:  text('provider_request_id'),

    // Tokens (router-counted + provider-reported for dispute resolution)
    tokensIn:          integer('tokens_in').notNull().default(0),
    tokensOut:         integer('tokens_out').notNull().default(0),
    providerTokensIn:  integer('provider_tokens_in'),
    providerTokensOut: integer('provider_tokens_out'),

    // Cost (audit-grade precision)
    costRaw:              numeric('cost_raw', { precision: 12, scale: 8 }).notNull().default('0'),
    costWithMargin:       numeric('cost_with_margin', { precision: 12, scale: 8 }).notNull().default('0'),
    costWithMarginCents:  integer('cost_with_margin_cents').notNull().default(0),
    marginMultiplier:     numeric('margin_multiplier', { precision: 6, scale: 4 }).notNull().default('1.30'),
    fixedFeeCents:        integer('fixed_fee_cents').notNull().default(0),

    // Audit hashes (prove content without storing payloads inline)
    requestPayloadHash:  text('request_payload_hash'),
    responsePayloadHash: text('response_payload_hash'),

    // Latency
    providerLatencyMs: integer('provider_latency_ms'),
    routerOverheadMs:  integer('router_overhead_ms'),

    // Status and retry
    status:        text('status').notNull().default('success'),
    // See LLM_REQUEST_STATUSES constant below.
    errorMessage:  text('error_message'),
    attemptNumber: integer('attempt_number').notNull().default(1),
    // Truncated (≤2 KB) excerpt of the LLM response that failed post-processing
    // schema validation — captured by the router when a caller's `postProcess`
    // hook throws ParseFailureError. Used by the detail-drawer in the System P&L
    // page and ad-hoc SQL for debugging parse regressions.
    parseFailureRawExcerpt: text('parse_failure_raw_excerpt'),
    // When status='aborted_by_caller', carries the caller's intent:
    //   'caller_timeout' — caller-side timeout elapsed and fired abort()
    //   'caller_cancel'  — user-initiated or job-level cancellation
    // NULL for status='client_disconnected' (we can't tell which side
    // initiated a mid-body network RST).
    abortReason:   text('abort_reason'),

    // Caching — tokens read from Anthropic's ephemeral cache
    cachedPromptTokens: integer('cached_prompt_tokens').notNull().default(0),
    // Tokens written to Anthropic's ephemeral cache on this call (migration 0210 §5.9)
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    // Call-level assembled prefix hash from cachedContextOrchestrator (migration 0210 §5.9)
    prefixHash: text('prefix_hash'),

    // Routing metadata — now nullable (rev §6). Required for agent_run /
    // process_execution / iee rows; NULL for system / analyzer rows.
    // Enforced by DB CHECK constraint llm_requests_execution_phase_ck.
    executionPhase:   text('execution_phase'),
    // 'planning' | 'execution' | 'synthesis' | 'iee_loop_step'
    capabilityTier:   text('capability_tier').notNull().default('frontier'),
    // 'frontier' | 'economy'
    wasDowngraded:    boolean('was_downgraded').notNull().default(false),
    routingReason:    text('routing_reason'),
    // 'forced' | 'ceiling' | 'economy' | 'fallback'

    // Escalation tracking
    wasEscalated:     boolean('was_escalated').notNull().default(false),
    escalationReason: text('escalation_reason'),

    // Fallback tracking — what the resolver originally picked vs what was actually used
    requestedProvider:  text('requested_provider'),
    requestedModel:     text('requested_model'),
    fallbackChain:      text('fallback_chain'),  // JSON as text for write performance. [{provider,model,error?} | {provider,model,success:true}]

    // Billing period (derived from created_at UTC at insert time — never app clock)
    billingMonth: text('billing_month').notNull(),  // 'YYYY-MM'
    billingDay:   text('billing_day').notNull(),    // 'YYYY-MM-DD'

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // Sandbox compute attribution — spec §12.2–§12.3. All nullable; CHECK constraint
    // (migration 0324) enforces required fields per source_type.
    // sandbox_execution_id: no hard FK to avoid coupling sandbox lifecycle to billing writes.
    sandboxExecutionId:     uuid('sandbox_execution_id'),
    // Vendor-reported vCPU-seconds (spec §12.3)
    sandboxVcpuSeconds:     numeric('sandbox_vcpu_seconds', { precision: 12, scale: 4 }),
    // Vendor-reported wall-clock duration in milliseconds
    sandboxWallClockMs:     integer('sandbox_wall_clock_ms'),
    // One of 'e2b' | 'local_docker' | 'inline' (spec §12.3)
    sandboxProvider:        text('sandbox_provider'),
    // Immutable digest / version of the sandbox template (spec §15)
    sandboxTemplateVersion: text('sandbox_template_version'),
    // Monotonically increasing per sandbox_execution_id for 'sandbox_compute_correction' rows.
    // Always NULL for 'sandbox_compute' and all non-sandbox rows.
    correctionSequence:     integer('correction_sequence'),

    // Operator Backend attribution (migration 0339) — spec §4.10, §3.12.
    // Populated for subscription_mediated and sandbox_compute rows written by
    // the operator backend cost-writer.
    operatorRunId:  uuid('operator_run_id').references(() => operatorRuns.id),
    // Cost-accounting boundary within a chain link (e.g. 'pre_fallback' /
    // 'post_fallback'). Part of the idempotency key for operator rows.
    boundary:       text('boundary'),

    // IEE Browser cost-row discriminator (migration 0348) — spec §8.6.
    // subtype non-null only when source_type = 'sandbox_compute'.
    // Values: 'task' (written by sandboxHarvestService) | 'warm_pool' (written by browserWarmPool.terminate).
    // FK warm_session_id → browser_warm_sessions(id) lands in migration 0350 (after 0349 creates the target).
    subtype:        text('subtype'),
    warmSessionId:  uuid('warm_session_id').references(() => browserWarmSessions.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    orgMonthIdx:          index('llm_requests_org_month_idx').on(table.organisationId, table.billingMonth),
    subaccountMonthIdx:   index('llm_requests_subaccount_month_idx').on(table.subaccountId, table.billingMonth),
    runIdx:               index('llm_requests_run_idx').on(table.runId),
    providerModelIdx:     index('llm_requests_provider_model_idx').on(table.provider, table.model, table.billingMonth),
    billingDayIdx:        index('llm_requests_billing_day_idx').on(table.billingDay),
    createdAtIdx:         index('llm_requests_created_at_idx').on(table.createdAt),
    executionIdIdx:       index('llm_requests_execution_id_idx').on(table.executionId),
    executionPhaseIdx:    index('llm_requests_execution_phase_idx').on(table.executionPhase, table.billingMonth),
    // §13.1 — partial index, only IEE rows pay the index cost
    ieeRunIdIdx:          index('llm_requests_iee_run_id_idx')
      .on(table.ieeRunId)
      .where(sql`${table.ieeRunId} IS NOT NULL`),
    // rev §6 — non-agent consumer attribution
    sourceIdIdx:          index('llm_requests_source_id_idx')
      .on(table.sourceId)
      .where(sql`${table.sourceId} IS NOT NULL`),
    featureTagMonthIdx:   index('llm_requests_feature_tag_month_idx').on(table.featureTag, table.billingMonth),
    // Skip the common case (99%+ success rows); speed up 'show me all 499s this week' queries
    statusIdx:            index('llm_requests_status_idx')
      .on(table.status)
      .where(sql`${table.status} <> 'success'`),
    // Cached context infrastructure — §5.9
    prefixHashIdx:        index('llm_requests_prefix_hash_idx')
      .on(table.prefixHash)
      .where(sql`${table.prefixHash} IS NOT NULL`),
    // Sandbox cost-row idempotency — spec §12.3, §24.1.
    // One row per sandbox execution (primary harvest write).
    sandboxExecutionIdUniqueIdx: uniqueIndex('llm_requests_sandbox_execution_id_unique_idx')
      .on(table.sandboxExecutionId)
      .where(sql`${table.sourceType} = 'sandbox_compute'`),
    // One row per (execution, correction_sequence) for correction rows — spec §24.1.
    sandboxCorrectionSequenceUniqueIdx: uniqueIndex('llm_requests_sandbox_correction_sequence_unique_idx')
      .on(table.sandboxExecutionId, table.correctionSequence)
      .where(sql`${table.sourceType} = 'sandbox_compute_correction'`),
    // Operator Backend — covering index for per-chain-link cost reads (migration 0339)
    operatorRunIdIdx: index('llm_requests_operator_run_id_idx')
      .on(table.operatorRunId)
      .where(sql`${table.operatorRunId} IS NOT NULL`),
    // Operator Backend — idempotency UNIQUE index (migration 0339)
    operatorRunSourceBoundaryUniqueIdx: uniqueIndex('llm_requests_operator_run_source_boundary_unique_idx')
      .on(table.operatorRunId, table.sourceType, table.boundary)
      .where(sql`${table.operatorRunId} IS NOT NULL AND ${table.boundary} IS NOT NULL`),
    // IEE Browser idle-cost-row idempotency — one cost row per warm session (migration 0350).
    // Re-runs of warm-session teardown hit 23505 and treat it as "already written" no-op.
    warmSessionIdUniqueIdx: uniqueIndex('llm_requests_warm_session_id_unique_idx')
      .on(table.warmSessionId)
      .where(sql`${table.subtype} = 'warm_pool'`),
  }),
);

export type LlmRequest = typeof llmRequests.$inferSelect;
export type NewLlmRequest = typeof llmRequests.$inferInsert;

// ---------------------------------------------------------------------------
// Valid task types — enforced at service layer via Zod
// ---------------------------------------------------------------------------
export const TASK_TYPES = [
  'qa_validation',
  'development',
  'memory_compile',
  'process_trigger',
  'search',
  'handoff',
  'scheduling',
  'review',
  'general',
  // Workspace-memory retrieval helper calls — HyDE query expansion and
  // post-retrieval context enrichment, both issued by workspaceMemoryService.
  'hyde_expansion',
  'context_enrichment',
  // Agent beliefs extraction — LLM call to extract/merge discrete facts after a run.
  'belief_extraction',
  // CRM Query Planner Stage 3 LLM calls (spec §10.1)
  'crm_query_planner',
  // Closed-Loop Skill Improvement spec §9.1 (migration 0371)
  'peer_review',
] as const;

export type TaskType = typeof TASK_TYPES[number];

// Valid source types:
//   'iee'                        — added rev 6 §13.1. When sourceType='iee', ieeRunId MUST be set.
//   'analyzer'                   — added rev §6. Non-agent consumer (skill analyzer); sourceId MUST be set.
//   'system'                     — generic non-attributed catch-all for platform work.
//   'sandbox_compute'            — spec §12.2. Sandbox execution cost row; sandboxExecutionId,
//                                  sandboxVcpuSeconds, sandboxWallClockMs, sandboxProvider,
//                                  sandboxTemplateVersion MUST be set (CHECK constraint, migration 0324).
//   'sandbox_compute_correction' — spec §12.2. Cost-correction append row (never update original);
//                                  sandboxExecutionId and correctionSequence MUST be set.
//   'failure_post_mortem'        — Closed-Loop Skill Improvement spec §9.1. RCA synthesis + peer review
//                                  calls. executionPhase MUST be NULL (CHECK constraint, migration 0371).
export const SOURCE_TYPES = ['agent_run', 'process_execution', 'system', 'iee', 'analyzer', 'sandbox_compute', 'sandbox_compute_correction', 'failure_post_mortem'] as const;
export type SourceType = typeof SOURCE_TYPES[number];

// Call sites — distinguishes LLM calls made on the main-app side from those
// made by the IEE worker process. Spec §11.7.1.
export const CALL_SITES = ['app', 'worker'] as const;
export type CallSite = typeof CALL_SITES[number];

// Valid LLM request statuses — rev §6 adds three values:
//   'client_disconnected' — mid-body network RST, initiator unknown
//   'parse_failure'       — schema-validation failure after all retries
//   'aborted_by_caller'   — AbortController.abort() fired from caller code
//
// Deferred-items brief §1 adds one provisional value:
//   'started'             — provisional row written BEFORE providerAdapter.call()
//                           so a retry after a successful provider call + failed
//                           DB insert sees the row and throws
//                           ReconciliationRequiredError instead of re-dispatching.
//                           Rows in this state are reaped by the
//                           maintenance:llm-started-row-sweep job after
//                           (providerTimeoutMs + 60s).
export const LLM_REQUEST_STATUSES = [
  'success',
  'partial',
  'error',
  'timeout',
  'budget_blocked',
  'rate_limited',
  'provider_unavailable',
  'provider_not_configured',
  'client_disconnected',
  'parse_failure',
  'aborted_by_caller',
  'started',
] as const;
export type LlmRequestStatus = typeof LLM_REQUEST_STATUSES[number];

/**
 * Statuses that represent a terminal, committed ledger row. A row with one
 * of these statuses is the authoritative record of a completed LLM call.
 * Used by the idempotency-check path to distinguish "work already done —
 * return cached" from "work in flight — reconciliation needed".
 */
export const LLM_REQUEST_TERMINAL_STATUSES = [
  'success',
  'partial',
  'error',
  'timeout',
  'budget_blocked',
  'rate_limited',
  'provider_unavailable',
  'provider_not_configured',
  'client_disconnected',
  'parse_failure',
  'aborted_by_caller',
] as const;
export type LlmRequestTerminalStatus = typeof LLM_REQUEST_TERMINAL_STATUSES[number];

// Abort reasons — only meaningful when status='aborted_by_caller'.
export const ABORT_REASONS = ['caller_timeout', 'caller_cancel'] as const;
export type AbortReason = typeof ABORT_REASONS[number];

// Execution phases for routing — 'iee_loop_step' added rev 6 §1.4 / §5.5.
// Used by the IEE worker so the router can apply an IEE-specific model policy.
export const EXECUTION_PHASES = ['planning', 'execution', 'synthesis', 'iee_loop_step'] as const;
export type ExecutionPhase = typeof EXECUTION_PHASES[number];

// Capability tiers
export const CAPABILITY_TIERS = ['frontier', 'economy'] as const;
export type CapabilityTier = typeof CAPABILITY_TIERS[number];

// Routing modes
export const ROUTING_MODES = ['ceiling', 'forced'] as const;
export type RoutingMode = typeof ROUTING_MODES[number];

// Routing reasons (resolver decisions only — escalation tracked separately)
export const ROUTING_REASONS = ['forced', 'ceiling', 'economy', 'fallback'] as const;
export type RoutingReason = typeof ROUTING_REASONS[number];
