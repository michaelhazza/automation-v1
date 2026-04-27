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

/**
 * Defensive cap on artefacts per write — stops runaway capabilities from
 * emitting hundreds of artefacts in a single message. The cap is generous
 * enough that legitimate multi-artefact output fits; overflow is rejected
 * explicitly (logged + counted in `artefactsRejected`) rather than silently
 * truncated.
 */
export const MAX_ARTEFACTS_PER_WRITE = 25;

// ---------------------------------------------------------------------------
// In-memory operational counters — scraped by `getBriefConversationWriterMetrics`.
// Follows the pattern used in `agentExecutionEventService.ts`:
// structured log events remain the source of truth; counters give dashboards
// a cheap aggregate without re-parsing logs.
// ---------------------------------------------------------------------------

let lifecycleConflictsTotal = 0;
let artefactsOverLimitTotal = 0;
let artefactsValidationRejectedTotal = 0;

export function getBriefConversationWriterMetrics(): {
  lifecycleConflictsTotal: number;
  artefactsOverLimitTotal: number;
  artefactsValidationRejectedTotal: number;
} {
  return {
    lifecycleConflictsTotal,
    artefactsOverLimitTotal,
    artefactsValidationRejectedTotal,
  };
}

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
  // Server-stamped copies of the accepted artefacts (carrying serverCreatedAt
  // populated at persistence time). Returned so callers that include an
  // artefact in their HTTP response can hand the client the same shape that
  // was just persisted and emitted on the websocket.
  stampedArtefacts: BriefChatArtefact[];
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

  // Defensive cap — reject overflow artefacts explicitly rather than silently
  // truncating, so runaway emission surfaces in artefactsRejected + logs.
  const rawArtefacts = input.artefacts ?? [];
  const artefactsUnderCap = rawArtefacts.slice(0, MAX_ARTEFACTS_PER_WRITE);
  const overflowArtefacts = rawArtefacts.slice(MAX_ARTEFACTS_PER_WRITE);

  // Validate artefacts
  const perArtefactAccepted: BriefChatArtefact[] = [];
  let artefactsRejected = 0;

  for (const overflow of overflowArtefacts) {
    artefactsRejected++;
    artefactsOverLimitTotal++;
    logger.warn('briefConversationWriter.artefacts_over_limit', {
      artefactId: overflow.artefactId,
      rejectedCount: overflowArtefacts.length,
      limit: MAX_ARTEFACTS_PER_WRITE,
      conversationId: input.conversationId,
      briefId: input.briefId,
    });
  }

  for (const artefact of artefactsUnderCap) {
    const result = await validateArtefactForPersistence(artefact, {
      capabilityName: 'brief_conversation_writer',
      briefId: input.briefId,
    });
    if (result.valid) {
      perArtefactAccepted.push(artefact);
    } else {
      artefactsRejected++;
      artefactsValidationRejectedTotal++;
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
    lifecycleConflictsTotal++;
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

  // Stamp serverCreatedAt at persistence time so the UI can keep timeline
  // order consistent when WS events for distinct artefactIds arrive out of
  // logical order. Per-artefact stamping (rather than message-level) is
  // necessary because one message may emit multiple artefacts and the UI
  // renders them as individual timeline entries.
  const persistedAt = new Date().toISOString();
  const stampedArtefacts = acceptedArtefacts.map((a) =>
    a.serverCreatedAt ? a : { ...a, serverCreatedAt: persistedAt },
  );

  // Insert message — copy org/subaccount from parent conversation for RLS
  const [message] = await db
    .insert(conversationMessages)
    .values({
      conversationId: input.conversationId,
      organisationId: conv.organisationId,
      subaccountId: conv.subaccountId ?? null,
      role: input.role,
      content: input.content,
      artefacts: stampedArtefacts,
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

  // Emit per-artefact Brief-room events. Use the stamped copies so WS
  // consumers see the same `serverCreatedAt` that was just persisted.
  for (const artefact of stampedArtefacts) {
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
    stampedArtefacts,
    ...(lifecycleConflicts.length > 0 ? { lifecycleConflicts } : {}),
  };
}
