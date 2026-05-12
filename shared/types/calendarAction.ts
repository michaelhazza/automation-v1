import { z } from 'zod';

export const CalendarListEventsInputSchema = z.object({
  calendarId: z.string().default('primary'),
  timeMin: z.string().datetime({ offset: true }).optional(),
  timeMax: z.string().datetime({ offset: true }).optional(),
  maxResults: z.number().int().positive().max(100).default(10),
  query: z.string().optional(),
});
export type CalendarListEventsInput = z.infer<typeof CalendarListEventsInputSchema>;

export const CalendarGetEventInputSchema = z.object({
  calendarId: z.string().default('primary'),
  eventId: z.string(),
});
export type CalendarGetEventInput = z.infer<typeof CalendarGetEventInputSchema>;

export const CalendarFindFreeSlotInputSchema = z.object({
  calendarId: z.string().default('primary'),
  durationMinutes: z.number().int().positive(),
  timeMin: z.string().datetime({ offset: true }),
  timeMax: z.string().datetime({ offset: true }),
  attendeeEmails: z.array(z.string().email()).optional(),
});
export type CalendarFindFreeSlotInput = z.infer<typeof CalendarFindFreeSlotInputSchema>;

export const CalendarCreateEventInputSchema = z.object({
  calendarId: z.string().default('primary'),
  summary: z.string(),
  description: z.string().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  attendeeEmails: z.array(z.string().email()).optional(),
  location: z.string().optional(),
  conferenceType: z.enum(['none', 'meet']).default('none'),
});
export type CalendarCreateEventInput = z.infer<typeof CalendarCreateEventInputSchema>;

export const CalendarUpdateEventInputSchema = z.object({
  calendarId: z.string().default('primary'),
  eventId: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  attendeeEmails: z.array(z.string().email()).optional(),
});
export type CalendarUpdateEventInput = z.infer<typeof CalendarUpdateEventInputSchema>;

export const CalendarRespondToInviteInputSchema = z.object({
  calendarId: z.string().default('primary'),
  eventId: z.string(),
  response: z.enum(['accepted', 'declined', 'tentative']),
  comment: z.string().optional(),
});
export type CalendarRespondToInviteInput = z.infer<typeof CalendarRespondToInviteInputSchema>;
