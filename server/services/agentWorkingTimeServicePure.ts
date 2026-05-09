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

/** Minimal event shape for working-time accumulation. */
interface WtEvent {
  runId: string | null;
  eventType: string;
  eventTimestamp: string;
  /**
   * Stable step identity — required on `step_started` / `step_completed` so
   * starts and ends pair correctly under nesting, retries, or interleaved
   * steps in the same run. Producers populate from `payload.stepId`; for
   * Workflow-engine steps this is `${taskId}:${taskSequence}`.
   *
   * Backwards-compatible fallback: when `stepId` is missing on both ends,
   * pair by `runId` alone. The fallback opens at most ONE step per run and
   * never pairs an end to an unrelated start, so the worst case is a
   * dropped pair (under-count) rather than a mis-paired interval.
   */
  stepId?: string | null;
}

/**
 * Accumulates working time from events.
 *
 * Pairing rule (spec §7.5):
 *   1. If both the `step_started` and the matching `step_completed` carry a
 *      non-empty `stepId`, pair on `(runId, stepId)`. This is the canonical
 *      path — concurrent / nested / retried steps in the same run pair
 *      correctly because each carries its own id.
 *   2. If `stepId` is missing on either side, fall back to `(runId)` — a
 *      single open slot per run. Multiple concurrent step_started events on
 *      the same run with no stepId are NOT supported (only the most recent
 *      open is tracked); the matching end pairs to it. Producers should
 *      always emit stepId; the fallback exists for legacy event fixtures.
 *
 * The fallback never mis-pairs across runs or step ids; the worst case is a
 * dropped pair (under-count) rather than mis-attribution.
 *
 * Wait-state subtraction (HITL pause, external call, retry backoff,
 * sub-agent delegation per §7.5) is NOT applied here — this helper is the
 * step-envelope accumulator only. The full production flow in
 * `agentWorkingTimeService.ts` composes this with the wait-state ledger.
 */
export function accumulateWorkingTime(events: WtEvent[]): WorkingTimeAccumulation {
  const openByStepId = new Map<string, number>();   // key: `${runId}::${stepId}`
  const openByRunId = new Map<string, number>();    // fallback: runId only
  let totalMs = 0;
  const runIds = new Set<string>();
  const completedRuns = new Set<string>();
  const failedRuns = new Set<string>();
  const partialRuns = new Set<string>();

  for (const event of events) {
    if (!event.runId) continue;
    runIds.add(event.runId);

    if (event.eventType === 'step_started') {
      const startMs = new Date(event.eventTimestamp).getTime();
      if (event.stepId) {
        openByStepId.set(`${event.runId}::${event.stepId}`, startMs);
      } else {
        openByRunId.set(event.runId, startMs);
      }
    } else if (event.eventType === 'step_completed') {
      let startMs: number | undefined;
      if (event.stepId) {
        const k = `${event.runId}::${event.stepId}`;
        startMs = openByStepId.get(k);
        if (startMs !== undefined) openByStepId.delete(k);
      }
      if (startMs === undefined) {
        startMs = openByRunId.get(event.runId);
        if (startMs !== undefined) openByRunId.delete(event.runId);
      }
      if (startMs !== undefined) {
        const endMs = new Date(event.eventTimestamp).getTime();
        totalMs += Math.max(0, endMs - startMs);
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
