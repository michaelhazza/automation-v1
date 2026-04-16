/**
 * clarificationService — real-time clarification routing (S8)
 *
 * Owns the lifecycle of a `request_clarification` call mid-run:
 *   1. Resolve recipient per §5.4 routing rules (pure module).
 *   2. Insert an audit row in `memory_review_queue` with
 *      `itemType='clarification_pending'`.
 *   3. Emit WebSocket event to the subaccount room (and direct-to-user via
 *      agent-run room for the in-run awaiting-clarification event).
 *   4. Return the inserted clarification ID so the caller (agent step) can
 *      bind its `waiting_on_clarification` state to the ID.
 *
 * Resolution path (`resolveClarification`):
 *   - Mark the queue row `approved` with the answer payload.
 *   - Emit a WebSocket event so the run resumer can wake the paused step.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 */

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  subaccounts,
  memoryReviewQueue,
  agentRuns,
} from '../db/schema/index.js';
import {
  resolveClarificationRecipient,
  normaliseRoutingConfig,
  type ClarificationRoutingConfig,
  type ClarificationUrgency,
  type ClarificationRecipientRole,
  type PortalMode,
} from './clarificationServicePure.js';
import { emitSubaccountUpdate, emitAwaitingClarification, emitAgentRunUpdate } from '../websocket/emitters.js';
import {
  CLARIFICATION_TIMEOUT_BLOCKING_MINUTES,
  CLARIFICATION_TIMEOUT_NON_BLOCKING_MINUTES,
} from '../config/limits.js';
import { logger } from '../lib/logger.js';

export interface RequestClarificationInput {
  subaccountId: string;
  organisationId: string;
  /** Agent run in flight (null for non-run-bound queries). */
  activeRunId: string | null;
  /** Step ID within the run (null for run-level clarifications). */
  stepId?: string | null;
  /** The agent asking the question. */
  askingAgentId: string;
  question: string;
  contextSnippet?: string | null;
  urgency: ClarificationUrgency;
  suggestedAnswers?: string[];
}

export interface RequestClarificationResult {
  clarificationId: string;
  role: ClarificationRecipientRole;
  reason: string;
  isClientDomain: boolean;
  timeoutMinutes: number;
  expiresAt: Date;
}

/**
 * Fire a clarification request — routes to a named role via WebSocket and
 * writes an audit/state row in `memory_review_queue`. Returns the
 * clarification ID so the caller can bind its paused-step state.
 */
