import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';
import { subaccounts } from './subaccounts.js';
import { integrationConnections } from './integrationConnections.js';
import type { SupportInboxAgentConfig } from '../../../shared/types/supportInboxAgentConfig.js';

export const canonicalInboxes = pgTable(
  'canonical_inboxes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    emailAddress: text('email_address'),
    isActive: boolean('is_active').notNull().default(true),
    agentConfig: jsonb('agent_config')
      .$type<SupportInboxAgentConfig>()
      .default({
        version: 1,
        mode: 'disabled',
        collisionWindow: { minMinutesSinceHumanActivity: 30, respectHumanAssignee: true },
        draftExpiry: { awaitingReviewHours: 72, draftHours: 24 },
        optIns: { autonomousReplyOnWaitingOnCustomer: false, postResolutionFollowUp: false },
        minConfidence: 0.8,
        voiceProfile: 'neutral',
        escalationCategories: [],
      })
      .notNull(),
    externalMetadata: jsonb('external_metadata').$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    sourceConnectionId: uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorExternalUnique: uniqueIndex('canonical_inboxes_connector_external_unique').on(table.connectorConfigId, table.externalId),
    orgActiveIdx: index('canonical_inboxes_org_active_idx').on(table.organisationId, table.isActive),
  })
);

export type CanonicalInbox = typeof canonicalInboxes.$inferSelect;
export type NewCanonicalInbox = typeof canonicalInboxes.$inferInsert;
