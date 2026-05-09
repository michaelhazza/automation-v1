import axios from 'axios';
import crypto from 'crypto';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { getProviderRateLimiter } from '../lib/rateLimiter.js';
import { withBackoff } from '../lib/withBackoff.js';
import type {
  IntegrationAdapter,
  AdapterError,
  NormalisedEvent,
  TicketCreateInput,
  TicketUpdateInput,
  TicketCreateResult,
  TicketUpdateResult,
  TicketReplyResult,
  TicketData,
  CanonicalAccountData,
  CanonicalContactData,
  CanonicalOpportunityData,
  CanonicalConversationData,
  CanonicalRevenueData,
  CanonicalInboxData,
  CanonicalSupportAgentData,
  CanonicalTicketData,
  CanonicalTicketMessageData,
  FetchSupportResult,
  FetchOptions,
} from './integrationAdapter.js';
import { classifyAdapterError } from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';
import { mapTeamworkStatus } from './teamwork/teamworkSupportStatusMap.js';

const TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SITE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function getBaseUrl(connection: IntegrationConnection): string {
  const config = connection.configJson as Record<string, unknown> | null;
  const siteName = config?.siteName as string | undefined;
  if (!siteName) {
    throw { statusCode: 400, message: 'No siteName in connection config — required for Teamwork Desk API' };
  }
  if (!SITE_NAME_PATTERN.test(siteName)) {
    throw { statusCode: 400, message: 'Invalid Teamwork siteName format — must be lowercase alphanumeric with hyphens' };
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

function mapSourceChannel(source: string | undefined): CanonicalTicketData['sourceChannel'] {
  switch (source?.toLowerCase()) {
    case 'email':
      return 'email';
    case 'chat':
    case 'livechat':
      return 'chat';
    case 'form':
    case 'web':
      return 'form';
    default:
      return 'email';
  }
}

function mapMessageDirection(
  messageType: string,
): CanonicalTicketMessageData['direction'] {
  switch (messageType) {
    case 'note':
      return 'internal_note';
    case 'forward':
    case 'reply':
    case 'agent-reply':
      return 'outbound';
    default:
      return 'inbound';
  }
}

function mapAuthorType(
  author: Record<string, unknown> | undefined,
  messageType: string,
): CanonicalTicketMessageData['authorType'] {
  if (messageType === 'note') return 'agent';
  if (!author) return 'system';
  const kind = (author.type as string | undefined)?.toLowerCase();
  if (kind === 'bot' || kind === 'automation') return 'bot';
  if (kind === 'agent' || kind === 'staff') return 'agent';
  return 'customer';
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
    case 'ticket.assigned':
    case 'ticket.status_changed':
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
      fields: TicketCreateInput,
    ): Promise<TicketCreateResult> {
      try {
        const baseUrl = getBaseUrl(connection);
        const headers = getAuthHeaders(connection);
        await getProviderRateLimiter('teamwork').acquire(connection.id);

        const body: Record<string, unknown> = { subject: fields.subject };
        if (fields.previewText) body.previewText = fields.previewText;
        if (fields.status) body.status = fields.status;
        if (fields.priority) body.priority = fields.priority;
        if (fields.assignedTo) body.assignedTo = fields.assignedTo;
        if (fields.inboxId) body.inboxId = fields.inboxId;
        if (fields.customerEmail) body.customer = { email: fields.customerEmail };
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
        return { ticketId: '', success: false, error: classifyAdapterError(err, 'teamwork', 'createTicket') };
      }
    },

    async updateTicket(
      connection: IntegrationConnection,
      ticketId: string,
      fields: TicketUpdateInput,
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
        return { success: false, error: classifyAdapterError(err, 'teamwork', 'updateTicket') };
      }
    },

    async addReply(
      connection: IntegrationConnection,
      ticketId: string,
      body: string,
      options?: { idempotencyKey?: string; status?: string },
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
        return { replyId: '', success: false, error: classifyAdapterError(err, 'teamwork', 'addReply') };
      }
    },

    async addInternalNote(
      connection: IntegrationConnection,
      ticketId: string,
      body: string,
      _options?: { idempotencyKey?: string },
    ): Promise<TicketReplyResult> {
      const baseUrl = getBaseUrl(connection);
      const headers = getAuthHeaders(connection);
      await getProviderRateLimiter('teamwork').acquire(connection.id);

      try {
        const response = await axios.post(
          `${baseUrl}/tickets/${ticketId}/customerReplies.json`,
          { reply: { body, type: 'note' } },
          { headers, timeout: TIMEOUT_MS },
        );
        const replyId = String((response.data as { reply?: { id?: unknown } })?.reply?.id ?? '');
        return { replyId, success: true };
      } catch (err) {
        return { replyId: '', success: false, error: classifyAdapterError(err, 'teamwork', 'addInternalNote') };
      }
    },

    async resolveAttachment(
      _connection: IntegrationConnection,
      _ticketId: string,
      _messageId: string,
      _attachmentExternalId: string,
    ): Promise<{ url?: string; stream?: NodeJS.ReadableStream; mimeType?: string; success: boolean; error?: AdapterError }> {
      return { success: false, error: { code: 'unknown', retryable: false, message: 'resolveAttachment not implemented for Teamwork' } };
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

  // ── Support desk ingestion ──────────────────────────────────────────────
  ingestion: {
    // Non-support ingestion methods are not implemented for Teamwork Desk.
    // Required by the interface — stub implementations satisfy the contract.
    async listAccounts(): Promise<CanonicalAccountData[]> { return []; },
    async fetchContacts(): Promise<CanonicalContactData[]> { return []; },
    async fetchOpportunities(): Promise<CanonicalOpportunityData[]> { return []; },
    async fetchConversations(): Promise<CanonicalConversationData[]> { return []; },
    async fetchRevenue(): Promise<CanonicalRevenueData[]> { return []; },
    async validateCredentials(connection: IntegrationConnection): Promise<{ valid: boolean; error?: string }> {
      try {
        const baseUrl = getBaseUrl(connection);
        const headers = getAuthHeaders(connection);
        await getProviderRateLimiter('teamwork').acquire(connection.id);
        await axios.get(`${baseUrl}/me.json`, { headers, timeout: TIMEOUT_MS });
        return { valid: true };
      } catch (err) {
        const adapterErr = classifyAdapterError(err, 'teamwork', 'validateCredentials');
        return { valid: false, error: adapterErr.message };
      }
    },

    async listInboxes(connection: IntegrationConnection): Promise<CanonicalInboxData[]> {
      await getProviderRateLimiter('teamwork').acquire(connection.id);
      const baseUrl = getBaseUrl(connection);
      const headers = getAuthHeaders(connection);

      const data = await withBackoff(
        async () => {
          const response = await axios.get(`${baseUrl}/inboxes.json`, {
            headers,
            timeout: TIMEOUT_MS,
          });
          return response.data as { inboxes?: Array<Record<string, unknown>> };
        },
        {
          label: 'teamwork.listInboxes',
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 8000,
          isRetryable: (err: unknown) => {
            const e = err as { response?: { status?: number }; code?: string };
            const status = e.response?.status;
            return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ||
              status === 429 || (status !== undefined && status >= 500);
          },
          correlationId: connection.id,
          runId: connection.id,
        },
      );

      const inboxes = data.inboxes ?? [];
      return inboxes.map((inbox) => ({
        externalId: String(inbox.id),
        name: (inbox.name as string) ?? '',
        emailAddress: inbox.emailAddress as string | undefined,
        isActive: inbox.status !== 'inactive',
        externalMetadata: inbox,
      }));
    },

    async listSupportAgents(connection: IntegrationConnection): Promise<CanonicalSupportAgentData[]> {
      await getProviderRateLimiter('teamwork').acquire(connection.id);
      const baseUrl = getBaseUrl(connection);
      const headers = getAuthHeaders(connection);

      const data = await withBackoff(
        async () => {
          const response = await axios.get(`${baseUrl}/agents.json`, {
            headers,
            timeout: TIMEOUT_MS,
          });
          return response.data as { agents?: Array<Record<string, unknown>> };
        },
        {
          label: 'teamwork.listSupportAgents',
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 8000,
          isRetryable: (err: unknown) => {
            const e = err as { response?: { status?: number }; code?: string };
            const status = e.response?.status;
            return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ||
              status === 429 || (status !== undefined && status >= 500);
          },
          correlationId: connection.id,
          runId: connection.id,
        },
      );

      const agents = data.agents ?? [];
      return agents.map((agent) => ({
        externalId: String(agent.id),
        displayName: (agent.name as string) ?? (agent.firstName as string ?? '') + ' ' + (agent.lastName as string ?? ''),
        email: agent.email as string | undefined,
        agentKind: agent.type === 'bot' ? 'bot' : 'human',
        isActive: agent.status !== 'inactive',
        externalMetadata: agent,
      }));
    },

    async fetchTickets(
      connection: IntegrationConnection,
      inboxExternalId: string,
      opts?: FetchOptions,
    ): Promise<FetchSupportResult<CanonicalTicketData>> {
      const baseUrl = getBaseUrl(connection);
      const headers = getAuthHeaders(connection);
      const pageSize = 50;
      let page = 1;
      let pagesCompleted = 0;
      let partial = false;
      let rateLimited = false;
      let lastError: AdapterError | undefined;
      const rows: CanonicalTicketData[] = [];

      while (true) {
        try {
          await getProviderRateLimiter('teamwork').acquire(connection.id);

          const params: Record<string, unknown> = {
            inboxId: inboxExternalId,
            page,
            pageSize,
          };
          if (opts?.since) params.updatedAfter = opts.since.toISOString();

          const data = await withBackoff(
            async () => {
              const response = await axios.get(`${baseUrl}/tickets.json`, {
                headers,
                params,
                timeout: TIMEOUT_MS,
              });
              return response.data as { tickets?: Array<Record<string, unknown>>; meta?: { totalPages?: number; page?: number } };
            },
            {
              label: 'teamwork.fetchTickets',
              maxAttempts: 3,
              baseDelayMs: 500,
              maxDelayMs: 8000,
              isRetryable: (err: unknown) => {
                const e = err as { response?: { status?: number }; code?: string };
                const status = e.response?.status;
                // Do not retry 429 — surface as rateLimited
                return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ||
                  (status !== undefined && status >= 500);
              },
              correlationId: connection.id,
              runId: connection.id,
            },
          );

          const tickets = data.tickets ?? [];
          for (const t of tickets) {
            const customer = t.customer as Record<string, unknown> | undefined;
            rows.push({
              externalId: String(t.id),
              inboxExternalId: t.inboxId ? String(t.inboxId) : inboxExternalId,
              customerEmail: customer?.email as string | undefined,
              customerName: customer?.name as string | undefined,
              customerExternalId: customer?.id ? String(customer.id) : undefined,
              subject: (t.subject as string) ?? '',
              status: mapTeamworkStatus(t.status as string | undefined),
              priority: mapTicketPriority(t.priority as string),
              assigneeAgentExternalId: t.assignedTo ? String(t.assignedTo) : undefined,
              tags: t.tags as string[] | undefined,
              category: t.category as string | undefined,
              sourceChannel: mapSourceChannel(t.source as string | undefined),
              openedAt: t.createdAt ? new Date(t.createdAt as string) : new Date(),
              firstResponseAt: t.firstResponseAt ? new Date(t.firstResponseAt as string) : undefined,
              lastCustomerMessageAt: t.lastCustomerReplyAt ? new Date(t.lastCustomerReplyAt as string) : undefined,
              lastAgentMessageAt: t.lastAgentReplyAt ? new Date(t.lastAgentReplyAt as string) : undefined,
              closedAt: t.closedAt ? new Date(t.closedAt as string) : undefined,
              resolutionAt: t.resolvedAt ? new Date(t.resolvedAt as string) : undefined,
              slaDueAt: t.slaDueAt ? new Date(t.slaDueAt as string) : undefined,
              slaBreached: t.slaBreached as boolean | undefined,
              slaPolicyExternalId: t.slaPolicyId ? String(t.slaPolicyId) : undefined,
              externalMetadata: t,
            });
          }

          pagesCompleted++;

          const totalPages = (data.meta?.totalPages as number | undefined) ?? 1;
          const hasMore = tickets.length === pageSize && page < totalPages;
          if (!hasMore) break;

          page++;
        } catch (err) {
          const classified = classifyAdapterError(err, 'teamwork', 'fetchTickets');
          lastError = classified;
          partial = true;
          if (classified.code === 'rate_limited') rateLimited = true;
          break;
        }
      }

      return {
        rows,
        partial,
        ...(lastError && { error: lastError }),
        pagesCompleted,
        ...(rateLimited && { rateLimited }),
      };
    },

    async fetchTicketMessages(
      connection: IntegrationConnection,
      ticketExternalId: string,
      opts?: FetchOptions,
    ): Promise<FetchSupportResult<CanonicalTicketMessageData>> {
      const baseUrl = getBaseUrl(connection);
      const headers = getAuthHeaders(connection);
      const pageSize = 50;
      let page = 1;
      let pagesCompleted = 0;
      let partial = false;
      let rateLimited = false;
      let lastError: AdapterError | undefined;
      const rows: CanonicalTicketMessageData[] = [];

      while (true) {
        try {
          await getProviderRateLimiter('teamwork').acquire(connection.id);

          const params: Record<string, unknown> = {
            page,
            pageSize,
          };
          if (opts?.since) params.updatedAfter = opts.since.toISOString();

          // TODO: verify exact endpoint — Teamwork Desk uses /conversations/{id}/messages or /tickets/{id}/threads
          const data = await withBackoff(
            async () => {
              const response = await axios.get(
                `${baseUrl}/tickets/${ticketExternalId}/threads.json`,
                {
                  headers,
                  params,
                  timeout: TIMEOUT_MS,
                },
              );
              return response.data as { threads?: Array<Record<string, unknown>>; meta?: { totalPages?: number } };
            },
            {
              label: 'teamwork.fetchTicketMessages',
              maxAttempts: 3,
              baseDelayMs: 500,
              maxDelayMs: 8000,
              isRetryable: (err: unknown) => {
                const e = err as { response?: { status?: number }; code?: string };
                const status = e.response?.status;
                return e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ||
                  (status !== undefined && status >= 500);
              },
              correlationId: connection.id,
              runId: connection.id,
            },
          );

          const threads = data.threads ?? [];
          for (const m of threads) {
            const messageType = (m.type as string | undefined)?.toLowerCase() ?? '';
            const direction = mapMessageDirection(messageType);
            const visibility = messageType === 'note' ? 'internal' : 'public';
            const authorType = mapAuthorType(m.author as Record<string, unknown> | undefined, messageType);
            const author = m.author as Record<string, unknown> | undefined;
            const attachments = (m.attachments as Array<Record<string, unknown>> | undefined)?.map((a) => ({
              externalId: String(a.id),
              filename: (a.filename as string) ?? (a.name as string) ?? '',
              providerUrl: (a.downloadUrl as string) ?? (a.url as string) ?? '',
              mimeType: a.mimeType as string | undefined,
              size: a.size as number | undefined,
            }));

            rows.push({
              externalId: String(m.id),
              ticketExternalId,
              direction,
              visibility,
              authorType,
              authorExternalId: author?.id ? String(author.id) : undefined,
              bodyText: (m.body as string) ?? '',
              bodyHtml: m.bodyHtml as string | undefined,
              ...(attachments && attachments.length > 0 && { attachments }),
              createdAtExternal: m.createdAt ? new Date(m.createdAt as string) : new Date(),
              externalMetadata: m,
            });
          }

          pagesCompleted++;

          const totalPages = (data.meta?.totalPages as number | undefined) ?? 1;
          const hasMore = threads.length === pageSize && page < totalPages;
          if (!hasMore) break;

          page++;
        } catch (err) {
          const classified = classifyAdapterError(err, 'teamwork', 'fetchTicketMessages');
          lastError = classified;
          partial = true;
          if (classified.code === 'rate_limited') rateLimited = true;
          break;
        }
      }

      return {
        rows,
        partial,
        ...(lastError && { error: lastError }),
        pagesCompleted,
        ...(rateLimited && { rateLimited }),
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

      // Use eventId from payload for deduplication, fall back to deterministic key
      const sourceTs = ticket?.createdAt ? String(ticket.createdAt) : ticket?.updatedAt ? String(ticket.updatedAt) : '';
      const externalEventId = event.eventId
        ? String(event.eventId)
        : `${eventType}:${ticketId}:${sourceTs}`;

      return {
        eventType: mapping.normalisedType,
        accountExternalId: inboxId,
        entityType: mapping.entityType,
        entityExternalId: ticketId,
        externalEventId,
        data: event,
        timestamp: new Date(),
        sourceTimestamp: ticket?.createdAt ? new Date(ticket.createdAt as string) : undefined,
      };
    },
  },
};
