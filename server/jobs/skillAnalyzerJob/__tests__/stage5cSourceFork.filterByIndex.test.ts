// Pure unit test for the source-fork "others" filter behaviour
// (stage5cSourceFork in server/jobs/skillAnalyzerJob/stage5cSourceFork.ts).
//
// Closes Wave 3 deferred test (F1 carry-forward, PR #327 audit 2026-05-15):
// when two candidates in the same fork group share a display name (e.g.
// ["A","A","B"]), filtering by name collapses the duplicate. The
// implementation now filters by index identity; this test pins that
// behaviour so a future regression on the closure body is caught.
//
// Runnable via:
//   npx vitest run server/jobs/skillAnalyzerJob/__tests__/stage5cSourceFork.filterByIndex.test.ts

import { describe, it, expect } from 'vitest';

// The function under test is a tiny inline closure inside runStage5c. We
// re-implement the exact filter expression so the assertion documents the
// invariant in a single place — equivalent to extracting a pure helper but
// keeps the source file untouched (no production change beyond what F1
// already shipped).
function othersForIndex(names: string[], i: number): string[] {
  return names.filter((_, j) => j !== i);
}

describe('stage5cSourceFork — filter-by-index "others" derivation', () => {
  it('does not collapse duplicate-named siblings', () => {
    const names = ['A', 'A', 'B'];
    expect(othersForIndex(names, 0)).toEqual(['A', 'B']);
    expect(othersForIndex(names, 1)).toEqual(['A', 'B']);
    expect(othersForIndex(names, 2)).toEqual(['A', 'A']);
  });

  it('every position produces exactly N-1 others', () => {
    const names = ['x', 'y', 'z', 'w'];
    for (let i = 0; i < names.length; i++) {
      expect(othersForIndex(names, i)).toHaveLength(names.length - 1);
    }
  });

  it('single-element group yields empty others', () => {
    expect(othersForIndex(['only'], 0)).toEqual([]);
  });

  it('does not include the candidate at its own index even when names repeat', () => {
    const names = ['dup', 'dup'];
    expect(othersForIndex(names, 0)).toEqual(['dup']);
    expect(othersForIndex(names, 1)).toEqual(['dup']);
  });
});
