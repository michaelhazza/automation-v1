import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { goalService } from '../services/goalService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

/**
 * GET /api/subaccounts/:subaccountId/goals
 * List all goals for a subaccount (flat list — client builds tree).
 */
router.get(
  '/api/subaccounts/:subaccountId/goals',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const rows = await goalService.listGoals(req.orgId!, subaccountId);
    res.json(rows);
  })
);

/**
 * POST /api/subaccounts/:subaccountId/goals
 * Create a goal.
 */
router.post(
  '/api/subaccounts/:subaccountId/goals',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const { title, description, parentGoalId, status, level, ownerAgentId, targetDate, position } = req.body as {
      title?: string;
      description?: string;
      parentGoalId?: string;
      status?: 'planned' | 'active' | 'completed' | 'archived';
      level?: 'mission' | 'objective' | 'key_result';
      ownerAgentId?: string;
      targetDate?: string;
      position?: number;
    };

    const goal = await goalService.createGoal(
      req.orgId!, subaccountId,
      { title: title!, description, parentGoalId, status, level, ownerAgentId, targetDate, position },
      req.user?.id,
    );

    res.status(201).json(goal);
  })
);

/**
 * GET /api/subaccounts/:subaccountId/goals/:goalId
 * Get a single goal with children count, linked tasks count, linked projects count.
 */
router.get(
  '/api/subaccounts/:subaccountId/goals/:goalId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const goal = await goalService.getGoal(req.orgId!, subaccountId, goalId);
    res.json(goal);
  })
);

/**
 * PATCH /api/subaccounts/:subaccountId/goals/:goalId
 * Update a goal.
 */
router.patch(
  '/api/subaccounts/:subaccountId/goals/:goalId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const { title, description, parentGoalId, status, level, ownerAgentId, targetDate, position } = req.body as {
      title?: string;
      description?: string;
      parentGoalId?: string | null;
      status?: 'planned' | 'active' | 'completed' | 'archived';
      level?: 'mission' | 'objective' | 'key_result';
      ownerAgentId?: string | null;
      targetDate?: string | null;
      position?: number;
    };

    const updated = await goalService.updateGoal(
      req.orgId!, subaccountId, goalId,
      { title, description, parentGoalId, status, level, ownerAgentId, targetDate, position },
    );

    res.json(updated);
  })
);

/**
 * DELETE /api/subaccounts/:subaccountId/goals/:goalId
 * Soft-delete a goal and cascade to children (in transaction).
 */
router.delete(
  '/api/subaccounts/:subaccountId/goals/:goalId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    await goalService.deleteGoal(req.orgId!, subaccountId, goalId);
    res.json({ success: true });
  })
);

/**
 * GET /api/subaccounts/:subaccountId/goals/:goalId/ancestry
 * Return full ancestor chain from this goal up to root (for agent context injection).
 */
router.get(
  '/api/subaccounts/:subaccountId/goals/:goalId/ancestry',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId, goalId } = req.params;
    await resolveSubaccount(subaccountId, req.orgId!);

    const ancestry = await goalService.getGoalAncestry(req.orgId!, subaccountId, goalId);
    res.json(ancestry);
  })
);

export default router;
