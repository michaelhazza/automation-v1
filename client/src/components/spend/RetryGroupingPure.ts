// Pure helper — no React, no DOM, no network.
// Groups agent_charge rows by intent_id for the Spend Ledger retry view.
// Unit-tested in __tests__/RetryGroupingPure.test.ts.

export interface ChargeRow {
  id: string;
  intentId: string | null;
  createdAt: string;
  status: string;
  amountMinor: number;
  currency: string;
  merchantDescriptor: string;
  merchantId: string | null;
  mode: string;
  failureReason: string | null;
}

export interface RetryGroup {
  intentId: string | null;
  /** Sorted most-recent first. */
  attempts: ChargeRow[];
  /** The most recent attempt. */
  latest: ChargeRow;
  attemptCount: number;
}

/**
 * Group charge rows by intentId.
 *
 * Rows without an intentId (intentId === null) are treated as standalone
 * single-attempt groups (intentId null + row id used as key).
 *
 * Within each group, rows are sorted descending by createdAt so the
 * most-recent attempt is always attempts[0].
 */
export function groupByIntent(rows: ChargeRow[]): RetryGroup[] {
  const byKey = new Map<string, ChargeRow[]>();

  for (const row of rows) {
    const key = row.intentId ?? `__single__${row.id}`;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      byKey.set(key, [row]);
    }
  }

  const groups: RetryGroup[] = [];
  for (const [key, attempts] of byKey) {
    attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    groups.push({
      intentId: key.startsWith('__single__') ? null : key,
      attempts,
      latest: attempts[0],
      attemptCount: attempts.length,
    });
  }

  // Sort groups by their latest attempt descending
  groups.sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));

  return groups;
}

/**
 * Flatten a list of RetryGroups back to a flat list of ChargeRow.
 * Used when grouping is disabled.
 */
export function flattenGroups(groups: RetryGroup[]): ChargeRow[] {
  const flat: ChargeRow[] = [];
  for (const g of groups) {
    for (const row of g.attempts) {
      flat.push(row);
    }
  }
  flat.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return flat;
}
