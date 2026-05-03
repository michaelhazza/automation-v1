/**
 * fileRevertHunkServicePure.test.ts
 * Tests for the concurrency-guard decision logic and hunk-match checking
 * using the pure diff helpers extracted from fileRevertHunkService.
 *
 * Run via: npx vitest run server/services/__tests__/fileRevertHunkServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { computeLineDiff, type Hunk } from '../fileDiffServicePure.js';

// ─── Helper: concurrency guard decision ──────────────────────────────────────

/**
 * Pure extraction of the concurrency guard decision:
 * returns 'ok' if currentVersion === fromVersion + 1, else 'base_version_changed'.
 */
function concurrencyGuard(
  fromVersion: number,
  currentVersion: number,
): 'ok' | 'base_version_changed' {
  return currentVersion === fromVersion + 1 ? 'ok' : 'base_version_changed';
}

describe('concurrencyGuard', () => {
  test('returns ok when currentVersion = fromVersion + 1', () => {
    expect(concurrencyGuard(2, 3)).toBe('ok');
  });

  test('returns base_version_changed when currentVersion > fromVersion + 1', () => {
    expect(concurrencyGuard(2, 5)).toBe('base_version_changed');
  });

  test('returns base_version_changed when currentVersion < fromVersion + 1', () => {
    expect(concurrencyGuard(3, 3)).toBe('base_version_changed');
  });

  test('returns base_version_changed when currentVersion === fromVersion', () => {
    expect(concurrencyGuard(5, 5)).toBe('base_version_changed');
  });

  test('returns ok for version 1 -> 2 transition', () => {
    expect(concurrencyGuard(1, 2)).toBe('ok');
  });
});

// ─── Helper: already_absent decision ────────────────────────────────────────

/**
 * Pure extraction of the already_absent check:
 * returns true when the hunk's new content is still present at the expected
 * line range in the current text.
 */
function isHunkStillPresent(
  currText: string,
  hunk: Hunk,
): boolean {
  const lines = currText.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const slice = lines.slice(hunk.newStart, hunk.newEnd);
  if (slice.length !== hunk.newContent.length) return false;
  return slice.every((v, i) => v === hunk.newContent[i]);
}

describe('isHunkStillPresent', () => {
  test('returns true when new content matches current text at expected position', () => {
    const prev = 'line1\nline2\nline3\n';
    const curr = 'line1\nCHANGED\nline3\n';
    const [hunk] = computeLineDiff(prev, curr);
    expect(isHunkStillPresent(curr, hunk)).toBe(true);
  });

  test('returns false when the hunk has already been reverted (old content restored)', () => {
    const prev = 'line1\nold\nline3\n';
    const curr = 'line1\nnew\nline3\n';
    const [hunk] = computeLineDiff(prev, curr);

    // Simulate that another edit already reverted it back to old content.
    const alreadyReverted = prev;
    expect(isHunkStillPresent(alreadyReverted, hunk)).toBe(false);
  });

  test('returns false when content at position has changed to something else', () => {
    const prev = 'a\nb\nc\n';
    const curr = 'a\nBBB\nc\n';
    const [hunk] = computeLineDiff(prev, curr);

    // Another edit changed the same line to something else.
    const furtherEdited = 'a\nXXX\nc\n';
    expect(isHunkStillPresent(furtherEdited, hunk)).toBe(false);
  });

  test('pure add hunk — old content is empty, new content is present', () => {
    const prev = 'a\n';
    const curr = 'a\nnewline\n';
    const hunks = computeLineDiff(prev, curr);
    const addHunk = hunks.find((h) => h.type === 'add');
    expect(addHunk).toBeTruthy();
    expect(isHunkStillPresent(curr, addHunk!)).toBe(true);
  });
});
