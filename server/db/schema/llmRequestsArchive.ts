import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// llm_requests_archive — retention archive for llm_requests (spec §12)
//
// Same shape as llm_requests at migration time, lighter indexing:
//   - idempotency_key UNIQUE for proof-of-billing lookups
//   - provider_request_id (partial) for Anthropic support tickets
//   - (organisation_id, billing_month) for per-org audit windows
//
// No referential integrity — archive rows must survive deletion of the
// originating run / job (financial audit requirement).
//
// Populated by the nightly llm-ledger-archive pg-boss job (see
// server/jobs/llmLedgerArchiveJob.ts).
// ---------------------------------------------------------------------------

export const llmRequestsArchive = pgTable(
  'llm_requests_archive',
  {
    id:                    uuid('id').primaryKey(),
    idempotencyKey:        text('idempotency_key').unique().notNull(),

    organisationId:        uuid('organisation_id').notNull(),
    subaccountId:          uuid('subaccount_id'),
    userId:                uuid('user_id'),
    sourceType:            text('source_type').notNull(),
    runId:                 uuid('run_id'),
    executionId:           uuid('execution_id'),
    ieeRunId:              uuid('iee_run_id'),
    sourceId:              uuid('source_id'),
    featureTag:            text('feature_tag').notNull().default('unknown'),
    callSite:              text('call_site').notNull().default('app').$type<'app' | 'worker'>(),
    agentName:             text('agent_name'),
    taskType:              text('task_type').notNull().default('general'),

    provider:              text('provider').notNull().default('anthropic'),
    model:                 text('model').notNull(),
    providerRequestId:     text('provider_request_id'),

    tokensIn:              integer('tokens_in').notNull().default(0),
    tokensOut:             integer('tokens_out').notNull().default(0),
    providerTokensIn:      integer('provider_tokens_in'),
    providerTokensOut:     integer('provider_tokens_out'),

    costRaw:               numeric('cost_raw', { precision: 12, scale: 8 }).notNull().default('0'),
    costWithMargin:        numeric('cost_with_margin', { precision: 12, scale: 8 }).notNull().default('0'),
    costWithMarginCents:   integer('cost_with_margin_cents').notNull().default(0),
    marginMultiplier:      numeric('margin_multiplier', { precision: 6, scale: 4 }).notNull().default('1.30'),
    fixedFeeCents:         integer('fixed_fee_cents').notNull().default(0),

    requestPayloadHash:    text('request_payload_hash'),
    responsePayloadHash:   text('response_payload_hash'),

    providerLatencyMs:     integer('provider_latency_ms'),
    routerOverheadMs:      integer('router_overhead_ms'),

    status:                text('status').notNull().default('success'),
    errorMessage:          text('error_message'),
    attemptNumber:         integer('attempt_number').notNull().default(1),
    parseFailureRawExcerpt: text('parse_failure_raw_excerpt'),
    abortReason:           text('abort_reason'),

    cachedPromptTokens:    integer('cached_prompt_tokens').notNull().default(0),

    executionPhase:        text('execution_phase'),
    capabilityTier:        text('capability_tier').notNull().default('frontier'),
    wasDowngraded:         boolean('was_downgraded').notNull().default(false),
    routingReason:         text('routing_reason'),

    wasEscalated:          boolean('was_escalated').notNull().default(false),
    escalationReason:      text('escalation_reason'),

    requestedProvider:     text('requested_provider'),
    requestedModel:        text('requested_model'),
    fallbackChain:         text('fallback_chain'),

    billingMonth:          text('billing_month').notNull(),
    billingDay:            text('billing_day').notNull(),

    createdAt:             timestamp('created_at', { withTimezone: true }).notNull(),
    archivedAt:            timestamp('archived_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerRequestIdIdx: index('llm_requests_archive_provider_request_id_idx')
      .on(table.providerRequestId)
      .where(sql`${table.providerRequestId} IS NOT NULL`),
    orgMonthIdx: index('llm_requests_archive_org_month_idx').on(table.organisationId, table.billingMonth),
  }),
);

export type LlmRequestArchive = typeof llmRequestsArchive.$inferSelect;
export type NewLlmRequestArchive = typeof llmRequestsArchive.$inferInsert;
