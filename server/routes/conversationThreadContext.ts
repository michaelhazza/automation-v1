import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { buildThreadContextReadModel } from '../services/conversationThreadContextService.js';
import { verifyConversationAccess } from '../services/conversationService.js';

const router = Router();

/**
 * GET /api/agents/:agentId/conversations/:convId/thread-context
 *
 * Returns the current ThreadContextReadModel for a conversation.
 * Never returns 404 for missing context data — returns an empty read model instead.
 * Returns 404 if the conversation itself does not exist.
 * Returns 403 if the conversation belongs to a different user.
 * Auth: authenticate + AGENTS_CHAT permission.
 */
router.get(
  '/api/agents/:agentId/conversations/:convId/thread-context',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT),
  asyncHandler(async (req, res) => {
    const { convId, agentId } = req.params;
    const organisationId = req.orgId!;
    const userId = req.user!.id;

    await verifyConversationAccess({ convId, agentId, userId, organisationId });

    const readModel = await buildThreadContextReadModel(convId, organisationId);
    res.json(readModel);
  }),
);

export default router;
