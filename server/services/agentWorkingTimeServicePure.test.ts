import { describe, it, expect } from 'vitest';
import { splitIntervalAcrossBuckets, accumulateWorkingTime } from './agentWorkingTimeServicePure';

describe('splitIntervalAcrossBuckets', () => {
  it('throws RangeError when endMs <= startMs', () => {
    expect(() => splitIntervalAcrossBuckets(1000, 1000)).toThrow(RangeError);
    expect(() => splitIntervalAcrossBuckets(2000, 1000)).toThrow(RangeError);
  });

  it('single-bucket interval (entirely within one day)', () => {
    // 2026-05-08T10:00:00Z to 2026-05-08T11:00:00Z = 3600000 ms
    const startMs = Date.UTC(2026, 4, 8, 10, 0, 0);
    const endMs = Date.UTC(2026, 4, 8, 11, 0, 0);
    const result = splitIntervalAcrossBuckets(startMs, endMs);
    expect(result).toHaveLength(1);
    expect(result[0].bucketDate).toBe('2026-05-08');
    expect(result[0].contributionMs).toBe(3_600_000);
    // Postcondition: sum equals duration
    const sum = result.reduce((acc, r) => acc + r.contributionMs, 0);
    expect(sum).toBe(endMs - startMs);
  });

  it('two-bucket interval crossing midnight', () => {
    // 2026-05-08T23:50:00Z to 2026-05-09T00:30:00Z
    const startMs = Date.UTC(2026, 4, 8, 23, 50, 0);
    const endMs = Date.UTC(2026, 4, 9, 0, 30, 0);
    const result = splitIntervalAcrossBuckets(startMs, endMs);
    expect(result).toHaveLength(2);
    expect(result[0].bucketDate).toBe('2026-05-08');
    expect(result[0].contributionMs).toBe(10 * 60 * 1000); // 10 min
    expect(result[1].bucketDate).toBe('2026-05-09');
    expect(result[1].contributionMs).toBe(30 * 60 * 1000); // 30 min
    const sum = result.reduce((acc, r) => acc + r.contributionMs, 0);
    expect(sum).toBe(endMs - startMs);
  });

  it('exact midnight boundary: T = boundary belongs to new bucket', () => {
    // Interval starting exactly at midnight
    const startMs = Date.UTC(2026, 4, 9, 0, 0, 0); // midnight exactly
    const endMs = startMs + 1000; // 1 second after
    const result = splitIntervalAcrossBuckets(startMs, endMs);
    expect(result).toHaveLength(1);
    expect(result[0].bucketDate).toBe('2026-05-09'); // belongs to NEW bucket
    expect(result[0].contributionMs).toBe(1000);
  });

  it('multi-bucket: year-long span — drift bound ≤ 365ms (sum equals duration exactly since we use ms integers)', () => {
    // 365 days span
    const startMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const endMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const result = splitIntervalAcrossBuckets(startMs, endMs);
    expect(result.length).toBe(365);
    const sum = result.reduce((acc, r) => acc + r.contributionMs, 0);
    expect(sum).toBe(endMs - startMs); // exactly equal (no rounding during split)
  });

  it('concurrent-run summing: two step pairs sum independently', () => {
    // This is tested at the accumulateWorkingTime level
    const startMs = Date.UTC(2026, 4, 8, 10, 0, 0);
    const endMs1 = startMs + 30_000; // 30s
    const endMs2 = startMs + 60_000; // 60s
    const r1 = splitIntervalAcrossBuckets(startMs, endMs1);
    const r2 = splitIntervalAcrossBuckets(startMs, endMs2);
    expect(r1[0].contributionMs + r2[0].contributionMs).toBe(90_000);
  });
});

