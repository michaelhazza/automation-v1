import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import {
  buildTokenExchangeBody,
  type AgencyTokenResponse,
  GHL_PAGINATION_LIMIT,
  GHL_LOCATION_CAP,
  checkTruncation,
  type GhlLocation,
} from './ghlAgencyOauthServicePure.js';
import { connectionTokenService } from './connectionTokenService.js';
import { connectorConfigService } from './connectorConfigService.js';

export async function exchangeGhlAuthCode(
  code: string,
  redirectUri: string,
): Promise<AgencyTokenResponse | null> {
  const clientId = process.env.OAUTH_GHL_CLIENT_ID ?? '';
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;

  const body = buildTokenExchangeBody({ code, redirectUri, clientId, clientSecret });
  const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

  try {
    return await withBackoff(
      async () => {
        const r = await fetch(GHL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429 || r.status >= 500) {
          throw Object.assign(new Error(`GHL token exchange ${r.status}`), { statusCode: r.status });
        }
        if (!r.ok) return null;
        return r.json() as Promise<AgencyTokenResponse>;
      },
      {
        label: 'ghl.exchangeAuthCode',
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        isRetryable: (err: unknown) => {
          const e = err as { statusCode?: number };
          return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
        },
        correlationId: 'oauth_callback',
        runId: code.slice(0, 8),
      },
    );
  } catch {
    logger.warn('ghl.exchangeAuthCode.failed', { codePrefix: code.slice(0, 8) });
    return null;
  }
}

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Enumerate all GHL locations for an agency via paginated /locations/search.
 * Caps at 1000 per spec §5.5. Returns the flat list of up to 1000 locations.
 */
export async function enumerateAgencyLocations(
  agencyConnection: { id: string; companyId: string | null; organisationId: string; accessToken?: string | null },
  correlationId: string,
): Promise<GhlLocation[]> {
  const accessToken = connectionTokenService.decryptToken(agencyConnection.accessToken ?? '');
  const companyId = agencyConnection.companyId;
  if (!companyId) throw new Error('enumerateAgencyLocations: companyId missing on connection');

  logger.info('ghl.enumeration.start', {
    event: 'ghl.enumeration.start',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId: null,
    result: 'success',
    error: null,
  });

  const all: GhlLocation[] = [];
  let skip = 0;
  let refreshed = false;
  let currentToken = accessToken;
  let apiCallCount = 0;

  while (all.length < GHL_LOCATION_CAP) {
    const fetchPage = async (): Promise<GhlLocation[]> => {
      const url = new URL(`${GHL_API_BASE}/locations/search`);
      url.searchParams.set('companyId', companyId);
      url.searchParams.set('limit', String(GHL_PAGINATION_LIMIT));
      url.searchParams.set('skip', String(skip));

      apiCallCount++;
      const r = await fetch(url.toString(), {
        headers: ghlHeaders(currentToken),
        signal: AbortSignal.timeout(15_000),
      });

      if (r.status === 401) {
        if (!refreshed) {
          refreshed = true;
          await connectorConfigService.refreshAgencyTokenIfExpired(agencyConnection.id);
          const updated = await connectorConfigService.findAgencyConnectionByCompanyId(companyId);
          if (updated) currentToken = connectionTokenService.decryptToken(updated.accessToken ?? '');
          return fetchPage();
        }
        throw Object.assign(new Error('AGENCY_TOKEN_INVALID'), { code: 'AGENCY_TOKEN_INVALID', statusCode: 401 });
      }

      if (r.status === 429 || r.status >= 500) {
        throw Object.assign(new Error(`GHL locations search: ${r.status}`), { statusCode: r.status });
      }

      if (!r.ok) {
        throw Object.assign(new Error(`GHL locations search 4xx: ${r.status}`), { statusCode: r.status });
      }

      const data = await r.json() as { locations?: GhlLocation[] };
      return data.locations ?? [];
    };

    const page = await withBackoff(fetchPage, {
      label: 'ghl.locations.search',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      isRetryable: (err: unknown) => {
        const e = err as { statusCode?: number };
        return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
      },
      correlationId,
      runId: agencyConnection.id,
    });

    all.push(...page);
    if (page.length < GHL_PAGINATION_LIMIT) break;
    skip += GHL_PAGINATION_LIMIT;
  }

  const truncated = checkTruncation(all.length);

  logger.info('ghl.enumeration.end', {
    event: 'ghl.enumeration.end',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId: null,
    result: 'success',
    error: null,
    enrolled: all.length,
    pagesFetched: Math.ceil(all.length / GHL_PAGINATION_LIMIT) || 1,
    apiCallCount,
    truncated,
  });

  if (truncated) {
    logger.warn('ghl.enumeration.truncated', {
      event: 'ghl.enumeration.truncated',
      orgId: agencyConnection.organisationId,
      companyId,
      processed: GHL_LOCATION_CAP,
    });
  }

  return all;
}
