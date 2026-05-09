import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';

export const actionAttempts = pgTable(
  'action_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    idempotencyKey: text('idempotency_key').notNull(),
    actionType: text('action_type').notNull(),
    attemptStatus: text('attempt_status').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull(),
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    providerResponseId: text('provider_response_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorIdempotencyUnique: uniqueIndex('action_attempts_connector_idempotency_unique').on(table.connectorConfigId, table.idempotencyKey),
    orgStatusAttemptedIdx: index('action_attempts_org_status_attempted_idx').on(table.organisationId, table.attemptStatus, table.attemptedAt),
    actionTypeCheck: check('action_attempts_action_type_check', sql`${table.actionType} IN ('reply','internal_note','status_change','assignment_change','tag_change')`),
    attemptStatusCheck: check('action_attempts_attempt_status_check', sql`${table.attemptStatus} IN ('in_flight','succeeded','failed')`),
  }),
);

export type ActionAttempt = typeof actionAttempts.$inferSelect;
export type NewActionAttempt = typeof actionAttempts.$inferInsert;
