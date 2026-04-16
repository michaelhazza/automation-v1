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
import { db } from '../db/index.js';
import { memoryBlocks } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import {
  listVersions,
  diffVersions,
  diffAgainstCanonical,
  resetToCanonical,
} from '../services/memoryBlockVersionService.js';

const router = Router();

async function ensureBlockInOrg(blockId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, orgId),
        isNull(memoryBlocks.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

router.get(
  '/api/memory-blocks/:blockId/versions',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const ok = await ensureBlockInOrg(req.params.blockId, orgId);
    if (!ok) return res.status(404).json({ error: 'Block not found' });
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
    const ok = await ensureBlockInOrg(req.params.blockId, orgId);
    if (!ok) return res.status(404).json({ error: 'Block not found' });
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
    const userId = req.userId!;
    const result = await resetToCanonical({
      blockId: req.params.blockId,
      organisationId: orgId,
      actorUserId: userId,
    });
    return res.json(result);
  }),
);

export default router;
