/**
 * Ask form routes — submit, skip, autofill.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 *
 * POST /api/tasks/:taskId/ask/:stepId/submit
 * POST /api/tasks/:taskId/ask/:stepId/skip
 * GET  /api/tasks/:taskId/ask/:stepId/autofill
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  askFormSubmissionService,
  NotInSubmitterPoolError,
  AskAlreadyResolvedError,
  SkipNotAllowedError,
} from '../services/askFormSubmissionService.js';
import { askFormAutoFillService } from '../services/askFormAutoFillService.js';
import type { AskField } from '../../shared/types/askForm.js';

const router = Router();

router.post(
  '/api/tasks/:taskId/ask/:stepId/submit',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, stepId } = req.params;
    const { values } = req.body as { values?: unknown };

    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      res.status(400).json({ error: 'values_required' });
      return;
    }

    try {
      const result = await askFormSubmissionService.submit(
        taskId,
        stepId,
        req.user!.id,
        values as Record<string, unknown>,
        req.orgId!,
      );
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof NotInSubmitterPoolError) {
        res.status(403).json({ error: 'not_in_submitter_pool' });
        return;
      }
      if (err instanceof AskAlreadyResolvedError) {
        res.status(409).json({ error: 'already_submitted', submitted_by: err.submittedBy, submitted_at: err.submittedAt });
        return;
      }
      const shaped = err as { statusCode?: number; message?: string };
      if (shaped.statusCode === 404) {
        res.status(404).json({ error: shaped.message ?? 'not_found' });
        return;
      }
      throw err;
    }
  }),
);

router.post(
  '/api/tasks/:taskId/ask/:stepId/skip',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, stepId } = req.params;

    try {
      const result = await askFormSubmissionService.skip(
        taskId,
        stepId,
        req.user!.id,
        req.orgId!,
      );
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof SkipNotAllowedError) {
        res.status(400).json({ error: 'skip_not_allowed' });
        return;
      }
      if (err instanceof NotInSubmitterPoolError) {
        res.status(403).json({ error: 'not_in_submitter_pool' });
        return;
      }
      if (err instanceof AskAlreadyResolvedError) {
        res.status(409).json({ error: 'already_resolved', current_status: err.currentStatus, submitted_by: err.submittedBy, submitted_at: err.submittedAt });
        return;
      }
      const shaped = err as { statusCode?: number; message?: string };
      if (shaped.statusCode === 404) {
        res.status(404).json({ error: shaped.message ?? 'not_found' });
        return;
      }
      throw err;
    }
  }),
);

router.get(
  '/api/tasks/:taskId/ask/:stepId/autofill',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, stepId } = req.params;
    const fieldsRaw = req.query.fields as string | undefined;

    let fields: AskField[] = [];
    if (fieldsRaw) {
      try {
        fields = JSON.parse(fieldsRaw) as AskField[];
      } catch {
        res.json({ values: {} });
        return;
      }
    }

    if (!Array.isArray(fields)) {
      res.json({ values: {} });
      return;
    }

    const values = await askFormAutoFillService.getAutoFillValues(
      taskId,
      stepId,
      fields,
      req.orgId!,
    );
    res.json({ values });
  }),
);

export default router;
