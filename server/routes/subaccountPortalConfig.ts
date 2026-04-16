/**
 * Subaccount portal config route (S16 + S17)
 *
 * PATCH /api/subaccounts/:subaccountId/portal — update portalMode +
 * portalFeatures. Distinct from server/routes/subaccounts.ts; lives here so
 * the portal-specific surface can evolve independently.
 *
 * Spec: docs/memory-and-briefings-spec.md §6.3 (S16, S17)
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { updatePortalConfig, getPortalConfig } from '../services/portalConfigService.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/portal',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, orgId);

    const result = await getPortalConfig(subaccountId, orgId);
    return res.json(result);
  }),
);

router.patch(
  '/api/subaccounts/:subaccountId/portal',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, orgId);

    const { portalMode, portalFeatures } = req.body ?? {};

    const result = await updatePortalConfig({
      subaccountId,
      organisationId: orgId,
      actorUserId: userId,
      portalMode: portalMode,
      portalFeatures: portalFeatures,
    });

    return res.json(result);
  }),
);

export default router;
