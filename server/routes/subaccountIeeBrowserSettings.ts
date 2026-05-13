// subaccountIeeBrowserSettings.ts — GET + PATCH for per-subaccount IEE browser settings.
//
// GET:  authenticate + AGENTS_VIEW + resolveSubaccount
//       Returns settings row or synthesised defaults (settingsVersion: 0 sentinel).
//       ETag header: "<settingsVersion>"
//
// PATCH: authenticate + OPERATOR_SETTINGS_WRITE + resolveSubaccount
//        Optimistic concurrency via expectedSettingsVersion in body.
//        Lazy-create: expectedSettingsVersion === 0 + no row → INSERT.
//        409 on ETag conflict or lazy-create PK race.
//        rolloutApproved is NOT accepted here.

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { subaccountIeeBrowserSettingsService } from '../services/subaccountIeeBrowserSettingsService.js';
import { patchBodySchema } from '../services/subaccountIeeBrowserSettingsServicePure.js';

const router = Router();

// GET /api/subaccounts/:id/iee-browser-settings
router.get(
  '/api/subaccounts/:id/iee-browser-settings',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const subaccountId = req.params.id;
    const orgId = req.orgId!;

    await resolveSubaccount(subaccountId, orgId);

    const settings = await subaccountIeeBrowserSettingsService.getSettings(orgId, subaccountId);

    res.setHeader('ETag', `"${settings.settingsVersion}"`);
    res.json({
      subaccountId: settings.subaccountId,
      organisationId: settings.organisationId,
      status: settings.status,
      rolloutApproved: settings.rolloutApproved,
      browserProfileRetentionDays: settings.browserProfileRetentionDays,
      perTaskCostCeilingCents: settings.perTaskCostCeilingCents,
      perSubaccountDailyCostCeilingCents: settings.perSubaccountDailyCostCeilingCents,
      settingsVersion: settings.settingsVersion,
      updatedAt: settings.updatedAt instanceof Date ? settings.updatedAt.toISOString() : settings.updatedAt,
      updatedByUserId: settings.updatedByUserId,
    });
  }),
);

// PATCH /api/subaccounts/:id/iee-browser-settings
router.patch(
  '/api/subaccounts/:id/iee-browser-settings',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.OPERATOR_SETTINGS_WRITE),
  asyncHandler(async (req, res) => {
    const subaccountId = req.params.id;
    const orgId = req.orgId!;
    const actorUserId = req.user!.id;

    await resolveSubaccount(subaccountId, orgId);

    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw {
        statusCode: 400,
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        errorCode: 'VALIDATION_ERROR',
      };
    }

    const { expectedSettingsVersion, ...patch } = parsed.data;

    const updated = await subaccountIeeBrowserSettingsService.updateSettings({
      orgId,
      subaccountId,
      patch,
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
