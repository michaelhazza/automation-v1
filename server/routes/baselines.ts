import { Router } from 'express';
import { eq, and, sql, desc } from 'drizzle-orm';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { subaccountBaselines, subaccountBaselineMetrics } from '../db/schema/index.js';
import { manualBaselineFormSchema, adminResetSchema } from '../../shared/schemas/baselineManualForm.js';
import { captureBaselineService } from '../services/captureBaselineService.js';

const router = Router();

/**
 * GET /api/subaccounts/:subaccountId/baseline
 * Returns the active baseline record (status + confidence) for a subaccount.
 * Returns 404 if no baseline row exists yet.
 */
router.get(
  '/api/subaccounts/:subaccountId/baseline',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const orgDb = getOrgScopedDb('baselines.getActive');
    const [row] = await orgDb
      .select({
        id: subaccountBaselines.id,
        status: subaccountBaselines.status,
        confidence: subaccountBaselines.confidence,
        source: subaccountBaselines.source,
        capturedAt: subaccountBaselines.capturedAt,
        failureReason: subaccountBaselines.failureReason,
      })
      .from(subaccountBaselines)
      .where(
        and(
          eq(subaccountBaselines.subaccountId, subaccountId),
          eq(subaccountBaselines.organisationId, req.orgId!),
          sql`status <> 'reset'`,
        ),
      )
      .orderBy(desc(subaccountBaselines.baselineVersion))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'No baseline found' });
      return;
    }

    const metrics = await orgDb
      .select({
        metricSlug: subaccountBaselineMetrics.metricSlug,
        value: subaccountBaselineMetrics.value,
        source: subaccountBaselineMetrics.source,
        capturedAt: subaccountBaselineMetrics.capturedAt,
      })
      .from(subaccountBaselineMetrics)
      .where(eq(subaccountBaselineMetrics.baselineId, row.id));

    res.json({ ...row, metrics });
  }),
);

/**
 * POST /api/subaccounts/:subaccountId/baseline/manual
 * Upserts manual metric values onto the active baseline.
 * Delegates entirely to captureBaselineService.runManual (§5.2 single-writer rule).
 */
router.post(
  '/api/subaccounts/:subaccountId/baseline/manual',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const parsed = manualBaselineFormSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    await captureBaselineService.runManual({
      organisationId: req.orgId!,
      subaccountId,
      userId: req.user!.id,
      metricInputs: parsed.data.metrics,
    });

    res.json({ ok: true });
  }),
);

/**
 * POST /api/admin/subaccounts/:subaccountId/baseline/reset
 * Sysadmin-only. Marks the active baseline as 'reset', inserts a new pending baseline
 * at baseline_version+1. Delegates entirely to captureBaselineService.adminReset
 * (§5.2 single-writer rule; §6 single-transaction history-preservation invariant).
 *
 * The service resolves the target organisation internally via `withAdminConnection`
 * + `SET LOCAL ROLE admin_role` so the cross-org lookup bypasses the FORCE-RLS
 * policy on `subaccount_baselines`. The route does not need an org-id lookup of
 * its own.
 */
router.post(
  '/api/admin/subaccounts/:subaccountId/baseline/reset',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;

    const parsed = adminResetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    await captureBaselineService.adminReset({
      subaccountId,
      userId: req.user!.id,
      reason: parsed.data.reason,
    });

    res.json({ ok: true });
  }),
);

export default router;
