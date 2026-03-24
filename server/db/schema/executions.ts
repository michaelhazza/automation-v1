import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { processes } from './processes';
import { users } from './users';
import { subaccounts } from './subaccounts';

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    processId: uuid('process_id')
      .notNull()
      .references(() => processes.id),
    triggeredByUserId: uuid('triggered_by_user_id')
      .notNull()
      .references(() => users.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'>(),
    inputData: jsonb('input_data'),
    outputData: jsonb('output_data'),
    errorMessage: text('error_message'),
    errorDetail: jsonb('error_detail'),
    engineType: text('engine_type').notNull(),
    processSnapshot: jsonb('process_snapshot'),
    isTestExecution: boolean('is_test_execution').notNull().default(false),
    retryCount: integer('retry_count').notNull().default(0),
    // Webhook / queue tracking fields
    returnWebhookUrl: text('return_webhook_url'),      // the URL we told the engine to POST results back to
    outboundPayload: jsonb('outbound_payload'),         // full payload we sent to the engine (for audit)
    callbackReceivedAt: timestamp('callback_received_at'), // when the engine called us back
    callbackPayload: jsonb('callback_payload'),         // raw payload the engine sent back
    notifyOnComplete: boolean('notify_on_complete').notNull().default(false), // user opted in to email on completion
    queuedAt: timestamp('queued_at'),                  // when the job was placed on the queue
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgStatusIdx: index('executions_org_status_idx').on(table.organisationId, table.status),
    orgProcessIdx: index('executions_org_process_idx').on(table.organisationId, table.processId),
    orgUserIdx: index('executions_org_user_idx').on(table.organisationId, table.triggeredByUserId),
    orgCreatedAtIdx: index('executions_org_created_at_idx').on(table.organisationId, table.createdAt),
    userProcessCreatedAtIdx: index('executions_user_process_created_at_idx').on(table.triggeredByUserId, table.processId, table.createdAt),
    orgIdIdx: index('executions_org_id_idx').on(table.organisationId),
    processIdx: index('executions_process_idx').on(table.processId),
    userIdx: index('executions_user_idx').on(table.triggeredByUserId),
    subaccountIdx: index('executions_subaccount_idx').on(table.subaccountId),
    statusIdx: index('executions_status_idx').on(table.status),
  })
);

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
