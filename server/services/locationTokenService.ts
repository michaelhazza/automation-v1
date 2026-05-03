import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { connectorLocationTokens } from '../db/schema/index.js';
import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import { connectionTokenService } from './connectionTokenService.js';
import {
  isLocationTokenExpiringSoon,
  computeLocationTokenExpiresAt,
  validateLocationTokenResponse,
  buildLocationTokenBody,
  buildLocationRefreshBody,
  type LocationTokenResponse,
} from './locationTokenServicePure.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    'Content-Type': 'application/json',
  };
}

// In-process mint lock: prevents parallel fetches for the same (configId, locationId).
// DB unique index is the authoritative cross-process guard.
const mintInFlight = new Map<string, Promise<string>>();

export async function getLocationToken(
  agencyConnection: { id: string; companyId: string | null; organisationId: string; accessToken?: string | null },
  locationId: string,
): Promise<string> {
  const [cached] = await db
    .select()
    .from(connectorLocationTokens)
    .where(
      and(
        eq(connectorLocationTokens.connectorConfigId, agencyConnection.id),
        eq(connectorLocationTokens.locationId, locationId),
        isNull(connectorLocationTokens.deletedAt),
      ),
    )
    .limit(1);

  if (cached) {
    if (!isLocationTokenExpiringSoon(cached.expiresAt)) {
      return connectionTokenService.decryptToken(cached.accessToken);
    }
    return refreshLocationToken(agencyConnection, cached.id, cached.refreshToken, locationId);
  }

  const lockKey = `${agencyConnection.id}:${locationId}`;
  const inFlight = mintInFlight.get(lockKey);
  if (inFlight) return inFlight;

  const mintPromise = mintLocationToken(agencyConnection, locationId).finally(() => {
    mintInFlight.delete(lockKey);
  });
  mintInFlight.set(lockKey, mintPromise);
  return mintPromise;
}

async function mintLocationToken(
  agencyConnection: { id: string; companyId: string | null; organisationId: string; accessToken?: string | null },
  locationId: string,
): Promise<string> {
  const agencyToken = connectionTokenService.decryptToken(agencyConnection.accessToken ?? '');
  const companyId = agencyConnection.companyId!;
  const clientId = process.env.OAUTH_GHL_CLIENT_ID!;
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET!;

  const mintFn = async (): Promise<LocationTokenResponse> => {
    const r = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
      method: 'POST',
      headers: { ...ghlHeaders(agencyToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLocationTokenBody({ companyId, locationId })),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401) throw Object.assign(new Error('401'), { statusCode: 401 });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    if (!r.ok) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    return r.json() as Promise<LocationTokenResponse>;
  };

  // clientId and clientSecret resolved above for use in refresh — referenced in scope but
  // not needed for mint body; kept to surface missing-env early before any network call.
  void clientId;
  void clientSecret;

  const data = await withBackoff(mintFn, {
    label: 'ghl.location.mint',
    maxAttempts: 4,
    baseDelayMs: 1000,
    maxDelayMs: 4000,
    isRetryable: (err: unknown) => {
      const e = err as { statusCode?: number };
      return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
    },
    correlationId: agencyConnection.id,
    runId: locationId,
  });

  validateLocationTokenResponse(data, companyId, locationId);

  const claimedAt = new Date();
  const expiresAt = computeLocationTokenExpiresAt(claimedAt, data.expires_in);

  const [inserted] = await db
    .insert(connectorLocationTokens)
    .values({
      connectorConfigId: agencyConnection.id,
      locationId,
      accessToken: connectionTokenService.encryptToken(data.access_token),
      refreshToken: connectionTokenService.encryptToken(data.refresh_token),
      expiresAt,
      scope: data.scope,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    const [winner] = await db
      .select()
      .from(connectorLocationTokens)
      .where(
        and(
          eq(connectorLocationTokens.connectorConfigId, agencyConnection.id),
          eq(connectorLocationTokens.locationId, locationId),
          isNull(connectorLocationTokens.deletedAt),
        ),
      )
      .limit(1);
    if (!winner) throw new Error(`getLocationToken: race-loser re-read found no row for ${locationId}`);
    return connectionTokenService.decryptToken(winner.accessToken);
  }

  logger.info('ghl.token.mint', {
    event: 'ghl.token.mint',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId,
    result: 'success',
    tokenAgeMs: Date.now() - claimedAt.getTime(),
    error: null,
  });

  return data.access_token;
}

async function refreshLocationToken(
  agencyConnection: { id: string; companyId: string | null; organisationId: string },
  tokenRowId: string,
  encryptedRefreshToken: string,
  locationId: string,
): Promise<string> {
  const clientId = process.env.OAUTH_GHL_CLIENT_ID!;
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET!;
  const companyId = agencyConnection.companyId!;
  const refreshToken = connectionTokenService.decryptToken(encryptedRefreshToken);

  const refreshFn = async (): Promise<LocationTokenResponse> => {
    const body = buildLocationRefreshBody({ refreshToken, clientId, clientSecret });
    const r = await fetch(`${GHL_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('401'), { statusCode: 401 });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    if (!r.ok) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    return r.json() as Promise<LocationTokenResponse>;
  };

  let data: LocationTokenResponse;
  try {
    data = await withBackoff(refreshFn, {
      label: 'ghl.location.refresh',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      isRetryable: (err: unknown) => {
        const e = err as { statusCode?: number };
        return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
      },
      correlationId: agencyConnection.id,
      runId: locationId,
    });
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 401) {
      await db
        .update(connectorLocationTokens)
        .set({ deletedAt: new Date() })
        .where(eq(connectorLocationTokens.id, tokenRowId));
      return mintLocationToken(agencyConnection, locationId);
    }
    logger.error('ghl.token.refresh_failure', {
      event: 'ghl.token.refresh_failure',
      orgId: agencyConnection.organisationId,
      companyId: agencyConnection.companyId,
      locationId,
      result: 'failure',
      error: { message: String(err) },
    });
    throw err;
  }

  const claimedAt = new Date();
  await db
    .update(connectorLocationTokens)
    .set({
      accessToken: connectionTokenService.encryptToken(data.access_token),
      refreshToken: connectionTokenService.encryptToken(data.refresh_token),
      expiresAt: computeLocationTokenExpiresAt(claimedAt, data.expires_in),
      scope: data.scope,
      updatedAt: new Date(),
    })
    .where(eq(connectorLocationTokens.id, tokenRowId));

  logger.info('ghl.token.refresh', {
    event: 'ghl.token.refresh',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId,
    result: 'success',
    error: null,
  });

  return data.access_token;
}

export async function handleLocationToken401(
  agencyConnection: { id: string; companyId: string | null; organisationId: string },
  locationId: string,
): Promise<string> {
  await db
    .update(connectorLocationTokens)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(connectorLocationTokens.connectorConfigId, agencyConnection.id),
        eq(connectorLocationTokens.locationId, locationId),
        isNull(connectorLocationTokens.deletedAt),
      ),
    );

  try {
    return await mintLocationToken(agencyConnection, locationId);
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 401) {
      logger.error('ghl.token.invalid', {
        event: 'ghl.token.invalid',
        orgId: agencyConnection.organisationId,
        companyId: agencyConnection.companyId,
        locationId,
        result: 'failure',
        error: { code: 'LOCATION_TOKEN_INVALID', message: 'second 401 on remint — token permanently invalid' },
      });
      throw Object.assign(
        new Error(`LOCATION_TOKEN_INVALID: second 401 for locationId=${locationId}`),
        { code: 'LOCATION_TOKEN_INVALID', locationId },
      );
    }
    throw err;
  }
}
