import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { taskService } from '../services/taskService.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { validateBody } from '../middleware/validate.js';
import { createTaskBody, updateTaskBody, moveTaskBody, createActivityBody, createDeliverableBody } from '../schemas/tasks.js';

const router = Router();

// ─── Tasks (Kanban cards) ────────────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { status, priority, assignedAgentId, search, projectId } = req.query as Record<string, string>;
    const items = await taskService.listTasks(req.orgId!, req.params.subaccountId, {
      status, priority, assignedAgentId, search, projectId,
    });
    res.json(items);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/tasks',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  validateBody(createTaskBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { title, description, brief, status, priority, assignedAgentId, assignedAgentIds, createdByAgentId, processId, dueDate } = req.body as {
      title?: string; description?: string; brief?: string; status?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assignedAgentId?: string; assignedAgentIds?: string[]; createdByAgentId?: string; processId?: string; dueDate?: string;
    };
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const item = await taskService.createTask(
      req.orgId!, req.params.subaccountId,
      { title, description, brief, status, priority, assignedAgentId, assignedAgentIds, createdByAgentId, processId, dueDate: dueDate ? new Date(dueDate) : undefined },
      req.user!.id
    );
    res.status(201).json(item);
  })
);

router.get(
  '/api/subaccounts/:subaccountId/tasks/:itemId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const item = await taskService.getTask(req.params.itemId, req.orgId!);
    res.json(item);
  })
);

router.patch(
  '/api/subaccounts/:subaccountId/tasks/:itemId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  validateBody(updateTaskBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { title, description, brief, status, priority, assignedAgentId, assignedAgentIds, processId, dueDate } = req.body as Record<string, unknown>;
    const item = await taskService.updateTask(
      req.params.itemId, req.orgId!,
      {
        title: title as string | undefined, description: description as string | undefined,
        brief: brief as string | undefined, status: status as string | undefined,
        priority: priority as any,
        assignedAgentId: assignedAgentId as string | null | undefined,
        assignedAgentIds: assignedAgentIds as string[] | null | undefined,
        processId: processId as string | null | undefined,
        dueDate: dueDate === null ? null : dueDate ? new Date(dueDate as string) : undefined,
      },
      req.user!.id
    );
    res.json(item);
  })
);

router.patch(
  '/api/subaccounts/:subaccountId/tasks/:itemId/move',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  validateBody(moveTaskBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { status, position } = req.body as { status?: string; position?: number };
    if (!status || position === undefined) {
      res.status(400).json({ error: 'status and position are required' });
      return;
    }
    const item = await taskService.moveTask(req.params.itemId, req.orgId!, { status, position }, req.user!.id);
    res.json(item);
  })
);

router.delete(
  '/api/subaccounts/:subaccountId/tasks/:itemId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await taskService.deleteTask(req.params.itemId, req.orgId!);
    res.json({ message: 'Task deleted' });
  })
);

// ─── Activities & Deliverables ───────────────────────────────────────────────

router.get(
  '/api/subaccounts/:subaccountId/tasks/:itemId/activities',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const activities = await taskService.listActivities(req.params.itemId, req.orgId!);
    res.json(activities);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/tasks/:itemId/activities',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  validateBody(createActivityBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { activityType, message, agentId, metadata } = req.body as {
      activityType?: string; message?: string; agentId?: string; metadata?: Record<string, unknown>;
    };
    if (!activityType || !message) {
      res.status(400).json({ error: 'activityType and message are required' });
      return;
    }
    const activity = await taskService.addActivity(req.params.itemId, req.orgId!, {
      activityType: activityType as any, message, agentId, userId: req.user!.id, metadata,
    });
    res.status(201).json(activity);
  })
);

router.get(
  '/api/subaccounts/:subaccountId/tasks/:itemId/deliverables',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const deliverables = await taskService.listDeliverables(req.params.itemId, req.orgId!);
    res.json(deliverables);
  })
);

router.post(
  '/api/subaccounts/:subaccountId/tasks/:itemId/deliverables',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  validateBody(createDeliverableBody, 'warn'),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { deliverableType, title, path, description } = req.body as {
      deliverableType?: string; title?: string; path?: string; description?: string;
    };
    if (!deliverableType || !title) {
      res.status(400).json({ error: 'deliverableType and title are required' });
      return;
    }
    const deliverable = await taskService.addDeliverable(req.params.itemId, req.orgId!, {
      deliverableType: deliverableType as any, title, path, description,
    });
    res.status(201).json(deliverable);
  })
);

router.delete(
  '/api/subaccounts/:subaccountId/tasks/:itemId/deliverables/:delivId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    await taskService.deleteDeliverable(req.params.delivId, req.orgId!);
    res.json({ message: 'Deliverable deleted' });
  })
);

export default router;
