// Pure helper — no DB, no network, no Date.now().
// Spec §4 Phase 4 / §6.6 / §12.1.

export type RunForBucketing = {
  id: string;
  createdAt: Date;
  injectedEntryIds: string[] | null; // null = unmeasured
  citedEntryIds: string[];
  appliedMemoryBlockIds: string[];
  appliedMemoryBlockCitations: unknown[];
};

export type DailyBucket = {
  bucketDate: string;           // 'YYYY-MM-DD' UTC
  runsMeasuredEntries: number;
  entryUtility: number | null;
  blockUtility: number | null;
};

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function bucketDailySeries(rows: RunForBucketing[], now: Date): DailyBucket[] {
  // Build 30-bucket spine oldest → newest.
  const todayMs = utcMidnight(now).getTime();
  const bucketMap = new Map<string, {
    measuredCount: number;
    totalInjected: number;
    totalCited: number;
    totalBlocks: number;
    totalCitedBlocks: number;
  }>();

  const buckets: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const key = toDateStr(new Date(todayMs - i * 86_400_000));
    buckets.push(key);
    bucketMap.set(key, {
      measuredCount: 0,
      totalInjected: 0,
      totalCited: 0,
      totalBlocks: 0,
      totalCitedBlocks: 0,
    });
  }

  for (const row of rows) {
    const key = toDateStr(utcMidnight(row.createdAt));
    const acc = bucketMap.get(key);
    if (!acc) continue; // outside the 30-day window — skip

    // Mirror the MV's `jsonb_typeof(...) = 'array'` predicate so legacy rows
    // with malformed JSONB (non-array shape) are treated as unmeasured here
    // too (ChatGPT R2 F1).
    const measured = Array.isArray(row.injectedEntryIds);
    if (measured) {
      acc.measuredCount += 1;
      acc.totalInjected += row.injectedEntryIds!.length;
      acc.totalCited += row.citedEntryIds.length;
    }
    acc.totalBlocks += row.appliedMemoryBlockIds.length;
    acc.totalCitedBlocks += row.appliedMemoryBlockCitations.length;
  }

  return buckets.map((key) => {
    const acc = bucketMap.get(key)!;

    const entryUtility =
      acc.measuredCount === 0 || acc.totalInjected === 0
        ? null
        : acc.totalCited / acc.totalInjected;

    const blockUtility =
      acc.totalBlocks === 0 ? null : acc.totalCitedBlocks / acc.totalBlocks;

    return {
      bucketDate: key,
      runsMeasuredEntries: acc.measuredCount,
      entryUtility,
      blockUtility,
    };
  });
}
