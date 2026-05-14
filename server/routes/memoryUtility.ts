import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { getMemoryUtilityForOrg } from '../services/memoryUtilityQueryService.js';

const router = Router();

// GET /api/orgs/:orgId/usage/memory-utility
// Returns 30-day memory-utility aggregate + daily series.
// Spec §4 Phase 4 / §6.6.
router.get(
  '/api/orgs/:orgId/usage/memory-utility',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (req, res) => {
    // 403-before-query: UUID-canonicalised path-org vs session-org (spec §3 Route guards)
    const pathOrgId = req.params.orgId?.toLowerCase();
    const sessionOrgId = req.orgId?.toLowerCase();
    if (!sessionOrgId || pathOrgId !== sessionOrgId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const payload = await getMemoryUtilityForOrg(req.orgId!);
    res.json(payload);
  }),
);

export default router;
