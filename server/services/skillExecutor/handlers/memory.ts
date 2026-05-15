import type { SkillExecutionContext, SkillHandler } from '../context.js';
import { workspaceMemoryService } from '../../workspaceMemoryService.js';
import * as priorityFeedService from '../../priorityFeedService.js';

export const memoryHandlers: Record<string, SkillHandler> = {
  search_agent_history: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const op = input.op as string;
    if (op === 'search') {
      const results = await workspaceMemoryService.semanticSearchMemories({
        query: input.query as string,
        orgId: context.organisationId,
        subaccountId: context.subaccountId ?? '',
        includeOtherSubaccounts: (input.includeOtherSubaccounts as boolean) ?? !context.subaccountId,
        topK: (input.topK as number) ?? 10,
        domain: context.agentDomain,
      });
      return { success: true, results };
    } else if (op === 'read') {
      const entry = await workspaceMemoryService.getMemoryEntry(
        input.memoryId as string,
        context.organisationId,
      );
      if (!entry) return { success: false, error: 'Memory entry not found' };
      return { success: true, entry };
    }
    return { success: false, error: `Unknown op: ${op}` };
  },

  read_priority_feed: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const op = input.op as string;
    if (op === 'list') {
      const items = await priorityFeedService.listFeed(
        { orgId: context.organisationId, subaccountId: context.subaccountId ?? undefined, agentRunId: context.runId },
        { limit: (input.limit as number) ?? 20 },
      );
      return { success: true, items };
    } else if (op === 'claim') {
      const result = await priorityFeedService.claimItem(
        input.source as string,
        input.itemId as string,
        context.runId,
        (input.ttlMinutes as number) ?? 30,
      );
      return { success: result.claimed, ...result };
    } else if (op === 'release') {
      await priorityFeedService.releaseItem(
        input.source as string,
        input.itemId as string,
        context.runId,
      );
      return { success: true };
    }
    return { success: false, error: `Unknown op: ${op}` };
  },

  read_data_source: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeReadDataSource } = await import('../../../tools/readDataSource.js');
    return executeReadDataSource(input, context);
  },
};
