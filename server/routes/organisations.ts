import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { organisationService } from '../services/organisationService.js';

const router = Router();

router.get('/api/organisations', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const result = await organisationService.listOrganisations({
      status: req.query.status as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.post('/api/organisations', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const { name, slug, plan, adminEmail, adminFirstName, adminLastName } = req.body;
    if (!name || !slug || !plan || !adminEmail || !adminFirstName || !adminLastName) {
      res.status(400).json({ error: 'Validation failed' });
      return;
    }
    const result = await organisationService.createOrganisation({ name, slug, plan, adminEmail, adminFirstName, adminLastName });
    res.status(201).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.get('/api/organisations/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const result = await organisationService.getOrganisation(req.params.id);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.patch('/api/organisations/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const result = await organisationService.updateOrganisation(req.params.id, req.body);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

router.delete('/api/organisations/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
    const result = await organisationService.deleteOrganisation(req.params.id);
    res.json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;
