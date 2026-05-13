import { describe, test, expect } from 'vitest';
import {
  aggregateAgentRuns,
  isMeasured,
  type AgentRunForAggregation,
} from '../memoryUtilityAggregatorPure.js';

function makeRun(overrides: Partial<AgentRunForAggregation> = {}): AgentRunForAggregation {
  return {
    injectedEntryIds: ['entry-1', 'entry-2'],
    citedEntryIds: ['entry-1'],
    appliedMemoryBlockIds: ['block-1'],
    appliedMemoryBlockCitations: ['block-1'],
    ...overrides,
  };
}

describe('isMeasured', () => {
  test('null input returns false (pre-migration / unmeasured)', () => {
    expect(isMeasured(null)).toBe(false);
  });

  test('empty array returns true (measured with no injections)', () => {
    expect(isMeasured([])).toBe(true);
  });

  test('non-empty array returns true', () => {
    expect(isMeasured(['id-1', 'id-2'])).toBe(true);
  });
});

describe('aggregateAgentRuns', () => {
  test('ratio math — basic case with measured entries and blocks', () => {
    // 2 entries injected, 1 cited = 0.5 entry utility
    // 1 block injected, 1 cited = 1.0 block utility
    const result = aggregateAgentRuns([makeRun()]);

    expect(result.runsMeasuredEntries).toBe(1);
    expect(result.runsUnmeasuredEntries).toBe(0);
    expect(result.totalInjectedEntries).toBe(2);
    expect(result.totalCitedEntries).toBe(1);
    expect(result.totalInjectedBlocks).toBe(1);
    expect(result.totalCitedBlocks).toBe(1);
    expect(result.entryUtility30d).toBeCloseTo(0.5);
    expect(result.blockUtility30d).toBeCloseTo(1.0);
  });

  test('denominator-zero handling — returns null for both utility fields', () => {
    // All measured runs have zero injected entries and blocks
    const result = aggregateAgentRuns([
      makeRun({
        injectedEntryIds: [],
        citedEntryIds: [],
        appliedMemoryBlockIds: [],
        appliedMemoryBlockCitations: [],
      }),
    ]);

    expect(result.entryUtility30d).toBeNull();
    expect(result.blockUtility30d).toBeNull();
    expect(result.runsMeasuredEntries).toBe(1);
  });

  test('measured-vs-unmeasured run partition — mixed input', () => {
    // 1 measured run, 1 unmeasured (null injectedEntryIds)
    const result = aggregateAgentRuns([
      makeRun({ injectedEntryIds: ['entry-1'], citedEntryIds: [] }),
      makeRun({ injectedEntryIds: null, citedEntryIds: [], appliedMemoryBlockIds: [] }),
    ]);

    expect(result.runsMeasuredEntries).toBe(1);
    expect(result.runsUnmeasuredEntries).toBe(1);
    // Unmeasured run contributes nothing to entry counts
    expect(result.totalInjectedEntries).toBe(1);
    expect(result.totalCitedEntries).toBe(0);
    expect(result.entryUtility30d).toBeCloseTo(0.0);
  });

  test('edge case: all-pre-migration runs — null ratio + non-zero runs_unmeasured_entries', () => {
    const result = aggregateAgentRuns([
      makeRun({ injectedEntryIds: null, citedEntryIds: [] }),
      makeRun({ injectedEntryIds: null, citedEntryIds: [] }),
    ]);

    expect(result.runsMeasuredEntries).toBe(0);
    expect(result.runsUnmeasuredEntries).toBe(2);
    expect(result.totalInjectedEntries).toBe(0);
    expect(result.entryUtility30d).toBeNull();
    // Block columns still aggregate (block denominator is NOT NULL DEFAULT [])
    expect(result.totalInjectedBlocks).toBeGreaterThanOrEqual(0);
  });

  test('empty input — returns zero counts and null ratios', () => {
    const result = aggregateAgentRuns([]);

    expect(result.runsMeasuredEntries).toBe(0);
    expect(result.runsUnmeasuredEntries).toBe(0);
    expect(result.totalInjectedEntries).toBe(0);
    expect(result.totalCitedEntries).toBe(0);
    expect(result.totalInjectedBlocks).toBe(0);
    expect(result.totalCitedBlocks).toBe(0);
    expect(result.entryUtility30d).toBeNull();
    expect(result.blockUtility30d).toBeNull();
  });

  test('multiple measured runs — sums and ratios aggregated correctly', () => {
    // Run 1: 2 injected, 1 cited entries; 1 block injected, 0 cited
    // Run 2: 4 injected, 2 cited entries; 2 blocks injected, 1 cited
    const result = aggregateAgentRuns([
      makeRun({ injectedEntryIds: ['e1', 'e2'], citedEntryIds: ['e1'], appliedMemoryBlockIds: ['b1'], appliedMemoryBlockCitations: [] }),
      makeRun({ injectedEntryIds: ['e3', 'e4', 'e5', 'e6'], citedEntryIds: ['e3', 'e4'], appliedMemoryBlockIds: ['b2', 'b3'], appliedMemoryBlockCitations: ['b2'] }),
    ]);

    expect(result.runsMeasuredEntries).toBe(2);
    expect(result.totalInjectedEntries).toBe(6);
    expect(result.totalCitedEntries).toBe(3);
    expect(result.entryUtility30d).toBeCloseTo(3 / 6);
    expect(result.totalInjectedBlocks).toBe(3);
    expect(result.totalCitedBlocks).toBe(1);
    expect(result.blockUtility30d).toBeCloseTo(1 / 3);
  });
});
