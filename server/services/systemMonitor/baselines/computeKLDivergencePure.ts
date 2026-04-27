// Pure helper: KL divergence between two discrete distributions.
// Used by the tool-selection-drift Phase 2.5 heuristic.
// Both distributions are represented as Record<string, number> where values
// are probabilities (sum to ~1) or counts (auto-normalised internally).

/**
 * Normalise a count-or-probability map to a valid probability distribution.
 * Returns a new map with values summing to 1.
 * Throws if all values are zero.
 */
function normalise(dist: Record<string, number>): Map<string, number> {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) throw new Error('computeKLDivergence: distribution must have non-zero mass');
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(dist)) {
    out.set(k, v / total);
  }
  return out;
}

/**
 * KL divergence D_KL(P || Q) — how much P differs from Q.
 * Uses a small smoothing constant (1e-10) to handle Q(x)=0 cases
 * without infinite divergence.
 *
 * Returns 0 when P and Q are identical.
 * Returns a higher value the more P diverges from Q.
 */
export function computeKLDivergence(
  p: Record<string, number>,
  q: Record<string, number>,
): number {
  const smoothing = 1e-10;
  const P = normalise(p);
  const Q = normalise(q);

  // Collect all keys across both distributions
  const keys = new Set([...P.keys(), ...Q.keys()]);

  let kl = 0;
  for (const key of keys) {
    const pk = P.get(key) ?? 0;
    const qk = (Q.get(key) ?? 0) + smoothing;
    if (pk > 0) {
      kl += pk * Math.log2(pk / qk);
    }
  }
  return Math.max(0, kl);
}

/**
 * Compute a tool-call frequency distribution from a list of tool names.
 * Returns a Record<toolName, count> suitable for passing to computeKLDivergence.
 */
export function buildToolDistribution(toolNames: string[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const name of toolNames) {
    dist[name] = (dist[name] ?? 0) + 1;
  }
  return dist;
}
