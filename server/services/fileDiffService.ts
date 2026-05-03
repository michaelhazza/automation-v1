/**
 * fileDiffService.ts — impure diff service for task deliverable versions.
 *
 * Loads version content from the database, picks line vs row diff mode based
 * on MIME type, and delegates to the pure algorithm.
 *
 * Spec: docs/workflows-dev-spec.md §12.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { taskDeliverableVersions, taskDeliverables } from '../db/schema/index.js';
import { computeLineDiff, computeRowDiff, type Hunk } from './fileDiffServicePure.js';
import { parseCsv } from '../lib/csvParser.js';

// ─── MIME-type classification ─────────────────────────────────────────────────

/** MIME types treated as row-level (CSV / spreadsheet) for V1. */
const ROW_DIFF_MIMES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** MIME types treated as line-level text for V1. */
function isLineDiffMime(mime: string | null): boolean {
  if (!mime) return true; // unknown: treat as text
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json') return true;
  if (mime === 'application/xml') return true;
  return false;
}

function isRowDiffMime(mime: string | null): boolean {
  if (!mime) return false;
  return ROW_DIFF_MIMES.has(mime);
}

export type DiffMode = 'line' | 'row' | 'unsupported';

export interface FileDiffResult {
  hunks: Hunk[];
  mode: DiffMode;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load two versions of a task deliverable and compute their diff.
 *
 * @param fileId       The deliverable (task_deliverables.id).
 * @param fromVersion  Lower version number (the "before").
 * @param toVersion    Higher version number (the "after").
 * @param organisationId  For tenant isolation.
 *
 * Returns `{ hunks: [], mode: 'unsupported' }` for binary / image content.
 * Throws 404 if either version does not exist or belongs to a different org.
 */
export async function getDiff(
  fileId: string,
  fromVersion: number,
  toVersion: number,
  organisationId: string,
): Promise<FileDiffResult> {
  // Verify the deliverable belongs to this org.
  const [deliverable] = await db
    .select({ id: taskDeliverables.id, mimeType: taskDeliverables.deliverableType })
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

  // Load the two versions in parallel.
  const [fromRow, toRow] = await Promise.all([
    db
      .select({ bodyText: taskDeliverableVersions.bodyText })
      .from(taskDeliverableVersions)
      .where(
        and(
          eq(taskDeliverableVersions.deliverableId, fileId),
          eq(taskDeliverableVersions.version, fromVersion),
          eq(taskDeliverableVersions.organisationId, organisationId),
        ),
      )
      .limit(1),
    db
      .select({ bodyText: taskDeliverableVersions.bodyText })
      .from(taskDeliverableVersions)
      .where(
        and(
          eq(taskDeliverableVersions.deliverableId, fileId),
          eq(taskDeliverableVersions.version, toVersion),
          eq(taskDeliverableVersions.organisationId, organisationId),
        ),
      )
      .limit(1),
  ]);

  if (!fromRow[0] || !toRow[0]) {
    throw { statusCode: 404, message: 'Version not found' };
  }

  const prevText = fromRow[0].bodyText;
  const currText = toRow[0].bodyText;

  // Pick the MIME type from the deliverable record.
  // Note: taskDeliverables.deliverableType is 'file' | 'url' | 'artifact', not a MIME.
  // Real MIME is not stored on the deliverable row in the current schema.
  // Use 'unsupported' for non-text URLs/artifacts; default to line diff for 'file'.
  // A future migration can add a mime_type column to task_deliverables.
  const mime: string | null =
    deliverable.mimeType === 'file' ? 'text/plain' : null;

  // Determine diff mode.
  if (isRowDiffMime(mime)) {
    const prevRows = parseCsv(prevText);
    const currRows = parseCsv(currText);
    const hunks = computeRowDiff(prevRows, currRows);
    return { hunks, mode: 'row' };
  }

  if (isLineDiffMime(mime)) {
    const hunks = computeLineDiff(prevText, currText);
    return { hunks, mode: 'line' };
  }

  // Binary / unsupported MIME — return empty hunk list.
  return { hunks: [], mode: 'unsupported' };
}
