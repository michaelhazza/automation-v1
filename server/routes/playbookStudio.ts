/**
 * Playbook Studio routes — system-admin chat authoring backend.
 *
 * Spec: tasks/playbooks-spec.md §10.8.4 (tools) + §10.8.6 (save endpoint).
 *
 * All endpoints are system_admin only. The four (now five) tools are
 * exposed as POST endpoints so the chat agent can call them via fetch.
 * The save-and-open-pr endpoint always re-validates before any action —
 * spec invariant 14.
 */

import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { playbookStudioService } from '../services/playbookStudioService.js';

const router = Router();

// ─── Sessions ────────────────────────────────────────────────────────────────

router.get(
  '/api/system/playbook-studio/sessions',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const sessions = await playbookStudioService.listSessions(req.user!.id);
    res.json({ sessions });
  })
);

router.post(
  '/api/system/playbook-studio/sessions',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const session = await playbookStudioService.createSession(req.user!.id);
    res.status(201).json({ session });
  })
);

router.get(
  '/api/system/playbook-studio/sessions/:id',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const session = await playbookStudioService.getSession(req.params.id, req.user!.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session });
  })
);

// ─── Tools — read_existing_playbook + list ───────────────────────────────────

router.get(
  '/api/system/playbook-studio/playbooks',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (_req, res) => {
    const slugs = playbookStudioService.listExistingPlaybooks();
    res.json({ slugs });
  })
);

router.get(
  '/api/system/playbook-studio/playbooks/:slug',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const result = playbookStudioService.readExistingPlaybook(req.params.slug);
    if (!result.found) {
      res.status(404).json({ error: 'Playbook not found' });
      return;
    }
    res.json({ slug: req.params.slug, contents: result.contents });
  })
);

// ─── Tools — validate_candidate ──────────────────────────────────────────────

router.post(
  '/api/system/playbook-studio/validate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    const result = playbookStudioService.validateCandidate(definition);
    // On success, also return the canonical hash so the UI can inject
    // the @playbook-definition-hash magic comment into the file before
    // saving (spec invariant 14 — definition/file consistency check).
    if (result.ok) {
      const definitionHash = playbookStudioService.computeDefinitionHash(definition);
      res.json({ ...result, definitionHash });
      return;
    }
    res.json(result);
  })
);

// ─── Tools — simulate_run ────────────────────────────────────────────────────

router.post(
  '/api/system/playbook-studio/simulate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    const result = playbookStudioService.simulateRun(definition);
    res.json(result);
  })
);

// ─── Tools — estimate_cost ───────────────────────────────────────────────────

router.post(
  '/api/system/playbook-studio/estimate',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition, mode } = req.body as {
      definition?: unknown;
      mode?: 'optimistic' | 'pessimistic';
    };
    const result = playbookStudioService.estimateCost(definition, { mode });
    res.json(result);
  })
);

// ─── Render (deterministic file preview from validated definition) ───────────
//
// Returns the canonical .playbook.ts file body that the save endpoint
// would commit for the given definition. The Studio UI uses this to
// power the read-only preview pane next to the JSON editor — what you
// see is exactly what gets committed.

router.post(
  '/api/system/playbook-studio/render',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    if (!definition || typeof definition !== 'object') {
      res.status(400).json({ error: 'definition object is required' });
      return;
    }
    const result = playbookStudioService.validateAndRender(definition);
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
// the .playbook.ts file deterministically before committing. This closes
// the validate-one-thing-commit-another attack: there is no field on
// this endpoint the caller can use to inject arbitrary file content.

router.post(
  '/api/system/playbook-studio/sessions/:id/save-and-open-pr',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { definition } = req.body as { definition?: unknown };
    if (!definition || typeof definition !== 'object') {
      res.status(400).json({
        error:
          'definition object is required. The server is the only producer of the playbook file body — pass the validated definition only.',
      });
      return;
    }
    const result = await playbookStudioService.saveAndOpenPr(
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
  '/api/system/playbook-studio/sessions/:id',
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
    const updated = await playbookStudioService.updateCandidate(
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

export default router;
