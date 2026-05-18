// ---------------------------------------------------------------------------
// amendmentDedupPure — pure helpers for amendment deduplication.
// Closed-Loop Skill Improvement spec §9.1 step 9 (Chunk 4).
//
// All functions are pure (no I/O, no DB, no side effects) so they can be
// unit-tested without mocking infrastructure.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import type { AmendmentKind } from '../../shared/types/skillAmendments.js';

/**
 * Normalise an amendment body for dedup-key computation.
 * Steps: lowercase → collapse whitespace → strip trailing punctuation.
 */
export function normaliseAmendmentBody(body: string): string {
  return body
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:]+$/u, '');
}

/**
 * Compute a stable SHA-256 dedup key for a (skillId, kind, body) triple.
 * The body is normalised before hashing so minor whitespace/case variants
 * do not produce distinct keys.
 */
export function computeAmendmentDedupKey(
  skillId: string,
  kind: AmendmentKind,
  body: string,
): string {
  const normalised = normaliseAmendmentBody(body);
  return createHash('sha256')
    .update(`${skillId}:${kind}:${normalised}`)
    .digest('hex');
}

export interface DedupCohort {
  activeAccepted: Array<{ id: string; dedupKey: string }>;
  pendingReview: Array<{ id: string; dedupKey: string }>;
  recentlyRejectedWithin14Days: Array<{ id: string; dedupKey: string; rejectedAt: Date }>;
  failingRunsInLast7Days: number;
}

export type DedupDecision =
  | { decision: 'insert' }
  | { decision: 'suppress_increment_active'; targetId: string }
  | { decision: 'suppress_increment_pending'; targetId: string }
  | { decision: 'suppress_recently_rejected'; targetId: string }
  | { decision: 'insert_override_freshness'; reason: 'high_recurrence' };

/**
 * Classify what action to take for a candidate amendment given the current cohort.
 *
 * Decision order:
 * 1. Candidate key matches activeAccepted → suppress_increment_active
 * 2. Candidate key matches pendingReview → suppress_increment_pending
 * 3. Candidate key matches recentlyRejectedWithin14Days AND failing runs < 3 → suppress_recently_rejected
 * 4. Candidate key matches recentlyRejectedWithin14Days AND failing runs >= 3 → insert_override_freshness
 * 5. No match → insert
 */
export function classifyDedup(input: {
  candidateKey: string;
  cohort: DedupCohort;
  now: Date;
}): DedupDecision {
  const { candidateKey, cohort } = input;

  const activeMatch = cohort.activeAccepted.find((a) => a.dedupKey === candidateKey);
  if (activeMatch) {
    return { decision: 'suppress_increment_active', targetId: activeMatch.id };
  }

  const pendingMatch = cohort.pendingReview.find((p) => p.dedupKey === candidateKey);
  if (pendingMatch) {
    return { decision: 'suppress_increment_pending', targetId: pendingMatch.id };
  }

  const rejectedMatch = cohort.recentlyRejectedWithin14Days.find(
    (r) => r.dedupKey === candidateKey,
  );
  if (rejectedMatch) {
    if (cohort.failingRunsInLast7Days >= 3) {
      return { decision: 'insert_override_freshness', reason: 'high_recurrence' };
    }
    return { decision: 'suppress_recently_rejected', targetId: rejectedMatch.id };
  }

  return { decision: 'insert' };
}
