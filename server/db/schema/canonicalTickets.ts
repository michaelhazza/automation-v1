// canonical_tickets — Support Desk canonical ticket store.
// Migration: 0309_canonical_tickets.sql
// Spec: tasks/builds/support-desk-canonical/spec.md §5.1
//
// One row per support ticket synced from a helpdesk provider (e.g. Chatwoot).
// Holds lifecycle state, routing, collision primitives, SLA tracking, and
// tombstone columns. Tenant-isolated via organisation_id RLS (org_isolation policy).

import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';
import { subaccounts } from './subaccounts.js';
import { canonicalContacts } from './canonicalEntities.js';
import { canonicalInboxes } from './canonicalInboxes.js';
import { canonicalSupportAgents } from './canonicalSupportAgents.js';
import { integrationConnections } from './integrationConnections.js';

export const canonicalTickets = pgTable(
  'canonical_tickets',
  {
    // identity
    id:                       uuid('id').defaultRandom().primaryKey(),
    organisationId:           uuid('organisation_id').notNull().references(() => organisations.id),
    connectorConfigId:        uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    subaccountId:             uuid('subaccount_id').references(() => subaccounts.id),

    // customer identity
    customerEmail:            text('customer_email'),
    customerName:             text('customer_name'),
    customerExternalId:       text('customer_external_id'),
    canonicalContactId:       uuid('canonical_contact_id').references(() => canonicalContacts.id),

    // lifecycle
    status:                   text('status').notNull().$type<'open' | 'pending_internal' | 'waiting_on_customer' | 'resolved' | 'closed' | 'unknown_provider_status'>(),
    priority:                 text('priority').notNull().$type<'low' | 'medium' | 'high' | 'urgent'>(),
    openedAt:                 timestamp('opened_at', { withTimezone: true }).notNull(),
    firstResponseAt:          timestamp('first_response_at', { withTimezone: true }),
    lastCustomerMessageAt:    timestamp('last_customer_message_at', { withTimezone: true }),
    lastAgentMessageAt:       timestamp('last_agent_message_at', { withTimezone: true }),
    closedAt:                 timestamp('closed_at', { withTimezone: true }),
    resolutionAt:             timestamp('resolution_at', { withTimezone: true }),

    // routing
    inboxId:                  uuid('inbox_id').notNull().references(() => canonicalInboxes.id),
    assigneeAgentId:          uuid('assignee_agent_id').references(() => canonicalSupportAgents.id),

    // collision primitives
    lastHumanActivityAt:      timestamp('last_human_activity_at', { withTimezone: true }),
    lastBotActivityAt:        timestamp('last_bot_activity_at', { withTimezone: true }),
    botClaimedAt:             timestamp('bot_claimed_at', { withTimezone: true }),
    botClaimedByRunId:        uuid('bot_claimed_by_run_id'),

    // classification
    subject:                  text('subject').notNull(),
    tags:                     text('tags').array().notNull().default(sql`'{}'`),
    category:                 text('category'),
    sourceChannel:            text('source_channel').notNull().$type<'email' | 'chat' | 'form' | 'api'>(),

    // SLA
    slaDueAt:                 timestamp('sla_due_at', { withTimezone: true }),
    slaBreached:              boolean('sla_breached').notNull().default(false),
    slaPolicyExternalId:      text('sla_policy_external_id'),

    // tombstone
    providerDeleted:          boolean('provider_deleted').notNull().default(false),
    deletedAtExternal:        timestamp('deleted_at_external', { withTimezone: true }),
    deletedAtCanonical:       timestamp('deleted_at_canonical', { withTimezone: true }),
    deletionSource:           text('deletion_source').$type<'provider_webhook' | 'provider_poll_observation' | 'manual_admin'>(),

    // common
    externalId:               text('external_id').notNull(),
    externalMetadata:         jsonb('external_metadata').$type<Record<string, unknown>>(),
    lastSyncedAt:             timestamp('last_synced_at', { withTimezone: true }),
    sourceConnectionId:       uuid('source_connection_id').references(() => integrationConnections.id),
    createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt:                timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    connectorExternalUnique:    uniqueIndex('canonical_tickets_connector_external_unique').on(table.connectorConfigId, table.externalId),
    orgInboxStatusIdx:          index('canonical_tickets_org_inbox_status_idx').on(table.organisationId, table.inboxId, table.status),
    orgCustomerEmailIdx:        index('canonical_tickets_org_customer_email_idx').on(table.organisationId, table.customerEmail),
    orgLastHumanActivityIdx:    index('canonical_tickets_org_last_human_activity_idx').on(table.organisationId, table.lastHumanActivityAt),
    unknownStatusIdx:           index('canonical_tickets_unknown_status_idx').on(table.organisationId, table.status).where(sql`${table.status} = 'unknown_provider_status'`),
    slaDueIdx:                  index('canonical_tickets_sla_due_idx').on(table.organisationId, table.slaDueAt).where(sql`${table.slaDueAt} IS NOT NULL AND ${table.slaBreached} = false`),
  })
);

export type CanonicalTicket = typeof canonicalTickets.$inferSelect;
export type NewCanonicalTicket = typeof canonicalTickets.$inferInsert;
