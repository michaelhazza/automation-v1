// Pure helper: Shannon entropy on a text sample (bits per character).
// Used by the output-entropy-collapse Phase 2.5 heuristic.
// Input: a string sample (typically last 1KB of an agent run's final message).
// Output: Shannon entropy in bits (0 = all identical chars, ~4.7 = uniform ASCII).

/**
 * Compute the Shannon entropy (bits) of the character distribution in `text`.
 * Returns 0 for empty or single-character-class inputs.
 */
export function computeOutputEntropy(text: string): number {
  if (!text || text.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  const n = text.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Compute the mean entropy across an array of text samples.
 * Useful for aggregating over multiple agent runs in a baseline window.
 */
export function meanEntropy(samples: string[]): number {
  if (samples.length === 0) return 0;
  const total = samples.reduce((sum, s) => sum + computeOutputEntropy(s), 0);
  return total / samples.length;
}
