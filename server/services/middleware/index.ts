import type { MiddlewarePipeline } from './types.js';
import { contextPressureMiddleware } from './contextPressure.js';
import { budgetCheckMiddleware } from './budgetCheck.js';
import { loopDetectionMiddleware } from './loopDetection.js';
import { toolRestrictionMiddleware } from './toolRestriction.js';
import { proposeActionMiddleware } from './proposeAction.js';
import { decisionTimeGuidanceMiddleware } from './decisionTimeGuidanceMiddleware.js';
import { reflectionLoopMiddleware } from './reflectionLoopMiddleware.js';

export { hashToolCall } from './loopDetection.js';
export { classifyError, executeWithRetry } from './errorHandling.js';
export { checkWorkspaceLimits } from './workspaceLimitCheck.js';
export type {
  MiddlewareContext,
  PreCallResult,
  PreToolResult,
  PostToolResult,
  PreCallMiddleware,
  PreToolMiddleware,
  PostToolMiddleware,
  MiddlewarePipeline,
} from './types.js';

// ---------------------------------------------------------------------------
// Default pipeline — standard set of guardrails for every agent run
// ---------------------------------------------------------------------------

export function createDefaultPipeline(): MiddlewarePipeline {
  return {
    preCall: [contextPressureMiddleware, budgetCheckMiddleware],
    // proposeActionMiddleware runs FIRST so every tool call has a universal
    // before-tool authorisation hook (Sprint 2 P1.1 Layer 3) regardless of
    // downstream behaviour. The in-memory decision cache on
    // MiddlewareContext.preToolDecisions keeps it idempotent across replays.
    //
    // Sprint 3 P2.3 — decisionTimeGuidanceMiddleware runs AFTER
    // proposeActionMiddleware so blocked calls never receive guidance
    // injections, and AFTER toolRestriction/loopDetection so a
    // guidance block is not appended for a tool call that the pipeline
    // would otherwise kill. This places it last in the preTool phase.
    preTool: [
      proposeActionMiddleware,
      toolRestrictionMiddleware,
      loopDetectionMiddleware,
      decisionTimeGuidanceMiddleware,
    ],
    // Sprint 3 P2.2 — reflection loop enforces the "no write_patch without
    // APPROVE" contract and escalates to HITL after
    // `MAX_REFLECTION_ITERATIONS` blocked review_code iterations. This is
    // the first inhabitant of the postTool pipeline.
    postTool: [reflectionLoopMiddleware],
  };
}
