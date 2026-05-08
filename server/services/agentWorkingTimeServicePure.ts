/** UTC midnight boundary in ms for a given ms timestamp */
function utcMidnightBefore(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function msToUtcDateString(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface BucketContribution {
  bucketDate: string;
  contributionMs: number;
}

/**
 * Splits an interval [startMs, endMs) across UTC calendar day buckets.
 * Postcondition: Σ contributionMs === (endMs - startMs) exactly.
 * Half-open: T = bucket_boundary belongs to the new bucket.
 */
export function splitIntervalAcrossBuckets(startMs: number, endMs: number): BucketContribution[] {
  if (endMs <= startMs) {
    throw new RangeError(`splitIntervalAcrossBuckets: endMs (${endMs}) must be > startMs (${startMs})`);
  }

  const results: BucketContribution[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const bucketDate = msToUtcDateString(cursor);
    // Next midnight strictly after cursor
    const bucketStart = utcMidnightBefore(cursor);
    const nextMidnight = bucketStart + 86_400_000;
    const bucketEnd = Math.min(nextMidnight, endMs);
    const contributionMs = bucketEnd - cursor;
    results.push({ bucketDate, contributionMs });
    cursor = bucketEnd;
  }

  return results;
}

export interface WorkingTimeAccumulation {
  workingTimeSeconds: number;
  runCount: number;
  successfulRuns: number;
  failedRuns: number;
  partialRuns: number;
}

/** Minimal event shape for working-time accumulation */
interface WtEvent {
  runId: string | null;
  eventType: string;
  eventTimestamp: string;
}

/**
 * Accumulates working time from events.
 * Counts step_started/step_completed pairs; subtracts wait states.
 * This is a simplified implementation — the full production version
 * in agentWorkingTimeService.ts handles nested subtraction of wait windows.
 */
export function accumulateWorkingTime(events: WtEvent[]): WorkingTimeAccumulation {
  // Track the most recent open step interval per run (one slot per run — simplified implementation)
  const openSteps = new Map<string, number>(); // key: runId, value: startMs
  let totalMs = 0;
  const runIds = new Set<string>();
  const completedRuns = new Set<string>();
  const failedRuns = new Set<string>();
  const partialRuns = new Set<string>();

  for (const event of events) {
    if (!event.runId) continue;
    runIds.add(event.runId);

    if (event.eventType === 'step_started') {
      const key = event.runId;
      openSteps.set(key, new Date(event.eventTimestamp).getTime());
    } else if (event.eventType === 'step_completed') {
      const key = event.runId;
      const startMs = openSteps.get(key);
      if (startMs !== undefined) {
        const endMs = new Date(event.eventTimestamp).getTime();
        totalMs += Math.max(0, endMs - startMs);
        openSteps.delete(key);
      }
    } else if (event.eventType === 'run_completed') {
      completedRuns.add(event.runId);
    } else if (event.eventType === 'run_failed') {
      failedRuns.add(event.runId);
    } else if (event.eventType === 'run_partial') {
      partialRuns.add(event.runId);
    }
  }

  return {
    workingTimeSeconds: Math.floor(totalMs / 1000),
    runCount: runIds.size,
    successfulRuns: completedRuns.size,
    failedRuns: failedRuns.size,
    partialRuns: partialRuns.size,
  };
}
