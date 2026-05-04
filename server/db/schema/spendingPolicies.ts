import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { spendingBudgets } from './spendingBudgets';

// ---------------------------------------------------------------------------
// spending_policies — rules object inside a spending budget
//
// One-to-one with spending_budgets. Sole owner of limits, mode, allowlist,
// approval threshold, and policy version. Never accessed by skills directly —
// only via the Charge Router.
// Spec: tasks/builds/agentic-commerce/spec.md §5.1
// Migration: 0271_agentic_commerce_schema.sql
// ---------------------------------------------------------------------------

export interface MerchantAllowlistEntry {
  id: string | null;
  descriptor: string;
  source: 'stripe_id' | 'descriptor';
}

export const spendingPolicies = pgTable(
  'spending_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    spendingBudgetId: uuid('spending_budget_id')
      .notNull()
      .references(() => spendingBudgets.id),
    // 'shadow' or 'live'. Stored as text; closed at DB layer by CHECK in migration.
    mode: text('mode').notNull().$type<'shadow' | 'live'>(),
    // Per-transaction cap on amount_minor. 0 = unset (no cap).
    perTxnLimitMinor: integer('per_txn_limit_minor').notNull().default(0),
    // Cap on net daily spend. 0 = unset.
    dailyLimitMinor: integer('daily_limit_minor').notNull().default(0),
    // Cap on net monthly spend. 0 = unset.
    monthlyLimitMinor: integer('monthly_limit_minor').notNull().default(0),
    // Charges > threshold route to HITL. 0 = every positive charge routes to HITL.
    approvalThresholdMinor: integer('approval_threshold_minor').notNull().default(0),
    // Array of { id, descriptor, source } entries per spec §8.5.
    merchantAllowlist: jsonb('merchant_allowlist').notNull().default([]).$type<MerchantAllowlistEntry[]>(),
    // Default approval window in hours. Default 24.
    approvalExpiresHours: integer('approval_expires_hours').notNull().default(24),
    // Incremented on every update; used for policy_changed revalidation.
    version: integer('version').notNull().default(1),
    // Reserved for future rate-limit config; schema must not preclude it.
    velocityConfig: jsonb('velocity_config').$type<Record<string, unknown>>(),
    // Reserved for future confidence-gating.
    confidenceGateConfig: jsonb('confidence_gate_config').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('spending_policies_org_idx').on(table.organisationId),
    budgetIdx: index('spending_policies_budget_idx').on(table.spendingBudgetId),
  }),
);

export type SpendingPolicy = typeof spendingPolicies.$inferSelect;
export type NewSpendingPolicy = typeof spendingPolicies.$inferInsert;
