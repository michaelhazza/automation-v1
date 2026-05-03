// ---------------------------------------------------------------------------
// shadowChargeRetentionJobPure — pure helpers for the shadow charge retention sweep
//
// No I/O. All functions are deterministic and side-effect-free.
// Impure orchestration lives in shadowChargeRetentionJob.ts.
//
// Spec: tasks/builds/agentic-commerce/spec.md §14 (shadow mode semantics)
// Plan: tasks/builds/agentic-commerce/plan.md § Chunk 16
// Invariant: retention job is the ONLY DB path that may delete agent_charges rows.
// ---------------------------------------------------------------------------

/** Per-org configuration row fetched from organisations. */
export interface OrgRetentionConfig {
  organisationId: string;
  shadowChargeRetentionDays: number;
}

/** Minimal shape of a shadow_settled row to evaluate. */
export interface ShadowSettledRow {
  id: string;
  status: string;
  settledAt: Date | null;
}

/** Decision for one shadow_settled row. */
export interface ShadowRetentionDecision {
  chargeId: string;
  shouldDelete: boolean;
  reason: 'past_retention_window' | 'within_window' | 'not_shadow_settled' | 'no_settled_at';
}

/**
 * Resolve the effective shadow retention days for an org.
 * Clamps to [1, 365]. Falls back to defaultDays if orgValue is out-of-range.
 */
export function resolveShadowRetentionDays(
  orgValue: number,
  defaultDays: number,
): number {
  if (!Number.isFinite(orgValue) || orgValue < 1 || orgValue > 365) {
    return defaultDays;
  }
  return Math.floor(orgValue);
}

/**
 * Compute the cutoff date for a given org's retention window.
 * Rows with settled_at strictly before the cutoff are eligible for deletion.
 */
export function computeShadowRetentionCutoff(now: Date, retentionDays: number): Date {
  const ms = retentionDays * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/**
 * Decide whether a given shadow_settled row should be deleted.
 * Pure — no side effects.
 *
 * Rules:
 *   - Row must be in status 'shadow_settled'.
 *   - settled_at must be non-null.
 *   - settled_at must be strictly before the cutoff.
 */
export function decideShadowRetention(
  row: ShadowSettledRow,
  cutoff: Date,
): ShadowRetentionDecision {
  if (row.status !== 'shadow_settled') {
    return { chargeId: row.id, shouldDelete: false, reason: 'not_shadow_settled' };
  }

  if (!row.settledAt) {
    return { chargeId: row.id, shouldDelete: false, reason: 'no_settled_at' };
  }

  if (row.settledAt < cutoff) {
    return { chargeId: row.id, shouldDelete: true, reason: 'past_retention_window' };
  }

  return { chargeId: row.id, shouldDelete: false, reason: 'within_window' };
}

/** Summary produced by one job tick. */
export interface ShadowRetentionSummary {
  orgs: number;
  scanned: number;
  deleted: number;
  skipped: number;
  durationMs: number;
}
