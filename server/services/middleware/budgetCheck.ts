import type { PreCallMiddleware, MiddlewareContext, PreCallResult } from './types.js';

// ---------------------------------------------------------------------------
// Budget Check — enforces token budget, tool call limit, and timeout
// ---------------------------------------------------------------------------

export const budgetCheckMiddleware: PreCallMiddleware = {
  name: 'budgetCheck',

  execute(ctx: MiddlewareContext): PreCallResult {
    // Check timeout
    if (Date.now() - ctx.startTime > ctx.timeoutMs) {
      return {
        action: 'stop',
        reason: 'You have reached the time limit for this run. Please provide a brief summary of what you accomplished and stop.',
        status: 'timeout',
      };
    }

    // Check token budget
    if (ctx.tokensUsed >= ctx.tokenBudget) {
      return {
        action: 'stop',
        reason: 'You have reached your token budget for this run. Please provide a brief summary of what you accomplished and stop.',
        status: 'budget_exceeded',
      };
    }

    // Check tool call limit
    if (ctx.toolCallsCount >= ctx.maxToolCalls) {
      return {
        action: 'stop',
        reason: 'You have reached the maximum number of tool calls for this run. Please provide a brief summary of what you accomplished and stop.',
        status: 'budget_exceeded',
      };
    }

    return { action: 'continue' };
  },
};
