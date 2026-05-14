// adminIeeBrowserRollout.ts — POST /api/admin/iee-browser/rollout-approval/:subaccountId
//
// Auth: authenticate + requireRole('system_admin') + resolveSubaccount
//
// Sets rollout_approved for a subaccount's IEE browser settings.
// Audit row is inserted IN THE SAME TRANSACTION as the settings update
// (via tx.insert(auditEvents) inside the service — not via auditService.log()).
//
// Lazy-create: when expectedSettingsVersion === 0 + no row → INSERT defaults + approved.
// 409 on ETag conflict or lazy-create PK race (23505).

import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { subaccountIeeBrowserSettingsService } from '../services/subaccountIeeBrowserSettingsService.js';
import { rolloutBodySchema } from '../services/subaccountIeeBrowserSettingsServicePure.js';

const router = Router();

// POST /api/admin/iee-browser/rollout-approval/:subaccountId
router.post(
  '/api/admin/iee-browser/rollout-approval/:subaccountId',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const orgId = req.orgId!;
    const actorUserId = req.user!.id;

    await resolveSubaccount(subaccountId, orgId);

    const parsed = rolloutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw {
        statusCode: 400,
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const { approved, expectedSettingsVersion } = parsed.data;

    const updated = await subaccountIeeBrowserSettingsService.setRolloutApproval({
      orgId,
      subaccountId,
      approved,
      expectedSettingsVersion,
      actorUserId,
    });

    res.setHeader('ETag', `"${updated.settingsVersion}"`);
    res.json({
      subaccountId: updated.subaccountId,
      organisationId: updated.organisationId,
      status: updated.status,
      rolloutApproved: updated.rolloutApproved,
      browserProfileRetentionDays: updated.browserProfileRetentionDays,
      perTaskCostCeilingCents: updated.perTaskCostCeilingCents,
      perSubaccountDailyCostCeilingCents: updated.perSubaccountDailyCostCeilingCents,
      settingsVersion: updated.settingsVersion,
      updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : updated.updatedAt,
      updatedByUserId: updated.updatedByUserId,
    });
  }),
);

export default router;
