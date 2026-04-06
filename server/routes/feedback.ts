import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { feedbackService } from '../services/feedbackService.js';

const router = Router();

/**
 * POST /api/feedback
 * Upsert a vote on an agent-generated entity.
 */
router.post(
  '/api/feedback',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const row = await feedbackService.upsertVote(req.user!.id, req.orgId!, req.body);
    res.status(201).json(row);
  })
);

/**
 * GET /api/feedback/my-votes
 * Fetch the current user's votes for a given entity type and set of entity IDs.
 * Query params: entityType, entityIds (comma-separated)
 */
router.get(
  '/api/feedback/my-votes',
  authenticate,
  asyncHandler(async (req, res) => {
    const { entityType, entityIds } = req.query as { entityType?: string; entityIds?: string };
    if (!entityType || !entityIds) {
      res.json([]);
      return;
    }
    const ids = entityIds.split(',').filter(Boolean);
    const rows = await feedbackService.getMyVotes(req.user!.id, req.orgId!, entityType, ids);
    res.json(rows);
  })
);

/**
 * DELETE /api/feedback/:feedbackId
 * Hard delete a feedback vote.
 */
router.delete(
  '/api/feedback/:feedbackId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE),
  asyncHandler(async (req, res) => {
    const result = await feedbackService.removeVote(req.params.feedbackId, req.user!.id, req.orgId!);
    res.json(result);
  })
);

/**
 * GET /api/feedback/agent/:agentId/summary
 * Aggregate up/down vote counts for an agent, with optional date range.
 * Query params: startDate, endDate (ISO strings)
 */
router.get(
  '/api/feedback/agent/:agentId/summary',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const summary = await feedbackService.getAgentSummary(
      req.params.agentId,
      req.orgId!,
      startDate || endDate ? { startDate, endDate } : undefined,
    );
    res.json(summary);
  })
);

export default router;
