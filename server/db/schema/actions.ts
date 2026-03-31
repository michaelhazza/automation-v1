import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agents } from './agents';
import { agentRuns } from './agentRuns';
import { users } from './users';

// ---------------------------------------------------------------------------
// Actions — proposed or executable units of work with gate enforcement
// ---------------------------------------------------------------------------

export const actions = pgTable(
  'actions',
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
    agentRunId: uuid('agent_run_id')
      .references(() => agentRuns.id),
    parentActionId: uuid('parent_action_id'),

    // Action definition
    actionType: text('action_type').notNull(),
    actionCategory: text('action_category').notNull().$type<'api' | 'worker' | 'browser' | 'devops'>(),
    isExternal: boolean('is_external').notNull().default(false),
    gateLevel: text('gate_level').notNull().$type<'auto' | 'review' | 'block'>(),

    // State
    status: text('status').notNull().default('proposed').$type<
      'proposed' | 'pending_approval' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'blocked' | 'skipped'
    >(),
    payloadVersion: integer('payload_version').notNull().default(1),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    metadataJson: jsonb('metadata_json'),

    // Results
    resultJson: jsonb('result_json'),
    resultStatus: text('result_status').$type<'success' | 'partial' | 'failed'>(),
    errorJson: jsonb('error_json'),

    // Approval
    approvedBy: uuid('approved_by')
      .references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('actions_org_idx').on(table.organisationId),
    subaccountStatusIdx: index('actions_subaccount_status_idx').on(table.subaccountId, table.status),
    agentRunIdx: index('actions_agent_run_idx').on(table.agentRunId),
    agentIdx: index('actions_agent_id_idx').on(table.agentId),
    parentActionIdx: index('actions_parent_action_idx').on(table.parentActionId),
    idempotencyIdx: unique('actions_idempotency_idx').on(table.subaccountId, table.idempotencyKey),
  })
);

export type Action = typeof actions.$inferSelect;
export type NewAction = typeof actions.$inferInsert;
