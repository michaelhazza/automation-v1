// canonical_ticket_messages — Support Desk canonical message store.
// Migration: 0310_canonical_ticket_messages.sql
// Spec: tasks/builds/support-desk-canonical/spec.md §5.2
//
// One row per message synced from a helpdesk provider (e.g. Chatwoot).
// Messages are immutable once created; redaction overwrites body content
// but does NOT update a timestamp column (no updated_at by design).
// Tenant-isolated via organisation_id RLS (org_isolation policy).
//
// ─── Polymorphic-FK split (risk R7 mitigation) ───────────────────────────────
//
// Two nullable author FK columns are used instead of one because the two
// author types have asymmetric nullability rules that cannot be expressed
// with a single FK:
//
//   author_contact_id      → canonical_contacts(id)
//     Set when author_type = 'customer' AND a canonical contact match exists.
//     May be NULL for customer messages that have not yet been matched to a
//     canonical contact (e.g. first-contact emails before dedup resolves).
//     Must be NULL for agent, bot, and system messages.
//
//   author_support_agent_id → canonical_support_agents(id)
//     MUST be set (NOT NULL in practice) when author_type IN ('agent', 'bot').
//     Every agent/bot message from the helpdesk provider has a known agent id;
//     there is no "unmatched agent" scenario because we control agent sync.
//     Must be NULL for customer and system messages.
//
// The asymmetry is intentional: do NOT collapse these into a single
// "author_id + author_type" pattern. That pattern loses the FK referential
// integrity guarantee that each column provides independently, and it makes
// the "agent MUST have an agent FK" invariant unenforceable at the DB level.
// The CHECK constraint (canonical_ticket_messages_author_fk_consistency)
// encodes the full cross-column invariant in migration 0310.
// ─────────────────────────────────────────────────────────────────────────────

import { pgTable, uuid, text, boolean, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { connectorConfigs } from './connectorConfigs.js';
import { canonicalContacts } from './canonicalEntities.js';
import { canonicalTickets } from './canonicalTickets.js';
import { canonicalSupportAgents } from './canonicalSupportAgents.js';

export const canonicalTicketMessages = pgTable(
  'canonical_ticket_messages',
  {
    // identity
    id:                       uuid('id').defaultRandom().primaryKey(),
    organisationId:           uuid('organisation_id').notNull().references(() => organisations.id),
    ticketId:                 uuid('ticket_id').notNull().references(() => canonicalTickets.id),
    externalId:               text('external_id').notNull(),
    connectorConfigId:        uuid('connector_config_id').notNull().references(() => connectorConfigs.id),

    // denormalised — used in the three-column unique index to avoid a join
    ticketExternalId:         text('ticket_external_id').notNull(),

    // message attributes
    direction:                text('direction').notNull().$type<'inbound' | 'outbound' | 'internal_note'>(),
    visibility:               text('visibility').notNull().$type<'public' | 'internal'>(),
    authorType:               text('author_type').notNull().$type<'customer' | 'agent' | 'bot' | 'system'>(),

    // split author FKs — see module-level comment for the polymorphic-FK rationale
    authorContactId:          uuid('author_contact_id').references(() => canonicalContacts.id),
    authorSupportAgentId:     uuid('author_support_agent_id').references(() => canonicalSupportAgents.id),

    // content
    bodyText:                 text('body_text').notNull(),
    bodyHtml:                 text('body_html'),
    attachments:              jsonb('attachments').$type<Array<{
      externalId: string;
      filename: string;
      providerUrl: string;
      mimeType?: string;
      size?: number;
    }>>(),

    // redaction
    redacted:                 boolean('redacted').notNull().default(false),
    redactedAtExternal:       timestamp('redacted_at_external', { withTimezone: true }),
    redactedAtCanonical:      timestamp('redacted_at_canonical', { withTimezone: true }),

    // timestamps (no updated_at — messages are immutable once created)
    createdAtExternal:        timestamp('created_at_external', { withTimezone: true }).notNull(),
    createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    // provenance — NO FK constraint, NO index on source_draft_id.
    // The FK to draft_messages and the partial index are deferred to migration 0311 (C4).
    sourceDraftId:            uuid('source_draft_id'),

    // common
    externalMetadata:         jsonb('external_metadata').$type<Record<string, unknown>>(),
  },
  (table) => ({
    connectorTicketExternalUnique: uniqueIndex('canonical_ticket_messages_connector_ticket_external_unique').on(
      table.connectorConfigId,
      table.ticketExternalId,
      table.externalId,
    ),
    orgTicketThreadIdx: index('canonical_ticket_messages_org_ticket_thread_idx').on(
      table.organisationId,
      table.ticketId,
      table.createdAtExternal,
      table.id,
    ),
  })
);

export type CanonicalTicketMessage = typeof canonicalTicketMessages.$inferSelect;
export type NewCanonicalTicketMessage = typeof canonicalTicketMessages.$inferInsert;
