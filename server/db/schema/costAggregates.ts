import { pgTable, uuid, text, integer, numeric, timestamp, index, unique } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// cost_aggregates — pre-aggregated totals for fast dashboard queries
//
// Updated asynchronously after each LLM request via pg-boss job.
// Always eventually consistent (within seconds).
// Never query llm_requests directly for dashboards — use this table.
// ---------------------------------------------------------------------------

export const costAggregates = pgTable(
  'cost_aggregates',
  {
    id:                      uuid('id').defaultRandom().primaryKey(),
    entityType:              text('entity_type').notNull(),
    // 'organisation' | 'subaccount' | 'run' | 'agent' | 'task_type' | 'provider' |
    // 'platform' | 'execution_phase' | 'source_type' | 'feature_tag'
    // (source_type + feature_tag added rev §6 — LLM observability spec §6.2.)
    entityId:                text('entity_id').notNull(),
    periodType:              text('period_type').notNull(),
    // 'daily' | 'monthly' | 'run' | 'minute' | 'hour'
    periodKey:               text('period_key').notNull(),
    // 'YYYY-MM-DD' | 'YYYY-MM' | run_id | 'YYYY-MM-DDTHH:mm' | 'YYYY-MM-DDTHH'

    totalCostRaw:            numeric('total_cost_raw', { precision: 12, scale: 8 }).notNull().default('0'),
    totalCostWithMargin:     numeric('total_cost_with_margin', { precision: 12, scale: 8 }).notNull().default('0'),
    totalCostCents:          integer('total_cost_cents').notNull().default(0),
    totalTokensIn:           integer('total_tokens_in').notNull().default(0),
    totalTokensOut:          integer('total_tokens_out').notNull().default(0),
    requestCount:            integer('request_count').notNull().default(0),
    errorCount:              integer('error_count').notNull().default(0),

    // Project-level cost attribution
    projectId:               uuid('project_id'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    entityUniq:  unique('cost_aggregates_entity_uniq').on(table.entityType, table.entityId, table.periodType, table.periodKey),
    entityIdx:   index('cost_aggregates_entity_idx').on(table.entityType, table.entityId, table.periodType),
  }),
);

export type CostAggregate = typeof costAggregates.$inferSelect;
