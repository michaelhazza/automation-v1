import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// Renamed from org_budgets in migration 0270_compute_budget_rename.sql.
export const orgComputeBudgets = pgTable('org_compute_budgets', {
  id:                         uuid('id').defaultRandom().primaryKey(),
  organisationId:             uuid('organisation_id').notNull().unique().references(() => organisations.id),
  monthlyComputeLimitCents:   integer('monthly_compute_limit_cents'),
  alertThresholdPct:          integer('alert_threshold_pct').notNull().default(80),
  createdAt:                  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:                  timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OrgComputeBudget = typeof orgComputeBudgets.$inferSelect;
