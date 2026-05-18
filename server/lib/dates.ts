export class DueDateParseError extends Error {
  constructor(readonly code: 'invalid_format' | 'invalid_timezone' | 'invalid_date', message: string) {
    super(message);
    this.name = 'DueDateParseError';
  }
}

/**
 * Convert a YYYY-MM-DD due-date string into UTC Date at midnight in the subaccount's IANA timezone.
 * Falls back to UTC-midnight if timezone is null (matches existing server/routes/tasks.ts behaviour).
 * @throws {DueDateParseError} for malformed input or invalid timezone
 */
export function parseDueDate(input: string, subaccountTimezone: string | null): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new DueDateParseError('invalid_format', `Invalid date format: ${input}`);
  }

  const [yearStr, monthStr, dayStr] = input.split('-') as [string, string, string];
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Reject out-of-range month/day as invalid_format (not a valid date string)
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new DueDateParseError('invalid_format', `Invalid date format: ${input}`);
  }

  // Validate calendar date (e.g. Feb 30 is invalid)
  const testDate = new Date(year, month - 1, day);
  if (
    testDate.getFullYear() !== year ||
    testDate.getMonth() !== month - 1 ||
    testDate.getDate() !== day
  ) {
    throw new DueDateParseError('invalid_date', `Date does not exist: ${input}`);
  }

  if (subaccountTimezone === null) {
    return new Date(`${input}T00:00:00.000Z`);
  }

  // Validate timezone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: subaccountTimezone });
  } catch {
    throw new DueDateParseError('invalid_timezone', `Invalid IANA timezone: ${subaccountTimezone}`);
  }

  // Find the UTC instant corresponding to midnight in the given timezone.
  //
  // Approach: format parts of a candidate UTC instant using the target timezone.
  // We iterate candidates at 15-minute intervals (covers all known IANA offsets),
  // starting from UTC midnight of the input date offset by up to ±14 hours.
  // When the formatted local date/time matches YYYY-MM-DD 00:00:00 we return that instant.
  //
  // For spring-forward days where local midnight doesn't exist (e.g. 02:00 -> 03:00),
  // we return the first second of the local day that does exist.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: subaccountTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  function getLocalParts(utcMs: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
    const parts = formatter.formatToParts(new Date(utcMs));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return {
      y: parseInt(map['year']!, 10),
      mo: parseInt(map['month']!, 10),
      d: parseInt(map['day']!, 10),
      h: parseInt(map['hour']!, 10),
      mi: parseInt(map['minute']!, 10),
      s: parseInt(map['second']!, 10),
    };
  }

  const utcMidnightMs = Date.UTC(year, month - 1, day);
  const startMs = utcMidnightMs - 14 * 60 * 60 * 1000;
  const endMs = utcMidnightMs + 14 * 60 * 60 * 1000;

  let firstOfDay: number | null = null;

  // Scan at 1-second resolution over the 28-hour window.
  // We coarse-scan at 15-minute intervals first, then refine.
  // Coarse scan at 15-min steps to find the hour boundary, then scan seconds within.
  const stepMs = 15 * 60 * 1000;
  let prev = getLocalParts(startMs);

  for (let t = startMs + stepMs; t <= endMs + stepMs; t += stepMs) {
    const cur = getLocalParts(Math.min(t, endMs));
    const prevIsTargetDay = prev.y === year && prev.mo === month && prev.d === day;
    const curIsTargetDay = cur.y === year && cur.mo === month && cur.d === day;

    if (!prevIsTargetDay && curIsTargetDay) {
      // Day boundary crossed — scan second-by-second backward from current coarse point
      const coarseStart = t - stepMs;
      for (let s = coarseStart; s <= Math.min(t, endMs); s += 1000) {
        const lp = getLocalParts(s);
        if (lp.y === year && lp.mo === month && lp.d === day) {
          if (firstOfDay === null) firstOfDay = s;
          if (lp.h === 0 && lp.mi === 0 && lp.s === 0) {
            return new Date(s);
          }
        }
      }
    } else if (prevIsTargetDay && curIsTargetDay) {
      // Both in target day — check the previous coarse point
      const coarseStart = t - stepMs;
      const lp = getLocalParts(coarseStart);
      if (lp.y === year && lp.mo === month && lp.d === day) {
        if (firstOfDay === null) firstOfDay = coarseStart;
        if (lp.h === 0 && lp.mi === 0 && lp.s === 0) {
          return new Date(coarseStart);
        }
      }
    }

    prev = cur;
    if (t >= endMs) break;
  }

  // Spring-forward fallback: return the first second of the local day
  if (firstOfDay !== null) {
    return new Date(firstOfDay);
  }

  throw new DueDateParseError('invalid_date', `Could not resolve midnight for ${input} in ${subaccountTimezone}`);
}
