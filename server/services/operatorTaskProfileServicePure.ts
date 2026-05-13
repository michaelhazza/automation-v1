// operatorTaskProfileServicePure.ts — retention-window math, status transitions, attempt-bump.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.15
//
// Pure module — no DB, no IO.

import { OperatorPureValidationError } from './executionBackends/operatorManagedBackendPure.js';

/** Default retention window after task-terminal: 48 hours. */
export const DEFAULT_RETENTION_HOURS = 48;

/** Admin debug-extended retention window: 14 days in hours. */
export const ADMIN_RETENTION_HOURS = 14 * 24;

/** Default profile size cap: 500 MB in bytes. */
export const PROFILE_SIZE_CAP_BYTES = 500 * 1024 * 1024;

/** Time window to reclaim stale gc_in_progress rows: 30 minutes in ms. */
export const GC_IN_PROGRESS_STALE_MS = 30 * 60 * 1000;

export type OperatorTaskProfileStatus =
  | 'active'
  | 'scheduled_gc'
  | 'gc_in_progress'
  | 'gc_done';

export const VALID_PROFILE_STATUS_TRANSITIONS: ReadonlyMap<
  OperatorTaskProfileStatus,
  ReadonlyArray<OperatorTaskProfileStatus>
> = new Map([
  ['active', ['scheduled_gc']],
  ['scheduled_gc', ['gc_in_progress']],
  ['gc_in_progress', ['gc_done', 'scheduled_gc']], // scheduled_gc for stale reclaim
  ['gc_done', []],
]);

/**
 * Validates a status transition and throws OperatorPureValidationError if invalid.
 */
export function validateProfileStatusTransition(
  from: OperatorTaskProfileStatus,
  to: OperatorTaskProfileStatus,
): void {
  const allowed = VALID_PROFILE_STATUS_TRANSITIONS.get(from);
  if (allowed === undefined || !allowed.includes(to)) {
    throw new OperatorPureValidationError(
      `Invalid profile status transition: ${from} → ${to}`,
    );
  }
}

/**
 * Derives the scheduled_gc_at timestamp for a task-terminal profile.
 *
 * @param taskTerminalAt - The time the task reached a terminal state.
 * @param isAdminExtended - Whether an org_admin has extended retention to 14 days.
 */
export function deriveProfileRetentionWindow(
  taskTerminalAt: Date,
  isAdminExtended: boolean,
): Date {
  const retentionHours = isAdminExtended ? ADMIN_RETENTION_HOURS : DEFAULT_RETENTION_HOURS;
  return new Date(taskTerminalAt.getTime() + retentionHours * 60 * 60 * 1000);
}

/**
 * Returns true when a gc_in_progress row is considered stale and can be
 * reclaimed (re-scheduled) by the GC job.
 *
 * @param gcStartedAt - The gc_started_at timestamp from the profile row.
 * @param now - The current time (injectable for testability).
 */
export function isGcInProgressStale(gcStartedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - gcStartedAt.getTime() > GC_IN_PROGRESS_STALE_MS;
}

/**
 * Derives the new attempt_number on a fresh-profile restart.
 *
 * Per spec §3.15 item 7:
 * - Default starts at 1; bumps on each fresh-profile restart.
 * - Returns priorAttemptNumber + 1.
 */
export function deriveNextAttemptNumber(priorAttemptNumber: number): number {
  if (priorAttemptNumber < 1) {
    throw new OperatorPureValidationError(
      `Invalid priorAttemptNumber: ${priorAttemptNumber} (must be >= 1)`,
    );
  }
  return priorAttemptNumber + 1;
}