describe('accumulateWorkingTime', () => {
  it('returns zero for empty events', () => {
    const result = accumulateWorkingTime([]);
    expect(result.workingTimeSeconds).toBe(0);
    expect(result.runCount).toBe(0);
  });

  it('counts a matched step pair', () => {
    const events = [
      { runId: 'run1', eventType: 'step_started', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_completed', eventTimestamp: '2026-05-08T10:00:30.000Z' },
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(30);
    expect(result.runCount).toBe(1);
  });

  it('counts concurrent runs separately', () => {
    const events = [
      { runId: 'run1', eventType: 'step_started', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run2', eventType: 'step_started', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_completed', eventTimestamp: '2026-05-08T10:00:30.000Z' },
      { runId: 'run2', eventType: 'step_completed', eventTimestamp: '2026-05-08T10:01:00.000Z' },
      { runId: 'run1', eventType: 'run_completed', eventTimestamp: '2026-05-08T10:00:31.000Z' },
      { runId: 'run2', eventType: 'run_completed', eventTimestamp: '2026-05-08T10:01:01.000Z' },
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(90); // 30 + 60
    expect(result.runCount).toBe(2);
    expect(result.successfulRuns).toBe(2);
  });

  it('pairs interleaved step starts/ends in the same run by stepId', () => {
    // Two steps overlap inside one run. Without stepId the helper would
    // mis-pair the inner end to the outer start (or vice-versa); with stepId
    // each pair resolves correctly.
    const events = [
      { runId: 'run1', eventType: 'step_started',   stepId: 'A', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_started',   stepId: 'B', eventTimestamp: '2026-05-08T10:00:10.000Z' },
      { runId: 'run1', eventType: 'step_completed', stepId: 'A', eventTimestamp: '2026-05-08T10:00:30.000Z' }, // 30s
      { runId: 'run1', eventType: 'step_completed', stepId: 'B', eventTimestamp: '2026-05-08T10:00:50.000Z' }, // 40s
    ];
    const result = accumulateWorkingTime(events);
    // 30 + 40 = 70 seconds. (Without stepId pairing the helper would have
    // collapsed both ends to the latest start and produced a different total.)
    expect(result.workingTimeSeconds).toBe(70);
    expect(result.runCount).toBe(1);
  });

  it('handles a retried step (same stepId restarted) — last start wins', () => {
    // Producer retries step A: re-emits step_started for the same stepId
    // before the original completed. The end pairs to the most recent open
    // start for that stepId, never to the abandoned earlier start.
    const events = [
      { runId: 'run1', eventType: 'step_started',   stepId: 'A', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_started',   stepId: 'A', eventTimestamp: '2026-05-08T10:00:20.000Z' }, // retry — overwrites
      { runId: 'run1', eventType: 'step_completed', stepId: 'A', eventTimestamp: '2026-05-08T10:00:30.000Z' }, // 10s, not 30s
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(10);
  });

  it('falls back to runId pairing when stepId is missing on legacy events', () => {
    // No stepId on either side — fallback path. Behaves identically to the
    // pre-stepId implementation for backwards compatibility with fixtures.
    const events = [
      { runId: 'run1', eventType: 'step_started',   eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_completed', eventTimestamp: '2026-05-08T10:00:30.000Z' },
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(30);
  });

  it('drops the pair when end has stepId but no matching open exists', () => {
    // step_completed carries stepId='B' but only stepId='A' is open. Strict
    // fail-closed: do not cross-fall through to the unidentified slot,
    // even though one is implicitly available. Drop the pair entirely.
    const events = [
      { runId: 'run1', eventType: 'step_started',   stepId: 'A', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_completed', stepId: 'B', eventTimestamp: '2026-05-08T10:00:30.000Z' },
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(0); // no pair recorded
  });

  it('drops the pair when end lacks stepId but an identified open is in flight', () => {
    // An identified step (stepId='A') is open in run1; an unidentified end
    // arrives. Cross-pairing would mis-attribute the unidentified end to A.
    // Strict fail-closed: drop instead.
    const events = [
      { runId: 'run1', eventType: 'step_started',   stepId: 'A', eventTimestamp: '2026-05-08T10:00:00.000Z' },
      { runId: 'run1', eventType: 'step_completed',              eventTimestamp: '2026-05-08T10:00:30.000Z' },
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(0);
  });

  it('drops an unidentified pair when multiple opens are in flight (ambiguous)', () => {
    // Two unidentified starts in the same run — the run-level fallback can
    // no longer decide which one a single unidentified end belongs to. Both
    // pairs would otherwise become arbitrary. Drop instead.
    const events = [
      { runId: 'run1', eventType: 'step_started',   eventTimestamp: '2026-05-08T10:00:00.000Z' },
      // The retry-replacement rule means a second start without stepId in
      // the same run replaces the first. Use a concurrent identified start
      // alongside an unidentified one to genuinely create ambiguity.
      { runId: 'run1', eventType: 'step_started',   stepId: 'A', eventTimestamp: '2026-05-08T10:00:10.000Z' },
      { runId: 'run1', eventType: 'step_completed',              eventTimestamp: '2026-05-08T10:00:30.000Z' },
    ];
    const result = accumulateWorkingTime(events);
    expect(result.workingTimeSeconds).toBe(0);
  });
});
