import { z } from 'zod';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const createEventSchema = z.object({
  summary: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  attendeeEmails: z.array(z.string().email()).optional(),
});

const updateEventSchema = z.object({
  eventId: z.string().min(1),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
});

const respondToInviteSchema = z.object({
  eventId: z.string().min(1),
  response: z.enum(['accepted', 'declined', 'tentative']),
});

export function validateCreateEventInput(
  input: unknown,
): { valid: true } | { valid: false; reason: string } {
  const result = createEventSchema.safeParse(input);
  if (!result.success) {
    return { valid: false, reason: result.error.errors[0]?.message ?? 'Invalid input' };
  }
  const { startAt, endAt } = result.data;
  if (new Date(startAt) >= new Date(endAt)) {
    return { valid: false, reason: 'startAt must be before endAt' };
  }
  return { valid: true };
}

export function validateUpdateEventInput(
  input: unknown,
): { valid: true } | { valid: false; reason: string } {
  const result = updateEventSchema.safeParse(input);
  if (!result.success) {
    return { valid: false, reason: result.error.errors[0]?.message ?? 'Invalid input' };
  }
  const { startAt, endAt } = result.data;
  if (startAt !== undefined && endAt !== undefined) {
    if (new Date(startAt) >= new Date(endAt)) {
      return { valid: false, reason: 'startAt must be before endAt' };
    }
  }
  return { valid: true };
}

export function validateRespondToInviteInput(
  input: unknown,
): { valid: true } | { valid: false; reason: string } {
  const result = respondToInviteSchema.safeParse(input);
  if (!result.success) {
    return { valid: false, reason: result.error.errors[0]?.message ?? 'Invalid input' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Idempotency key derivation
// ---------------------------------------------------------------------------

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      sorted[key] = sortObjectKeys(val as Record<string, unknown>);
    } else {
      sorted[key] = val;
    }
  }
  return sorted;
}

export function deriveIdempotencyKey(args: {
  kind: string;
  ownerUserId: string;
  payload: Record<string, unknown>;
}): string {
  const sortedPayload = sortObjectKeys(args.payload);
  return `${args.kind}:${args.ownerUserId}:${JSON.stringify(sortedPayload)}`;
}

// ---------------------------------------------------------------------------
// Attendee normalisation
// ---------------------------------------------------------------------------

export function normaliseAttendees(
  attendees: Array<{ email: string; [key: string]: unknown }>,
): Array<{ email: string; [key: string]: unknown }> {
  const seen = new Set<string>();
  const result: Array<{ email: string; [key: string]: unknown }> = [];
  for (const attendee of attendees) {
    const normalised = attendee.email.toLowerCase();
    if (!seen.has(normalised)) {
      seen.add(normalised);
      result.push({ ...attendee, email: normalised });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Free slot computation
// ---------------------------------------------------------------------------

function parseHHMM(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

function toMinutesFromMidnight(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function computeFreeSlots(args: {
  events: Array<{ start: string; end: string }>;
  timeMin: string;
  timeMax: string;
  durationMinutes: number;
  workingHours?: { start: string; end: string };
}): Array<{ start: string; end: string }> {
  const windowStart = new Date(args.timeMin).getTime();
  const windowEnd = new Date(args.timeMax).getTime();
  const durationMs = args.durationMinutes * 60 * 1000;

  // Build list of busy intervals (clamped to window)
  const busy = args.events
    .map((e) => ({
      start: Math.max(new Date(e.start).getTime(), windowStart),
      end: Math.min(new Date(e.end).getTime(), windowEnd),
    }))
    .filter((e) => e.start < e.end)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping busy intervals
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of busy) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  // Build free gaps
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (cursor < b.start) {
      gaps.push({ start: cursor, end: b.start });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < windowEnd) {
    gaps.push({ start: cursor, end: windowEnd });
  }

  const workStart = args.workingHours ? parseHHMM(args.workingHours.start) : null;
  const workEnd = args.workingHours ? parseHHMM(args.workingHours.end) : null;
  const workStartMinutes = workStart ? workStart.hours * 60 + workStart.minutes : 0;
  const workEndMinutes = workEnd ? workEnd.hours * 60 + workEnd.minutes : 24 * 60;

  const slots: Array<{ start: string; end: string }> = [];

  for (const gap of gaps) {
    let slotStart = gap.start;
    while (slotStart + durationMs <= gap.end) {
      const slotEnd = slotStart + durationMs;
      if (args.workingHours) {
        const slotStartDate = new Date(slotStart);
        const slotEndDate = new Date(slotEnd);
        const startMins = toMinutesFromMidnight(slotStartDate);
        const endMins = toMinutesFromMidnight(slotEndDate);
        if (startMins >= workStartMinutes && endMins <= workEndMinutes) {
          slots.push({
            start: new Date(slotStart).toISOString(),
            end: new Date(slotEnd).toISOString(),
          });
        }
        slotStart += durationMs;
      } else {
        slots.push({
          start: new Date(slotStart).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
        slotStart += durationMs;
      }
    }
  }

  return slots;
}
