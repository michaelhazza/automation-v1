/**
 * beliefConflictServicePure — pure decision logic for belief conflict resolution
 *
 * Contains the conflict-resolution decision table so it can be unit tested
 * independently of the database. The impure layer in `beliefConflictService.ts`
 * calls these functions to determine what action to take.
 *
 * Spec: docs/memory-and-briefings-spec.md §4.3 (S3)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictResolutionAction =
  | 'auto_supersede_existing' // new belief wins — supersede the existing one
  | 'auto_supersede_new'      // existing belief wins — supersede the new one
  | 'queue_for_review';       // gap too small — human must decide

export interface ConflictResolutionDecision {
  action: ConflictResolutionAction;
  confidenceGap: number;
}

export interface ConflictResolutionParams {
  newConfidence: number;
  existingConfidence: number;
  /** Minimum gap for auto-resolution; below this → queue for review */
  gapThreshold: number;
}

// ---------------------------------------------------------------------------
// computeConflictResolution
// ---------------------------------------------------------------------------

/**
 * Determine the conflict resolution action for a pair of conflicting beliefs.
 *
 * Rules (§4.3):
 *   - gap = |newConfidence - existingConfidence|
 *   - gap > gapThreshold:
 *       higher-confidence belief wins; lower is superseded.
 *   - gap ≤ gapThreshold:
 *       ambiguous — queue for human review.
 *
 * Edge cases:
 *   - Equal confidence (gap = 0): always queue for review (0 ≤ gapThreshold).
 *   - Both at 1.0: gap = 0, queue for review.
 *   - Both at 0.0: gap = 0, queue for review.
 *
 * Returns the decision and the computed gap for audit purposes.
 */
export function computeConflictResolution(
  params: ConflictResolutionParams,
): ConflictResolutionDecision {
  const { newConfidence, existingConfidence, gapThreshold } = params;
  const gap = Math.abs(newConfidence - existingConfidence);

  if (gap > gapThreshold) {
    if (newConfidence > existingConfidence) {
      return { action: 'auto_supersede_existing', confidenceGap: gap };
    } else {
      return { action: 'auto_supersede_new', confidenceGap: gap };
    }
  }

  return { action: 'queue_for_review', confidenceGap: gap };
}
