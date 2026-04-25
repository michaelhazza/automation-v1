/**
 * Memory Block Versions routes (S24)
 *
 * GET  /api/memory-blocks/:blockId/versions
 * GET  /api/memory-blocks/:blockId/versions/:v1/diff/:v2
 * GET  /api/memory-blocks/:blockId/diff-canonical
 * POST /api/memory-blocks/:blockId/reset-canonical
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  listVersions,
  diffVersions,
  diffAgainstCanonical,
  resetToCanonical,
  ensureBlockInOrg,
} from '../services/memoryBlockVersionService.js';

const router = Router();

router.get(
  '/api/memory-blocks/:blockId/versions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    await ensureBlockInOrg(req.params.blockId, orgId);
    const versions = await listVersions(req.params.blockId);
    return res.json({ versions });
  }),
);

router.get(
  '/api/memory-blocks/:blockId/versions/:v1/diff/:v2',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const v1 = Number.parseInt(req.params.v1, 10);
    const v2 = Number.parseInt(req.params.v2, 10);
    if (!Number.isFinite(v1) || !Number.isFinite(v2)) {
      return res.status(400).json({ error: 'Invalid version numbers' });
    }
    await ensureBlockInOrg(req.params.blockId, orgId);
    const diff = await diffVersions(req.params.blockId, v1, v2);
    return res.json(diff);
  }),
);

router.get(
  '/api/memory-blocks/:blockId/diff-canonical',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const result = await diffAgainstCanonical(req.params.blockId, orgId);
    if (!result) {
      return res.status(400).json({
        error: 'Block is not protected — no canonical file to diff against',
        errorCode: 'NOT_PROTECTED_BLOCK',
      });
    }
    return res.json(result);
  }),
);

router.post(
  '/api/memory-blocks/:blockId/reset-canonical',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.user!.id;
    const result = await resetToCanonical({
      blockId: req.params.blockId,
      organisationId: orgId,
      actorUserId: userId,
    });
    return res.json(result);
  }),
);

export default router;
