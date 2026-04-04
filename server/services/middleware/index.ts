import type { MiddlewarePipeline } from './types.js';
import { contextPressureMiddleware } from './contextPressure.js';
import { budgetCheckMiddleware } from './budgetCheck.js';
import { loopDetectionMiddleware } from './loopDetection.js';
import { toolRestrictionMiddleware } from './toolRestriction.js';

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
    preTool: [toolRestrictionMiddleware, loopDetectionMiddleware],
    postTool: [],
  };
}
