import { db } from '../db/index.js';
import { conversations, conversationMessages } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { BriefChatArtefact } from '../../shared/types/briefResultContract.js';
import { validateArtefactForPersistence } from './briefArtefactValidator.js';
import { emitBriefArtefactNew, emitBriefArtefactUpdated, emitConversationUpdate } from '../websocket/emitters.js';
import { logger } from '../lib/logger.js';

export interface WriteMessageInput {
  conversationId: string;
  briefId: string;       // the task/brief ID for websocket room targeting
  organisationId: string;
  subaccountId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  artefacts?: BriefChatArtefact[];
  senderUserId?: string;
  senderAgentId?: string;
  triggeredRunId?: string;
}

export interface WriteMessageResult {
  messageId: string;
  artefactsAccepted: number;
  artefactsRejected: number;
  // True when the turn is expected to produce an assistant follow-up
  // (role === 'user'). Lets the client show a deterministic "Thinking…" state
  // without relying on websocket or refetch timing.
  assistantPending: boolean;
}

/**
 * Single write path into conversation_messages.
 * Validates artefacts, inserts the message row (copying org/subaccount from parent
 * conversation for RLS denormalisation), then emits websocket events.
 */
export async function writeConversationMessage(
  input: WriteMessageInput,
): Promise<WriteMessageResult> {
  // Verify conversation belongs to org
  const [conv] = await db
    .select({ id: conversations.id, organisationId: conversations.organisationId, subaccountId: conversations.subaccountId })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);

  if (!conv || conv.organisationId !== input.organisationId) {
    throw { statusCode: 404, message: 'Conversation not found' };
  }

  // Validate artefacts
  const acceptedArtefacts: BriefChatArtefact[] = [];
  let artefactsRejected = 0;

  for (const artefact of (input.artefacts ?? [])) {
    const result = await validateArtefactForPersistence(artefact, {
      capabilityName: 'brief_conversation_writer',
      briefId: input.briefId,
    });
    if (result.valid) {
      acceptedArtefacts.push(artefact);
    } else {
      artefactsRejected++;
      logger.warn('briefConversationWriter.artefact_rejected', {
        artefactId: artefact.artefactId,
        errors: result.errors,
        conversationId: input.conversationId,
      });
    }
  }

  // Insert message — copy org/subaccount from parent conversation for RLS
  const [message] = await db
    .insert(conversationMessages)
    .values({
      conversationId: input.conversationId,
      organisationId: conv.organisationId,
      subaccountId: conv.subaccountId ?? null,
      role: input.role,
      content: input.content,
      artefacts: acceptedArtefacts,
      senderUserId: input.senderUserId ?? null,
      senderAgentId: input.senderAgentId ?? null,
      triggeredRunId: input.triggeredRunId ?? null,
    })
    .returning({ id: conversationMessages.id });

  const messageId = message!.id;

  // Emit conversation-level event
  emitConversationUpdate(input.conversationId, 'conversation-message:new', {
    messageId,
    role: input.role,
    content: input.content,
    artefactCount: acceptedArtefacts.length,
  });

  // Emit per-artefact Brief-room events
  for (const artefact of acceptedArtefacts) {
    if (artefact.parentArtefactId) {
      emitBriefArtefactUpdated(input.briefId, { messageId, artefact });
    } else {
      emitBriefArtefactNew(input.briefId, { messageId, artefact });
    }
  }

  return {
    messageId,
    artefactsAccepted: acceptedArtefacts.length,
    artefactsRejected,
    assistantPending: input.role === 'user',
  };
}
