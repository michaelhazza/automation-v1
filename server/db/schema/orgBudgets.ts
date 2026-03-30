import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

export const orgBudgets = pgTable('org_budgets', {
  id:                      uuid('id').defaultRandom().primaryKey(),
  organisationId:          uuid('organisation_id').notNull().unique().references(() => organisations.id),
  monthlyCostLimitCents:   integer('monthly_cost_limit_cents'),
  alertThresholdPct:       integer('alert_threshold_pct').notNull().default(80),
  createdAt:               timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:               timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OrgBudget = typeof orgBudgets.$inferSelect;
