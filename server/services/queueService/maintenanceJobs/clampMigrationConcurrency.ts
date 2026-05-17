/**
 * clampMigrationConcurrency — pure helper for the workspace identity-migration
 * worker pool size derived from the WORKSPACE_MIGRATION_CONCURRENCY env var.
 *
 * Extracted from pgBossRegistrations.ts for PR #327 T2 (Wave 5 Session K).
 *
 * Behaviour:
 *   - undefined or empty string → 8 (default)
 *   - non-numeric ("abc")        → 8 (NaN guard)
 *   - zero or negative           → 8 (silently fall back to default)
 *   - positive float ("3.7")     → 3 (floor before clamp)
 *   - in range (1..32)           → value
 *   - above 32 ("1000")          → 32 (upper clamp prevents typo'd env from
 *                                       exhausting the worker pool)
 */
export const MIGRATION_CONCURRENCY_DEFAULT = 8;
export const MIGRATION_CONCURRENCY_MAX = 32;
export const MIGRATION_CONCURRENCY_MIN = 1;

export function clampMigrationConcurrency(raw: string | number | undefined): number {
  const value = Number(raw ?? MIGRATION_CONCURRENCY_DEFAULT);
  if (!Number.isFinite(value) || value <= 0) {
    return MIGRATION_CONCURRENCY_DEFAULT;
  }
  return Math.max(MIGRATION_CONCURRENCY_MIN, Math.min(MIGRATION_CONCURRENCY_MAX, Math.floor(value)));
}
