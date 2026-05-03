/**
 * Workflow Gates routes — admin operations on workflow step gates.
 *
 * Currently exposes:
 *   POST /api/tasks/:taskId/gates/:gateId/refresh-pool
 *       Re-resolves the approver pool for an open approval gate.
 */

import { Router } from 'express';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowGateRefreshPoolService } from '../services/workflowGateRefreshPoolService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { db } from '../db/index.js';
import { workflowStepGates, workflowRuns } from '../db/schema/index.js';

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

/**
 * GET /api/tasks/:taskId/ask/:stepId/autofill
 *
 * Returns pre-fill values for an Ask form step from the most recent prior
 * completed submission (key+type match invariant applies).
 *
 * 200: { values: AskFormValues }
 */
router.get(
  '/api/tasks/:taskId/ask/:stepId/autofill',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId, stepId } = req.params;

    // Find the run for this task
    const [run] = await db
      .select({
        templateVersionId: workflowRuns.templateVersionId,
        subaccountId: workflowRuns.subaccountId,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.taskId, taskId),
          eq(workflowRuns.organisationId, req.orgId!),
        ),
      )
      .limit(1);

    if (!run) {
      res.json({ values: {} });
      return;
    }

    // Lazy import to avoid circular dep at module load time
    const { AskFormAutoFillService } = await import('../services/askFormAutoFillService.js');
    const values = await AskFormAutoFillService.getAutoFill(
      run.templateVersionId,
      stepId,
      req.orgId!,
      [], // currentFields empty — pure key+type guard still applies from stored schema
    );

    res.json({ values });
  }),
);

/**
 * GET /api/subaccounts/:subaccountId/ask-gates/count
 *
 * Returns the count of open Ask gates for the subaccount.
 * Used by the sidebar badge.
 *
 * 200: { count: number }
 */
router.get(
  '/api/subaccounts/:subaccountId/ask-gates/count',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKFLOW_RUNS_READ),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    // Find open ask gates via their workflow runs scoped to this subaccount
    const openRuns = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.organisationId, req.orgId!),
          eq(workflowRuns.subaccountId, subaccountId),
        ),
      );

    if (openRuns.length === 0) {
      res.json({ count: 0 });
      return;
    }

    const runIds = openRuns.map((r) => r.id);
    const openGates = await db
      .select({ id: workflowStepGates.id })
      .from(workflowStepGates)
      .where(
        and(
          eq(workflowStepGates.gateKind, 'ask'),
          eq(workflowStepGates.organisationId, req.orgId!),
          isNull(workflowStepGates.resolvedAt),
          inArray(workflowStepGates.workflowRunId, runIds),
        ),
      );

    res.json({ count: openGates.length });
  }),
);

export default router;
