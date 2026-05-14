import { describe, it, expect } from 'vitest';
import {
  validateCreateEventInput,
  validateUpdateEventInput,
  validateRespondToInviteInput,
  deriveIdempotencyKey,
  normaliseAttendees,
  computeFreeSlots,
} from '../calendarActionServicePure.js';

// ---------------------------------------------------------------------------
// validateCreateEventInput
// ---------------------------------------------------------------------------

describe('validateCreateEventInput', () => {
  it('accepts valid input with summary, start before end', () => {
    const result = validateCreateEventInput({
      summary: 'Team standup',
      startAt: '2026-06-01T09:00:00Z',
      endAt: '2026-06-01T09:30:00Z',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects input missing summary', () => {
    const result = validateCreateEventInput({
      startAt: '2026-06-01T09:00:00Z',
      endAt: '2026-06-01T09:30:00Z',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects input where start is after end', () => {
    const result = validateCreateEventInput({
      summary: 'Bad event',
      startAt: '2026-06-01T10:00:00Z',
      endAt: '2026-06-01T09:00:00Z',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('startAt must be before endAt');
    }
  });

  it('rejects input where start equals end', () => {
    const result = validateCreateEventInput({
      summary: 'Zero-duration event',
      startAt: '2026-06-01T09:00:00Z',
      endAt: '2026-06-01T09:00:00Z',
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateEventInput
// ---------------------------------------------------------------------------

describe('validateUpdateEventInput', () => {
  it('accepts eventId only (no time fields required)', () => {
    const result = validateUpdateEventInput({ eventId: 'abc123' });
    expect(result.valid).toBe(true);
  });

  it('accepts eventId + start + end in order', () => {
    const result = validateUpdateEventInput({
      eventId: 'abc123',
      startAt: '2026-06-01T09:00:00Z',
      endAt: '2026-06-01T10:00:00Z',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects when start is after end', () => {
    const result = validateUpdateEventInput({
      eventId: 'abc123',
      startAt: '2026-06-01T11:00:00Z',
      endAt: '2026-06-01T10:00:00Z',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('startAt must be before endAt');
    }
  });

  it('rejects missing eventId', () => {
    const result = validateUpdateEventInput({ summary: 'no id' });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRespondToInviteInput
// ---------------------------------------------------------------------------

describe('validateRespondToInviteInput', () => {
  it('accepts valid accepted response', () => {
    const result = validateRespondToInviteInput({ eventId: 'evt1', response: 'accepted' });
    expect(result.valid).toBe(true);
  });

  it('rejects missing eventId', () => {
    const result = validateRespondToInviteInput({ response: 'accepted' });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid response value', () => {
    const result = validateRespondToInviteInput({ eventId: 'evt1', response: 'maybe' });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveIdempotencyKey
// ---------------------------------------------------------------------------

describe('deriveIdempotencyKey', () => {
  it('returns the same key for identical args', () => {
    const args = {
      kind: 'calendar_create',
      ownerUserId: 'user-1',
      payload: { summary: 'Meeting', startAt: '2026-06-01T09:00:00Z' },
    };
    expect(deriveIdempotencyKey(args)).toBe(deriveIdempotencyKey(args));
  });

  it('returns different keys for different ownerUserId', () => {
    const base = { kind: 'calendar_create', payload: { summary: 'Meeting' } };
    const key1 = deriveIdempotencyKey({ ...base, ownerUserId: 'user-1' });
    const key2 = deriveIdempotencyKey({ ...base, ownerUserId: 'user-2' });
    expect(key1).not.toBe(key2);
  });

  it('is deterministic regardless of payload key insertion order', () => {
    const key1 = deriveIdempotencyKey({
      kind: 'k',
      ownerUserId: 'u',
      payload: { a: 1, b: 2 },
    });
    const key2 = deriveIdempotencyKey({
      kind: 'k',
      ownerUserId: 'u',
      payload: { b: 2, a: 1 },
    });
    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// normaliseAttendees
// ---------------------------------------------------------------------------

describe('normaliseAttendees', () => {
  it('deduplicates on lowercase email', () => {
    const result = normaliseAttendees([
      { email: 'Alice@Example.com' },
      { email: 'alice@example.com' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe('alice@example.com');
  });

  it('preserves non-email fields on first occurrence', () => {
    const result = normaliseAttendees([
      { email: 'Bob@Example.com', displayName: 'Bob' },
      { email: 'charlie@example.com' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.displayName).toBe('Bob');
  });

  it('handles empty array', () => {
    expect(normaliseAttendees([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeFreeSlots
// ---------------------------------------------------------------------------

describe('computeFreeSlots', () => {
  const timeMin = '2026-06-01T08:00:00Z';
  const timeMax = '2026-06-01T17:00:00Z';

  it('returns a single large slot when no events exist', () => {
    const slots = computeFreeSlots({
      events: [],
      timeMin,
      timeMax,
      durationMinutes: 30,
    });
    expect(slots.length).toBeGreaterThan(0);
    // toISOString() may append .000 — compare via Date value
    expect(new Date(slots[0]?.start ?? '').getTime()).toBe(new Date(timeMin).getTime());
  });

  it('blocks a slot covered by a busy event', () => {
    const slots = computeFreeSlots({
      events: [
        { start: '2026-06-01T08:00:00Z', end: '2026-06-01T17:00:00Z' },
      ],
      timeMin,
      timeMax,
      durationMinutes: 30,
    });
    expect(slots).toHaveLength(0);
  });

  it('excludes slots outside working hours', () => {
    const slots = computeFreeSlots({
      events: [],
      timeMin: '2026-06-01T00:00:00Z',
      timeMax: '2026-06-01T23:59:00Z',
      durationMinutes: 60,
      workingHours: { start: '09:00', end: '17:00' },
    });
    for (const slot of slots) {
      const startHour = new Date(slot.start).getUTCHours();
      const endHour = new Date(slot.end).getUTCHours();
      expect(startHour).toBeGreaterThanOrEqual(9);
      expect(endHour).toBeLessThanOrEqual(17);
    }
  });
});
