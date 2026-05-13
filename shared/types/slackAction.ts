import { z } from 'zod';

export const SlackListChannelsInputSchema = z.object({
  types: z.array(z.enum(['public_channel', 'private_channel', 'mpim', 'im'])).default(['public_channel']),
  limit: z.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
  excludeArchived: z.boolean().default(true),
});
export type SlackListChannelsInput = z.infer<typeof SlackListChannelsInputSchema>;

export const SlackReadChannelInputSchema = z.object({
  channelId: z.string(),
  limit: z.number().int().positive().max(100).default(20),
  oldest: z.string().optional(),
  latest: z.string().optional(),
  inclusive: z.boolean().default(false),
});
export type SlackReadChannelInput = z.infer<typeof SlackReadChannelInputSchema>;

export const SlackSearchMessagesInputSchema = z.object({
  query: z.string(),
  count: z.number().int().positive().max(100).default(20),
  page: z.number().int().positive().default(1),
  sortBy: z.enum(['score', 'timestamp']).default('score'),
});
export type SlackSearchMessagesInput = z.infer<typeof SlackSearchMessagesInputSchema>;

export const SlackSummariseThreadInputSchema = z.object({
  channelId: z.string(),
  threadTs: z.string(),
  limit: z.number().int().positive().max(50).default(20),
});
export type SlackSummariseThreadInput = z.infer<typeof SlackSummariseThreadInputSchema>;

export const SlackPostMessageInputSchema = z.object({
  channelId: z.string(),
  text: z.string(),
  threadTs: z.string().optional(),
  mrkdwn: z.boolean().default(true),
});
export type SlackPostMessageInput = z.infer<typeof SlackPostMessageInputSchema>;

export const SlackPostDmInputSchema = z.object({
  userId: z.string(),
  text: z.string(),
  mrkdwn: z.boolean().default(true),
});
export type SlackPostDmInput = z.infer<typeof SlackPostDmInputSchema>;
