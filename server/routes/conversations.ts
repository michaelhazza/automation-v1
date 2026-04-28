import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  getBriefConversation,
  assertCanViewConversation,
  findOrCreateBriefConversation,
  listConversationMessages,
  handleConversationFollowUp,
} from '../services/briefConversationService.js';
import { writeConversationMessage } from '../services/briefConversationWriter.js';
import {
  selectConversationFollowUpAction,
  buildConversationFollowUpResponseExtras,
} from '../services/conversationsRoutePure.js';
import { logger } from '../lib/logger.js';
import type { BriefUiContext } from '../../shared/types/briefFastPath.js';

const router = Router();

// ── Scope-level find-or-create helpers ───────────────────────────────────────

async function handleScopedConversation(
  scopeType: 'task' | 'agent_run',
  scopeId: string,
  orgId: string,
  subaccountId?: string,
) {
  const conv = await findOrCreateBriefConversation({ organisationId: orgId, subaccountId, scopeType, scopeId });
  const messages = await listConversationMessages(conv.id);
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

// POST /api/conversations/:conversationId/messages — append a user message.
// Branch-before-write: selectConversationFollowUpAction determines the path
// BEFORE any write occurs so the routing decision is pure and idempotent.
router.post(
  '/api/conversations/:conversationId/messages',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE),
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { content, briefId, uiContext: bodyUiContext, subaccountId: bodySubaccountId } = req.body as {
      content?: string;
      briefId?: string;
      uiContext?: Partial<BriefUiContext>;
      subaccountId?: string;
    };

    if (!content?.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }

    const conv = await assertCanViewConversation(conversationId, req.orgId!);
    if (!conv) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const action = selectConversationFollowUpAction(conv);

    if (action === 'brief_followup') {
      const uiContext: BriefUiContext = {
        surface: bodyUiContext?.surface ?? 'brief_chat',
        currentOrgId: req.orgId!,
        currentSubaccountId: conv.subaccountId ?? bodySubaccountId ?? undefined,
        userPermissions: new Set<string>(),
      };

      const result = await handleConversationFollowUp({
        conversationId,
        briefId: conv.scopeId,
        organisationId: req.orgId!,
        subaccountId: conv.subaccountId ?? undefined,
        text: content.trim(),
        uiContext,
        senderUserId: req.user!.id,
        prefetchedConv: { scopeType: conv.scopeType, scopeId: conv.scopeId },
      });

      logger.info('conversations_route.brief_followup_dispatched', {
        conversationId,
        briefId: conv.scopeId,
        organisationId: req.orgId!,
        fastPathDecisionKind: result.fastPathDecision.route,
      });

      res.status(201).json({
        ...result.message,
        ...buildConversationFollowUpResponseExtras({ route: result.route, fastPathDecision: result.fastPathDecision }),
      });
      return;
    }

    // noop: non-brief scopes (task, agent_run) — direct write, no orchestration
    const message = await writeConversationMessage({
      conversationId,
      briefId: briefId ?? conv.scopeId,
      organisationId: req.orgId!,
      role: 'user',
      content: content.trim(),
      senderUserId: req.user!.id,
    });

    res.status(201).json({ ...message, ...buildConversationFollowUpResponseExtras(null) });
  }),
);

export default router;
