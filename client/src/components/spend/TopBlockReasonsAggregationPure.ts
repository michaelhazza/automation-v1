// Pure helper — no React, no DOM, no network.
// Aggregates failure_reason counts for blocked/denied charges over a time window.
// Unit-tested in __tests__/TopBlockReasonsAggregationPure.test.ts.

export interface ChargeForAggregation {
  status: string;
  failureReason: string | null;
  createdAt: string;
}

export interface BlockReasonCount {
  reason: string;
  count: number;
}

const BLOCK_STATUSES = new Set(['blocked', 'denied']);

/**
 * Aggregate failure_reason occurrences for charges in blocked/denied status
 * within the last windowDays calendar days from referenceDate.
 *
 * Returns an array sorted by count descending, then reason ascending for
 * deterministic tiebreaking.
 */
export function aggregateBlockReasons(
  rows: ChargeForAggregation[],
  windowDays: number,
  referenceDate: Date,
): BlockReasonCount[] {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString();

  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!BLOCK_STATUSES.has(row.status)) continue;
    if (row.createdAt < cutoffIso) continue;
    const reason = row.failureReason ?? 'unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  const result: BlockReasonCount[] = [];
  for (const [reason, count] of counts) {
    result.push({ reason, count });
  }

  result.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.reason.localeCompare(b.reason);
  });

  return result;
}
