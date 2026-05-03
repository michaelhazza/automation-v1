/**
 * Workflow Templates routes — system + org template CRUD.
 *
 * Spec: tasks/Workflows-spec.md §7.1, §7.2, §10.4, §10.5.
 *
 * System templates are read-only via API in Phase 1 — authoring happens
 * file-based via the seeder (see scripts/seed-Workflows.ts) or via the
 * Workflow Studio (step 8.5). Org templates support fork + publish + soft
 * delete via the standard org-permission-gated routes.
 *
 * §10.4 Studio publish endpoint:
 *   POST /api/admin/workflows/:id/publish
 *
 * This endpoint uses the WorkflowPublishService which handles concurrent-edit
 * detection and publish-notes persistence in a single call.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowTemplateService } from '../services/workflowTemplateService.js';
import { WorkflowPublishService } from '../services/workflowPublishService.js';
import type { WorkflowStepDefinition } from '../services/workflowValidatorPure.js';

const router = Router();

// ─── System templates (read-only via API) ────────────────────────────────────

router.get(
  '/api/system/workflow-templates',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const templates = await WorkflowTemplateService.listSystemTemplates();
    res.json({ templates });
  })
);

router.get(
  '/api/system/workflow-templates/:slug',
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
  '/api/system/workflow-templates/:slug/versions',
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
  '/api/workflow-templates',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_READ),
  asyncHandler(async (req, res) => {
    const templates = await WorkflowTemplateService.listOrgTemplates(req.orgId!);
    res.json({ templates });
  })
);

router.get(
  '/api/workflow-templates/:id',
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
  '/api/workflow-templates/:id/versions',
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
  '/api/workflow-templates/fork-system',
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
  '/api/workflow-templates/:id/publish',
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
  '/api/workflow-templates/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_WRITE),
  asyncHandler(async (req, res) => {
    await WorkflowTemplateService.deleteOrgTemplate(req.orgId!, req.params.id);
    res.status(204).send();
  })
);

// ─── Studio publish (§10.4, §10.5) ───────────────────────────────────────────
//
// POST /api/admin/workflows/:id/publish
//
// Body:   { steps, publishNotes?, expectedUpstreamUpdatedAt? }
// 200:    { version_id, version_number }
// 422:    { error: 'validation_failed', errors: ValidatorError[] }
// 409:    { error: 'concurrent_publish', upstream_updated_at, upstream_user_id }
//
// Concurrent-edit handling (spec §10.5):
//   - If expectedUpstreamUpdatedAt is provided and the latest version's
//     publishedAt is newer, return 409 concurrent_publish.
//   - The client can retry without expectedUpstreamUpdatedAt to force-publish.

router.post(
  '/api/admin/workflows/:id/publish',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKFLOW_TEMPLATES_PUBLISH),
  asyncHandler(async (req, res) => {
    const { steps, publishNotes, expectedUpstreamUpdatedAt } = req.body as {
      steps?: WorkflowStepDefinition[];
      publishNotes?: string;
      expectedUpstreamUpdatedAt?: string;
    };

    if (!Array.isArray(steps)) {
      res.status(400).json({ error: 'steps array is required' });
      return;
    }

    const result = await WorkflowPublishService.publishWithNotes({
      templateId: req.params.id,
      steps,
      publishNotes,
      expectedUpstreamUpdatedAt,
      organisationId: req.orgId!,
      callerUserId: req.user!.id,
    });

    if (result.ok) {
      res.json({ version_id: result.versionId, version_number: result.versionNumber });
      return;
    }

    if (result.reason === 'concurrent_publish') {
      res.status(409).json({
        error: 'concurrent_publish',
        upstream_updated_at: result.upstreamUpdatedAt,
        upstream_user_id: result.upstreamUserId,
      });
      return;
    }

    // validation_failed
    res.status(422).json({
      error: 'validation_failed',
      errors: result.errors,
    });
  })
);

export default router;
