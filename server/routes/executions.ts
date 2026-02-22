import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { executionService } from '../services/executionService.js';
import { validateMultipart, parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// Export must be before :id route
router.get('/api/executions/export', authenticate, requireOrgPermission(ORG_PERMISSIONS.EXECUTIONS_VIEW), async (req, res) => {
  try {
    const result = await executionService.exportExecutions(req.orgId!, {
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      taskId: req.query.taskId as string | undefined,
      userId: req.query.userId as string | undefined,
    });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/executions', authenticate, async (req, res) => {
  try {
    const result = await executionService.listExecutions(req.user!.id, req.orgId!, req.user!.role, {
      taskId: req.query.taskId as string | undefined,
      userId: req.query.userId as string | undefined,
      status: req.query.status as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      limit: parsePositiveInt(req.query.limit),
      offset: parsePositiveInt(req.query.offset),
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/executions', authenticate, validateMultipart, async (req, res) => {
  try {
    const { taskId, inputData, notifyOnComplete, subaccountId } = req.body;
    if (!taskId) {
      res.status(400).json({ error: 'Validation failed', details: 'taskId is required' });
      return;
    }
    const parsedInputData = inputData ? (typeof inputData === 'string' ? JSON.parse(inputData) : inputData) : undefined;
    const parsedNotify = notifyOnComplete === true || notifyOnComplete === 'true';
    const result = await executionService.createExecution(req.user!.id, req.orgId!, {
      taskId,
      inputData: parsedInputData,
      notifyOnComplete: parsedNotify,
      subaccountId: subaccountId ?? undefined,
    });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/executions/:id', authenticate, async (req, res) => {
  try {
    const result = await executionService.getExecution(req.params.id, req.user!.id, req.orgId!, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/executions/:id/files', authenticate, async (req, res) => {
  try {
    const result = await executionService.listExecutionFiles(req.params.id, req.user!.id, req.orgId!, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
