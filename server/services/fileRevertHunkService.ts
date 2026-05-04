/**
 * fileRevertHunkService.ts — per-hunk revert against a reference document version.
 *
 * Spec: tasks/builds/workflows-v1-phase-2 Chunk 13.
 */

import * as referenceDocumentService from './referenceDocumentService.js';
import { computeHunks, applyRevertHunk } from './fileDiffServicePure.js';
import { appendAndEmitTaskEvent } from './taskEventService.js';

export const fileRevertHunkService = {
  async revertHunk(params: {
    taskId: string;
    fileId: string;
    fromVersion: number;
    hunkIndex: number;
    organisationId: string;
    userId: string;
  }): Promise<
    | { reverted: true; newVersion: number }
    | { reverted: false; reason: 'already_absent' }
  > {
    const { taskId, fileId, fromVersion, hunkIndex, organisationId, userId } = params;

    // 1. Verify org owns the file.
    const result = await referenceDocumentService.getByIdWithCurrentVersion(fileId, organisationId);
    if (!result) {
      throw { statusCode: 404, error: 'file_not_found' };
    }
    const { doc } = result;

    // 2. Concurrency guard — current version must be fromVersion + 1.
    const expectedCurrentVersion = fromVersion + 1;
    if (doc.currentVersion !== expectedCurrentVersion) {
      throw {
        statusCode: 409,
        error: 'base_version_changed',
        current_version: doc.currentVersion,
      };
    }

    // 3. Load the two adjacent versions.
    const [fromRow, toRow] = await Promise.all([
      referenceDocumentService.getVersion(fileId, organisationId, fromVersion),
      referenceDocumentService.getVersion(fileId, organisationId, expectedCurrentVersion),
    ]);

    if (!fromRow || !toRow) {
      throw { statusCode: 404, error: 'version_not_found' };
    }

    // 4. Compute hunks.
    const hunks = computeHunks(fromRow.content, toRow.content);

    // 5. Apply revert.
    const revertedContent = applyRevertHunk(toRow.content, hunks, hunkIndex);
    if (revertedContent === null) {
      return { reverted: false, reason: 'already_absent' };
    }

    // 6. Create new version.
    const newVersionRow = await referenceDocumentService.updateContent({
      documentId: fileId,
      organisationId,
      content: revertedContent,
      updatedByUserId: userId,
      notes: 'hunk revert',
    });

    // 7. Emit file.edited task event.
    void appendAndEmitTaskEvent(taskId, Date.now(), 0, 'user', {
      kind: 'file.edited',
      payload: {
        fileId,
        priorVersion: expectedCurrentVersion,
        newVersion: newVersionRow.version,
        editRequest: `hunk revert: hunk ${hunkIndex} of v${fromVersion}..v${expectedCurrentVersion}`,
      },
    });

    // 8. Return result.
    return { reverted: true, newVersion: newVersionRow.version };
  },
};
