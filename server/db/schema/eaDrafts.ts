import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { users } from './users';
import { agents } from './agents';
import { agentRuns } from './agentRuns';
import { actions } from './actions';
import type { EADraftKind, EADraftSendState } from '../../../shared/types/eaDraft.js';

export const eaDrafts = pgTable(
  'ea_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'cascade' }),
    subaccountId: uuid('subaccount_id').notNull().references(() => subaccounts.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
    runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),
    proposalActionId: uuid('proposal_action_id').notNull().references(() => actions.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull().$type<EADraftKind>(),
    targetRef: jsonb('target_ref').notNull().$type<Record<string, unknown>>(),
    body: jsonb('body').notNull().$type<Record<string, unknown>>(),
    sendState: text('send_state').notNull().default('idle').$type<EADraftSendState>(),
    externalResultId: text('external_result_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerSendStateIdx: index('ea_drafts_owner_send_state_idx').on(table.organisationId, table.ownerUserId, table.sendState),
    // UNIQUE on proposal_action_id (REVIEW-F2 from ChatGPT PR #296 round 2).
    // Each proposal action owns exactly one EA draft. If the upstream
    // idempotency key in `createDraftWithProposal` ever collides again, this
    // constraint turns the silent "stuck idle" failure mode into a loud DB
    // unique-violation error at the insert site — fail-loud is better than
    // fail-silent for invariants that callers depend on. Replaces the
    // pre-2026-05-13 non-unique `ea_drafts_proposal_action_idx`.
    proposalActionUnique: uniqueIndex('ea_drafts_proposal_action_unique').on(table.proposalActionId),
    agentIdx: index('ea_drafts_agent_idx').on(table.agentId),
    runIdx: index('ea_drafts_run_idx').on(table.runId),
  })
);

export type EADraftRow = typeof eaDrafts.$inferSelect;
export type InsertEADraftRow = typeof eaDrafts.$inferInsert;
