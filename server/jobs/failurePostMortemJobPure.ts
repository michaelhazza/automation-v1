// ---------------------------------------------------------------------------
// failurePostMortemJobPure — pure helpers for the failure:post-mortem job.
// Closed-Loop Skill Improvement spec §9.1 (Chunk 3).
//
// All functions are pure (no I/O, no DB, no side effects) so they can be
// unit-tested without mocking infrastructure.
// ---------------------------------------------------------------------------

export interface CapCheckResult {
  weeklyCount: number;
  lifetimeCount: number;
  weeklyCapExceeded: boolean;
  lifetimeCapExceeded: boolean;
}

const LIFETIME_CAP = 20;
const WEEKLY_CAP = 5;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Evaluate amendment caps from a pre-fetched set of amendment rows.
 *
 * @param rows - All amendments for the skill/subaccount/org (any status).
 * @param now  - Reference timestamp for the weekly window.
 */
export function checkAmendmentCaps(
  rows: { createdAt: Date; status: string }[],
  now: Date,
): CapCheckResult {
  const weeklyWindowStart = new Date(now.getTime() - SEVEN_DAYS_MS);

  let lifetimeCount = 0;
  let weeklyCount = 0;

  for (const row of rows) {
    if (row.status === 'accepted') {
      lifetimeCount++;
    }
    if (row.createdAt >= weeklyWindowStart) {
      weeklyCount++;
    }
  }

  return {
    weeklyCount,
    lifetimeCount,
    weeklyCapExceeded: weeklyCount >= WEEKLY_CAP,
    lifetimeCapExceeded: lifetimeCount >= LIFETIME_CAP,
  };
}

export interface AmendmentStackFromSnapshot {
  included: string[];
  excluded: string[];
  resolverVersion: string;
  amendmentVersionSetHash: string;
}

/**
 * Derive the amendment stack that was applied to a run from the immutable
 * snapshot row. Body text is NOT included — set membership only.
 */
export function deriveAmendmentStackFromSnapshot(snapshotRow: {
  includedAmendmentIds: string[];
  excludedAmendmentIds: string[];
  resolverVersion: string;
  amendmentVersionSetHash: string;
}): AmendmentStackFromSnapshot {
  return {
    included: snapshotRow.includedAmendmentIds,
    excluded: snapshotRow.excludedAmendmentIds,
    resolverVersion: snapshotRow.resolverVersion,
    amendmentVersionSetHash: snapshotRow.amendmentVersionSetHash,
  };
}
