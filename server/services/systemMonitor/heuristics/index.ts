// ---------------------------------------------------------------------------
// Heuristic registry — public API.
//
// HEURISTICS is intentionally empty in Slice B. Slice C populates it with
// 14 day-one heuristics (phase 2.0) and Slice D with 9 Phase 2.5 heuristics.
// ---------------------------------------------------------------------------

import type { Heuristic } from './types.js';
import { parseHeuristicPhases, matchesPhase } from './phaseFilter.js';

export type { Heuristic };
export type { HeuristicContext, HeuristicResult, Candidate, Evidence, EvidenceItem, Baseline, BaselineReader, Severity, EntityKind, BaselineEntityKind, BaselineRequirement, SuppressionRule } from './types.js';

// Populated in Slice C.
export const HEURISTICS: Heuristic[] = [];

/**
 * Returns all heuristics whose phase matches SYSTEM_MONITOR_HEURISTIC_PHASES.
 * Default: both '2.0' and '2.5' are active.
 */
export function getActiveHeuristics(): Heuristic[] {
  const phases = parseHeuristicPhases(process.env.SYSTEM_MONITOR_HEURISTIC_PHASES);
  return HEURISTICS.filter(h => matchesPhase(h, phases));
}
