/**
 * fileRevert.ts — file viewer + diff + per-hunk revert routes.
 *
 * Spec: tasks/builds/workflows-v1-phase-2 Chunk 13.
 *
 * GET  /api/tasks/:taskId/files/:fileId
 * GET  /api/tasks/:taskId/files/:fileId/diff?from_version=N
 * POST /api/tasks/:taskId/files/:fileId/revert-hunk
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import * as referenceDocumentService from '../services/referenceDocumentService.js';
import { fileDiffService } from '../services/fileDiffService.js';
import { fileRevertHunkService } from '../services/fileRevertHunkService.js';
import { resolveActiveRunForTask } from '../services/workflowRunResolverService.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks } from '../db/schema/tasks.js';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/tasks/:taskId/files/:fileId
// Returns current document + version (or a specific version via ?version=N).
// ---------------------------------------------------------------------------

router.get(
  '/api/tasks/:taskId/files/:fileId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId, fileId } = req.params;
    const orgId = req.orgId!;

    // Verify task belongs to the org.
    const db = getOrgScopedDb('fileRevert.getFile');
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));
    if (!task) {
      res.status(404).json({ error: 'task_not_found' });
      return;
    }

    const versionParam = req.query.version as string | undefined;

    if (versionParam !== undefined) {
      // Specific version requested.
      const versionNum = parseInt(versionParam, 10);
      if (isNaN(versionNum) || versionNum < 1) {
        res.status(400).json({ error: 'invalid_version' });
        return;
      }

      // getByIdWithCurrentVersion for the doc row, then getVersion for the content.
      const docResult = await referenceDocumentService.getByIdWithCurrentVersion(fileId, orgId);
      if (!docResult) {
        res.status(404).json({ error: 'file_not_found' });
        return;
      }

      const version = await referenceDocumentService.getVersion(fileId, orgId, versionNum);
      res.json({ doc: docResult.doc, version });
      return;
    }

    const result = await referenceDocumentService.getByIdWithCurrentVersion(fileId, orgId);
    if (!result) {
      res.status(404).json({ error: 'file_not_found' });
      return;
    }

    res.json({ doc: result.doc, version: result.version });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/tasks/:taskId/files/:fileId/diff?from_version=N
// ---------------------------------------------------------------------------

router.get(
  '/api/tasks/:taskId/files/:fileId/diff',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { taskId, fileId } = req.params;
    const orgId = req.orgId!;

    // Verify task belongs to the org.
    const db = getOrgScopedDb('fileRevert.getDiff');
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, orgId)));
    if (!task) {
      res.status(404).json({ error: 'task_not_found' });
      return;
    }

    const fromVersionParam = req.query.from_version as string | undefined;
    if (!fromVersionParam) {
      res.status(400).json({ error: 'from_version_required' });
      return;
    }

    const fromVersion = parseInt(fromVersionParam, 10);
    if (isNaN(fromVersion) || fromVersion < 1) {
      res.status(400).json({ error: 'from_version_required' });
      return;
    }

    const diff = await fileDiffService.computeDiff(fileId, fromVersion, orgId);
    if (!diff) {
      res.status(404).json({ error: 'version_not_found' });
      return;
    }

    res.json(diff);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/tasks/:taskId/files/:fileId/revert-hunk
// Body: { from_version: number, hunk_index: number }
// ---------------------------------------------------------------------------

router.post(
  '/api/tasks/:taskId/files/:fileId/revert-hunk',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const { taskId, fileId } = req.params;
    const orgId = req.orgId!;
    const userId = req.user!.id;

    // Verify an active run for the task (scopes the task to this org).
    const runId = await resolveActiveRunForTask(taskId, orgId);
    if (runId === null) {
      res.status(404).json({ error: 'no_active_run_for_task' });
      return;
    }

    const { from_version, hunk_index } = req.body as {
      from_version?: unknown;
      hunk_index?: unknown;
    };

    if (typeof from_version !== 'number' || typeof hunk_index !== 'number') {
      res.status(400).json({ error: 'from_version and hunk_index are required numbers' });
      return;
    }

    try {
      const result = await fileRevertHunkService.revertHunk({
        taskId,
        fileId,
        fromVersion: from_version,
        hunkIndex: hunk_index,
        organisationId: orgId,
        userId,
      });

      if (!result.reverted) {
        res.json({ reverted: false, reason: result.reason });
        return;
      }

      res.json({ reverted: true, new_version: result.newVersion });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; error?: string; current_version?: number };
      if (e.statusCode === 409 && e.error === 'base_version_changed') {
        res.status(409).json({ error: 'base_version_changed', current_version: e.current_version });
        return;
      }
      if (e.statusCode === 404 && e.error === 'file_not_found') {
        res.status(404).json({ error: 'file_not_found' });
        return;
      }
      if (e.statusCode === 404 && e.error === 'version_not_found') {
        res.status(404).json({ error: 'file_not_found' });
        return;
      }
      throw err; // let asyncHandler handle unexpected errors
    }
  }),
);

export default router;
