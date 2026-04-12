/**
 * Slack Inbound Job — Feature 4
 *
 * Processes inbound Slack messages dispatched by the webhook handler.
 * Loads the conversation context, dispatches to the agent-run infrastructure,
 * and sends the response back to the Slack thread.
 */

import { resolveConversation } from '../services/slackConversationService.js';

export type SlackInboundPayload = {
  type: 'mention' | 'dm' | 'thread_reply';
  conversationId: string;
  slackUserId: string;
  text: string;
  orgId: string;
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
};

export async function processSlackInbound(payload: SlackInboundPayload): Promise<void> {
  const { conversationId, text, orgId, type, workspaceId, channelId, threadTs } = payload;

  // Load conversation via service (respects RLS)
  let conversation = null;
  if (workspaceId && channelId && threadTs) {
    conversation = await resolveConversation({ workspaceId, channelId, threadTs, orgId });
  }

  if (!conversation && !conversationId) {
    console.warn(`[SlackInbound] No conversation context, skipping`);
    return;
  }

  console.info(`[SlackInbound] Processing ${type} for conversation ${conversationId ?? conversation?.id} in org ${orgId}: "${text.slice(0, 100)}"`);

  // TODO: Wire to agentExecutionService.startRun() with:
  //   - agentId from conversation
  //   - subaccountId from conversation
  //   - input: text
  //   - runSource: 'slack'
  //   - triggerContext: { slackConversationId, slackUserId, type }
  // Then post the run summary back to Slack via sendToSlackService.
}
