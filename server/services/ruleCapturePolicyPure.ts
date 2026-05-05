/**
 * Pure policies governing how a captured rule transitions into the live
 * decision path. Isolated from the DB layer so the rules are testable and
 * can grow new dimensions (source type, org overrides, etc.) without
 * touching `saveRule`.
 */

export const AUTO_PAUSE_CONFIDENCE_THRESHOLD = 0.8;

export interface AutoPauseInput {
  originatingArtefactId?: string | null;
  // Optional [0..1] confidence score. Absent → treated as "no signal" and
  // does not trigger an auto-pause on its own.
  confidence?: number | null;
}

/**
 * Returns `true` when a newly captured rule should start in `pending_review`
 * instead of `active`.
 *
 * Pause dimensions:
 *   1. Approval-suggestion origin — any rule drafted off a Brief approval
 *      artefact is paused for human review before going live.
 *   2. Low confidence — rules carrying an explicit confidence score below
 *      `AUTO_PAUSE_CONFIDENCE_THRESHOLD` are paused regardless of origin.
 *
 * Anything else starts active.
 */
export function shouldAutoPauseRulePure(input: AutoPauseInput): boolean {
  if (input.originatingArtefactId != null && input.originatingArtefactId !== '') {
    return true;
  }
  if (typeof input.confidence === 'number' && input.confidence < AUTO_PAUSE_CONFIDENCE_THRESHOLD) {
    return true;
  }
  return false;
}
