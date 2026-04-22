import { db } from '../db/index.js';
import { conversations, conversationMessages } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { BriefChatArtefact } from '../../shared/types/briefResultContract.js';
import {
  validateArtefactForPersistence,
  validateLifecycleChainForWrite,
} from './briefArtefactValidator.js';
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

export type LifecycleConflictReason = 'duplicate_supersession';

export interface LifecycleConflictSignal {
  artefactId: string;
  parentArtefactId: string;
  // ID of the existing (or earlier-in-batch) artefact that already supersedes
  // the same parent. Lets operators and future UI trace which chain tip blocked
  // the new write.
  conflictingArtefactId: string;
  reason: LifecycleConflictReason;
}

export interface WriteMessageResult {
  messageId: string;
  artefactsAccepted: number;
  artefactsRejected: number;
  // True when the turn is expected to produce an assistant follow-up
  // (role === 'user'). Lets the client show a deterministic "Thinking…" state
  // without relying on websocket or refetch timing.
  assistantPending: boolean;
  // Structured per-artefact breakdown of write-time lifecycle rejections.
  // Omitted when no conflicts occurred so successful writes stay terse.
  lifecycleConflicts?: LifecycleConflictSignal[];
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
  const perArtefactAccepted: BriefChatArtefact[] = [];
  let artefactsRejected = 0;

  for (const artefact of (input.artefacts ?? [])) {
    const result = await validateArtefactForPersistence(artefact, {
      capabilityName: 'brief_conversation_writer',
      briefId: input.briefId,
    });
    if (result.valid) {
      perArtefactAccepted.push(artefact);
    } else {
      artefactsRejected++;
      logger.warn('briefConversationWriter.artefact_rejected', {
        artefactId: artefact.artefactId,
        errors: result.errors,
        conversationId: input.conversationId,
      });
    }
  }

  // Write-time lifecycle guard — reject artefacts that would duplicate-supersede
  // an already-superseded parent in this conversation. Scoped to one invariant
  // that is unambiguous regardless of arrival order; orphan parents are tolerated.
  const writeGuard = await validateLifecycleChainForWrite(
    input.conversationId,
    perArtefactAccepted,
  );
  const conflictingIds = new Set(writeGuard.conflicts.map((c) => c.artefactId));
  const acceptedArtefacts = perArtefactAccepted.filter((a) => !conflictingIds.has(a.artefactId));
  const lifecycleConflicts: LifecycleConflictSignal[] = [];
  for (const conflict of writeGuard.conflicts) {
    artefactsRejected++;
    lifecycleConflicts.push({
      artefactId: conflict.artefactId,
      parentArtefactId: conflict.error.parentArtefactId,
      conflictingArtefactId: conflict.error.conflictingArtefactId,
      reason: 'duplicate_supersession',
    });
    logger.warn('briefConversationWriter.lifecycle_conflict', {
      artefactId: conflict.artefactId,
      parentArtefactId: conflict.error.parentArtefactId,
      conflictingArtefactId: conflict.error.conflictingArtefactId,
      conversationId: input.conversationId,
      briefId: input.briefId,
    });
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
    ...(lifecycleConflicts.length > 0 ? { lifecycleConflicts } : {}),
  };
}
