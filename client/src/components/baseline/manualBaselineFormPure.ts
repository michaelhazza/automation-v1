/**
 * F3 §6 — pure helpers for ManualBaselineForm.
 *
 * The cents↔dollars conversion lives here so it can be unit-tested without
 * react-testing-library. Bug class this guards against: server stores
 * cents-unit metrics as integer cents, manual form input must round-trip
 * through dollars-and-cents for operators. Without this layer, an operator
 * entering "47000" intended as dollars would be persisted as 47000 cents
 * = $470 — a 100x undercount that misnarrates every dollar baseline.
 */

export type MetricUnit = 'cents' | 'count' | 'percent';

/**
 * Parse a numeric string entered by the operator into the canonical
 * server-side numeric for the given metric unit.
 *
 *  - cents-unit: input "47.55" → 4755 (integer cents, Math.round defends
 *    against the 47.55 * 100 = 4754.999... float artifact).
 *  - count / percent: input passed through as-is (no scaling).
 *  - Empty / negative / NaN inputs return null, signalling "skip this metric".
 */
export function parseInputToServerNumeric(
  input: string,
  unit: MetricUnit,
): number | null {
  if (input === '') return null;
  const parsed = parseFloat(input);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return unit === 'cents' ? Math.round(parsed * 100) : parsed;
}

/**
 * Format a server-stored numeric back into the operator-facing string
 * representation for the given metric unit.
 *
 *  - cents-unit: stored 4755 → "47.55" (dollars-and-cents).
 *  - count / percent: stored value rendered as-is.
 *  - null / undefined: empty string (renders as the placeholder dash).
 */
export function formatServerNumericForInput(
  stored: number | null | undefined,
  unit: MetricUnit,
): string {
  if (stored == null) return '';
  return unit === 'cents' ? String(stored / 100) : String(stored);
}
