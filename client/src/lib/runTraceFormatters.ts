// client/src/lib/runTraceFormatters.ts
// Pure formatters for the Run Trace headline (spec §5.1.3).
// No React, no side effects, no DB access.

import type { ControllerStyle } from '../../../shared/types/controllerStyle.js';

// ---------------------------------------------------------------------------
// formatDuration — "45 seconds" / "2 min 14 sec" / "1 hr 3 min"
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 60) {
    return totalSeconds === 1 ? '1 second' : `${totalSeconds} seconds`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    const remainingSeconds = totalSeconds % 60;
    if (remainingSeconds === 0) {
      return totalMinutes === 1 ? '1 min' : `${totalMinutes} min`;
    }
    return `${totalMinutes} min ${remainingSeconds} sec`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (remainingMinutes === 0) {
    return hours === 1 ? '1 hr' : `${hours} hr`;
  }
  return `${hours} hr ${remainingMinutes} min`;
}

// ---------------------------------------------------------------------------
// formatCost — "$0.08" / "$1.23"
// ---------------------------------------------------------------------------

export function formatCost(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// formatControllerLabel — "Native run" / "Operator run"
// ---------------------------------------------------------------------------

export function formatControllerLabel(style: ControllerStyle): string {
  switch (style) {
    case 'native':
      return 'Native run';
    case 'operator':
      return 'Operator run';
  }
}

// ---------------------------------------------------------------------------
// formatApprovalStatus
//
// Returns null for the silent native-run case (run succeeded/completed with
// no approval gate touched — approvedBy is null and hasEvents is true).
//
// "Failed before execution" predicate (spec §4.5.6 / chunk 8 contract):
//   finalStatus === 'failed'
//   AND failureReason === 'policy_envelope_resolution_failed'
//   AND hasEvents === false
// All three conditions required; do not infer from finalStatus alone.
//
// approvedBy === 'auto'  → "auto-approved" (policy auto-gated)
// approvedBy = a name   → "approved by [name]"
// approvedBy === null   → silent (return null) for succeeded/completed runs
// ---------------------------------------------------------------------------

export interface ApprovalStatusInput {
  finalStatus: string;
  failureReason?: string | null;
  /** Whether the run has any tool_call / tool_result / llm_call / iee_step events. */
  hasEvents: boolean;
  /** 'auto' for auto-approved, a human name when manually approved, null otherwise. */
  approvedBy?: string | null;
}

export function formatApprovalStatus(status: ApprovalStatusInput): string | null {
  const { finalStatus, failureReason, hasEvents, approvedBy } = status;

  // Failed before execution: envelope resolution failure with no events at all.
  if (
    finalStatus === 'failed' &&
    failureReason === 'policy_envelope_resolution_failed' &&
    !hasEvents
  ) {
    return 'failed before execution';
  }

  // Blocked by policy decision (check before generic failure — failureReason can co-exist
  // with a failed finalStatus when the run was terminated by policy).
  if (finalStatus === 'blocked' || failureReason === 'policy_blocked') {
    return 'blocked by policy';
  }

  // Other failures.
  if (finalStatus === 'failed' || finalStatus === 'error') {
    return 'failed';
  }

  // Pending / awaiting approval.
  if (finalStatus === 'pending' || finalStatus === 'awaiting_approval') {
    return 'awaiting approval';
  }

  // Cancelled — no label.
  if (finalStatus === 'cancelled') {
    return null;
  }

  // Succeeded/completed paths.
  if (finalStatus === 'succeeded' || finalStatus === 'completed') {
    if (approvedBy === 'auto') {
      return 'auto-approved';
    }
    if (approvedBy) {
      return `approved by ${approvedBy}`;
    }
    // Silent native-run case: no approval gate was touched.
    return null;
  }

  return null;
}
