import { pgTable, uuid, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { subaccounts } from './subaccounts';

// ---------------------------------------------------------------------------
// Workspace Limits — daily token/cost caps per subaccount
// ---------------------------------------------------------------------------

export const workspaceLimits = pgTable(
  'workspace_limits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    dailyTokenLimit: integer('daily_token_limit'),
    dailyCostLimitCents: integer('daily_cost_limit_cents'),
    perRunTokenLimit: integer('per_run_token_limit'),
    alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
    monthlyCostLimitCents: integer('monthly_cost_limit_cents'),
    maxCostPerRunCents: integer('max_cost_per_run_cents'),
    maxTokensPerRequest: integer('max_tokens_per_request'),
    maxRequestsPerMinute: integer('max_requests_per_minute'),
    maxRequestsPerHour: integer('max_requests_per_hour'),
    maxLlmCallsPerRun: integer('max_llm_calls_per_run'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    subaccountUnique: unique('workspace_limits_subaccount_unique').on(table.subaccountId),
  })
);

export type WorkspaceLimit = typeof workspaceLimits.$inferSelect;
export type NewWorkspaceLimit = typeof workspaceLimits.$inferInsert;
