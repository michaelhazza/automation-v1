import type { SkillExecutionContext, SkillHandler } from '../context.js';

export const metaHandlers: Record<string, SkillHandler> = {
  search_tools: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeSearchTools } = await import('../../../tools/meta/searchTools.js');
    return executeSearchTools(input, { runId: context.runId, subaccountId: context.subaccountId!, organisationId: context.organisationId });
  },

  load_tool: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeLoadTool } = await import('../../../tools/meta/searchTools.js');
    return executeLoadTool(input, { runId: context.runId, subaccountId: context.subaccountId!, organisationId: context.organisationId });
  },
};
