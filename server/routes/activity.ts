import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { listActivityItems } from '../services/activityService.js';
import type { ActivityFilters, ActivityScope } from '../services/activityService.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    severity: asStringArray(query.severity),
    assignee: typeof query.assignee === 'string' ? query.assignee : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    sort: (['newest', 'oldest', 'severity', 'attention_first'].includes(query.sort as string)
      ? (query.sort as ActivityFilters['sort'])
      : undefined),
    limit: typeof query.limit === 'string' ? Math.max(1, Math.min(200, parseInt(query.limit, 10) || 50)) : undefined,
    offset: typeof query.offset === 'string' ? Math.max(0, parseInt(query.offset, 10) || 0) : undefined,
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
    const result = await listActivityItems(filters, scope);
    res.json(result);
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
    const result = await listActivityItems(filters, scope);
    res.json(result);
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
    const result = await listActivityItems(filters, scope);
    res.json(result);
  }),
);

export default router;
