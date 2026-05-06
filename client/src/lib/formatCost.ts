// ---------------------------------------------------------------------------
// formatCost — convert integer cent values → human-readable cost strings
// for the CostMeterPill and any other per-conversation cost surface.
// ---------------------------------------------------------------------------

/**
 * Format a whole-cent value to a dollar string.
 * Sub-cent values (0 < costCents < 1) render as "$0.00" unless micro=true,
 * which shows 4dp to prevent sub-cent work appearing free.
 *
 * Examples:
 *   formatCostCents(0)     → "$0.00"
 *   formatCostCents(1)     → "$0.01"
 *   formatCostCents(150)   → "$1.50"
 *   formatCostCents(1)     → "$0.01"  (already ≥ 1 cent, no micro needed)
 */
export function formatCostCents(costCents: number, micro = false): string {
  if (!Number.isFinite(costCents) || costCents < 0) return '$0.00';
  if (costCents === 0) return '$0.00';
  const dollars = costCents / 100;
  if (micro && dollars < 0.01) {
    return `$${dollars.toFixed(4)}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/**
 * Format a token count to a compact human-readable string.
 * < 1000   → "847"
 * ≥ 1000   → "1.2k" (1dp when < 10k, else 0dp)
 * ≥ 1 000 000 → "1.2M"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) {
    const k = Math.floor(tokens / 100) / 10; // floor to 1dp — prevents 9999 rounding up to 10.0k
    return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  const m = Math.floor(tokens / 100_000) / 10; // floor to 1dp
  return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
}
