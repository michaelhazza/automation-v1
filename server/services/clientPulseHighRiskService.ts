/**
 * clientPulseHighRiskService.ts
 *
 * Backs GET /api/clientpulse/high-risk.
 *
 * Three exported pure/async functions:
 *   getPrioritisedClients  — DB queries (no N+1 on sparkline)
 *   applyFilters           — pure band + substring filter
 *   applyPagination        — pure cursor-based pagination
 *
 * Plus pure helpers exported for testing:
 *   mapDbBandToApi, encodeCursor, decodeCursor, formatLastAction
 *
 * Cursor signing:
 *   Uses PULSE_CURSOR_SECRET env var. If absent, falls back to a per-org
 *   deterministic seed (SHA-256 of "clientpulse-cursor-fallback:<orgId>").
 *   This is a deliberate trade-off: the fallback is not secret per se, but
 *   it prevents cursor forgery from one org being used against another.
 *   Production deployments MUST set PULSE_CURSOR_SECRET.
 */

import { createHmac, timingSafeEqual, createHash } from 'crypto';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  clientPulseHealthSnapshots,
  clientPulseChurnAssessments,
} from '../db/schema/clientPulseCanonicalTables.js';
import { subaccounts } from '../db/schema/subaccounts.js';
import { actions } from '../db/schema/actions.js';
import { reviewItems } from '../db/schema/reviewItems.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApiBand = 'critical' | 'at_risk' | 'watch' | 'healthy';

export interface ClientRow {
  subaccountId: string;
  subaccountName: string;
  healthScore: number;
  healthBand: ApiBand;
  healthScoreDelta7d: number;
  /** 4 weekly health scores, chronological oldest-first; fewer if insufficient history */
  sparklineWeekly: number[];
  /** Server-formatted "<actionType> · Nd ago"; null if no completed/approved action */
  lastActionText: string | null;
  hasPendingIntervention: boolean;
  /** Always "/clientpulse/clients/<subaccountId>" */
  drilldownUrl: string;
}

