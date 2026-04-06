import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

// ---------------------------------------------------------------------------
// Adapter error classification — enables retry logic and observability
// ---------------------------------------------------------------------------

export interface AdapterError {
  code: 'rate_limited' | 'auth_error' | 'not_found' | 'validation_error' | 'timeout' | 'provider_error' | 'unknown';
  retryable: boolean;
  message: string;
}

/** Classify an HTTP error into a structured AdapterError */
export function classifyAdapterError(err: unknown, provider: string, action: string): AdapterError {
  const axiosErr = err as { response?: { status?: number; data?: unknown }; code?: string; message?: string };
  const status = axiosErr.response?.status;
  const message = axiosErr.message ?? String(err);

  if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
    return { code: 'timeout', retryable: true, message: `${provider} ${action} timed out: ${message}` };
  }

  if (status === 429) {
    return { code: 'rate_limited', retryable: true, message: `${provider} ${action} rate limited` };
  }
  if (status === 401 || status === 403) {
    return { code: 'auth_error', retryable: false, message: `${provider} ${action} auth failed: ${message}` };
  }
  if (status === 404) {
    return { code: 'not_found', retryable: false, message: `${provider} ${action} not found: ${message}` };
  }
  if (status === 400 || status === 422) {
    return { code: 'validation_error', retryable: false, message: `${provider} ${action} validation error: ${message}` };
  }
  if (status && status >= 500) {
    return { code: 'provider_error', retryable: true, message: `${provider} ${action} server error (${status}): ${message}` };
  }

  return { code: 'unknown', retryable: false, message: `${provider} ${action} failed: ${message}` };
}

// ---------------------------------------------------------------------------
// Typed action inputs — CRM
// ---------------------------------------------------------------------------

export interface CrmCreateContactInput {
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  pipelineStage?: { pipelineId: string; stageId: string };
}

// ---------------------------------------------------------------------------
// Outbound action result types — CRM
// ---------------------------------------------------------------------------

export interface CrmCreateContactResult {
  contactId: string;
  success: boolean;
  error?: AdapterError;
}

// ---------------------------------------------------------------------------
// Typed action inputs — Payments
// ---------------------------------------------------------------------------

export interface PaymentsCreateCheckoutInput {
  amount: number;
  currency?: string;
  productName?: string;
  successUrl: string;
  cancelUrl: string;
}

// ---------------------------------------------------------------------------
// Outbound action result types — Payments
// ---------------------------------------------------------------------------

export interface PaymentsCreateCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
  success: boolean;
  error?: AdapterError;
}

export interface PaymentsGetStatusResult {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  success: boolean;
  error?: AdapterError;
}

// ---------------------------------------------------------------------------
// Typed action inputs — Ticketing
// ---------------------------------------------------------------------------

export interface TicketCreateInput {
  subject: string;
  previewText?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  inboxId?: string;
  customerEmail?: string;
  tags?: string[];
}

