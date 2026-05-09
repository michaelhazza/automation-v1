/**
 * supportTicketService — canonical read/write interface for support tickets.
 *
 * Spec: tasks/builds/support-desk-canonical/spec.md §5.1.A, §5.2.A, §5.2.B, §9, §18
 *
 * All DB access goes through getOrgScopedDb() — every caller must run inside an
 * active withOrgTx block (org-scoped transaction with RLS set_config applied).
 * Adapter mutations (status/assignment/tags) are routed to the provider via the
 * integration adapter; the canonical store updates on the next ingestion cycle.
 */

import { eq, and, inArray } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import {
  canonicalTickets,
  canonicalTicketMessages,
  canonicalTicketDrafts,
  connectorConfigs,
  integrationConnections,
} from '../db/schema/index.js';
import type { CanonicalTicket } from '../db/schema/canonicalTickets.js';
import type { CanonicalTicketMessage } from '../db/schema/canonicalTicketMessages.js';
import type { CanonicalTicketDraft } from '../db/schema/canonicalTicketDrafts.js';
import type { PrincipalContext } from './principal/types.js';
import type { SupportCanonicalStatus, TicketUpdateInput } from '../adapters/integrationAdapter.js';
import { adapters } from '../adapters/index.js';
import {
  isValidTicketStatusTransition,
  applyMessageRedactionFilterForAudience,
  filterDeletedFromAgentReads,
} from './supportTicketServicePure.js';

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404, message });
}

function invalidTransitionError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 422, message });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single ticket scoped to the org. Returns null if not found or belongs
 * to another org.
 */
async function fetchTicketRow(
  ticketId: string,
  organisationId: string,
): Promise<CanonicalTicket | null> {
  const db = getOrgScopedDb('supportTicketService.fetchTicketRow');
  const [ticket] = await db
    .select()
    .from(canonicalTickets)
    .where(
      and(
        eq(canonicalTickets.id, ticketId),
        eq(canonicalTickets.organisationId, organisationId),
      ),
    )
    .limit(1);
  return ticket ?? null;
}

/**
 * Fetch ordered messages for a ticket (oldest-first by external creation time,
 * then by id as a tiebreaker).
 */
async function fetchMessageRows(
  ticketId: string,
  organisationId: string,
): Promise<CanonicalTicketMessage[]> {
  const db = getOrgScopedDb('supportTicketService.fetchMessageRows');
  return db
    .select()
    .from(canonicalTicketMessages)
    .where(
      and(
        eq(canonicalTicketMessages.ticketId, ticketId),
        eq(canonicalTicketMessages.organisationId, organisationId),
      ),
    )
    .orderBy(canonicalTicketMessages.createdAtExternal, canonicalTicketMessages.id);
}

/**
 * Fetch the integration connection for a connectorConfig so we can call the
 * adapter. Throws 404 if no connection is found.
 */
async function fetchConnectionForConnectorConfig(
  connectorConfigId: string,
  organisationId: string,
) {
  const db = getOrgScopedDb('supportTicketService.fetchConnectionForConnectorConfig');

  // Load the connectorConfig to get connectionId and connectorType
  const [config] = await db
    .select()
    .from(connectorConfigs)
    .where(
      and(
        eq(connectorConfigs.id, connectorConfigId),
        eq(connectorConfigs.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!config || !config.connectionId) {
    throw notFoundError('support.ticket.not_found');
  }

  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, config.connectionId))
    .limit(1);

  if (!connection) {
    throw notFoundError('support.ticket.not_found');
  }

  const adapter = adapters[config.connectorType];
  if (!adapter?.ticketing) {
    throw notFoundError('support.ticket.not_found');
  }

  return { connection, adapter, connectorType: config.connectorType };
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

/**
 * Read a ticket + messages for an agent.
 * - Filters provider_deleted tickets → 404
 * - Applies agent-audience redaction to messages
 */
export async function readThreadForAgent(
  ticketId: string,
  principalCtx: PrincipalContext,
): Promise<{ ticket: CanonicalTicket; messages: CanonicalTicketMessage[] }> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  const rawMessages = await fetchMessageRows(ticketId, principalCtx.organisationId);
  const messages = applyMessageRedactionFilterForAudience(
    rawMessages,
    'agent',
  ) as CanonicalTicketMessage[];

  return { ticket, messages };
}

/**
 * Read a ticket + messages + active drafts for the human UI.
 * - Filters provider_deleted tickets → 404
 * - Applies human_ui-audience redaction to messages
 * - Includes drafts in ('dispatching', 'needs_reconciliation', 'manually_marked_sent')
 */
export async function readThreadForHumanUi(
  ticketId: string,
  principalCtx: PrincipalContext,
): Promise<{
  ticket: CanonicalTicket;
  messages: CanonicalTicketMessage[];
  draftOverlay: CanonicalTicketDraft[];
}> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  const rawMessages = await fetchMessageRows(ticketId, principalCtx.organisationId);
  const messages = applyMessageRedactionFilterForAudience(
    rawMessages,
    'human_ui',
  ) as CanonicalTicketMessage[];

  const db = getOrgScopedDb('supportTicketService.readThreadForHumanUi');
  const draftOverlay = await db
    .select()
    .from(canonicalTicketDrafts)
    .where(
      and(
        eq(canonicalTicketDrafts.ticketId, ticketId),
        eq(canonicalTicketDrafts.organisationId, principalCtx.organisationId),
        inArray(canonicalTicketDrafts.status, [
          'dispatching',
          'needs_reconciliation',
          'manually_marked_sent',
        ]),
      ),
    )
    .orderBy(canonicalTicketDrafts.createdAt);

  return { ticket, messages, draftOverlay };
}

