import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { listActivityItems } from '../services/activityService.js';
import type { ActivityCursor, ActivityFilters, ActivityScope } from '../services/activityService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** DE-CR-7: decode an opaque base64 cursor passed by the client. Bad cursors
 *  silently degrade to "no cursor" so a stale URL doesn't 400 the page. */
function decodeCursor(raw: unknown): ActivityCursor | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed?.createdAt !== 'string' || typeof parsed?.id !== 'string') return undefined;
    if (Number.isNaN(new Date(parsed.createdAt).getTime())) return undefined;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

/** Encode the cursor as base64-JSON for the response. */
function encodeCursor(cursor: ActivityCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64');
}

function parseFilters(query: Record<string, unknown>): ActivityFilters {
  const asStringArray = (v: unknown): string[] | undefined => {
    if (typeof v === 'string' && v.length > 0) return v.split(',');
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    return undefined;
  };

  // C1 (ui-consolidation-operate): sortKey/sortDir take precedence over legacy `sort` enum.
  // If both arrive, sortKey/sortDir wins per spec §4.1.
  const sortKey = (['createdAt', 'severity'].includes(query.sortKey as string)
    ? (query.sortKey as ActivityFilters['sortKey'])
    : undefined);
  const sortDir = (['asc', 'desc'].includes(query.sortDir as string)
    ? (query.sortDir as ActivityFilters['sortDir'])
    : undefined);

  return {
    type: asStringArray(query.type),
    status: asStringArray(query.status),
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
    agentId: typeof query.agentId === 'string' ? query.agentId : undefined,
    actorId: typeof query.actorId === 'string' ? query.actorId : undefined,
    // C1: multi-select actor display-name filter (spec §4.1)
    actor: asStringArray(query.actor),
    // C1: multi-select subaccount ID filter (spec §4.1)
    subaccount: asStringArray(query.subaccount),
    severity: asStringArray(query.severity),
    assignee: typeof query.assignee === 'string' ? query.assignee : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    // Legacy sort enum kept for backward compat; sortKey/sortDir wins when both present
    sort: (!sortKey && ['newest', 'oldest', 'severity', 'attention_first'].includes(query.sort as string)
      ? (query.sort as ActivityFilters['sort'])
      : undefined),
    sortKey,
    sortDir,
    limit: typeof query.limit === 'string' ? Math.max(1, Math.min(200, parseInt(query.limit, 10) || 50)) : undefined,
    cursor: decodeCursor(query.cursor),
  };
}

// ---------------------------------------------------------------------------
// Subaccount-scoped activity
// ---------------------------------------------------------------------------

router.get(
  '/api/subaccounts/:subaccountId/activity',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const organisationId = req.orgId!;
    await resolveSubaccount(subaccountId, organisationId);

    const filters = parseFilters(req.query as Record<string, unknown>);
    const scope: ActivityScope = { type: 'subaccount', subaccountId, orgId: organisationId };
    const { items, nextCursor, filterOptions } = await listActivityItems(filters, scope);
    // C1 INVARIANT: Activity data is user-scoped + RLS-filtered — MUST NOT be shared-cached.
    // Never add public or s-maxage here. This prevents future infra changes (CDN, proxy cache)
    // from leaking user-specific data across sessions.
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ items, nextCursor: encodeCursor(nextCursor), filterOptions });
  }),
);

// ---------------------------------------------------------------------------
// Org-scoped activity
// ---------------------------------------------------------------------------

router.get(
  '/api/activity',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    const filters = parseFilters(req.query as Record<string, unknown>);
    const subaccountId = typeof req.query.subaccountId === 'string' ? req.query.subaccountId : undefined;
    const scope: ActivityScope = { type: 'org', orgId: organisationId, subaccountId };
    const { items, nextCursor, filterOptions } = await listActivityItems(filters, scope);
    // C1 INVARIANT: Activity data is user-scoped + RLS-filtered — MUST NOT be shared-cached.
    // Never add public or s-maxage here. This prevents future infra changes (CDN, proxy cache)
    // from leaking user-specific data across sessions.
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ data: { items, nextCursor: encodeCursor(nextCursor), filterOptions }, serverTimestamp: new Date().toISOString() });
  }),
);

// ---------------------------------------------------------------------------
// System-scoped activity
// ---------------------------------------------------------------------------

router.get(
  '/api/system/activity',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const organisationId = typeof req.query.organisationId === 'string' ? req.query.organisationId : undefined;
    const scope: ActivityScope = { type: 'system', organisationId };
    const { items, nextCursor, filterOptions } = await listActivityItems(filters, scope);
    // C1 INVARIANT: Activity data is user-scoped + RLS-filtered — MUST NOT be shared-cached.
    // Never add public or s-maxage here. This prevents future infra changes (CDN, proxy cache)
    // from leaking user-specific data across sessions.
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ items, nextCursor: encodeCursor(nextCursor), filterOptions });
  }),
);

export default router;
