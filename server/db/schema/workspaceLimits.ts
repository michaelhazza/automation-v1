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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    subaccountUnique: unique('workspace_limits_subaccount_unique').on(table.subaccountId),
  })
);

export type WorkspaceLimit = typeof workspaceLimits.$inferSelect;
export type NewWorkspaceLimit = typeof workspaceLimits.$inferInsert;
