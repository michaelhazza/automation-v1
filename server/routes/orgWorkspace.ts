import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { requireOrgPermission } from '../middleware/auth.js';
import { taskService } from '../services/taskService.js';

// ---------------------------------------------------------------------------
// Org Workspace Routes — org-level tasks
//
// Org-level tasks have subaccountId = NULL. They appear on the org board,
// not on any subaccount board.
// ---------------------------------------------------------------------------

const router = Router();

// ── Org-level tasks ───────────────────────────────────────────────────────

router.get('/api/org/tasks', authenticate, asyncHandler(async (req, res) => {
  // Phase 5: taskService.listTasks needs update to accept nullable subaccountId
  // For now, return 501 until taskService is updated
  res.status(501).json({ error: 'Org-level task listing pending taskService update for nullable subaccountId' });
}));

router.post('/api/org/tasks', authenticate, requireOrgPermission('manage_tasks'), asyncHandler(async (req, res) => {
  res.status(501).json({ error: 'Org-level task creation pending taskService update for nullable subaccountId' });
}));

router.patch('/api/org/tasks/:taskId', authenticate, requireOrgPermission('manage_tasks'), asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(req.params.taskId, req.orgId!, req.body);
  res.json(task);
}));

router.patch('/api/org/tasks/:taskId/move', authenticate, requireOrgPermission('manage_tasks'), asyncHandler(async (req, res) => {
  const task = await taskService.moveTask(req.params.taskId, req.orgId!, req.body);
  res.json(task);
}));

export default router;
