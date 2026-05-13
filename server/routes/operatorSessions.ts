// operatorSessions.ts — progress polling route for operator-managed chain links.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.9
//
// R2-F1: subaccountId is in the path so setOrgAndSubaccountGUC can be called
// before reading the dual-GUC RLS-protected operator_runs table.
//
// Route guard: authenticate + requireOrgPermission(AGENTS_VIEW) + resolveSubaccount.
// Response: { operatorRunId, chainSeq, status, lastProgressAt, stepCount, summary? }
// 404 on row-not-found (consistent with IEE pattern; not 403 to avoid leaking existence).

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { operatorSessionService } from '../services/operatorSessionService.js';

const router = Router();

// GET /api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress
//
// R2-F1: subaccountId in path → dual-GUC is set before reading operator_runs.
// Auth: authenticate + AGENTS_VIEW (read-level; parallel to IEE progress route).
// A row whose subaccount_id does not match the path param returns 404 (not 403)
// to avoid leaking existence — consistent with the existing IEE route.
router.get(
  '/api/subaccounts/:subaccountId/operator-sessions/:operatorRunId/progress',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, operatorRunId } = req.params;
    const orgId = req.orgId!;

    await resolveSubaccount(subaccountId, orgId);

    const row = await operatorSessionService.getRunProgress({ operatorRunId, subaccountId, orgId });

    if (!row) {
      throw { statusCode: 404, message: 'operator_run not found', errorCode: 'OPERATOR_RUN_NOT_FOUND' };
    }

    res.json({
      operatorRunId: row.id,
      chainSeq: row.chainSeq,
      status: row.status,
      lastProgressAt: row.lastProgressAt?.toISOString() ?? null,
      stepCount: row.stepCount,
      ...(row.failureReason ? { summary: row.failureReason } : {}),
    });
  }),
);

export default router;
