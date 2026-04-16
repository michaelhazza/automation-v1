/**
 * Delivery Channels route
 *
 * GET /api/subaccounts/:subaccountId/integrations/available-channels
 *
 * Returns the set of delivery channels that are currently available for the
 * given subaccount, based on connected integrations and portal mode.
 *
 * Spec: docs/memory-and-briefings-spec.md §10.4 (S22)
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { getAvailableChannels } from '../services/deliveryChannelService.js';

const router = Router();

/**
 * GET /api/subaccounts/:subaccountId/integrations/available-channels
 *
 * Response shape: { email: boolean; portal: boolean; slack: boolean }
 *
 * email is always true — inbox is always-on for every subaccount.
 * portal is true when portalMode is 'transparency' or 'collaborative'.
 * slack is true when an active Slack integration connection exists.
 */
router.get(
  '/api/subaccounts/:subaccountId/integrations/available-channels',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;

    await resolveSubaccount(subaccountId, orgId);
    const channels = await getAvailableChannels(subaccountId, orgId);
    return res.json(channels);
  }),
);

export default router;
