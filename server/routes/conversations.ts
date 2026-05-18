import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  getTaskConversation,
  assertCanViewConversation,
  findOrCreateTaskConversation,
  listConversationMessages,
  handleConversationFollowUp,
} from '../services/taskConversationService.js';
import { writeConversationMessage } from '../services/taskConversationWriter.js';
import {
  selectConversationFollowUpAction,
  buildConversationFollowUpResponseExtras,
} from '../services/conversationsRoutePure.js';
import { logger } from '../lib/logger.js';
import type { TaskUiContext } from '../../shared/types/taskFastPath.js';

const router = Router();

// ── Scope-level find-or-create helpers ───────────────────────────────────────

async function handleScopedConversation(
  scopeType: 'task' | 'agent_run',
  scopeId: string,
  orgId: string,
  subaccountId?: string,
) {
  const conv = await findOrCreateTaskConversation({ organisationId: orgId, subaccountId, scopeType, scopeId });
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

    const result = await getTaskConversation(conversationId, req.orgId!);
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
  requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE),
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { content, briefId, uiContext: bodyUiContext, subaccountId: bodySubaccountId } = req.body as {
      content?: string;
      briefId?: string;
      uiContext?: Partial<TaskUiContext>;
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
      const uiContext: TaskUiContext = {
        surface: bodyUiContext?.surface ?? 'task_intake_chat',
        currentOrgId: req.orgId!,
        currentSubaccountId: conv.subaccountId ?? bodySubaccountId ?? undefined,
        userPermissions: new Set<string>(),
      };

      const result = await handleConversationFollowUp({
        conversationId,
        taskId: conv.scopeId,
        organisationId: req.orgId!,
        subaccountId: conv.subaccountId ?? undefined,
        text: content.trim(),
        uiContext,
        senderUserId: req.user!.id,
        prefetchedConv: { scopeType: conv.scopeType, scopeId: conv.scopeId },
      });

      logger.info('conversations_route.task_followup_dispatched', {
        conversationId,
        taskId: conv.scopeId,
        organisationId: req.orgId!,
        fastPathDecisionKind: result.fastPathDecision.route,
      });

      res.status(201).json({
        ...result.message,
        ...buildConversationFollowUpResponseExtras({ route: result.route, fastPathDecision: result.fastPathDecision as unknown as { route: string; [k: string]: unknown } }),
      });
      return;
    }

    // noop: non-brief scopes (task, agent_run) — direct write, no orchestration
    const message = await writeConversationMessage({
      conversationId,
      taskId: briefId ?? conv.scopeId,
      organisationId: req.orgId!,
      role: 'user',
      content: content.trim(),
      senderUserId: req.user!.id,
    });

    res.status(201).json({ ...message, ...buildConversationFollowUpResponseExtras(null) });
  }),
);

export default router;
