/**
 * Workflow Gate routes — gate-level operations.
 *
 * Spec: docs/workflows-dev-spec.md §5.1.2.
 *
 * GET  /api/tasks/:taskId/gates/:gateId
 *   Returns the gate row scoped to the caller's org and verifies the gate
 *   belongs to a run on the path task. Used by the Approval card to fetch
 *   the resolved approver-pool member IDs that the projection envelope only
 *   carries as size + fingerprint.
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
import { taskService } from '../services/taskService.js';
import { WorkflowGateRefreshPoolService } from '../services/workflowGateRefreshPoolService.js';
import { WorkflowStepGateService } from '../services/workflowStepGateService.js';
import { resolveActiveRunForTask } from '../services/workflowRunResolverService.js';

const router = Router();

router.get(
  '/api/tasks/:taskId/gates/:gateId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId, gateId } = req.params;
    const orgId = req.orgId!;

    if (!(await taskService.assertOrgOwnsTask(taskId, orgId))) {
      res.status(404).json({ error: 'gate_not_found' });
      return;
    }

    const gate = await WorkflowStepGateService.getGateById(gateId, orgId);
    if (!gate) {
      res.status(404).json({ error: 'gate_not_found' });
      return;
    }

    // Verify the gate belongs to the run on the path task — same 404 to avoid
    // disclosing existence of gates on other tasks in the org.
    const activeRunId = await resolveActiveRunForTask(taskId, orgId);
    if (!activeRunId || gate.workflowRunId !== activeRunId) {
      res.status(404).json({ error: 'gate_not_found' });
      return;
    }

    res.json({
      gateId: gate.id,
      stepId: gate.stepId,
      gateKind: gate.gateKind,
      status: gate.resolvedAt === null ? 'open' : 'resolved',
      approverPool: (gate.approverPoolSnapshot as string[] | null) ?? [],
      // resolutionReason holds the canonical decision label ('approved' | 'rejected' | etc.).
      // decidedBy is not stored on the gate row — it lives on workflow_step_reviews
      // and would require a join; the projection envelope already carries it from
      // the live socket so the GET endpoint does not need to surface it.
      decision: gate.resolutionReason,
      decidedAt: gate.resolvedAt,
    });
  }),
);

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
