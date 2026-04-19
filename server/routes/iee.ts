// ---------------------------------------------------------------------------
// IEE — Integrated Execution Environment routes.
// Spec §11.7 (per-run Cost panel) + §11.8 (Usage Explorer).
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { getIeeRunCost, getIeeRunProgress, queryIeeUsage, type UsageScope } from '../services/ieeUsageService.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Per-run Cost panel — backs the run-detail UI
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/api/iee/runs/:ieeRunId/cost',
  authenticate,
  asyncHandler(async (req, res) => {
    const ieeRunId = req.params.ieeRunId;
    const breakdown = await getIeeRunCost(ieeRunId, req.orgId!);
    res.json(breakdown);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// IEE Phase 0 — progress polling + full-row fetch.
// Backs the "Delegated" run UI state during active delegation. Light client-
// side polling (every 3–5s) is the Phase 0 substitute for full WebSocket
// streaming — see docs/iee-delegation-lifecycle-spec.md Step 6.
// Also addresses audit finding: no single-row iee_runs endpoint existed,
// forcing consumers to query the DB directly.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/api/iee/runs/:ieeRunId/progress',
  authenticate,
  asyncHandler(async (req, res) => {
    const progress = await getIeeRunProgress(req.params.ieeRunId, req.orgId!);
    if (!progress) {
      throw { statusCode: 404, message: 'iee_run not found', errorCode: 'IEE_RUN_NOT_FOUND' };
    }
    res.json(progress);
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Usage Explorer — single endpoint, three scope variants
// ─────────────────────────────────────────────────────────────────────────────

function parseUsageQuery(req: import('express').Request): {
  from: Date; to: Date;
  agentIds?: string[]; subaccountIds?: string[]; statuses?: any[]; types?: any[];
  failureReasons?: string[]; minCostCents?: number; search?: string;
  sort?: any; order?: any; limit?: number; cursor?: string | null;
} {
  const q = req.query;
  const fromStr = typeof q.from === 'string' ? q.from : undefined;
  const toStr = typeof q.to === 'string' ? q.to : undefined;
  if (!fromStr || !toStr) {
    throw { statusCode: 400, message: 'from and to query params are required (ISO date)' };
  }
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw { statusCode: 400, message: 'invalid from/to' };
  }
  const split = (s: unknown) => (typeof s === 'string' && s.length > 0 ? s.split(',') : undefined);
  return {
    from, to,
    agentIds:       split(q.agentIds),
    subaccountIds:  split(q.subaccountIds),
    statuses:       split(q.statuses),
    types:          split(q.types),
    failureReasons: split(q.failureReasons),
    minCostCents:   typeof q.minCostCents === 'string' ? Number(q.minCostCents) : undefined,
    search:         typeof q.search === 'string' ? q.search : undefined,
    sort:           typeof q.sort === 'string' ? q.sort : undefined,
    order:          typeof q.order === 'string' ? q.order : undefined,
    limit:          typeof q.limit === 'string' ? Number(q.limit) : undefined,
    cursor:         typeof q.cursor === 'string' ? q.cursor : null,
  };
}

// System scope — system_admin only
router.get(
  '/api/iee/usage/system',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const result = await queryIeeUsage({ scope: 'system' as UsageScope, ...parseUsageQuery(req) });
    res.json(result);
  }),
);

// Org scope
router.get(
  '/api/orgs/:orgId/iee/usage',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.IEE_USAGE_VIEW),
  asyncHandler(async (req, res) => {
    // guard-ignore-next-line: no-direct-role-checks reason="cross-org access control — org-scoped middleware already gates same-org; this guard allows system_admin to query any org"
    if (req.params.orgId !== req.orgId && req.user!.role !== 'system_admin') {
      throw { statusCode: 403, message: 'cannot view another org' };
    }
    const result = await queryIeeUsage({
      scope: 'organisation',
      organisationId: req.params.orgId,
      ...parseUsageQuery(req),
    });
    res.json(result);
  }),
);

// Subaccount scope
router.get(
  '/api/subaccounts/:subaccountId/iee/usage',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.IEE_USAGE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const result = await queryIeeUsage({
      scope: 'subaccount',
      organisationId: req.orgId!,
      subaccountId: req.params.subaccountId,
      ...parseUsageQuery(req),
    });
    res.json(result);
  }),
);

export default router;
