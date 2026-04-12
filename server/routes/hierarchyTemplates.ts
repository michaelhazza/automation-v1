import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hierarchyTemplateService } from '../services/hierarchyTemplateService.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';

const router = Router();

// ── Template CRUD ────────────────────────────────────────────────────────────

router.get(
  '/api/hierarchy-templates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const templates = await hierarchyTemplateService.list(req.orgId!);
    res.json(templates);
  })
);

router.post(
  '/api/hierarchy-templates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const template = await hierarchyTemplateService.create(req.orgId!, { name, description });
    res.status(201).json(template);
  })
);

router.get(
  '/api/hierarchy-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const template = await hierarchyTemplateService.get(req.params.id, req.orgId!);
    res.json(template);
  })
);

router.patch(
  '/api/hierarchy-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const template = await hierarchyTemplateService.update(req.params.id, req.orgId!, req.body);
    res.json(template);
  })
);

router.delete(
  '/api/hierarchy-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const result = await hierarchyTemplateService.delete(req.params.id, req.orgId!);
    res.json(result);
  })
);

// ── Paperclip Import → Template ──────────────────────────────────────────────

router.post(
  '/api/hierarchy-templates/import',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CREATE),
  asyncHandler(async (req, res) => {
    const { name, manifest } = req.body;
    if (!name || !manifest) {
      res.status(400).json({ error: 'name and manifest are required' });
      return;
    }
    const result = await hierarchyTemplateService.importPaperclip(req.orgId!, { name, manifest });
    res.status(201).json(result);
  })
);

// ── Apply Template to Subaccount ─────────────────────────────────────────────

router.post(
  '/api/hierarchy-templates/:id/apply',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { subaccountId, mode, preview } = req.body;
    if (!subaccountId) {
      res.status(400).json({ error: 'subaccountId is required' });
      return;
    }
    const result = await hierarchyTemplateService.apply(req.params.id, req.orgId!, {
      subaccountId,
      mode: mode ?? 'merge',
      preview: preview ?? false,
    });
    res.json(result);
  })
);

// ── Direct Subaccount Import ─────────────────────────────────────────────────

router.post(
  '/api/subaccounts/:subaccountId/agents/import',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { name, manifest, saveAsTemplate } = req.body;
    if (!name || !manifest) {
      res.status(400).json({ error: 'name and manifest are required' });
      return;
    }
    const result = await hierarchyTemplateService.importToSubaccount(req.orgId!, {
      subaccountId: subaccount.id,
      name,
      manifest,
      saveAsTemplate: saveAsTemplate ?? false,
    });
    res.status(201).json(result);
  })
);

export default router;
