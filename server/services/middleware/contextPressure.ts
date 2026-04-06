import type { PreCallMiddleware, MiddlewareContext, PreCallResult } from './types.js';

// ---------------------------------------------------------------------------
// Context Pressure — soft warning before hard budget limits
//
// Injects a warning message at 70% and 85% of token budget consumption.
// Uses tokenRatio only — most predictable signal, directly maps to context limits.
// ---------------------------------------------------------------------------

const SOFT_WARNING_THRESHOLD = 0.70;
const CRITICAL_WARNING_THRESHOLD = 0.85;

export const contextPressureMiddleware: PreCallMiddleware = {
  name: 'contextPressure',

  execute(ctx: MiddlewareContext): PreCallResult {
    const pressure = ctx.tokensUsed / ctx.tokenBudget;

    if (pressure >= CRITICAL_WARNING_THRESHOLD && !ctx._criticalWarningIssued) {
      ctx._criticalWarningIssued = true;
      return {
        action: 'inject_message',
        message: '[SYSTEM] You are at 85% of your token budget. Complete your current action, write a summary of progress, and stop. Do not start new tasks.',
      };
    }

    if (pressure >= SOFT_WARNING_THRESHOLD && !ctx._softWarningIssued) {
      ctx._softWarningIssued = true;
      return {
        action: 'inject_message',
        message: '[SYSTEM] You are at 70% of your token budget. Prioritise completing your current task. Avoid starting new work. Begin preparing your summary.',
      };
    }

    return { action: 'continue' };
  },
};
