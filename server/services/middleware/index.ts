import type { MiddlewarePipeline } from './types.js';
import { budgetCheckMiddleware } from './budgetCheck.js';
import { loopDetectionMiddleware } from './loopDetection.js';
import { toolRestrictionMiddleware } from './toolRestriction.js';

export { hashToolCall } from './loopDetection.js';
export { classifyError, executeWithRetry } from './errorHandling.js';
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
    preCall: [budgetCheckMiddleware],
    preTool: [toolRestrictionMiddleware, loopDetectionMiddleware],
    postTool: [],
  };
}
