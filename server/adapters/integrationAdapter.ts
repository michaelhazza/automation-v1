import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

// ---------------------------------------------------------------------------
// Outbound action result types (existing)
// ---------------------------------------------------------------------------

export interface CrmCreateContactResult {
  contactId: string;
  success: boolean;
  error?: string;
}

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
  entityType: 'contact' | 'opportunity' | 'conversation' | 'revenue' | 'account';
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
// Integration Adapter — the contract every connector must implement
// ---------------------------------------------------------------------------

export interface IntegrationAdapter {
  supportedActions: string[];

  /** Outbound CRM actions */
  crm?: {
    createContact(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<CrmCreateContactResult>;
  };

  /** Outbound payment actions */
  payments?: {
    createCheckout(connection: IntegrationConnection, fields: Record<string, unknown>): Promise<PaymentsCreateCheckoutResult>;
    getPaymentStatus(connection: IntegrationConnection, sessionId: string): Promise<PaymentsGetStatusResult>;
  };

  /** Inbound data ingestion — fetch normalised entities from external platform */
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
