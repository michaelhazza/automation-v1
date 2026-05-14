// subaccountOperatorSettingsServicePure.ts — range validation, ETag derivation, snapshot extraction.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.16
//
// Pure module — no DB, no IO.

import { OperatorPureValidationError } from './executionBackends/operatorManagedBackendPure.js';
import type { OperatorRunSettingsSnapshot } from '../../shared/types/operatorRuns.js';

// ---------------------------------------------------------------------------
// Field ranges (locked per spec §3.16)
// ---------------------------------------------------------------------------

export interface SettingsFieldRange {
  min: number;
  max: number;
  default: number;
}

export const OPERATOR_SETTINGS_RANGES: Readonly<
  Record<keyof OperatorRunSettingsSnapshot, SettingsFieldRange>
> = {
  session_soft_cap_minutes: { min: 30, max: 240, default: 120 },
  auto_extend_grace_minutes: { min: 0, max: 60, default: 30 },
  max_chain_length: { min: 1, max: 500, default: 50 },
  max_wall_clock_per_task_days: { min: 1, max: 365, default: 30 },
  per_task_budget_cap_minutes: { min: 60, max: 60000, default: 6000 },
  concurrent_operator_sessions_cap: { min: 1, max: 25, default: 5 },
};

/**
 * Validates a single settings field value against the locked range.
 * Throws OperatorPureValidationError on violation.
 */
export function validateOperatorSettingsField(
  field: keyof OperatorRunSettingsSnapshot,
  value: number,
): void {
  const range = OPERATOR_SETTINGS_RANGES[field];
  if (!Number.isInteger(value)) {
    throw new OperatorPureValidationError(
      `Operator settings field '${field}' must be an integer, got: ${value}`,
    );
  }
  if (value < range.min || value > range.max) {
    throw new OperatorPureValidationError(
      `Operator settings field '${field}' value ${value} is out of range [${range.min}, ${range.max}]`,
    );
  }
}

/**
 * Validates all settings fields in a patch object.
 * Only validates the fields that are present in the patch (partial update).
 * Throws OperatorPureValidationError on first violation.
 */
export function validateOperatorSettingsRange(
  patch: Partial<OperatorRunSettingsSnapshot>,
): void {
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) {
      validateOperatorSettingsField(
        field as keyof OperatorRunSettingsSnapshot,
        value as number,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ETag derivation (R2-F3)
// ---------------------------------------------------------------------------

/**
 * Derives the ETag for a subaccount_operator_settings row.
 *
 * ETag = String(settings_version) — the integer column, NOT a timestamp.
 * This is deterministic and collision-free even for same-second concurrent writes.
 *
 * Per plan R2-F3: PATCH UPDATE uses settings_version = settings_version + 1.
 */
export function deriveSettingsETag(settingsVersion: number): string {
  return String(settingsVersion);
}

// ---------------------------------------------------------------------------
// Settings-snapshot extraction
// ---------------------------------------------------------------------------

export interface SubaccountOperatorSettingsRow {
  session_soft_cap_minutes: number;
  auto_extend_grace_minutes: number;
  max_chain_length: number;
  max_wall_clock_per_task_days: number;
  per_task_budget_cap_minutes: number;
  concurrent_operator_sessions_cap: number;
}

/**
 * Extracts the settings_snapshot shape from a full settings row.
 *
 * The snapshot is pinned in operator_runs.settings_snapshot at dispatch time.
 * Includes concurrent_operator_sessions_cap for audit context, though it is
 * NOT enforced from the snapshot at dispatch time (always read from the live row).
 */
export function extractSettingsSnapshot(
  row: SubaccountOperatorSettingsRow,
): OperatorRunSettingsSnapshot {
  return {
    session_soft_cap_minutes: row.session_soft_cap_minutes,
    auto_extend_grace_minutes: row.auto_extend_grace_minutes,
    max_chain_length: row.max_chain_length,
    max_wall_clock_per_task_days: row.max_wall_clock_per_task_days,
    per_task_budget_cap_minutes: row.per_task_budget_cap_minutes,
    concurrent_operator_sessions_cap: row.concurrent_operator_sessions_cap,
  };
}

/**
 * Returns the default settings snapshot when no row exists for the subaccount.
 * Used for new subaccounts before their first explicit settings write.
 */
export function getDefaultSettingsSnapshot(): OperatorRunSettingsSnapshot {
  return {
    session_soft_cap_minutes: OPERATOR_SETTINGS_RANGES.session_soft_cap_minutes.default,
    auto_extend_grace_minutes: OPERATOR_SETTINGS_RANGES.auto_extend_grace_minutes.default,
    max_chain_length: OPERATOR_SETTINGS_RANGES.max_chain_length.default,
    max_wall_clock_per_task_days: OPERATOR_SETTINGS_RANGES.max_wall_clock_per_task_days.default,
    per_task_budget_cap_minutes: OPERATOR_SETTINGS_RANGES.per_task_budget_cap_minutes.default,
    concurrent_operator_sessions_cap:
      OPERATOR_SETTINGS_RANGES.concurrent_operator_sessions_cap.default,
  };
}
