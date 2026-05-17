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
  canonicalSupportAgents,
  connectorConfigs,
  integrationConnections,
} from '../db/schema/index.js';
import { canonicalContacts } from '../db/schema/canonicalEntities.js'; // verify-canonical-read-interface: allowed
import type { CanonicalTicket } from '../db/schema/canonicalTickets.js';
import type { CanonicalTicketMessage } from '../db/schema/canonicalTicketMessages.js';
import type { CanonicalTicketDraft } from '../db/schema/canonicalTicketDrafts.js';
import type { PrincipalContext } from './principal/types.js';
import type { SupportCanonicalStatus, TicketUpdateInput } from '../adapters/integrationAdapter.js';
import { adapters } from '../adapters/index.js';
import {
  isValidTicketStatusTransition,
  filterDeletedFromAgentReads,
} from './supportTicketServicePure.js';

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function notFoundError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404, message });
}

function forbiddenError(errorCode: string, message?: string): Error {
  return Object.assign(new Error(message ?? errorCode), { statusCode: 403, errorCode });
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
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

export type SupportThreadMessage = {
  id: string;
  direction: 'inbound' | 'outbound' | 'internal_note';
  visibility: 'public' | 'internal';
  body: string;
  authorName: string | null;
  createdAtExternal: Date | null;
  attachments: Array<{
    externalId: string;
    filename: string;
    providerUrl: string | null;
    mimeType?: string;
    size?: number;
  }> | null;
};

/**
 * Fetch messages with LEFT JOINs on canonical_contacts and canonical_support_agents // verify-canonical-read-interface: allowed
 * to resolve authorName. Returns raw rows; caller applies redaction then shapes.
 */
async function fetchMessageRowsWithAuthors(
  ticketId: string,
  organisationId: string,
): Promise<Array<{
  id: string;
  direction: string;
  visibility: string;
  bodyText: string;
  bodyHtml: string | null;
  attachments: CanonicalTicketMessage['attachments'];
  redacted: boolean;
  createdAtExternal: Date;
  authorContactFirstName: string | null;
  authorContactLastName: string | null;
  authorContactEmail: string | null;
  authorAgentDisplayName: string | null;
}>> {
  const db = getOrgScopedDb('supportTicketService.fetchMessageRowsWithAuthors');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  return db
    .select({
      id: canonicalTicketMessages.id,
      direction: canonicalTicketMessages.direction,
      visibility: canonicalTicketMessages.visibility,
      bodyText: canonicalTicketMessages.bodyText,
      bodyHtml: canonicalTicketMessages.bodyHtml,
      attachments: canonicalTicketMessages.attachments,
      redacted: canonicalTicketMessages.redacted,
      createdAtExternal: canonicalTicketMessages.createdAtExternal,
      authorContactFirstName: canonicalContacts.firstName, // verify-canonical-read-interface: allowed
      authorContactLastName: canonicalContacts.lastName, // verify-canonical-read-interface: allowed
      authorContactEmail: canonicalContacts.email, // verify-canonical-read-interface: allowed
      authorAgentDisplayName: canonicalSupportAgents.displayName,
    })
    .from(canonicalTicketMessages)
    .leftJoin(
      canonicalContacts, // verify-canonical-read-interface: allowed
      eq(canonicalTicketMessages.authorContactId, canonicalContacts.id), // verify-canonical-read-interface: allowed
    )
    .leftJoin(
      canonicalSupportAgents,
      eq(canonicalTicketMessages.authorSupportAgentId, canonicalSupportAgents.id),
    )
    .where(
      and(
        eq(canonicalTicketMessages.ticketId, ticketId),
        eq(canonicalTicketMessages.organisationId, organisationId),
      ),
    )
    .orderBy(canonicalTicketMessages.createdAtExternal, canonicalTicketMessages.id);
}

function shapeThreadMessage(row: {
  id: string;
  direction: string;
  visibility: string;
  bodyText: string;
  bodyHtml: string | null;
  attachments: CanonicalTicketMessage['attachments'];
  redacted: boolean;
  createdAtExternal: Date;
  authorContactFirstName: string | null;
  authorContactLastName: string | null;
  authorContactEmail: string | null;
  authorAgentDisplayName: string | null;
}): SupportThreadMessage {
  let authorName: string | null = null;
  if (row.authorAgentDisplayName) {
    authorName = row.authorAgentDisplayName;
  } else if (row.authorContactFirstName || row.authorContactLastName) {
    authorName = [row.authorContactFirstName, row.authorContactLastName]
      .filter(Boolean)
      .join(' ')
      .trim() || row.authorContactEmail || null;
  } else if (row.authorContactEmail) {
    authorName = row.authorContactEmail;
  }

  const body = row.redacted ? '[redacted]' : row.bodyText;
  const attachments = row.redacted ? null : (row.attachments ?? null);

  return {
    id: row.id,
    direction: row.direction as SupportThreadMessage['direction'],
    visibility: row.visibility as SupportThreadMessage['visibility'],
    body,
    authorName,
    createdAtExternal: row.createdAtExternal,
    attachments,
  };
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
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, config.connectionId), eq(integrationConnections.organisationId, organisationId)))
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
): Promise<{ ticket: CanonicalTicket; messages: SupportThreadMessage[] }> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  const rawRows = await fetchMessageRowsWithAuthors(ticketId, principalCtx.organisationId);
  const messages = rawRows.map(shapeThreadMessage);

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
  messages: SupportThreadMessage[];
  draftOverlay: CanonicalTicketDraft[];
}> {
  const ticket = await fetchTicketRow(ticketId, principalCtx.organisationId);
  if (!ticket || ticket.providerDeleted) {
    throw notFoundError('support.ticket.not_found');
  }

  if (
    principalCtx.subaccountId !== null &&
    ticket.subaccountId !== principalCtx.subaccountId
  ) {
    throw forbiddenError('support.ticket.scope_mismatch');
  }

  const rawRows = await fetchMessageRowsWithAuthors(ticketId, principalCtx.organisationId);
  const messages = rawRows.map(shapeThreadMessage);

  const db = getOrgScopedDb('supportTicketService.readThreadForHumanUi');
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
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

export type SupportTicketListItem = {
  id: string;
  externalId: string;
  subject: string;
  status: SupportCanonicalStatus;
  priority: string | null;
  customerEmail: string | null;
  customerName: string | null;
  inboxId: string;
  assigneeExternalId: string | null;
  lastActivityAt: Date | null;
  openedAt: Date;
};

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
 *
 * Returns a shaped DTO (SupportTicketListItem) with computed lastActivityAt and
 * resolved assigneeExternalId via LEFT JOIN on canonical_support_agents.
 */
export async function listOpenTickets(
  filter: {
    inboxIds?: string[];
    statusGroup?: 'needs_attention' | 'all_open' | 'quarantined';
  },
  principalCtx: PrincipalContext,
): Promise<SupportTicketListItem[]> {
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
    ...(principalCtx.subaccountId !== null
      ? [eq(canonicalTickets.subaccountId, principalCtx.subaccountId)]
      : []),
  ];

  // For non-quarantined groups, exclude provider_deleted rows.
  // Quarantined rows are set by fail-closed mapping and are never providerDeleted.
  if (statusGroup !== 'quarantined') {
    conditions.push(eq(canonicalTickets.providerDeleted, false));
  }

  if (filter.inboxIds && filter.inboxIds.length > 0) {
    conditions.push(inArray(canonicalTickets.inboxId, filter.inboxIds));
  }

  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="false positive: db is result of getOrgScopedDb call within this function — tenant-scoped"
  const rows = await db
    .select({
      id: canonicalTickets.id,
      externalId: canonicalTickets.externalId,
      subject: canonicalTickets.subject,
      status: canonicalTickets.status,
      priority: canonicalTickets.priority,
      customerEmail: canonicalTickets.customerEmail,
      customerName: canonicalTickets.customerName,
      inboxId: canonicalTickets.inboxId,
      openedAt: canonicalTickets.openedAt,
      lastCustomerMessageAt: canonicalTickets.lastCustomerMessageAt,
      lastAgentMessageAt: canonicalTickets.lastAgentMessageAt,
      providerDeleted: canonicalTickets.providerDeleted,
      assigneeExternalId: canonicalSupportAgents.externalId,
    })
    .from(canonicalTickets)
    .leftJoin(
      canonicalSupportAgents,
      eq(canonicalTickets.assigneeAgentId, canonicalSupportAgents.id),
    )
    .where(and(...conditions))
    .orderBy(canonicalTickets.openedAt);

  // Apply belt-and-suspenders tombstone filter then shape the DTO
  const filtered = filterDeletedFromAgentReads(rows);
  return filtered.map((r) => {
      const lastActivityAt =
        r.lastCustomerMessageAt && r.lastAgentMessageAt
          ? r.lastCustomerMessageAt > r.lastAgentMessageAt
            ? r.lastCustomerMessageAt
            : r.lastAgentMessageAt
          : r.lastCustomerMessageAt ?? r.lastAgentMessageAt ?? r.openedAt;

      return {
      id: r.id,
      externalId: r.externalId,
      subject: r.subject,
      status: r.status as SupportCanonicalStatus,
      priority: r.priority,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      inboxId: r.inboxId,
      assigneeExternalId: r.assigneeExternalId ?? null,
      lastActivityAt,
      openedAt: r.openedAt,
    };
  });
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
    assignedTo: assigneeAgentExternalId,
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
