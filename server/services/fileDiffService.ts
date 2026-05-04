/**
 * fileDiffService.ts — I/O wrapper around fileDiffServicePure.
 *
 * Fetches two adjacent versions from the DB and delegates diff computation
 * to the pure layer.
 */

import * as referenceDocumentService from './referenceDocumentService.js';
import { computeHunks } from './fileDiffServicePure.js';
import type { DiffHunk } from './fileDiffServicePure.js';

export type { DiffHunk };

export const fileDiffService = {
  /**
   * Compute a diff between version `fromVersion` and `fromVersion + 1` of a file.
   *
   * Returns null if either version does not exist.
   */
  async computeDiff(
    fileId: string,
    fromVersion: number,
    organisationId: string,
  ): Promise<{ hunks: DiffHunk[]; from: string; to: string } | null> {
    const [fromRow, toRow] = await Promise.all([
      referenceDocumentService.getVersion(fileId, organisationId, fromVersion),
      referenceDocumentService.getVersion(fileId, organisationId, fromVersion + 1),
    ]);

    if (!fromRow || !toRow) return null;

    const from = fromRow.content;
    const to = toRow.content;
    const hunks = computeHunks(from, to);

    return { hunks, from, to };
  },
};
