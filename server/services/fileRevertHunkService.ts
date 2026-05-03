/**
 * fileRevertHunkService.ts — per-hunk revert for task deliverable versions.
 *
 * Atomically reverts a single hunk in the current version of a deliverable,
 * creating a new version row. Guards against stale-base reverts.
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { taskDeliverableVersions, taskDeliverables } from '../db/schema/index.js';
import { TaskEventService } from './taskEventService.js';
import { computeLineDiff } from './fileDiffServicePure.js';
import { logger } from '../lib/logger.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RevertHunkInput {
  taskId: string;
  fileId: string;
  fromVersion: number;
  hunkIndex: number;
  organisationId: string;
  callerUserId: string;
}

export type RevertHunkResult =
  | { reverted: true; newVersion: number }
  | { reverted: false; reason: 'already_absent' | 'base_version_changed'; currentVersion?: number };

// ─── Service ─────────────────────────────────────────────────────────────────

export const fileRevertHunkService = {
  /**
   * Revert a single diff hunk in a task deliverable.
   *
   * Concurrency guard: if the current version is not `fromVersion + 1`,
   * the base has changed and we return `base_version_changed`.
   *
   * If the hunk's old content no longer matches what is at the corresponding
   * line range in the current version, we return `already_absent` (the
   * change was already undone or overwritten).
   *
   * On success: inserts a new version row inside a transaction, emits a
   * `file.edited` task event via the deferred-emit pattern.
   */
  async revertHunk(input: RevertHunkInput): Promise<RevertHunkResult> {
    const {
      taskId, fileId, fromVersion, hunkIndex, organisationId, callerUserId,
    } = input;

    // ── 1. Verify the deliverable belongs to this org ─────────────────────
    const [deliverable] = await db
      .select({ id: taskDeliverables.id })
      .from(taskDeliverables)
      .where(
        and(
          eq(taskDeliverables.id, fileId),
          eq(taskDeliverables.organisationId, organisationId),
        ),
      )
      .limit(1);

    if (!deliverable) {
      throw { statusCode: 404, message: 'File not found' };
    }

    // ── 2. Load current version ───────────────────────────────────────────
    const [currentRow] = await db
      .select({ version: taskDeliverableVersions.version, bodyText: taskDeliverableVersions.bodyText })
      .from(taskDeliverableVersions)
      .where(
        and(
          eq(taskDeliverableVersions.deliverableId, fileId),
          eq(taskDeliverableVersions.organisationId, organisationId),
        ),
      )
      .orderBy(desc(taskDeliverableVersions.version))
      .limit(1);

    const currentVersion = currentRow?.version ?? 0;

    // ── 3. Concurrency guard ──────────────────────────────────────────────
    // The expected state: current version is exactly fromVersion + 1.
    // If it differs, another edit was made between the client's last load
    // and this request.
    if (currentVersion !== fromVersion + 1) {
      return { reverted: false, reason: 'base_version_changed', currentVersion };
    }

    // ── 4. Load the fromVersion row to compute diff ───────────────────────
    const [fromRow] = await db
      .select({ bodyText: taskDeliverableVersions.bodyText })
      .from(taskDeliverableVersions)
      .where(
        and(
          eq(taskDeliverableVersions.deliverableId, fileId),
          eq(taskDeliverableVersions.version, fromVersion),
          eq(taskDeliverableVersions.organisationId, organisationId),
        ),
      )
      .limit(1);

    if (!fromRow) {
      throw { statusCode: 404, message: 'Base version not found' };
    }

    const prevText = fromRow.bodyText;
    const currText = currentRow!.bodyText;

    // ── 5. Compute the diff and locate the target hunk ────────────────────
    const hunks = computeLineDiff(prevText, currText);
    const targetHunk = hunks.find((h) => h.index === hunkIndex);

    if (!targetHunk) {
      throw { statusCode: 404, message: `Hunk ${hunkIndex} not found in diff` };
    }

    // ── 6. Check already_absent ───────────────────────────────────────────
    // The hunk is "already absent" when the old content is no longer present
    // in the corresponding line range of the current version. We check this
    // by re-examining whether the current text still contains the hunk's
    // new content at the expected position.
    const currentLines = splitLines(currText);
    const hunkNewLines = targetHunk.newContent;

    const rangeStart = targetHunk.newStart;
    const rangeEnd = targetHunk.newEnd;
    const currentSlice = currentLines.slice(rangeStart, rangeEnd);

    const stillPresent = arraysEqual(currentSlice, hunkNewLines);
    if (!stillPresent) {
      return { reverted: false, reason: 'already_absent' };
    }

    // ── 7. Build the reverted content ─────────────────────────────────────
    // Replace the hunk's new content with the hunk's old content.
    const revertedLines = [
      ...currentLines.slice(0, rangeStart),
      ...targetHunk.oldContent,
      ...currentLines.slice(rangeEnd),
    ];
    const revertedText = revertedLines.join('\n') + (currText.endsWith('\n') ? '\n' : '');

    // ── 8. Persist new version + emit task event (atomically) ─────────────
    const nextVersion = currentVersion + 1;
    let emitFn: (() => Promise<void>) | null = null;

    await db.transaction(async (tx) => {
      await tx
        .insert(taskDeliverableVersions)
        .values({
          deliverableId: fileId,
          organisationId,
          version: nextVersion,
          bodyText: revertedText,
          createdByUserId: callerUserId,
          changeNote: `Reverted hunk ${hunkIndex} from version ${fromVersion}`,
        });

      // Update the inline body on the parent deliverable row.
      await tx
        .update(taskDeliverables)
        .set({ bodyText: revertedText })
        .where(
          and(
            eq(taskDeliverables.id, fileId),
            eq(taskDeliverables.organisationId, organisationId),
          ),
        );

      // Emit file.edited event via deferred-emit closure pattern.
      const result = await TaskEventService.appendAndEmit({
        taskId,
        runId: null,
        organisationId,
        eventOrigin: 'user',
        event: {
          kind: 'file.edited',
          payload: {
            fileId,
            priorVersion: currentVersion,
            newVersion: nextVersion,
            editRequest: `hunk_revert:${hunkIndex}`,
          },
        },
        tx: tx as Parameters<typeof TaskEventService.appendAndEmit>[0]['tx'],
      });

      emitFn = result.emit;
    });

    // Emit after transaction commits.
    if (emitFn) {
      try {
        await (emitFn as () => Promise<void>)();
      } catch (err) {
        logger.warn('fileRevertHunkService.emit_failed', {
          fileId,
          newVersion: nextVersion,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { reverted: true, newVersion: nextVersion };
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  // Remove trailing empty element from trailing newline.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
