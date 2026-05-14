import { pgTable, uuid, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';

/**
 * onboarding_bundle_configs — per-org override of the onboarding Workflow bundle.
 *
 * One row per organisation. `workflowSlugs` is the ordered list of Workflows
 * autostarted during subaccount onboarding. Defaults to the platform-wide
 * DEFAULT_ONBOARDING_BUNDLE ([intelligence-briefing, weekly-digest]).
 *
 * Spec: docs/memory-and-briefings-spec.md §8.7 (S5)
 */
export const onboardingBundleConfigs = pgTable(
  'onboarding_bundle_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    workflowSlugs: jsonb('workflow_slugs')
      .notNull()
      .default(['intelligence-briefing', 'weekly-digest'])
      .$type<string[]>(),
    ordering: jsonb('ordering').notNull().default({}).$type<Record<string, number>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id'),
  },
  (table) => ({
    orgUniq: unique('onboarding_bundle_configs_org_uq').on(table.organisationId),
    orgIdx: index('onboarding_bundle_configs_org_idx').on(table.organisationId),
  }),
);

export type OnboardingBundleConfig = typeof onboardingBundleConfigs.$inferSelect;
export type NewOnboardingBundleConfig = typeof onboardingBundleConfigs.$inferInsert;
