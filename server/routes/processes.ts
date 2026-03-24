import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { processService } from '../services/processService.js';
import { validateMultipart, parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

router.get('/api/processes', authenticate, async (req, res) => {
  try {
    const result = await processService.listProcesses(req.user!.id, req.orgId!, req.user!.role, {
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

router.post('/api/processes', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_CREATE), async (req, res) => {
  try {
    const { name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId } = req.body;
    if (!name || !workflowEngineId || !webhookPath) {
      res.status(400).json({ error: 'Validation failed', details: 'name, workflowEngineId, and webhookPath are required' });
      return;
    }
    const result = await processService.createProcess(req.orgId!, {
      name, description, workflowEngineId, orgCategoryId, webhookPath, inputSchema, outputSchema, subaccountId,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/processes/:id', authenticate, async (req, res) => {
  try {
    const result = await processService.getProcess(req.params.id, req.orgId!, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/processes/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_EDIT), async (req, res) => {
  try {
    const result = await processService.updateProcess(req.params.id, req.orgId!, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/processes/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_DELETE), async (req, res) => {
  try {
    const result = await processService.deleteProcess(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_TEST), validateMultipart, async (req, res) => {
  try {
    const inputData = req.body.inputData ? JSON.parse(req.body.inputData) : undefined;
    const result = await processService.testProcess(req.params.id, req.orgId!, req.user!.id, inputData);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes/:id/activate', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_ACTIVATE), async (req, res) => {
  try {
    const result = await processService.activateProcess(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/processes/:id/deactivate', authenticate, requireOrgPermission(ORG_PERMISSIONS.PROCESSES_ACTIVATE), async (req, res) => {
  try {
    const result = await processService.deactivateProcess(req.params.id, req.orgId!);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
