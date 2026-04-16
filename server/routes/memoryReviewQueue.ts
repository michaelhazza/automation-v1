/**
 * Memory Review Queue routes
 *
 * GET  /api/subaccounts/:subaccountId/memory-review-queue
 * POST /api/memory-review-queue/:itemId/approve
 * POST /api/memory-review-queue/:itemId/reject
 * GET  /api/organisations/memory-review-queue/rollup
 *
 * Spec: docs/memory-and-briefings-spec.md §5.3 (S7)
 */

import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import {
  listQueue,
  approveItem,
  rejectItem,
  orgRollupCounts,
} from '../services/memoryReviewQueueService.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/memory-review-queue',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const { subaccountId } = req.params;

    const [sa] = await db
      .select({ id: subaccounts.id })
      .from(subaccounts)
      .where(
        and(
          eq(subaccounts.id, subaccountId),
          eq(subaccounts.organisationId, orgId),
          isNull(subaccounts.deletedAt),
        ),
      )
      .limit(1);

    if (!sa) return res.status(404).json({ error: 'Subaccount not found' });

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const itemType = typeof req.query.itemType === 'string' ? req.query.itemType : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

    const items = await listQueue(subaccountId, orgId, {
      status: status as 'pending' | 'approved' | 'rejected' | 'auto_applied' | 'expired' | undefined,
      itemType: itemType as 'belief_conflict' | 'block_proposal' | 'clarification_pending' | undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    return res.json({ items });
  }),
);

router.post(
  '/api/memory-review-queue/:itemId/approve',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { itemId } = req.params;
    const { acceptSide } = req.body ?? {};

    if (acceptSide && acceptSide !== 'new' && acceptSide !== 'existing') {
      return res.status(400).json({ error: 'acceptSide must be "new" or "existing"' });
    }

    const item = await approveItem({
      itemId,
      organisationId: orgId,
      resolvedByUserId: userId,
      acceptSide,
    });
    return res.json({ item });
  }),
);

router.post(
  '/api/memory-review-queue/:itemId/reject',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const userId = req.userId!;
    const { itemId } = req.params;

    const item = await rejectItem({ itemId, organisationId: orgId, resolvedByUserId: userId });
    return res.json({ item });
  }),
);

router.get(
  '/api/organisations/memory-review-queue/rollup',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.SUBACCOUNTS_VIEW),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId!;
    const rollup = await orgRollupCounts(orgId);
    return res.json({ rollup });
  }),
);

export default router;
