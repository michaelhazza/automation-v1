import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { automations } from './automations';
import { users } from './users';
import { subaccounts } from './subaccounts';
import { automationEngines } from './automationEngines';

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    processId: uuid('process_id')
      .notNull()
      .references(() => automations.id),
    triggeredByUserId: uuid('triggered_by_user_id')
      .references(() => users.id),
    subaccountId: uuid('subaccount_id')
      .references(() => subaccounts.id),
    status: text('status').notNull().default('pending').$type<'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'>(),
    inputData: jsonb('input_data'),
    outputData: jsonb('output_data'),
    errorMessage: text('error_message'),
    errorDetail: jsonb('error_detail'),
    engineType: text('engine_type').notNull(),
    // processSnapshot, outboundPayload, callbackPayload moved to execution_payloads (H-5 blob extraction)
    isTestExecution: boolean('is_test_execution').notNull().default(false),
    retryCount: integer('retry_count').notNull().default(0),
    // Webhook / queue tracking fields
    returnWebhookUrl: text('return_webhook_url'),      // the URL we told the engine to POST results back to
    callbackReceivedAt: timestamp('callback_received_at', { withTimezone: true }), // when the engine called us back
    notifyOnComplete: boolean('notify_on_complete').notNull().default(false), // user opted in to email on completion
    queuedAt: timestamp('queued_at', { withTimezone: true }),                  // when the job was placed on the queue
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    // Three-level framework additions
    resolvedConnections: jsonb('resolved_connections'), // Snapshot of connection mapping used (no tokens)
    resolvedConfig: jsonb('resolved_config'),           // Merged config (process default + subaccount overrides)
    engineId: uuid('engine_id')
      .references(() => automationEngines.id),           // Which engine actually ran this
    triggerType: text('trigger_type').notNull().default('manual').$type<'manual' | 'agent' | 'scheduled' | 'webhook'>(),
    triggerSourceId: uuid('trigger_source_id'),         // ID of agent run, scheduled task run, etc.
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
    triggerTypeIdx: index('executions_trigger_type_idx').on(table.triggerType),
    engineIdx: index('executions_engine_idx').on(table.engineId),
  })
);

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;
