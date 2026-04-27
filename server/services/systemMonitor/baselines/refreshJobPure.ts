// Pure aggregate helpers for baseline computation.
// All functions are deterministic on their inputs and have no side effects.

/** Raw statistics over a set of numeric samples. */
export interface BaselineStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

/**
 * Computes aggregate statistics over a non-empty sample set.
 * Returns null for empty samples (caller discards the baseline row).
 */
export function computeStats(samples: number[]): BaselineStats | null {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = sorted.reduce((s, v) => s + v, 0) / n;

  const variance = n > 1
    ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;

  return {
    count: n,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0]!,
    max: sorted[n - 1]!,
  };
}

/** Linear interpolation percentile over a pre-sorted array. */
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const rank = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
