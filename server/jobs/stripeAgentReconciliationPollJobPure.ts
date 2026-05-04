// ---------------------------------------------------------------------------
// stripeAgentReconciliationPollJobPure — pure helpers for the reconciliation poll
//
// No I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in stripeAgentReconciliationPollJob.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §16.6
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 12
//
// Purpose: poll Stripe for `executed` charges that haven't received a webhook
// confirmation within 30 minutes. If Stripe returns a terminal state, drive
// the equivalent transition.
// ---------------------------------------------------------------------------

/**
 * Threshold age (milliseconds) after which an `executed` row is eligible for
 * reconciliation polling. Default: 30 minutes per spec §16.6.
 */
export const RECONCILIATION_POLL_THRESHOLD_MS = 30 * 60 * 1000;

/** Minimal row shape returned from the candidate scan. */
export interface ExecutedCandidateRow {
  id: string;
  status: string;
  executedAt: Date | null;
  providerChargeId: string | null;
  organisationId: string;
  subaccountId: string | null;
}

/** Decision output for one candidate row. */
export interface ReconciliationPollDecision {
  chargeId: string;
  shouldPoll: boolean;
  reason: 'past_threshold' | 'not_executed' | 'missing_provider_id' | 'not_old_enough';
}

/** Summary produced by one job tick. */
export interface ReconciliationPollSummary {
  scanned: number;
  polled: number;
  transitioned: number;
  skipped: number;
  pollErrors: number;
  durationMs: number;
}

/**
 * Derive the UTC cutoff timestamp before which executed rows are candidates.
 *
 * A row with `executed_at < cutoff` is old enough to poll.
 * Uses `thresholdMs` parameter (default RECONCILIATION_POLL_THRESHOLD_MS) so
 * tests can pass arbitrary thresholds.
 */
export function deriveReconciliationCutoff(
  jobRunAt: Date,
  thresholdMs: number = RECONCILIATION_POLL_THRESHOLD_MS,
): Date {
  return new Date(jobRunAt.getTime() - thresholdMs);
}

/**
 * Decide whether a given executed row should be submitted to Stripe for polling.
 * Pure — no side effects.
 *
 * Rules:
 *   - Only rows still in `executed` status are candidates.
 *   - Row must have a non-null `provider_charge_id` (required to query Stripe).
 *   - `executed_at` must be non-null and older than the cutoff.
 */
export function decideReconciliationPoll(
  row: ExecutedCandidateRow,
  cutoff: Date,
): ReconciliationPollDecision {
  if (row.status !== 'executed') {
    return { chargeId: row.id, shouldPoll: false, reason: 'not_executed' };
  }

  if (!row.providerChargeId) {
    return { chargeId: row.id, shouldPoll: false, reason: 'missing_provider_id' };
  }

  if (!row.executedAt || row.executedAt >= cutoff) {
    return { chargeId: row.id, shouldPoll: false, reason: 'not_old_enough' };
  }

  return { chargeId: row.id, shouldPoll: true, reason: 'past_threshold' };
}

/**
 * Map a Stripe charge status string to the equivalent agent_charges transition target.
 * Returns null if the Stripe status does not warrant a transition (e.g. 'pending').
 */
export function mapStripeChargeStatusToTarget(
  stripeStatus: string,
): 'succeeded' | 'failed' | null {
  switch (stripeStatus) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    default:
      // 'pending' and any unrecognised status: no transition yet.
      return null;
  }
}
