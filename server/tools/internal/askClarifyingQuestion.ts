// ---------------------------------------------------------------------------
// ask_clarifying_question — Sprint 5 P4.1 tool handler.
//
// When the agent calls this tool, the handler:
//   1. Transitions the run to 'awaiting_clarification'.
//   2. Emits a WebSocket event so the UI can surface the question.
//   3. Returns a tool result telling the LLM the run is paused.
//
// The run resumes via the POST /api/agent-runs/:id/clarify endpoint,
// which appends the user's response as a message and enqueues a
// resume job.
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agentRuns } from '../../db/schema/index.js';
import { emitAwaitingClarification, emitAgentRunUpdate } from '../../websocket/emitters.js';

interface AskClarifyingQuestionInput {
  question: string;
  blocked_by?: 'topic_filter' | 'scope_check' | 'no_relevant_tool' | 'low_confidence';
}

interface AskClarifyingQuestionContext {
  runId: string;
  organisationId: string;
  subaccountId?: string;
}

export async function executeAskClarifyingQuestion(
  input: Record<string, unknown>,
  context: AskClarifyingQuestionContext,
): Promise<unknown> {
  const { question, blocked_by } = input as unknown as AskClarifyingQuestionInput;

  if (!question || typeof question !== 'string' || question.length < 10) {
    return { success: false, error: 'question must be at least 10 characters' };
  }

  // Transition run status to awaiting_clarification
  const [updated] = await db
    .update(agentRuns)
    .set({
      status: 'awaiting_clarification',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentRuns.id, context.runId),
        eq(agentRuns.organisationId, context.organisationId),
      ),
    )
    .returning({ id: agentRuns.id });

  if (!updated) {
    return { success: false, error: 'Run not found or not updatable' };
  }

  // Emit WS event for the UI
  emitAwaitingClarification(context.runId, {
    question,
    blockedBy: blocked_by,
  });

  // Also emit a generic status update so dashboards refresh
  emitAgentRunUpdate(context.runId, 'agent:run:status', {
    status: 'awaiting_clarification',
    question,
    blockedBy: blocked_by,
  });

  return {
    success: true,
    message: 'Run paused. Waiting for user clarification.',
    question,
  };
}
