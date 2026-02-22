import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { engineService } from '../services/engineService.js';

const router = Router();

router.get('/api/engines', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await engineService.listEngines(req.user!.organisationId, {
      status: req.query.status as string | undefined,
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/engines', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const { name, engineType, baseUrl, apiKey } = req.body;
    if (!name || !engineType || !baseUrl) {
      res.status(400).json({ error: 'Validation failed', details: 'name, engineType, and baseUrl are required' });
      return;
    }
    const result = await engineService.createEngine(req.user!.organisationId, { name, engineType, baseUrl, apiKey });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/engines/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await engineService.getEngine(req.params.id, req.user!.organisationId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/engines/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await engineService.updateEngine(req.params.id, req.user!.organisationId, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/engines/:id', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await engineService.deleteEngine(req.params.id, req.user!.organisationId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/engines/:id/test', authenticate, requireRole('org_admin'), async (req, res) => {
  try {
    const result = await engineService.testEngineConnection(req.params.id, req.user!.organisationId);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
