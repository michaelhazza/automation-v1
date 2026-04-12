import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    moduleIds: jsonb('module_ids').notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
    priceMonthlyCents: integer('price_monthly_cents'),
    priceYearlyCents: integer('price_yearly_cents'),
    yearlyDiscountPercent: integer('yearly_discount_percent').notNull().default(20),
    currency: text('currency').notNull().default('USD'),
    subaccountLimit: integer('subaccount_limit'),
    trialDays: integer('trial_days').notNull().default(14),
    status: text('status').notNull().default('draft').$type<'active' | 'draft' | 'archived'>(),
    stripeProductId: text('stripe_product_id'),
    stripePriceIdMonthly: text('stripe_price_id_monthly'),
    stripePriceIdYearly: text('stripe_price_id_yearly'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex('subscriptions_slug_unique_idx')
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    statusIdx: index('subscriptions_status_idx').on(table.status),
  })
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
