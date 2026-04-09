import type { MiddlewarePipeline } from './types.js';
import { contextPressureMiddleware } from './contextPressure.js';
import { budgetCheckMiddleware } from './budgetCheck.js';
import { loopDetectionMiddleware } from './loopDetection.js';
import { toolRestrictionMiddleware } from './toolRestriction.js';
import { proposeActionMiddleware } from './proposeAction.js';

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
    preTool: [proposeActionMiddleware, toolRestrictionMiddleware, loopDetectionMiddleware],
    postTool: [],
  };
}
