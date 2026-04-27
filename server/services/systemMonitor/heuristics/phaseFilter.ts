import type { Heuristic } from './types.js';

// Valid phase identifiers per spec §6.2.
type HeuristicPhase = '2.0' | '2.5';

/**
 * Parses a comma-separated phase list env var into a Set of valid phases.
 * Unknown tokens are silently ignored. Returns both phases when env is unset.
 */
export function parseHeuristicPhases(env: string | undefined): Set<HeuristicPhase> {
  if (!env) return new Set(['2.0', '2.5']);

  const result = new Set<HeuristicPhase>();
  for (const token of env.split(',')) {
    const trimmed = token.trim();
    if (trimmed === '2.0' || trimmed === '2.5') {
      result.add(trimmed);
    }
  }
  // If all tokens were unrecognised, fall back to both phases.
  return result.size > 0 ? result : new Set(['2.0', '2.5']);
}

/**
 * Returns true if the heuristic's phase is in the active set.
 */
export function matchesPhase(
  heuristic: Heuristic,
  phases: Set<HeuristicPhase>,
): boolean {
  return phases.has(heuristic.phase);
}
