// ---------------------------------------------------------------------------
// request_clarification — Phase 2 S8 tool handler.
//
// Routes a real-time question to a named human via WebSocket and — when
// urgency is 'blocking' — transitions the run to 'waiting_on_clarification'
// so the agent execution loop pauses. The run resumes when a human answers
// via POST /api/clarifications/:id/respond.
//
// Non-blocking clarifications do NOT pause the run — the handler returns a
// success result and the agent continues with its best-guess answer. The
// clarification answer is reconciled on a later run.
//
// Spec: docs/memory-and-briefings-spec.md §5.4
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentRuns } from '../../db/schema/index.js';
import { emitAgentRunUpdate } from '../../websocket/emitters.js';
import { requestClarification } from '../../services/clarificationService.js';
import { tryEmitAgentEvent } from '../../services/agentExecutionEventEmitter.js';

interface RequestClarificationInput {
  question: string;
  contextSnippet?: string;
  urgency: 'blocking' | 'non_blocking';
  suggestedAnswers?: string[];
}

interface RequestClarificationContext {
  runId: string;
  organisationId: string;
  subaccountId?: string | null;
  agentId: string;
  stepId?: string | null;
}

export async function executeRequestClarification(
  input: Record<string, unknown>,
  context: RequestClarificationContext,
): Promise<unknown> {
  const parsed = input as unknown as RequestClarificationInput;

  if (!parsed.question || typeof parsed.question !== 'string' || parsed.question.length < 10) {
    return { success: false, error: 'question must be at least 10 characters' };
  }
  if (parsed.urgency !== 'blocking' && parsed.urgency !== 'non_blocking') {
    return { success: false, error: 'urgency must be "blocking" or "non_blocking"' };
  }
  if (!context.subaccountId) {
    return { success: false, error: 'subaccountId is required for request_clarification' };
  }

  // 1. Enqueue the clarification (writes memory_review_queue row + WS emits)
  const clarification = await requestClarification({
    subaccountId: context.subaccountId,
    organisationId: context.organisationId,
    activeRunId: context.runId,
    stepId: context.stepId ?? null,
    askingAgentId: context.agentId,
    question: parsed.question,
    contextSnippet: parsed.contextSnippet ?? null,
    urgency: parsed.urgency,
    suggestedAnswers: parsed.suggestedAnswers,
  });

  // Live Agent Execution Log — emit clarification.requested event. Fire-
  // and-forget; the log-table write must never block the agent loop.
  tryEmitAgentEvent({
    runId: context.runId,
    organisationId: context.organisationId,
    subaccountId: context.subaccountId ?? null,
    sourceService: 'requestClarification',
    payload: {
      eventType: 'clarification.requested',
      critical: false,
      question: parsed.question,
      awaitingSince: new Date().toISOString(),
    },
  });

  // 2. For blocking urgency, pause the run. The agent-run status enum does
  //    not yet include 'waiting_on_clarification' — this migration (0138) is
  //    listed for Phase 2 but the enum extension has not yet landed in the
  //    runtime schema check constraint. Until that migration lands, we reuse
  //    the existing 'awaiting_clarification' status so the same resume path
  //    (POST /api/clarifications/:id/respond) exercises a known code path.
  if (parsed.urgency === 'blocking') {
    const [updated] = await db
      .update(agentRuns)
      .set({
        status: 'awaiting_clarification',
        updatedAt: new Date(),
        runMetadata: undefined, // handled by subsequent bind below
      })
      .where(
        and(
          eq(agentRuns.id, context.runId),
          eq(agentRuns.organisationId, context.organisationId),
        ),
      )
      .returning({ id: agentRuns.id, runMetadata: agentRuns.runMetadata });

    if (!updated) {
      return { success: false, error: 'Run not found or not updatable' };
    }

    // Record the clarification ID on run metadata so the resume path can
    // find it without additional lookups.
    const prior = (updated.runMetadata as Record<string, unknown> | null) ?? {};
    const priorList =
      (prior.pendingClarifications as Array<Record<string, unknown>> | undefined) ?? [];
    await db
      .update(agentRuns)
      .set({
        runMetadata: {
          ...prior,
          pendingClarifications: [
            ...priorList,
            {
              clarificationId: clarification.clarificationId,
              stepId: context.stepId ?? null,
              urgency: parsed.urgency,
              issuedAt: new Date().toISOString(),
            },
          ],
        },
      })
      .where(eq(agentRuns.id, context.runId));

    emitAgentRunUpdate(context.runId, 'agent:run:status', {
      status: 'awaiting_clarification',
      clarificationId: clarification.clarificationId,
      urgency: parsed.urgency,
      role: clarification.role,
    });

    return {
      success: true,
      message: 'Run paused. Waiting for clarification from ' + clarification.role,
      clarificationId: clarification.clarificationId,
      role: clarification.role,
      expiresAt: clarification.expiresAt.toISOString(),
      paused: true,
    };
  }

  // Non-blocking: run continues; the agent proceeds with best-guess
  return {
    success: true,
    message: 'Clarification requested (non-blocking). Continuing with best-guess answer.',
    clarificationId: clarification.clarificationId,
    role: clarification.role,
    expiresAt: clarification.expiresAt.toISOString(),
    paused: false,
  };
}
