/**
 * asks.ts — Ask form submission routes.
 *
 * POST /api/tasks/:taskId/ask/:stepId/submit   { values }
 * POST /api/tasks/:taskId/ask/:stepId/skip     {}
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AskFormSubmissionService } from '../services/askFormSubmissionService.js';
import type { AskFormValues } from '../../../shared/types/askForm.js';

const router = Router();

/**
 * POST /api/tasks/:taskId/ask/:stepId/submit
 *
 * Submit form values for an open Ask gate.
 *
 * Body: { values: AskFormValues }
 *
 * 200: { ok: true }
 * 400: { error: { code: 'invalid_payload', message } }
 * 403: { error: { code: 'not_in_submitter_pool', message } }
 * 404: { error: { code: 'ask_not_found', message } }
 * 409: { error: { code: 'already_submitted', message }, submitted_by, submitted_at }
 */
router.post(
  '/api/tasks/:taskId/ask/:stepId/submit',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, stepId } = req.params;
    const { values } = req.body as { values?: AskFormValues };

    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      res.status(400).json({
        error: { code: 'invalid_payload', message: 'values must be an object' },
      });
      return;
    }

    await AskFormSubmissionService.submit(
      taskId,
      stepId,
      req.orgId!,
      req.user!.id,
      values,
    );

    res.json({ ok: true });
  }),
);

/**
 * POST /api/tasks/:taskId/ask/:stepId/skip
 *
 * Skip an open Ask gate (only when allowSkip === true on the step params).
 *
 * 200: { ok: true }
 * 400: { error: { code: 'skip_not_allowed', message } }
 * 403: { error: { code: 'not_in_submitter_pool', message } }
 * 404: { error: { code: 'ask_not_found', message } }
 * 409: { error: { code: 'already_resolved', message }, current_status }
 */
router.post(
  '/api/tasks/:taskId/ask/:stepId/skip',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, stepId } = req.params;

    await AskFormSubmissionService.skip(
      taskId,
      stepId,
      req.orgId!,
      req.user!.id,
    );

    res.json({ ok: true });
  }),
);

export default router;
