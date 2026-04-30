import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { agentConversations } from '../db/schema/index.js';
import { buildThreadContextReadModel } from '../services/conversationThreadContextService.js';

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
    const { convId } = req.params;
    const organisationId = req.orgId!;
    const userId = req.user!.id;

    // Ownership check — 404 if conversation doesn't exist, 403 if wrong user
    const [conv] = await db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.id, convId),
          eq(agentConversations.organisationId, organisationId),
        ),
      )
      .limit(1);

    if (!conv) {
      throw { statusCode: 404, message: 'Conversation not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    if (conv.userId !== userId) {
      throw { statusCode: 403, message: 'Forbidden', errorCode: 'FORBIDDEN' };
    }

    const readModel = await buildThreadContextReadModel(convId, organisationId);
    res.json(readModel);
  }),
);

export default router;
