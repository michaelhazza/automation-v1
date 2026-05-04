/**
 * filesTabPure.ts — pure classification, filter, and sort logic for the Files tab.
 *
 * No React, no I/O — safe to unit-test in isolation.
 */

import type { FileProjection } from '../../../../shared/types/taskProjection';

export type FileGroup = 'outputs' | 'references' | 'versions';
export type SortOrder = 'recent' | 'oldest' | 'type' | 'author';

/**
 * V1 classification:
 * - 'versions' = file has currentVersion > 1 (has been edited at least once)
 * - 'outputs'  = file with currentVersion === 1
 * - 'references' is reserved for V2
 */
export function classifyFile(f: FileProjection): FileGroup {
  return f.currentVersion > 1 ? 'versions' : 'outputs';
}

export function filterFiles(
  files: FileProjection[],
  group: FileGroup,
  latestOnly: boolean,
  search: string,
): FileProjection[] {
  let result = files.filter(f => classifyFile(f) === group);

  if (latestOnly && group === 'versions') {
    // In V1 each fileId is unique in the projection — latestOnly is a no-op here
    // but the toggle is shown so users can filter to just the most-recent version
    // once multi-version listing is supported. For now pass-through.
    // No-op: projection already holds one entry per fileId (the current version).
  }

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter(f => f.fileId.toLowerCase().includes(q));
  }

  return result;
}

export function sortFiles(files: FileProjection[], order: SortOrder): FileProjection[] {
  const copy = [...files];
  switch (order) {
    case 'recent':
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'oldest':
      return copy.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    case 'type':
      // All are documents in V1 — fall back to fileId alphabetical
      return copy.sort((a, b) => a.fileId.localeCompare(b.fileId));
    case 'author':
      return copy.sort((a, b) => a.producerAgentId.localeCompare(b.producerAgentId));
    default:
      return copy;
  }
}
