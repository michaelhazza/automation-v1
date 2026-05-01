/**
 * Pure helpers for BudgetContextStrip — no React, no side effects.
 * Extracted so the trust logic is testable and reusable independently of
 * the render layer.
 */

/**
 * Determines whether the data-source indicator should be shown alongside the
 * cost figure.
 *
 * Rules:
 * - 'stub'      → always show (canned/template response; user needs context)
 * - 'hybrid'    → always show (mixed live + cached data; user needs context)
 * - 'canonical' → show only when data is stale (>60 s old), to flag drift risk
 * - anything else → hide
 */
export function shouldShowSource(
  source: string | undefined,
  freshnessMs: number | undefined,
): boolean {
  if (!source) return false;
  if (source === 'stub') return true;
  if (source === 'hybrid') return true;
  if (source === 'canonical' && freshnessMs !== undefined && freshnessMs > 60_000) return true;
  return false;
}

export function formatCost(cents: number): string {
  if (cents < 1) return '<$0.01';
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatFreshness(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}
