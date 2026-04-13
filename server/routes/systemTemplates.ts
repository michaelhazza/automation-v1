import { Router } from 'express';
import { authenticate, requireSystemAdmin, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { systemTemplateService } from '../services/systemTemplateService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// System Admin — Company Template Library
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  '/api/system/company-templates',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const templates = await systemTemplateService.list();
    res.json(templates);
  })
);

router.get(
  '/api/system/company-templates/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const template = await systemTemplateService.get(req.params.id);
    res.json(template);
  })
);

router.patch(
  '/api/system/company-templates/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    // Explicit allowlist — never pass raw req.body to service
    const { name, description, isPublished } = req.body as {
      name?: string; description?: string; isPublished?: boolean;
    };
    const template = await systemTemplateService.update(req.params.id, { name, description, isPublished });
    res.json(template);
  })
);

router.delete(
  '/api/system/company-templates/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const result = await systemTemplateService.delete(req.params.id);
    res.json(result);
  })
);

// Import from Paperclip manifest
router.post(
  '/api/system/company-templates/import',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { name, manifest } = req.body;
    if (!name || !manifest) {
      res.status(400).json({ error: 'name and manifest are required' });
      return;
    }
    const result = await systemTemplateService.importPaperclip({ name, manifest });
    res.status(201).json(result);
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// Org-facing — Browse & Load
// ═══════════════════════════════════════════════════════════════════════════

// Browse published templates (org admins)
router.get(
  '/api/company-templates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (_req, res) => {
    const templates = await systemTemplateService.listPublished();
    res.json(templates);
  })
);

// Get single published template with slots/tree (org admins)
router.get(
  '/api/company-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const template = await systemTemplateService.getPublished(req.params.id);
    res.json(template);
  })
);

// Load a company template into a subaccount
router.post(
  '/api/company-templates/:id/load',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, parentSubaccountAgentId } = req.body;
    if (!subaccountId) {
      res.status(400).json({ error: 'subaccountId is required' });
      return;
    }
    const result = await systemTemplateService.loadToSubaccount(
      req.params.id,
      req.orgId!,
      subaccountId,
      parentSubaccountAgentId ?? null
    );
    res.json(result);
  })
);

// Load a configuration template into an organisation
router.post(
  '/api/system/company-templates/:id/load-to-org',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { organisationId, operatorInputs } = req.body;
    if (!organisationId) {
      res.status(400).json({ error: 'organisationId is required' });
      return;
    }
    const result = await systemTemplateService.loadToOrg(
      req.params.id,
      organisationId,
      operatorInputs ?? undefined
    );
    res.json(result);
  })
);

// Load selected system agents into a subaccount
router.post(
  '/api/system-agents/load',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { systemAgentIds, subaccountId } = req.body;
    if (!subaccountId || !Array.isArray(systemAgentIds)) {
      res.status(400).json({ error: 'subaccountId and systemAgentIds[] are required' });
      return;
    }
    const result = await systemTemplateService.loadSystemAgents(
      systemAgentIds,
      req.orgId!,
      subaccountId
    );
    res.json(result);
  })
);

export default router;
