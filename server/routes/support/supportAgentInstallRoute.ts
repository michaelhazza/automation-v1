import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { resolveSubaccount } from '../../lib/resolveSubaccount.js';
import { supportAgentInstallService } from '../../services/supportAgentInstallService.js';

const router = Router();

// POST /api/support/subaccounts/:subaccountId/support-agent/install
// Auth: authenticate + requireOrgPermission('support.inbox.configure')
// Body: {}
// Response: { subaccountAgentId: string }
// Errors: 404 subaccount not found / soft-deleted; 409 already_installed
router.post(
  '/subaccounts/:subaccountId/support-agent/install',
  authenticate,
  requireOrgPermission('support.inbox.configure'),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    const actorUserId = req.user!.id;

    // Tenant-isolation + soft-delete gate before consuming the path param.
    const subaccount = await resolveSubaccount(req.params.subaccountId, organisationId);

    const result = await supportAgentInstallService.install({
      subaccountId: subaccount.id,
      organisationId,
      actorUserId,
    });

    res.status(200).json(result);
  }),
);

export default router;
