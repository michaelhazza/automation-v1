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

  return {
    type: asStringArray(query.type),
    status: asStringArray(query.status),
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
    agentId: typeof query.agentId === 'string' ? query.agentId : undefined,
    actorId: typeof query.actorId === 'string' ? query.actorId : undefined,
    severity: asStringArray(query.severity),
    assignee: typeof query.assignee === 'string' ? query.assignee : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    sort: (['newest', 'oldest', 'severity', 'attention_first'].includes(query.sort as string)
      ? (query.sort as ActivityFilters['sort'])
      : undefined),
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
    const { items, nextCursor } = await listActivityItems(filters, scope);
    res.json({ items, nextCursor: encodeCursor(nextCursor) });
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
    const { items, nextCursor } = await listActivityItems(filters, scope);
    res.json({ data: { items, nextCursor: encodeCursor(nextCursor) }, serverTimestamp: new Date().toISOString() });
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
    const { items, nextCursor } = await listActivityItems(filters, scope);
    res.json({ items, nextCursor: encodeCursor(nextCursor) });
  }),
);

export default router;
