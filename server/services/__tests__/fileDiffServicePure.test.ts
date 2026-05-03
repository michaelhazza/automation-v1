/**
 * fileDiffServicePure.test.ts
 * Determinism and correctness tests for the file diff algorithm.
 * Run via: npx vitest run server/services/__tests__/fileDiffServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { computeLineDiff, computeRowDiff, type Hunk } from '../fileDiffServicePure.js';

// ─── computeLineDiff ─────────────────────────────────────────────────────────

describe('computeLineDiff', () => {
  test('identical strings produce no hunks', () => {
    const hunks = computeLineDiff('hello\nworld\n', 'hello\nworld\n');
    expect(hunks).toHaveLength(0);
  });

  test('pure addition — add lines at end', () => {
    const hunks = computeLineDiff('line1\n', 'line1\nline2\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].newContent).toContain('line2');
    expect(hunks[0].oldContent).toHaveLength(0);
  });

  test('pure deletion — remove lines', () => {
    const hunks = computeLineDiff('line1\nline2\n', 'line1\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('del');
    expect(hunks[0].oldContent).toContain('line2');
    expect(hunks[0].newContent).toHaveLength(0);
  });

  test('change — replace a line', () => {
    const hunks = computeLineDiff('line1\nold\nline3\n', 'line1\nnew\nline3\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('change');
    expect(hunks[0].oldContent).toContain('old');
    expect(hunks[0].newContent).toContain('new');
  });

  test('multiple hunks are indexed correctly', () => {
    const prev = 'a\nb\nc\nd\n';
    const curr = 'A\nb\nC\nd\n';
    const hunks = computeLineDiff(prev, curr);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    hunks.forEach((h, i) => {
      expect(h.index).toBe(i);
    });
  });

  test('deterministic — same inputs yield same hunks on repeated calls', () => {
    const prev = 'first line\nsecond line\nthird line\n';
    const curr = 'first line\nchanged line\nthird line\nfourth line\n';
    const result1 = computeLineDiff(prev, curr);
    const result2 = computeLineDiff(prev, curr);
    expect(result1).toEqual(result2);
  });

  test('empty prev produces a single add hunk', () => {
    const hunks = computeLineDiff('', 'new content\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
  });

  test('empty curr produces a single del hunk', () => {
    const hunks = computeLineDiff('old content\n', '');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('del');
  });

  test('oldStart / oldEnd / newStart / newEnd are non-negative integers', () => {
    const hunks = computeLineDiff('a\nb\n', 'a\nc\n');
    for (const h of hunks) {
      expect(h.oldStart).toBeGreaterThanOrEqual(0);
      expect(h.oldEnd).toBeGreaterThanOrEqual(h.oldStart);
      expect(h.newStart).toBeGreaterThanOrEqual(0);
      expect(h.newEnd).toBeGreaterThanOrEqual(h.newStart);
    }
  });
});

// ─── computeRowDiff ──────────────────────────────────────────────────────────

describe('computeRowDiff', () => {
  test('identical tables produce no hunks', () => {
    const table = [['Name', 'Value'], ['Alice', '10']];
    const hunks = computeRowDiff(table, table);
    expect(hunks).toHaveLength(0);
  });

  test('added row is detected', () => {
    const prev = [['Name', 'Value'], ['Alice', '10']];
    const curr = [['Name', 'Value'], ['Alice', '10'], ['Bob', '20']];
    const hunks = computeRowDiff(prev, curr);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
  });

  test('changed cell in a row is detected as a row-level change', () => {
    const prev = [['Alice', '10']];
    const curr = [['Alice', '20']];
    const hunks = computeRowDiff(prev, curr);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('change');
  });

  test('deterministic for row diff', () => {
    const prev = [['a', 'b'], ['c', 'd']];
    const curr = [['a', 'b'], ['x', 'y']];
    expect(computeRowDiff(prev, curr)).toEqual(computeRowDiff(prev, curr));
  });

  test('empty prev row array produces add hunk', () => {
    const hunks = computeRowDiff([], [['a', 'b']]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
  });
});

// ─── Hunk index invariant ─────────────────────────────────────────────────────

describe('hunk index invariant', () => {
  test('hunk.index equals position in returned array', () => {
    const hunks: Hunk[] = computeLineDiff(
      'a\nb\nc\nd\ne\n',
      'A\nb\nC\nd\nE\n',
    );
    hunks.forEach((h, i) => {
      expect(h.index).toBe(i);
    });
  });
});
