/**
 * GHL auto-enrol locations page job — Phase 3 D.5.
 *
 * Handles paginated GHL location enrolment as a background job chain.
 * Triggered when autoEnrolAgencyLocations detects > MAX_GHL_LOCATIONS_TO_ENROL.
 * Each job processes one page of GHL locations, then re-enqueues for the next
 * cursor until all pages are processed or a cap is reached.
 *
 * Idempotency: singletonKey per connectionId prevents concurrent runs.
 * Closed-chain detection: checks for terminal audit events before processing.
 */

import { sql, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { setOrgGUC } from '../lib/orgScoping.js';
import { connectorConfigs } from '../db/schema/connectorConfigs.js';
import { connectionTokenService } from '../services/connectionTokenService.js';
import { connectorConfigService } from '../services/connectorConfigService.js';
import { recordSecurityEvent, SECURITY_AUDIT_SENTINEL_ORG_ID } from '../services/securityAuditService.js';
import { auditEvent } from '../../shared/types/securityAuditEvents.js';
import { logger } from '../lib/logger.js';
import { withBackoff } from '../lib/withBackoff.js';
import { MAX_GHL_PAGES_PER_RUN } from '../config/limits.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { withAdminConnection } from '../lib/adminDbConnection.js';

export const GHL_AUTO_ENROL_PAGE_JOB = 'ghl:auto-enrol-locations-page' as const;

export interface GhlAutoEnrolPagePayload {
  connectionId: string;
  runId: string;          // crypto.randomUUID() per chain; same across re-enqueues
  pageCursor: string | null; // null on first page only
  pageIndex: number;      // 0-based
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

function classifyError(e: unknown): 'fatal' | 'retry' {
  const err = e as { statusCode?: number; code?: string; message?: string };
  // Auth revoked — no point retrying
  if (
    err.code === 'AGENCY_TOKEN_INVALID' ||
    err.message?.includes('auth_revoked') ||
    err.message?.includes('token_revoked') ||
    (typeof err.statusCode === 'number' && err.statusCode === 401)
  ) {
    return 'fatal';
  }
  // 4xx client errors (except 429) — fatal
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
    return 'fatal';
  }
  return 'retry';
}

/**
 * Pure decision helper — determines the outcome of a page based on its state.
 * Exported for pure testing (D.5 pure test).
 */
export function classifyPageOutcome(opts: {
  locations: unknown[];
  pageIndex: number;
  maxPages: number;
  nextCursor: string | null;
}): 'completed_empty' | 'completed_cursor_null' | 'partial_page_cap' | 'continue' {
  const { locations, pageIndex, maxPages, nextCursor } = opts;
  if (locations.length === 0) return 'completed_empty';
  if (pageIndex >= maxPages) return 'partial_page_cap';
  if (nextCursor === null) return 'completed_cursor_null';
  return 'continue';
}

export async function ghlAutoEnrolLocationsPageWorker(payload: GhlAutoEnrolPagePayload): Promise<void> {
  const { connectionId, runId, pageCursor, pageIndex } = payload;

  // Step 2: Closed-chain check — if a terminal event exists for this run, drop job
  const terminalEvents = await db.execute<{ id: string }>(sql`
    SELECT id FROM security_audit_events
    WHERE meta @> ${JSON.stringify({ runId, connectionId })}::jsonb
      AND event_type IN ('oauth.enrol.completed', 'oauth.enrol.failed', 'oauth.enrol.partial')
    LIMIT 1
  `);
  const terminalRows = terminalEvents as unknown as Array<{ id: string }>;
  if (terminalRows.length > 0) {
    logger.warn('ghl.autoEnrolPage.closedChainDrop', {
      event: 'ghl.autoEnrolPage.closedChainDrop',
      provider: 'ghl',
      connectionId,
      runId,
      pageIndex,
    });
    return;
  }

  // Step 3: Idempotency guard — if this page was already processed, drop job
  const existingProgress = await db.execute<{ id: string }>(sql`
    SELECT id FROM security_audit_events
    WHERE meta @> ${JSON.stringify({ runId, connectionId, pageIndex })}::jsonb
      AND event_type = 'oauth.enrol.progress'
    LIMIT 1
  `);
  const existingRows = existingProgress as unknown as Array<{ id: string }>;
  if (existingRows.length > 0) {
    logger.warn('ghl.autoEnrolPage.idempotencyDrop', {
      event: 'ghl.autoEnrolPage.idempotencyDrop',
      provider: 'ghl',
      connectionId,
      runId,
      pageIndex,
    });
    return;
  }

  // Step 4: Re-derive cumulative totals from all progress events for this run
  const progressRows = await db.execute<{ meta: Record<string, unknown> }>(sql`
    SELECT meta FROM security_audit_events
    WHERE meta @> ${JSON.stringify({ runId, connectionId })}::jsonb
      AND event_type = 'oauth.enrol.progress'
  `);
  const progressArr = progressRows as unknown as Array<{ meta: Record<string, unknown> }>;
  const totalLocationsProcessed = progressArr.reduce((sum, row) => {
    return sum + (Number(row.meta?.locationsProcessedThisPage) || 0);
  }, 0);
  const totalPagesProcessed = progressArr.length;

  // Step 5: Fetch connection and get access token (system context via adminDbConnection)
  const lookupConnection = async () => withAdminConnection(
    { source: 'ghl_auto_enrol_page_lookup', skipAudit: true },
    async (adminDb) => {
      await adminDb.execute(sql`SET LOCAL ROLE admin_role`);
      const [row] = await adminDb
        .select()
        .from(connectorConfigs)
        .where(eq(connectorConfigs.id, connectionId))
        .limit(1);
      return row ?? null;
    },
  );

  const connection = await lookupConnection();
  if (!connection) {
    logger.error('ghl.autoEnrolPage.connectionNotFound', { connectionId, runId });
    return;
  }

  // Refresh token if expired
  await connectorConfigService.refreshAgencyTokenIfExpired(connectionId);
  const refreshed = await lookupConnection();
  if (!refreshed) return;

  const accessToken = connectionTokenService.decryptToken(refreshed.accessToken ?? '');
  const organisationId = refreshed.organisationId;

  // Step 6: Call GHL GET /locations with cursor
  type GhlLocation = { id: string; name: string; companyId?: string; [key: string]: unknown };
  let fetchResult: { locations: GhlLocation[]; nextCursor: string | null };

  try {
    const raw = await withBackoff(
      async () => {
        const url = new URL(`${GHL_API_BASE}/locations/search`);
        if (refreshed.companyId) url.searchParams.set('companyId', refreshed.companyId);
        url.searchParams.set('limit', '50');
        if (pageCursor) url.searchParams.set('cursor', pageCursor);

        const r = await fetch(url.toString(), {
          headers: ghlHeaders(accessToken),
          signal: AbortSignal.timeout(15_000),
        });

        if (r.status === 429 || r.status >= 500) {
          throw Object.assign(new Error(`GHL locations page: ${r.status}`), { statusCode: r.status });
        }
        if (!r.ok) {
          throw Object.assign(new Error(`GHL locations page 4xx: ${r.status}`), { statusCode: r.status });
        }

        return await r.json() as { locations?: GhlLocation[]; meta?: { nextPageCursor?: string | null } };
      },
      {
        label: 'ghl.autoEnrolPage.fetch',
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        isRetryable: (err: unknown) => {
          const e = err as { statusCode?: number };
          return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
        },
        correlationId: connectionId,
        runId,
      },
    );
    fetchResult = {
      locations: raw.locations ?? [],
      nextCursor: raw.meta?.nextPageCursor ?? null,
    };
  } catch (err) {
    const classification = classifyError(err);
    logger.error('ghl.autoEnrolPage.fetchError', {
      event: 'ghl.autoEnrolPage.fetchError',
      provider: 'ghl',
      connectionId,
      runId,
      pageIndex,
      classification,
      error: String(err),
    });

    if (classification === 'fatal') {
      await recordSecurityEvent({
        event: auditEvent.oauth.enrolFailed,
        organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
        meta: { runId, connectionId, pageIndex, reason: 'FETCH_FATAL', error: String(err) },
      });
      return;
    }
    // Retry: re-throw so pg-boss handles retry
    throw err;
  }

  const { locations, nextCursor } = fetchResult;

  // Steps 7–8: Classify page outcome and handle early exits before any insert
  const pageOutcome = classifyPageOutcome({ locations, pageIndex, maxPages: MAX_GHL_PAGES_PER_RUN, nextCursor });

  if (pageOutcome === 'completed_empty') {
    await recordSecurityEvent({
      event: auditEvent.oauth.enrolCompleted,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: { runId, connectionId, totalLocationsProcessed, totalPagesProcessed, completedReason: 'empty_page_early_exit' },
    });
    return;
  }

  if (pageOutcome === 'partial_page_cap') {
    await recordSecurityEvent({
      event: auditEvent.oauth.enrolPartial,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: { runId, connectionId, totalLocationsProcessed, totalPagesProcessed, reason: 'PAGE_CAP_EXCEEDED' },
    });
    return;
  }

  // Step 9: Insert locations via raw SQL (ON CONFLICT with partial index WHERE clause).
  // Each INSERT runs inside its own org-scoped transaction so the FORCE-RLS
  // WITH CHECK on subaccounts is satisfied (set_config scoped to tx via is_local=true).
  const now = new Date();
  for (const loc of locations) {
    try {
      await db.transaction(async (tx) => {
        await setOrgGUC(tx, organisationId);
        await tx.execute(sql`
          INSERT INTO subaccounts (
            id, organisation_id, name, slug, status,
            connector_config_id, external_id, external_id_namespace, created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            ${organisationId},
            ${loc.name},
            ${loc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + loc.id.slice(-4)},
            'active',
            ${connectionId},
            ${loc.id},
            'ghl_location',
            ${now.toISOString()},
            ${now.toISOString()}
          )
          ON CONFLICT (organisation_id, external_id)
            WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL
          DO NOTHING
        `);
      });
    } catch (err) {
      // Non-fatal insert errors — log and continue
      logger.warn('ghl.autoEnrolPage.insertError', {
        event: 'ghl.autoEnrolPage.insertError',
        provider: 'ghl',
        connectionId,
        runId,
        locationId: loc.id,
        error: String(err),
      });
    }
  }

  // Step 10: Emit progress event
  await recordSecurityEvent({
    event: auditEvent.oauth.enrolProgress,
    organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
    meta: {
      runId,
      connectionId,
      pageIndex,
      locationsProcessedThisPage: locations.length,
      totalLocationsProcessed: totalLocationsProcessed + locations.length,
    },
  });

  // Steps 11–12: Post-insert branching via classifyPageOutcome result
  if (pageOutcome === 'completed_cursor_null') {
    await recordSecurityEvent({
      event: auditEvent.oauth.enrolCompleted,
      organisationId: SECURITY_AUDIT_SENTINEL_ORG_ID,
      meta: {
        runId,
        connectionId,
        totalLocationsProcessed: totalLocationsProcessed + locations.length,
        totalPagesProcessed: totalPagesProcessed + 1,
        completedReason: 'all_pages_processed',
      },
    });
    return;
  }

  // pageOutcome === 'continue': re-enqueue for next page
  const boss = await getPgBoss();
  await (boss as any).send(
    GHL_AUTO_ENROL_PAGE_JOB,
    { connectionId, runId, pageCursor: nextCursor, pageIndex: pageIndex + 1 } satisfies GhlAutoEnrolPagePayload,
    { singletonKey: `ghl-enrol:${connectionId}` },
  );
}
