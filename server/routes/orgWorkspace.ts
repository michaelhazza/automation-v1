import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { taskService } from '../services/taskService.js';
import { scheduledTaskService } from '../services/scheduledTaskService.js';

// ---------------------------------------------------------------------------
// Org Workspace Routes — org-level tasks, scheduled tasks, triggers
// ---------------------------------------------------------------------------

const router = Router();

// ── Org-level tasks ───────────────────────────────────────────────────────

router.get('/api/org/tasks', authenticate, asyncHandler(async (req, res) => {
  const tasks = await taskService.listTasks({
    organisationId: req.orgId!,
    subaccountId: null, // org-level only
  });
  res.json(tasks);
}));

router.post('/api/org/tasks', authenticate, asyncHandler(async (req, res) => {
  const task = await taskService.createTask({
    ...req.body,
    organisationId: req.orgId!,
    subaccountId: null, // org-level
  });
  res.status(201).json(task);
}));

router.patch('/api/org/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(req.params.taskId, req.orgId!, req.body);
  res.json(task);
}));

router.patch('/api/org/tasks/:taskId/move', authenticate, asyncHandler(async (req, res) => {
  const task = await taskService.moveTask(req.params.taskId, req.orgId!, req.body.status);
  res.json(task);
}));

// ── Org-level scheduled tasks ─────────────────────────────────────────────

router.get('/api/org/scheduled-tasks', authenticate, asyncHandler(async (req, res) => {
  const tasks = await scheduledTaskService.list(req.orgId!, null); // null = org-level
  res.json(tasks);
}));

router.post('/api/org/scheduled-tasks', authenticate, asyncHandler(async (req, res) => {
  const task = await scheduledTaskService.create({
    ...req.body,
    organisationId: req.orgId!,
    subaccountId: null,
  });
  res.status(201).json(task);
}));

export default router;
