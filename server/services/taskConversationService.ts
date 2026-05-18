import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, asc } from 'drizzle-orm';
import type { Conversation, ConversationMessage } from '../db/schema/conversations.js';
import type { TaskUiContext, FastPathDecision } from '../../shared/types/taskFastPath.js';
import { handleTaskMessage, type DispatchRoute } from './taskMessageHandlerPure.js';
import { writeConversationMessage, type WriteMessageResult } from './taskConversationWriter.js';

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: ConversationMessage[];
}

export async function getTaskConversation(
  conversationId: string,
  organisationId: string,
): Promise<ConversationWithMessages | null> {
  const scopedDb = getOrgScopedDb('taskConversationService.getTaskConversation');
  const [conv] = await scopedDb
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organisationId, organisationId)))
    .limit(1);
  if (!conv) return null;

  const messages = await scopedDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt));

  return { conversation: conv, messages };
}

export async function findOrCreateTaskConversation(input: {
  organisationId: string;
  subaccountId?: string;
  scopeType: 'agent' | 'brief' | 'task' | 'agent_run';
  scopeId: string;
  createdByUserId?: string;
}): Promise<Conversation> {
  const scopedDb = getOrgScopedDb('taskConversationService.findOrCreateTaskConversation');
  const [existing] = await scopedDb
    .select()
    .from(conversations)
    .where(and(
      eq(conversations.organisationId, input.organisationId),
      eq(conversations.scopeType, input.scopeType),
      eq(conversations.scopeId, input.scopeId),
    ))
    .limit(1);
  if (existing) return existing;

  // INSERT ... ON CONFLICT DO NOTHING handles the SELECT→INSERT race where
  // two concurrent callers both miss on the initial select. The loser of the
  // race gets an empty RETURNING, so re-select to pick up the row the winner
  // inserted.
  const [created] = await scopedDb
    .insert(conversations)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      createdByUserId: input.createdByUserId ?? null,
      status: 'open',
      metadata: {},
    })
    .onConflictDoNothing({ target: [conversations.organisationId, conversations.scopeType, conversations.scopeId] })
    .returning();
  if (created) return created;

  const [winner] = await scopedDb
    .select()
    .from(conversations)
    .where(and(
      eq(conversations.organisationId, input.organisationId),
      eq(conversations.scopeType, input.scopeType),
      eq(conversations.scopeId, input.scopeId),
    ))
    .limit(1);
  if (!winner) {
    throw new Error('findOrCreateTaskConversation: row vanished between ON CONFLICT and re-select');
  }
  return winner;
}

export async function assertCanViewConversation(
  conversationId: string,
  organisationId: string,
): Promise<Conversation | null> {
  const scopedDb = getOrgScopedDb('taskConversationService.assertCanViewConversation');
  const [conv] = await scopedDb
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organisationId, organisationId)))
    .limit(1);
  return conv ?? null;
}

export async function listConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  // guard-ignore-next-line: with-org-tx-or-scoped-db reason="called within withOrgTx context from route handler — orgId in ALS"
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt));
}

export async function handleConversationFollowUp(input: {
  conversationId: string;
  taskId: string;
  organisationId: string;
  subaccountId?: string;
  text: string;
  uiContext: TaskUiContext;
  senderUserId?: string;
  // Caller may pass an already-fetched (org-scoped) conversation row to skip
  // the re-select. Validation still runs — must match `taskId` and have
  // scopeType='task'.
  prefetchedConv?: { scopeType: string | null; scopeId: string };
}): Promise<{ message: WriteMessageResult; route: DispatchRoute; fastPathDecision: FastPathDecision }> {
  // Verify the conversation actually belongs to this task. Without this
  // check, a stale tab or malformed payload that posts {conversationId: B}
  // to a route bound to {taskId: A} would write the user message to
  // conversation B while orchestration runs against task A — splitting
  // intent across two threads. The cross-check is org-scoped via the request
  // tx so it fails closed for cross-tenant attempts as well.
  let conv: { scopeType: string | null; scopeId: string } | undefined;
  if (input.prefetchedConv) {
    conv = input.prefetchedConv;
  } else {
    const tx = getOrgScopedDb('taskConversationService.handleConversationFollowUp');
    const [row] = await tx
      .select({ scopeType: conversations.scopeType, scopeId: conversations.scopeId })
      .from(conversations)
      .where(and(
        eq(conversations.id, input.conversationId),
        eq(conversations.organisationId, input.organisationId),
      ))
      .limit(1);
    conv = row;
  }

  if (!conv || conv.scopeType !== 'task' || conv.scopeId !== input.taskId) {
    throw Object.assign(
      new Error('conversation does not belong to this task'),
      { statusCode: 404 },
    );
  }

  const message = await writeConversationMessage({
    conversationId: input.conversationId,
    taskId: input.taskId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    role: 'user',
    content: input.text,
    senderUserId: input.senderUserId,
  });

  const { route, fastPathDecision } = await handleTaskMessage({
    conversationId: input.conversationId,
    taskId: input.taskId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    text: input.text,
    uiContext: input.uiContext,
    isFollowUp: true,
  });

  return { message, route, fastPathDecision };
}
