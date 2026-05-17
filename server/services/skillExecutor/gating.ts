import type { SkillExecutionContext } from './context.js';
import { runWithProcessors } from './pipeline.js';
import { actionService, buildActionIdempotencyKey } from '../actionService.js';
import { reviewService } from '../reviewService.js';
import { hitlService } from '../hitlService.js';
import { executionLayerService } from '../executionLayerService.js';
import { getActionDefinition } from '../../config/actionRegistry.js';
import { createSpan, createEvent } from '../../lib/tracing.js';
import { TripWire } from '../../lib/tripwire.js';
import { HITL_REVIEW_TIMEOUT_MS } from '../../config/limits.js';

// ---------------------------------------------------------------------------
// Action-gated execution helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an auto-gated internal skill: creates an action record for auditability,
 * executes synchronously, and records the result.
 *
 * If the policy engine has escalated this skill to review (returns pending_approval),
 * we fall through to the review-gate path so the agent still gets a proper result.
 */
export async function executeWithActionAudit(
  actionType: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext,
  executor: () => Promise<unknown>
): Promise<unknown> {
  // Sprint 2 P1.1 Layer 3: when a toolCallId is on the context, build a
  // deterministic key that matches the one proposeActionMiddleware already
  // wrote for this call. proposeAction() short-circuits on the existing
  // row (isNew === false) and the wrapper moves on to execution. Legacy
  // callers without a toolCallId fall back to the old timestamp key.
  const idempotencyKey = context.toolCallId
    ? buildActionIdempotencyKey({
        runId: context.runId,
        toolCallId: context.toolCallId,
        args: input,
      })
    : `${actionType}:${context.runId}:${Date.now()}`;
  const pipelineSpan = createSpan('skill.pipeline.run', { skillName: actionType, gateLevel: 'auto' }, { input });

  try {
    const proposed = await actionService.proposeAction({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      actionType,
      idempotencyKey,
      payload: input,
      taskId: context.taskId,
    });

    createEvent('skill.action.proposed', {
      skillName: actionType, actionId: proposed.actionId, status: proposed.status,
    }, { parentSpan: pipelineSpan });

    // Duplicate detected — return existing status
    if (!proposed.isNew) {
      const dupeResult = { success: true, action_id: proposed.actionId, status: proposed.status, message: 'Duplicate action detected' };
      pipelineSpan.end({ output: dupeResult });
      return dupeResult;
    }

    // Policy engine escalated to block — return denial immediately
    if (proposed.status === 'blocked') {
      createEvent('skill.gate.decision', {
        gateLevel: 'block', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      const denial = buildDenialMessage(actionType, 'This action is blocked by policy for this account.');
      pipelineSpan.end({ output: denial });
      return denial;
    }

    // Policy engine escalated to review — block and await human decision
    if (proposed.status === 'pending_approval') {
      createEvent('skill.gate.decision', {
        gateLevel: 'review', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      const action = await actionService.getAction(proposed.actionId, context.organisationId);
      await reviewService.createReviewItem(action, {
        actionType,
        reasoning: input.metadata ? String((input.metadata as Record<string, unknown>).reasoning ?? '') : undefined,
        proposedPayload: input,
      });
      const reviewResult = await awaitReviewDecision(proposed.actionId, actionType, context);
      pipelineSpan.end({ output: reviewResult });
      return reviewResult;
    }

    createEvent('skill.gate.decision', {
      gateLevel: 'auto', skillName: actionType, actionId: proposed.actionId,
    }, { parentSpan: pipelineSpan });

    // Auto-approved — execute inline with processor pipeline
    const locked = await actionService.lockForExecution(proposed.actionId, context.organisationId);
    if (!locked) {
      pipelineSpan.end({ output: { success: false, error: 'Failed to acquire execution lock' } });
      return { success: false, error: 'Failed to acquire execution lock' };
    }

    const executeSpan = createSpan('skill.phase.execute', { skillName: actionType }, { parentSpan: pipelineSpan });
    const result = await runWithProcessors(
      actionType,
      input,
      context,
      (_processedInput) => executor(),
      proposed.actionId,
    );
    executeSpan.end({ output: result });

    const resultObj = result as Record<string, unknown>;
    if (resultObj?.success) {
      await actionService.markCompleted(proposed.actionId, context.organisationId, result);
    } else {
      await actionService.markFailed(proposed.actionId, context.organisationId, String(resultObj?.error ?? 'Unknown error'));
    }

    pipelineSpan.end({ output: result });
    return result;
  } catch (err) {
    if (err instanceof TripWire && !err.options.retry) {
      createEvent('skill.tripwire.triggered', {
        skillName: actionType, fatal: true, reason: err.reason, code: err.options.code,
      }, { parentSpan: pipelineSpan, level: 'ERROR' });
      pipelineSpan.end({ output: { success: false, error: err.reason } });
      return { success: false, error: `Action halted: ${err.reason}`, code: err.options.code };
    }
    createEvent('skill.action.failed', {
      skillName: actionType, error: String(err).slice(0, 200),
    }, { parentSpan: pipelineSpan, level: 'ERROR' });
    console.error(`[ActionAudit] Failed to track ${actionType}, executing directly:`, err);
    pipelineSpan.end({ output: { error: String(err) } });
    return executor();
  }
}

/**
 * Proposes a review-gated action and BLOCKS until a human decides.
 *
 * Returns:
 *   - On approval: the execution result from the adapter (via hitlService)
 *   - On rejection/timeout: a structured denial observation (not an exception)
 *
 * The agent receives this as a normal tool call result and continues its loop.
 */
export async function proposeReviewGatedAction(
  actionType: string,
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const definition = getActionDefinition(actionType);
  if (!definition) {
    return { success: false, error: `Unknown action type: ${actionType}` };
  }

  const pipelineSpan = createSpan('skill.pipeline.run', { skillName: actionType, gateLevel: 'review' }, { input });

  // Sprint 2 P1.1 Layer 3: deterministic key matches the middleware's so
  // both paths resolve to the same action row. Legacy fallback preserves
  // the old per-field key for callers that still lack a toolCallId.
  let idempotencyKey: string;
  if (context.toolCallId) {
    idempotencyKey = buildActionIdempotencyKey({
      runId: context.runId,
      toolCallId: context.toolCallId,
      args: input,
    });
  } else {
    const keyParts = [actionType, context.subaccountId ?? `org:${context.organisationId}`];
    if (input.thread_id) keyParts.push(String(input.thread_id));
    if (input.record_id) keyParts.push(String(input.record_id));
    keyParts.push(String(Date.now()));
    idempotencyKey = keyParts.join(':');
  }

  try {
    const proposed = await actionService.proposeAction({
      organisationId: context.organisationId,
      subaccountId: context.subaccountId,
      agentId: context.agentId,
      agentRunId: context.runId,
      actionType,
      idempotencyKey,
      payload: input,
      metadata: input.metadata as Record<string, unknown> | undefined,
      taskId: context.taskId,
    });

    createEvent('skill.action.proposed', {
      skillName: actionType, actionId: proposed.actionId, status: proposed.status,
    }, { parentSpan: pipelineSpan });

    // Duplicate — return its current status
    if (!proposed.isNew) {
      const result = { success: true, action_id: proposed.actionId, status: proposed.status, message: 'Action already exists (duplicate detected)' };
      pipelineSpan.end({ output: result });
      return result;
    }

    // Policy engine blocked it — return denial immediately, no review queue entry
    if (proposed.status === 'blocked') {
      createEvent('skill.gate.decision', {
        gateLevel: 'block', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      const denial = buildDenialMessage(actionType, 'This action is blocked by policy for this account.');
      pipelineSpan.end({ output: denial });
      return denial;
    }

    // Policy engine auto-approved it — should not happen for review-gated skills,
    // but handle it gracefully by dispatching immediately
    if (proposed.status === 'approved') {
      createEvent('skill.gate.decision', {
        gateLevel: 'auto', skillName: actionType, actionId: proposed.actionId,
      }, { parentSpan: pipelineSpan });
      await executionLayerService.executeAction(proposed.actionId, context.organisationId);
      const result = { success: true, action_id: proposed.actionId, status: 'completed', message: 'Action auto-approved and executed.' };
      pipelineSpan.end({ output: result });
      return result;
    }

    createEvent('skill.gate.decision', {
      gateLevel: 'review', skillName: actionType, actionId: proposed.actionId,
    }, { parentSpan: pipelineSpan });

    // pending_approval — create review item, then block until decision
    const action = await actionService.getAction(proposed.actionId, context.organisationId);
    await reviewService.createReviewItem(action, {
      actionType,
      reasoning: input.metadata ? String((input.metadata as Record<string, unknown>).reasoning ?? '') : undefined,
      proposedPayload: input,
    });

    const reviewStartTime = Date.now();
    const reviewSpan = createSpan('skill.review.wait', {
      skillName: actionType, actionId: proposed.actionId, criticalPath: true,
    }, { parentSpan: pipelineSpan });

    const reviewResult = await awaitReviewDecision(proposed.actionId, actionType, context);

    reviewSpan.end({
      output: {
        approved: !!(reviewResult && typeof reviewResult === 'object' && (reviewResult as Record<string, unknown>).success),
        waitDurationMs: Date.now() - reviewStartTime,
      },
    });
    pipelineSpan.end({ output: reviewResult });
    return reviewResult;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    createEvent('skill.action.failed', {
      skillName: actionType, error: errMsg.slice(0, 200),
    }, { parentSpan: pipelineSpan, level: 'ERROR' });
    pipelineSpan.end({ output: { success: false, error: errMsg } });
    return { success: false, error: `Failed to propose ${actionType}: ${errMsg}` };
  }
}

/**
 * Shared await logic: blocks until hitlService resolves the decision,
 * then returns the execution result or a denial observation.
 */
async function awaitReviewDecision(
  actionId: string,
  actionType: string,
  context: SkillExecutionContext
): Promise<unknown> {
  const decision = await hitlService.awaitDecision(actionId, HITL_REVIEW_TIMEOUT_MS);

  if (!decision.approved) {
    return buildDenialMessage(actionType, decision.comment ?? 'No reason provided');
  }

  // Return the execution result that reviewService ran via executionLayerService
  return {
    success: true,
    action_id: actionId,
    status: 'completed',
    result: decision.result,
    edited: decision.editedArgs ? true : undefined,
  };
}

/**
 * Builds a structured denial observation that the agent receives as a tool result.
 * The agent continues its loop — this is never thrown as an exception.
 * Pattern from n8n: inject the denial as a tool output, not an error.
 */
function buildDenialMessage(actionType: string, comment: string): Record<string, unknown> {
  return {
    success: false,
    status: 'denied',
    action_type: actionType,
    message: `Action '${actionType}' was not approved. Reason: ${comment}`,
    instruction: 'Do not retry this action automatically. Inform the user or adjust your approach based on the feedback.',
  };
}
