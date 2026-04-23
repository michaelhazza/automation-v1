/**
 * delegationOutcomes.ts — Admin-only delegation outcomes route.
 *
 * Endpoints:
 *   - GET /api/org/delegation-outcomes — list delegation outcomes for the calling org
 *
 * Spec: tasks/builds/paperclip-hierarchy/plan.md §Chunk 1b
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { list } from '../services/delegationOutcomeService.js';

const router = Router();

router.get(
  '/api/org/delegation-outcomes',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.ORG_OBSERVABILITY_VIEW),
  asyncHandler(async (req, res) => {
    const outcomes = await list(req.orgId!, req.query as Record<string, string | undefined>);
    res.json(outcomes);
  }),
);

export { router as delegationOutcomesRouter };
