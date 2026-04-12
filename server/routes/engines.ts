import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { engineService } from '../services/engineService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/api/engines', authenticate, requireOrgPermission(ORG_PERMISSIONS.ENGINES_VIEW), asyncHandler(async (req, res) => {
  const result = await engineService.listEngines(req.orgId!, {
    status: req.query.status as string | undefined,
  });
  res.json(result);
}));

router.post('/api/engines', authenticate, requireOrgPermission(ORG_PERMISSIONS.ENGINES_MANAGE), asyncHandler(async (req, res) => {
  // guard-ignore-next-line: input-validation reason="manual validation enforced: name, engineType, baseUrl required check"
  const { name, engineType, baseUrl, apiKey } = req.body;
  if (!name || !engineType || !baseUrl) {
    res.status(400).json({ error: 'Validation failed', details: 'name, engineType, and baseUrl are required' });
    return;
  }
  const result = await engineService.createEngine(req.orgId!, { name, engineType, baseUrl, apiKey });
  res.status(201).json(result);
}));

router.get('/api/engines/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.ENGINES_VIEW), asyncHandler(async (req, res) => {
  const result = await engineService.getEngine(req.params.id, req.orgId!);
  res.json(result);
}));

router.patch('/api/engines/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.ENGINES_MANAGE), asyncHandler(async (req, res) => {
  const result = await engineService.updateEngine(req.params.id, req.orgId!, req.body);
  res.json(result);
}));

router.delete('/api/engines/:id', authenticate, requireOrgPermission(ORG_PERMISSIONS.ENGINES_MANAGE), asyncHandler(async (req, res) => {
  const result = await engineService.deleteEngine(req.params.id, req.orgId!);
  res.json(result);
}));

router.post('/api/engines/:id/test', authenticate, requireOrgPermission(ORG_PERMISSIONS.ENGINES_VIEW), asyncHandler(async (req, res) => {
  const result = await engineService.testEngineConnection(req.params.id, req.orgId!);
  res.json(result);
}));

export default router;
