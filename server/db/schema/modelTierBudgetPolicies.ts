import { pgTable, uuid, text, integer, numeric, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

// ---------------------------------------------------------------------------
// Model Tier Budget Policies — per-model-family execution budget policies
// organisation_id IS NULL = platform default
// Non-null organisation_id = per-org override
// ---------------------------------------------------------------------------

export const modelTierBudgetPolicies = pgTable(
  'model_tier_budget_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').references(() => organisations.id),

    modelFamily: text('model_family').notNull(),
    modelContextWindow: integer('model_context_window').notNull(),

    maxInputTokens: integer('max_input_tokens').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    reserveOutputTokens: integer('reserve_output_tokens').notNull(),
    maxTotalCostUsdCents: integer('max_total_cost_usd_cents').notNull(),
    perDocumentMaxTokens: integer('per_document_max_tokens').notNull(),

    softWarnRatio: numeric('soft_warn_ratio', { precision: 4, scale: 3 }).notNull().default('0.700'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgModelUniq: uniqueIndex('model_tier_budget_policies_org_model_uq')
      .on(t.organisationId, t.modelFamily),
    modelIdx: index('model_tier_budget_policies_model_idx').on(t.modelFamily),
  })
);

export type ModelTierBudgetPolicy = typeof modelTierBudgetPolicies.$inferSelect;
export type NewModelTierBudgetPolicy = typeof modelTierBudgetPolicies.$inferInsert;
