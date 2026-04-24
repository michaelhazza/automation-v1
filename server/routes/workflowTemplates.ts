/**
 * Workflow Templates routes — system + org template CRUD.
 *
 * Spec: tasks/Workflows-spec.md §7.1, §7.2.
 *
 * System templates are read-only via API in Phase 1 — authoring happens
 * file-based via the seeder (see scripts/seed-Workflows.ts) or via the
 * Workflow Studio (step 8.5). Org templates support fork + publish + soft
 * delete via the standard org-permission-gated routes.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowTemplateService } from '../services/workflowTemplateService.js';

const router = Router();

// ─── System templates (read-only via API) ────────────────────────────────────

router.get(
  '/api/system/Workflow-templates',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const templates = await WorkflowTemplateService.listSystemTemplates();
    res.json({ templates });
  })
);

router.get(
  '/api/system/Workflow-templates/:slug',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const template = await WorkflowTemplateService.getSystemTemplate(req.params.slug);
    if (!template) {
      res.status(404).json({ error: 'System Workflow template not found' });
      return;
    }
    const latest = await WorkflowTemplateService.getSystemTemplateLatestVersion(template.id);
    res.json({ template, latestVersion: latest });
  })
);

router.get(
  '/api/system/Workflow-templates/:slug/versions',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const template = await WorkflowTemplateService.getSystemTemplate(req.params.slug);
    if (!template) {
      res.status(404).json({ error: 'System Workflow template not found' });
      return;
    }
    const versions = await WorkflowTemplateService.listSystemTemplateVersions(template.id);
    res.json({ versions });
  })
);

// ─── Org templates ───────────────────────────────────────────────────────────

router.get(
  '/api/Workflow-templates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ),
  asyncHandler(async (req, res) => {
    const templates = await WorkflowTemplateService.listOrgTemplates(req.orgId!);
    res.json({ templates });
  })
);

router.get(
  '/api/Workflow-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ),
  asyncHandler(async (req, res) => {
    const template = await WorkflowTemplateService.getOrgTemplate(req.orgId!, req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Workflow template not found' });
      return;
    }
    const latest = await WorkflowTemplateService.getOrgTemplateLatestVersion(template.id);
    res.json({ template, latestVersion: latest });
  })
);

router.get(
  '/api/Workflow-templates/:id/versions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ),
  asyncHandler(async (req, res) => {
    const template = await WorkflowTemplateService.getOrgTemplate(req.orgId!, req.params.id);
    if (!template) {
      res.status(404).json({ error: 'Workflow template not found' });
      return;
    }
    const versions = await WorkflowTemplateService.listOrgTemplateVersions(template.id);
    res.json({ versions });
  })
);

router.post(
  '/api/Workflow-templates/fork-system',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_WRITE),
  asyncHandler(async (req, res) => {
    const { systemTemplateSlug } = req.body as { systemTemplateSlug?: string };
    if (!systemTemplateSlug) {
      res.status(400).json({ error: 'systemTemplateSlug is required' });
      return;
    }
    const result = await WorkflowTemplateService.forkSystemTemplate(
      req.orgId!,
      systemTemplateSlug,
      req.user!.id
    );
    res.status(201).json(result);
  })
);

router.post(
  '/api/Workflow-templates/:id/publish',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_PUBLISH),
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    if (!definition || typeof definition !== 'object') {
      res.status(400).json({ error: 'definition is required' });
      return;
    }
    const result = await WorkflowTemplateService.publishOrgTemplate(
      req.orgId!,
      req.params.id,
      definition as never,
      req.user!.id
    );
    res.status(201).json(result);
  })
);

router.delete(
  '/api/Workflow-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_WRITE),
  asyncHandler(async (req, res) => {
    await WorkflowTemplateService.deleteOrgTemplate(req.orgId!, req.params.id);
    res.status(204).send();
  })
);

export default router;
