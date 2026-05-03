import { expect, test } from 'vitest';
import { computeWorkflowDraftsCutoff } from '../workflowDraftsCleanupJobPure.js';

test('computeWorkflowDraftsCutoff returns now minus thresholdDays', () => {
  const now = new Date('2026-05-03T03:00:00.000Z').getTime();
  const cutoff = computeWorkflowDraftsCutoff({ nowMs: now, thresholdDays: 7 });
  expect(cutoff.toISOString()).toBe('2026-04-26T03:00:00.000Z');
});

test('computeWorkflowDraftsCutoff — variable threshold', () => {
  const now = new Date('2026-05-03T12:00:00.000Z').getTime();
  const cases = [
    { thresholdDays: 1,  expected: '2026-05-02T12:00:00.000Z' },
    { thresholdDays: 3,  expected: '2026-04-30T12:00:00.000Z' },
    { thresholdDays: 7,  expected: '2026-04-26T12:00:00.000Z' },
    { thresholdDays: 30, expected: '2026-04-03T12:00:00.000Z' },
  ];
  for (const { thresholdDays, expected } of cases) {
    expect(
      computeWorkflowDraftsCutoff({ nowMs: now, thresholdDays }).toISOString(),
      `thresholdDays=${thresholdDays}`,
    ).toBe(expected);
  }
});
