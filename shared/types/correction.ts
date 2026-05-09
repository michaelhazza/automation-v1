// shared/types/correction.ts
// Correction capture types and pure payload validator.
// Trust & Verification Layer spec §6.7, §10.1, §13.1, §13.2.

// ── Wire types ────────────────────────────────────────────────────────────────

/** Payload posted to POST /api/runs/:runId/steps/:eventId/correct */
export interface CorrectionDialogPayload {
  runId: string;
  eventId: string;
  agentId: string;
  skillSlug: string;
  originalOutput: string;
  editedOutput: string;
  reason: string | null;
}

/** Response from the correction capture endpoint. */
export interface CorrectionResult {
  memoryBlockId: string;
  forcedGradeEnqueued: boolean;
}

// ── Pure validator ────────────────────────────────────────────────────────────

export type CorrectionValidationError =
  | 'EDITED_OUTPUT_EMPTY'
  | 'EDITED_OUTPUT_TOO_LARGE'
  | 'REASON_TOO_LONG';

const MAX_EDITED_OUTPUT_BYTES = 50_000;
const MAX_REASON_CHARS = 500;

/**
 * Validates a correction payload before submission.
 * Returns null when valid; returns an error code otherwise.
 */
export function correctionPayloadValidator(
  payload: Pick<CorrectionDialogPayload, 'editedOutput' | 'reason'>,
): CorrectionValidationError | null {
  if (!payload.editedOutput || payload.editedOutput.trim().length === 0) {
    return 'EDITED_OUTPUT_EMPTY';
  }

  // UTF-8 byte size approximation: count multi-byte chars
  const byteLength = new TextEncoder().encode(payload.editedOutput).length;
  if (byteLength > MAX_EDITED_OUTPUT_BYTES) {
    return 'EDITED_OUTPUT_TOO_LARGE';
  }

  if (payload.reason !== null && payload.reason.length > MAX_REASON_CHARS) {
    return 'REASON_TOO_LONG';
  }

  return null;
}
