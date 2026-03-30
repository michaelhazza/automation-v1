import { pgTable, uuid, text, numeric, timestamp, unique } from 'drizzle-orm/pg-core';

export const llmPricing = pgTable(
  'llm_pricing',
  {
    id:            uuid('id').defaultRandom().primaryKey(),
    provider:      text('provider').notNull(),
    model:         text('model').notNull(),
    inputRate:     numeric('input_rate', { precision: 12, scale: 8 }).notNull(),
    outputRate:    numeric('output_rate', { precision: 12, scale: 8 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo:   timestamp('effective_to', { withTimezone: true }),
    createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerModelDateUniq: unique('llm_pricing_provider_model_date_uniq').on(
      table.provider, table.model, table.effectiveFrom,
    ),
  }),
);

export type LlmPricing = typeof llmPricing.$inferSelect;
