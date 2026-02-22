import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { executionService } from '../services/executionService.js';
import { validateMultipart } from '../middleware/validate.js';

const router = Router();

// Export must be before :id route
router.get('/api/executions/export', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await executionService.exportExecutions(req.user!.organisationId, {
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
    const result = await executionService.listExecutions(req.user!.id, req.user!.organisationId, req.user!.role, {
      taskId: req.query.taskId as string | undefined,
      userId: req.query.userId as string | undefined,
      status: req.query.status as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/executions', authenticate, validateMultipart, async (req, res) => {
  try {
    const { taskId, inputData } = req.body;
    if (!taskId) {
      res.status(400).json({ error: 'Validation failed', details: 'taskId is required' });
      return;
    }
    const parsedInputData = inputData ? (typeof inputData === 'string' ? JSON.parse(inputData) : inputData) : undefined;
    const result = await executionService.createExecution(req.user!.id, req.user!.organisationId, { taskId, inputData: parsedInputData });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/executions/:id', authenticate, async (req, res) => {
  try {
    const result = await executionService.getExecution(req.params.id, req.user!.id, req.user!.organisationId, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/executions/:id/files', authenticate, async (req, res) => {
  try {
    const result = await executionService.listExecutionFiles(req.params.id, req.user!.id, req.user!.organisationId, req.user!.role);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
