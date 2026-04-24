import axios from 'axios';
import crypto from 'crypto';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { getProviderRateLimiter } from '../lib/rateLimiter.js';
import type {
  IntegrationAdapter,
  CrmCreateContactInput,
  CanonicalAccountData,
  CanonicalContactData,
  CanonicalOpportunityData,
  CanonicalConversationData,
  CanonicalRevenueData,
  CanonicalMetricData,
  NormalisedEvent,
  FetchOptions,
} from './integrationAdapter.js';
import { classifyAdapterError } from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/index.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const TIMEOUT_MS = 12_000;
const GHL_API_VERSION = '2021-07-28';

/** Helper to get auth headers for GHL API calls */
function getHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    'Content-Type': 'application/json',
  };
}

/** Decrypt access token from connection */
function decryptAccessToken(connection: IntegrationConnection): string {
  if (!connection.accessToken) throw new Error('Connection has no access token');
  return connectionTokenService.decryptToken(connection.accessToken);
}

/**
 * Acquire a rate-limit token from the GHL provider limiter before making any
 * HTTP call. Ship-gate B1 (§23.1, §26.1) — the RateLimiter infra has existed
 * at server/lib/rateLimiter.ts since before ClientPulse; Phase 1 wires it in.
 *
 * Keyed per-location so one noisy sub-account doesn't starve another. Callers
 * that don't have a location yet (e.g. agency-level `listAccounts`) pass the
 * string 'global' to share the agency-wide bucket.
 */
async function acquireGhlToken(locationKey: string): Promise<void> {
  await getProviderRateLimiter('ghl').acquire(locationKey || 'global');
}

