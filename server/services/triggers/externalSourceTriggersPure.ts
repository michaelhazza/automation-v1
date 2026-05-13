import type { ExternalSourceTriggerEvent } from '../../../shared/types/externalSourceTrigger.js';

// ---------------------------------------------------------------------------
// Pure helpers for external-source trigger dispatch
// ---------------------------------------------------------------------------

/**
 * Derive a per-provider dedup key per spec §7.1:
 * - gmail: messageId
 * - calendar: calendarEventId@startAt@minutesUntilStart
 * - slack: channelId@messageTs
 */
export function deriveDedupKey(event: ExternalSourceTriggerEvent): string {
  switch (event.eventType) {
    case 'gmail_message_received':
      return event.messageId;
    case 'calendar_event_imminent':
      return `${event.calendarEventId}@${event.startAt}@${event.minutesUntilStart}`;
    case 'slack_mention':
      return `${event.channelId}@${event.messageTs}`;
  }
}

/**
 * Compute whether a Calendar event is within the lookahead window.
 * Returns { within: true, minutesUntilStart } if startAt is in [now, now + lookaheadMinutes minutes].
 * Returns { within: false, reason } otherwise.
 */
export function computeCalendarLookahead(args: {
  eventStartAt: string; // ISO 8601
  now: Date;
  lookaheadMinutes: number;
}): { within: true; minutesUntilStart: number } | { within: false; reason: 'past' | 'too_far' } {
  const startMs = new Date(args.eventStartAt).getTime();
  const nowMs = args.now.getTime();
  const diffMin = (startMs - nowMs) / 60000;
  if (diffMin < 0) return { within: false, reason: 'past' };
  if (diffMin > args.lookaheadMinutes) return { within: false, reason: 'too_far' };
  return { within: true, minutesUntilStart: diffMin };
}
