import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { buildThreadContextReadModel } from '../services/conversationThreadContextService.js';

const router = Router();

/**
 * GET /api/agents/:agentId/conversations/:convId/thread-context
 *
 * Returns the current ThreadContextReadModel for a conversation.
 * Never returns 404 for missing data — returns an empty read model instead.
 * Auth: authenticate + AGENTS_CHAT permission.
 */
router.get(
  '/api/agents/:agentId/conversations/:convId/thread-context',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT),
  asyncHandler(async (req, res) => {
    const { convId } = req.params;
    const organisationId = req.orgId!;

    const readModel = await buildThreadContextReadModel(convId, organisationId);
    res.json(readModel);
  }),
);

export default router;
