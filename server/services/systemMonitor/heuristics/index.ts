// ---------------------------------------------------------------------------
// Heuristic registry — public API.
// ---------------------------------------------------------------------------

import type { Heuristic } from './types.js';
import { parseHeuristicPhases, matchesPhase } from './phaseFilter.js';

// Agent quality
import { emptyOutputBaselineAware } from './agentQuality/emptyOutputBaselineAware.js';
import { maxTurnsHit } from './agentQuality/maxTurnsHit.js';
import { toolSuccessButFailureLanguage } from './agentQuality/toolSuccessButFailureLanguage.js';
import { runtimeAnomaly } from './agentQuality/runtimeAnomaly.js';
import { tokenAnomaly } from './agentQuality/tokenAnomaly.js';
import { repeatedSkillInvocation } from './agentQuality/repeatedSkillInvocation.js';
import { finalMessageNotAssistant } from './agentQuality/finalMessageNotAssistant.js';
import { outputTruncation } from './agentQuality/outputTruncation.js';
import { identicalOutputDifferentInputs } from './agentQuality/identicalOutputDifferentInputs.js';

// Skill execution
import { toolOutputSchemaMismatch } from './skillExecution/toolOutputSchemaMismatch.js';
import { skillLatencyAnomaly } from './skillExecution/skillLatencyAnomaly.js';
import { toolFailedButAgentClaimedSuccess } from './skillExecution/toolFailedButAgentClaimedSuccess.js';

// Infrastructure
import { jobCompletedNoSideEffect } from './infrastructure/jobCompletedNoSideEffect.js';
import { connectorEmptyResponseRepeated } from './infrastructure/connectorEmptyResponseRepeated.js';

export type { Heuristic };
export type { HeuristicContext, HeuristicResult, Candidate, Evidence, EvidenceItem, Baseline, BaselineReader, Severity, EntityKind, BaselineEntityKind, BaselineRequirement, SuppressionRule } from './types.js';

/** All 14 day-one (Phase 2.0) heuristics. Phase 2.5 modules added in Slice D. */
export const HEURISTICS: Heuristic[] = [
  // Agent quality (9)
  emptyOutputBaselineAware,
  maxTurnsHit,
  toolSuccessButFailureLanguage,
  runtimeAnomaly,
  tokenAnomaly,
  repeatedSkillInvocation,
  finalMessageNotAssistant,
  outputTruncation,
  identicalOutputDifferentInputs,
  // Skill execution (3)
  toolOutputSchemaMismatch,
  skillLatencyAnomaly,
  toolFailedButAgentClaimedSuccess,
  // Infrastructure (2)
  jobCompletedNoSideEffect,
  connectorEmptyResponseRepeated,
];

/**
 * Returns all heuristics whose phase matches SYSTEM_MONITOR_HEURISTIC_PHASES.
 * Default: both '2.0' and '2.5' are active.
 */
export function getActiveHeuristics(): Heuristic[] {
  const phases = parseHeuristicPhases(process.env.SYSTEM_MONITOR_HEURISTIC_PHASES);
  return HEURISTICS.filter(h => matchesPhase(h, phases));
}
