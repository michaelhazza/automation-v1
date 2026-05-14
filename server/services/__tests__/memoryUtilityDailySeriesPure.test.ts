import { describe, test, expect } from 'vitest';
import {
  bucketDailySeries,
  type RunForBucketing,
} from '../memoryUtilityDailySeriesPure.js';

const NOW = new Date('2026-05-13T12:00:00.000Z'); // Wednesday noon UTC

function makeRun(overrides: Partial<RunForBucketing> = {}): RunForBucketing {
  return {
    id: 'run-001',
    createdAt: new Date('2026-05-13T10:00:00.000Z'),
    injectedEntryIds: ['e1'],
    citedEntryIds: ['e1'],
    appliedMemoryBlockIds: ['b1'],
    appliedMemoryBlockCitations: [{}],
    ...overrides,
  };
}

describe('bucketDailySeries', () => {
  test('always returns exactly 30 buckets ordered oldest to newest', () => {
    const result = bucketDailySeries([], NOW);
    expect(result).toHaveLength(30);
    expect(result[0].bucketDate).toBe('2026-04-14');  // now - 29 days
    expect(result[29].bucketDate).toBe('2026-05-13'); // today
    // Check ordering
    for (let i = 1; i < result.length; i++) {
      expect(result[i].bucketDate > result[i - 1].bucketDate).toBe(true);
    }
  });

  test('UTC bucket boundary at midnight — run at 23:59:59.999Z lands in same day', () => {
    const runEndOfDay = makeRun({
      createdAt: new Date('2026-05-12T23:59:59.999Z'),
      injectedEntryIds: ['e1'],
      citedEntryIds: ['e1'],
    });
    const runStartOfNext = makeRun({
      id: 'run-002',
      createdAt: new Date('2026-05-13T00:00:00.000Z'),
      injectedEntryIds: ['e2'],
      citedEntryIds: [],
    });
    const result = bucketDailySeries([runEndOfDay, runStartOfNext], NOW);
    const may12 = result.find((b) => b.bucketDate === '2026-05-12')!;
    const may13 = result.find((b) => b.bucketDate === '2026-05-13')!;
    expect(may12.runsMeasuredEntries).toBe(1);
    expect(may12.entryUtility).toBe(1.0);
    expect(may13.runsMeasuredEntries).toBe(1);
    expect(may13.entryUtility).toBe(0); // 0 cited / 1 injected
  });

  test('zero-measured-run bucket returns entryUtility: null', () => {
    const run = makeRun({
      injectedEntryIds: null, // unmeasured
      appliedMemoryBlockIds: [],
      appliedMemoryBlockCitations: [],
    });
    const result = bucketDailySeries([run], NOW);
    const today = result.find((b) => b.bucketDate === '2026-05-13')!;
    expect(today.runsMeasuredEntries).toBe(0);
    expect(today.entryUtility).toBeNull();
    expect(today.blockUtility).toBeNull();
  });

  test('mixed measured/unmeasured bucket — only measured rows count for entryUtility', () => {
    const unmeasured = makeRun({ injectedEntryIds: null, citedEntryIds: [] });
    const measuredEmpty = makeRun({ id: 'r2', injectedEntryIds: [], citedEntryIds: [] });
    const measuredWithEntry = makeRun({
      id: 'r3',
      injectedEntryIds: ['a'],
      citedEntryIds: ['a'],
    });
    const result = bucketDailySeries([unmeasured, measuredEmpty, measuredWithEntry], NOW);
    const today = result.find((b) => b.bucketDate === '2026-05-13')!;
    expect(today.runsMeasuredEntries).toBe(2); // measuredEmpty + measuredWithEntry
    // totalInjected = 0 + 1 = 1; totalCited = 0 + 1 = 1 → entryUtility = 1.0
    expect(today.entryUtility).toBe(1.0);
  });

  test('block-side denominator-zero returns blockUtility: null', () => {
    const run = makeRun({
      appliedMemoryBlockIds: [],
      appliedMemoryBlockCitations: [],
    });
    const result = bucketDailySeries([run], NOW);
    const today = result.find((b) => b.bucketDate === '2026-05-13')!;
    expect(today.blockUtility).toBeNull();
  });

  test('30-bucket gap-fill — days without runs carry null utilities', () => {
    const run = makeRun({ createdAt: new Date('2026-05-01T06:00:00Z') });
    const result = bucketDailySeries([run], NOW);
    expect(result).toHaveLength(30);
    const may1 = result.find((b) => b.bucketDate === '2026-05-01')!;
    expect(may1.runsMeasuredEntries).toBe(1);
    const emptyDays = result.filter((b) => b.bucketDate !== '2026-05-01');
    for (const d of emptyDays) {
      expect(d.runsMeasuredEntries).toBe(0);
      expect(d.entryUtility).toBeNull();
      expect(d.blockUtility).toBeNull();
    }
  });

  test('denominator-zero within measured runs — injectedEntryIds:[] → entryUtility: null', () => {
    const run = makeRun({ injectedEntryIds: [], citedEntryIds: [] });
    const result = bucketDailySeries([run], NOW);
    const today = result.find((b) => b.bucketDate === '2026-05-13')!;
    expect(today.runsMeasuredEntries).toBe(1);
    expect(today.entryUtility).toBeNull(); // sum(injected) === 0
  });

  test('determinism under input reordering — three shuffles yield identical output', () => {
    const runs = [
      makeRun({ id: 'a', injectedEntryIds: ['x'], citedEntryIds: ['x'] }),
      makeRun({ id: 'b', createdAt: new Date('2026-05-12T10:00:00Z'), injectedEntryIds: null }),
      makeRun({ id: 'c', injectedEntryIds: ['y', 'z'], citedEntryIds: ['y'] }),
    ];
    const r1 = bucketDailySeries([...runs], NOW);
    const r2 = bucketDailySeries([runs[2], runs[0], runs[1]], NOW);
    const r3 = bucketDailySeries([runs[1], runs[2], runs[0]], NOW);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
  });
});
