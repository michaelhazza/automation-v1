import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { subaccountBaselines, subaccountBaselineMetrics } from '../db/schema/index.js';
import { manualBaselineFormSchema, adminResetSchema } from '../../shared/schemas/baselineManualForm.js';
import { captureBaselineService } from '../services/captureBaselineService.js';

const router = Router();

function handleServiceError(err: unknown, res: import('express').Response): boolean {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const e = err as { statusCode: number; errorCode: string; message?: string };
    res.status(e.statusCode).json({ error: e.message ?? e.errorCode });
    return true;
  }
  return false;
}

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

    const [row] = await db
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
      .orderBy(subaccountBaselines.createdAt)
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'No baseline found' });
      return;
    }

    const metrics = await db
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

    try {
      await captureBaselineService.runManual({
        organisationId: req.orgId!,
        subaccountId,
        userId: req.user!.id,
        metricInputs: parsed.data.metrics,
      });
    } catch (err) {
      if (!handleServiceError(err, res)) throw err;
      return;
    }

    res.json({ ok: true });
  }),
);

/**
 * POST /api/admin/subaccounts/:subaccountId/baseline/reset
 * Sysadmin-only. Marks the active baseline as 'reset', inserts a new pending baseline
 * at baseline_version+1. Delegates entirely to captureBaselineService.adminReset
 * (§5.2 single-writer rule; §6 single-transaction history-preservation invariant).
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

    // Look up organisationId — sysadmin routes bypass org-scoped middleware.
    const [sa] = await db
      .select({ organisationId: subaccountBaselines.organisationId })
      .from(subaccountBaselines)
      .where(eq(subaccountBaselines.subaccountId, subaccountId))
      .orderBy(subaccountBaselines.createdAt)
      .limit(1);

    if (!sa) {
      res.status(404).json({ error: 'No baseline found for this subaccount' });
      return;
    }

    try {
      await captureBaselineService.adminReset({
        organisationId: sa.organisationId,
        subaccountId,
        userId: req.user!.id,
        reason: parsed.data.reason,
      });
    } catch (err) {
      if (!handleServiceError(err, res)) throw err;
      return;
    }

    res.json({ ok: true });
  }),
);

export default router;
