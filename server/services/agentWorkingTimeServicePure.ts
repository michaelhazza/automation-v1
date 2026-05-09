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
 * Pairing rule (spec §7.5) — strict fail-closed:
 *
 *   1. **Identified path.** When `step_completed.stepId` is present, pair to
 *      the open `step_started` with the same `(runId, stepId)`. If no such
 *      open exists, **drop the pair** — never fall through to the run-level
 *      fallback. (Cross-fall-through under stepId asymmetry would risk
 *      mis-pairing a stepId-bearing end to an unidentified start under
 *      concurrent steps.)
 *
 *   2. **Unidentified path.** When `step_completed.stepId` is absent, pair
 *      to the open `step_started` for that run **only when** exactly one
 *      open exists in that run AND it also has no stepId. Any of these
 *      conditions abort the pair (drop + skip):
 *        - more than one open step is currently in flight for that run
 *          (ambiguous — can't tell which the unidentified end belongs to);
 *        - the only open step in the run carries a stepId (mismatched
 *          identity — would cross-match an identified start to an
 *          unidentified end).
 *
 *   3. **Retry semantics.** A `step_started` with the same `(runId, stepId)`
 *      as an existing open replaces it. The earlier start was abandoned
 *      (retry path); only the most recent one pairs.
 *
 * Wait-state subtraction (HITL pause, external call, retry backoff,
 * sub-agent delegation per §7.5) is NOT applied here — this helper is the
 * step-envelope accumulator only. The full production flow in
 * `agentWorkingTimeService.ts` composes this with the wait-state ledger.
 */
export function accumulateWorkingTime(events: WtEvent[]): WorkingTimeAccumulation {
  // Open intervals are tracked as a flat list so we can reason about
  // "number of opens currently in flight per run" cleanly. An entry is the
  // tuple `(runId, stepId | null, startMs)`. Producers retry by re-emitting
  // `step_started` with the same `(runId, stepId)`; that case overwrites the
  // existing entry rather than appending a duplicate.
  interface OpenStep { runId: string; stepId: string | null; startMs: number; }
  const openSteps: OpenStep[] = [];
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
      const stepId = event.stepId ?? null;
      const idx = openSteps.findIndex(o => o.runId === event.runId && o.stepId === stepId);
      if (idx >= 0) {
        // Retry / re-emit: replace the abandoned start with the new one.
        openSteps[idx] = { runId: event.runId, stepId, startMs };
      } else {
        openSteps.push({ runId: event.runId, stepId, startMs });
      }
    } else if (event.eventType === 'step_completed') {
      let startMs: number | undefined;
      if (event.stepId) {
        // Path 1: identified — pair only by exact (runId, stepId). No
        // cross-fallback to the unidentified path; drop if no match.
        const idx = openSteps.findIndex(o => o.runId === event.runId && o.stepId === event.stepId);
        if (idx >= 0) {
          startMs = openSteps[idx].startMs;
          openSteps.splice(idx, 1);
        }
      } else {
        // Path 2: unidentified — pair only when exactly one open exists in
        // this run AND it lacks stepId. Multiple opens or any identified
        // open in flight aborts (ambiguous identity).
        const opensInRun = openSteps.filter(o => o.runId === event.runId);
        if (opensInRun.length === 1 && opensInRun[0].stepId === null) {
          startMs = opensInRun[0].startMs;
          const idx = openSteps.indexOf(opensInRun[0]);
          openSteps.splice(idx, 1);
        }
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
