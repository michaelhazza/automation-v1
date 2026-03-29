import { createHash } from 'crypto';
import { MAX_TOOL_REPEATS } from '../../config/limits.js';
import type { PreToolMiddleware, MiddlewareContext, PreToolResult } from './types.js';

// ---------------------------------------------------------------------------
// Loop Detection — detects repeated identical tool calls
// ---------------------------------------------------------------------------

export function hashToolCall(name: string, input: Record<string, unknown>): string {
  return createHash('md5').update(name + JSON.stringify(input)).digest('hex');
}

export const loopDetectionMiddleware: PreToolMiddleware = {
  name: 'loopDetection',

  execute(
    ctx: MiddlewareContext,
    toolCall: { name: string; input: Record<string, unknown> }
  ): PreToolResult {
    const hash = hashToolCall(toolCall.name, toolCall.input);

    const repeatCount = ctx.toolCallHistory.filter(h => h.inputHash === hash).length;

    if (repeatCount >= MAX_TOOL_REPEATS) {
      return {
        action: 'stop',
        reason: `Loop detected: tool "${toolCall.name}" has been called ${repeatCount} times with identical input. Stopping to prevent infinite loop.`,
        status: 'loop_detected',
      };
    }

    return { action: 'continue' };
  },
};
