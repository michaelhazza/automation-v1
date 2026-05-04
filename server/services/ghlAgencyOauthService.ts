import { sql } from 'drizzle-orm';
import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import {
  buildTokenExchangeBody,
  type AgencyTokenResponse,
  GHL_PAGINATION_LIMIT,
  GHL_LOCATION_CAP,
  checkTruncation,
  type GhlLocation,
  generateSubaccountSlug,
} from './ghlAgencyOauthServicePure.js';
import { connectionTokenService } from './connectionTokenService.js';
import { connectorConfigService } from './connectorConfigService.js';
import { db } from '../db/index.js';

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
    logger.warn('ghl.exchangeAuthCode.failed', { provider: 'ghl', codePrefix: code.slice(0, 8) });
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
    provider: 'ghl',
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

    // Cross-tenant isolation: GHL's /locations/search is queried with a
    // companyId filter, but defence-in-depth requires that we never trust
    // the upstream payload's companyId. Drop any location whose companyId
    // doesn't match the agency connection — without this guard, a GHL
    // server-side bug or token-routing change could enroll another
    // company's locations as subaccounts of the wrong org.
    for (const loc of page) {
      if (loc.companyId && loc.companyId !== companyId) {
        logger.warn('ghl.enumeration.foreign_location_dropped', {
          event: 'ghl.enumeration.foreign_location_dropped',
          provider: 'ghl',
          orgId: agencyConnection.organisationId,
          companyId,
          locationId: loc.id,
          foreignCompanyId: loc.companyId,
        });
        continue;
      }
      all.push(loc);
    }
    if (page.length < GHL_PAGINATION_LIMIT) break;
    skip += GHL_PAGINATION_LIMIT;
  }

  const truncated = checkTruncation(all.length);

  logger.info('ghl.enumeration.end', {
    event: 'ghl.enumeration.end',
    provider: 'ghl',
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
      provider: 'ghl',
      orgId: agencyConnection.organisationId,
      companyId,
      processed: GHL_LOCATION_CAP,
    });
  }

  return all;
}

/**
 * Upsert one subaccount row per GHL location.
 * Idempotency: INSERT ... ON CONFLICT DO UPDATE RETURNING (xmax = 0) AS inserted.
 * autoStartOwedOnboardingWorkflows fires ONLY when inserted = true (first creation).
 */
export async function autoEnrolAgencyLocations(
  orgId: string,
  agencyConnection: { id: string; companyId: string | null; organisationId: string; accessToken?: string | null },
  correlationId?: string,
): Promise<{ enrolled: number; insertedCount: number }> {
  const effectiveCorrelationId = correlationId ?? agencyConnection.id;
  const locations = await enumerateAgencyLocations(agencyConnection, effectiveCorrelationId);
  let insertedCount = 0;

  // FORCE RLS on subaccounts — both the OAuth callback and INSTALL_company
  // webhook reach this function from unauthenticated handlers. Each subaccount
  // upsert runs in a per-row org-scoped transaction
  // (set_config('app.organisation_id', orgId, true) on `tx`) so that:
  //   1. the subaccounts INSERT passes the WITH CHECK clause — the INSERT is
  //      issued via tx.execute(...) on the SAME connection where set_config
  //      ran, so the GUC applies
  //   2. the slug-collision retry loop preserves the per-row tx boundary —
  //      a 23505 from one slug attempt rolls back only that row's tx, not
  //      the whole enrolment
  //
  // The autoStartOwedOnboardingWorkflows call below runs OUTSIDE this tx and
  // uses module-level `db`, so its queries do NOT inherit the GUC. See the
  // KNOWN-BROKEN comment at the call site.
  for (const loc of locations) {
    const baseSlug = generateSubaccountSlug(loc.name, loc.id);

    let result: { id: string; inserted: boolean } | undefined;
    for (const slug of [baseSlug, `${baseSlug}-${loc.id.slice(-4)}`]) {
      try {
        result = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.organisation_id', ${orgId}, true)`);
          const rows = await tx.execute<{ id: string; inserted: boolean }>(sql`
            INSERT INTO subaccounts (
              id, organisation_id, name, slug, status,
              connector_config_id, external_id, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), ${orgId}, ${loc.name}, ${slug}, 'active',
              ${agencyConnection.id}, ${loc.id}, now(), now()
            )
            ON CONFLICT (connector_config_id, external_id)
              WHERE deleted_at IS NULL
                AND connector_config_id IS NOT NULL
                AND external_id IS NOT NULL
            DO UPDATE SET name = EXCLUDED.name, updated_at = now()
            RETURNING id, (xmax = 0) AS inserted
          `);
          return rows[0];
        });
        break;
      } catch (err) {
        const pg = err as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint?.includes('slug')) continue;
        throw err;
      }
    }

    if (!result) {
      logger.warn('ghl.enumeration.slug_collision_unresolved', {
        event: 'ghl.enumeration.slug_collision_unresolved',
        provider: 'ghl',
        orgId,
        companyId: agencyConnection.companyId,
        locationId: loc.id,
      });
      continue;
    }

    logger.info('ghl.enumeration.subaccount_upsert', {
      event: 'ghl.enumeration.subaccount_upsert',
      provider: 'ghl',
      orgId,
      companyId: agencyConnection.companyId,
      locationId: loc.id,
      result: 'success',
      inserted: result.inserted,
      error: null,
    });

    if (result.inserted) {
      insertedCount++;
      // D-P0-1: enqueue via pg-boss instead of inline sync call. The GUC
      // propagation problem (KNOWN-BROKEN comment removed) is resolved because
      // the worker runs with its own admin-bypass DB access, decoupled from
      // this unauthenticated request path. singletonKey prevents double-enqueue
      // on webhook replay.
      try {
        const { enqueueGhlOnboarding } = await import('../jobs/ghlAutoStartOnboardingJob.js');
        await enqueueGhlOnboarding({ organisationId: orgId, subaccountId: result.id });
      } catch (err) {
        logger.error('ghl.enumeration.onboarding_enqueue_failed', {
          event: 'ghl.enumeration.onboarding_enqueue_failed',
          provider: 'ghl',
          orgId,
          subaccountId: result.id,
          locationId: loc.id,
          error: { code: 'ONBOARDING_ENQUEUE_FAILED', message: String(err) },
        });
      }
    }
  }

  logger.info('ghl.enrol.complete', {
    event: 'ghl.enrol.complete',
    provider: 'ghl',
    orgId,
    companyId: agencyConnection.companyId,
    locationId: null,
    enrolled: locations.length,
    insertedCount,
    isFirstInstall: insertedCount > 0,
    correlationId: effectiveCorrelationId,
  });

  return { enrolled: locations.length, insertedCount };
}
