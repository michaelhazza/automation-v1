import { z } from 'zod';

export const GmailMessageReceivedEventSchema = z.object({
  eventType: z.literal('gmail_message_received'),
  ownerUserId: z.string().uuid(),
  messageId: z.string(),
  threadId: z.string(),
  subject: z.string().optional(),
  fromAddress: z.string(),
  receivedAt: z.string().datetime({ offset: true }),
  dedupKey: z.string(),
});
export type GmailMessageReceivedEvent = z.infer<typeof GmailMessageReceivedEventSchema>;

export const CalendarEventImminentEventSchema = z.object({
  eventType: z.literal('calendar_event_imminent'),
  ownerUserId: z.string().uuid(),
  calendarEventId: z.string(),
  summary: z.string().optional(),
  startAt: z.string().datetime({ offset: true }),
  minutesUntilStart: z.number().int().nonnegative(),
  attendeeCount: z.number().int().nonnegative().optional(),
  dedupKey: z.string(),
});
export type CalendarEventImminentEvent = z.infer<typeof CalendarEventImminentEventSchema>;

export const SlackMentionEventSchema = z.object({
  eventType: z.literal('slack_mention'),
  ownerUserId: z.string().uuid(),
  slackUserId: z.string(),
  channelId: z.string(),
  messageTs: z.string(),
  text: z.string(),
  dedupKey: z.string(),
});
export type SlackMentionEvent = z.infer<typeof SlackMentionEventSchema>;

export const ExternalSourceTriggerEventSchema = z.discriminatedUnion('eventType', [
  GmailMessageReceivedEventSchema,
  CalendarEventImminentEventSchema,
  SlackMentionEventSchema,
]);
export type ExternalSourceTriggerEvent = z.infer<typeof ExternalSourceTriggerEventSchema>;
