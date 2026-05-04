/**
 * fileDiffServicePure.test.ts — Pure diff/revert logic tests.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/fileDiffServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { computeHunks, applyRevertHunk } from '../fileDiffServicePure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeHunks', () => {
  test('1. empty → multi-line: all lines are one hunk with empty fromLines', () => {
    const from = '';
    const to = 'line1\nline2\nline3';
    const hunks = computeHunks(from, to);

    assertEqual(hunks.length, 1, 'should have exactly one hunk');
    assertEqual(hunks[0].hunkIndex, 0, 'hunkIndex');
    assertEqual(hunks[0].fromLines, [''], 'fromLines (empty string splits to [""]');
    // The empty string splits into [''] so it IS one remove + insert scenario.
    // Actually from='' → splitLines → [''], to='line1\nline2\nline3' → ['line1','line2','line3']
    // The single empty string is replaced by 3 lines → one hunk.
    assertEqual(hunks[0].toLines, ['line1', 'line2', 'line3'], 'toLines');
  });

  test('2. same content: no hunks', () => {
    const content = 'alpha\nbeta\ngamma';
    const hunks = computeHunks(content, content);
    assertEqual(hunks.length, 0, 'no hunks for identical content');
  });

  test('3. single line change: one hunk with exactly those lines', () => {
    const from = 'hello world\nfoo bar\nbaz qux';
    const to = 'hello world\nFOO BAR\nbaz qux';
    const hunks = computeHunks(from, to);

    assertEqual(hunks.length, 1, 'one hunk');
    assertEqual(hunks[0].fromLines, ['foo bar'], 'fromLines');
    assertEqual(hunks[0].toLines, ['FOO BAR'], 'toLines');
  });

  test('4. multiple non-adjacent changes: two separate hunks', () => {
    const from = 'a\nb\nc\nd\ne';
    const to = 'A\nb\nc\nd\nE';
    const hunks = computeHunks(from, to);

    assertEqual(hunks.length, 2, 'two hunks for non-adjacent changes');
    assertEqual(hunks[0].fromLines, ['a'], 'first hunk fromLines');
    assertEqual(hunks[0].toLines, ['A'], 'first hunk toLines');
    assertEqual(hunks[1].fromLines, ['e'], 'second hunk fromLines');
    assertEqual(hunks[1].toLines, ['E'], 'second hunk toLines');
  });

  test('5. revert hunk brings back original', () => {
    const original = 'line1\nline2\nline3';
    const modified = 'line1\nMODIFIED\nline3';

    const hunks = computeHunks(original, modified);
    assertEqual(hunks.length, 1, 'one hunk');

    const reverted = applyRevertHunk(modified, hunks, 0);
    assertEqual(reverted, original, 'revert brings back original content');
  });
});

describe('applyRevertHunk', () => {
  test('returns null for unknown hunkIndex', () => {
    const from = 'a\nb';
    const to = 'a\nB';
    const hunks = computeHunks(from, to);
    const result = applyRevertHunk(to, hunks, 99);
    assertEqual(result, null, 'unknown hunkIndex → null');
  });

  test('returns null when hunk lines are already absent (already_absent)', () => {
    const from = 'a\nb\nc';
    const to = 'a\nB\nc';
    const hunks = computeHunks(from, to);

    // Apply the revert once — succeeds
    const reverted = applyRevertHunk(to, hunks, 0);
    if (reverted !== from) {
      throw new Error(`First revert failed: got ${reverted}`);
    }

    // Apply the same hunk to the already-reverted content — the toLines ('B')
    // are no longer present so it should return null.
    const secondRevert = applyRevertHunk(reverted!, hunks, 0);
    assertEqual(secondRevert, null, 'second revert on already-reverted content → null');
  });
});

console.log('All fileDiffServicePure tests passed.');
