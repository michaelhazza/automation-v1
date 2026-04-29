import { expect, test } from 'vitest';
import { computeInflightHistoryCutoff } from '../llmInflightHistoryCleanupJobPure.js';

test('computeInflightHistoryCutoff = now - retentionDays', () => {
  const now = new Date('2026-04-21T12:00:00.000Z').getTime();
  const cutoff = computeInflightHistoryCutoff({ nowMs: now, retentionDays: 7 });
  expect(cutoff.toISOString()).toBe('2026-04-14T12:00:00.000Z');
});

test('computeInflightHistoryCutoff — variable retention window', () => {
  const now = new Date('2026-04-21T12:00:00.000Z').getTime();
  const cases = [
    { retentionDays: 1,  expected: '2026-04-20T12:00:00.000Z' },
    { retentionDays: 3,  expected: '2026-04-18T12:00:00.000Z' },
    { retentionDays: 30, expected: '2026-03-22T12:00:00.000Z' },
  ];
  for (const { retentionDays, expected } of cases) {
    expect(
      computeInflightHistoryCutoff({ nowMs: now, retentionDays }).toISOString(),
      `retentionDays=${retentionDays}`,
    ).toBe(expected);
  }
});