/**
 * Get a single ticket by id.
 * - Does NOT filter by providerDeleted — callers that need tombstone filtering
 *   should use readThreadForAgent / readThreadForHumanUi.
 * - Throws 404 if not found.
 */
export async function getTicket(
  ticketId: string,
  principalCtx: PrincipalContext,
): Promise<CanonicalTicket> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket) {
    throw notFoundError('support.ticket.not_found');
  }
  return ticket;
}

/**
 * List open tickets scoped to the org, optionally filtered by inbox and status group.
 *
 * Status groups:
 *   needs_attention   → status IN ('open', 'pending_internal'), providerDeleted=false
 *   all_open          → status IN ('open', 'pending_internal', 'waiting_on_customer'), providerDeleted=false
 *   quarantined       → status = 'unknown_provider_status'
 *
 * Filters out provider_deleted=true in all groups except 'quarantined' where
 * providerDeleted is always false by the fail-closed mapping contract.
 */
export async function listOpenTickets(
  filter: {
    inboxIds?: string[];
    statusGroup?: 'needs_attention' | 'all_open' | 'quarantined';
  },
  principalCtx: PrincipalContext,
): Promise<CanonicalTicket[]> {
  const db = getOrgScopedDb('supportTicketService.listOpenTickets');

  const statusGroup = filter.statusGroup ?? 'all_open';

  const statusValues: SupportCanonicalStatus[] =
    statusGroup === 'needs_attention'
      ? ['open', 'pending_internal']
      : statusGroup === 'all_open'
        ? ['open', 'pending_internal', 'waiting_on_customer']
        : ['unknown_provider_status'];

  const conditions = [
    eq(canonicalTickets.organisationId, principalCtx.organisationId),
    inArray(canonicalTickets.status, statusValues),
  ];

  // For non-quarantined groups, exclude provider_deleted rows.
  // Quarantined rows are set by fail-closed mapping and are never providerDeleted.
  if (statusGroup !== 'quarantined') {
    conditions.push(eq(canonicalTickets.providerDeleted, false));
  }

  if (filter.inboxIds && filter.inboxIds.length > 0) {
    conditions.push(inArray(canonicalTickets.inboxId, filter.inboxIds));
  }

  const rows = await db
    .select()
    .from(canonicalTickets)
    .where(and(...conditions))
    .orderBy(canonicalTickets.openedAt);

  // Apply agent-read filter as a belt-and-suspenders guard
  return filterDeletedFromAgentReads(rows);
}

// ---------------------------------------------------------------------------
// Mutation API — routes to adapter; canonical store updates on next poll cycle
// ---------------------------------------------------------------------------

/**
 * Apply a status change to a ticket via the provider adapter.
 * Validates the transition via isValidTicketStatusTransition — throws 422 for
 * invalid transitions.
 */
export async function applyStatusChange(
  ticketId: string,
  newStatus: SupportCanonicalStatus,
  principalCtx: PrincipalContext,
): Promise<void> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  if (!isValidTicketStatusTransition(ticket.status as SupportCanonicalStatus, newStatus)) {
    throw invalidTransitionError('support.ticket.invalid_transition');
  }

  const { connection, adapter } = await fetchConnectionForConnectorConfig(
    ticket.connectorConfigId,
    principalCtx.organisationId,
  );

  const fields: TicketUpdateInput = { status: newStatus };
  await adapter.ticketing!.updateTicket(connection, ticket.externalId, fields);
}

/**
 * Apply an assignment change to a ticket via the provider adapter.
 * Pass null to unassign.
 */
export async function applyAssignmentChange(
  ticketId: string,
  assigneeAgentExternalId: string | null,
  principalCtx: PrincipalContext,
): Promise<void> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  const { connection, adapter } = await fetchConnectionForConnectorConfig(
    ticket.connectorConfigId,
    principalCtx.organisationId,
  );

  const fields: TicketUpdateInput = {
    assignedTo: assigneeAgentExternalId ?? undefined,
  };
  await adapter.ticketing!.updateTicket(connection, ticket.externalId, fields);
}

/**
 * Apply a tag mutation to a ticket via the provider adapter.
 * addTags and removeTags are merged; the resulting tag list is sent to the adapter.
 */
export async function applyTagMutation(
  ticketId: string,
  mutation: { addTags?: string[]; removeTags?: string[] },
  principalCtx: PrincipalContext,
): Promise<void> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  const { connection, adapter } = await fetchConnectionForConnectorConfig(
    ticket.connectorConfigId,
    principalCtx.organisationId,
  );

  const currentTags = ticket.tags ?? [];
  const removedSet = new Set(mutation.removeTags ?? []);
  const afterRemoval = currentTags.filter((t) => !removedSet.has(t));
  const addSet = new Set(mutation.addTags ?? []);
  const merged = [...afterRemoval, ...addSet].filter(
    (t, idx, arr) => arr.indexOf(t) === idx,
  );

  const fields: TicketUpdateInput = { tags: merged };
  await adapter.ticketing!.updateTicket(connection, ticket.externalId, fields);
}
