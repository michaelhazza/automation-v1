import axios from 'axios';
import crypto from 'crypto';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { getProviderRateLimiter } from '../lib/rateLimiter.js';
import type {
  IntegrationAdapter,
  NormalisedEvent,
  TicketCreateResult,
  TicketUpdateResult,
  TicketReplyResult,
  TicketData,
} from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBaseUrl(connection: IntegrationConnection): string {
  const config = connection.configJson as Record<string, unknown> | null;
  const siteName = config?.siteName as string | undefined;
  if (!siteName) {
    throw { statusCode: 400, message: 'No siteName in connection config — required for Teamwork Desk API' };
  }
  return `https://${siteName}.teamwork.com/desk/v1`;
}

function getAuthHeaders(connection: IntegrationConnection): Record<string, string> {
  // Teamwork Desk supports both OAuth2 bearer tokens and API key auth.
  // OAuth2: use accessToken. API key: use secretsRef as basic auth.
  if (connection.accessToken) {
    const token = connectionTokenService.decryptToken(connection.accessToken);
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  if (connection.secretsRef) {
    const apiKey = connectionTokenService.decryptToken(connection.secretsRef);
    const encoded = Buffer.from(`${apiKey}:x`).toString('base64');
    return {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
    };
  }

  throw { statusCode: 401, message: 'Teamwork connection has neither access token nor API key' };
}

function mapTicketStatus(status: string): TicketData['status'] {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'new':
    case 'open':
      return 'active';
    case 'waiting':
    case 'waitingoncustomer':
    case 'waiting on customer':
    case 'onhold':
    case 'on hold':
      return 'waiting';
    case 'solved':
    case 'resolved':
      return 'resolved';
    case 'closed':
      return 'closed';
    default:
      return 'active';
  }
}

function mapTicketPriority(priority: string): TicketData['priority'] {
  switch (priority?.toLowerCase()) {
    case 'low':
    case 'none':
      return 'low';
    case 'medium':
    case 'normal':
      return 'medium';
    case 'high':
      return 'high';
    case 'critical':
    case 'urgent':
      return 'urgent';
    default:
      return 'medium';
  }
}

// ---------------------------------------------------------------------------
// Teamwork Desk webhook event type mapping
// ---------------------------------------------------------------------------

type TeamworkEventMapping = { normalisedType: string; entityType: NormalisedEvent['entityType'] };

