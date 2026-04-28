import { db } from '../db/index.js';
import { conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, asc } from 'drizzle-orm';
import type { Conversation, ConversationMessage } from '../db/schema/conversations.js';
import type { BriefUiContext, FastPathDecision } from '../../shared/types/briefFastPath.js';
import { handleBriefMessage, type DispatchRoute } from './briefMessageHandlerPure.js';
import { writeConversationMessage } from './briefConversationWriter.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: ConversationMessage[];
}

export async function getBriefConversation(
  conversationId: string,
  organisationId: string,
): Promise<ConversationWithMessages | null> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organisationId, organisationId)))
    .limit(1);
  if (!conv) return null;

  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt));

  return { conversation: conv, messages };
}

export async function findOrCreateBriefConversation(input: {
  organisationId: string;
  subaccountId?: string;
  scopeType: 'agent' | 'brief' | 'task' | 'agent_run';
  scopeId: string;
  createdByUserId?: string;
}): Promise<Conversation> {
  const [existing] = await db
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
  const [created] = await db
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

  const [winner] = await db
    .select()
    .from(conversations)
    .where(and(
      eq(conversations.organisationId, input.organisationId),
      eq(conversations.scopeType, input.scopeType),
      eq(conversations.scopeId, input.scopeId),
    ))
    .limit(1);
  if (!winner) {
    throw new Error('findOrCreateBriefConversation: row vanished between ON CONFLICT and re-select');
  }
  return winner;
}

export async function assertCanViewConversation(
  conversationId: string,
  organisationId: string,
): Promise<Conversation | null> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organisationId, organisationId)))
    .limit(1);
  return conv ?? null;
}

export async function listConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt));
}

export async function handleConversationFollowUp(input: {
  conversationId: string;
  briefId: string;
  organisationId: string;
  subaccountId?: string;
  text: string;
  uiContext: BriefUiContext;
  senderUserId?: string;
}): Promise<{ route: DispatchRoute; fastPathDecision: FastPathDecision }> {
  // Verify the conversation actually belongs to this brief. Without this
  // check, a stale tab or malformed payload that posts {conversationId: B}
  // to a route bound to {briefId: A} would write the user message to
  // conversation B while orchestration runs against brief A — splitting
  // intent across two threads. The cross-check is org-scoped via the request
  // tx so it fails closed for cross-tenant attempts as well.
  const tx = getOrgScopedDb('briefConversationService.handleConversationFollowUp');
  const [conv] = await tx
    .select({ scopeType: conversations.scopeType, scopeId: conversations.scopeId })
    .from(conversations)
    .where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organisationId, input.organisationId),
    ))
    .limit(1);

  if (!conv || conv.scopeType !== 'brief' || conv.scopeId !== input.briefId) {
    throw Object.assign(
      new Error('conversation does not belong to this brief'),
      { statusCode: 404 },
    );
  }

  await writeConversationMessage({
    conversationId: input.conversationId,
    briefId: input.briefId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    role: 'user',
    content: input.text,
    senderUserId: input.senderUserId,
  });

  return handleBriefMessage({
    conversationId: input.conversationId,
    briefId: input.briefId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    text: input.text,
    uiContext: input.uiContext,
    isFollowUp: true,
  });
}
