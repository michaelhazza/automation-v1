import { db } from '../db/index.js';
import { conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, asc } from 'drizzle-orm';
import type { Conversation, ConversationMessage } from '../db/schema/conversations.js';

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
    .onConflictDoNothing({ target: [conversations.scopeType, conversations.scopeId] })
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
