import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { taskService } from '../services/taskService.js';
import { validateMultipart, parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

router.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const result = await taskService.listTasks(req.user!.id, req.orgId!, req.user!.role, {
      categoryId: req.query.categoryId as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      limit: parsePositiveInt(req.query.limit),
      offset: parsePositiveInt(req.query.offset),
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/tasks', authenticate, requireOrgPermission(ORG_PERMISSIONS.TASKS_CREATE), async (req, res) => {
  try {
    const { name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId } = req.body;
    if (!name || !workflowEngineId || !webhookPath) {
      res.status(400).json({ error: 'Validation failed', details: 'name, workflowEngineId, and webhookPath are required' });
      return;
    }
    const result = await taskService.createTask(req.orgId!, {
      name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/tasks/:id', authenticate, async (req, res) => {
  try {
    const result = await taskService.getTask(req.params.id, req.orgId!, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/tasks/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.TASKS_EDIT), async (req, res) => {
  try {
    const result = await taskService.updateTask(req.params.id, req.orgId!, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/tasks/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.TASKS_DELETE), async (req, res) => {
  try {
    const result = await taskService.deleteTask(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/tasks/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.TASKS_TEST), validateMultipart, async (req, res) => {
  try {
    const inputData = req.body.inputData ? JSON.parse(req.body.inputData) : undefined;
    const result = await taskService.testTask(req.params.id, req.orgId!, req.user!.id, inputData);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/tasks/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.TASKS_ACTIVATE), async (req, res) => {
  try {
    const result = await taskService.activateTask(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/tasks/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.TASKS_ACTIVATE), async (req, res) => {
  try {
    const result = await taskService.deactivateTask(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
