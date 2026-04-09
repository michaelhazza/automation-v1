/**
 * reflectionLoopMiddleware — Sprint 3 P2.2 deterministic reflection loop.
 *
 * Sits in the `postTool` pipeline. Enforces the "no write_patch without an
 * APPROVE verdict from review_code" contract and escalates to HITL after
 * `MAX_REFLECTION_ITERATIONS` blocked attempts. All decision logic lives
 * in `reflectionLoopPure.ts` — this file is the impure wrapper that
 * projects `MiddlewareContext` into the pure helper and applies the
 * resulting state delta.
 *
 * The middleware itself never calls the review service or mutates DB
 * rows. When an escalation is warranted it returns
 * `{ action: 'escalate_to_review', reason }` and the outer loop in
 * `runAgenticLoop` coordinates the HITL hand-off. This keeps the
 * middleware dependency graph acyclic.
 */

import { MAX_REFLECTION_ITERATIONS } from '../../config/limits.js';
import type {
  MiddlewareContext,
  PostToolMiddleware,
  PostToolResult,
} from './types.js';
import { decideReflectionAction } from './reflectionLoopPure.js';

export const reflectionLoopMiddleware: PostToolMiddleware = {
  name: 'reflection_loop',

  execute(
    ctx: MiddlewareContext,
    toolCall: { name: string; input: Record<string, unknown> },
    result: { content: string; durationMs: number },
  ): PostToolResult {
    const decision = decideReflectionAction({
      toolName: toolCall.name,
      toolResult: result.content,
      reviewCodeIterations: ctx.reviewCodeIterations ?? 0,
      lastReviewCodeVerdict: ctx.lastReviewCodeVerdict ?? null,
      maxReflectionIterations: MAX_REFLECTION_ITERATIONS,
    });

    // Apply state delta before returning — the pure helper is the single
    // source of truth for both "what to do" and "how ctx changes".
    if (decision.stateDelta.lastReviewCodeVerdict !== undefined) {
      ctx.lastReviewCodeVerdict = decision.stateDelta.lastReviewCodeVerdict;
    }
    if (decision.stateDelta.reviewCodeIterations !== undefined) {
      ctx.reviewCodeIterations = decision.stateDelta.reviewCodeIterations;
    }

    switch (decision.action.kind) {
      case 'continue':
        return { action: 'continue' };
      case 'inject_message':
        return { action: 'inject_message', message: decision.action.message };
      case 'escalate_to_review':
        return {
          action: 'escalate_to_review',
          reason: decision.action.reason,
        };
    }
  },
};
