import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getBriefConversation, assertCanViewConversation } from '../services/briefConversationService.js';
import { writeConversationMessage } from '../services/briefConversationWriter.js';

const router = Router();

// GET /api/conversations/:conversationId — metadata + paginated messages
router.get(
  '/api/conversations/:conversationId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;

    const conv = await assertCanViewConversation(conversationId, req.orgId!);
    if (!conv) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const result = await getBriefConversation(conversationId, req.orgId!);
    if (!result) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    res.json(result);
  }),
);

// POST /api/conversations/:conversationId/messages — append a user message
router.post(
  '/api/conversations/:conversationId/messages',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { content, briefId } = req.body as { content?: string; briefId?: string };

    if (!content?.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const conv = await assertCanViewConversation(conversationId, req.orgId!);
    if (!conv) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const result = await writeConversationMessage({
      conversationId,
      briefId: briefId ?? conv.scopeId,
      organisationId: req.orgId!,
      role: 'user',
      content: content.trim(),
      senderUserId: req.user!.id,
    });

    res.status(201).json(result);
  }),
);

export default router;
