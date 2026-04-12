import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { subscriptions } from './subscriptions.js';

// NOTE: This table intentionally has NO deletedAt column. Lifecycle is managed
// entirely via the `status` column (trialing → active → cancelled/paused).
// The partial unique index on organisationId WHERE status IN (trialing, active, past_due)
// ensures one active subscription per org without needing a soft-delete mechanism.
export const orgSubscriptions = pgTable(
  'org_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    billingCycle: text('billing_cycle').notNull().default('monthly').$type<'monthly' | 'yearly' | 'comp'>(),
    status: text('status').notNull().default('trialing').$type<'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused'>(),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    stripeSubscriptionId: text('stripe_subscription_id'),
    isComped: boolean('is_comped').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgActiveUniqueIdx: uniqueIndex('org_subscriptions_org_active_unique_idx')
      .on(table.organisationId)
      .where(sql`${table.status} IN ('trialing', 'active', 'past_due')`),
    orgIdx: index('org_subscriptions_org_id_idx').on(table.organisationId),
  })
);

export type OrgSubscription = typeof orgSubscriptions.$inferSelect;
export type NewOrgSubscription = typeof orgSubscriptions.$inferInsert;
