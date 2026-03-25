import type { PreToolMiddleware, MiddlewareContext, PreToolResult } from './types.js';

// ---------------------------------------------------------------------------
// Tool Restriction — enforces per-subaccount-agent allowlist
// ---------------------------------------------------------------------------

export const toolRestrictionMiddleware: PreToolMiddleware = {
  name: 'toolRestriction',

  execute(
    ctx: MiddlewareContext,
    toolCall: { name: string; input: Record<string, unknown> }
  ): PreToolResult {
    const allowedSlugs = ctx.saLink.allowedSkillSlugs as string[] | null;

    // If no allowlist is set, all tools are allowed (backwards compatible)
    if (!allowedSlugs || allowedSlugs.length === 0) {
      return { action: 'continue' };
    }

    if (!allowedSlugs.includes(toolCall.name)) {
      return {
        action: 'skip',
        reason: `Tool "${toolCall.name}" is not in the allowed tools list for this agent configuration.`,
      };
    }

    return { action: 'continue' };
  },
};