function mapTeamworkEventType(eventType: string): TeamworkEventMapping | null {
  switch (eventType) {
    case 'ticket.created':
    case 'ticket.updated':
    case 'ticket.completed':
    case 'ticket.reopened':
    case 'ticket.deleted':
      return { normalisedType: eventType, entityType: 'ticket' };
    case 'ticket.reply.created':
    case 'ticket.note.created':
      return { normalisedType: eventType, entityType: 'ticket' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Teamwork Desk Adapter
// ---------------------------------------------------------------------------

export const teamworkAdapter: IntegrationAdapter = {
  supportedActions: ['create_ticket', 'update_ticket', 'add_reply', 'get_ticket'],

  // ── Outbound ticketing actions ──────────────────────────────────────────
  ticketing: {
    async createTicket(
      connection: IntegrationConnection,
      fields: Record<string, unknown>,
    ): Promise<TicketCreateResult> {
      try {
        const baseUrl = getBaseUrl(connection);
        const headers = getAuthHeaders(connection);
        await getProviderRateLimiter('teamwork').acquire(connection.id);

        const body: Record<string, unknown> = { subject: fields.subject as string };
        if (fields.previewText) body.previewText = fields.previewText;
        if (fields.status) body.status = fields.status;
        if (fields.priority) body.priority = fields.priority;
        if (fields.assignedTo) body.assignedTo = fields.assignedTo;
        if (fields.inboxId) body.inboxId = fields.inboxId;
        if (fields.customerEmail) body.customer = { email: fields.customerEmail as string };
        if (fields.tags) body.tags = fields.tags;

        const response = await axios.post(`${baseUrl}/tickets.json`, { ticket: body }, {
          headers,
          timeout: TIMEOUT_MS,
        });

        const ticket = (response.data as { ticket?: { id?: number } })?.ticket;
        return {
          ticketId: String(ticket?.id ?? ''),
          success: true,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ticketId: '', success: false, error: `Teamwork createTicket failed: ${message}` };
      }
    },

    async updateTicket(
      connection: IntegrationConnection,
      ticketId: string,
      fields: Record<string, unknown>,
    ): Promise<TicketUpdateResult> {
      try {
        const baseUrl = getBaseUrl(connection);
        const headers = getAuthHeaders(connection);
        await getProviderRateLimiter('teamwork').acquire(connection.id);

        const body: Record<string, unknown> = {};
        if (fields.status) body.status = fields.status;
        if (fields.priority) body.priority = fields.priority;
        if (fields.assignedTo) body.assignedTo = fields.assignedTo;
        if (fields.subject) body.subject = fields.subject;
        if (fields.tags) body.tags = fields.tags;

        await axios.put(`${baseUrl}/tickets/${ticketId}.json`, { ticket: body }, {
          headers,
          timeout: TIMEOUT_MS,
        });

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Teamwork updateTicket failed: ${message}` };
      }
    },

    async addReply(
      connection: IntegrationConnection,
      ticketId: string,
      body: string,
      options?: { status?: string },
    ): Promise<TicketReplyResult> {
      try {
        const baseUrl = getBaseUrl(connection);
        const headers = getAuthHeaders(connection);
        await getProviderRateLimiter('teamwork').acquire(connection.id);

        const payload: Record<string, unknown> = {
          body,
          ...(options?.status && { status: options.status }),
        };

        const response = await axios.post(
          `${baseUrl}/tickets/${ticketId}/threads.json`,
          payload,
          { headers, timeout: TIMEOUT_MS },
        );

        const thread = (response.data as { thread?: { id?: number } })?.thread;
        return {
          replyId: String(thread?.id ?? ''),
          success: true,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { replyId: '', success: false, error: `Teamwork addReply failed: ${message}` };
      }
    },

    async getTicket(
      connection: IntegrationConnection,
      ticketId: string,
    ): Promise<TicketData> {
      const baseUrl = getBaseUrl(connection);
      const headers = getAuthHeaders(connection);
      await getProviderRateLimiter('teamwork').acquire(connection.id);

      const response = await axios.get(`${baseUrl}/tickets/${ticketId}.json`, {
        headers,
        timeout: TIMEOUT_MS,
      });

      const t = (response.data as { ticket?: Record<string, unknown> })?.ticket;
      if (!t) throw { statusCode: 404, message: `Ticket ${ticketId} not found` };

      return {
        externalId: String(t.id),
        subject: (t.subject as string) ?? '',
        status: mapTicketStatus(t.status as string),
        priority: mapTicketPriority(t.priority as string),
        assignee: t.assignedTo as string | undefined,
        customerEmail: (t.customer as Record<string, unknown>)?.email as string | undefined,
        customerName: (t.customer as Record<string, unknown>)?.name as string | undefined,
        tags: t.tags as string[] | undefined,
        inboxId: t.inboxId ? String(t.inboxId) : undefined,
        createdAt: t.createdAt ? new Date(t.createdAt as string) : undefined,
        updatedAt: t.updatedAt ? new Date(t.updatedAt as string) : undefined,
        metadata: t,
      };
    },
  },

  // ── Webhook handling ────────────────────────────────────────────────────
  webhook: {
    verifySignature(payload: Buffer, signature: string, secret: string): boolean {
      const computed = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      const sig = Buffer.from(signature);
      const comp = Buffer.from(computed);
      if (sig.length !== comp.length) return false;
      return crypto.timingSafeEqual(sig, comp);
    },

    normaliseEvent(rawEvent: unknown): NormalisedEvent | null {
      const event = rawEvent as Record<string, unknown>;
      const eventType = event.event as string | undefined;
      if (!eventType) return null;

      const mapping = mapTeamworkEventType(eventType);
      if (!mapping) return null;

      // Teamwork Desk webhook payloads nest ticket data under event.ticket
      const ticket = event.ticket as Record<string, unknown> | undefined;
      const ticketId = ticket?.id ? String(ticket.id) : (event.ticketId ? String(event.ticketId) : '');

      // accountExternalId maps to the inbox or installation — use inboxId if available
      const inboxId = ticket?.inboxId ? String(ticket.inboxId) : '';

      return {
        eventType: mapping.normalisedType,
        accountExternalId: inboxId,
        entityType: mapping.entityType,
        entityExternalId: ticketId,
        data: event,
        timestamp: new Date(),
        sourceTimestamp: ticket?.createdAt ? new Date(ticket.createdAt as string) : undefined,
      };
    },
  },
};
