import { expect, test } from 'vitest';
import {
  STARTED_ROW_SWEEP_BUFFER_MS,
  computeStartedRowSweepCutoff,
} from '../llmStartedRowSweepJobPure.js';

// ---------------------------------------------------------------------------
// Pins the sweep cutoff contract for `maintenance:llm-started-row-sweep`.
// Deferred-items brief §1: the in-memory in-flight registry reaps 30s past
// providerTimeoutMs; the DB row reaps 60s past providerTimeoutMs. The
// difference ensures the success-path upsert always has room to land
// before the DB sweep touches the row.
// ---------------------------------------------------------------------------

test('STARTED_ROW_SWEEP_BUFFER_MS is 60 seconds (telescopes with registry 30s)', () => {
  expect(STARTED_ROW_SWEEP_BUFFER_MS).toBe(60_000);
});

test('computeStartedRowSweepCutoff = now - (providerTimeoutMs + buffer)', () => {
  const now = new Date('2026-04-21T12:00:00.000Z').getTime();
  const cutoff = computeStartedRowSweepCutoff({
    nowMs:             now,
    providerTimeoutMs: 600_000,   // 10 min
  });
  // 600_000 + 60_000 = 660_000 ms = 11 min before `now`
  expect(cutoff.toISOString()).toBe('2026-04-21T11:49:00.000Z');
});

test('computeStartedRowSweepCutoff — variable providerTimeoutMs', () => {
  const now = new Date('2026-04-21T12:00:00.000Z').getTime();
  const cases = [
    { providerTimeoutMs: 30_000,  expected: '2026-04-21T11:58:30.000Z' }, // 90s before
    { providerTimeoutMs: 120_000, expected: '2026-04-21T11:57:00.000Z' }, // 180s before
    { providerTimeoutMs: 300_000, expected: '2026-04-21T11:54:00.000Z' }, // 360s before
  ];
  for (const { providerTimeoutMs, expected } of cases) {
    const cutoff = computeStartedRowSweepCutoff({ nowMs: now, providerTimeoutMs });
    expect(cutoff.toISOString()).toBe(expected, `providerTimeoutMs=${providerTimeoutMs}`);
  }
});
