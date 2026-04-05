import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

// ---------------------------------------------------------------------------
// Outbound action result types — CRM
// ---------------------------------------------------------------------------

export interface CrmCreateContactResult {
  contactId: string;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Outbound action result types — Payments
// ---------------------------------------------------------------------------

export interface PaymentsCreateCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface PaymentsGetStatusResult {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Outbound action result types — Ticketing
// ---------------------------------------------------------------------------

export interface TicketCreateResult {
  ticketId: string;
  success: boolean;
  error?: string;
}

export interface TicketUpdateResult {
  success: boolean;
  error?: string;
}

export interface TicketReplyResult {
  replyId: string;
  success: boolean;
  error?: string;
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
// Outbound action result types — Messaging
// ---------------------------------------------------------------------------

export interface MessageSendResult {
  messageId: string;
  success: boolean;
  error?: string;
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
// Normalised webhook event
// ---------------------------------------------------------------------------

export interface NormalisedEvent {
  eventType: string;
  accountExternalId: string;
  entityType: 'contact' | 'opportunity' | 'conversation' | 'revenue' | 'account' | 'ticket' | 'message';
  entityExternalId: string;
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
    createContact(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<CrmCreateContactResult>;
  };

  /** Outbound payment actions (e.g. Stripe) */
  payments?: {
    createCheckout(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<PaymentsCreateCheckoutResult>;
    getPaymentStatus(connection: IntegrationConnection, sessionId: string): Promise<PaymentsGetStatusResult>;
  };

  /** Outbound ticketing actions (e.g. Teamwork Desk, Zendesk, Freshdesk) */
  ticketing?: {
    createTicket(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<TicketCreateResult>;
    updateTicket(connection: IntegrationConnection, ticketId: string, fields: Record<string, unknown>): Promise<TicketUpdateResult>;
    addReply(connection: IntegrationConnection, ticketId: string, body: string, options?: { status?: string }): Promise<TicketReplyResult>;
    getTicket(connection: IntegrationConnection, ticketId: string): Promise<TicketData>;
  };

  /** Outbound messaging actions (e.g. Slack) */
  messaging?: {
    sendMessage(connection: IntegrationConnection, channelId: string, text: string, options?: Record<string, unknown>): Promise<MessageSendResult>;
    listChannels(connection: IntegrationConnection): Promise<MessageChannelData[]>;
  };

  /** Inbound data ingestion — fetch normalised entities from external platform (e.g. GHL) */
  ingestion?: {
    listAccounts(connection: IntegrationConnection, config: Record<string, unknown>): Promise<CanonicalAccountData[]>;
    fetchContacts(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalContactData[]>;
    fetchOpportunities(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalOpportunityData[]>;
    fetchConversations(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalConversationData[]>;
    fetchRevenue(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalRevenueData[]>;
    validateCredentials(connection: IntegrationConnection): Promise<{ valid: boolean; error?: string }>;
  };

  /** Webhook handling — verify and normalise inbound webhook events */
  webhook?: {
    verifySignature(payload: Buffer, signature: string, secret: string): boolean;
    normaliseEvent(rawEvent: unknown): NormalisedEvent | null;
  };
}
