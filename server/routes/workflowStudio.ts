/**
 * Workflow Studio routes — system-admin chat authoring backend.
 *
 * Spec: tasks/Workflows-spec.md §10.8.4 (tools) + §10.8.6 (save endpoint).
 *
 * All endpoints are system_admin only. The four (now five) tools are
 * exposed as POST endpoints so the chat agent can call them via fetch.
 * The save-and-open-pr endpoint always re-validates before any action —
 * spec invariant 14.
 */

import { Router } from 'express';
import { authenticate, requireSystemAdmin, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { WorkflowStudioService } from '../services/workflowStudioService.js';
import { WorkflowTemplateService } from '../services/workflowTemplateService.js';
import { workflowPublishService } from '../services/workflowPublishService.js';
import type { WorkflowStep } from '../lib/workflow/types.js';

const router = Router();

// ─── Sessions ────────────────────────────────────────────────────────────────

router.get(
  '/api/system/workflow-studio/sessions',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const sessions = await WorkflowStudioService.listSessions(req.user!.id);
    res.json({ sessions });
  })
);

router.post(
  '/api/system/workflow-studio/sessions',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const session = await WorkflowStudioService.createSession(req.user!.id);
    res.status(201).json({ session });
  })
);

router.get(
  '/api/system/workflow-studio/sessions/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const session = await WorkflowStudioService.getSession(req.params.id, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session });
  })
);

// ─── Tools — read_existing_Workflow + list ───────────────────────────────────

router.get(
  '/api/system/workflow-studio/workflows',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const slugs = WorkflowStudioService.listExistingWorkflows();
    res.json({ slugs });
  })
);

router.get(
  '/api/system/workflow-studio/workflows/:slug',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const result = WorkflowStudioService.readExistingWorkflow(req.params.slug);
    if (!result.found) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json({ slug: req.params.slug, contents: result.contents });
  })
);

// ─── Tools — validate_candidate ──────────────────────────────────────────────

router.post(
  '/api/system/workflow-studio/validate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    // guard-ignore-next-line: input-validation reason="definition validated by WorkflowStudioService.validateCandidate before any action is taken"
    const { definition } = req.body as { definition?: unknown };
    const result = WorkflowStudioService.validateCandidate(definition);
    // On success, also return the canonical hash so the UI can inject
    // the @Workflow-definition-hash magic comment into the file before
    // saving (spec invariant 14 — definition/file consistency check).
    if (result.ok) {
      const definitionHash = WorkflowStudioService.computeDefinitionHash(definition);
      res.json({ ...result, definitionHash });
      return;
    }
    res.json(result);
  })
);

// ─── Tools — simulate_run ────────────────────────────────────────────────────

router.post(
  '/api/system/workflow-studio/simulate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    const result = WorkflowStudioService.simulateRun(definition);
    res.json(result);
  })
);

// ─── Tools — estimate_cost ───────────────────────────────────────────────────

router.post(
  '/api/system/workflow-studio/estimate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition, mode } = req.body as {
      definition?: unknown;
      mode?: 'optimistic' | 'pessimistic';
    };
    const result = WorkflowStudioService.estimateCost(definition, { mode });
    res.json(result);
  })
);

// ─── Render (deterministic file preview from validated definition) ───────────
//
// Returns the canonical .Workflow.ts file body that the save endpoint
// would commit for the given definition. The Studio UI uses this to
// power the read-only preview pane next to the JSON editor — what you
// see is exactly what gets committed.

router.post(
  '/api/system/workflow-studio/render',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    if (!definition || typeof definition !== 'object') {
      res.status(400).json({ error: 'definition object is required' });
      return;
    }
    const result = WorkflowStudioService.validateAndRender(definition);
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  })
);

// ─── Save & open PR (the trust boundary) ─────────────────────────────────────
//
// Accepts ONLY a definition object — fileContents is no longer a
// caller-supplied input. The server validates the definition and renders
// the .Workflow.ts file deterministically before committing. This closes
// the validate-one-thing-commit-another attack: there is no field on
// this endpoint the caller can use to inject arbitrary file content.

router.post(
  '/api/system/workflow-studio/sessions/:id/save-and-open-pr',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    if (!definition || typeof definition !== 'object') {
      res.status(400).json({
        error:
          'definition object is required. The server is the only producer of the Workflow file body — pass the validated definition only.',
      });
      return;
    }
    const result = await WorkflowStudioService.saveAndOpenPr(
      req.params.id,
      definition,
      req.user!.id
    );
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  })
);

// ─── Update candidate (chat session edit) ────────────────────────────────────

router.patch(
  '/api/system/workflow-studio/sessions/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { fileContents, validationState } = req.body as {
      fileContents?: string;
      validationState?: 'unvalidated' | 'valid' | 'invalid';
    };
    if (typeof fileContents !== 'string') {
      res.status(400).json({ error: 'fileContents is required' });
      return;
    }
    const updated = await WorkflowStudioService.updateCandidate(
      req.params.id,
      req.user!.id,
      fileContents,
      validationState ?? 'unvalidated'
    );
    if (!updated) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ ok: true });
  })
);

// ─── Org-admin: load workflow template for Studio ────────────────────────────

router.get(
  '/api/admin/workflows/:id',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { id } = req.params;

    const template = await WorkflowTemplateService.getOrgTemplate(orgId, id);
    if (!template) {
      res.status(404).json({ error: 'Workflow template not found' });
      return;
    }

    const latestVersionRow = await WorkflowTemplateService.getOrgTemplateLatestVersion(id);
    const definition = (latestVersionRow?.definitionJson ?? null) as Record<string, unknown> | null;

    res.json({
      template,
      definition,
      latestVersionId: latestVersionRow?.id ?? null,
      latestVersionPublishedByUserId: latestVersionRow?.publishedByUserId ?? null,
    });
  })
);

// ─── Org-admin: publish workflow template ────────────────────────────────────

router.post(
  '/api/admin/workflows/:id/publish',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { id } = req.params;
    const { steps, publishNotes, expectedUpstreamUpdatedAt } = req.body as {
      steps?: unknown;
      publishNotes?: unknown;
      expectedUpstreamUpdatedAt?: unknown;
    };

    if (!Array.isArray(steps)) {
      res.status(400).json({ error: 'steps must be an array' });
      return;
    }

    try {
      const result = await workflowPublishService.publish({
        organisationId: orgId,
        templateId: id,
        steps: steps as WorkflowStep[],
        publishNotes: typeof publishNotes === 'string' ? publishNotes : undefined,
        expectedUpstreamUpdatedAt: typeof expectedUpstreamUpdatedAt === 'string' ? expectedUpstreamUpdatedAt : undefined,
        userId: req.user!.id,
      });
      res.json({ version_id: result.versionId, version_number: result.versionNumber });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; errorCode?: string; message?: string; upstreamUpdatedAt?: string; upstreamUserId?: string | null; errors?: unknown[]; details?: unknown };
      if (e.statusCode === 404) {
        res.status(404).json({ error: 'template_not_found' });
        return;
      }
      if (e.statusCode === 409 && e.errorCode === 'concurrent_publish') {
        res.status(409).json({
          error: 'concurrent_publish',
          upstream_updated_at: e.upstreamUpdatedAt,
          upstream_user_id: e.upstreamUserId ?? null,
        });
        return;
      }
      if (e.statusCode === 422) {
        res.status(422).json({
          error: e.errorCode ?? 'validation_failed',
          errors: e.errors ?? [],
        });
        return;
      }
      throw err;
    }
  })
);

export default router;
