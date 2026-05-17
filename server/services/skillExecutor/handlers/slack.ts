import type { SkillExecutionContext, SkillHandler } from '../context.js';
import { resolveAgentOwner } from './userOwnedAgentOwner.js';

export const slackHandlers: Record<string, SkillHandler> = {
  'slack.list_channels': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('../../slack/slackActionService.js');
    return slackActionService.listChannels(
      input as { cursor?: string; limit?: number; excludeArchived?: boolean },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'slack.read_channel': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('../../slack/slackActionService.js');
    return slackActionService.readChannel(
      input as { channelId: string; limit?: number; oldest?: string; latest?: string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'slack.search_messages': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('../../slack/slackActionService.js');
    return slackActionService.searchMessages(
      input as { query: string; count?: number; page?: number; sort?: string; sortDir?: string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'slack.summarise_thread': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('../../slack/slackActionService.js');
    return slackActionService.summariseThread(
      input as { channelId: string; threadTs: string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'slack.post_message': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('../../slack/slackActionService.js');
    return slackActionService.postMessage(
      {
        channelId: input.channelId as string,
        text: input.text as string,
        agentId: context.agentId,
        agentRunId: context.runId,
        kind: 'slack_post',
      },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'slack.post_dm': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { slackActionService } = await import('../../slack/slackActionService.js');
    return slackActionService.postDm(
      {
        targetUserId: input.targetUserId as string,
        text: input.text as string,
        agentId: context.agentId,
        agentRunId: context.runId,
        kind: 'slack_dm',
      },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
};
