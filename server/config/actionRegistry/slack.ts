import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { defineExternalRead, defineExternalWrite } from './factories.js';

export const slackActions: Record<string, ActionDefinition> = {
  // ── Slack skills ───────────────────────────────────────────────────────────
  'slack.list_channels': defineExternalRead({
    slug: 'slack.list_channels',
    description: 'List Slack channels the bot is a member of, filtered by `types` (public/private/mpim/im — see spec §7.3). Returns channel name, ID, member count, and topic. Supports pagination via cursor.',
    topics: ['slack'],
    riskTier: 2,
    payloadFields: ['cursor', 'limit', 'excludeArchived', 'types', 'ownerUserId'],
    parameterSchema: z.object({
      cursor: z.string().optional().describe('Pagination cursor from a previous response'),
      limit: z.number().max(200).optional().describe('Maximum number of channels to return (max 200)'),
      excludeArchived: z.boolean().optional().describe('Exclude archived channels'),
      types: z
        .array(z.enum(['public_channel', 'private_channel', 'mpim', 'im']))
        .optional()
        .describe(
          'Channel-kind filter (spec §7.3). Defaults to [\'public_channel\'] when omitted — matches the slack.com `conversations.list` default.',
        ),
      ownerUserId: z.string().optional().describe('User ID for scoping the request'),
    }),
    requiredIntegration: 'slack',
    liveFetchRationale: 'Channel membership changes at any time; list must be live',
  }),

  'slack.read_channel': defineExternalRead({
    slug: 'slack.read_channel',
    description: 'Read recent messages from a Slack channel. Returns message text, sender, timestamp, and thread reply counts. Requires `channels:history` scope.',
    topics: ['slack'],
    riskTier: 2,
    payloadFields: ['channelId', 'limit', 'oldest', 'latest', 'ownerUserId'],
    parameterSchema: z.object({
      channelId: z.string().describe('Slack channel ID'),
      limit: z.number().max(100).optional().describe('Maximum number of messages to return (max 100)'),
      oldest: z.string().optional().describe('Start of the time range (Unix timestamp)'),
      latest: z.string().optional().describe('End of the time range (Unix timestamp)'),
      ownerUserId: z.string().optional().describe('User ID for scoping the request'),
    }),
    requiredIntegration: 'slack',
    liveFetchRationale: 'Message history is append-only but unbounded; reads must be live',
  }),

  'slack.search_messages': defineExternalRead({
    slug: 'slack.search_messages',
    description: 'Search Slack messages across the workspace using full-text search. Requires the `search:read` scope (paid Slack plans only). Returns matching messages with context. Returns PLAN_NOT_SUPPORTED when the workspace plan does not support search.',
    topics: ['slack'],
    riskTier: 2,
    payloadFields: ['query', 'count', 'page', 'sort', 'sortDir', 'ownerUserId'],
    parameterSchema: z.object({
      query: z.string().describe('Full-text search query'),
      count: z.number().max(100).optional().describe('Number of results per page (max 100)'),
      page: z.number().optional().describe('Page number for pagination'),
      sort: z.enum(['score', 'timestamp']).optional().describe('Sort order for results'),
      sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
      ownerUserId: z.string().optional().describe('User ID for scoping the request'),
    }),
    requiredIntegration: 'slack',
    liveFetchRationale: 'Search index is live; results must be from Slack API',
  }),

  'slack.summarise_thread': defineExternalRead({
    slug: 'slack.summarise_thread',
    description: 'Fetch all replies in a Slack thread and return a structured summary using the LLM. Reads the thread via `conversations.replies`, then assembles a summary prompt.',
    topics: ['slack'],
    riskTier: 2,
    payloadFields: ['channelId', 'threadTs', 'ownerUserId'],
    parameterSchema: z.object({
      channelId: z.string().describe('Slack channel ID containing the thread'),
      threadTs: z.string().describe('Thread timestamp (ts of the parent message)'),
      ownerUserId: z.string().optional().describe('User ID for scoping the request'),
    }),
    requiredIntegration: 'slack',
    liveFetchRationale: 'Thread replies are live data; must fetch from Slack API',
  }),

  'slack.post_message': defineExternalWrite({
    slug: 'slack.post_message',
    description: 'Post a message to a Slack channel. Always review-gated (Tier 6). Requires an EA draft (`eaDraftId`) when invoked via the EA approval flow. Handler enforces write-action invariant: `actions.status = \'approved\'` AND `ea_drafts.send_state = \'idle\'`.',
    topics: ['slack'],
    riskTier: 6,
    defaultGateLevel: 'review',
    payloadFields: ['eaDraftId', 'channelId', 'text', 'blocks', 'threadTs', 'ownerUserId'],
    parameterSchema: z.object({
      eaDraftId: z.string().describe('EA draft ID for approval flow and idempotency'),
      channelId: z.string().describe('Slack channel ID to post to'),
      text: z.string().describe('Message text'),
      blocks: z.array(z.unknown()).optional().describe('Block Kit blocks for rich formatting'),
      threadTs: z.string().optional().describe('Thread timestamp to reply in a thread'),
      ownerUserId: z.string().optional().describe('User ID for scoping the request'),
    }),
    requiredIntegration: 'slack',
    idempotencyStrategy: 'keyed_write',
    integrationNotResumable: true,
  }),

  'slack.post_dm': defineExternalWrite({
    slug: 'slack.post_dm',
    description: 'Send a direct message in Slack. Review-gated when target is not the owner; auto when target equals owner (decision made by `decideAutoSendScope` in slackActionService). Requires `im:write` scope. Requires an EA draft (`eaDraftId`) for review-gated invocations.',
    topics: ['slack'],
    riskTier: 6,
    defaultGateLevel: 'review',
    payloadFields: ['eaDraftId', 'targetUserId', 'text', 'blocks', 'ownerUserId'],
    parameterSchema: z.object({
      eaDraftId: z.string().describe('EA draft ID for approval flow and idempotency'),
      targetUserId: z.string().describe('Slack user ID to send the DM to'),
      text: z.string().describe('Message text'),
      blocks: z.array(z.unknown()).optional().describe('Block Kit blocks for rich formatting'),
      ownerUserId: z.string().optional().describe('User ID for scoping the request'),
    }),
    requiredIntegration: 'slack',
    idempotencyStrategy: 'keyed_write',
    integrationNotResumable: true,
  }),
};
