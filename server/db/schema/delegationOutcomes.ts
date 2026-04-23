// Delegation Outcomes — per-run delegation decision log.
// Spec: tasks/builds/paperclip-hierarchy/plan.md §5.4.
// Types imported from shared/types/delegation.ts (TypeScript-first contract).

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import type { DelegationScope, DelegationDirection } from '../../../shared/types/delegation.js';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';
import { agentRuns } from './agentRuns.js';
import { subaccountAgents } from './subaccountAgents.js';

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const delegationOutcomes = pgTable(
  'delegation_outcomes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId: uuid('subaccount_id')
      .notNull()
      .references(() => subaccounts.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    callerAgentId: uuid('caller_agent_id')
      .notNull()
      .references(() => subaccountAgents.id, { onDelete: 'cascade' }),
    targetAgentId: uuid('target_agent_id')
      .notNull()
      .references(() => subaccountAgents.id, { onDelete: 'cascade' }),
    delegationScope: text('delegation_scope').notNull().$type<DelegationScope>(),
    outcome: text('outcome').notNull().$type<'accepted' | 'rejected'>(),
    /** Required when outcome = 'rejected', null when outcome = 'accepted'. */
    reason: text('reason'),
    delegationDirection: text('delegation_direction').notNull().$type<DelegationDirection>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index('delegation_outcomes_org_created_idx').on(
      table.organisationId,
      table.createdAt,
    ),
    callerCreatedIdx: index('delegation_outcomes_caller_created_idx').on(
      table.callerAgentId,
      table.createdAt,
    ),
    runIdx: index('delegation_outcomes_run_idx').on(table.runId),
  })
);

export type DelegationOutcomeRow = typeof delegationOutcomes.$inferSelect;
export type NewDelegationOutcomeRow = typeof delegationOutcomes.$inferInsert;
