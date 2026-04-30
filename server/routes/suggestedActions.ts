import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { agentConversations, agentMessages } from '../db/schema/index.js';
import { dispatchSuggestedAction } from '../services/suggestedActionDispatchService.js';
import {
  SUGGESTED_ACTION_KEYS,
  type SuggestedActionKey,
} from '../../shared/types/messageSuggestedActions.js';

const router = Router();

/**
 * POST /api/agents/:agentId/conversations/:convId/messages/:messageId/dispatch-action
 * Fire a system suggested action chip.
 */
router.post(
  '/api/agents/:agentId/conversations/:convId/messages/:messageId/dispatch-action',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_CHAT),
  asyncHandler(async (req, res) => {
    const { agentId, convId, messageId } = req.params;
    const orgId = req.orgId!;
    const userId = req.userId!;

    const { actionKey } = req.body as { actionKey?: unknown };

    if (!actionKey || !SUGGESTED_ACTION_KEYS.includes(actionKey as SuggestedActionKey)) {
      res.status(400).json({ error: 'INVALID_ACTION_KEY', message: 'actionKey must be one of: ' + SUGGESTED_ACTION_KEYS.join(', ') });
      return;
    }

    // Verify conversation belongs to this org + agent + user
    const [conv] = await db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.id, convId),
          eq(agentConversations.agentId, agentId),
          eq(agentConversations.userId, userId),
          eq(agentConversations.organisationId, orgId),
        ),
      );

    if (!conv) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Conversation not found' });
      return;
    }

    // Verify message exists in this conversation.
    // Safety by transitivity: the conversation check above already confirmed
    // that convId belongs to this orgId + agentId + userId, so any message
    // row with conversationId === convId is implicitly within scope. The
    // conversationId predicate here is therefore both a functional lookup
    // filter and a belt-and-suspenders ownership assertion.
    const [msg] = await db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.id, messageId),
          eq(agentMessages.conversationId, convId),
        ),
      );

    if (!msg) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
      return;
    }

    const result = await dispatchSuggestedAction({
      actionKey: actionKey as SuggestedActionKey,
      conversationId: convId,
      agentId,
      userId,
      organisationId: orgId,
    });

    res.json({
      success: true,
      dispatchedActionKey: actionKey,
      redirectUrl: result.redirectUrl,
    });
  }),
);

export default router;
