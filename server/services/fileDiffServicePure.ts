/**
 * fileDiffServicePure.ts — pure diff algorithm for task file versions.
 *
 * No I/O, no side effects. Same (prev, curr) inputs always yield the same hunks.
 *
 * Spec: docs/workflows-dev-spec.md §12.
 * Tests: server/services/__tests__/fileDiffServicePure.test.ts
 */

import { diffLines } from 'diff';

// ─── Hunk interface ───────────────────────────────────────────────────────────

/**
 * A contiguous changed region between two versions of a file.
 *
 * Hunk identity invariant: `(file_id, from_version, hunk_index)` must
 * deterministically resolve to one change set — guaranteed because the diff
 * algorithm is deterministic and hunks are emitted in order.
 */
export interface Hunk {
  /** Zero-based position in the ordered hunk array for this (from, to) pair. */
  index: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  type: 'add' | 'del' | 'change';
  /** Lines from the previous version for this hunk (empty for pure adds). */
  oldContent: string[];
  /** Lines from the new version for this hunk (empty for pure deletions). */
  newContent: string[];
}

// ─── Line diff ────────────────────────────────────────────────────────────────

/**
 * Compute a line-level diff between two text strings.
 * Uses the Myers diff algorithm via the `diff` package.
 *
 * Deterministic: identical inputs always produce identical output.
 */
export function computeLineDiff(prev: string, curr: string): Hunk[] {
  const changes = diffLines(prev, curr, { newlineIsToken: false });

  const hunks: Hunk[] = [];
  let oldLine = 0;
  let newLine = 0;

  // Walk through all change blocks and collapse adjacent changed regions.
  let i = 0;
  while (i < changes.length) {
    const c = changes[i];

    if (!c.added && !c.removed) {
      // Context lines: advance both counters.
      const count = c.count ?? splitLines(c.value).length;
      oldLine += count;
      newLine += count;
      i++;
      continue;
    }

    // Start of a changed region: consume consecutive add/del blocks.
    const oldStart = oldLine;
    const newStart = newLine;
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      const block = changes[i];
      const lines = splitLines(block.value);
      const count = block.count ?? lines.length;
      if (block.removed) {
        oldLines.push(...lines.slice(0, count));
        oldLine += count;
      } else {
        newLines.push(...lines.slice(0, count));
        newLine += count;
      }
      i++;
    }

    const type: Hunk['type'] =
      oldLines.length === 0 ? 'add'
      : newLines.length === 0 ? 'del'
      : 'change';

    hunks.push({
      index: hunks.length,
      oldStart,
      oldEnd: oldLine,
      newStart,
      newEnd: newLine,
      type,
      oldContent: oldLines,
      newContent: newLines,
    });
  }

  return hunks;
}

// ─── Row diff (CSV / spreadsheet) ────────────────────────────────────────────

/**
 * Compute a row-level diff between two tables (2D string arrays).
 *
 * Each row is stringified for comparison so the algorithm stays pure.
 * Returns row-level hunks; cell-level diffing is V2.
 */
export function computeRowDiff(prev: string[][], curr: string[][]): Hunk[] {
  // Convert each row to a canonical line for use with diffLines.
  // Always append a trailing newline so diffLines treats the inputs
  // as uniform "terminated" lines; this prevents a trailing-newline
  // diff from appearing as a 'change' instead of a pure 'add'/'del'.
  const toText = (rows: string[][]): string =>
    rows.length === 0 ? '' : rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  return computeLineDiff(toText(prev), toText(curr));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Split text into lines, discarding a trailing empty element caused by
 * a trailing newline (matches how `diffLines` counts lines).
 */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
