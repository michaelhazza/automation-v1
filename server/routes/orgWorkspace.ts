import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { taskService } from '../services/taskService.js';

// ---------------------------------------------------------------------------
// Org Workspace Routes — org-level tasks
//
// Org-level tasks have subaccountId = NULL. They appear on the org board,
// not on any subaccount board. These routes mirror subaccount task routes
// but scope to the organisation level.
// ---------------------------------------------------------------------------

const router = Router();

// ── Org-level tasks ───────────────────────────────────────────────────────

router.get('/api/org/tasks', authenticate, asyncHandler(async (req, res) => {
  // Pass empty string for subaccountId — taskService will need update
  // to handle null subaccountId for org-level queries (Phase 5 migration 0069)
  // For now, return org-scoped tasks via direct query
  const { organisationId } = req as unknown as { organisationId: string };
  const orgId = req.orgId ?? organisationId;
  // Placeholder: taskService.listTasks needs org-level support
  res.json({ tasks: [], message: 'Org-level task listing — pending taskService update for nullable subaccountId' });
}));

router.post('/api/org/tasks', authenticate, asyncHandler(async (req, res) => {
  const orgId = req.orgId!;
  // Placeholder: taskService.createTask needs org-level support
  res.status(501).json({ error: 'Org-level task creation — pending taskService update for nullable subaccountId' });
}));

router.patch('/api/org/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(req.params.taskId, req.orgId!, req.body);
  res.json(task);
}));

router.patch('/api/org/tasks/:taskId/move', authenticate, asyncHandler(async (req, res) => {
  const task = await taskService.moveTask(req.params.taskId, req.orgId!, req.body);
  res.json(task);
}));

export default router;
