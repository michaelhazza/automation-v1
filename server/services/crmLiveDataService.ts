import {
  listGhlAutomations,
  listGhlContacts,
  listGhlFromAddresses,
  listGhlFromNumbers,
  listGhlUsers,
  resolveGhlContext,
  type GhlReadResult,
} from './adapters/ghlReadHelpers.js';

// ---------------------------------------------------------------------------
// ClientPulse live-data service — backs the picker API routes (spec §3.3,
// Session 2 Chunk 3). Owns canonicalisation of GHL's mixed response shapes
// and in-memory caching (60 s TTL) keyed on (orgId, subaccountId, endpoint,
// searchQuery). Redis upgrade deferred per §14.3.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const MAX_RESULTS = 50;

type CacheEntry<T> = { expiresAt: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

function cacheKey(parts: Array<string | undefined>): string {
  return parts.map((p) => p ?? '').join('|');
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export type CrmAutomation = {
  id: string;
  name: string;
  status: string;
  lastRunAt: string | null;
};

export type CrmContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
};

export type CrmUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string | null;
};

export type CrmFromAddress = {
  address: string;
  displayName: string | null;
  verified: boolean;
};

export type CrmFromNumber = {
  phoneE164: string;
  capabilities: Array<'sms' | 'voice'>;
  label: string | null;
};

export type LiveDataResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; rateLimited: true; retryAfterSeconds: number }
  | { ok: false; error: string };

function unwrap<T, U>(
  res: GhlReadResult<T>,
  transform: (items: T[]) => U[],
): LiveDataResult<U> {
  if (res.ok) return { ok: true, items: transform(res.items).slice(0, MAX_RESULTS) };
  if ('rateLimited' in res) {
    return { ok: false, rateLimited: true, retryAfterSeconds: res.retryAfterSeconds };
  }
  return { ok: false, error: res.error };
}

async function withContext<U>(
  orgId: string,
  subaccountId: string,
  run: (ctx: Awaited<ReturnType<typeof resolveGhlContext>> & object) => Promise<LiveDataResult<U>>,
): Promise<LiveDataResult<U>> {
  const ctx = await resolveGhlContext({ organisationId: orgId, subaccountId });
  if (!ctx) {
    return { ok: false, error: 'No active GHL connection for subaccount' };
  }
  return run(ctx);
}

export const crmLiveDataService = {
  async listAutomations(
    subaccountId: string,
    orgId: string,
    search?: string,
  ): Promise<LiveDataResult<CrmAutomation>> {
    const key = cacheKey([orgId, subaccountId, 'automations', search]);
    const cached = getCached<LiveDataResult<CrmAutomation>>(key);
    if (cached) return cached;

    const result = await withContext<CrmAutomation>(orgId, subaccountId, async (ctx) => {
      const raw = await listGhlAutomations(ctx, search);
      return unwrap(raw, (items) =>
        items.map((a) => ({
          id: a.id,
          name: a.name ?? '(unnamed)',
          status: a.status ?? 'unknown',
          lastRunAt: a.lastRunAt ?? null,
        })),
      );
    });
    if (result.ok) setCached(key, result);
    return result;
  },

  async listContacts(
    subaccountId: string,
    orgId: string,
    search?: string,
  ): Promise<LiveDataResult<CrmContact>> {
    const key = cacheKey([orgId, subaccountId, 'contacts', search]);
    const cached = getCached<LiveDataResult<CrmContact>>(key);
    if (cached) return cached;

    const result = await withContext<CrmContact>(orgId, subaccountId, async (ctx) => {
      const raw = await listGhlContacts(ctx, search);
      return unwrap(raw, (items) =>
        items.map((c) => ({
          id: c.id,
          firstName: c.firstName ?? (c.contactName?.split(' ')[0] ?? ''),
          lastName: c.lastName ?? (c.contactName?.split(' ').slice(1).join(' ') ?? ''),
          email: c.email ?? null,
          phone: c.phone ?? null,
          tags: c.tags ?? [],
        })),
      );
    });
    if (result.ok) setCached(key, result);
    return result;
  },

  async listUsers(
    subaccountId: string,
    orgId: string,
    search?: string,
  ): Promise<LiveDataResult<CrmUser>> {
    const key = cacheKey([orgId, subaccountId, 'users', search]);
    const cached = getCached<LiveDataResult<CrmUser>>(key);
    if (cached) return cached;

    const result = await withContext<CrmUser>(orgId, subaccountId, async (ctx) => {
      const raw = await listGhlUsers(ctx, search);
      return unwrap(raw, (items) =>
        items.map((u) => ({
          id: u.id,
          firstName: u.firstName ?? (u.name?.split(' ')[0] ?? ''),
          lastName: u.lastName ?? (u.name?.split(' ').slice(1).join(' ') ?? ''),
          email: u.email ?? '',
          role: u.role ?? u.roles?.[0]?.type ?? null,
        })),
      );
    });
    if (result.ok) setCached(key, result);
    return result;
  },

  async listFromAddresses(
    subaccountId: string,
    orgId: string,
  ): Promise<LiveDataResult<CrmFromAddress>> {
    const key = cacheKey([orgId, subaccountId, 'from-addresses']);
    const cached = getCached<LiveDataResult<CrmFromAddress>>(key);
    if (cached) return cached;

    const result = await withContext<CrmFromAddress>(orgId, subaccountId, async (ctx) => {
      const raw = await listGhlFromAddresses(ctx);
      return unwrap(raw, (items) =>
        items.map((f) => ({
          address: f.address,
          displayName: f.displayName ?? null,
          verified: f.verified === true,
        })),
      );
    });
    if (result.ok) setCached(key, result);
    return result;
  },

  async listFromNumbers(
    subaccountId: string,
    orgId: string,
  ): Promise<LiveDataResult<CrmFromNumber>> {
    const key = cacheKey([orgId, subaccountId, 'from-numbers']);
    const cached = getCached<LiveDataResult<CrmFromNumber>>(key);
    if (cached) return cached;

    const result = await withContext<CrmFromNumber>(orgId, subaccountId, async (ctx) => {
      const raw = await listGhlFromNumbers(ctx);
      return unwrap(raw, (items) =>
        items.map((n) => {
          const caps: Array<'sms' | 'voice'> = [];
          if (n.capabilities?.sms) caps.push('sms');
          if (n.capabilities?.voice) caps.push('voice');
          return {
            phoneE164: n.phoneNumber,
            capabilities: caps,
            label: n.label ?? null,
          };
        }),
      );
    });
    if (result.ok) setCached(key, result);
    return result;
  },
};
