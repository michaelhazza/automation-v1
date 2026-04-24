import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  getBriefConversation,
  assertCanViewConversation,
  findOrCreateBriefConversation,
} from '../services/briefConversationService.js';
import { writeConversationMessage } from '../services/briefConversationWriter.js';
import { db } from '../db/index.js';
import { conversationMessages } from '../db/schema/index.js';
import { eq, asc } from 'drizzle-orm';

const router = Router();

// ── Scope-level find-or-create helpers ───────────────────────────────────────

async function handleScopedConversation(
  scopeType: 'task' | 'agent_run',
  scopeId: string,
  orgId: string,
  subaccountId?: string,
) {
  const conv = await findOrCreateBriefConversation({ organisationId: orgId, subaccountId, scopeType, scopeId });
  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conv.id))
    .orderBy(asc(conversationMessages.createdAt));
  return { conversationId: conv.id, messages };
}

// GET /api/conversations/task/:taskId — find-or-create conversation for a task
router.get(
  '/api/conversations/task/:taskId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const result = await handleScopedConversation('task', req.params.taskId, req.orgId!);
    res.json(result);
  }),
);

// GET /api/conversations/agent-run/:runId — find-or-create conversation for an agent run
router.get(
  '/api/conversations/agent-run/:runId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const result = await handleScopedConversation('agent_run', req.params.runId, req.orgId!);
    res.json(result);
  }),
);

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