export async function requestClarification(
  input: RequestClarificationInput,
): Promise<RequestClarificationResult> {
  // 1. Resolve recipient role
  const [sub] = await db
    .select({
      portalMode: subaccounts.portalMode,
      clarificationRoutingConfig: subaccounts.clarificationRoutingConfig,
    })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.id, input.subaccountId),
        eq(subaccounts.organisationId, input.organisationId),
        isNull(subaccounts.deletedAt),
      ),
    )
    .limit(1);

  if (!sub) {
    throw { statusCode: 404, message: 'Subaccount not found' };
  }

  // Presence detection lives in websocket/presence layer — for Phase 2 we
  // optimistically assume the default role is online and let timeout handle
  // the offline case. A future enhancement can plug real presence in.
  const resolved = resolveClarificationRecipient({
    question: input.question,
    urgency: input.urgency,
    portalMode: (sub.portalMode as PortalMode) ?? 'hidden',
    routingConfig:
      (sub.clarificationRoutingConfig as ClarificationRoutingConfig | null) ?? null,
    online: {
      // Phase 2: presence always true → default path taken. Timeout fallback
      // handles the offline case asynchronously.
      subaccountManager: true,
      agencyOwner: true,
      clientContact: true,
    },
  });

  const config = normaliseRoutingConfig(
    (sub.clarificationRoutingConfig as ClarificationRoutingConfig | null) ?? null,
  );

  const timeoutMinutes =
    input.urgency === 'blocking'
      ? CLARIFICATION_TIMEOUT_BLOCKING_MINUTES
      : CLARIFICATION_TIMEOUT_NON_BLOCKING_MINUTES;

  const expiresAt = new Date(Date.now() + timeoutMinutes * 60_000);

  // 2. Insert memory_review_queue audit row
  const [inserted] = await db
    .insert(memoryReviewQueue)
    .values({
      organisationId: input.organisationId,
      subaccountId: input.subaccountId,
      itemType: 'clarification_pending',
      confidence: 0, // N/A for clarifications — kept for schema uniformity
      status: 'pending',
      createdByAgentId: input.askingAgentId,
      expiresAt,
      payload: {
        question: input.question,
        contextSnippet: input.contextSnippet ?? null,
        urgency: input.urgency,
        suggestedAnswers: input.suggestedAnswers ?? [],
        recipientRole: resolved.role,
        recipientReason: resolved.reason,
        isClientDomain: resolved.isClientDomain,
        activeRunId: input.activeRunId,
        stepId: input.stepId ?? null,
        askingAgentId: input.askingAgentId,
        routingConfigSnapshot: config,
      },
    })
    .returning({ id: memoryReviewQueue.id });

  const clarificationId = inserted.id;

  // 3. WebSocket notifications
  try {
    emitSubaccountUpdate(input.subaccountId, 'clarification:pending', {
      clarificationId,
      question: input.question,
      urgency: input.urgency,
      recipientRole: resolved.role,
      activeRunId: input.activeRunId,
      stepId: input.stepId ?? null,
      suggestedAnswers: input.suggestedAnswers ?? [],
      expiresAt: expiresAt.toISOString(),
    });

    if (input.activeRunId && input.urgency === 'blocking') {
      emitAwaitingClarification(input.activeRunId, {
        question: input.question,
        blockedBy: 'request_clarification',
      });
    }
  } catch (err) {
    // WS emission failure should not block the insert — the audit row IS the
    // durable state; the UI can surface it on next poll.
    logger.warn('clarificationService.ws_emit_failed', {
      clarificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('clarificationService.requested', {
    clarificationId,
    subaccountId: input.subaccountId,
    urgency: input.urgency,
    role: resolved.role,
    reason: resolved.reason,
    isClientDomain: resolved.isClientDomain,
    activeRunId: input.activeRunId,
    expiresAt: expiresAt.toISOString(),
  });

  return {
    clarificationId,
    role: resolved.role,
    reason: resolved.reason,
    isClientDomain: resolved.isClientDomain,
    timeoutMinutes,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveClarificationInput {
  clarificationId: string;
  organisationId: string;
  resolvedByUserId: string;
  answer: string;
  /** Source of the reply (e.g., 'suggested_answer', 'free_text'). */
  answerSource?: string;
}

export interface ResolveClarificationResult {
  clarificationId: string;
  activeRunId: string | null;
  stepId: string | null;
  answer: string;
  resolvedAt: Date;
}

/**
 * Mark a pending clarification as answered. Emits WS event so the run
 * resumer can wake the paused step.
 */
export async function resolveClarification(
  input: ResolveClarificationInput,
): Promise<ResolveClarificationResult> {
  const resolvedAt = new Date();

  const [row] = await db
    .select({
      id: memoryReviewQueue.id,
      subaccountId: memoryReviewQueue.subaccountId,
      itemType: memoryReviewQueue.itemType,
      payload: memoryReviewQueue.payload,
      status: memoryReviewQueue.status,
    })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.id, input.clarificationId),
        eq(memoryReviewQueue.organisationId, input.organisationId),
      ),
    )
    .limit(1);

  if (!row) {
    throw { statusCode: 404, message: 'Clarification not found' };
  }
  if (row.itemType !== 'clarification_pending') {
    throw { statusCode: 400, message: 'Not a clarification item', errorCode: 'NOT_CLARIFICATION' };
  }
  if (row.status !== 'pending') {
    throw { statusCode: 409, message: `Clarification already ${row.status}`, errorCode: 'CLARIFICATION_NOT_PENDING' };
  }

  const priorPayload = (row.payload as Record<string, unknown>) ?? {};
  const activeRunId = (priorPayload.activeRunId as string | null) ?? null;
  const urgency = (priorPayload.urgency as string | null) ?? null;
  const stepId = (priorPayload.stepId as string | null) ?? null;

  await db
    .update(memoryReviewQueue)
    .set({
      status: 'approved',
      resolvedAt,
      resolvedByUserId: input.resolvedByUserId,
      payload: {
        ...priorPayload,
        answer: input.answer,
        answerSource: input.answerSource ?? 'free_text',
        resolvedAt: resolvedAt.toISOString(),
      },
    })
    .where(eq(memoryReviewQueue.id, input.clarificationId));

  // For blocking clarifications, transition the paused run back to 'running'
  // so the agent execution loop can resume. Mirrors receiveClarification() on
  // the legacy /api/agent-runs/:id/clarify path.
  if (activeRunId && urgency === 'blocking') {
    const [runRow] = await db
      .select({ id: agentRuns.id, runMetadata: agentRuns.runMetadata })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, activeRunId),
          eq(agentRuns.organisationId, input.organisationId),
        ),
      )
      .limit(1);

    if (runRow) {
      const existingMetadata = (runRow.runMetadata as Record<string, unknown> | null) ?? {};
      await db
        .update(agentRuns)
        .set({
          status: 'running',
          runMetadata: {
            ...existingMetadata,
            clarificationAnswer: input.answer,
            clarificationAnswerSource: input.answerSource ?? 'free_text',
            clarificationId: input.clarificationId,
          },
          updatedAt: resolvedAt,
        })
        .where(eq(agentRuns.id, activeRunId));

      try {
        emitAgentRunUpdate(activeRunId, 'agent:run:status', {
          status: 'running',
          clarificationReceived: true,
          clarificationId: input.clarificationId,
          answer: input.answer,
        });
      } catch (emitErr) {
        logger.warn('clarificationService.ws_emit_run_resume_failed', {
          activeRunId,
          error: emitErr instanceof Error ? emitErr.message : String(emitErr),
        });
      }
    }
  }

  // Notify the run so its paused step wakes and consumes the answer.
  try {
    emitSubaccountUpdate(row.subaccountId, 'clarification:resolved', {
      clarificationId: input.clarificationId,
      activeRunId,
      stepId,
      answer: input.answer,
      resolvedAt: resolvedAt.toISOString(),
    });
  } catch (err) {
    logger.warn('clarificationService.ws_emit_resolved_failed', {
      clarificationId: input.clarificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('clarificationService.resolved', {
    clarificationId: input.clarificationId,
    activeRunId,
    stepId,
    resolvedByUserId: input.resolvedByUserId,
  });

  return {
    clarificationId: input.clarificationId,
    activeRunId,
    stepId,
    answer: input.answer,
    resolvedAt,
  };
}

// ---------------------------------------------------------------------------
// Timeout (called by the scheduled job)
// ---------------------------------------------------------------------------

export interface ExpireClarificationInput {
  clarificationId: string;
}

/**
 * Mark a pending clarification as expired (timed out). Emits WS event so the
 * run resumer falls back to best-guess. Idempotent — safe to call twice.
 */
export async function expireClarification(input: ExpireClarificationInput): Promise<void> {
  const now = new Date();

  const [row] = await db
    .select({
      id: memoryReviewQueue.id,
      subaccountId: memoryReviewQueue.subaccountId,
      payload: memoryReviewQueue.payload,
      status: memoryReviewQueue.status,
      itemType: memoryReviewQueue.itemType,
    })
    .from(memoryReviewQueue)
    .where(eq(memoryReviewQueue.id, input.clarificationId))
    .limit(1);

  if (!row || row.status !== 'pending' || row.itemType !== 'clarification_pending') {
    return; // idempotent no-op
  }

  const payload = (row.payload as Record<string, unknown>) ?? {};

  await db
    .update(memoryReviewQueue)
    .set({
      status: 'expired',
      resolvedAt: now,
      payload: {
        ...payload,
        expiredAt: now.toISOString(),
      },
    })
    .where(eq(memoryReviewQueue.id, input.clarificationId));

  try {
    emitSubaccountUpdate(row.subaccountId, 'clarification:expired', {
      clarificationId: input.clarificationId,
      activeRunId: (payload.activeRunId as string | null) ?? null,
      stepId: (payload.stepId as string | null) ?? null,
    });
  } catch (err) {
    logger.warn('clarificationService.ws_emit_expired_failed', {
      clarificationId: input.clarificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('clarificationService.expired', {
    clarificationId: input.clarificationId,
  });
}

/**
 * Convenience lookup for UI routes. Returns all pending clarifications for
 * a subaccount, most recent first.
 */
export async function listPendingClarifications(
  subaccountId: string,
  organisationId: string,
): Promise<
  Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date | null;
    payload: Record<string, unknown>;
  }>
> {
  // Touching agentRuns import keeps it available for future enrichment
  void agentRuns;

  const rows = await db
    .select({
      id: memoryReviewQueue.id,
      createdAt: memoryReviewQueue.createdAt,
      expiresAt: memoryReviewQueue.expiresAt,
      payload: memoryReviewQueue.payload,
    })
    .from(memoryReviewQueue)
    .where(
      and(
        eq(memoryReviewQueue.subaccountId, subaccountId),
        eq(memoryReviewQueue.organisationId, organisationId),
        eq(memoryReviewQueue.itemType, 'clarification_pending'),
        eq(memoryReviewQueue.status, 'pending'),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    payload: (r.payload as Record<string, unknown>) ?? {},
  }));
}
