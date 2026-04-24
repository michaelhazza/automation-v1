// ---------------------------------------------------------------------------
// Drilldown pendingIntervention — pure derivation function.
// Input: raw DB rows for review_items joined to actions, plus an action label
// lookup. Output: PendingInterventionResult | null.
// ---------------------------------------------------------------------------

export interface PendingInterventionRow {
  reviewItemId: string;
  actionType: string;
  payloadJsonReasoning: string | null;
  proposedAt: Date | string;
}

export interface PendingInterventionResult {
  reviewItemId: string;
  actionTitle: string;
  proposedAt: string;
  rationale: string;
}

/**
 * From a (possibly empty) list of pending review-item rows for a subaccount,
 * derive the most recent pending intervention to surface in the drilldown.
 *
 * @param rows       Review item rows already filtered to pending/edited_pending,
 *                   ordered most-recent-first (the caller enforces ordering).
 * @param subaccountName  Human-readable name of the subaccount.
 * @param getActionLabel  Lookup for human-readable label by actionType — falls
 *                        back to the raw actionType string if not found.
 */
export function derivePendingIntervention(
  rows: PendingInterventionRow[],
  subaccountName: string,
  getActionLabel: (actionType: string) => string,
): PendingInterventionResult | null {
  if (rows.length === 0) return null;

  // Caller orders by createdAt DESC; take the first (most recent).
  const row = rows[0];
  const label = getActionLabel(row.actionType);
  const proposedAtDate = row.proposedAt instanceof Date ? row.proposedAt : new Date(row.proposedAt);

  return {
    reviewItemId: row.reviewItemId,
    actionTitle: `${label} for ${subaccountName}`,
    proposedAt: proposedAtDate.toISOString(),
    rationale: row.payloadJsonReasoning ?? '',
  };
}
