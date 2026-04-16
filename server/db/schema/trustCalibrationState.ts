import { pgTable, uuid, text, integer, real, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';

/**
 * trust_calibration_state — S7 trust-builds-over-time counter per
 * (subaccount, agent, domain). After N consecutive retrospectively-validated
 * auto-applies without override, the auto-threshold is lowered by 0.05
 * (floor 0.70). Overrides reset `consecutiveValidated` to 0.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 */
export const trustCalibrationState = pgTable(
  'trust_calibration_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    /** Optional domain scope — null = org/subaccount-wide. */
    domain: text('domain'),
    /** Count of consecutive validated auto-applies; resets on override. */
    consecutiveValidated: integer('consecutive_validated').notNull().default(0),
    /** Current auto-threshold (0.70 floor, 0.85 default). */
    autoThreshold: real('auto_threshold').notNull().default(0.85),
    /** Window start for the 30-day validation window. */
    windowStartAt: timestamp('window_start_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('trust_calibration_state_org_idx').on(table.organisationId),
    uniqSubAgentDomain: unique('trust_calibration_state_subaccount_agent_domain_uq').on(
      table.subaccountId,
      table.agentId,
      table.domain,
    ),
  }),
);

export type TrustCalibrationState = typeof trustCalibrationState.$inferSelect;
export type NewTrustCalibrationState = typeof trustCalibrationState.$inferInsert;
