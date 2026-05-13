import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { defineExternalRead, defineExternalWrite } from './factories.js';

export const calendarActions: Record<string, ActionDefinition> = {
  // ── Google Calendar skills ─────────────────────────────────────────────────
  'calendar.list_events': defineExternalRead({
    slug: 'calendar.list_events',
    description: 'List calendar events within a time range for the owner\'s Google Calendar. Returns event titles, start/end times, attendees, and location. Supports optional filtering by calendar ID.',
    topics: ['calendar'],
    riskTier: 2,
    payloadFields: ['calendarId', 'timeMin', 'timeMax', 'maxResults', 'ownerUserId'],
    parameterSchema: z.object({
      calendarId: z.string().optional().describe('Calendar ID to query (default: primary)'),
      timeMin: z.string().describe('Start of the time range (ISO8601)'),
      timeMax: z.string().describe('End of the time range (ISO8601)'),
      maxResults: z.number().max(250).optional().describe('Maximum number of events to return (max 250)'),
      ownerUserId: z.string().describe('User ID whose calendar to query'),
    }),
    requiredIntegration: 'google_calendar',
    liveFetchRationale: 'Calendar events are time-sensitive; caching would miss same-day updates',
  }),

  'calendar.get_event': defineExternalRead({
    slug: 'calendar.get_event',
    description: 'Fetch a single calendar event by ID from the owner\'s Google Calendar. Returns full event detail including attendees, conferencing links, and recurrence rules.',
    topics: ['calendar'],
    riskTier: 2,
    payloadFields: ['eventId', 'calendarId', 'ownerUserId'],
    parameterSchema: z.object({
      eventId: z.string().describe('Google Calendar event ID'),
      calendarId: z.string().default('primary').optional().describe('Calendar ID (default: primary)'),
      ownerUserId: z.string().describe('User ID whose calendar to query'),
    }),
    requiredIntegration: 'google_calendar',
    liveFetchRationale: 'Event detail is mutable (attendees can RSVP at any time); reads must be live',
  }),

  'calendar.find_free_slot': defineExternalRead({
    slug: 'calendar.find_free_slot',
    description: 'Find available time slots in the owner\'s Google Calendar within a window. Uses the Google freebusy API to return gaps that fit the requested duration, respecting working hours.',
    topics: ['calendar'],
    riskTier: 2,
    payloadFields: ['timeMin', 'timeMax', 'durationMinutes', 'calendarIds', 'workingHoursStart', 'workingHoursEnd', 'ownerUserId'],
    parameterSchema: z.object({
      timeMin: z.string().describe('Start of the search window (ISO8601)'),
      timeMax: z.string().describe('End of the search window (ISO8601)'),
      durationMinutes: z.number().describe('Required slot duration in minutes'),
      calendarIds: z.array(z.string()).optional().describe('Calendar IDs to check (default: primary)'),
      workingHoursStart: z.string().optional().describe('Working hours start time (HH:MM)'),
      workingHoursEnd: z.string().optional().describe('Working hours end time (HH:MM)'),
      ownerUserId: z.string().describe('User ID whose calendar to query'),
    }),
    requiredIntegration: 'google_calendar',
    liveFetchRationale: 'Free/busy state changes constantly; must be live',
  }),

  'calendar.create_event': defineExternalWrite({
    slug: 'calendar.create_event',
    description: 'Create a new event on the owner\'s Google Calendar. Requires an EA draft (`eaDraftId`) — the handler enforces that `actions.status = \'approved\'` AND `ea_drafts.send_state = \'idle\'` before sending. Supports attendees, conferencing, recurrence, and a private `ea_draft_id` extended property for idempotency recovery.',
    topics: ['calendar'],
    riskTier: 6,
    defaultGateLevel: 'review',
    payloadFields: ['eaDraftId', 'calendarId', 'summary', 'start', 'end', 'attendees', 'description', 'location', 'conferenceType', 'recurrence', 'ownerUserId'],
    parameterSchema: z.object({
      eaDraftId: z.string().uuid().describe('EA draft ID for approval flow and idempotency'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      summary: z.string().describe('Event title'),
      start: z.string().describe('Event start time (ISO8601)'),
      end: z.string().describe('Event end time (ISO8601)'),
      attendees: z.array(z.object({ email: z.string() })).optional().describe('List of attendees'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      ownerUserId: z.string().describe('User ID whose calendar to create the event on'),
    }),
    requiredIntegration: 'google_calendar',
    idempotencyStrategy: 'keyed_write',
    integrationNotResumable: true,
  }),

  'calendar.update_event': defineExternalWrite({
    slug: 'calendar.update_event',
    description: 'Update an existing event on the owner\'s Google Calendar. Requires an EA draft (`eaDraftId`). Uses etag-based conflict detection. Handler enforces write-action invariant: `actions.status = \'approved\'` AND `ea_drafts.send_state = \'idle\'`.',
    topics: ['calendar'],
    riskTier: 6,
    defaultGateLevel: 'review',
    payloadFields: ['eaDraftId', 'eventId', 'calendarId', 'summary', 'start', 'end', 'attendees', 'description', 'location', 'etag', 'ownerUserId'],
    parameterSchema: z.object({
      eaDraftId: z.string().describe('EA draft ID for approval flow and idempotency'),
      eventId: z.string().describe('Google Calendar event ID to update'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      summary: z.string().optional().describe('Updated event title'),
      start: z.string().optional().describe('Updated start time (ISO8601)'),
      end: z.string().optional().describe('Updated end time (ISO8601)'),
      attendees: z.array(z.object({ email: z.string() })).optional().describe('Updated attendee list'),
      etag: z.string().optional().describe('ETag for optimistic concurrency control'),
      ownerUserId: z.string().describe('User ID whose calendar to update'),
    }),
    requiredIntegration: 'google_calendar',
    idempotencyStrategy: 'keyed_write',
    integrationNotResumable: true,
  }),

  'calendar.respond_to_invite': defineExternalWrite({
    slug: 'calendar.respond_to_invite',
    description: 'Accept, decline, or tentatively accept a calendar invitation on behalf of the owner. Requires an EA draft (`eaDraftId`). Handler enforces write-action invariant.',
    topics: ['calendar'],
    riskTier: 3,
    defaultGateLevel: 'review',
    payloadFields: ['eaDraftId', 'eventId', 'calendarId', 'response', 'ownerUserId'],
    parameterSchema: z.object({
      eaDraftId: z.string().describe('EA draft ID for approval flow and idempotency'),
      eventId: z.string().describe('Google Calendar event ID'),
      calendarId: z.string().optional().describe('Calendar ID (default: primary)'),
      response: z.enum(['accepted', 'declined', 'tentative']).describe('RSVP response'),
      ownerUserId: z.string().describe('User ID whose calendar to respond on behalf of'),
    }),
    requiredIntegration: 'google_calendar',
    idempotencyStrategy: 'keyed_write',
    integrationNotResumable: true,
  }),
};
