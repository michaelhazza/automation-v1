import axios, { type AxiosError } from 'axios';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { integrationConnections } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// GoHighLevel read helpers — low-level list calls backing the ClientPulse
// live-data pickers (spec §3.2, Session 2 Chunk 3). Each helper resolves the
// subaccount's GHL `locationId` + access token, hits the endpoint, returns the
// raw GHL array. Canonicalisation lives in crmLiveDataService.
// ---------------------------------------------------------------------------

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export type GhlReadResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; rateLimited: true; retryAfterSeconds: number }
  | { ok: false; error: string; statusCode?: number };

type GhlContext = {
  accessToken: string;
  locationId: string;
  baseUrl: string;
};

/**
 * Resolve the GHL OAuth token + locationId for a subaccount. Returns null when
 * no active connection exists — the caller surfaces a user-readable error.
 */
export async function resolveGhlContext(params: {
  organisationId: string;
  subaccountId: string;
}): Promise<GhlContext | null> {
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organisationId, params.organisationId),
        eq(integrationConnections.subaccountId, params.subaccountId),
        eq(integrationConnections.providerType, 'ghl'),
        eq(integrationConnections.connectionStatus, 'active'),
      ),
    );
  if (!conn || !conn.accessToken) return null;

  const config = (conn.configJson ?? {}) as Record<string, unknown>;
  const locationId = typeof config.locationId === 'string' ? (config.locationId as string) : null;
  if (!locationId) return null;

  const configuredBase = typeof config.baseUrl === 'string' ? (config.baseUrl as string) : null;
  return {
    accessToken: conn.accessToken,
    locationId,
    baseUrl: configuredBase ?? GHL_API_BASE,
  };
}

function extractRetryAfter(err: AxiosError): number {
  const header = err.response?.headers?.['retry-after'];
  if (typeof header === 'string') {
    const parsed = Number(header);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 30;
}

async function getJson<T>(params: {
  ctx: GhlContext;
  path: string;
  query?: Record<string, string | number | undefined>;
}): Promise<GhlReadResult<T>> {
  try {
    const response = await axios.get<{ [key: string]: unknown }>(
      `${params.ctx.baseUrl}${params.path}`,
      {
        params: { locationId: params.ctx.locationId, ...params.query },
        headers: {
          Authorization: `Bearer ${params.ctx.accessToken}`,
          Version: GHL_VERSION,
          Accept: 'application/json',
        },
        timeout: 15_000,
      },
    );
    const data = response.data as Record<string, unknown>;
    // GHL wraps list responses under varying keys — contacts, users, workflows, etc.
    const firstArray = Object.values(data).find((v) => Array.isArray(v)) as T[] | undefined;
    return { ok: true, items: Array.isArray(firstArray) ? firstArray : [] };
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response?.status === 429) {
      return {
        ok: false,
        rateLimited: true,
        retryAfterSeconds: extractRetryAfter(axiosErr),
      };
    }
    return {
      ok: false,
      error: axiosErr.message ?? 'GHL request failed',
      statusCode: axiosErr.response?.status,
    };
  }
}

export type RawGhlAutomation = {
  id: string;
  name?: string;
  status?: string;
  lastRunAt?: string;
};

export type RawGhlContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
};

export type RawGhlUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  role?: string;
  roles?: { type?: string }[];
};

export type RawGhlFromAddress = {
  address: string;
  displayName?: string;
  verified?: boolean;
};

export type RawGhlFromNumber = {
  phoneNumber: string;
  capabilities?: { sms?: boolean; voice?: boolean };
  label?: string;
};

export async function listGhlAutomations(
  ctx: GhlContext,
  search?: string,
): Promise<GhlReadResult<RawGhlAutomation>> {
  return getJson<RawGhlAutomation>({
    ctx,
    path: '/workflows/',
    query: search ? { q: search, limit: 50 } : { limit: 50 },
  });
}

export async function listGhlContacts(
  ctx: GhlContext,
  search?: string,
): Promise<GhlReadResult<RawGhlContact>> {
  return getJson<RawGhlContact>({
    ctx,
    path: '/contacts/',
    query: search ? { query: search, limit: 50 } : { limit: 50 },
  });
}

export async function listGhlUsers(
  ctx: GhlContext,
  search?: string,
): Promise<GhlReadResult<RawGhlUser>> {
  return getJson<RawGhlUser>({
    ctx,
    path: '/users/',
    query: search ? { query: search, limit: 50 } : { limit: 50 },
  });
}

export async function listGhlFromAddresses(
  ctx: GhlContext,
): Promise<GhlReadResult<RawGhlFromAddress>> {
  return getJson<RawGhlFromAddress>({ ctx, path: '/locations/email/from-addresses' });
}

export async function listGhlFromNumbers(
  ctx: GhlContext,
): Promise<GhlReadResult<RawGhlFromNumber>> {
  return getJson<RawGhlFromNumber>({ ctx, path: '/phone-numbers/' });
}
