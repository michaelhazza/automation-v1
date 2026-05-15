import type { SkillHandler } from '../context.js';
import { executeWithActionAudit } from '../gating.js';

export const memoryBlockHandlers: Record<string, SkillHandler> = {
  update_memory_block: async (input, context) => {
    const { updateBlock } = await import('../../memoryBlockService.js');
    const blockName = (input as Record<string, unknown>).block_name as string;
    const newContent = (input as Record<string, unknown>).new_content as string;
    if (!blockName || !newContent) {
      return { success: false, error: 'block_name and new_content are required' };
    }
    return updateBlock(blockName, newContent, context.agentId, context.organisationId);
  },
  read_docs: async (input, context) => {
    const docPageId = typeof input.page_id === 'string' ? input.page_id : '';
    const docPageTitle = typeof input.page_title === 'string' ? input.page_title : '';
    return executeWithActionAudit('read_docs', input, context, async () => ({
      status: 'stub',
      dataAvailability: 'stub' as const,
      page_id: docPageId,
      page_title: docPageTitle,
      content: null,
      message: 'Documentation integration not configured. Connect the documentation system in workspace settings to enable page retrieval.',
    }));
  },
};
