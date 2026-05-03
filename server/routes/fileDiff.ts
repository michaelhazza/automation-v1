/**
 * fileDiff.ts — GET /api/tasks/:taskId/files/:fileId/diff
 *
 * Query: fromVersion (integer), toVersion (integer)
 *
 * Returns { hunks: Hunk[], mode: 'line' | 'row' | 'unsupported' }
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getDiff } from '../services/fileDiffService.js';

const router = Router();

router.get(
  '/api/tasks/:taskId/files/:fileId/diff',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;
    const { fromVersion, toVersion } = req.query as Record<string, string>;

    const from = parseInt(fromVersion, 10);
    const to = parseInt(toVersion, 10);

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
      res.status(400).json({ error: 'fromVersion and toVersion must be positive integers' });
      return;
    }

    if (from >= to) {
      res.status(400).json({ error: 'fromVersion must be less than toVersion' });
      return;
    }

    const result = await getDiff(fileId, from, to, req.orgId!);
    res.json(result);
  }),
);

export default router;
