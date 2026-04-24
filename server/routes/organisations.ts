import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import {
  organisationService,
  createOrganisationFromTemplate,
} from '../services/organisationService.js';
import { parsePositiveInt, validateBody } from '../middleware/validate.js';
import { createOrganisationBody, updateOrganisationBody } from '../schemas/organisations.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/api/organisations', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.listOrganisations({
    status: req.query.status as string | undefined,
    limit: parsePositiveInt(req.query.limit),
    offset: parsePositiveInt(req.query.offset),
    includeSystemOrg: true, // sysadmin listing includes the System Operations org
  });
  res.json(result);
}));

router.post('/api/organisations', authenticate, requireSystemAdmin, validateBody(createOrganisationBody, 'warn'), asyncHandler(async (req, res) => {
  const { name, slug, plan, adminEmail, adminFirstName, adminLastName, systemTemplateId, templateSlug } = req.body;
  if (!name || !slug || !plan || !adminEmail || !adminFirstName || !adminLastName) {
    res.status(400).json({ error: 'Validation failed' });
    return;
  }
  // Session 2 §11.1.4 — when the caller supplies a systemTemplateId, route
  // through createOrganisationFromTemplate so the applied_system_template_id
  // stamp + config_history creation-event audit row land atomically.
  if (typeof systemTemplateId === 'string' && systemTemplateId.length > 0) {
    const { organisationId } = await createOrganisationFromTemplate({
      name,
      slug,
      plan,
      orgAdminEmail: adminEmail,
      orgAdminFirstName: adminFirstName,
      orgAdminLastName: adminLastName,
      systemTemplateId,
      templateSlug: typeof templateSlug === 'string' ? templateSlug : undefined,
    });
    res.status(201).json({ id: organisationId, systemTemplateId });
    return;
  }
  const result = await organisationService.createOrganisation({ name, slug, plan, adminEmail, adminFirstName, adminLastName });
  res.status(201).json(result);
}));

// Current user's org — no system admin required
router.get('/api/organisations/mine', authenticate, asyncHandler(async (req, res) => {
  const orgId = (req as any).user?.organisationId;
  if (!orgId) { res.status(404).json({ error: 'No organisation found' }); return; }
  const result = await organisationService.getOrganisation(orgId);
  res.json(result);
}));

router.get('/api/organisations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.getOrganisation(req.params.id);
  res.json(result);
}));

router.patch('/api/organisations/:id', authenticate, requireSystemAdmin, validateBody(updateOrganisationBody, 'warn'), asyncHandler(async (req, res) => {
  const result = await organisationService.updateOrganisation(req.params.id, req.body);
  res.json(result);
}));

router.delete('/api/organisations/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const result = await organisationService.deleteOrganisation(req.params.id);
  res.json(result);
}));

export default router;
