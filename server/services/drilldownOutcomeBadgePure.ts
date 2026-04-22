// ---------------------------------------------------------------------------
// Drilldown outcome-badge derivation — pure decision function (spec §4.4).
// Input: action status + optional outcome row. Output: a tagged badge shape
// that the client renders via <OutcomeBadge>.
// ---------------------------------------------------------------------------

export type OutcomeBadge =
  | { kind: 'band_improved'; fromBand: string; toBand: string }
  | { kind: 'band_worsened'; fromBand: string; toBand: string }
  | { kind: 'score_improved'; delta: number }
  | { kind: 'score_worsened'; delta: number }
  | { kind: 'neutral' }
  | { kind: 'pending'; reason: 'no_snapshot' | 'window_open' | 'operator_alert_no_signal' }
  | { kind: 'failed' };

const BAND_ORDER: Record<string, number> = {
  healthy: 0,
  watch: 1,
  atRisk: 2,
  critical: 3,
};

export function deriveOutcomeBadge(
  action: { status: string; actionType: string },
  outcome: { bandBefore?: string; bandAfter?: string; scoreDelta?: number; executionFailed?: boolean } | null,
): OutcomeBadge {
  // Execution-failed short-circuit: actions that never landed externally never
  // produce a measurable outcome. The outcome row may exist with executionFailed=true.
  if (action.status === 'failed' || action.status === 'rejected' || action.status === 'blocked') {
    return { kind: 'failed' };
  }
  if (outcome?.executionFailed) {
    return { kind: 'failed' };
  }

  // No outcome yet — either the window hasn't elapsed or no snapshot exists.
  if (!outcome) {
    if (action.status === 'proposed' || action.status === 'pending_approval' || action.status === 'approved' || action.status === 'executing') {
      return { kind: 'pending', reason: 'window_open' };
    }
    // notify_operator has no signal-driven outcome — the action completed but
    // there's no way to compare signals before/after.
    if (action.actionType === 'notify_operator') {
      return { kind: 'pending', reason: 'operator_alert_no_signal' };
    }
    return { kind: 'pending', reason: 'no_snapshot' };
  }

  const fromBand = outcome.bandBefore;
  const toBand = outcome.bandAfter;
  if (fromBand && toBand && fromBand !== toBand) {
    const fromRank = BAND_ORDER[fromBand] ?? 0;
    const toRank = BAND_ORDER[toBand] ?? 0;
    if (toRank < fromRank) return { kind: 'band_improved', fromBand, toBand };
    if (toRank > fromRank) return { kind: 'band_worsened', fromBand, toBand };
  }

  const delta = outcome.scoreDelta ?? 0;
  if (delta > 0) return { kind: 'score_improved', delta };
  if (delta < 0) return { kind: 'score_worsened', delta };

  return { kind: 'neutral' };
}
