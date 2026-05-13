import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { getSourcesForBlock } from '../services/memoryBlockSourcesService.js';

const router = Router();

// GET /api/orgs/:orgId/memory-blocks/:blockId/sources
// Returns lineage rows for an auto-synthesised memory block version.
// Spec §4 Phase 1 / §6.1 / §7.1.
router.get(
  '/api/orgs/:orgId/memory-blocks/:blockId/sources',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    // 403-before-query: UUID-canonicalised path-org vs session-org (spec §3 Route guards / R2 F5)
    const pathOrgId = req.params.orgId?.toLowerCase();
    const sessionOrgId = req.orgId?.toLowerCase();
    if (!sessionOrgId || pathOrgId !== sessionOrgId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { blockId } = req.params;
    const version = req.query.version !== undefined ? Number(req.query.version) : undefined;
    const includeReverse = req.query.include_reverse === 'true';

    try {
      const payload = await getSourcesForBlock(blockId, req.orgId!, {
        version: Number.isFinite(version) ? version : undefined,
        includeReverse,
      });
      res.json(payload);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; errorCode?: string };
      if (e.statusCode === 404) {
        res.status(404).json({ error: e.message, errorCode: e.errorCode });
        return;
      }
      throw err;
    }
  }),
);

export default router;
