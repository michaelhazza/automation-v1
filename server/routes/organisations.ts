import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { organisationService } from '../services/organisationService.js';
import { parsePositiveInt } from '../middleware/validate.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/api/organisations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.listOrganisations({
    status: req.query.status as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
  });
  res.json(result);
}));

router.post('/api/organisations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const { name, slug, plan, adminEmail, adminFirstName, adminLastName } = req.body;
  if (!name || !slug || !plan || !adminEmail || !adminFirstName || !adminLastName) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }
  const result = await organisationService.createOrganisation({ name, slug, plan, adminEmail, adminFirstName, adminLastName });
  res.status(201).json(result);
}));

router.get('/api/organisations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.getOrganisation(req.params.id);
  res.json(result);
}));

router.patch('/api/organisations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.updateOrganisation(req.params.id, req.body);
  res.json(result);
}));

router.delete('/api/organisations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.deleteOrganisation(req.params.id);
  res.json(result);
}));

export default router;
