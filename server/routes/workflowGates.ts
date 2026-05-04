/**
 * Workflow Gate routes — gate-level operations.
 *
 * Spec: docs/workflows-dev-spec.md §5.1.2.
 *
 * POST /api/tasks/:taskId/gates/:gateId/refresh-pool
 *   Refreshes the approver pool snapshot on an open gate by re-running pool
 *   resolution against the step's approverGroup definition.
 *   Permission: org admin (req.user.role === 'org_admin' || 'system_admin')
 *   or subaccount admin (requireOrgPermission AGENTS_EDIT).
 *
 * Responses:
 *   200: { refreshed: boolean, pool_size: number, reason?: string }
 *   403: forbidden
 *   404: gate not found or already resolved
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowGateRefreshPoolService } from '../services/workflowGateRefreshPoolService.js';

const router = Router();

router.post(
  '/api/tasks/:taskId/gates/:gateId/refresh-pool',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, gateId } = req.params;
    const organisationId = req.orgId!;
    const requestingUserId = req.user!.id;

    const result = await WorkflowGateRefreshPoolService.refreshPool(
      gateId,
      taskId,
      organisationId,
      requestingUserId,
    );

    if (!result.found) {
      res.status(404).json({
        error: { code: 'gate_not_found', message: 'Gate not found' },
      });
      return;
    }

    if (!result.refreshed) {
      res.json({ refreshed: false, reason: result.reason, pool_size: result.poolSize });
      return;
    }

    res.json({ refreshed: true, pool_size: result.poolSize });
  }),
);

export default router;