export const ghlAdapter: IntegrationAdapter = {
  supportedActions: ['create_contact', 'tag_contact', 'create_opportunity'],

  // ── Outbound CRM actions (existing) ──────────────────────────────────────
  crm: {
    async createContact(connection: IntegrationConnection, fields: CrmCreateContactInput) {
      try {
        const accessToken = decryptAccessToken(connection);
        const config = connection.configJson as Record<string, unknown> | null;
        const locationId = config?.locationId as string | undefined;

        if (!locationId) {
          return { contactId: '', success: false, error: { code: 'validation_error' as const, retryable: false, message: 'No locationId in connection config' } };
        }

        const name = fields.name;
        let firstName: string | undefined;
        let lastName: string | undefined;
        if (name) {
          const parts = name.trim().split(/\s+/);
          firstName = parts[0];
          lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
        }

        const body: Record<string, unknown> = { locationId };
        if (firstName) body.firstName = firstName;
        if (lastName) body.lastName = lastName;
        if (fields.email) body.email = fields.email;
        if (fields.phone) body.phone = fields.phone;
        if (fields.tags) body.tags = fields.tags;

        if (fields.pipelineStage) {
          const stage = fields.pipelineStage as { pipelineId?: string; stageId?: string };
          if (stage.pipelineId && stage.stageId) {
            body.pipelineStage = stage;
          }
        }

        await acquireGhlToken(locationId);
        const response = await axios.post(`${GHL_API_BASE}/contacts/`, body, {
          headers: getHeaders(accessToken),
          timeout: TIMEOUT_MS,
        });

        const contactId = (response.data as { contact?: { id?: string } })?.contact?.id ?? '';
        return { contactId, success: true };
      } catch (err) {
        return { contactId: '', success: false, error: classifyAdapterError(err, 'ghl', 'createContact') };
      }
    },
  },

  // ── Inbound data ingestion ───────────────────────────────────────────────
  ingestion: {
    async listAccounts(connection: IntegrationConnection, config: Record<string, unknown>): Promise<CanonicalAccountData[]> {
      const accessToken = decryptAccessToken(connection);

      // GHL agency-level: list locations (sub-accounts)
      // The companyId comes from the connector config
      const companyId = config.companyId as string | undefined;
      if (!companyId) throw new Error('companyId required in connector config to list GHL locations');

      await acquireGhlToken('global');
      const response = await axios.get(`${GHL_API_BASE}/locations/search`, {
        headers: getHeaders(accessToken),
        params: { companyId, limit: 100 },
        timeout: TIMEOUT_MS,
      });

      const locations = (response.data as { locations?: Array<Record<string, unknown>> })?.locations ?? [];
      return locations.map((loc) => ({
        externalId: loc.id as string,
        displayName: (loc.name as string) || (loc.id as string),
        status: 'active' as const,
        externalMetadata: loc,
      }));
    },

    async fetchContacts(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalContactData[]> {
      const accessToken = decryptAccessToken(connection);
      const params: Record<string, unknown> = { locationId: accountExternalId, limit: opts?.limit ?? 100 };
      if (opts?.since) params.startAfter = opts.since.toISOString();

      await acquireGhlToken(accountExternalId);
      const response = await axios.get(`${GHL_API_BASE}/contacts/`, {
        headers: getHeaders(accessToken),
        params,
        timeout: TIMEOUT_MS,
      });

      const contacts = (response.data as { contacts?: Array<Record<string, unknown>> })?.contacts ?? [];
      return contacts.map((c) => ({
        externalId: c.id as string,
        firstName: c.firstName as string | undefined,
        lastName: c.lastName as string | undefined,
        email: c.email as string | undefined,
        phone: c.phone as string | undefined,
        tags: c.tags as string[] | undefined,
        source: c.source as string | undefined,
        externalCreatedAt: c.dateAdded ? new Date(c.dateAdded as string) : undefined,
      }));
    },

    async fetchOpportunities(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalOpportunityData[]> {
      const accessToken = decryptAccessToken(connection);
      const params: Record<string, unknown> = { location_id: accountExternalId, limit: opts?.limit ?? 100 };

      await acquireGhlToken(accountExternalId);
      const response = await axios.get(`${GHL_API_BASE}/opportunities/search`, {
        headers: getHeaders(accessToken),
        params,
        timeout: TIMEOUT_MS,
      });

      const opportunities = (response.data as { opportunities?: Array<Record<string, unknown>> })?.opportunities ?? [];
      return opportunities.map((o) => ({
        externalId: o.id as string,
        name: o.name as string | undefined,
        stage: (o.pipelineStageId as string) ?? (o.status as string),
        value: o.monetaryValue ? Number(o.monetaryValue) : undefined,
        currency: 'USD',
        status: mapGhlOpportunityStatus(o.status as string),
        stageEnteredAt: o.lastStageChangeAt ? new Date(o.lastStageChangeAt as string) : undefined,
        externalCreatedAt: o.createdAt ? new Date(o.createdAt as string) : undefined,
      }));
    },

    async fetchConversations(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalConversationData[]> {
      const accessToken = decryptAccessToken(connection);
      const params: Record<string, unknown> = { locationId: accountExternalId, limit: opts?.limit ?? 100 };

      await acquireGhlToken(accountExternalId);
      const response = await axios.get(`${GHL_API_BASE}/conversations/search`, {
        headers: getHeaders(accessToken),
        params,
        timeout: TIMEOUT_MS,
      });

      const conversations = (response.data as { conversations?: Array<Record<string, unknown>> })?.conversations ?? [];
      return conversations.map((c) => ({
        externalId: c.id as string,
        channel: mapGhlChannel(c.type as string),
        status: (c.status === 'closed' ? 'closed' : 'active') as 'active' | 'inactive' | 'closed',
        messageCount: (c.messageCount as number) ?? 0,
        lastMessageAt: c.lastMessageDate ? new Date(c.lastMessageDate as string) : undefined,
        externalCreatedAt: c.dateAdded ? new Date(c.dateAdded as string) : undefined,
      }));
    },

    async fetchRevenue(connection: IntegrationConnection, accountExternalId: string, opts?: FetchOptions): Promise<CanonicalRevenueData[]> {
      const accessToken = decryptAccessToken(connection);
      const params: Record<string, unknown> = { altId: accountExternalId, altType: 'location', limit: opts?.limit ?? 100 };

      try {
        await acquireGhlToken(accountExternalId);
        const response = await axios.get(`${GHL_API_BASE}/payments/orders`, {
          headers: getHeaders(accessToken),
          params,
          timeout: TIMEOUT_MS,
        });

        const orders = (response.data as { data?: Array<Record<string, unknown>> })?.data ?? [];
        return orders.map((o) => ({
          externalId: o._id as string,
          amount: Number(o.amount ?? 0) / 100, // GHL stores in cents
          currency: (o.currency as string) ?? 'USD',
          type: 'one_time' as const,
          status: mapGhlPaymentStatus(o.status as string),
          transactionDate: o.createdAt ? new Date(o.createdAt as string) : undefined,
        }));
      } catch {
        // Revenue endpoint may not be available for all GHL plans
        return [];
      }
    },

    async validateCredentials(connection: IntegrationConnection): Promise<{ valid: boolean; error?: string }> {
      try {
        const accessToken = decryptAccessToken(connection);
        await acquireGhlToken('global');
        await axios.get(`${GHL_API_BASE}/locations/search`, {
          headers: getHeaders(accessToken),
          params: { limit: 1 },
          timeout: TIMEOUT_MS,
        });
        return { valid: true };
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async computeMetrics(
      _connection: IntegrationConnection,
      _accountExternalId: string,
      entityCounts: { contacts: number; opportunities: number; conversations: number; revenue: number }
    ): Promise<CanonicalMetricData[]> {
      return computeGhlMetrics(entityCounts);
    },
  },

  // ── Webhook handling ─────────────────────────────────────────────────────
  webhook: {
    verifySignature(payload: Buffer, signature: string, secret: string): boolean {
      const computed = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
      } catch {
        return false;
      }
    },

    normaliseEvent(rawEvent: unknown): NormalisedEvent | null {
      const event = rawEvent as Record<string, unknown>;
      const eventType = event.type as string | undefined;
      const locationId = event.locationId as string | undefined;

      if (!eventType || !locationId) return null;

      // Map GHL event types to our normalised entity types
      const mapping = mapGhlEventType(eventType);
      if (!mapping) return null;

      // Location-scoped events (INSTALL/UNINSTALL/LocationCreate/LocationUpdate)
      // use locationId as their entity id — there is no separate entity record.
      const entityExternalId = mapping.entityType === 'account'
        ? locationId
        : (event.id as string) ?? (event.contactId as string) ?? '';
      const sourceTs = event.dateAdded ? String(event.dateAdded) : event.dateUpdated ? String(event.dateUpdated) : '';
      const externalEventId = event.traceId
        ? String(event.traceId)
        : `${eventType}:${entityExternalId}:${sourceTs}`;

      return {
        eventType: mapping.normalisedType,
        accountExternalId: locationId,
        entityType: mapping.entityType,
        entityExternalId,
        externalEventId,
        data: event,
        timestamp: new Date(),
        sourceTimestamp: event.dateAdded ? new Date(event.dateAdded as string) : undefined,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// GHL field mappers
// ---------------------------------------------------------------------------

function mapGhlOpportunityStatus(status: string): 'open' | 'won' | 'lost' | 'abandoned' {
  switch (status?.toLowerCase()) {
    case 'won': return 'won';
    case 'lost': return 'lost';
    case 'abandoned': return 'abandoned';
    default: return 'open';
  }
}

function mapGhlChannel(type: string): 'sms' | 'email' | 'chat' | 'phone' | 'other' {
  switch (type?.toLowerCase()) {
    case 'sms': case 'phone': return 'sms';
    case 'email': return 'email';
    case 'live_chat': case 'fb': case 'ig': case 'whatsapp': return 'chat';
    case 'call': return 'phone';
    default: return 'other';
  }
}

function mapGhlPaymentStatus(status: string): 'pending' | 'completed' | 'failed' | 'refunded' {
  switch (status?.toLowerCase()) {
    case 'paid': case 'completed': return 'completed';
    case 'refunded': return 'refunded';
    case 'failed': return 'failed';
    default: return 'pending';
  }
}

function mapGhlEventType(eventType: string): { normalisedType: string; entityType: NormalisedEvent['entityType'] } | null {
  switch (eventType) {
    case 'ContactCreate': case 'ContactUpdate':
      return { normalisedType: eventType, entityType: 'contact' };
    case 'OpportunityCreate': case 'OpportunityStageUpdate': case 'OpportunityStatusUpdate':
      return { normalisedType: eventType, entityType: 'opportunity' };
    case 'ConversationCreated': case 'ConversationInactive': case 'ConversationUpdated':
      return { normalisedType: eventType, entityType: 'conversation' };
    case 'InvoiceCreated': case 'PaymentReceived':
      return { normalisedType: eventType, entityType: 'revenue' };
    // Location-lifecycle events (§2.0b Phase 1 follow-up). We don't upsert a
    // canonical row for these — they're recorded as canonical_subaccount_mutations
    // only — so entityType='account' routes them past the upsert switch but
    // still flows through the mutation writer.
    case 'INSTALL': case 'UNINSTALL': case 'LocationCreate': case 'LocationUpdate':
      return { normalisedType: eventType, entityType: 'account' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GHL Metric Definitions — self-registered on adapter initialization
// ---------------------------------------------------------------------------

export const GHL_METRIC_DEFINITIONS = [
  { metricSlug: 'contact_growth_rate', connectorType: 'ghl', label: 'Contact Growth Rate', unit: 'percent', valueType: 'ratio', defaultPeriodType: 'rolling_30d', defaultAggregationType: 'rate' },
  { metricSlug: 'pipeline_velocity', connectorType: 'ghl', label: 'Pipeline Velocity', unit: 'percent', valueType: 'ratio', defaultPeriodType: 'rolling_30d', defaultAggregationType: 'ratio' },
  { metricSlug: 'stale_deal_ratio', connectorType: 'ghl', label: 'Stale Deal Ratio', unit: 'percent', valueType: 'ratio', defaultPeriodType: 'rolling_30d', defaultAggregationType: 'ratio' },
  { metricSlug: 'conversation_engagement', connectorType: 'ghl', label: 'Conversation Engagement', unit: 'percent', valueType: 'ratio', defaultPeriodType: 'rolling_30d', defaultAggregationType: 'ratio' },
  { metricSlug: 'avg_response_time', connectorType: 'ghl', label: 'Avg Response Time', unit: 'seconds', valueType: 'duration', defaultPeriodType: 'rolling_30d', defaultAggregationType: 'avg' },
  { metricSlug: 'revenue_trend', connectorType: 'ghl', label: 'Revenue Trend', unit: 'percent', valueType: 'ratio', defaultPeriodType: 'rolling_30d', defaultAggregationType: 'rate' },
  { metricSlug: 'platform_activity', connectorType: 'ghl', label: 'Platform Activity', unit: 'score', valueType: 'score', defaultPeriodType: 'rolling_7d', defaultAggregationType: 'avg' },
] as const;

// ---------------------------------------------------------------------------
// Compute derived metrics from raw entity counts and data
// Called by connectorPollingService after entity sync
// ---------------------------------------------------------------------------

function computeGhlMetrics(entityCounts: {
  contacts: number;
  opportunities: number;
  conversations: number;
  revenue: number;
}): CanonicalMetricData[] {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const metrics: CanonicalMetricData[] = [];

  // Contact growth rate: simplified as count-based (adapter has raw counts, detailed growth computed from canonical_contacts in polling service)
  metrics.push({
    metricSlug: 'contact_growth_rate',
    currentValue: entityCounts.contacts > 0 ? entityCounts.contacts : 0,
    periodType: 'rolling_30d',
    aggregationType: 'rate',
    unit: 'count',
    periodStart: thirtyDaysAgo,
    periodEnd: now,
  });

  // Pipeline velocity: stale deal ratio (stale = >14 days in stage)
  // Note: detailed computation happens in polling service with access to canonical_opportunities
  metrics.push({
    metricSlug: 'pipeline_velocity',
    currentValue: entityCounts.opportunities > 0 ? entityCounts.opportunities : 0,
    periodType: 'rolling_30d',
    aggregationType: 'ratio',
    unit: 'count',
    periodStart: thirtyDaysAgo,
    periodEnd: now,
  });

  // Conversation engagement
  metrics.push({
    metricSlug: 'conversation_engagement',
    currentValue: entityCounts.conversations > 0 ? entityCounts.conversations : 0,
    periodType: 'rolling_30d',
    aggregationType: 'ratio',
    unit: 'count',
    periodStart: thirtyDaysAgo,
    periodEnd: now,
  });

  // Revenue trend
  metrics.push({
    metricSlug: 'revenue_trend',
    currentValue: entityCounts.revenue > 0 ? entityCounts.revenue : 0,
    periodType: 'rolling_30d',
    aggregationType: 'rate',
    unit: 'count',
    periodStart: thirtyDaysAgo,
    periodEnd: now,
  });

  // Platform activity: based on sync freshness (1.0 = just synced)
  metrics.push({
    metricSlug: 'platform_activity',
    currentValue: 100, // fresh sync = max activity
    periodType: 'rolling_7d',
    aggregationType: 'avg',
    unit: 'score',
    periodStart: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    periodEnd: now,
  });

  return metrics;
}

// ---------------------------------------------------------------------------
// ClientPulse Phase 1 fetch functions — GHL-specific ingestion paths for the
// 6 new signals (§2.2). These return raw shapes the polling service
// normalises into canonical rows. Each HTTP call goes through the GHL rate
// limiter (B1). Endpoints that require scopes beyond the current token's
// grant return `{ availability: 'unavailable_missing_scope' }` so the
// polling service can record an observation without blowing up the cycle.
// ---------------------------------------------------------------------------

export interface GhlFunnel {
  id: string;
  name: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface GhlFunnelPage {
  id: string;
  funnelId: string;
  name: string;
  slug?: string;
  updatedAt?: string;
}

export interface GhlCalendar {
  id: string;
  name: string;
  teamMembers?: Array<{ userId: string }>;
  slug?: string;
  updatedAt?: string;
}

export interface GhlUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  deleted?: boolean;
}

export interface GhlLocationDetails {
  id: string;
  name: string;
  companyId?: string;
  timezone?: string;
  businessInfo?: Record<string, unknown>;
  socialUrls?: Record<string, string>;
  [k: string]: unknown;
}

export interface GhlSubscription {
  planId?: string;
  tier?: string;
  active?: boolean;
  nextBillingDate?: string;
  raw: Record<string, unknown>;
}

export type GhlFetchResult<T> =
  | { availability: 'available'; data: T }
  | { availability: 'unavailable_missing_scope'; data: null; errorCode: string }
  | { availability: 'unavailable_tier_gated'; data: null; errorCode: string }
  | { availability: 'unavailable_other'; data: null; errorCode: string; message: string };

function classifyGhlHttpError(err: unknown): GhlFetchResult<never> {
  const asAny = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
  const status = asAny?.response?.status;
  const message = asAny?.response?.data?.message ?? asAny?.message ?? 'unknown';
  if (status === 401 || status === 403) {
    return { availability: 'unavailable_missing_scope', data: null, errorCode: `http_${status}` };
  }
  if (status === 402 || status === 404) {
    // GHL commonly returns 404 on SaaS endpoints for non-SaaS-mode agencies
    return { availability: 'unavailable_tier_gated', data: null, errorCode: `http_${status}` };
  }
  return { availability: 'unavailable_other', data: null, errorCode: `http_${status ?? 'network'}`, message };
}

export const ghlClientPulseFetchers = {
  async fetchFunnels(connection: IntegrationConnection, locationId: string): Promise<GhlFetchResult<GhlFunnel[]>> {
    try {
      const accessToken = decryptAccessToken(connection);
      await acquireGhlToken(locationId);
      const response = await axios.get(`${GHL_API_BASE}/funnels/funnel`, {
        headers: getHeaders(accessToken),
        params: { locationId },
        timeout: TIMEOUT_MS,
      });
      const funnels = (response.data as { funnels?: GhlFunnel[] })?.funnels ?? [];
      return { availability: 'available', data: funnels };
    } catch (err) {
      return classifyGhlHttpError(err);
    }
  },

  async fetchFunnelPages(connection: IntegrationConnection, locationId: string, funnelId: string): Promise<GhlFetchResult<GhlFunnelPage[]>> {
    try {
      const accessToken = decryptAccessToken(connection);
      await acquireGhlToken(locationId);
      const response = await axios.get(`${GHL_API_BASE}/funnels/funnel/${funnelId}/page`, {
        headers: getHeaders(accessToken),
        timeout: TIMEOUT_MS,
      });
      const pages = (response.data as { pages?: GhlFunnelPage[] })?.pages ?? [];
      return { availability: 'available', data: pages };
    } catch (err) {
      return classifyGhlHttpError(err);
    }
  },

  async fetchCalendars(connection: IntegrationConnection, locationId: string): Promise<GhlFetchResult<GhlCalendar[]>> {
    try {
      const accessToken = decryptAccessToken(connection);
      await acquireGhlToken(locationId);
      const response = await axios.get(`${GHL_API_BASE}/calendars/`, {
        headers: getHeaders(accessToken),
        params: { locationId },
        timeout: TIMEOUT_MS,
      });
      const calendars = (response.data as { calendars?: GhlCalendar[] })?.calendars ?? [];
      return { availability: 'available', data: calendars };
    } catch (err) {
      return classifyGhlHttpError(err);
    }
  },

  async fetchUsers(connection: IntegrationConnection, locationId: string): Promise<GhlFetchResult<GhlUser[]>> {
    try {
      const accessToken = decryptAccessToken(connection);
      await acquireGhlToken(locationId);
      const response = await axios.get(`${GHL_API_BASE}/users/search`, {
        headers: getHeaders(accessToken),
        params: { locationId },
        timeout: TIMEOUT_MS,
      });
      const users = (response.data as { users?: GhlUser[] })?.users ?? [];
      return { availability: 'available', data: users };
    } catch (err) {
      return classifyGhlHttpError(err);
    }
  },

  async fetchLocationDetails(connection: IntegrationConnection, locationId: string): Promise<GhlFetchResult<GhlLocationDetails>> {
    try {
      const accessToken = decryptAccessToken(connection);
      await acquireGhlToken(locationId);
      const response = await axios.get(`${GHL_API_BASE}/locations/${locationId}`, {
        headers: getHeaders(accessToken),
        timeout: TIMEOUT_MS,
      });
      const location = (response.data as { location?: GhlLocationDetails })?.location;
      if (!location) {
        return { availability: 'unavailable_other', data: null, errorCode: 'empty_response', message: 'location endpoint returned no payload' };
      }
      return { availability: 'available', data: location };
    } catch (err) {
      return classifyGhlHttpError(err);
    }
  },

  async fetchSubscription(connection: IntegrationConnection, locationId: string): Promise<GhlFetchResult<GhlSubscription>> {
    try {
      const accessToken = decryptAccessToken(connection);
      await acquireGhlToken(locationId);
      const response = await axios.get(`${GHL_API_BASE}/saas/location/${locationId}/subscription`, {
        headers: getHeaders(accessToken),
        timeout: TIMEOUT_MS,
      });
      const raw = response.data as Record<string, unknown>;
      const sub: GhlSubscription = {
        planId: raw.planId as string | undefined,
        tier: raw.planName as string | undefined,
        active: raw.active as boolean | undefined,
        nextBillingDate: raw.nextBillingDate as string | undefined,
        raw,
      };
      return { availability: 'available', data: sub };
    } catch (err) {
      // Subscription endpoint is commonly tier-gated (requires agency SaaS mode).
      return classifyGhlHttpError(err);
    }
  },
};
