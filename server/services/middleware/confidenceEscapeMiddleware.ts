/**
 * confidenceEscapeMiddleware — Sprint 5 P4.1
 *
 * PreTool middleware that checks the agent's self-reported confidence
 * for a tool call (from the `<tool_intent>` block). If confidence is
 * below MIN_TOOL_ACTION_CONFIDENCE (0.5), the call is blocked and the
 * agent is directed to use `ask_clarifying_question` instead.
 *
 * Decision matrix (from limits.ts):
 *   >= 0.7:        proceed normally (P2.3 policy gate handles auto → review)
 *   >= 0.5 < 0.7:  proceed (P2.3 confidence upgrade still applies)
 *   < 0.5:         block, force clarification
 *   null (missing): proceed (backward compat — older agents don't emit the block)
 *
 * The `ask_clarifying_question` tool itself is never blocked by this
 * middleware — that would create a deadlock.
 *
 * Pipeline position: runs in `preTool` phase AFTER proposeActionMiddleware
 * (so blocked calls are already filtered) and BEFORE toolRestriction
 * (so the clarification redirect fires before the allowlist check).
 *
 * Contract: docs/improvements-roadmap-spec.md §P4.1.
 */

import { extractToolIntentConfidence } from '../agentExecutionServicePure.js';
import { MIN_TOOL_ACTION_CONFIDENCE } from '../../config/limits.js';
import type { PreToolMiddleware, PreToolResult } from './types.js';

export const confidenceEscapeMiddleware: PreToolMiddleware = {
  name: 'confidence_escape',

  execute(ctx, toolCall): PreToolResult {
    // Never block the clarification tool itself
    if (toolCall.name === 'ask_clarifying_question') {
      return { action: 'continue' };
    }

    // Extract confidence from the last assistant text
    const confidence = extractToolIntentConfidence(
      ctx.lastAssistantText,
      toolCall.name,
    );

    // Missing confidence block → backward compat, proceed
    if (confidence === null) {
      return { action: 'continue' };
    }

    if (confidence < MIN_TOOL_ACTION_CONFIDENCE) {
      return {
        action: 'skip',
        reason: `Confidence ${confidence.toFixed(2)} is below minimum ${MIN_TOOL_ACTION_CONFIDENCE}.`,
        injectMessage: `Your confidence for ${toolCall.name} is too low (${confidence.toFixed(2)}). Do not guess — use the ask_clarifying_question tool to ask the user for more detail before proceeding.`,
      };
    }

    return { action: 'continue' };
  },
};
