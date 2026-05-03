import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

// ---------------------------------------------------------------------------
// spending_budgets — accounting container for agentic commerce spend
//
// One per agent (primary), or per sub-account (at most one per currency),
// or org-level for cross-sub-account agents. Cardinality enforced by partial
// unique indexes. Limits, mode, allowlist, and thresholds live on the
// associated spending_policies row — NOT here.
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export const spendingBudgets = pgTable(
  'spending_budgets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .references(() => agents.id),
    currency: text('currency').notNull(),
    name: text('name').notNull(),
    // Kill Switch: per-budget revocation timestamp. NULL = active.
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    // Alert fires when net monthly spend exceeds this minor-unit value.
    monthlySpendAlertThresholdMinor: integer('monthly_spend_alert_threshold_minor'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('spending_budgets_org_idx').on(table.organisationId),
    subaccountIdx: index('spending_budgets_subaccount_idx')
      .on(table.subaccountId)
      .where(sql`${table.subaccountId} IS NOT NULL`),
    agentIdx: index('spending_budgets_agent_idx')
      .on(table.agentId)
      .where(sql`${table.agentId} IS NOT NULL`),
    // At most one active budget per (subaccount, currency) pair.
    subaccountCurrencyUniq: uniqueIndex('spending_budgets_subaccount_currency_uniq')
      .on(table.subaccountId, table.currency)
      .where(sql`${table.subaccountId} IS NOT NULL AND ${table.agentId} IS NULL`),
    // At most one active budget per agent.
    agentUniq: uniqueIndex('spending_budgets_agent_uniq')
      .on(table.agentId)
      .where(sql`${table.agentId} IS NOT NULL`),
  }),
);

export type SpendingBudget = typeof spendingBudgets.$inferSelect;
export type NewSpendingBudget = typeof spendingBudgets.$inferInsert;
