import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { agentRuns } from './agentRuns';
import { executions } from './executions';

// ---------------------------------------------------------------------------
// llm_requests — append-only financial ledger
// Every single LLM call produces exactly one row. Never update, never delete.
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
    sourceType:     text('source_type').notNull().default('agent_run'),
    // 'agent_run' | 'process_execution' | 'system'
    runId:          uuid('run_id').references(() => agentRuns.id),
    executionId:    uuid('execution_id').references(() => executions.id),
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
    // 'success' | 'partial' | 'error' | 'timeout' | 'budget_blocked' | 'rate_limited' | 'provider_unavailable' | 'provider_not_configured'
    errorMessage:  text('error_message'),
    attemptNumber: integer('attempt_number').notNull().default(1),

    // Caching
    cachedPromptTokens: integer('cached_prompt_tokens').notNull().default(0),

    // Routing metadata
    executionPhase:   text('execution_phase').notNull().default('planning'),
    // 'planning' | 'execution' | 'synthesis'
    capabilityTier:   text('capability_tier').notNull().default('frontier'),
    // 'frontier' | 'economy'
    wasDowngraded:    boolean('was_downgraded').notNull().default(false),
    routingReason:    text('routing_reason'),
    // 'forced' | 'ceiling' | 'economy' | 'fallback'

    // Escalation tracking
    wasEscalated:     boolean('was_escalated').notNull().default(false),
    escalationReason: text('escalation_reason'),

    // Billing period (derived from created_at UTC at insert time — never app clock)
    billingMonth: text('billing_month').notNull(),  // 'YYYY-MM'
    billingDay:   text('billing_day').notNull(),    // 'YYYY-MM-DD'

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
] as const;

export type TaskType = typeof TASK_TYPES[number];

// Valid source types
export const SOURCE_TYPES = ['agent_run', 'process_execution', 'system'] as const;
export type SourceType = typeof SOURCE_TYPES[number];

// Valid LLM request statuses
export const LLM_REQUEST_STATUSES = [
  'success',
  'partial',
  'error',
  'timeout',
  'budget_blocked',
  'rate_limited',
  'provider_unavailable',
  'provider_not_configured',
] as const;
export type LlmRequestStatus = typeof LLM_REQUEST_STATUSES[number];

// Execution phases for routing
export const EXECUTION_PHASES = ['planning', 'execution', 'synthesis'] as const;
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
