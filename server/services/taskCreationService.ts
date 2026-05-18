import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { tasks, conversations, conversationMessages } from '../db/schema/index.js';
import { eq, and, asc, desc, lt, or } from 'drizzle-orm';
import type { TaskUiContext, FastPathDecision } from '../../shared/types/taskFastPath.js';
import type { BriefChatArtefact } from '../../shared/types/briefResultContract.js';
import type { CursorPosition } from './taskArtefactCursorPure.js';
import { computeNextCursor } from './taskArtefactPaginationPure.js';
import { logger } from '../lib/logger.js';
import { findOrCreateTaskConversation } from './taskConversationService.js';
import { logFastPathDecision } from './fastPathDecisionLogger.js';
import { handleTaskMessage } from './taskMessageHandlerPure.js';
import { classifyChatIntent, DEFAULT_CHAT_TRIAGE_CONFIG } from './chatTriageClassifier.js';

export async function createTaskIntake(input: {
  organisationId: string;
  subaccountId?: string;
  submittedByUserId: string;
  instructions: string;
  source: 'new_task_modal' | 'global_ask_bar' | 'programmatic';
  uiContext: TaskUiContext;
  assignedAgentId?: string;
  dueDate?: Date;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}): Promise<{ taskId: string; fastPathDecision: FastPathDecision; conversationId: string }> {
  // Classify BEFORE persisting the task. classifyChatIntent can throw (LLM
  // outage, classifier internal error); running it first means a failure
  // never leaves an orphaned task / conversation in the DB. Phase 6 of the
  // pre-launch hardening sprint moved this call inside handleTaskMessage,
  // which inverted the ordering — restore the pre-Phase-6 invariant here.

  // Derive title from instructions with truncation.
  const title = input.instructions.length > 100
    ? input.instructions.slice(0, 97) + '…'
    : input.instructions;

  // classifyChatIntent receives the full free-text prompt.
  const classifyText = input.instructions;

  const fastPathDecision = await classifyChatIntent({
    text: classifyText,
    uiContext: input.uiContext,
    config: DEFAULT_CHAT_TRIAGE_CONFIG,
  });

  const scopedDb = getOrgScopedDb('taskCreationService.createTaskIntake');
  const [task] = await scopedDb
    .insert(tasks)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId ?? null,
      title,
      description: input.instructions,
      status: 'inbox',
      priority: (input.priority ?? 'normal') as 'low' | 'normal' | 'high' | 'urgent',
      assignedAgentId: input.assignedAgentId ?? null,
      dueDate: input.dueDate ?? null,
      position: 0,
    })
    .returning();

  const taskId = task!.id;

  const conversation = await findOrCreateTaskConversation({
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    scopeType: 'task',
    scopeId: taskId,
    createdByUserId: input.submittedByUserId,
  });

  // Pass the precomputed decision so handleTaskMessage skips its own
  // classify call — keeps the dispatch logic in one place without
  // double-charging the classifier.
  await handleTaskMessage({
    conversationId: conversation.id,
    taskId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    text: classifyText,
    uiContext: input.uiContext,
    isFollowUp: false,
    prefetchedDecision: fastPathDecision,
  });

  // Shadow-eval logging — best-effort, never blocks
  void logFastPathDecision(fastPathDecision, {
    taskId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
  });

  return { taskId, fastPathDecision, conversationId: conversation.id };
}

export interface TaskMeta {
  id: string;
  title: string;
  status: string;
  conversationId: string | null;
}

export async function getTaskMeta(
  taskId: string,
  organisationId: string,
): Promise<TaskMeta | null> {
  const scopedDb2 = getOrgScopedDb('taskCreationService.getTaskMeta');
  const [task] = await scopedDb2
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, organisationId)))
    .limit(1);

  if (!task) return null;

  const [conv] = await scopedDb2
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.scopeType, 'task'),
      eq(conversations.scopeId, taskId),
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

export async function getTaskArtefacts(
  taskId: string,
  organisationId: string,
  opts?: { limit?: number; cursor?: CursorPosition | null },
): Promise<{ items: BriefChatArtefact[]; nextCursor: string | null }> {
  const requestedLimit = Math.trunc(opts?.limit ?? 50);
  const clampedLimit = Math.max(1, Math.min(requestedLimit, 200));
  if (requestedLimit !== clampedLimit) {
    logger.info('task_artefacts.limit_clamped', { taskId, requested: opts?.limit, applied: clampedLimit });
  }
  const cursor = opts?.cursor ?? null;

  const scopedDb3 = getOrgScopedDb('taskCreationService.getTaskArtefacts');
  const [conv] = await scopedDb3
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.scopeType, 'task'),
      eq(conversations.scopeId, taskId),
      eq(conversations.organisationId, organisationId),
    ))
    .limit(1);

  if (!conv) return { items: [], nextCursor: null };

  const cursorCondition = cursor
    ? or(
        lt(conversationMessages.createdAt, new Date(cursor.ts)),
        and(
          eq(conversationMessages.createdAt, new Date(cursor.ts)),
          lt(conversationMessages.id, cursor.msgId),
        ),
      )
    : undefined;

  const rows = await scopedDb3
    .select({
      id: conversationMessages.id,
      createdAt: conversationMessages.createdAt,
      artefacts: conversationMessages.artefacts,
    })
    .from(conversationMessages)
    .where(and(
      eq(conversationMessages.conversationId, conv.id),
      eq(conversationMessages.organisationId, organisationId),
      cursorCondition,
    ))
    .orderBy(
      desc(conversationMessages.createdAt),
      desc(conversationMessages.id),
    )
    .limit(clampedLimit + 1);

  const { items: pageRows, nextCursor } = computeNextCursor(rows, clampedLimit);

  // Reverse to ASC (oldest-first within page) for chat-timeline display.
  // The DESC query selected the correct page boundary; reversal ensures each
  // page response is in chronological order so the client can prepend older
  // pages to the front of the array without disrupting display order.
  const reversedRows = [...pageRows].reverse();

  const items: BriefChatArtefact[] = [];
  for (const row of reversedRows) {
    if (Array.isArray(row.artefacts)) {
      items.push(...(row.artefacts as BriefChatArtefact[]));
    }
  }
  return { items, nextCursor };
}

export async function getAllTaskArtefacts(
  taskId: string,
  organisationId: string,
): Promise<BriefChatArtefact[]> {
  const scopedDb = getOrgScopedDb('taskCreationService.getAllTaskArtefacts');
  const [conv] = await scopedDb
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.scopeType, 'task'),
      eq(conversations.scopeId, taskId),
      eq(conversations.organisationId, organisationId),
    ))
    .limit(1);

  if (!conv) return [];

  const messages = await scopedDb
    .select({ artefacts: conversationMessages.artefacts })
    .from(conversationMessages)
    .where(and(
      eq(conversationMessages.conversationId, conv.id),
      eq(conversationMessages.organisationId, organisationId),
    ))
    .orderBy(asc(conversationMessages.createdAt));

  const all: BriefChatArtefact[] = [];
  for (const msg of messages) {
    if (Array.isArray(msg.artefacts)) {
      all.push(...(msg.artefacts as BriefChatArtefact[]));
    }
  }
  return all;
}
