/**
 * fileRevert.ts — POST /api/tasks/:taskId/files/:fileId/revert-hunk
 *
 * Body: { from_version: number, hunk_index: number }
 *
 * 200: { reverted: true, new_version: number }
 * 200: { reverted: false, reason: 'already_absent' }
 * 409: { error: 'base_version_changed', current_version: number }
 * 403: auth/permission failure (handled by middleware)
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { fileRevertHunkService } from '../services/fileRevertHunkService.js';

const router = Router();

router.post(
  '/api/tasks/:taskId/files/:fileId/revert-hunk',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const { taskId, fileId } = req.params;
    const { from_version, hunk_index } = req.body as Record<string, unknown>;

    if (typeof from_version !== 'number' || !Number.isInteger(from_version) || from_version < 1) {
      res.status(400).json({ error: 'from_version must be a positive integer' });
      return;
    }

    if (typeof hunk_index !== 'number' || !Number.isInteger(hunk_index) || hunk_index < 0) {
      res.status(400).json({ error: 'hunk_index must be a non-negative integer' });
      return;
    }

    const result = await fileRevertHunkService.revertHunk({
      taskId,
      fileId,
      fromVersion: from_version,
      hunkIndex: hunk_index,
      organisationId: req.orgId!,
      callerUserId: req.user!.id,
    });

    if (!result.reverted) {
      if (result.reason === 'base_version_changed') {
        res.status(409).json({
          error: 'base_version_changed',
          current_version: result.currentVersion,
        });
        return;
      }
      // already_absent — 200 with reason
      res.json({ reverted: false, reason: result.reason });
      return;
    }

    res.json({ reverted: true, new_version: result.newVersion });
  }),
);

export default router;
