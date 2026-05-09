// canonical_ticket_drafts — AI-proposed support reply drafts with state machine and dispatch history.
// Migration: 0311_canonical_ticket_drafts.sql
// Spec: tasks/builds/support-desk-canonical/spec.md §5.5, §8, §11, §12, §14.1, §14.7, §18
//
// One row per AI-proposed reply for a canonical support ticket. Tracks the full lifecycle
// from draft generation through operator review, dispatch, reconciliation, and final status.
// Tenant-isolated via organisation_id RLS (org_isolation policy).
//
// ─── State machine ─────────────────────────────────────────────────────────────────────────────
//
// draft → awaiting_review → dispatching → sent            (happy path)
//                         → rejected                      (operator rejects)
//                         → expired                       (expiry scanner)
//           dispatching   → needs_reconciliation          (dispatch stalled)
//           dispatching   → failed                        (terminal dispatch failure)
//           any           → superseded                    (newer draft replaces this one)
//           any           → manually_marked_sent          (operator marks sent without dispatch)
//
// State invariants (enforced by CHECK constraints in DDL):
//   sent                → sent_message_id MUST NOT be NULL
//   manually_marked_sent → sent_message_id MUST be NULL
//
// ─── Deferred FK on canonical_ticket_messages ──────────────────────────────────────────────────
//
// canonical_ticket_messages.source_draft_id gained its FK constraint in migration 0311
// (deferred from 0310 because this table did not exist yet). The Drizzle .references() call
// on canonicalTicketMessages.sourceDraftId is wired in canonicalTicketMessages.ts.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SupportProposedActions } from '../../../shared/types/supportProposedActions.js';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';
import { connectorConfigs } from './connectorConfigs.js';
import { canonicalTickets } from './canonicalTickets.js';
import { agentRuns } from './agentRuns.js';
import { users } from './users.js';
// NOTE: canonicalTicketMessages is NOT imported here to avoid a circular import
// (canonicalTicketMessages → canonicalTicketDrafts → canonicalTicketMessages).
// The FK from sent_message_id → canonical_ticket_messages(id) is enforced by the
// DDL in migration 0311; Drizzle's .references() is omitted on sentMessageId only.

export const canonicalTicketDrafts = pgTable(
  'canonical_ticket_drafts',
  {
    // identity
    id:                             uuid('id').defaultRandom().primaryKey(),
    organisationId:                 uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:                   uuid('subaccount_id').references(() => subaccounts.id),
    connectorConfigId:              uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    ticketId:                       uuid('ticket_id').notNull().references(() => canonicalTickets.id),

    // proposed content
    proposedBodyText:               text('proposed_body_text').notNull(),
    proposedBodyHtml:               text('proposed_body_html'),
    proposedVisibility:             text('proposed_visibility').notNull().$type<'public' | 'internal'>(),
    proposedActions:                jsonb('proposed_actions').$type<SupportProposedActions>(),

    // state machine
    status:                         text('status').notNull().$type<
      | 'draft'
      | 'awaiting_review'
      | 'dispatching'
      | 'needs_reconciliation'
      | 'manually_marked_sent'
      | 'sent'
      | 'rejected'
      | 'failed'
      | 'expired'
      | 'superseded'
    >(),

    // three-phase dispatch columns
    actionIdempotencyKey:           text('action_idempotency_key'),
    dispatchingStartedAt:           timestamp('dispatching_started_at', { withTimezone: true }),
    lastReconciliationAt:           timestamp('last_reconciliation_at', { withTimezone: true }),
    reconciliationAttemptCount:     integer('reconciliation_attempt_count').notNull().default(0),

    // provenance
    createdByAgentRunId:            uuid('created_by_agent_run_id').references(() => agentRuns.id),
    modelVersion:                   text('model_version'),
    promptVersion:                  text('prompt_version'),

    // review trail
    reviewerUserId:                 uuid('reviewer_user_id').references(() => users.id),
    reviewedAt:                     timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes:                    text('review_notes'),

    // outbound link — no .references() here to avoid a circular import with canonicalTicketMessages.
    // The FK constraint (sent_message_id → canonical_ticket_messages.id) is enforced by the DDL
    // in migration 0311.
    sentMessageId:                  uuid('sent_message_id'),

    // lifecycle
    expiresAt:                      timestamp('expires_at', { withTimezone: true }),
    createdAt:                      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt:                      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Regular index: lookup by ticket + status
    orgTicketStatusIdx:             index('canonical_ticket_drafts_org_ticket_status_idx').on(
      table.organisationId,
      table.ticketId,
      table.status,
    ),

    // Partial index: operator review queue
    operatorQueueIdx:               index('canonical_ticket_drafts_operator_queue_idx').on(
      table.organisationId,
      table.status,
      table.createdAt,
    ).where(sql`${table.status} IN ('awaiting_review', 'needs_reconciliation', 'manually_marked_sent')`),

    // Partial UNIQUE: idempotency key uniqueness (NULLs excluded per spec §14.1)
    idempotencyKeyUniq:             uniqueIndex('canonical_ticket_drafts_idempotency_key_uniq').on(
      table.connectorConfigId,
      table.actionIdempotencyKey,
    ).where(sql`${table.actionIdempotencyKey} IS NOT NULL`),

    // Partial index: expiry scanner
    expiryScannerIdx:               index('canonical_ticket_drafts_expiry_scanner_idx').on(
      table.organisationId,
      table.expiresAt,
    ).where(sql`${table.status} IN ('draft', 'awaiting_review')`),

    // Partial UNIQUE: soft-uniqueness for same-run proposals
    // NULLs in created_by_agent_run_id are not equal in Postgres — two rows with NULL
    // agent_run_id do NOT violate this constraint (intentional per spec §14.7).
    softUniqueProposalIdx:          uniqueIndex('canonical_ticket_drafts_soft_unique_proposal_idx').on(
      table.organisationId,
      table.ticketId,
      table.createdByAgentRunId,
      table.proposedVisibility,
    ).where(sql`${table.status} IN ('draft', 'awaiting_review')`),
  })
);

export type CanonicalTicketDraft = typeof canonicalTicketDrafts.$inferSelect;
export type NewCanonicalTicketDraft = typeof canonicalTicketDrafts.$inferInsert;
