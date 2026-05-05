import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { spendingBudgets } from './spendingBudgets';

// ---------------------------------------------------------------------------
// spending_budget_approvers — explicit per-user approver grants
//
// Beyond the role-based default (spend_approver permission). Grants a specific
// user the ability to approve charges for a given spending budget.
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export const spendingBudgetApprovers = pgTable(
  'spending_budget_approvers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    spendingBudgetId: uuid('spending_budget_id')
      .notNull()
      .references(() => spendingBudgets.id),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('spending_budget_approvers_org_idx').on(table.organisationId),
    budgetIdx: index('spending_budget_approvers_budget_idx').on(table.spendingBudgetId),
    // One explicit approver grant per (budget, user) pair.
    budgetUserUniq: uniqueIndex('spending_budget_approvers_budget_user_uniq')
      .on(table.spendingBudgetId, table.userId),
  }),
);

export type SpendingBudgetApprover = typeof spendingBudgetApprovers.$inferSelect;
export type NewSpendingBudgetApprover = typeof spendingBudgetApprovers.$inferInsert;
