/**
 * relativeTime.ts — Brain Tree OS adoption P3.
 *
 * Compact relative-time formatter using Intl.RelativeTimeFormat (built-in,
 * no new dependency). Used by SessionLogCardList to render "2 hours ago"
 * style timestamps.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P3
 */

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year',   ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month',  ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week',   ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day',    ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour',   ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return '--';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '--';

  const diffMs = date.getTime() - Date.now();
  const absDiff = Math.abs(diffMs);

  for (const { unit, ms } of UNITS) {
    if (absDiff >= ms || unit === 'second') {
      const value = Math.round(diffMs / ms);
      return rtf.format(value, unit);
    }
  }
  return rtf.format(0, 'second');
}

/**
 * Freshness label for the recommendations section header.
 * Thresholds per spec §7:
 *   - within 4 hours  → "Updated this morning" (or "Updated today" outside morning hours)
 *   - older than 4 hours but within today → "Updated today"
 *   - yesterday       → "Updated yesterday"
 *   - older           → "Updated {N} days ago" via Intl.RelativeTimeFormat
 */
export function formatRelativeTime(date: Date): string {
  const nowMs = Date.now();
  const diffMs = nowMs - date.getTime();
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (diffMs < 0) return 'Updated just now';

  if (diffMs < fourHoursMs) {
    return 'Updated this morning';
  }

  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((today.getTime() - dateDay.getTime()) / oneDayMs);

  if (dayDiff === 0) return 'Updated today';
  if (dayDiff === 1) return 'Updated yesterday';
  return rtf.format(-dayDiff, 'day');
}
