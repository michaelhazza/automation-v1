import { describe, it, expect } from 'vitest';
import { deriveDedupKey, computeCalendarLookahead } from '../externalSourceTriggersPure.js';

describe('deriveDedupKey', () => {
  it('gmail: returns messageId', () => {
    const key = deriveDedupKey({
      eventType: 'gmail_message_received',
      ownerUserId: '00000000-0000-0000-0000-000000000001',
      messageId: 'msg-abc-123',
      threadId: 'thread-abc',
      fromAddress: 'sender@example.com',
      receivedAt: '2026-05-12T10:00:00Z',
      dedupKey: 'msg-abc-123',
    });
    expect(key).toBe('msg-abc-123');
  });

  it('calendar: returns calendarEventId@startAt@minutesUntilStart string', () => {
    const key = deriveDedupKey({
      eventType: 'calendar_event_imminent',
      ownerUserId: '00000000-0000-0000-0000-000000000001',
      calendarEventId: 'evt-xyz',
      startAt: '2026-05-12T14:00:00Z',
      minutesUntilStart: 15,
      dedupKey: 'evt-xyz@2026-05-12T14:00:00Z@15',
    });
    expect(key).toBe('evt-xyz@2026-05-12T14:00:00Z@15');
  });

  it('slack: returns channelId@messageTs string', () => {
    const key = deriveDedupKey({
      eventType: 'slack_mention',
      ownerUserId: '00000000-0000-0000-0000-000000000001',
      slackUserId: 'U123ABC',
      channelId: 'C456DEF',
      messageTs: '1715515200.000100',
      text: 'Hey <@U999> can you help?',
      dedupKey: 'C456DEF@1715515200.000100',
    });
    expect(key).toBe('C456DEF@1715515200.000100');
  });
});

describe('computeCalendarLookahead', () => {
  const now = new Date('2026-05-12T10:00:00Z');

  it('within window', () => {
    const r = computeCalendarLookahead({ eventStartAt: '2026-05-12T10:05:00Z', now, lookaheadMinutes: 15 });
    expect(r.within).toBe(true);
    if (r.within) expect(r.minutesUntilStart).toBeCloseTo(5);
  });

  it('past event', () => {
    const r = computeCalendarLookahead({ eventStartAt: '2026-05-12T09:00:00Z', now, lookaheadMinutes: 15 });
    expect(r).toEqual({ within: false, reason: 'past' });
  });

  it('too far in future', () => {
    const r = computeCalendarLookahead({ eventStartAt: '2026-05-12T11:00:00Z', now, lookaheadMinutes: 15 });
    expect(r).toEqual({ within: false, reason: 'too_far' });
  });

  it('boundary: exactly at lookahead', () => {
    const r = computeCalendarLookahead({ eventStartAt: '2026-05-12T10:15:00Z', now, lookaheadMinutes: 15 });
    expect(r.within).toBe(true);
  });

  it('boundary: exactly now', () => {
    const r = computeCalendarLookahead({ eventStartAt: '2026-05-12T10:00:00Z', now, lookaheadMinutes: 15 });
    expect(r.within).toBe(true);
  });
});