export interface HighRiskClientsResponse {
  clients: ClientRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ── Band mapping ──────────────────────────────────────────────────────────────

/** DB stores camelCase ('atRisk'); API contract uses snake_case ('at_risk'). */
export function mapDbBandToApi(dbBand: string): ApiBand {
  switch (dbBand) {
    case 'atRisk':   return 'at_risk';
    case 'critical': return 'critical';
    case 'watch':    return 'watch';
    case 'healthy':  return 'healthy';
    default:         return 'watch'; // safe fallback
  }
}

/** Reverse mapping: API band param → DB band value. */
function mapApiBandToDb(apiBand: string): string {
  switch (apiBand) {
    case 'at_risk':  return 'atRisk';
    case 'critical': return 'critical';
    case 'watch':    return 'watch';
    case 'healthy':  return 'healthy';
    default:         return apiBand;
  }
}

// ── Sort order ────────────────────────────────────────────────────────────────

const BAND_SORT_ORDER: Record<ApiBand, number> = {
  critical: 1,
  at_risk:  2,
  watch:    3,
  healthy:  4,
};

/** Full sort: PENDING first, then band order, then score ASC, name ASC, id ASC. */
function compareRows(a: ClientRow, b: ClientRow): number {
  // 1. hasPendingIntervention first
  if (a.hasPendingIntervention !== b.hasPendingIntervention) {
    return a.hasPendingIntervention ? -1 : 1;
  }
  // 2. Band order
  const bandDiff = BAND_SORT_ORDER[a.healthBand] - BAND_SORT_ORDER[b.healthBand];
  if (bandDiff !== 0) return bandDiff;
  // 3. Score ascending
  if (a.healthScore !== b.healthScore) return a.healthScore - b.healthScore;
  // 4. Name ascending (locale-insensitive for determinism)
  if (a.subaccountName !== b.subaccountName) return a.subaccountName < b.subaccountName ? -1 : 1;
  // 5. Id ascending (tie-break)
  return a.subaccountId < b.subaccountId ? -1 : 1;
}

// ── Cursor helpers ────────────────────────────────────────────────────────────

interface CursorPayload {
  score: number;
  name: string;
  id: string;
}

/**
 * Encode a cursor payload.
 * Format: base64(JSON) + "." + HMAC-SHA256 hex (first 32 chars)
 */
export function encodeCursor(payload: CursorPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  return `${data}.${sig}`;
}

/**
 * Decode and verify a cursor. Returns null if invalid or tampered.
 */
export function decodeCursor(cursor: string, secret: string): CursorPayload | null {
  try {
    const dotIdx = cursor.lastIndexOf('.');
    if (dotIdx < 0) return null;
    const data = cursor.slice(0, dotIdx);
    const sig = cursor.slice(dotIdx + 1);
    const expected = createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const json = Buffer.from(data, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CursorPayload).score !== 'number' ||
      typeof (parsed as CursorPayload).name !== 'string' ||
      typeof (parsed as CursorPayload).id !== 'string'
    ) {
      return null;
    }
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

/**
 * Return the cursor secret to use. Prefers PULSE_CURSOR_SECRET env var.
 * Falls back to a per-org deterministic seed when env var is absent.
 * See module JSDoc for trade-off rationale.
 */
function getCursorSecret(orgId: string): string {
  const envSecret = process.env.PULSE_CURSOR_SECRET;
  if (envSecret) return envSecret;
  // Fallback: deterministic, org-scoped seed. Not a production secret, but
  // prevents cross-org cursor reuse. Log a warning to alert operators.
  console.warn('[clientPulseHighRisk] PULSE_CURSOR_SECRET is not set — using per-org fallback seed. Set PULSE_CURSOR_SECRET in production.');
  return createHash('sha256').update(`clientpulse-cursor-fallback:${orgId}`).digest('hex');
}

// ── formatLastAction ──────────────────────────────────────────────────────────

/** Server-formats last action text: "<actionType> · Nd ago" or null. */
export function formatLastAction(
  actionType: string | null,
  completedAt: Date | null,
): string | null {
  if (!actionType || !completedAt) return null;
  const nowMs = Date.now();
  const daysAgo = Math.floor((nowMs - completedAt.getTime()) / (1000 * 60 * 60 * 24));
  return `${actionType} · ${daysAgo}d ago`;
}

// ── getPrioritisedClients ────────────────────────────────────────────────────

const SPARKLINE_TIMEOUT_MS = 2000;

/** Batch query all health data for the org, returning rows sorted by priority. */
export async function getPrioritisedClients(
  orgId: string,
  dbClient: typeof db = db,
): Promise<ClientRow[]> {
  // ── 1. Latest health snapshot per subaccount ──────────────────────────────
  // Use a lateral/window approach: distinct on subaccount_id, ordered by observed_at DESC.
  // Drizzle doesn't support DISTINCT ON, so we use a raw SQL fragment.
  const latestSnapshots = await dbClient.execute<{
    subaccount_id: string;
    score: number;
    observed_at: Date;
  }>(sql`
    SELECT DISTINCT ON (hs.subaccount_id)
      hs.subaccount_id,
      hs.score,
      hs.observed_at
    FROM client_pulse_health_snapshots hs
    WHERE hs.organisation_id = ${orgId}
    ORDER BY hs.subaccount_id, hs.observed_at DESC
  `);

  const latestSnapshotRows = latestSnapshots as unknown as Array<{ subaccount_id: string; score: number; observed_at: Date }>;
  if (latestSnapshotRows.length === 0) return [];

  const subIds = latestSnapshotRows.map(r => r.subaccount_id);
  const scoreBySubId = new Map<string, number>(
    latestSnapshotRows.map(r => [r.subaccount_id, r.score]),
  );

  // ── 2. Latest churn assessment (band) per subaccount ─────────────────────
  const latestAssessments = await dbClient.execute<{
    subaccount_id: string;
    band: string;
  }>(sql`
    SELECT DISTINCT ON (ca.subaccount_id)
      ca.subaccount_id,
      ca.band
    FROM client_pulse_churn_assessments ca
    WHERE ca.organisation_id = ${orgId}
      AND ca.subaccount_id = ANY(${subIds})
    ORDER BY ca.subaccount_id, ca.observed_at DESC
  `);

  const bandBySubId = new Map<string, string>(
    (latestAssessments as unknown as Array<{ subaccount_id: string; band: string }>).map(r => [r.subaccount_id, r.band]),
  );

  // ── 3. Score 7 days ago per subaccount (for delta) ────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oldSnapshots = await dbClient.execute<{
    subaccount_id: string;
    score: number;
  }>(sql`
    SELECT DISTINCT ON (hs.subaccount_id)
      hs.subaccount_id,
      hs.score
    FROM client_pulse_health_snapshots hs
    WHERE hs.organisation_id = ${orgId}
      AND hs.subaccount_id = ANY(${subIds})
      AND hs.observed_at <= ${sevenDaysAgo}
    ORDER BY hs.subaccount_id, hs.observed_at DESC
  `);

  const oldScoreBySubId = new Map<string, number>(
    (oldSnapshots as unknown as Array<{ subaccount_id: string; score: number }>).map(r => [r.subaccount_id, r.score]),
  );

  // ── 4. Sparkline: one batched query, 4 weekly buckets over last 28 days ──
  // Returns one row per (subaccount_id, week_bucket) with AVG score.
  let sparklineMap = new Map<string, number[]>();
  try {
    const sparklineResult = await Promise.race([
      dbClient.execute<{
        subaccount_id: string;
        week_bucket: string;
        avg_score: number;
      }>(sql`
        SELECT
          hs.subaccount_id,
          DATE_TRUNC('week', hs.observed_at) AS week_bucket,
          AVG(hs.score)::int                 AS avg_score
        FROM client_pulse_health_snapshots hs
        WHERE hs.organisation_id = ${orgId}
          AND hs.subaccount_id = ANY(${subIds})
          AND hs.observed_at >= NOW() - INTERVAL '28 days'
        GROUP BY hs.subaccount_id, week_bucket
        ORDER BY hs.subaccount_id, week_bucket ASC
      `),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SPARKLINE_TIMEOUT')), SPARKLINE_TIMEOUT_MS),
      ),
    ]);

    const sparklineRows = sparklineResult as unknown as Array<{ subaccount_id: string; week_bucket: string; avg_score: number }>;
    for (const row of sparklineRows) {
      const existing = sparklineMap.get(row.subaccount_id) ?? [];
      existing.push(row.avg_score);
      sparklineMap.set(row.subaccount_id, existing);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SPARKLINE_TIMEOUT') {
      console.warn('[clientPulseHighRisk] sparkline query timed out — returning empty sparklines');
    } else {
      console.warn('[clientPulseHighRisk] sparkline query failed:', msg);
    }
    // Leave sparklineMap empty — rows will get sparklineWeekly: []
  }

