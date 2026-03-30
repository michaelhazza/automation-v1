import { pgTable, uuid, text, numeric, integer, timestamp } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

export const orgMarginConfigs = pgTable('org_margin_configs', {
  id:               uuid('id').defaultRandom().primaryKey(),
  organisationId:   uuid('organisation_id').references(() => organisations.id),
  marginMultiplier: numeric('margin_multiplier', { precision: 6, scale: 4 }).notNull().default('1.30'),
  fixedFeeCents:    integer('fixed_fee_cents').notNull().default(0),
  notes:            text('notes'),
  effectiveFrom:    timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OrgMarginConfig = typeof orgMarginConfigs.$inferSelect;
