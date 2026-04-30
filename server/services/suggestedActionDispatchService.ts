import { logger } from '../lib/logger.js';
import type { SuggestedActionKey } from '../../shared/types/messageSuggestedActions.js';

export async function dispatchSuggestedAction(params: {
  actionKey: SuggestedActionKey;
  conversationId: string;
  agentId: string;
  userId: string;
  organisationId: string;
}): Promise<{ success: true; redirectUrl?: string }> {
  const { actionKey, conversationId, agentId, userId } = params;

  logger.info({
    conversationId,
    actionKey,
    userId,
    action: 'suggested_action_dispatched',
  });

  switch (actionKey) {
    case 'save_thread_as_agent':
      return { success: true, redirectUrl: `/admin/agents/new?fromConversation=${conversationId}` };
    case 'schedule_daily':
      return { success: true, redirectUrl: `/admin/agents/${agentId}?tab=scheduling` };
    case 'pin_skill':
      return { success: true, redirectUrl: `/admin/agents/${agentId}?tab=skills` };
  }
}
