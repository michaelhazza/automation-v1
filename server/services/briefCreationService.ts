import { db } from '../db/index.js';
import { tasks, conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, asc } from 'drizzle-orm';
import type { BriefUiContext, FastPathDecision } from '../../shared/types/briefFastPath.js';
import type { BriefChatArtefact } from '../../shared/types/briefResultContract.js';
import { findOrCreateBriefConversation } from './briefConversationService.js';
import { writeConversationMessage } from './briefConversationWriter.js';
import { classifyChatIntent, DEFAULT_CHAT_TRIAGE_CONFIG } from './chatTriageClassifier.js';
import { generateSimpleReply } from './briefSimpleReplyGeneratorPure.js';
import { logFastPathDecision } from './fastPathDecisionLogger.js';
import { logger } from '../lib/logger.js';

export async function createBrief(input: {
  organisationId: string;
  subaccountId?: string;
  submittedByUserId: string;
  text: string;
  source: 'global_ask_bar' | 'slash_remember' | 'programmatic';
  uiContext: BriefUiContext;
}): Promise<{ briefId: string; fastPathDecision: FastPathDecision; conversationId: string }> {
  const triageInput = {
    text: input.text,
    uiContext: input.uiContext,
    config: DEFAULT_CHAT_TRIAGE_CONFIG,
  };

  const fastPathDecision = await classifyChatIntent(triageInput);

  const title = input.text.length > 100 ? input.text.slice(0, 97) + '…' : input.text;

  const [task] = await db
    .insert(tasks)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId ?? null,
      title,
      description: input.text,
      status: 'inbox',
      priority: 'normal' as const,
      position: 0,
    })
    .returning();

  const briefId = task!.id;

  const conversation = await findOrCreateBriefConversation({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    scopeType: 'brief',
    scopeId: briefId,
    createdByUserId: input.submittedByUserId,
  });

  // Shadow-eval logging — best-effort, never blocks
  void logFastPathDecision(fastPathDecision, {
    briefId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
  });

  if (fastPathDecision.route === 'simple_reply' || fastPathDecision.route === 'cheap_answer') {
    // Inline response — no Orchestrator needed
    const artefact = generateSimpleReply(fastPathDecision, triageInput);
    await writeConversationMessage({
      conversationId: conversation.id,
      briefId,
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      role: 'assistant',
      content: '',
      artefacts: [artefact],
    });
  } else {
    // needs_orchestrator or needs_clarification → dispatch Orchestrator non-blocking
    import('../jobs/orchestratorFromTaskJob.js').then(({ enqueueOrchestratorRoutingIfEligible }) =>
      enqueueOrchestratorRoutingIfEligible({
        id: briefId,
        organisationId: input.organisationId,
        status: 'inbox',
        assignedAgentId: null,
        isSubTask: false,
        createdByAgentId: null,
        description: input.text,
      }),
    ).catch((err: unknown) => {
      logger.error('briefCreationService.orchestrator_enqueue_failed', {
        briefId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { briefId, fastPathDecision, conversationId: conversation.id };
}

export interface BriefMeta {
  id: string;
  title: string;
  status: string;
  conversationId: string | null;
}

export async function getBriefMeta(
  briefId: string,
  organisationId: string,
): Promise<BriefMeta | null> {
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, briefId), eq(tasks.organisationId, organisationId)))
    .limit(1);

  if (!task) return null;

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.scopeType, 'brief'),
      eq(conversations.scopeId, briefId),
      eq(conversations.organisationId, organisationId),
    ))
    .limit(1);

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    conversationId: conv?.id ?? null,
  };
}

export async function getBriefArtefacts(
  briefId: string,
  organisationId: string,
): Promise<BriefChatArtefact[]> {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.scopeType, 'brief'),
      eq(conversations.scopeId, briefId),
      eq(conversations.organisationId, organisationId),
    ))
    .limit(1);

  if (!conv) return [];

  const messages = await db
    .select({ artefacts: conversationMessages.artefacts })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conv.id))
    .orderBy(asc(conversationMessages.createdAt));

  const all: BriefChatArtefact[] = [];
  for (const msg of messages) {
    if (Array.isArray(msg.artefacts)) {
      all.push(...(msg.artefacts as BriefChatArtefact[]));
    }
  }
  return all;
}
