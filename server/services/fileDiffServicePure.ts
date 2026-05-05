/**
 * fileDiffServicePure.ts — deterministic line-level diff and hunk revert.
 *
 * No I/O — all functions are pure and safe to unit-test without DB.
 */

export interface DiffHunk {
  hunkIndex: number;
  fromLines: string[]; // removed lines
  toLines: string[];   // added lines
  startLine: number;   // 0-based line in the `from` content
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split content into lines, preserving the trailing empty element produced by
 * a trailing newline (so that round-tripping join/split is stable).
 */
function splitLines(text: string): string[] {
  return text.split('\n');
}

function joinLines(lines: string[]): string {
  return lines.join('\n');
}

/**
 * Compute the longest common subsequence length table for two arrays.
 * Returns a 2-D array `dp` where `dp[i][j]` is the LCS length of
 * `a[0..i-1]` vs `b[0..j-1]`.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

interface EditOp {
  kind: 'equal' | 'remove' | 'insert';
  fromIdx: number; // index in `from` array (for remove/equal)
  toIdx: number;   // index in `to` array (for insert/equal)
  line: string;
}

/**
 * Back-trace the LCS table to produce a flat list of edit operations.
 */
function backTrace(dp: number[][], from: string[], to: string[]): EditOp[] {
  const ops: EditOp[] = [];
  let i = from.length;
  let j = to.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && from[i - 1] === to[j - 1]) {
      ops.push({ kind: 'equal', fromIdx: i - 1, toIdx: j - 1, line: from[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ kind: 'insert', fromIdx: i, toIdx: j - 1, line: to[j - 1] });
      j--;
    } else {
      ops.push({ kind: 'remove', fromIdx: i - 1, toIdx: j, line: from[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute hunks between two text strings (line-level diff).
 * Deterministic: same (from, to) pair always produces the same hunk array.
 * Adjacent changed lines are grouped into a single hunk.
 */
export function computeHunks(from: string, to: string): DiffHunk[] {
  const fromLines = splitLines(from);
  const toLines = splitLines(to);
  const dp = lcsTable(fromLines, toLines);
  const ops = backTrace(dp, fromLines, toLines);

  const hunks: DiffHunk[] = [];
  let hunkIndex = 0;
  let i = 0;

  while (i < ops.length) {
    if (ops[i].kind === 'equal') {
      i++;
      continue;
    }
    // Start of a changed region — collect consecutive non-equal ops.
    const startLine = ops[i].fromIdx;
    const removedLines: string[] = [];
    const insertedLines: string[] = [];
    while (i < ops.length && ops[i].kind !== 'equal') {
      if (ops[i].kind === 'remove') {
        removedLines.push(ops[i].line);
      } else {
        insertedLines.push(ops[i].line);
      }
      i++;
    }
    hunks.push({
      hunkIndex,
      fromLines: removedLines,
      toLines: insertedLines,
      startLine,
    });
    hunkIndex++;
  }

  return hunks;
}

/**
 * Apply the INVERSE of hunk at hunkIndex to `to` content.
 * Returns new content with that hunk reverted.
 * Returns null if the hunk is no longer present in `to` (already_absent).
 */
export function applyRevertHunk(to: string, hunks: DiffHunk[], hunkIndex: number): string | null {
  const hunk = hunks.find(h => h.hunkIndex === hunkIndex);
  if (!hunk) return null;

  const toLines = splitLines(to);

  // Find the position of the hunk's toLines in the current `to` content.
  // The hunk's toLines are what was added — we need to locate them in `to`.
  // We search for the first occurrence of toLines as a contiguous block.
  const { toLines: hunkToLines, fromLines: hunkFromLines } = hunk;

  if (hunkToLines.length === 0 && hunkFromLines.length === 0) {
    // Degenerate hunk — nothing to revert.
    return null;
  }

  // If the hunk added lines (toLines), find them in `to`.
  // If the hunk only removed lines (toLines empty), find the insertion point
  // where fromLines should be re-inserted.
  if (hunkToLines.length > 0) {
    // Find the first position in toLines where hunkToLines matches contiguously.
    const pos = findSubsequence(toLines, hunkToLines);
    if (pos === -1) {
      // The added lines are no longer present — already_absent.
      return null;
    }
    const rebuilt = [
      ...toLines.slice(0, pos),
      ...hunkFromLines,
      ...toLines.slice(pos + hunkToLines.length),
    ];
    return joinLines(rebuilt);
  } else {
    // Pure-delete hunk: re-insert fromLines at the correct position in `to`.
    // Because the concurrency guard ensures `to` is exactly version fromVersion+1,
    // the startLine position relative to `to` is stable:
    // each preceding hunk shifts the position by (toLines.length - fromLines.length).
    // For the simple case (no preceding hunks), startLine is the insertion point.
    // For multi-hunk diffs, accumulate the delta from preceding hunks.
    const precedingHunks = hunks.filter(h => h.hunkIndex < hunk.hunkIndex);
    const delta = precedingHunks.reduce((acc, h) => acc + h.toLines.length - h.fromLines.length, 0);
    const insertAt = hunk.startLine + delta;
    const clampedInsertAt = Math.max(0, Math.min(insertAt, toLines.length));
    const rebuilt = [
      ...toLines.slice(0, clampedInsertAt),
      ...hunkFromLines,
      ...toLines.slice(clampedInsertAt),
    ];
    return joinLines(rebuilt);
  }
}

/**
 * Find the start index of `needle` as a contiguous subsequence in `haystack`.
 * Returns -1 if not found.
 */
function findSubsequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}
