import { Router } from 'express';
import { authenticate, requireOrgPermission, checkOrgPermission } from '../middleware/auth.js';
import { executionService } from '../services/executionService.js';
import { validateMultipart, parsePositiveInt } from '../middleware/validate.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// Export must be before :id route
router.get('/api/executions/export', authenticate, requireOrgPermission(ORG_PERMISSIONS.EXECUTIONS_VIEW), asyncHandler(async (req, res) => {
  const result = await executionService.exportExecutions(req.orgId!, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    processId: req.query.processId as string | undefined,
    userId: req.query.userId as string | undefined,
  });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.data);
}));

router.get('/api/executions', authenticate, asyncHandler(async (req, res) => {
  const canViewAll = await checkOrgPermission(req.user!.id, req.orgId!, req.user!.role, ORG_PERMISSIONS.EXECUTIONS_VIEW);
  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin receives full audit fields in response"
  const viewFullAudit = req.user!.role === 'system_admin';
  const result = await executionService.listExecutions(req.user!.id, req.orgId!, canViewAll, viewFullAudit, {
    processId: req.query.processId as string | undefined,
    userId: req.query.userId as string | undefined,
    status: req.query.status as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
  });
  res.json(result);
}));

router.post('/api/executions', authenticate, validateMultipart, asyncHandler(async (req, res) => {
  const { processId, inputData, notifyOnComplete, subaccountId } = req.body;
  if (!processId) {
    res.status(400).json({ error: 'Validation failed', details: 'processId is required' });
    return;
  }
  let parsedInputData: unknown;
  if (inputData) {
    if (typeof inputData === 'string') {
      try { parsedInputData = JSON.parse(inputData); } catch { res.status(400).json({ error: 'Invalid JSON in inputData' }); return; }
    } else {
      parsedInputData = inputData;
    }
  }
  const parsedNotify = notifyOnComplete === true || notifyOnComplete === 'true';
  const result = await executionService.createExecution(req.user!.id, req.orgId!, {
    processId,
    inputData: parsedInputData,
    notifyOnComplete: parsedNotify,
    subaccountId: subaccountId ?? undefined,
  });
  res.status(201).json(result);
}));

router.get('/api/executions/:id', authenticate, asyncHandler(async (req, res) => {
  const canViewAll = await checkOrgPermission(req.user!.id, req.orgId!, req.user!.role, ORG_PERMISSIONS.EXECUTIONS_VIEW);
  // guard-ignore-next-line: no-direct-role-checks reason="conditional data enrichment, not access control — system_admin receives full audit fields in response"
  const viewFullAudit = req.user!.role === 'system_admin';
  const result = await executionService.getExecution(req.params.id, req.user!.id, req.orgId!, canViewAll, viewFullAudit);
  res.json(result);
}));

router.get('/api/executions/:id/files', authenticate, asyncHandler(async (req, res) => {
  const canViewAll = await checkOrgPermission(req.user!.id, req.orgId!, req.user!.role, ORG_PERMISSIONS.EXECUTIONS_VIEW);
  const result = await executionService.listExecutionFiles(req.params.id, req.user!.id, req.orgId!, canViewAll);
  res.json(result);
}));

export default router;
