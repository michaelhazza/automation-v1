/**
 * Workflow Gates routes — admin operations on workflow step gates.
 *
 * Currently exposes:
 *   POST /api/tasks/:taskId/gates/:gateId/refresh-pool
 *       Re-resolves the approver pool for an open approval gate.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowGateRefreshPoolService } from '../services/workflowGateRefreshPoolService.js';

const router = Router();

/**
 * POST /api/tasks/:taskId/gates/:gateId/refresh-pool
 *
 * Re-resolves the approver pool for the specified open gate.
 * Only org admins or users with WORKFLOW_TEMPLATES_WRITE (admin-level action)
 * are permitted.
 *
 * 200: { refreshed: true, pool_size: number }
 *    | { refreshed: false, reason: string }
 * 403: { error: 'forbidden' }    (from requireOrgPermission)
 * 404: returned inside service when run/gate/definition not found
 */
router.post(
  '/api/tasks/:taskId/gates/:gateId/refresh-pool',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_WRITE),
  asyncHandler(async (req, res) => {
    const { taskId, gateId } = req.params;

    const result = await WorkflowGateRefreshPoolService.refreshPool(
      taskId,
      gateId,
      req.orgId!,
      null,
      req.user!.id
    );

    res.json(result);
  })
);

export default router;
