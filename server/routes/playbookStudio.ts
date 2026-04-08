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

// ─── Save & open PR (the trust boundary) ─────────────────────────────────────

router.post(
  '/api/system/playbook-studio/sessions/:id/save-and-open-pr',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const { fileContents, definition } = req.body as {
      fileContents?: string;
      definition?: unknown;
    };
    if (!fileContents || typeof fileContents !== 'string') {
      res.status(400).json({ error: 'fileContents is required' });
      return;
    }
    if (!definition || typeof definition !== 'object') {
      res.status(400).json({
        error: 'definition object is required for the mandatory pre-PR validation pass',
      });
      return;
    }
    const result = await playbookStudioService.saveAndOpenPr(
      req.params.id,
      fileContents,
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