  // ── 5. Last completed/approved action per subaccount (batch) ─────────────
  const lastActionRows = await dbClient.execute<{
    subaccount_id: string;
    action_type: string;
    executed_at: Date | null;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (a.subaccount_id)
      a.subaccount_id,
      a.action_type,
      a.executed_at,
      a.created_at
    FROM actions a
    WHERE a.organisation_id = ${orgId}
      AND a.subaccount_id = ANY(${subIds})
      AND a.status IN ('completed', 'approved')
    ORDER BY a.subaccount_id, a.created_at DESC
  `);

  const lastActionBySubId = new Map<string, { actionType: string; completedAt: Date }>(
    (lastActionRows as unknown as Array<{ subaccount_id: string; action_type: string; executed_at: Date | null; created_at: Date }>).map(r => [
      r.subaccount_id,
      {
        actionType: r.action_type,
        completedAt: r.executed_at ?? r.created_at,
      },
    ]),
  );

  // ── 6. hasPendingIntervention: EXISTS on review_items per subaccount ───────
  const pendingReviewRows = await dbClient.execute<{
    subaccount_id: string;
  }>(sql`
    SELECT DISTINCT ri.subaccount_id
    FROM review_items ri
    WHERE ri.organisation_id = ${orgId}
      AND ri.subaccount_id = ANY(${subIds})
      AND ri.review_status IN ('pending', 'edited_pending')
  `);

  const hasPendingSet = new Set<string>(
    (pendingReviewRows as unknown as Array<{ subaccount_id: string }>).map(r => r.subaccount_id),
  );

  // ── 7. Subaccount names ───────────────────────────────────────────────────
  const subRows = await dbClient
    .select({ id: subaccounts.id, name: subaccounts.name })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.organisationId, orgId),
        inArray(subaccounts.id, subIds),
        isNull(subaccounts.deletedAt),
      ),
    );

  const nameBySubId = new Map<string, string>(subRows.map(r => [r.id, r.name]));

  // ── 8. Assemble rows ──────────────────────────────────────────────────────
  const rows: ClientRow[] = [];
  for (const subId of subIds) {
    const healthScore = scoreBySubId.get(subId) ?? 0;
    const dbBand = bandBySubId.get(subId) ?? 'watch';
    const healthBand = mapDbBandToApi(dbBand);
    const oldScore = oldScoreBySubId.get(subId);
    const healthScoreDelta7d = oldScore != null ? healthScore - oldScore : 0;
    const sparklineWeekly = sparklineMap.get(subId) ?? [];
    const lastAction = lastActionBySubId.get(subId) ?? null;
    const lastActionText = lastAction
      ? formatLastAction(lastAction.actionType, lastAction.completedAt)
      : null;
    const hasPendingIntervention = hasPendingSet.has(subId);
    const subaccountName = nameBySubId.get(subId) ?? subId;

    rows.push({
      subaccountId: subId,
      subaccountName,
      healthScore,
      healthBand,
      healthScoreDelta7d,
      sparklineWeekly,
      lastActionText,
      hasPendingIntervention,
      drilldownUrl: `/clientpulse/clients/${subId}`,
    });
  }

  // Sort deterministically
  rows.sort(compareRows);

  return rows;
}

// ── applyFilters ─────────────────────────────────────────────────────────────

/**
 * Pure: filter rows by band and optional substring search.
 * band='all' (default) excludes healthy.
 * band='healthy' returns ONLY healthy.
 * Other band values filter to that band only.
 */
export function applyFilters(
  rows: ClientRow[],
  params: { band?: string; q?: string },
): ClientRow[] {
  const band = params.band ?? 'all';
  const q = params.q?.trim().toLowerCase() ?? '';

  let result = rows;

  // Band filter
  if (band === 'all') {
    result = result.filter(r => r.healthBand !== 'healthy');
  } else {
    const apiBand = band as ApiBand;
    result = result.filter(r => r.healthBand === apiBand);
  }

  // Substring search (case-insensitive)
  if (q) {
    result = result.filter(r => r.subaccountName.toLowerCase().includes(q));
  }

  return result;
}

// ── applyPagination ──────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 7;
const MAX_LIMIT = 25;

/**
 * Pure: apply cursor-based pagination and return the page slice + nextCursor.
 * Cursor is HMAC-signed against the orgId-derived secret (or env secret).
 * Invalid cursors return an error signal (null rows) — caller must 400.
 */
export function applyPagination(
  rows: ClientRow[],
  params: { limit: number; cursor?: string | null; orgId?: string },
): { rows: ClientRow[]; nextCursor: string | null; hasMore: boolean; cursorError?: true } {
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const secret = getCursorSecret(params.orgId ?? 'anonymous');

  let startIndex = 0;

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor, secret);
    if (!decoded) {
      return { rows: [], nextCursor: null, hasMore: false, cursorError: true };
    }
    // Find the row after the cursor position using composite key
    const idx = rows.findIndex(
      r =>
        r.healthScore === decoded.score &&
        r.subaccountName === decoded.name &&
        r.subaccountId === decoded.id,
    );
    if (idx < 0) {
      // Cursor row no longer in result set — start from beginning
      startIndex = 0;
    } else {
      startIndex = idx + 1;
    }
  }

  const page = rows.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < rows.length;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = encodeCursor(
      { score: last.healthScore, name: last.subaccountName, id: last.subaccountId },
      secret,
    );
  }

  return { rows: page, nextCursor, hasMore };
}
