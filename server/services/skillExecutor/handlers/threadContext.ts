import type { SkillHandler } from '../context.js';
import { executeWithActionAudit } from '../gating.js';
import { updateThreadContextHandler } from '../../../actions/updateThreadContext.js';

export const threadContextHandlers: Record<string, SkillHandler> = {
  update_thread_context: async (input, context) => {
    if (!context.conversationId) {
      return { success: false, error: 'update_thread_context requires a conversation context — this run has no associated conversation.' };
    }
    return executeWithActionAudit('update_thread_context', input, context, () =>
      updateThreadContextHandler(input, {
        conversationId: context.conversationId!,
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId ?? null,
      }),
    );
  },
};
