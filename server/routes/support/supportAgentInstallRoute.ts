import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { supportAgentInstallService } from '../../services/supportAgentInstallService.js';

const router = Router();

// POST /api/support/subaccounts/:subaccountId/support-agent/install
// Auth: authenticate + requireOrgPermission('support.inbox.configure')
// Body: {}
// Response: { subaccountAgentId: string }
// Errors: 409 already_installed
router.post(
  '/subaccounts/:subaccountId/support-agent/install',
  authenticate,
  requireOrgPermission('support.inbox.configure'),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const organisationId = req.orgId!;
    const actorUserId = req.user!.id;

    const result = await supportAgentInstallService.install({
      subaccountId,
      organisationId,
      actorUserId,
    });

    res.status(200).json(result);
  }),
);

export default router;
