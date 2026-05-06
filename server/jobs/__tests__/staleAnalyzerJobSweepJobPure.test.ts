/**
 * Runnable via:
 *   npx tsx server/jobs/__tests__/staleAnalyzerJobSweepJobPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  STALE_ANALYZER_JOB_THRESHOLD_MS,
  STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES,
  computeStaleAnalyzerJobCutoff,
} from '../staleAnalyzerJobSweepJobPure.js';

// ---------------------------------------------------------------------------

test('STALE_ANALYZER_JOB_THRESHOLD_MS is 15 minutes (matches sweep schedule headroom)', () => {
  expect(STALE_ANALYZER_JOB_THRESHOLD_MS === 15 * 60_000, 'expected 900_000 ms').toBeTruthy();
});

test('mid-flight status set covers the full skill_analyzer_jobs lifecycle pre-completion', () => {
  // The set must include every status the job pipeline writes via
  // updateJobProgress before terminal `completed` / `failed`. Pending isn't
  // included on purpose — a queued job has no worker to die. `comparing`
  // (Stage 4 — similarity computation) was missing in the initial draft;
  // its absence meant Stage 4 worker deaths would never be reaped. Locking
  // the canonical names here so the bug can't silently regress.
  const expected = ['parsing', 'hashing', 'embedding', 'comparing', 'classifying'];
  expect(STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES.length === expected.length, `expected ${expected.length} statuses, got ${STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES.length}`).toBeTruthy();
  for (const status of expected) {
    expect((STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES as readonly string[]).includes(status), `missing status: ${status}`).toBeTruthy();
  }
});

test('mid-flight status set deliberately excludes terminal + pending states', () => {
  const excluded = ['pending', 'completed', 'failed', 'queued', 'cancelled'];
  for (const status of excluded) {
    expect(!(STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES as readonly string[]).includes(status), `should not include: ${status}`).toBeTruthy();
  }
});

test('mid-flight status set rejects historical typo "matching" — reviewer caught this in B1', () => {
  // Belt-and-braces against the original B1 bug. `matching` is a name the
  // pipeline never writes. Including it would shift an entire stage's
  // worker-deaths into the "never reaped" bucket.
  expect(!(STALE_ANALYZER_JOB_MID_FLIGHT_STATUSES as readonly string[]).includes('matching'), 'matching is not a real status — must not appear in the sweep set').toBeTruthy();
});

test('computeStaleAnalyzerJobCutoff: default threshold subtracts 15 min from now', () => {
  const now = Date.parse('2026-04-24T20:00:00.000Z');
  const cutoff = computeStaleAnalyzerJobCutoff({ nowMs: now });
  expect(cutoff.toISOString() === '2026-04-24T19:45:00.000Z', `got ${cutoff.toISOString()}`).toBeTruthy();
});

test('computeStaleAnalyzerJobCutoff: honors custom thresholdMs override', () => {
  const now = Date.parse('2026-04-24T20:00:00.000Z');
  const cutoff = computeStaleAnalyzerJobCutoff({ nowMs: now, thresholdMs: 30 * 60_000 });
  expect(cutoff.toISOString() === '2026-04-24T19:30:00.000Z', `got ${cutoff.toISOString()}`).toBeTruthy();
});

test('computeStaleAnalyzerJobCutoff: thresholdMs of 0 returns now (degenerate but safe)', () => {
  const now = Date.parse('2026-04-24T20:00:00.000Z');
  const cutoff = computeStaleAnalyzerJobCutoff({ nowMs: now, thresholdMs: 0 });
  expect(cutoff.getTime() === now, 'cutoff should equal nowMs when threshold is 0').toBeTruthy();
});

// ---------------------------------------------------------------------------

console.log('');