export interface TicketUpdateInput {
  subject?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Outbound action result types — Ticketing
// ---------------------------------------------------------------------------

export interface TicketCreateResult {
  ticketId: string;
  success: boolean;
  error?: AdapterError;
}

export interface TicketUpdateResult {
  success: boolean;
  error?: AdapterError;
}

export interface TicketReplyResult {
  replyId: string;
  success: boolean;
  error?: AdapterError;
}

export interface TicketData {
  externalId: string;
  subject: string;
  status: 'active' | 'waiting' | 'closed' | 'resolved';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;
  customerEmail?: string;
  customerName?: string;
  tags?: string[];
  inboxId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Typed action inputs — Messaging
// ---------------------------------------------------------------------------

export interface MessageSendOptions {
  blocks?: unknown[];
  threadTs?: string;
  unfurlLinks?: boolean;
}

// ---------------------------------------------------------------------------
// Outbound action result types — Messaging
// ---------------------------------------------------------------------------

export interface MessageSendResult {
  messageId: string;
  success: boolean;
  error?: AdapterError;
}

export interface MessageChannelData {
  externalId: string;
  name: string;
  type: 'channel' | 'dm' | 'group';
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Canonical entity types (used by ingestion interface)
// ---------------------------------------------------------------------------

export interface CanonicalAccountData {
  externalId: string;
  displayName: string;
  status: 'active' | 'inactive' | 'suspended';
  externalMetadata?: Record<string, unknown>;
}

export interface CanonicalContactData {
  externalId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  externalCreatedAt?: Date;
}

export interface CanonicalOpportunityData {
  externalId: string;
  name?: string;
  stage?: string;
  value?: number;
  currency?: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  stageEnteredAt?: Date;
  stageHistory?: Array<{ stage: string; enteredAt: string; exitedAt?: string }>;
  externalCreatedAt?: Date;
}

export interface CanonicalConversationData {
  externalId: string;
  channel: 'sms' | 'email' | 'chat' | 'phone' | 'other';
  status: 'active' | 'inactive' | 'closed';
  messageCount: number;
  lastMessageAt?: Date;
  lastResponseTimeSeconds?: number;
  externalCreatedAt?: Date;
}

export interface CanonicalRevenueData {
  externalId: string;
  amount: number;
  currency?: string;
  type: 'one_time' | 'recurring' | 'refund';
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  transactionDate?: Date;
}

// ---------------------------------------------------------------------------
// Canonical Metric Data — returned by adapter computeMetrics()
// ---------------------------------------------------------------------------

export interface CanonicalMetricData {
  metricSlug: string;
  currentValue: number;
  previousValue?: number;
  periodStart?: Date;
  periodEnd?: Date;
  periodType: string;       // "rolling_7d", "rolling_30d", "daily"
  aggregationType: string;  // "rate", "ratio", "count", "avg", "sum"
  unit?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Normalised webhook event
// ---------------------------------------------------------------------------

export interface NormalisedEvent {
  eventType: string;
  accountExternalId: string;
  entityType: 'contact' | 'opportunity' | 'conversation' | 'revenue' | 'account' | 'ticket' | 'message';
  entityExternalId: string;
  /** Provider-specific unique event ID for idempotency / deduplication */
  externalEventId?: string;
  data: Record<string, unknown>;
  timestamp: Date;
  sourceTimestamp?: Date;
}

// ---------------------------------------------------------------------------
// Ingestion fetch options
// ---------------------------------------------------------------------------

export interface FetchOptions {
  /** Only fetch records created/updated after this date */
  since?: Date;
  /** Maximum number of records to return */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Integration Adapter — the contract every connector must implement.
//
// Each capability group is optional. An adapter implements only the groups
// relevant to its integration type:
//   - GHL:           crm + ingestion + webhook
//   - Stripe:        payments
//   - Teamwork Desk: ticketing + webhook
//   - Slack:         messaging + webhook
// ---------------------------------------------------------------------------

export interface IntegrationAdapter {
  supportedActions: string[];

  /** Outbound CRM actions (e.g. GHL, HubSpot) */
  crm?: {
    createContact(connection: IntegrationConnection, fields: CrmCreateContactInput): Promise<CrmCreateContactResult>;
  };

  /** Outbound payment actions (e.g. Stripe) */
  payments?: {
    createCheckout(connection: IntegrationConnection, fields: PaymentsCreateCheckoutInput): Promise<PaymentsCreateCheckoutResult>;
    getPaymentStatus(connection: IntegrationConnection, sessionId: string): Promise<PaymentsGetStatusResult>;
  };

  /** Outbound ticketing actions (e.g. Teamwork Desk, Zendesk, Freshdesk) */
  ticketing?: {
    createTicket(connection: IntegrationConnection, fields: TicketCreateInput): Promise<TicketCreateResult>;
    updateTicket(connection: IntegrationConnection, ticketId: string, fields: TicketUpdateInput): Promise<TicketUpdateResult>;
    addReply(connection: IntegrationConnection, ticketId: string, body: string, options?: { status?: string }): Promise<TicketReplyResult>;
    getTicket(connection: IntegrationConnection, ticketId: string): Promise<TicketData>;
  };

  /** Outbound messaging actions (e.g. Slack) */
  messaging?: {
    sendMessage(connection: IntegrationConnection, channelId: string, text: string, options?: MessageSendOptions): Promise<MessageSendResult>;
    listChannels(connection: IntegrationConnection): Promise<MessageChannelData[]>;
  };

  /** Inbound data ingestion — fetch normalised entities from external platform */
  ingestion?: {
    listAccounts(connection: IntegrationConnection, config: Record<string, unknown>): Promise<CanonicalAccountData[]>;
    fetchContacts(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalContactData[]>;
    fetchOpportunities(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalOpportunityData[]>;
    fetchConversations(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalConversationData[]>;
    fetchRevenue(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalRevenueData[]>;
    validateCredentials(connection: IntegrationConnection): Promise<{ valid: boolean; error?: string }>;
    /** Compute derived metrics from raw entities. Called after entity sync. */
    computeMetrics?(
      connection: IntegrationConnection,
      accountExternalId: string,
      entityCounts: { contacts: number; opportunities: number; conversations: number; revenue: number }
    ): Promise<CanonicalMetricData[]>;
  };

  /** Webhook handling — verify and normalise inbound webhook events */
  webhook?: {
    verifySignature(payload: Buffer, signature: string, secret: string): boolean;
    normaliseEvent(rawEvent: unknown): NormalisedEvent | null;
  };
}
